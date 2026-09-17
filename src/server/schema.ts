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
    # without one becomes a **null Price** — the same absence as no NADAC
    # record at all — rather than a Price carrying a blank unit.
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
    price: Price
  }

  enum AlternativeKind {
    GENERIC
    BRAND
    ALL
  }

  type Label {
    openFDALabel: String
    # DECIDE: which of the 78 SPLs this is — Q2. Whatever the answer, this type
    # needs a field naming it, or the UI claims "the label" without grounds.
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

  type Drug {
    rxcui: ID!
    name: String!
    tty: String!
    isGeneric: Boolean!
    packages: [Package!]!
    price: Price
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
