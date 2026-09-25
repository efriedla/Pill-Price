import "server-only";
import { makeExecutableSchema } from "@graphql-tools/schema";

import { resolvers } from "./resolvers";

/**
 * The GraphQL schema is written as a document first, before any resolver —
 * see the W2 operating rule.
 *
 * Entry is deliberately narrow: everything hangs off `drug` and `search`, and
 * prices are reached by traversal (`drug.packages[].price`) rather than by a
 * flat root field per shape. That is what makes brand/generic comparison
 * expressible at all — a comparison is `drug -> alternatives -> priceHistory`,
 * which cannot be written when prices are only addressable from the root.
 *
 * Resolvers live in `./resolvers` and are real as of #36 — identity, packages,
 * price, alternatives and label all resolve. `Drug.priceHistory` resolves too,
 * but to a stated absence rather than to data: no store behind it can build a
 * series yet. See the comment on the field. Nothing here invents a price:
 * ADR-004 settles this schema but deliberately leaves the data path downstream
 * of it (docs/upstream-notes.md §5 Q5), and a stub that invented one would
 * read as a working feature.
 */

export const typeDefs = /* GraphQL */ `
  type Price {
    pricePerUnit: String! # String, not Float — ADR-004. NADAC ships "0.02902".
    # What one unit *is*, from NADAC's pricing_unit column: EA, ML or GM.
    #
    # Non-null, and measured rather than assumed (2026-09-16): 2500 rows
    # sampled across five offsets of the 1,118,109-row 2026 dataset carry one
    # of exactly those three values — no nulls, no "". The Zod boundary still
    # types the column absentable, because the *column* is; the guarantee here
    # is the resolver's to keep, not the upstream's to make.
    #
    # That guarantee is a real constraint on the resolver, not a formality:
    # ui-spec §9 says every price is rendered with its unit, so a figure whose
    # unit is unknown is not a price this app may state. A row that arrives
    # without one becomes **Absent** (see PriceResult), the same absence as no
    # NADAC record at all, rather than a Price carrying a blank unit.
    #
    # String! and not an enum, matching PriceSeries.unit. A closed enum would
    # turn a fourth value NADAC decides to ship into a hard response error on
    # a field the page needs, which is the opposite of how ADR-010 handles the
    # unexpected. The three known values are documented, not enforced here.
    unit: String!
    effectiveDate: String! # as published, e.g. "2026-03-18"
    asOf: String! # when this side ingested it
  }

  enum PriceRange {
    CURRENT
    QUARTER
    YEAR
    FIVE_YEAR
    MAX
  }
  enum Granularity {
    WEEKLY
    MONTHLY
    QUARTERLY
  }

  type PriceSeries {
    range: PriceRange!
    granularity: Granularity! # what the server actually returned
    unit: String! # constant across the series, or it isn't comparable
    points: [PricePoint!]!
    coverage: Coverage!
  }

  type PricePoint {
    periodStart: String!
    periodEnd: String!
    perUnit: String # null = nothing published in this period
    observations: Int! # how many raw prices were rolled up
  }

  # Of 401 NDCs RxNorm returns for one metformin concept, 34 carry a NADAC
  # price. Reporting the denominator is what lets the UI say "no published
  # price for 12 of 14 packages" instead of rendering an empty axis.
  type Coverage {
    pricedPackages: Int!
    totalPackages: Int!
  }

  type Package {
    ndc: ID!
    description: String!
    price: PriceResult! # see PriceResult: why a price says why it is missing
  }

  enum AlternativeKind {
    GENERIC
    BRAND
    ALL
  }

  # ADR-015, Option A. One document, chosen by a four-step chain. The page
  # always says which document it shows and why, so the type names both.
  type Label {
    setId: ID! # SPL set_id; the DailyMed link is built from it
    productName: String! # e.g. "Lipitor", or the generic name on step 4
    manufacturer: String!
    # A calendar date, ISO. openFDA ships "20240415"; it is reformatted by
    # slicing, never through Date, which moves it a day west of UTC.
    effectiveDate: String!
    chosenBy: LabelChoice!
    # In ui-spec 11 order, boxed warning first. A kind the label does not have
    # is left out, never sent empty.
    sections: [LabelSection!]!
  }

  # Which step of the chain chose the label. Closed, because only the server
  # produces it: a fifth value would be a new step, which is a new decision.
  # The sentence for each is the UI's, so the copy is not buried in a resolver.
  enum LabelChoice {
    OWN_LABEL # step 1: a brand drug's own label
    REFERENCE_IN_RESULTS # step 2: a generic's rows include the NDA/BLA label
    BRAND_VERSION # step 3: the label of the generic's brand twin
    # Step 4: the newest label from an original manufacturer. The ordinary
    # path for a generic whose brand has left the market (metformin ER), so
    # its copy must not read as a fault, and must not claim to be the label.
    ORIGINAL_PACKAGER
  }

  # Seven kinds, not ui-spec's original nine: inactive ingredients and storage
  # are over-the-counter fields (ui-spec 11, amended 2026-09-25). Adding one
  # back is non-breaking; removing one would not be.
  enum LabelSectionKind {
    BOXED_WARNING
    INDICATIONS_AND_USAGE
    DOSAGE_AND_ADMINISTRATION
    CONTRAINDICATIONS
    WARNINGS_AND_CAUTIONS # older labels call it warnings; both map here
    ADVERSE_REACTIONS
    DRUG_INTERACTIONS
  }

  type LabelSection {
    kind: LabelSectionKind!
    paragraphs: [String!]! # never empty; an empty section is left out
  }

  # ADR-010. A degradable field carries its own state as a union, so "the
  # section must say which of the two happened" is enforced by the type system
  # rather than by remembering. A nullable Label cannot distinguish "no label
  # exists", "openFDA is down" and "we did not ask" — all three are null.
  #
  # Absent and Unavailable are shared member types, reused by every
  # degradable field. GraphQL unions are not generic, so each field needs its
  # own union — but not its own absent type. Do not add LabelAbsent.

  # The source answered, and its answer was nothing. Settled: nothing is coming,
  # and the rest of the page is complete and correct.
  type Absent {
    # The finished, user-facing sentence, authored server-side so the copy lives
    # with the taxonomy that decided it — e.g. "openFDA has no label for this
    # drug". ADR-010 names the source deliberately: a reader who cannot see
    # which source came up empty cannot rule that source out.
    reason: String!
    source: String!
  }

  # We could not ask, or the answer never came. Temporary, and the only one of
  # the three that may be rendered as retryable — an Absent shown with a spinner
  # or a retry is a settled fact dressed as a pending one.
  type Unavailable {
    reason: String!
    source: String!
    retryable: Boolean!
  }

  union LabelResult = Label | Absent | Unavailable

  # Enrichment is always partial (ADR-010): the page renders with name, price
  # and label whether or not this call answered. A bare list cannot say which
  # happened — an empty array reads as "no alternatives exist" whether RxNorm
  # said so or was never reached, and those are different sentences to a reader.
  #
  # Absent here means RxNorm answered and found none, so this list is never
  # empty: an empty result is Absent, not Alternatives with no drugs.
  type Alternatives {
    drugs: [Drug!]!
  }

  union AlternativesResult = Alternatives | Absent | Unavailable

  # The third degradable field, and the only one whose absence is about this
  # side rather than an upstream. NADAC does publish history; we do not store
  # it — the snapshot holds one current price per NDC (~3 MB) where a series
  # needs ~102 MB, and ADR-009 leaves that retention shape open.
  #
  # So the interim answer is Unavailable with retryable: false, and the two
  # halves of that are both load-bearing. Absent would be a claim about NADAC
  # that is false. retryable: true would offer a retry that cannot succeed —
  # ADR-010 says an Absent dressed as pending is a settled fact with a
  # spinner on it, and this is the same error in the other direction.
  union PriceSeriesResult = PriceSeries | Absent | Unavailable

  # ADR-010 amendment, 2026-09-23. Price was a nullable Price, and null meant
  # two things: NADAC publishes no figure for this (the typical case, ~92% of
  # packages), and this side has no snapshot loaded. The snapshot is not in
  # the repo, so every CI build is the second case, and a prerendered page
  # would have stated the first as fact. Same silence priceHistory was
  # converted out of, on the one priced field it had not reached.
  #
  # Absent: the snapshot is loaded and complete, and this is not in it.
  # Unavailable, retryable false: no snapshot is loaded. A retry cannot load a
  # file that is not there. Both sentences are the author's.
  union PriceResult = Price | Absent | Unavailable

  # Q7's other half. The ingredient and the dose form are not alternatives —
  # "Oral Tablet" is not something you could be given instead of your pill —
  # but they are not nothing either: they are what the drug *is*.
  #
  # Deliberately not Drug. That is Q7's actual finding: an IN or DF rendered as
  # a Drug carries a permanently null price and a permanently absent label,
  # because neither NADAC nor openFDA has anything to say about "atorvastatin"
  # or "Oral Tablet". These types promise only what RxNorm knows.
  type Ingredient {
    rxcui: ID!
    name: String! # e.g. "atorvastatin"
  }

  type DoseForm {
    rxcui: ID!
    name: String! # e.g. "Oral Tablet"
  }

  # A list, not a single value: a combination product has several ingredients
  # (amlodipine / benazepril returns two IN concepts). One is the common case,
  # not the guaranteed one.
  #
  # Absent means RxNorm answered and named none, so this list is never empty —
  # the same rule as Alternatives, for the same reason.
  type Ingredients {
    ingredients: [Ingredient!]!
  }

  union IngredientsResult = Ingredients | Absent | Unavailable
  union DoseFormResult = DoseForm | Absent | Unavailable

  type Drug {
    rxcui: ID!
    name: String!
    tty: String!
    isGeneric: Boolean!
    packages: [Package!]!
    price: PriceResult! # the cheapest package's; see PriceResult
    # Non-null again, but for the opposite reason it was non-null before.
    # As PriceSeries! with no resolver it took the page down: the non-null
    # propagated up and drug itself came back null (measured 2026-09-16,
    # "Cannot return null for non-nullable field Drug.priceHistory"). It was
    # made nullable to stop that, and null was always the honest interim
    # rather than the destination — a bare null cannot say whether history is
    # missing because nothing was published or because this side never stored
    # it, and ADR-010 exists to rule out exactly that silence.
    #
    # PriceSeriesResult! is safe where PriceSeries! was not: the union always
    # has a member to return, so the field can promise a value without
    # promising a series. The absence is now stated, in the same shape as
    # label and alternatives.
    #
    # It resolves to Unavailable until ADR-009's retention decision lands.
    # When it does resolve to a series, the series always carries coverage,
    # and its points may be empty.
    #
    # (No backticks in this block: the SDL lives in a template literal, and a
    # backtick here ends the string. Every gate caught it, loudly.)
    priceHistory(range: PriceRange! = YEAR): PriceSeriesResult!
    alternatives(kind: AlternativeKind): AlternativesResult! # Q7 closed: SCD, SBD, GPCK, BPCK — see src/server/tty.ts
    # Identity, but fetched from the same allrelated.json call as alternatives,
    # so it degrades the same way — ADR-010 rule 3: enrichment is always
    # partial. Both read ctx.loaders.related, so the three fields cost one
    # request between them, not three.
    #
    # The name already contains the ingredient ("atorvastatin 10 MG Oral
    # Tablet"), so a reader loses nothing they cannot see when RxNorm is down.
    # That is what makes degrading acceptable for a field called identity.
    ingredients: IngredientsResult!
    # Absent is the ordinary case for a pack, not a gap: a GPCK or BPCK is a
    # box of several products and has no single dose form. The copy says so.
    doseForm: DoseFormResult!
    label: LabelResult!
  }

  type Query {
    drug(rxcui: ID!): Drug
    search(term: String!): [Drug!]! # DECIDE: typo tolerance — Q8
  }
`;

export const schema = makeExecutableSchema({
  typeDefs,
  resolvers,
});
