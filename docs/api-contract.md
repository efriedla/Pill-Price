# API contract

**Status:** draft.
**Pricing freshness:** decided — [ADR-009](adr/009-nadac-on-the-request-path.md)
chose a **weekly snapshot, off the request path**.
**Covers:** the schema in `src/server/schema.ts` as of 2026-08-26.

Every field the BFF exposes, with its upstream source, its freshness, and its
failure mode. This is the Week 2 definition-of-done artifact and the document
`README.md` promises.

Three things it is not. It is not the schema — the SDL in `src/server/schema.ts`
is normative, and this describes it. It is not a tutorial; entry is narrow by
[ADR-004](adr/004-bff-and-schema-design.md) and there are exactly two roots. And
it does not describe implemented behaviour: **every resolver is currently a stub
returning `null` or `[]`.** The failure-mode column below is a specification of
what the resolvers must do, not a report of what they do.

## Upstreams

| Key | Base | Auth | Measured latency | Documented limit |
| --- | --- | --- | --- | --- |
| **RxNorm** | `rxnav.nlm.nih.gov/REST` | none | 110–250 ms warm, ~1.2 s cold | courtesy 20 req/s |
| **openFDA** | `api.fda.gov/drug/label.json` | none (key optional) | — | 240 req/min, 1,000 req/day anonymous |
| **NADAC** | `data.medicaid.gov/api/1/datastore` | none | 1.5–2.7 s **filtered**; unfiltered paging is 0.7–1.9 s per 5,000 rows in isolation but **5.6 s sustained** | none published |

**NADAC is never called during a request** (ADR-009). It is listed here because
the weekly snapshot job calls it, and the job is subject to the same validation
and failure handling as any other upstream client. Its query URL is
`datastore/query/{datasetId}/{index}` — the dataset ID is pinned in config, and
the weekly-rotating distribution ID is resolved server-side by CMS.

Measurements: `docs/upstream-notes.md` §1–3, plus ADR-009's Measurements section
(2026-08-26). None of the three returns rate-limit headers, and openFDA sends
`cache-control: no-store` on every response — **all caching is ours to own.**

## Freshness vocabulary

| Term | Means |
| --- | --- |
| **per-request** | Fetched on every request. No cache layer. |
| **cached (TTL)** | Served from cache; refreshed no more often than TTL. |
| **snapshot (interval)** | Served from local storage written by a job on `interval`. Freshness is an *operational* property — a failed job serves stale data silently unless the row carries its own timestamp. |
| **snapshot (weekly)** | The ADR-009 answer for everything NADAC-sourced. Written by a weekly job; resolvers never call NADAC on a request. A miss is a *published fact*, not an unknown — the snapshot is complete — so a price-less package costs exactly what a priced one costs. |

## `Query`

| Field | Source | Freshness | Failure mode |
| --- | --- | --- | --- |
| `drug(rxcui: ID!): Drug` | RxNorm `/rxcui/{id}/properties.json` | cached, TTL TBD — RxNorm concepts are effectively immutable, so this should be the longest TTL in the app | **`null` is a legitimate result and must be distinguished from an error.** Unknown RxCUIs return **HTTP 200 with `{}`** (§1.1) — there is no status-code signal. A Zod schema modelling `properties` as optional parses `{}` happily; the absence has to be asserted, not fallen into. Note `rxcuistatus.json` breaks the pattern: **HTTP 404 with the plain-text body `Not found`** (§1.2). Calling `res.json()` on that path throws `SyntaxError`, and §1.2 names it the single most likely source of an unhandled 500 in the BFF. |
| `search(term: String!): [Drug!]!` | RxNorm `/drugs.json?name=` | **per-request, uncached** (roadmap W2) | Non-null list; empty is the empty state, never an error. `drugGroup.name` is `null` on *every* response, populated or not (§1.3) — it is not an emptiness signal. **No typo tolerance:** `metfromin` returns *merbromin* at rank 1 with metformin absent from the top 10 (§1.5). Whether to build it is **Q8, open**. |

## `Drug`

