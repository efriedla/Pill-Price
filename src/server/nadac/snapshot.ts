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
  /**
   * The newest and oldest `effective_date` **in `latestByNdc`** — not in the
   * dataset.
   *
   * So `earliest` is the oldest *most-recent* price of any NDC: a package that
   * stopped being repriced and has carried the same figure since. It is not
   * the oldest row we read, and this range is **not** the span of history the
   * dataset holds.
   *
   * Reading it as a span is a mistake that has already been made once. It put
   * ~21 months of history into ADR-012's first draft; measured directly
   * against the rows, a yearly dataset holds ~12.5 — a dense weekly series
   * from mid-December of the prior year, plus a sparse ~1.4% tail of older
   * dates that cannot be charted. See ADR-012, "Correction, 2026-09-21".
   *
   * For how far back the data actually goes, count `effective_date` over the
   * rows. This field answers a narrower question: how stale the stalest
   * current price is.
   */
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
  /**
   * Quarterly price history — ADR-012.
   *
   * **Optional, and its absence is meaningful.** A snapshot written before
   * ADR-012 has no series, and so does a cold start; both must read as "we
   * have no history for this drug" rather than as an empty chart. Readers
   * check for the field rather than assuming it.
   *
   * Unlike `latestByNdc` this is **accumulated, not derived** — see
   * `accumulateInto`. It is the one part of the snapshot a bad run could
   * corrupt permanently, which is why closed quarters are immutable.
   */
  quarterlySeries?: QuarterlySeries;
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
    quarterlySeries: toQuarterlySeries(rows),
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

/* ────────────────────────────── price history ──────────────────────────────
 *
 * ADR-012: quarterly buckets, no backfill, accumulating forward, in this same
 * store. This is the second output of the reducer — the weekly job already
 * reads every row, so a series costs no new job and no backfill.
 *
 * Three rules from that ADR are load-bearing, and each is a function or a
 * branch below rather than a comment:
 *
 *   1. A bucket's value is the **last published price in the quarter** — an
 *      actual NADAC figure on a date we can name, never a mean or a median.
 *      Averaging weeks would be arithmetic on money, and money is a decimal
 *      string here precisely because float arithmetic rounds it wrong.
 *   2. **Gaps stay gaps.** An NDC with no publication in a quarter has no
 *      price for it — not zero, and not the last price carried forward.
 *   3. **A closed quarter is immutable.** Only the open quarter is recomputed.
 *      This is what keeps an accumulated series from carrying a bad run
 *      forward forever, and the ADR says it needs a test rather than a
 *      sentence. See `accumulateInto`.
 */

/** A quarter as a sortable calendar label, e.g. `2026Q1`. */
export type QuarterKey = string;

/**
 * The quarter an `effective_date` falls in, read off the string.
 *
 * **Never parsed as a `Date`.** `new Date("2026-01-01")` is midnight UTC, which
 * is 2025 anywhere west of Greenwich — so a January price would bucket into the
 * previous year's Q4 for a reader in New York and Q1 for one in Berlin. The
 * date is a calendar date, and slicing it keeps it one.
 */
export function quarterOf(effectiveDate: string): QuarterKey {
  const year = effectiveDate.slice(0, 4);
  const month = Number(effectiveDate.slice(5, 7));
  return `${year}Q${Math.ceil(month / 3)}`;
}

/** `2026Q1` -> the calendar dates that bound it, both inclusive. */
export function quarterBounds(quarter: QuarterKey): {
  periodStart: string;
  periodEnd: string;
} {
  const year = quarter.slice(0, 4);
  const q = Number(quarter.slice(5));
  const startMonth = String(q * 3 - 2).padStart(2, "0");
  const endMonth = String(q * 3).padStart(2, "0");
  return {
    periodStart: `${year}-${startMonth}-01`,
    periodEnd: `${year}-${endMonth}-${q === 1 || q === 4 ? "31" : "30"}`,
  };
}

