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
 * price, alternatives and label all resolve. The one field with no resolver
 * behind it is `Drug.priceHistory`, and it is nullable for exactly that reason;
 * see the comment on the field. Nothing here invents a price: ADR-004 settles
 * this schema but deliberately leaves the data path downstream of it
 * (docs/upstream-notes.md §5 Q5), and a stub that invented one would read as a
 * working feature.
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

  type Drug {
    rxcui: ID!
    name: String!
    tty: String!
    isGeneric: Boolean!
    packages: [Package!]!
    price: Price
    # Nullable, and that was a correction rather than a preference. As a
    # non-null with no resolver behind it, selecting this field did not
    # degrade it — the non-null propagated up and drug itself came back null,
    # so one unimplemented field killed the whole page. Measured 2026-09-16:
    # "Cannot return null for non-nullable field Drug.priceHistory."
    #
    # Null here means the series could not be built, which today is always:
    # the snapshot stores one current price per NDC (~3 MB), and a series
    # needs full history (~102 MB). ADR-009 flags that retention shape as a
    # decision the sync job will force, and it is still open.
    #
    # This is a knowingly weaker answer than the rest of the schema gives.
    # ADR-010 states an absence rather than rendering nothing, and a bare null
    # cannot say whether history is missing because nothing was published or
    # because this side never stored it. The ADR-010-shaped answer is a
    # PriceSeriesResult union alongside LabelResult and AlternativesResult.
    # Null is the honest interim: it stops the field from taking the page down
    # without inventing a reason it does not have.
    #
    # (No backticks in this block: the SDL lives in a template literal, and a
    # backtick here ends the string. Every gate caught it, loudly.)
    priceHistory(range: PriceRange! = YEAR): PriceSeries
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
