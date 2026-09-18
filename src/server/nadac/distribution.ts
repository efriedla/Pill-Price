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
 * title-matching contract are reached only on a rollover — either because the
 * pinned ID stopped working, or because the calendar year moved past the year
 * the pin is for. The second is not redundant: a rolled-over dataset ID keeps
 * answering, so the year is the only signal that arrives on time.
 */

/** Where a dataset ID came from, so the caller can tell a rollover from a run. */
export type DatasetSource = "pinned" | "rediscovered";

export interface ResolvedDataset {
  datasetId: string;
  year: number;
  /**
   * The distribution index within the dataset, or **null when `datasetId` is
   * itself a distribution identifier** — which is what the rollover fallback
   * resolves. The two take different URLs and there is no index to pass in the
   * second case; see `datasetQueryUrl`.
   */
  index: number | null;
  source: DatasetSource;
  /**
   * Non-empty means **the pin in `config.ts` is stale and a human has to
   * update it.** The job keeps running either way.
   *
   * Usually that means we are running on a discovery rather than on a reviewed
   * constant (`rediscovered`). But it also fires on a *working* pin that has
   * been overtaken by a new calendar year, which is `pinned` with an alert —
   * see `resolveDataset`. A dead pin is loud; an outdated one is not, so the
   * alert is the only thing that distinguishes them.
   */
  alert?: string;
}

/**
 * The query URL for a resolved identifier.
 *
 * DKAN has **two query endpoints, and they are not interchangeable** (measured
 * against the live API, 2026-09-17):
 *
 *   datastore/query/{datasetId}/{index}   200 — a dataset plus which of its
 *                                               distributions to read
 *   datastore/query/{distributionId}      200 — a distribution, addressed
 *                                               directly, with no index
 *
 * Crossing them 404s: `datastore/query/{distributionId}/0` returns
 * `No resource found for dataset … at index 0`. That is the shape of the bug
 * this signature exists to make unwritable — the normal path pins a *dataset*
 * ID while the rollover fallback resolves a *distribution* ID, so the caller
 * cannot assume either, and `index: null` is how the second says so.
 */
export function datasetQueryUrl(
  datasetId: string,
  index: number | null = NADAC_DISTRIBUTION_INDEX,
): string {
  const base = `${NADAC_BASE_URL}/datastore/query/${datasetId}`;
  return index === null ? base : `${base}/${index}`;
}

/** Fetch signature, narrowed so tests can substitute without a network. */
export type FetchJson = (url: string) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

/** The pinned dataset, as returned when it is both live and current. */
const pinned = (alert?: string): ResolvedDataset => ({
  datasetId: NADAC_DATASET_ID,
  year: NADAC_DATASET_YEAR,
  index: NADAC_DISTRIBUTION_INDEX,
  source: "pinned",
  ...(alert ? { alert } : {}),
});

/**
 * Confirm the pinned dataset is still the right one, and rediscover it if not.
 *
 * The probe is a `limit=1` query — 0.28 s unfiltered — rather than a metastore
 * fetch, because the first question being asked is "does this ID still work",
 * and the cheapest truthful answer is to use it.
 *
 * A 400 or 404 is the rollover signal: DKAN rejects an identifier it no longer
 * knows. Anything else (a 500, a timeout) is *not* treated as a rollover —
 * rediscovering on a transient upstream error would repin the config off a
 * blip, which is exactly the silent-drift failure the pin exists to prevent.
 *
 * **A working probe is not sufficient, and that is the correction here.** The
 * ADR-009 fallback was written around a dead pin, but a rolled-over pin does
 * not die: ADR-009's own finding 6 measured the 2013–2021 datasets still
 * answering under the identifiers they were minted with. So in January the
 * 2026 ID keeps returning HTTP 200 forever, the 400 never comes, and the job
 * would go on snapshotting last year's dataset with `source: "pinned"` and no
 * alert — serving frozen prices that no other signal catches. `Price.asOf` and
 * the 14-day staleness notice both measure when the *job* ran, not what year
 * the data is from, so a healthy job on a stale dataset looks fresh.
 *
 * Hence the second question, asked only when the pinned year is behind the
 * calendar: has the next year's dataset appeared? That costs the 1.16 MB index
 * once a week for the few weeks of January before NADAC publishes it, and
 * nothing at all for the other eleven months.
 */