/**
 * Order two prices without turning either into a number.
 *
 * `Number("8.14515")` is fine to compare today and wrong to keep, and the rule
 * here is that a price never becomes a float at all — so the comparison is done
 * on the digits. Integer part by length then lexically, fraction zero-padded to
 * a common width. NADAC prices are non-negative.
 */
export function compareDecimal(a: string, b: string): number {
  const [aInt = "", aFrac = ""] = a.split(".");
  const [bInt = "", bFrac = ""] = b.split(".");
  const ai = aInt.replace(/^0+(?=\d)/, "");
  const bi = bInt.replace(/^0+(?=\d)/, "");
  if (ai.length !== bi.length) return ai.length - bi.length;
  if (ai !== bi) return ai < bi ? -1 : 1;
  const width = Math.max(aFrac.length, bFrac.length);
  const af = aFrac.padEnd(width, "0");
  const bf = bFrac.padEnd(width, "0");
  return af === bf ? 0 : af < bf ? -1 : 1;
}

/**
 * One quarter's price, **stored positionally** against `QuarterlySeries.quarters`.
 *
 * A tuple rather than an object, and `null` rather than a gap marker, because
 * the field names are the file. Measured against the real 32,621-NDC snapshot,
 * four quarters of `{quarter, perUnit, effectiveDate, observations}` objects
 * encode to **12.8 MB** where the same data as tuples is **4.4 MB** — the keys
 * outweigh the values roughly two to one. At the object shape the JSON store's
 * ~20 MB working ceiling arrives in about two years; at this one, five.
 *
 * Read it through `pointsOf`, which expands it back into named fields. Nothing
 * above this module should index a tuple.
 */
export type StoredPoint =
  | [perUnit: string, effectiveDate: string, observations: number]
  | null;

/** One NDC's history, positional and therefore only meaningful with its axis. */
export interface NdcSeries {
  /**
   * `EA` / `ML` / `GM`, constant across the series.
   *
   * `PriceSeries.unit` is a single `String!` because a series whose unit
   * changes partway is not comparable to itself. Where an NDC's unit does
   * change, only the points sharing the newest unit are kept — converting
   * between EA, ML and GM needs a package size we do not have.
   */
  unit: string;
  /** Same length and order as `QuarterlySeries.quarters`. */
  points: StoredPoint[];
}

export interface QuarterlySeries {
  /** Every quarter any NDC has a price in, ascending. The chart's axis. */
  quarters: QuarterKey[];
  byNdc: Record<string, NdcSeries>;
}

/** A point with its fields named — the shape everything above this file reads. */
export interface SeriesPoint {
  quarter: QuarterKey;
  /** The last price published in the quarter. A real figure, not a rollup. */
  perUnit: string;
  /**
   * The date NADAC published `perUnit`.
   *
   * Kept because ADR-012 commits to every point staying "a thing NADAC
   * published on a date we can name". Without it the bucket label is the only
   * date available, and a bucket label is ours, not NADAC's.
   */
  effectiveDate: string;
  /** Distinct publications seen in the quarter — `PricePoint.observations`. */
  observations: number;
}

/**
 * Expand one NDC's stored series into named points, gaps omitted.
 *
 * Sparse on the way out: a quarter with no publication is simply not in the
 * result, which is ADR-012's "gaps stay gaps" at the read boundary. A caller
 * that needs the gaps as points — the chart does — walks `quarters` itself.
 */
export function pointsOf(
  series: QuarterlySeries,
  ndc: string,
): SeriesPoint[] {
  const stored = series.byNdc[ndc];
  if (!stored) return [];
  const points: SeriesPoint[] = [];
  stored.points.forEach((point, i) => {
    if (!point) return;
    const quarter = series.quarters[i];
    if (!quarter) return;
    points.push({
      quarter,
      perUnit: point[0],
      effectiveDate: point[1],
      observations: point[2],
    });
  });
  return points;
}

