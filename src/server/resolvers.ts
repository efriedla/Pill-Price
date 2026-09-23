import "server-only";

import { formatIsoDate, utcCalendarDate } from "@/lib/calendar-date";

import type { GraphQLContext } from "./context";
import { UpstreamUnavailableError } from "./http";
import { compareDecimal } from "./nadac/snapshot";
import { isLabelQueryableTty } from "./openfda-client";
import { searchDrugs } from "./rxnorm-client";
import {
  isGenericTty,
  selectAlternatives,
  selectDoseForm,
  selectIngredients,
  type AlternativeKind,
} from "./tty";
import type { ConceptProperties } from "./upstream/rxnorm.schema";

/**
 * The resolver map. `schema.ts` owns the SDL and imports this to execute it.
 *
 * Two rules run through everything here:
 *
 *   **An absence is always stated, never rendered as nothing** (ADR-010). Every
 *   degradable field returns a union member that says which of the three things
 *   happened, and the copy is authored server-side so it lives with the
 *   taxonomy that decided it.
 *
 *   **Identity is fatal, enrichment is partial.** If we cannot establish which
 *   drug this is, there is no page to render. If we cannot enrich it, the page
 *   renders and says what is missing.
 */

/** A resolved RxNorm concept, carried down to the Drug field resolvers. */
type DrugSource = ConceptProperties;

/**
 * ADR-010's `Absent`: the source answered, and its answer was nothing.
 *
 * `source` is named to the user deliberately — "openFDA has no label for this
 * drug", not "no label available". A reader who cannot see which source came up
 * empty cannot rule that source out.
 */
const absent = (reason: string, source: string) => ({ reason, source });

/**
 * ADR-010's `Unavailable`: we could not ask, or the answer never came.
 *
 * `retryable` defaults to true because that is what a transport failure is —
 * but it is a parameter, not a constant. `priceHistory` is the case that needs
 * the other value: we cannot ask, and no number of retries changes that until
 * the store exists. Offering a retry that cannot succeed is the same error as
 * showing an `Absent` with a spinner on it, in the other direction.
 */
const unavailable = (reason: string, source: string, retryable = true) => ({
  reason,
  source,
  retryable,
});

/**
 * Map a thrown transport error onto the degraded member, or rethrow.
 *
 * Only `UpstreamUnavailableError` becomes `Unavailable`. A parse failure
 * (`malformed`) and a request we built wrong (`UpstreamRequestError`) both
 * propagate: ADR-010 says they are loud and never read as absent, and a bug in
 * our query must not reach the user dressed as a fact about their drug.
 */
function degrade(error: unknown, source: string, sentence: string) {
  if (error instanceof UpstreamUnavailableError) {
    return unavailable(sentence, source);
  }
  throw error;
}

/**
 * The two price absences, in the author's words (ADR-010 amendment,
 * 2026-09-23). Written once, because `Drug.price` and `Package.price` must
 * never disagree about what "no price" means.
 *
 * `{date}` is the snapshot's `asOf`: the last time this side read NADAC's
 * table, which is what "as of" claims. It is an instant, so it is reduced to
 * its UTC calendar day by slicing, never through `Date`.
 */
function priceNotPublished(asOf: string, what: "drug" | "package") {
  const date = formatIsoDate(utcCalendarDate(asOf));
  return absent(
    `NADAC doesn't publish an acquisition cost for this ${what} (as of ${date}).`,
    "NADAC",
  );
}

/**
 * No snapshot is loaded. `retryable: false` because a retry cannot load a file
 * that is not there, the same call `priceHistory` makes.
 */
const PRICES_NOT_LOADED = unavailable(
  "We couldn't load price data. This is on our side, not NADAC's. Everything else on this page is current.",
  "NADAC",
  false,
);

