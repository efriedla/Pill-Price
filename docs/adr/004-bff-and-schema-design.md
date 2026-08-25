# ADR-004: BFF and schema design

**Status:** accepted
**Date:** 2026-08-25

## Context

The GraphQL schema is written as a document before any resolver — that is the W2
operating rule, and it is the rule that makes this ADR possible at all. A schema
authored after its resolvers records how the data happened to arrive. A schema
authored first has to state what the product claims, and then the data path is
judged against it.

`docs/upstream-notes.md` measured the three upstreams on 2026-08-23, and two
findings dominate every decision below.

**The pricing path cannot be a per-request upstream call.** A sequential cold
drug-detail fetch is ≈5977 ms against a 200 ms p95 target. Parallelising does not
close it: NADAC alone is 2.7 s, and it is 2.7 s *for a miss as well as a hit*
(§3.2) — the latency is independent of result size, which reads as an unindexed
scan over 998,332 rows.

**Most packages have no published price.** Of the 401 NDCs RxNorm returns for one
metformin ER 500 MG concept, 34 appear in NADAC 2026 — about 8% (§3.3). All 34
carry identical prices on identical dates, because NADAC prices a product rather
than a package, so a 401-way fan-out collapses to a single series. The 92% is not
an error state, a loading state, or an edge case. It is the typical case, and a
schema that can only express a price or an exception cannot express it.

That second finding is the one that decides the shape. The roadmap's disclaimer
assumed the honest statement was "this is pharmacy acquisition cost, not what you
pay." The measurement says the honest statement is also "most packages of this
drug have no published price at all," and that sentence has to be derivable from
a query response or the UI is inventing it.

This ADR settles the schema. It does not settle the data path — where prices are
cached and what produces the cached view is the resolver and caching work, and it
is deliberately downstream of a fixed contract. What this ADR owes that work is a
schema that does not have to change when the answer arrives.

## Options considered

### Option A — Traversal-first: `drug` and `search` roots, prices reached by path

Two root fields. Everything else hangs off `Drug`: `drug.packages[].price`,
`drug.priceHistory(range:)`, `drug.alternatives(kind:)`, `drug.label`.

- **For:** brand/generic comparison is expressible as a single query —
  `drug -> alternatives -> priceHistory` — which is the W4 feature's entire shape.
  The join keys stay server-side: RxNorm↔NADAC joins on NDC, RxNorm↔openFDA on
  `openfda.rxcui`, and NADAC↔openFDA have no direct join at all (§4). A client
  that never names an NDC cannot be broken by that asymmetry.
- **Against:** the resolver tree is where the fan-out lives, so batching is
  mandatory rather than optional — 401 NDCs behind one `packages` field is a
  DataLoader problem on day one. Response shape is also less predictable for
  caching than a flat field would be.

### Option B — Flat root fields per shape

`prices(ndcs: [ID!]!)`, `priceHistory(ndc: ID!)`, `drug(rxcui:)` as a thin
metadata lookup.

- **For:** each root field maps to one upstream call, which makes per-field cache
  TTLs obvious and makes the 2.7 s NADAC path trivially separable from the fast
  RxNorm path. Easiest thing to cache correctly.
- **Against:** it pushes the join into the client. To compare a brand against its
  generic the client must fetch alternatives, extract NDCs, and issue a second
  round trip — and it must know that NADAC prices a product rather than a package
  in order to collapse 401 NDCs into one series. That is upstream trivia, and
  putting it in a browser is how the BFF stops being a BFF. It also makes the
  coverage denominator unrepresentable: a flat `prices(ndcs:)` returns the rows it
  found and cannot say how many it looked for.

### Option C — One denormalised `drugDetail(rxcui:)` returning everything

- **For:** one round trip, one cache entry, one TTL, and the p95 target met by
  construction. Nothing to batch because nothing fans out.
- **Against:** the slowest upstream sets the latency of every field. openFDA
  labels are 118 KB for a single result and support no field projection (§2.3), so
  a page rendering only a price pays for prose it never shows. It also forecloses
  W4: `alternatives` returning full detail per alternative is a combinatorial
  payload, and returning less makes it a different type from `Drug`.

### Option D — REST route handlers instead of GraphQL

- **For:** no schema to maintain, no resolver layer, HTTP caching for free.
- **Against:** discards the decision the project was built to make. The BFF exists
  because three upstreams with no shared identifier have to be composed somewhere,
  and a per-view REST endpoint is that composition without a contract. Not
  seriously entertained; recorded because "why GraphQL" is the first interview
  question and the answer should be written down.