export async function resolveDataset(
  fetchJson: FetchJson,
  now: Date,
): Promise<ResolvedDataset> {
  const probe = await fetchJson(`${datasetQueryUrl(NADAC_DATASET_ID)}?limit=1`);

  if (probe.ok) {
    return NADAC_DATASET_YEAR >= now.getUTCFullYear()
      ? pinned()
      : resolveOvertakenPin(fetchJson, now);
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
    // A distribution is addressed without an index. Passing 0 here 404s every
    // page — measured 2026-09-17, and the reason this field is nullable.
    index: null,
    source: "rediscovered",
    alert:
      `NADAC dataset pin is stale: ${NADAC_DATASET_ID} (${NADAC_DATASET_YEAR}) returned HTTP ${probe.status}. ` +
      `Fell back to the ${resolved.year} distribution ${resolved.distributionId}. ` +
      `This snapshot is valid, but the fallback resolves a *distribution*, which rotates weekly — ` +
      `update NADAC_DATASET_ID in src/server/nadac/config.ts to the ${resolved.year} dataset ID before the next run.`,
  };
}

const METASTORE_URL = `${NADAC_BASE_URL}/metastore/schemas/dataset/items?show-reference-ids=true`;

/**
 * The pinned dataset still answers, but the calendar has moved past its year.
 *
 * Two outcomes, and the difference between them is the whole point:
 *
 * - **NADAC has published the new year's dataset.** The pin is genuinely
 *   behind — snapshotting it would freeze prices at last year's final weekly
 *   file — so this switches to the new year and alerts, exactly as the dead-pin
 *   path does.
 * - **NADAC has not published it yet.** This is ordinary early January, not a
 *   fault. Last year's final file *is* the most current acquisition cost that
 *   exists, so the pin is used as-is and nothing alerts. Alerting here would
 *   fire weekly for a few weeks every year with no action available, and an
 *   alert nobody can act on is one nobody reads.
 *
 * A metastore outage keeps the pin rather than failing the job: the pinned
 * dataset answered, so there is real data to snapshot, and refusing to run
 * would trade a possibly-stale year for certainly no prices. It does alert,
 * because an unanswered rollover check is not the same as a passed one.
 */
async function resolveOvertakenPin(
  fetchJson: FetchJson,
  now: Date,
): Promise<ResolvedDataset> {
  const currentYear = now.getUTCFullYear();
  const index = await fetchJson(METASTORE_URL);

  if (!index.ok) {
    return pinned(
      `NADAC dataset pin ${NADAC_DATASET_ID} is for ${NADAC_DATASET_YEAR} and the year is now ${currentYear}, ` +
        `but the metastore index is unreachable (HTTP ${index.status}) so the rollover could not be checked. ` +
        `Snapshotting the ${NADAC_DATASET_YEAR} dataset, which still answers. ` +
        `Verify by hand whether a ${currentYear} NADAC dataset exists.`,
    );
  }

  const resolved = resolveNadacDistribution(await index.json(), currentYear);

  // `resolveNadacDistribution` prefers the newest year at or below the one
  // asked for, so an unpublished new year comes back as the pinned year itself.
  if (!resolved || resolved.year <= NADAC_DATASET_YEAR) {
    return pinned();
  }

  return {
    // The *distribution* ID, current as of this fetch — see the dead-pin path.
    datasetId: resolved.distributionId,
    year: resolved.year,
    // No index on a distribution — see `datasetQueryUrl`.
    index: null,
    source: "rediscovered",
    alert:
      `NADAC dataset pin is a year behind: ${NADAC_DATASET_ID} is the ${NADAC_DATASET_YEAR} dataset and it still answers, ` +
      `but NADAC has published a ${resolved.year} one. Fell back to the ${resolved.year} distribution ${resolved.distributionId}. ` +
      `This snapshot is valid, but the fallback resolves a *distribution*, which rotates weekly — ` +
      `update NADAC_DATASET_ID in src/server/nadac/config.ts to the ${resolved.year} dataset ID before the next run.`,
  };
}