/** Lay named points back onto an axis. The inverse of `pointsOf`. */
function encode(quarters: QuarterKey[], points: SeriesPoint[]): StoredPoint[] {
  const byQuarter = new Map(points.map((p) => [p.quarter, p]));
  return quarters.map((q) => {
    const point = byQuarter.get(q);
    return point
      ? [point.perUnit, point.effectiveDate, point.observations]
      : null;
  });
}

/** Build a `QuarterlySeries` from one expanded series per NDC. */
function assemble(
  expanded: Map<string, { unit: string; points: SeriesPoint[] }>,
): QuarterlySeries {
  const axis = new Set<QuarterKey>();
  for (const { points } of expanded.values()) {
    for (const point of points) axis.add(point.quarter);
  }
  const quarters = [...axis].sort();

  const byNdc: Record<string, NdcSeries> = {};
  for (const [ndc, { unit, points }] of expanded) {
    if (points.length === 0) continue;
    byNdc[ndc] = { unit, points: encode(quarters, points) };
  }
  return { quarters, byNdc };
}

/**
 * Reduce raw rows to one price per NDC per quarter.
 *
 * The bucket's value is the newest `effective_date` in the quarter — ADR-012's
 * rule as code. Where two rows share that newest date with different prices (a
 * correction, not the duplicate tuples `dedupeRows` already removes) the lower
 * is taken, matching what `Drug.price` does across packages and for the same
 * reason: it is the honest reduction when they disagree.
 *
 * Unit-less rows are dropped, the same absence `buildPriceIndex` applies to
 * `latestByNdc`: `PriceSeries.unit` is non-null, and a figure whose unit is
 * unknown is not a price this app may state.
 */
export function toQuarterlySeries(rows: readonly NadacRow[]): QuarterlySeries {
  const buckets = new Map<
    string,
    Map<QuarterKey, SeriesPoint & { unit: string }>
  >();

  for (const row of dedupeRows(rows)) {
    if (row.nadac_per_unit === null || row.effective_date === null) continue;
    if (row.pricing_unit === null) continue;

    const quarter = quarterOf(row.effective_date);
    const forNdc =
      buckets.get(row.ndc) ??
      new Map<QuarterKey, SeriesPoint & { unit: string }>();
    const held = forNdc.get(quarter);

    // `observations` counts every publication in the quarter, including the
    // ones that lost the newest-date contest — it is how many prices the point
    // stands for, not how many survived it.
    const observations = (held?.observations ?? 0) + 1;

    const wins =
      !held ||
      row.effective_date > held.effectiveDate ||
      (row.effective_date === held.effectiveDate &&
        compareDecimal(row.nadac_per_unit, held.perUnit) < 0);

    forNdc.set(
      quarter,
      wins
        ? {
            quarter,
            perUnit: row.nadac_per_unit,
            effectiveDate: row.effective_date,
            observations,
            unit: row.pricing_unit,
          }
        : { ...held, observations },
    );
    buckets.set(row.ndc, forNdc);
  }

  const expanded = new Map<string, { unit: string; points: SeriesPoint[] }>();
  for (const [ndc, forNdc] of buckets) {
    const points = [...forNdc.values()].sort((a, b) =>
      a.quarter < b.quarter ? -1 : a.quarter > b.quarter ? 1 : 0,
    );
    const newest = points[points.length - 1]!;
    // A unit change means the earlier points are denominated in something else.
    // Keeping them would draw one line across two scales.
    const comparable = points.filter((point) => point.unit === newest.unit);
    expanded.set(ndc, { unit: newest.unit, points: comparable });
  }

  return assemble(expanded);
}

/**
 * The newest quarter the data reaches — the only one a run may rewrite.
 *
 * Read off the series rather than off the clock. Two reasons: "today" needs a
 * timezone and these are calendar dates; and a quarter is closed once we have
 * seen data past it, which is a fact about the dataset rather than about when
 * the job happened to run. A job that runs late does not reopen a quarter.
 */
export function openQuarter(series: QuarterlySeries): QuarterKey | null {
  return series.quarters[series.quarters.length - 1] ?? null;
}

