import "server-only";

/** Upstream: openFDA. Labels, NDC, manufacturer, pharmacologic class. */
export const OPENFDA_BASE_URL = "https://api.fda.gov";

/**
 * ADR-010's two guards live here, at the client, because both are facts about
 * what this upstream can answer for — not about any one resolver. openFDA's 404
 * is byte-identical for "this drug has no label" and "we sent a query openFDA
 * does not understand" (upstream-notes §2.1), so `absent` is only a safe reading
 * once every way *we* can provoke a 404 has been eliminated. There are exactly
 * two, and both are checked before a request is made rather than detected after
 * one comes back:
 *
 *   1. asking about the wrong kind of thing  → the TTY assertion below
 *   2. asking with a field name that no longer exists
 *      → `OPENFDA_QUERIED_FIELDS`, verified in CI by `check:openfda-fields`
 *
 * With both ruled out, a 404 that reaches a resolver has one meaning left.
 */

/**
 * The term types openFDA will answer for.
 *
 * Measured, not guessed (ADR-010, measurement 4): these four are the dispensable
 * product concepts an SPL is actually written about. GPCK and BPCK answer for
 * 8/10 and 7/10 of sampled packs; every other term type probed — IN, MIN, PIN,
 * BN, DF, DFG, SCDG, SBDG, SCDF, SBDF, SCDC — returns 404 for *every* drug,
 * indistinguishably from a real absence.
 */
export const LABEL_QUERYABLE_TTYS = ["SCD", "SBD", "GPCK", "BPCK"] as const;

export type LabelQueryableTty = (typeof LABEL_QUERYABLE_TTYS)[number];

/**
 * Thrown when a non-product RxCUI reaches the openFDA client.
 *
 * This is a programming error, not a runtime condition, and it throws rather
 * than degrading: there is no user-facing situation in which the correct
 * response to "we asked the wrong question" is to show an empty label section.
 * Rendering `absent` here would be a lie — we never asked.
 */
export class WrongTtyError extends Error {
  constructor(
    readonly rxcui: string,
    readonly tty: string,
  ) {
    super(
      `openFDA cannot answer for TTY ${tty} (rxcui ${rxcui}): only ${LABEL_QUERYABLE_TTYS.join(", ")} are product-level. ` +
        `An ingredient-level RxCUI must be resolved to products before a label lookup — see ADR-010.`,
    );
    this.name = "WrongTtyError";
  }
}

/**
 * Narrow an RxCUI's TTY to one openFDA answers for, or throw.
 *
 * Every openFDA label call goes through this. It deliberately does **not**
 * predict whether a label exists — product-level TTYs 404 legitimately, and
 * that is the case `absent` is for. Its job is elimination.
 */
export function assertLabelQueryableTty(
  rxcui: string,
  tty: string,
): asserts tty is LabelQueryableTty {
  if (!(LABEL_QUERYABLE_TTYS as readonly string[]).includes(tty)) {
    throw new WrongTtyError(rxcui, tty);
  }
}

/** Non-throwing form, for deciding whether to ask at all. */
export function isLabelQueryableTty(tty: string): tty is LabelQueryableTty {
  return (LABEL_QUERYABLE_TTYS as readonly string[]).includes(tty);
}

/**
 * Every openFDA field name this repo depends on, checked against the live API
 * in CI (`npm run check:openfda-fields`).
 *
 * A rename is silent at request time — a query against a field that no longer
 * exists 404s exactly like a drug with no label, and a *response* field that
 * was renamed simply parses as absent. Both failure modes are invisible in a
 * single event and total in aggregate, which is why the check runs at build
 * time rather than on the request path.
 *
 * Fields are listed as we write them in a query or read them from a response.
 * `.exact` suffixes are the caller's business, not the field's: the checker
 * knows text fields are only countable in their `.exact` form and treats that
 * as proof the field exists.
 */
export const OPENFDA_QUERIED_FIELDS = [
  // The join key to RxNorm, and the only field we search on today.
  "openfda.rxcui",
  // Read from every label result.
  "id",
  "set_id",
  "effective_time",
  "openfda.brand_name",
  "openfda.generic_name",
  "openfda.manufacturer_name",
  "openfda.product_ndc",
  "openfda.product_type",
  "openfda.route",
  "openfda.substance_name",
  "openfda.spl_id",
  "openfda.application_number",
  "indications_and_usage",
  "warnings",
  "dosage_and_administration",
  "adverse_reactions",
  "contraindications",
  "description",
] as const;
