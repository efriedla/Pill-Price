import "server-only";

import { resolveNadacDistribution } from "../upstream/nadac.schema";
import {
  NADAC_BASE_URL,
  NADAC_DATASET_ID,
  NADAC_DATASET_YEAR,
  NADAC_DISTRIBUTION_INDEX,
} from "./config";

/**
 * Resolving which NADAC dataset to query — the ADR-009 primary/fallback path.
 *
 * Normal operation never touches the metastore. The pinned dataset ID goes
 * straight into `datastore/query/{datasetId}/{index}` and CMS resolves the
 * weekly-rotating distribution itself. The 1.16 MB index and the
 * title-matching contract are reached only when the pinned ID stops working,
 * which should mean exactly one thing: the calendar year rolled over.
 */

/** Where a dataset ID came from, so the caller can tell a rollover from a run. */
export type DatasetSource = "pinned" | "rediscovered";

export interface ResolvedDataset {
  datasetId: string;
  year: number;
  index: number;
  source: DatasetSource;
  /**
   * Set only on `rediscovered`. Non-empty means **the pin in `config.ts` is
   * stale and a human has to update it** — the job keeps running, but it is
   * running on a discovery rather than on a reviewed constant.
   */
  alert?: string;
}

export function datasetQueryUrl(
  datasetId: string,
  index: number = NADAC_DISTRIBUTION_INDEX,
): string {
  return `${NADAC_BASE_URL}/datastore/query/${datasetId}/${index}`;
}

/** Fetch signature, narrowed so tests can substitute without a network. */
export type FetchJson = (url: string) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

/**
 * Confirm the pinned dataset still answers, and rediscover it if not.
 *
 * The probe is a `limit=1` query — 0.28 s unfiltered — rather than a metastore
 * fetch, because the question being asked is "does this ID still work", and the
 * cheapest truthful answer is to use it.
 *
 * A 400 or 404 is the rollover signal: DKAN rejects an identifier it no longer
 * knows. Anything else (a 500, a timeout) is *not* treated as a rollover —
 * rediscovering on a transient upstream error would repin the config off a
 * blip, which is exactly the silent-drift failure the pin exists to prevent.
 */
export async function resolveDataset(
  fetchJson: FetchJson,
  now: Date,
): Promise<ResolvedDataset> {
  const probe = await fetchJson(`${datasetQueryUrl(NADAC_DATASET_ID)}?limit=1`);

  if (probe.ok) {
    return {
      datasetId: NADAC_DATASET_ID,
      year: NADAC_DATASET_YEAR,
      index: NADAC_DISTRIBUTION_INDEX,
      source: "pinned",
    };
  }

  if (probe.status !== 400 && probe.status !== 404) {
    throw new Error(
      `NADAC dataset probe failed with HTTP ${probe.status}. Not treating this as a year rollover — a transient upstream error must not repin the dataset ID.`,
    );
  }

  // Rollover path. This is the only place the 1.16 MB index is ever fetched,
  // and `show-reference-ids=true` is mandatory: without it the response carries
  // no `distribution[].identifier` at all and every entry resolves to null.
  const index = await fetchJson(
    `${NADAC_BASE_URL}/metastore/schemas/dataset/items?show-reference-ids=true`,
  );
  if (!index.ok) {
    throw new Error(
      `NADAC dataset ${NADAC_DATASET_ID} returned HTTP ${probe.status} and the metastore index is unreachable (HTTP ${index.status}). Cannot resolve a dataset to snapshot.`,
    );
  }

  const resolved = resolveNadacDistribution(
    await index.json(),
    now.getUTCFullYear(),
  );
  if (!resolved) {
    throw new Error(
      `NADAC dataset ${NADAC_DATASET_ID} returned HTTP ${probe.status} and no yearly NADAC dataset could be found in the metastore index for ${now.getUTCFullYear()} or earlier.`,
    );
  }

  return {
    // `resolveNadacDistribution` returns the *distribution* ID, which is the
    // right thing to query directly — it is current as of this fetch. What is
    // now unknown is the dataset ID behind it, which is why this alerts.
    datasetId: resolved.distributionId,
    year: resolved.year,
    index: NADAC_DISTRIBUTION_INDEX,
    source: "rediscovered",
    alert:
      `NADAC dataset pin is stale: ${NADAC_DATASET_ID} (${NADAC_DATASET_YEAR}) returned HTTP ${probe.status}. ` +
      `Fell back to the ${resolved.year} distribution ${resolved.distributionId}. ` +
      `This snapshot is valid, but the fallback resolves a *distribution*, which rotates weekly — ` +
      `update NADAC_DATASET_ID in src/server/nadac/config.ts to the ${resolved.year} dataset ID before the next run.`,
  };
}
