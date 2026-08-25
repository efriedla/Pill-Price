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
    pricePerUnit: String!   # String, not Float — ADR-004. NADAC ships "0.02902".
    effectiveDate: String!  # as published, e.g. "2026-03-18"
    asOf: String!           # when this side ingested it
  }

  enum PriceRange { CURRENT QUARTER YEAR FIVE_YEAR MAX }
  enum Granularity { WEEKLY MONTHLY QUARTERLY }

  type PriceSeries {
    range: PriceRange!
    granularity: Granularity!   # what the server actually returned
    unit: String!               # constant across the series, or it isn't comparable
    points: [PricePoint!]!
    coverage: Coverage!
  }

  type PricePoint {
    periodStart: String!
    periodEnd: String!
    perUnit: String            # null = nothing published in this period
    observations: Int!         # how many raw prices were rolled up
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

  enum AlternativeKind { GENERIC BRAND ALL }

  type Label {
    openFDALabel: String
    # DECIDE: which of the 78 SPLs this is — Q2. Whatever the answer, this type
    # needs a field naming it, or the UI claims "the label" without grounds.
  }

  type Drug {
    rxcui: ID!
    name: String!
    tty: String!
    isGeneric: Boolean!
    packages: [Package!]!
    price: Price
    priceHistory(range: PriceRange! = YEAR): PriceSeries!
    alternatives(kind: AlternativeKind): [Drug!]!   # DECIDE: which TTYs — Q7
    label: Label
  }

  type Query {
    drug(rxcui: ID!): Drug
    search(term: String!): [Drug!]!   # DECIDE: typo tolerance — Q8
  }
`;

export const resolvers = {
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
