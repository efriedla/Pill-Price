import "server-only";

import { requestUpstream, type HttpDeps } from "./http";
import {
  isPlainTextNotFound,
  parseAllRelated,
  parseDrugProperties,
  parseDrugSearch,
  parseNdcs,
  type ConceptProperties,
} from "./upstream/rxnorm.schema";
import { parseJsonBody } from "./upstream/parse";

/** Upstream: RxNorm. Drug concepts, ingredients, related products. */
export const RXNORM_BASE_URL = "https://rxnav.nlm.nih.gov/REST";

/**
 * Every call goes through ADR-011's policy: a 2.5 s budget per attempt, two
 * attempts, jittered backoff. Nothing here catches `UpstreamUnavailableError` —
 * mapping a transport failure onto ADR-010's kinds is the resolver's job, and
 * it differs by field (identity is fatal, enrichment is partial).
 */
async function getJson(
  endpoint: string,
  url: string,
  deps: HttpDeps,
): Promise<unknown | null> {
  const res = await requestUpstream("rxnorm", url, deps);

  // RxNorm's `rxcuistatus.json` answers HTTP 404 with a plain-text body, and
  // upstream-notes §1.2 names calling `.json()` on it as the likeliest source
  // of an unexplained 500 in the BFF. Checked on the raw text, before parsing.
  if (isPlainTextNotFound(res.body)) return null;
  if (res.status === 404) return null;

  return parseJsonBody("rxnorm", endpoint, res.body);
}

/**
 * A concept's properties — the identity call.
 *
 * `null` means the drug does not exist. RxNorm says so with **HTTP 200 and
 * `{}`** rather than a 404 (§1.1), which the parser asserts rather than
 * letting `{}` pass as a drug. Under ADR-010 this is identity-`absent`, and
 * it is not-found rather than an error.
 */
export async function fetchDrugProperties(
  rxcui: string,
  deps: HttpDeps = {},
): Promise<ConceptProperties | null> {
  const data = await getJson(
    "properties.json",
    `${RXNORM_BASE_URL}/rxcui/${encodeURIComponent(rxcui)}/properties.json`,
    deps,
  );
  return data === null ? null : parseDrugProperties(data);
}

/**
 * The NDCs a concept dispenses as. Expect hundreds — one metformin ER 500 MG
 * SCD returns 401 (§1.4) — and they join to NADAC's snapshot as-is.
 */
export async function fetchNdcs(
  rxcui: string,
  deps: HttpDeps = {},
): Promise<string[]> {
  const data = await getJson(
    "ndcs.json",
    `${RXNORM_BASE_URL}/rxcui/${encodeURIComponent(rxcui)}/ndcs.json`,
    deps,
  );
  return data === null ? [] : parseNdcs(data);
}

/**
 * Related concepts, still grouped by TTY.
 *
 * `allrelated.json` rather than `related.json` on purpose: `related.json`
 * requires a `tty=` or `rela=` parameter and returns **HTTP 400 on every
 * request** without one (ADR-011's measured trap, which read as an outage for a
 * whole sweep). `allrelated.json` takes no parameters, so the trap cannot be
 * sprung, and the grouping survives for **Q7** — which of the 19 TTYs count as
 * an alternative — to answer later.
 */
export async function fetchAllRelated(
  rxcui: string,
  deps: HttpDeps = {},
): Promise<{ tty: string; concepts: ConceptProperties[] }[]> {
  const data = await getJson(
    "allrelated.json",
    `${RXNORM_BASE_URL}/rxcui/${encodeURIComponent(rxcui)}/allrelated.json`,
    deps,
  );
  return data === null ? [] : parseAllRelated(data);
}

/**
 * Search by name. An empty list is the empty state, never an error (§1.1) —
 * and note RxNorm's approximate matcher does not tolerate typos (§1.5, Q8).
 */
export async function searchDrugs(
  term: string,
  deps: HttpDeps = {},
): Promise<ConceptProperties[]> {
  const data = await getJson(
    "drugs.json",
    `${RXNORM_BASE_URL}/drugs.json?name=${encodeURIComponent(term)}`,
    deps,
  );
  return data === null ? [] : parseDrugSearch(data);
}
