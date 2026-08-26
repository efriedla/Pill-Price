# ADR-009: Does NADAC belong on the request path?

**Status:** proposed
**Date:** 2026-08-26

<!-- SKELETON — Context and Options are drafted from the measurements in
     docs/upstream-notes.md §3. The Decision, Consequences, and Revisit-if
     sections are deliberately blank: this is Q5, a focused-hours decision
     (roadmap W2), and it is the author's to make. Delete this comment when
     the decision lands. -->

<!-- Numbering: this ADR is dated before ADR-005..008, which are reserved by
     docs/adr/README.md for later weeks and are already cross-referenced from
     ADR-001 and the roadmap. It takes the next free number rather than
     renumbering links in an accepted ADR. -->

## Context

ADR-004 fixed the schema and said, in as many words, that it does not settle the
data path: *"where prices are cached and what produces the cached view is the
resolver and caching work, and it is deliberately downstream of a fixed
contract."* This ADR is that work's authorizing decision. It is upstream question
Q5 (`docs/upstream-notes.md` §5), and it is the last thing blocking resolvers.

Three measurements from 2026-08-23 constrain it.

**NADAC costs ~2.7 s for a miss as well as a hit** (§3.2). `ndc = <real>` is
2.73 s; `ndc = <nonexistent>` is 2.72 s; a 401-value `IN` by POST is 2.68 s.
Latency is independent of result size, which reads as an unindexed scan over
998,332 rows. Two consequences follow that a normal slow-upstream intuition gets
wrong: a timeout budget cannot be tuned to distinguish "slow" from "absent," and
batching buys almost everything — 401 NDCs in one POST cost the same as one.

**Coverage is ~8%** (§3.3). Of 401 NDCs for one metformin ER 500 MG concept, 34
appear in NADAC 2026, and all 34 carry identical prices on identical dates,
because NADAC prices a product rather than a package. The 92% is the typical
case, not an error state. Whatever this ADR decides, the common outcome of a
price lookup is *no price*, and paying 2.7 s of request latency to learn that is
the specific thing under judgement.

**"Current prices" is a resolution step, not a URL** (§3.1, and Q1). The dataset
is republished yearly under a new UUID, discoverable only through a 1.1 MB
metastore index of 549 datasets filtered client-side on the literal title
`NADAC (National Average Drug Acquisition Cost) <year>` — a string-matching
contract on a field nobody promised to keep stable. Any option below inherits
this lookup and has to say what its TTL is *relative to* the price data's, since
a stale UUID silently serves last year's prices from 2027-01-01 rather than
failing.

The budget this is measured against is the W2 definition of done: **p95 BFF
response for a cached drug < 200 ms**. 2.7 s is not close, so the real question
is not "is NADAC fast enough" but **what is allowed to be on the critical path,
and what does a user see for the 92%** — which the schema can already express
(`PricePoint` nullable, `Coverage` first-class, carrying the denominator).

## Measurements (2026-08-26)

Taken to settle three things the options turned on. All against
`data.medicaid.gov`; commands are in `docs/upstream-notes.md` §6's style and
should be folded there when this ADR lands.