export const resolvers = {
  /**
   * Unions cannot be executed without a type discriminator, and ADR-010's two
   * degraded members are shared across every degradable field — so the rule
   * that recognises them is written once. Resolving on the presence of a
   * member-specific field rather than on a stored `__typename` keeps resolvers
   * free to return plain objects.
   *
   * `retryable` is checked before `reason` because `Unavailable` carries both.
   * Testing `reason` first resolves every `Unavailable` as `Absent` — a
   * retryable outage rendered as a settled fact with its retry affordance
   * stripped. Nothing in the type system enforces the order.
   */
  LabelResult: { __resolveType: resolveDegradable("Label") },
  AlternativesResult: { __resolveType: resolveDegradable("Alternatives") },
  PriceSeriesResult: { __resolveType: resolveDegradable("PriceSeries") },
  PriceResult: { __resolveType: resolveDegradable("Price") },
  IngredientsResult: { __resolveType: resolveDegradable("Ingredients") },
  DoseFormResult: { __resolveType: resolveDegradable("DoseForm") },

  Query: {
    /**
     * `null` is not-found, not an error (ADR-010). RxNorm says "no such drug"
     * with **HTTP 200 and `{}`**, which the parser asserts rather than letting
     * `{}` pass as a drug. Whether that renders as `notFound()` or as an
     * in-page state is deferred to ADR-001.
     *
     * A transport failure is *not* caught here: identity is fatal, so it
     * propagates as a GraphQL error rather than becoming a silent null.
     */
    drug: (
      _: unknown,
      { rxcui }: { rxcui: string },
      ctx: GraphQLContext,
    ): Promise<DrugSource | null> => ctx.loaders.properties.load(rxcui),

    /** An empty list is the empty state, never an error (upstream-notes §1.1). */
    search: (
      _: unknown,
      { term }: { term: string },
    ): Promise<ConceptProperties[]> => searchDrugs(term),
  },

  Drug: {
    /**
     * Derived from the TTY, never fetched — Q7, and the mapping lives in
     * `tty.ts` rather than inline here, because `alternatives` needs the same
     * answer and two copies would drift.
     */
    isGeneric: (drug: DrugSource) => isGenericTty(drug.tty),

    /**
     * The fan-out: one metformin ER 500 MG SCD returns **401 NDCs**. Each
     * carries its own price, looked up locally against the snapshot.
     */
    packages: async (drug: DrugSource, _: unknown, ctx: GraphQLContext) => {
      const ndcs = await ctx.loaders.ndcs.load(drug.rxcui);
      return ndcs.map((ndc) => ({ ndc, description: drug.name }));
    },

    /**
     * The drug's own price: the cheapest published across its packages.
     *
     * **`Absent` is the typical case**: ~92% of packages have no published
     * price. Under a loaded snapshot that is not a cache miss. The table is
     * complete, so "not in it" means NADAC publishes nothing for this.
     *
     * **No snapshot is a different sentence.** It used to be the same `null`,
     * which made a CI build (no snapshot) state "not published" as fact.
     */
    price: async (drug: DrugSource, _: unknown, ctx: GraphQLContext) => {
      const prices = ctx.prices;
      if (!prices) return PRICES_NOT_LOADED;
      const ndcs = await ctx.loaders.ndcs.load(drug.rxcui);
      const priced = ndcs
        .map((ndc) => prices.forNdc(ndc))
        .filter((p) => p != null);
      if (priced.length === 0) return priceNotPublished(prices.asOf, "drug");
      // NADAC prices a product rather than a package, so these are usually all
      // identical (§3.3). Taking the lowest is still the honest reduction when
      // they are not — and "usually" is doing less work than that comment
      // implies: of 3,836 descriptions covering more than one NDC, 1,206
      // (31.4%) have packages that disagree, at a median spread of 9.9%
      // (measured, ADR-014). So this reduction decides a visible number.
      //
      // Compared with `compareDecimal`, on the digits. This was the one live
      // `Number()` on a price in the codebase: comparison-only, so nothing
      // rounded and no figure was ever wrong — but ADR-004 makes money a
      // decimal string precisely so that a float never touches it, and a rule
      // with one exception in it is a rule someone will copy the exception
      // from. The lint rule does not catch this shape.
      return priced.reduce((a, b) =>
        compareDecimal(a.pricePerUnit, b.pricePerUnit) <= 0 ? a : b,
      );
    },

    /**
     * The price series — which this side cannot build, and says so.
     *
     * This is the one degradable field whose absence is not about an upstream.
     * NADAC publishes the history; the snapshot does not keep it. It holds one
     * current price per NDC (~3 MB) where a series needs the full ~102 MB, and
     * ADR-009 flags that retention shape as a decision the sync job forces.
     * Until it lands there is nothing to query, so the honest answer is that
     * we could not ask — not that NADAC came up empty, which would be a claim
     * about NADAC that is false.
     *
     * `retryable: false` for the same reason: a retry cannot succeed against a
     * store that does not exist. `range` is accepted and ignored, because the
     * argument is part of the settled contract (ADR-004) and a series that
     * echoes what it was asked is the shape this returns once it resolves.
     *
     * No stub series, deliberately. Invented points would render as a working
     * chart, which is the failure ADR-010 and the schema header both rule out.
     */
    priceHistory: () =>
      unavailable(
        "We do not store price history for this drug yet.",
        "NADAC",
        false,
      ),

    /**
     * Q7's answer applied: the four dispensable product concepts, with the
     * queried drug dropped from its own list.
     *
     * Enrichment, so it is partial — a dead RxNorm here costs the alternatives
     * section, not the page. `Absent` and `Unavailable` get different copy
     * because they are different facts.
     */
    alternatives: async (
      drug: DrugSource,
      { kind }: { kind?: AlternativeKind | null },
      ctx: GraphQLContext,
    ) => {
      try {
        const groups = await ctx.loaders.related.load(drug.rxcui);
        const concepts = selectAlternatives(
          groups,
          kind ?? "ALL",
          drug.rxcui,
        );
        // Never an empty Alternatives: an empty list and "RxNorm found none"
        // are two encodings of the same thing, and a client would render one of
        // them as nothing. ADR-010 forbids exactly that.
        return concepts.length > 0
          ? { drugs: concepts }
          : absent(
              "RxNorm lists no other products for this drug.",
              "RxNorm",
            );
      } catch (error) {
        return degrade(
          error,
          "RxNorm",
          "We could not reach RxNorm for alternatives to this drug.",
        );
      }
    },

    /**
     * Q7's other half: the ingredients, from the same related-concept call
     * `alternatives` reads. Sharing `ctx.loaders.related` is what keeps the two
     * identity fields free — one request answers all three.
     *
     * Plural on purpose. A combination product returns several IN concepts, and
     * a singular field would drop half of such a drug's identity silently.
     *
     * Never an empty Ingredients, for the reason `alternatives` is never an
     * empty Alternatives: an empty list and "RxNorm named none" are two
     * encodings of one fact, and a client renders the first as nothing.
     */
    ingredients: async (drug: DrugSource, _: unknown, ctx: GraphQLContext) => {
      try {
        const groups = await ctx.loaders.related.load(drug.rxcui);
        const concepts = selectIngredients(groups);
        return concepts.length > 0
          ? { ingredients: concepts }
          : absent("RxNorm names no ingredient for this drug.", "RxNorm");
      } catch (error) {
        return degrade(
          error,
          "RxNorm",
          "We could not reach RxNorm for this drug's ingredients.",
        );
      }
    },

    /**
     * The dose form, or a stated absence.
     *
     * **A pack reaching `Absent` here is the ordinary path, not a failure.** A
     * GPCK or BPCK is a box of several products — a contraceptive cycle, a
     * steroid taper — and has no single dose form to name. The sentence says
     * that rather than leaving a reader to read a blank as an outage, which is
     * the whole of ADR-010 in one field.
     */
    doseForm: async (drug: DrugSource, _: unknown, ctx: GraphQLContext) => {
      try {
        const groups = await ctx.loaders.related.load(drug.rxcui);
        return (
          selectDoseForm(groups) ??
          absent("RxNorm names no dose form for this drug.", "RxNorm")
        );
      } catch (error) {
        return degrade(
          error,
          "RxNorm",
          "We could not reach RxNorm for this drug's dose form.",
        );
      }
    },

    /**
     * The label.
     *
     * The TTY guard runs *before* the request (ADR-010): openFDA's 404 is
     * byte-identical for "no label" and "wrong kind of thing", so a non-product
     * TTY is answered here rather than asked about — asking would produce a 404
     * we would have no right to read as absent.
     *
     * **Q2 is deferred, and this is where it bites.** openFDA returns up to 91
     * SPLs from 55 labelers for one drug, and which of them `Label` names is
     * unanswered — so `openFDALabel` stays null rather than picking one
     * arbitrarily. Reporting that a label *exists* is honest; claiming to have
     * "the" label would not be.
     */
    label: async (drug: DrugSource, _: unknown, ctx: GraphQLContext) => {
      if (!isLabelQueryableTty(drug.tty)) {
        return absent(
          `openFDA does not publish labels for ${drug.tty} concepts.`,
          "openFDA",
        );
      }
      try {
        const outcome = await ctx.loaders.label.load({
          rxcui: drug.rxcui,
          tty: drug.tty,
        });
        if (outcome === null || outcome.kind === "notFound") {
          return absent("openFDA has no label for this drug.", "openFDA");
        }
        return { openFDALabel: null };
      } catch (error) {
        return degrade(
          error,
          "openFDA",
          "We could not reach openFDA for this drug's label.",
        );
      }
    },
  },

  Package: {
    /** The same three states as `Drug.price`, from the same two helpers. */
    price: (pkg: { ndc: string }, _: unknown, ctx: GraphQLContext) => {
      const prices = ctx.prices;
      if (!prices) return PRICES_NOT_LOADED;
      return prices.forNdc(pkg.ndc) ?? priceNotPublished(prices.asOf, "package");
    },
  },
};

function resolveDegradable(present: string) {
  return (value: Record<string, unknown>) =>
    "retryable" in value
      ? "Unavailable"
      : "reason" in value
        ? "Absent"
        : present;
}