/**
 * Merge a fresh run into the stored series — ADR-012's "accumulating forward".
 *
 * **A closed quarter is never rewritten.** This is the whole safety property:
 * the series stops being purely derived from the current dataset the moment it
 * accumulates, so without this rule one bad run becomes permanent. Rebuilding
 * from scratch is then a deliberate act — delete the file — rather than
 * something a later run does by accident.
 *
 * Three cases, in the order they are decided:
 *
 * - **A closed quarter already stored** keeps the stored price. Not "the newer
 *   figure wins" — the stored one wins even where the fresh run disagrees,
 *   because a disagreement here is the signal ADR-012's "revisit if" asks us to
 *   go and look at, not something to paper over.
 * - **A closed quarter not yet stored** takes the fresh price. Seeding is not
 *   rewriting; this is what fills the first four quarters on the first run.
 * - **The open quarter** takes whichever price has the newer `effectiveDate`,
 *   fresh winning a tie. Not a blind replace: right after a January rollover
 *   the new yearly dataset starts mid-December, so for an NDC last published in
 *   October the fresh run has nothing for Q4 while the stored series has the
 *   real answer. Blind replacement would delete it.
 *
 * Throws on an incomplete run. ADR-009 already refuses to *serve* a partial
 * table; under accumulation it must also refuse to *write* one, because a
 * partial quarter merged into a closed bucket can never be corrected.
 */
export function accumulateInto(
  previous: Snapshot | null,
  fresh: Snapshot,
): Snapshot {
  if (!fresh.manifest.complete) {
    throw new Error(
      `Refusing to accumulate an incomplete snapshot (${fresh.manifest.rowsFetched}/${fresh.manifest.rowsReported} rows). ` +
        `A partial quarter merged into the stored series cannot be corrected later — closed quarters are immutable.`,
    );
  }

  const freshSeries = fresh.quarterlySeries ?? { quarters: [], byNdc: {} };
  const storedSeries = previous?.quarterlySeries;
  if (!storedSeries) return fresh;

  const open = openQuarter(freshSeries);
  const expanded = new Map<string, { unit: string; points: SeriesPoint[] }>();

  for (const ndc of new Set([
    ...Object.keys(storedSeries.byNdc),
    ...Object.keys(freshSeries.byNdc),
  ])) {
    const storedUnit = storedSeries.byNdc[ndc]?.unit;
    const freshUnit = freshSeries.byNdc[ndc]?.unit;

    if (freshUnit === undefined) {
      // The NDC left the current dataset — it stopped being priced, or the year
      // rolled over past it. Its history is still history.
      expanded.set(ndc, { unit: storedUnit!, points: pointsOf(storedSeries, ndc) });
      continue;
    }

    // A unit change invalidates the stored points for the same reason
    // `toQuarterlySeries` drops them within a run: EA and ML are not one line.
    if (storedUnit !== undefined && storedUnit !== freshUnit) {
      expanded.set(ndc, { unit: freshUnit, points: pointsOf(freshSeries, ndc) });
      continue;
    }

    const merged = new Map<QuarterKey, SeriesPoint>();
    for (const point of pointsOf(storedSeries, ndc)) {
      merged.set(point.quarter, point);
    }
    for (const point of pointsOf(freshSeries, ndc)) {
      const held = merged.get(point.quarter);
      if (!held) {
        merged.set(point.quarter, point);
        continue;
      }
      if (point.quarter !== open) continue; // closed: the stored price stands
      if (point.effectiveDate >= held.effectiveDate) {
        merged.set(point.quarter, point);
      }
    }

    expanded.set(ndc, {
      unit: freshUnit,
      points: [...merged.values()].sort((a, b) =>
        a.quarter < b.quarter ? -1 : a.quarter > b.quarter ? 1 : 0,
      ),
    });
  }

  // The manifest is the fresh run's throughout: it describes *this* run, and
  // the series is the only accumulated thing in the snapshot.
  return { ...fresh, quarterlySeries: assemble(expanded) };
}