**1. The distribution UUID rotates on republish, not yearly — and it already
has.** `upstream-notes.md` §3.1 records the 2026 distribution as
`b391aa55-d8f1-5894-be06-ea28d64a4186`, captured 2026-08-23. That ID now returns
**HTTP 400**. The live 2026 distribution is
`16fd6484-2a77-56b4-bf18-4a7d70fb7924`, and the dataset's `modified` is
2026-08-25. The ID changed **in three days**, not twelve months. §3.1's framing
("hard-coding the 2026 UUID means the app silently serves stale prices from
2027-01-01") is too generous: hard-coding breaks within a week, and it breaks
*loudly* with a 400 rather than silently. Every option below must resolve the ID
at runtime, and its TTL is measured in hours, not months.

**2. Resolving it is cheap.** The metastore index is 775 KB plain and 1.16 MB
with `?show-reference-ids=true` — which is required, since the plain response
omits `distribution[].identifier` entirely. Five runs: 0.15–0.35 s total,
TTFB 0.08–0.18 s. This is not a cost centre. It can be fetched per-hour, or even
per-request, without threatening the 200 ms budget on its own.

**3. A real "changed since" filter exists.** The `>=` operator works on both
`effective_date` and `as_of_date`. `effective_date >= 2026-08-01` returns
**58,621** rows of **1,028,250** total (row count is up from §3.3's 998,332).
An incremental sync is therefore ~6% of the table per month, not a full re-pull.

**4. The 2.7 s floor is a *filter* cost, not a table cost.** Unfiltered paging is
fast, and `limit` goes to at least **5000** (§3.4 recorded 500 as the page size;
it is not the cap): 5000 rows in 0.68 s at offset 0, 0.99 s at offset 100,000,
1.85 s at offset 1,000,000. Deep offsets work. A **full sequential sync is ~206
requests at roughly 0.7–1.9 s each — on the order of 2–4 minutes**, single-
threaded, no filter ever issued. Filtered queries remain slow on the new
distribution (2.16 s for the `>=` scan; 1.55 s for an exact `ndc`), which
confirms the scan diagnosis rather than contradicting it.

**5. The useful subset is small.** Rows are 375 B each as returned, **99 B**
carrying only `(ndc, nadac_per_unit, effective_date, pricing_unit)`. Full history
is therefore ~102 MB slim / ~385 MB raw. But every NDC checked carries exactly
**34 rows** — one per weekly effective date — so the table is ~**30,200 distinct
NDCs**, and a *latest-price-per-NDC* table is **~3 MB**. A price-history chart
needs the full 102 MB; a price *lookup* needs 3 MB.

**Incidental, and useful elsewhere:** the query response carries the upstream
schema, typing `nadac_per_unit` as `decimal(10,5)` — evidence for ADR-004's
`String` money decision and its deferred `Decimal` scalar — and confirming
`pricing_unit` as a first-class column, which is the source for the `Price.unit`
field the schema is missing.

**What this does to the options.** A and B are weakened: B's per-RxCUI cache pays
the 1.5–2.7 s filter cost on every cold key, to populate a table that could have
been pulled whole in 2–4 minutes. C is cheaper than it looked — bounded sync
time, a 3 MB working set, and an incremental path via `>=` — but finding 1 moves
its risk from "annual rotation" to "the ID under it can die any week," which
makes UUID resolution the fragile part rather than the storage. D is unchanged.

## Options considered

### Option A — NADAC on the request path, uncached

Resolve prices by calling `data.medicaid.gov` inside the `PriceSeries` resolver
on every request.

- **For:** No storage, no staleness, no build step, no cache-invalidation
  reasoning. Prices are exactly as fresh as the upstream. Simplest thing that
  works, and it is the honest baseline any other option has to beat.
- **Against:** Fails the 200 ms budget by more than an order of magnitude on
  every request, including the ~92% that return nothing. Puts a single-threaded
  upstream scan in the path of a page render, so an upstream slowdown is an
  outage. Offers no answer for the yearly-UUID resolution beyond doing that
  lookup per request too.

### Option B — Request path, but cached read-through (stale-while-revalidate)

Same call site as A, wrapped in `use cache` with a weekly TTL (the roadmap's
`unstable_cache` line, superseded by ADR-001's Cache Components). First request
for an RxCUI pays 2.7 s; subsequent ones are served from cache and revalidated in
the background.

- **For:** Meets the budget for anything warm, which is the ~300 head RxCUIs
  ADR-005 will prerender. Weekly TTL matches NADAC's real publication cadence, so
  the cache is not lying. No separate ingestion process to build, operate, or
  explain. Degrades to A rather than to nothing.
- **Against:** The cold tail pays full price, and "cold" includes every miss, so
  the 92% case is the slowest path in the app for the first visitor. Cache keyed
  by RxCUI wastes the batching win — 401 NDCs cost the same as one, so a
  per-drug cache repeatedly re-scans a table it could have read once. Needs an
  explicit answer for what the user sees during those 2.7 s, and what is cached
  for a miss (a negative cache entry, or nothing, which makes misses permanently
  slow).

### Option C — Off the request path: a periodic snapshot into local storage

A scheduled job resolves the current distribution UUID, pages the dataset,
dedupes (§3.4), and writes a local price table. Resolvers read only that table
and never touch `data.medicaid.gov`.

- **For:** Request path becomes a local read; the 200 ms budget stops being in
  tension with pricing at all. Misses are as fast as hits, which is the right
  shape when misses are 92% of lookups. One scan per week instead of one per
  drug per week. The 2.7 s scan, pagination, dedup, `""`-vs-`null`, and
  duplicate-row handling all move into a batch context where they are cheap to
  get right and easy to test.
- **Against:** Introduces a storage layer and a scheduled job that this project
  does not otherwise have — the largest scope increase of the four, and it lands
  in W2. Freshness becomes an operational property: a silently failed job serves
  stale prices indefinitely unless the snapshot carries its own timestamp and the
  UI surfaces it. Inherits Q1 in its sharpest form, since the job is the only
  thing that ever resolves the UUID.

### Option D — No NADAC in v1; ship the coverage statement instead

Resolvers return `null` prices with `Coverage` populated from RxNorm's NDC count
alone, and the UI says plainly that no acquisition cost is published for this
drug. Pricing lands in a later week behind whichever of B or C is chosen.

- **For:** Honest for 92% of drugs on day one, and ADR-004 already built the
  schema to say exactly this without changing shape. Unblocks W3 immediately.
  Costs nothing to reverse.
- **Against:** The product is called Pill Price. Shipping it with no prices is a
  defensible engineering call and a weak demo, and the 8% that *do* have prices
  are the ones a reviewer will look up. Defers the decision rather than making
  it, which is the failure mode the ADR rule exists to prevent.

<!-- Add an Option E if none of these is what you'd actually do. -->

## Decision

<!-- One sentence, active voice. If it is B or C, this section also has to
     answer, because the resolvers cannot be written without them:
       - the TTL of the price data, and the TTL of the distribution-UUID
         lookup relative to it
       - what is cached or stored for a miss
       - what the UI shows while a cold path is resolving
       - what the user is told about how old a price is -->

## Consequences

<!-- What becomes easier, what becomes harder, what you are committed to. -->

## Revisit if

<!-- The specific signal. Candidates, if they are the right ones:
     - NADAC's query API gains a real index, or a "changed since" filter,
       and the 2.7 s floor stops being a floor
     - coverage rises materially above 8% on the drugs users actually search
     - community-submitted prices (issue #11) become a second price source,
       which changes what "no published price" means -->
