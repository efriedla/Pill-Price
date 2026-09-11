import "server-only";

import { cacheLife } from "next/cache";

import { fetchLabelsForRxcui } from "./openfda-client";
import {
  fetchAllRelated,
  fetchDrugProperties,
  fetchNdcs,
} from "./rxnorm-client";

/**
 * The cross-request cache layer, per ADR-001 and ADR-010.
 *
 * DataLoader dedupes *within* one request; this is what makes a second request
 * cheap. They are different jobs and deliberately different layers — a loader
 * cache has no TTL and must not outlive a request, while these entries are
 * meant to.
 *
 * **Why a week.** ADR-010 put one `cacheLife` of a week on the label call, with
 * no branch on outcome, matching ADR-009's price TTL so the page has a single
 * freshness story. Caching a 404 is deliberate: the worksheet's "never remember
 * a 404" was arguing against a permanent skip-list, which leaves a drug broken
 * forever once it 404s. An expiring entry keeps the recover-unaided property and
 * merely slows it to seven days.
 *
 * RxNorm gets the same profile. Its concepts change on a monthly release cycle,
 * so a week is comfortably inside its real freshness and the whole page then
 * expires together rather than in pieces.
 *
 * **This is what the 200 ms p95 budget is actually measured against.** ADR-011
 * is explicit that no timeout value can get a live fan-out under 200 ms — the
 * fan-out is ~700 ms p50 — so the budget was always this layer's to meet, not
 * the transport's.
 *
 * Note these take only serializable arguments. A cache key is built from the
 * function's identity plus its arguments, so the injectable `HttpDeps` that
 * tests use cannot cross this boundary — which is why the direct clients remain
 * exported and the loaders still accept deps.
 */

export async function cachedDrugProperties(rxcui: string) {
  "use cache";
  cacheLife("weeks");
  return fetchDrugProperties(rxcui);
}

export async function cachedNdcs(rxcui: string) {
  "use cache";
  cacheLife("weeks");
  return fetchNdcs(rxcui);
}

export async function cachedAllRelated(rxcui: string) {
  "use cache";
  cacheLife("weeks");
  return fetchAllRelated(rxcui);
}

export async function cachedLabels(rxcui: string, tty: string) {
  "use cache";
  cacheLife("weeks");
  return fetchLabelsForRxcui(rxcui, tty);
}