## Decision

**Adopt the traversal-first schema (Option A): `drug` and `search` are the only
root fields, and every price is reached by traversal from a `Drug`.**

```graphql
type Query {
  drug(rxcui: ID!): Drug
  search(term: String!): [Drug!]!
}
```

Entry is deliberately narrow. There is no root field returning a price, and that
is load-bearing rather than tidy: a comparison is `drug -> alternatives ->
priceHistory`, which cannot be written when prices are only addressable from the
root. Narrow entry also bounds the resolver surface that has to be batched,
cached, and degraded — a field that does not exist needs none of the three.

### The decisions the SDL actually freezes

**1. Money is `String!`, not `Float`.**

NADAC ships `"nadac_per_unit": "0.02902"` — a string, and quoted deliberately
(§3.4). The per-unit spread across the entire metformin result set is
0.02902–0.02982, under a third of a cent. Binary floating point cannot represent
those values exactly, and `/compare`'s whole purpose is putting them in adjacent
columns where a rounding artefact reads as a real price difference. Parsing a
decimal into a float to serve it back as a decimal is a lossy round trip in
service of nothing: no arithmetic happens between ingest and render.

A custom `Decimal` scalar was the near miss. It documents intent better than
`String` and would validate the format at the boundary. It was rejected for W2
because a custom scalar is a codegen concern in every consumer and buys type
safety over a value that is never computed on. If server-side arithmetic ever
appears — a median, a percentage change — that is the signal to revisit.

**2. `Coverage` is a first-class type, and the denominator is required.**

```graphql
type Coverage {
  pricedPackages: Int!
  totalPackages: Int!
}
```

This is the direct schema consequence of 34-of-401. Reporting the denominator is
what lets the UI say "no published price for 12 of 14 packages" instead of
rendering an empty axis and letting the user infer the drug is free, unavailable,
or broken. Omitting `Coverage` was a real option — the short array is already
there to be counted — and it was rejected because a client counting rows knows
how many it *received*, never how many existed. Absence has to be transmitted; it
cannot be reconstructed.

**3. `PricePoint.perUnit` is nullable and `observations` is required.**

```graphql
type PricePoint {
  periodStart: String!
  periodEnd: String!
  perUnit: String            # null = nothing published in this period
  observations: Int!         # how many raw prices were rolled up
}
```

A null point means the period was covered and nothing was published — which a
chart must render as a gap rather than a zero or an interpolation. `observations`
carries the rollup honestly: NADAC returns duplicate `(ndc, effective_date,
nadac_per_unit)` tuples that must be deduplicated before charting (§3.4), and a
point built from 34 identical rows is not stronger evidence than a point built
from one. Both fields exist so the UI can distinguish "flat" from "unknown."

**4. `PriceSeries.granularity` and `unit` are returned, not merely requested.**

`priceHistory(range: PriceRange! = YEAR)` takes a range; the response states the
granularity the server actually used. The server is permitted to downgrade — a
five-year request served monthly rather than weekly — and the client is told,
rather than silently receiving fewer points than it asked for. `unit` is constant
across a series by construction: a series whose unit changes partway is not
comparable, and the schema should not offer a shape that implies it is.

**5. Stub resolvers return `null` and `[]`, not fixtures.**

`drug: () => null`, `search: () => []`. The schema is settled ahead of the data
path on purpose, so "no drug yet" is the truthful answer until the price source
is decided. A stub returning a plausible price would render as a working feature
in Storybook and in review, and the first person to discover otherwise would be
whoever trusted it. Empty is legible; invented is not.

### Choices this ADR also ratifies

Made in the SDL, not dictated by the roadmap, and adopted here so they are
decided rather than inherited.

1. **Dates are `String!` in ISO-8601, not a `Date` scalar.** NADAC publishes
   `effective_date` as `"2026-03-18"` and the UI renders a date, never computes
   one. Same reasoning as money, with less at stake.
2. **`Price` carries both `effectiveDate` and `asOf`.** `effectiveDate` is
   upstream's publication date; `asOf` is when this side ingested it. Given that
   prices will be served from cache rather than fetched per request, one date
   cannot honestly answer "how old is this." Two can, and the disclaimer needs
   both.
3. **`search` returns `[Drug!]!`, not a connection.** RxNorm's `drugs.json`
   returns a whole concept group with no paging affordance, so a cursor would be
   a fiction the server invents. Revisit when a result set is large enough to
   need one.
