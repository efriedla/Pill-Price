import "server-only";
import { makeExecutableSchema } from "@graphql-tools/schema";

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
 * Resolvers here are stubs. They return "no data" rather than plausible-looking
 * fixtures. ADR-004 settles this schema but deliberately leaves the data path
 * downstream of it (docs/upstream-notes.md §5 Q5), and a stub that invents a
 * price would read as a working feature.
 */

export const typeDefs = /* GraphQL */ `
  type Price {
    pricePerUnit: String! # String, not Float — ADR-004. NADAC ships "0.02902".
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
    priceHistory(range: PriceRange! = YEAR): PriceSeries!
    alternatives(kind: AlternativeKind): AlternativesResult! # DECIDE: which TTYs — Q7
    label: LabelResult!
  }

  type Query {
    drug(rxcui: ID!): Drug
    search(term: String!): [Drug!]! # DECIDE: typo tolerance — Q8
  }
`;

/**
 * Unions cannot be executed without a type discriminator, and ADR-010's two
 * degraded members are shared across every degradable field — so the rule that
 * recognises them is written once. Resolving on the presence of a
 * member-specific field rather than on a stored `__typename` keeps resolvers
 * free to return plain objects.
 *
 * `retryable` is checked before `reason` because `Unavailable` carries both.
 */
const resolveDegradable =
  (present: string) => (value: Record<string, unknown>) =>
    "retryable" in value
      ? "Unavailable"
      : "reason" in value
        ? "Absent"
        : present;

export const resolvers = {
  LabelResult: { __resolveType: resolveDegradable("Label") },
  AlternativesResult: { __resolveType: resolveDegradable("Alternatives") },

  Query: {
    // Null and empty are honest placeholders: the schema is settled ahead of
    // the data path, so "no drug yet" is the truthful answer until ADR-004
    // says where prices live.
    drug: () => null,
    search: () => [],
  },
};

export const schema = makeExecutableSchema({
  typeDefs,
  resolvers,
});