| Field | Source | Freshness | Failure mode |
| --- | --- | --- | --- |
| `rxcui: ID!` | RxNorm | as `drug` | Echoed from the request path. Do not read it from `relatedGroup.rxcui`, which is `null` even when the RxCUI was in the request URL (§1.3). |
| `name: String!` | RxNorm `properties.name` | as `drug` | Non-null. If properties came back `{}`, the *drug* is null — this field never degrades to `""`. |
| `tty: String!` | RxNorm `properties.tty` | as `drug` | Non-null. One of 19 term types. |
| `isGeneric: Boolean!` | derived from `tty` | as `drug` | **Derived, not fetched.** The TTY→generic mapping is a product decision entangled with **Q7, open**; it must live in one documented place, not inline in a resolver. |
| `packages: [Package!]!` | RxNorm `/rxcui/{id}/ndcs.json` | as `drug` | Non-null; empty is legitimate. **This is the fan-out:** one metformin ER 500 MG SCD returns **401 NDCs** (§1.4). Not a classic N+1 — one concept to hundreds of NDCs, which collapse back to a handful of price series. |
| `price: Price` | NADAC snapshot | **snapshot (weekly)** | Nullable, and **null is the typical case** — ~92% of packages have no published price (§3.3). Not an error, not a loading state, and under a snapshot not a cache miss either: the table is complete, so `null` means "nothing is published," full stop. |
| `priceHistory(range): PriceSeries!` | NADAC snapshot | **snapshot (weekly)** | **Non-null series, possibly empty `points`.** The series always resolves so `coverage` can be reported; the *points* may be absent. Note this is the field that needs full history (~102 MB) rather than the ~3 MB latest-price table — ADR-009 flags the retention shape as a decision the sync job will force. |
| `alternatives(kind): [Drug!]!` | RxNorm `/rxcui/{id}/allrelated.json` | as `drug` | Non-null. **Which of 19 TTYs count is Q7, open** — the enum defers the question, it does not answer it. `conceptGroup` entries may have **no `conceptProperties` key at all** (`{"tty":"BPCK"}`); without a Zod `.optional()` this is a parse failure on a valid response (§1.3). |
| `label: Label` | openFDA | cached, TTL TBD — `meta.last_updated` was one day stale when sampled | Nullable. **The ambiguity here is Q3, open, and it changes every resolver.** A label-less drug and a malformed query are **byte-identical 404s** (§2.1). Mapping 404 → partial-data notice silently swallows BFF query bugs in production. |

## `Package`

| Field | Source | Freshness | Failure mode |
| --- | --- | --- | --- |
| `ndc: ID!` | RxNorm `ndcs.json` | as `drug` | 11 digits, no dashes. **Joins to NADAC with no normalization** — the one cross-source join that was easier than expected (§4). |
| `description: String!` | RxNorm / NADAC `ndc_description` | as source | Non-null. If it comes from NADAC it is only available for the ~8% that are priced; sourcing it from RxNorm keeps it available for all packages. **Pick one and record it here** once ADR-009 lands. |
| `price: Price` | NADAC snapshot | **snapshot (weekly)** | Nullable; null is the typical case, and definitive rather than unknown. |

## `Price`

Money is `String!` throughout — [ADR-004](adr/004-bff-and-schema-design.md), Q6,
closed. NADAC ships `"0.02902"` as a string and the upstream schema types it
`decimal(10,5)`; parsing it into a float to serialise it back is a lossy
round-trip in exchange for nothing.

| Field | Source | Freshness | Failure mode |
| --- | --- | --- | --- |
| `pricePerUnit: String!` | NADAC `nadac_per_unit` | **snapshot (weekly)** | Non-null within a non-null `Price`. Never `""` — NADAC uses `""` *and* `null` for absent in the same record (§3.4); both normalise to a null `Price`, not to an empty string. |
| `effectiveDate: String!` | NADAC `effective_date` | **snapshot (weekly)** | **Always rendered** — ADR-009 requires the published date to be visible next to every price. ISO date as published. **The year in the dataset title is the publication year, not the coverage window** — 2026's rows start 2025-12-17 (§3.4). |
| `asOf: String!` | **this side**, when the snapshot job ran | **snapshot (weekly)** | Non-null. **Load-bearing, not informational** — ADR-009 makes this the only defence against a silently failed job. **Past 14 days (two missed weekly runs) the UI must show a staleness notice**; 14 rather than 7, because a single miss is indistinguishable from schedule jitter. Distinct from NADAC's own `as_of_date` column; if both are exposed they must be named apart. |

> **Missing field: `unit`.** `PriceSeries.unit` exists; `Price` has none. A
> per-package price without one is not comparable — NADAC's `pricing_unit` is a
> real column with values `EA`/`ML`/`GM`. Authoring it is the user's (roadmap
> rule 3); this row is a placeholder so the gap is not lost.

## `PriceSeries`, `PricePoint`, `Coverage`

| Field | Source | Freshness | Failure mode |
| --- | --- | --- | --- |
| `PriceSeries.range: PriceRange!` | echoed from the argument | n/a | Echoed, so a client can tell what it got. |
| `PriceSeries.granularity: Granularity!` | **server's choice** | n/a | Non-null, and **it is what the server actually returned**, not what was asked. The client must render what this says rather than what it requested. |
| `PriceSeries.unit: String!` | NADAC `pricing_unit` | **snapshot (weekly)** | Non-null and **constant across the series** — a series mixing `EA` and `ML` is not comparable and must not be assembled. |
| `PriceSeries.points: [PricePoint!]!` | NADAC snapshot | **snapshot (weekly)** | Non-null list; **empty is the common case.** |
| `PricePoint.perUnit: String` | NADAC snapshot, rolled up | **snapshot (weekly)** | **Nullable by design — null means nothing was published in this period**, which is distinct from a period that is absent from the list. A chart must render the gap, not interpolate across it. |
| `PricePoint.observations: Int!` | count of raw rows rolled up | **snapshot (weekly)** | Non-null; `0` is valid and pairs with a null `perUnit`. **Requires deduplication first** — NADAC returns the same `(ndc, effective_date, nadac_per_unit)` tuple more than once (§3.4), so a naive count inflates it. |
| `Coverage.pricedPackages: Int!` | count against the snapshot | **snapshot (weekly)** | Non-null, and exact rather than provisional — the snapshot is complete, so this is a real denominator and not "what we happened to have cached." |
| `Coverage.totalPackages: Int!` | RxNorm NDC count | as `drug` | Non-null. **Available even when pricing is entirely unavailable**, which is the point: it is what lets the UI say "no published price for 12 of 14 packages" instead of rendering an empty axis. |