4. **`AlternativeKind` is an enum (`GENERIC | BRAND | ALL`), not a TTY string.**
   The 19 RxNorm term types are upstream vocabulary; leaking them into the
   contract makes every client learn RxNorm. The enum is the product's language
   and the mapping stays server-side.
5. **`Label` is its own type rather than fields on `Drug`.** It exists so that
   whichever SPL is chosen can be named in a field alongside the text — see the
   open question below. Flattening it into `Drug` would leave nowhere to put the
   provenance.
6. **The schema is hand-written SDL executed via `makeExecutableSchema`**, not
   built with a code-first builder. Schema-first is the operating rule, and the
   artefact of that rule is a document a human wrote and can read in a PR diff.

### Where this leaves the data path

The schema is designed so that answering "where do prices come from" changes
resolvers and not the contract. Two constraints are already fixed by it: prices
are served from a cached view rather than a per-request NADAC call (2.7 s floor,
hit or miss), and the 92% with no published price is a first-class response
through `Coverage` and a nullable `perUnit` rather than an error. What produces
that cached view, and its TTL relative to NADAC's yearly-UUID resolution step
(§3.1), is the next decision and does not reopen this one.

## Consequences

**Easier.** The W4 comparison is one query against a contract that already
exists, rather than a client-side join over upstream trivia. The disclaimer has
an evidentiary basis that ships in the response instead of living in prose. The
resolver work starts against a frozen target, which is the entire point of
writing the document first.

**Harder.** Batching is now mandatory, not an optimisation — 401 NDCs behind one
`packages` field means DataLoader exists in W2 or the app does not work. Every
new field has to justify why it is not reachable by traversal from `Drug`, and
that will feel obstructive the first time a one-off root field would be quicker.
Money as `String` means any future arithmetic needs a deliberate parse at a named
boundary rather than an implicit one.

**Committed to.** Narrow entry: `drug` and `search` stay the only root fields.
Coverage denominators travelling with every price series. And to the SDL as the
reviewed artefact — a schema change that lands without a diff a reviewer read is
the failure mode this operating rule exists to prevent.

**Accepted risk.** `String` money is weaker typing than the domain deserves, and
nothing in the schema stops a client from doing float arithmetic on it. That is a
real hole; it is accepted because the alternative costs codegen complexity in W2
to protect an operation nothing currently performs.

## Still open, deliberately

Marked `DECIDE:` in the SDL and carried from upstream-notes §5. Each is a
resolver or product decision that the schema is shaped to absorb, not a gap in
this ADR.

- **Which of 78 SPLs `Label` refers to** (Q2). `openfda.rxcui:"860975"` reports
  `meta.results.total: 78` — one per manufacturer, repackager, and revision.
  First, newest by `effective_time`, or a merge is a content decision. Whatever
  it is, `Label` needs a field naming it, or the UI claims "the label" without
  grounds.
- **Which TTYs count as a generic alternative** (Q7) across 19 term types. The
  enum defers this; it does not answer it.
- **Whether search tolerates typos** (Q8). RxNorm's approximate matcher returns
  *merbromin* for "metfromin" with metformin nowhere in the top 10 (§1.5), so
  this is build-or-drop, not configuration.
- **Whether an openFDA 404 is partial or fatal** (Q3). A malformed query and a
  legitimately label-less drug are byte-identical responses (§2.1). Nullable
  `label` lets the schema express either; the error taxonomy has to choose.
- **Whether openFDA batches by `OR`** (Q4). It can return zero rows for one of
  its keys while reporting success (§2.4) — a resolver-level correctness
  question the contract does not touch.

## Revisit if

- **Server-side arithmetic on prices appears** — a median, a spread, a percentage
  change. That is the signal `String` money has stopped paying for itself and a
  `Decimal` scalar or integer minor units is now the right cost.
- **A client needs a price without a `Drug`** — a bare NDC lookup, a bulk export,
  an alerting job. Narrow entry is the thing under pressure, and adding a root
  field is a contract decision rather than a convenience.
- **`Coverage` is ever rendered as a bare percentage.** Collapsing 34-of-401 into
  "8%" discards the denominator that made it honest, and would mean the type is
  being used against its purpose.
- **A second consumer of the schema appears.** Every ratified choice above traded
  strictness for the fact that this schema currently has exactly one client, and
  those trades should be re-priced when that stops being true.
