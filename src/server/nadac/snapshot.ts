import "server-only";

import { dedupeRows, parseNadacQuery } from "../upstream/nadac.schema";
import type { NadacRow } from "../upstream/nadac.schema";
import { PAGE_SIZE, STALE_AFTER_DAYS } from "./config";
import { datasetQueryUrl, type FetchJson, type ResolvedDataset } from "./distribution";

/**
 * The weekly NADAC snapshot — ADR-009, Option C.
 *
 * Prices are never fetched during a request. This job pages the whole dataset,
 * normalises it, and hands back something resolvers can read locally. That is
 * what turns a 2.7 s filtered scan into a local lookup, and — the part that
 * actually decided the ADR — it makes a **miss cost what a hit costs**, which
 * matters because ~92% of packages have no published price at all.
 *
 * The job never issues a filter. Filtering is what costs 2.7 s per call, while
 * unfiltered paging is 0.68–1.85 s per 5,000 rows *in isolation*. Sustained,
 * it averages 5.6 s per page: the whole dataset is ~205 requests and **~19
 * minutes**, measured. ADR-009 originally estimated 2–4 minutes by
 * extrapolating from single requests, which is the floor for sustained paging
 * rather than a sample of it.
 */

/** One package's current price. `null` price means published-as-absent. */
export interface PriceEntry {
  ndc: string;
  perUnit: string;
  effectiveDate: string;
  /** `EA` / `ML` / `GM`. Without it a per-package price is not comparable. */
  unit: string | null;
  description: string | null;
}

export interface SnapshotManifest {
  /** When this job ran. The field the 14-day staleness notice reads. */
  asOf: string;
  datasetId: string;
  datasetYear: number;
  /** `rediscovered` means the config pin is stale — see `alert`. */
  datasetSource: ResolvedDataset["source"];
  alert?: string;
  /** Rows NADAC reported for the dataset, versus what we actually stored. */
  rowsReported: number;
  rowsFetched: number;
  /** Distinct NDCs with a usable current price. */
  pricedNdcs: number;
  /** Newest and oldest `effective_date` seen. */
  effectiveDateRange: { earliest: string; latest: string } | null;
  /**
   * False when paging did not reach `rowsReported`. **A resolver must refuse to
   * serve an incomplete snapshot**: a partial price table is indistinguishable
   * from a drug having no published price, which is the one confusion this
   * whole design exists to prevent.
   */
  complete: boolean;
}

export interface Snapshot {
  manifest: SnapshotManifest;
  /** Latest price per NDC. ~30,200 entries, ~3 MB. */
  latestByNdc: PriceEntry[];
}

/**
 * Page the entire dataset, unfiltered.
 *
 * `count` is the dataset total, not the page length, and there is no `next`
 * link — you page by offset until you have them all (§3.4). Paging stops on a
 * short page as well as on the count, because a server that quietly returns
 * fewer rows would otherwise loop forever.
 */
export async function fetchAllRows(
  fetchJson: FetchJson,
  dataset: ResolvedDataset,
  onProgress?: (fetched: number, total: number) => void,
): Promise<{ rows: NadacRow[]; reported: number }> {
  const url = datasetQueryUrl(dataset.datasetId, dataset.index);
  const rows: NadacRow[] = [];
  let reported = 0;
  let offset = 0;

  for (;;) {
    const res = await fetchJson(
      `${url}?limit=${PAGE_SIZE}&offset=${offset}&count=true&schema=false`,
    );
    if (!res.ok) {
      throw new Error(
        `NADAC page at offset ${offset} failed with HTTP ${res.status}. Aborting rather than writing a partial snapshot.`,
      );
    }

    const { rows: page, count } = parseNadacQuery(await res.json());
    reported = count;
    rows.push(...page);
    onProgress?.(rows.length, reported);

    // A short page means the end, whatever `count` claims.
    if (page.length === 0 || page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
    if (rows.length >= reported) break;
  }

  return { rows, reported };
}

/**
 * Reduce raw rows to the current price per NDC.
 *
 * Deduplication comes first and is required, not defensive: NADAC returns the
 * same `(ndc, effective_date, nadac_per_unit)` tuple more than once (§3.4).
 *
 * "Current" is the **newest `effective_date`**, not the last row seen — the API
 * gives no ordering guarantee, and relying on arrival order would make the
 * price a function of pagination.
 */
export function toLatestByNdc(rows: readonly NadacRow[]): PriceEntry[] {
  const latest = new Map<string, PriceEntry>();

  for (const row of dedupeRows(rows)) {
    // `dedupeRows` already drops rows with no price or no date; both are
    // narrowed again here so this function is safe read on its own.
    if (row.nadac_per_unit === null || row.effective_date === null) continue;

    const current = latest.get(row.ndc);
    if (current && current.effectiveDate >= row.effective_date) continue;

    latest.set(row.ndc, {
      ndc: row.ndc,
      perUnit: row.nadac_per_unit,
      effectiveDate: row.effective_date,
      unit: row.pricing_unit,
      description: row.ndc_description,
    });
  }

  return [...latest.values()];
}

/** Build the snapshot. Pure given rows — the network lives in `fetchAllRows`. */
export function buildSnapshot(
  rows: readonly NadacRow[],
  reported: number,
  dataset: ResolvedDataset,
  now: Date,
): Snapshot {
  const latestByNdc = toLatestByNdc(rows);
  const dates = latestByNdc.map((entry) => entry.effectiveDate).sort();
  const earliest = dates[0];
  const latest = dates[dates.length - 1];

  return {
    manifest: {
      asOf: now.toISOString(),
      datasetId: dataset.datasetId,
      datasetYear: dataset.year,
      datasetSource: dataset.source,
      ...(dataset.alert ? { alert: dataset.alert } : {}),
      rowsReported: reported,
      rowsFetched: rows.length,
      pricedNdcs: latestByNdc.length,
      effectiveDateRange:
        earliest && latest ? { earliest, latest } : null,
      complete: rows.length >= reported,
    },
    latestByNdc,
  };
}

/**
 * How stale a snapshot is, in whole days.
 *
 * Under Option C freshness is an *operational* property — a silently failed job
 * serves old prices indefinitely — so this is the check that makes the failure
 * visible instead of invisible. ADR-009 puts the threshold at 14 days rather
 * than 7 because the job runs weekly and one miss is indistinguishable from
 * schedule jitter.
 */
export function snapshotAgeDays(manifest: SnapshotManifest, now: Date): number {
  const asOf = Date.parse(manifest.asOf);
  if (Number.isNaN(asOf)) return Number.POSITIVE_INFINITY;
  return Math.floor((now.getTime() - asOf) / 86_400_000);
}

export function isSnapshotStale(manifest: SnapshotManifest, now: Date): boolean {
  return snapshotAgeDays(manifest, now) >= STALE_AFTER_DAYS;
}
