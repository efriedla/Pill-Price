import "server-only";

import { cacheLife } from "next/cache";

import { UpstreamUnavailableError, type UpstreamSource } from "./http";
import { fetchLabels, type LabelQuery } from "./openfda-client";
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
 *
 * **An outage never crosses this boundary as a throw** (found 2026-09-25).
 * An error thrown inside a `use cache` function reaches the caller as React's
 * obfuscated "An error occurred in the Server Components render", not as the
 * `UpstreamUnavailableError` that was thrown. So `degrade()`'s instanceof
 * check failed, the resolver rethrew, and every production outage took its
 * boundary down instead of rendering `Unavailable`. At build it was worse:
 * Next fails the prerender on any error recorded inside a cache function,
 * caught or not. Unit tests call the clients directly and could not see it.
 *
 * So each cached function returns an `Outcome`: a plain value that survives
 * serialization. An outage is cached for the `seconds` profile (a minute),
 * long enough to stop a dead upstream being asked on every render, short
 * enough to stay out of any prerender. The exported wrapper rethrows a real
 * `UpstreamUnavailableError` on the caller's side of the boundary. Any other
 * error is a bug (ADR-010: loud, never absent) and still throws inside.
 */

export type Outcome<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      source: UpstreamSource;
      url: string;
      attempts: number;
      cause: string;
    };

/** Inside the cache: an outage becomes a value, and a short-lived one. */
export async function settle<T>(
  work: Promise<T>,
  onOutage: () => void = () => cacheLife("seconds"),
): Promise<Outcome<T>> {
  try {
    const value = await work;
    return { ok: true, value };
  } catch (error) {
    if (!(error instanceof UpstreamUnavailableError)) throw error;
    onOutage();
    return {
      ok: false,
      source: error.source,
      url: error.url,
      attempts: error.attempts,
      cause: error.cause_,
    };
  }
}

/** Outside the cache: the outage is an error again, of the class degrade() knows. */
export function unwrap<T>(outcome: Outcome<T>): T {
  if (outcome.ok) return outcome.value;
  throw new UpstreamUnavailableError(
    outcome.source,
    outcome.url,
    outcome.attempts,
    outcome.cause,
  );
}

// cacheLife("weeks") is called first and settle() may shorten it: the docs
// allow one call per invocation, so the outage branch is the only other one.

async function drugPropertiesOutcome(rxcui: string) {
  "use cache";
  return settle(fetchDrugProperties(rxcui).then(weeks));
}

async function ndcsOutcome(rxcui: string) {
  "use cache";
  return settle(fetchNdcs(rxcui).then(weeks));
}

async function allRelatedOutcome(rxcui: string) {
  "use cache";
  return settle(fetchAllRelated(rxcui).then(weeks));
}

async function labelsOutcome(rxcui: string, tty: string, query: LabelQuery) {
  "use cache";
  return settle(fetchLabels(rxcui, tty, query).then(weeks));
}

/** Set the week-long profile on success, and pass the value through. */
function weeks<T>(value: T): T {
  cacheLife("weeks");
  return value;
}

export const cachedDrugProperties = async (rxcui: string) =>
  unwrap(await drugPropertiesOutcome(rxcui));

export const cachedNdcs = async (rxcui: string) =>
  unwrap(await ndcsOutcome(rxcui));

export const cachedAllRelated = async (rxcui: string) =>
  unwrap(await allRelatedOutcome(rxcui));

export const cachedLabels = async (
  rxcui: string,
  tty: string,
  query: LabelQuery,
) => unwrap(await labelsOutcome(rxcui, tty, query));
