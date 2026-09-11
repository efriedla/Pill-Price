import "server-only";

import type { HttpDeps } from "./http";
import {
  cachedAllRelated,
  cachedDrugProperties,
  cachedLabels,
  cachedNdcs,
} from "./cached";
import { createLoaders, type Loaders } from "./loaders";
import { loadPriceIndex, type PriceIndex } from "./prices";

/**
 * The per-request context.
 *
 * Loaders are created here, once per request, and nowhere else. DataLoader's
 * cache has no TTL, so a module-level instance would serve one user's answers
 * to the next forever — cross-request caching is `cacheLife`'s job (ADR-001),
 * not the loader's.
 *
 * The price index is the opposite: it is a 4 MB read that changes weekly, so it
 * is memoised per *process* and merely handed to each request.
 */
export type GraphQLContext = {
  loaders: Loaders;
  /** `null` before the first snapshot job has run — every price is absent. */
  prices: PriceIndex | null;
};

export async function createContext(
  deps: HttpDeps = {},
): Promise<GraphQLContext> {
  return {
    // Production routes every fetch through the `use cache` layer; the 200 ms
    // p95 budget is that layer's to meet, not the transport's.
    loaders: createLoaders(deps, {
      properties: cachedDrugProperties,
      ndcs: cachedNdcs,
      related: cachedAllRelated,
      label: cachedLabels,
    }),
    prices: await loadPriceIndex(),
  };
}
