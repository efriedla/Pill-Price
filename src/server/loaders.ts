import "server-only";

import DataLoader from "dataloader";

import type { HttpDeps } from "./http";
import { fetchLabelsForRxcui } from "./openfda-client";
import {
  fetchAllRelated,
  fetchDrugProperties,
  fetchNdcs,
} from "./rxnorm-client";
import type { LabelOutcome } from "./upstream/openfda.schema";
import type { ConceptProperties } from "./upstream/rxnorm.schema";

/**
 * Request-scoped loaders, authorized by ADR-003 and ADR-004 (which promise
 * DataLoader without needing a new decision).
 *
 * **What these actually buy, stated plainly:** neither RxNorm nor openFDA has a
 * multi-get endpoint we are allowed to use, so this is *not* N calls collapsing
 * into one. RxNorm has no batch form for `properties`/`ndcs`/`allrelated`, and
 * openFDA's `OR` batching is forbidden by `api-contract.md` §Batching because
 * it ranks results globally rather than per key — a loader can get zero rows
 * for one key while the API reports success (Q4, open).
 *
 * What they do buy is **deduplication and caching within a single request**: a
 * page that reaches the same RxCUI from `drug`, from `alternatives`, and from a
 * comparison asks once. That is the whole N+1 in ADR-003/004's sense here.
 *
 * They fan out with `Promise.all`-style concurrency and no limiter, which
 * ADR-011 measured as free: 12 concurrent requests cost what 1 costs on both
 * sources — the opposite of NADAC's paging, which degrades 3-8x.
 *
 * **These must be created per request.** DataLoader's cache has no TTL, so a
 * module-level instance would serve one user's answers to the next and never
 * expire. Cross-request caching is `cacheLife`'s job (ADR-001), not this.
 */

/**
 * Fan out over keys, keeping one key's failure to itself.
 *
 * `Promise.all` would reject the whole batch when any single key throws, so one
 * unreachable drug would take out every other drug on the page. DataLoader's
 * contract allows an `Error` *as a value*, which rejects only that key's
 * promise — exactly the granularity ADR-010 needs, where enrichment is always
 * partial and each degradable field states its own outcome.
 */
async function perKey<K, V>(
  keys: readonly K[],
  load: (key: K) => Promise<V>,
): Promise<Array<V | Error>> {
  const settled = await Promise.allSettled(keys.map(load));
  return settled.map((r) =>
    r.status === "fulfilled"
      ? r.value
      : r.reason instanceof Error
        ? r.reason
        : new Error(String(r.reason)),
  );
}

/** Composite key for the label loader: openFDA needs the TTY to be asked at all. */
export type LabelKey = { rxcui: string; tty: string };

export type Loaders = {
  properties: DataLoader<string, ConceptProperties | null>;
  ndcs: DataLoader<string, string[]>;
  related: DataLoader<string, { tty: string; concepts: ConceptProperties[] }[]>;
  /** Third generic is the *cache key* type — see `cacheKeyFn` below. */
  label: DataLoader<LabelKey, LabelOutcome | null, string>;
};

/**
 * The functions a loader calls to actually fetch.
 *
 * Injectable so the *production* path can route through the `use cache` layer
 * (`./cached`) while tests keep calling the direct clients with a stubbed
 * `fetch`. A cache key is built from a function's arguments, so the cached
 * wrappers cannot accept `HttpDeps` — this seam is what keeps both possible.
 */
export type Fetchers = {
  properties: (rxcui: string) => Promise<ConceptProperties | null>;
  ndcs: (rxcui: string) => Promise<string[]>;
  related: (
    rxcui: string,
  ) => Promise<{ tty: string; concepts: ConceptProperties[] }[]>;
  label: (rxcui: string, tty: string) => Promise<LabelOutcome | null>;
};

export function createLoaders(
  deps: HttpDeps = {},
  fetchers?: Fetchers,
): Loaders {
  const f: Fetchers = fetchers ?? {
    properties: (rxcui) => fetchDrugProperties(rxcui, deps),
    ndcs: (rxcui) => fetchNdcs(rxcui, deps),
    related: (rxcui) => fetchAllRelated(rxcui, deps),
    label: (rxcui, tty) => fetchLabelsForRxcui(rxcui, tty, deps),
  };

  return {
    properties: new DataLoader<string, ConceptProperties | null>((rxcuis) =>
      perKey(rxcuis, (rxcui) => f.properties(rxcui)),
    ),

    ndcs: new DataLoader<string, string[]>((rxcuis) =>
      perKey(rxcuis, (rxcui) => f.ndcs(rxcui)),
    ),

    related: new DataLoader<
      string,
      { tty: string; concepts: ConceptProperties[] }[]
    >((rxcuis) => perKey(rxcuis, (rxcui) => f.related(rxcui))),

    /**
     * Keyed by rxcui *and* tty, because the TTY assertion is a precondition of
     * asking at all (ADR-010). `cacheKeyFn` is required: without it DataLoader
     * compares object keys by identity and every call is a cache miss.
     */
    label: new DataLoader<LabelKey, LabelOutcome | null, string>(
      (keys) => perKey(keys, (k) => f.label(k.rxcui, k.tty)),
      { cacheKeyFn: (k) => `${k.rxcui}:${k.tty}` },
    ),
  };
}