`Coverage` is the disclaimer's evidentiary basis. Of 401 NDCs for one metformin
concept, 34 are priced — and all 34 carry identical prices on identical dates,
because NADAC prices a product rather than a package (§3.3). The honest statement
is not only "this is pharmacy acquisition cost, not what you pay" but also "most
packages of this drug have no published price at all," and that sentence has to
be derivable from a response or the UI is inventing it.

## `Label`

| Field | Source | Freshness | Failure mode |
| --- | --- | --- | --- |
| `openFDALabel: String` | openFDA | as `Drug.label` | Nullable. **Which of 78 SPLs this is, is Q2, open.** `openfda.rxcui:"860975"` reports `meta.results.total: 78` — one per manufacturer, repackager, and revision. `results[0]` is an arbitrary manufacturer's copy. Whatever is chosen, `Label` needs a field *naming* it, or the UI claims "the label" without grounds. |

**Cost note.** One label is **118 KB**, and openFDA supports no field projection —
you download 118 KB to render a paragraph (§2.3). Trimming is the BFF's job.

## Degradation

The W2 definition of done requires that killing one upstream in MSW leaves the
app rendering, with the user told why.

| Upstream down | Result |
| --- | --- |
| **RxNorm** | **Fatal.** It supplies identity; there is no page without it. `drug` → `null`, `search` → `[]` plus an error. |
| **openFDA** | **Partial.** `label` → `null`, everything else renders. The page keeps pricing and packages. |
| **NADAC** | **Partial.** Prices → `null`, `Coverage` still resolves from RxNorm's NDC count, and the UI states that no price is published — which is *already the correct copy for ~92% of drugs.* The degraded state and the common state are the same state. |

That last row is the useful property: the NADAC-down path is exercised by
ordinary traffic, not only by a fault injection.

> **Caveat, and it is Q3.** "openFDA 404 → partial" cannot currently be
> implemented safely, because a malformed query is byte-identical to a
> label-less drug (§2.1). Until Q3 is decided, this table is a *goal*.

## Batching

| Join | Batching |
| --- | --- |
| RxNorm concept → NDCs | One request per concept; 401 NDCs come back in one response. Collapse to price series before doing anything per-NDC. |
| NDCs → NADAC | **Not batched, because not requested.** ADR-009 puts NADAC behind a weekly snapshot, so the request path never fans out to it at all. The job pages the dataset sequentially — ~205 requests of 5,000 rows, no filter ever issued, **~19 minutes measured end to end** (1,149 s for 1,028,250 rows; ADR-009 finding 4 originally estimated 2–4 minutes from individual page timings and was corrected by running it). The `IN`-batching and GET-length findings (§3.5) apply only to the request-path options that were not chosen. |
| RxCUIs → openFDA | **Do not batch by `OR`.** It returns results ranked globally rather than grouped by key, so a DataLoader can get **zero rows for one key while the API reports success** (§2.4). Per-key requests are the only ones that guarantee coverage. **Q4, open.** |

## Open questions this document is waiting on

| Q | Question | Blocks |
| --- | --- | --- |
| Q2 | Which of 78 SPLs is `Label`? | `Label.openFDALabel` |
| Q3 | Is an openFDA 404 partial or fatal? | The whole degradation table |
| Q4 | Does openFDA batch by `OR`? | `Drug.label` batching |
| Q7 | Which TTYs are a generic alternative? | `alternatives`, `isGeneric` |
| Q8 | Does search tolerate typos? | `search` |

**Q5 and Q1 are both closed** by [ADR-009](adr/009-nadac-on-the-request-path.md)
and folded in above.

Q5: NADAC is off the request path, behind a weekly snapshot. Q1: the distribution
identifier rotates *weekly, by design* — NADAC republishes the whole CSV under a
new filename and DKAN derives the distribution ID from file + version — but the
**dataset** identifier is stable, and `datastore/query/{datasetId}/{index}`
resolves the distribution server-side. So there is no short TTL to manage: the
dataset ID is pinned, and a 400/404 at year rollover triggers re-resolution by
exact title. See ADR-009 finding 6.

That stability was *inferred* when this was written; it is **measured** as of
2026-09-02. All fourteen yearly NADAC datasets (2013–2026) still carry their
original identifiers, across three distribution rotations in ten days, and the
UUID versions give the mechanism: distribution IDs are v5, derived from
`file + version`, so a republish must mint a new one; dataset IDs are v4, minted
once. What remains is the **annual** rollover, which is what the title-resolution
fallback is for.
