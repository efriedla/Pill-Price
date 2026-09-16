import "server-only";

import type { PriceEntry, Snapshot } from "./nadac/snapshot";
import { createFileSnapshotStore, type SnapshotStore } from "./nadac/store";

/**
 * Reading prices, per ADR-009.
 *
 * The request path never touches `data.medicaid.gov`. It reads this, which is a
 * local index over the weekly snapshot — so a miss costs exactly what a hit
 * costs, which is the property that makes the design fit the data: ~92% of
 * packages have no published price, and paying 2.7 s to learn that was the
 * thing ADR-009 refused.
 *
 * **An absent NDC is a published fact, not a cache miss.** The snapshot is the
 * whole table, so "not in here" means "NADAC publishes no acquisition cost for
 * this package" — a sentence the UI can state plainly.
 */

/** A price, with the snapshot's own `asOf` attached — ADR-009 made it load-bearing. */
export type ResolvedPrice = {
  pricePerUnit: string;
  effectiveDate: string;
  asOf: string;
  /**
   * `EA` / `ML` / `GM`, exposed as `Price.unit`.
   *
   * Non-null, which is a promise this module keeps rather than one NADAC
   * makes: the column is absentable and the snapshot carries it as
   * `string | null`. An entry without a unit never reaches the index at all
   * (see `buildPriceIndex`), so a price that exists here always has one.
   */
  unit: string;
};

export interface PriceIndex {
  /** `null` means NADAC publishes no price for this NDC. */
  forNdc(ndc: string): ResolvedPrice | null;
  /** How many of these NDCs are priced — `Coverage`'s denominator lives here. */
  coverage(ndcs: readonly string[]): {
    pricedPackages: number;
    totalPackages: number;
  };
  asOf: string;
}

/**
 * Refuses an incomplete snapshot, which `snapshot.ts` states as a requirement
 * rather than a suggestion: a partial price table is indistinguishable from a
 * drug having no published price, and that confusion is the one thing this
 * whole design exists to prevent. Better no prices at all, loudly, than wrong
 * ones quietly.
 */
export class IncompleteSnapshotError extends Error {
  constructor(readonly rowsFetched: number, readonly rowsReported: number) {
    super(
      `NADAC snapshot is incomplete (${rowsFetched}/${rowsReported} rows). ` +
        `Refusing to serve it: a partial table reads as "no published price", which is a lie.`,
    );
    this.name = "IncompleteSnapshotError";
  }
}

/** A snapshot entry that carries the unit `Price.unit` requires. */
type PricedEntry = PriceEntry & { unit: string };

const hasUnit = (entry: PriceEntry): entry is PricedEntry => entry.unit !== null;

export function buildPriceIndex(snapshot: Snapshot): PriceIndex {
  if (!snapshot.manifest.complete) {
    throw new IncompleteSnapshotError(
      snapshot.manifest.rowsFetched,
      snapshot.manifest.rowsReported,
    );
  }

  // A Map, built once. The snapshot is ~32,500 entries; a linear scan per NDC
  // against a drug's 401 packages would be 13M comparisons per request.
  //
  // **A unit-less entry is dropped here, not at read time.** `Price.unit` is
  // `String!`, and ui-spec §9 renders every price with its unit — a figure
  // whose unit is unknown is not a price this app may state, so it becomes the
  // same absence as no NADAC record. Filtering at build is what keeps
  // `forNdc` and `coverage` from disagreeing: were this a check inside
  // `forNdc`, `coverage` would still count the entry and the page would claim
  // "priced 3 of 14" while rendering two prices.
  //
  // Measured 2026-09-16: 2500 rows sampled across the 1,118,109-row dataset
  // carry a unit, so this is expected to drop nothing. It is a guard against a
  // column that upstream types as absentable, not a routine filter.
  const byNdc = new Map<string, PricedEntry>(
    snapshot.latestByNdc.filter(hasUnit).map((e) => [e.ndc, e]),
  );
  const { asOf } = snapshot.manifest;

  return {
    asOf,

    forNdc(ndc) {
      const entry = byNdc.get(ndc);
      if (!entry) return null;
      return {
        pricePerUnit: entry.perUnit,
        effectiveDate: entry.effectiveDate,
        asOf,
        unit: entry.unit,
      };
    },

    coverage(ndcs) {
      let priced = 0;
      for (const ndc of ndcs) if (byNdc.has(ndc)) priced++;
      return { pricedPackages: priced, totalPackages: ndcs.length };
    },
  };
}

/**
 * Load the snapshot once per process, not once per request.
 *
 * Parsing 4 MB of JSON and building the Map costs far more than the 200 ms p95
 * budget allows, and the snapshot only changes weekly — so doing it per request
 * would be paying a batch cost on the request path, which is the exact mistake
 * ADR-009 was written to avoid.
 *
 * A missing snapshot resolves to `null` rather than throwing: a cold start
 * before the first job run is legitimate, and every price is simply absent.
 */
let cached: Promise<PriceIndex | null> | undefined;

export function loadPriceIndex(
  store: SnapshotStore = createFileSnapshotStore(),
): Promise<PriceIndex | null> {
  cached ??= store.read().then((s) => (s ? buildPriceIndex(s) : null));
  return cached;
}

/** Tests only — the module-level cache would otherwise leak between cases. */
export function resetPriceIndexCache() {
  cached = undefined;
}
