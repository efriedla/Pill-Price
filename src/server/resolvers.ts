import "server-only";

import type { GraphQLContext } from "./context";
import { UpstreamUnavailableError } from "./http";
import { isLabelQueryableTty } from "./openfda-client";
import { searchDrugs } from "./rxnorm-client";
import { isGenericTty, selectAlternatives, type AlternativeKind } from "./tty";
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

/** ADR-010's `Unavailable`: we could not ask, or the answer never came. */
const unavailable = (reason: string, source: string) => ({
  reason,
  source,
  retryable: true,
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
     * Nullable, and **null is the typical case** — ~92% of packages have no
     * published price. Under a snapshot that is not a cache miss: the table is
     * complete, so null means "NADAC publishes nothing for this", full stop.
     */
    price: async (drug: DrugSource, _: unknown, ctx: GraphQLContext) => {
      if (!ctx.prices) return null;
      const ndcs = await ctx.loaders.ndcs.load(drug.rxcui);
      const priced = ndcs
        .map((ndc) => ctx.prices?.forNdc(ndc))
        .filter((p) => p != null);
      if (priced.length === 0) return null;
      // NADAC prices a product rather than a package, so these are usually all
      // identical (§3.3). Taking the lowest is still the honest reduction when
      // they are not.
      return priced.reduce((a, b) =>
        Number(a.pricePerUnit) <= Number(b.pricePerUnit) ? a : b,
      );
    },

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
    price: (
      pkg: { ndc: string },
      _: unknown,
      ctx: GraphQLContext,
    ) => ctx.prices?.forNdc(pkg.ndc) ?? null,
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
