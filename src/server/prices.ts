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
  /** `EA` / `ML` / `GM`. **Not yet exposed: `Price.unit` is missing from the
   * SDL and is the author's to add.** Carried here so the resolver does not
   * have to re-read the snapshot once it lands. */
  unit: string | null;
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

export function buildPriceIndex(snapshot: Snapshot): PriceIndex {
  if (!snapshot.manifest.complete) {
    throw new IncompleteSnapshotError(
      snapshot.manifest.rowsFetched,
      snapshot.manifest.rowsReported,
    );
  }

  // A Map, built once. The snapshot is ~32,500 entries; a linear scan per NDC
  // against a drug's 401 packages would be 13M comparisons per request.
  const byNdc = new Map<string, PriceEntry>(
    snapshot.latestByNdc.map((e) => [e.ndc, e]),
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
