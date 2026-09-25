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
| `drug(rxcui: ID!): Drug` | RxNorm `/rxcui/{id}/properties.json` | cached, one week (`cachedDrugProperties`) — RxNorm concepts change on a monthly release cycle, so a week sits comfortably inside their real freshness. Decided by [ADR-010](adr/010-upstream-error-taxonomy.md) and implemented in `src/server/cached.ts` | **`null` is a legitimate result and must be distinguished from an error.** Unknown RxCUIs return **HTTP 200 with `{}`** (§1.1) — there is no status-code signal. A Zod schema modelling `properties` as optional parses `{}` happily; the absence has to be asserted, not fallen into. Note `rxcuistatus.json` breaks the pattern: **HTTP 404 with the plain-text body `Not found`** (§1.2). Calling `res.json()` on that path throws `SyntaxError`, and §1.2 names it the single most likely source of an unhandled 500 in the BFF. |
| `search(term: String!): [Drug!]!` | RxNorm `/drugs.json?name=` | **per-request, uncached** (roadmap W2) | Non-null list; empty is the empty state, never an error. `drugGroup.name` is `null` on *every* response, populated or not (§1.3) — it is not an emptiness signal. **No typo tolerance:** `metfromin` returns *merbromin* at rank 1 with metformin absent from the top 10 (§1.5). Whether to build it is **Q8, open**. |

## `Drug`

| Field | Source | Freshness | Failure mode |
| --- | --- | --- | --- |
| `rxcui: ID!` | RxNorm | as `drug` | Echoed from the request path. Do not read it from `relatedGroup.rxcui`, which is `null` even when the RxCUI was in the request URL (§1.3). |
| `name: String!` | RxNorm `properties.name` | as `drug` | Non-null. If properties came back `{}`, the *drug* is null — this field never degrades to `""`. |
| `tty: String!` | RxNorm `properties.tty` | as `drug` | Non-null. One of 19 term types. |
| `isGeneric: Boolean!` | derived from `tty` | as `drug` | **Derived, not fetched.** **Q7 closed:** generic is `SCD`/`GPCK`, brand is `SBD`/`BPCK` — RxNorm's own naming, where the *C*linical and *G*eneric forms carry no brand. The one documented place is `src/server/tty.ts`; resolvers call `isGenericTty`, never their own check. |
| `packages: [Package!]!` | RxNorm `/rxcui/{id}/ndcs.json` | as `drug` | Non-null; empty is legitimate. **This is the fan-out:** one metformin ER 500 MG SCD returns **401 NDCs** (§1.4). Not a classic N+1 — one concept to hundreds of NDCs, which collapse back to a handful of price series. |
| `price: PriceResult!` | NADAC snapshot | **snapshot (weekly)** | **A union since 2026-09-23** ([ADR-010 amendment](adr/010-upstream-error-taxonomy.md)): `Price | Absent | Unavailable`. The cheapest published package, as a `Price`. **`Absent` is the typical case**: ~92% of packages have no published price (§3.3), and under a loaded snapshot the table is complete, so it means NADAC publishes nothing: "NADAC doesn't publish an acquisition cost for this drug (as of {date})." `{date}` is the snapshot's `asOf`, reduced to its UTC calendar day by slicing. **`Unavailable`, `retryable: false`** means no snapshot is loaded: "We couldn't load price data. This is on our side, not NADAC's. Everything else on this page is current." These used to be the same `null`, and every CI build (no snapshot) is the second case. A deploy build with `REQUIRE_NADAC_SNAPSHOT=1` fails instead of prerendering without prices. |
| `priceHistory(range): PriceSeriesResult!` | NADAC snapshot | **snapshot (weekly)** | **Non-null, and it resolves to `Unavailable` — never to a series, yet.** The history is the one degradable field whose absence is ours rather than an upstream's: NADAC publishes it, the snapshot does not keep it. It holds one current price per NDC (~3 MB) where a series needs the full ~102 MB, whose retention shape ADR-009 flags as a decision the sync job will force. So the member is `Unavailable` with **`retryable: false`** — `Absent` would say NADAC came up empty, which is false, and a retry would promise a store that does not exist. Non-null is safe here where `PriceSeries!` was not: the union always has a member to return, so nothing propagates up and takes `drug` with it (measured 2026-09-16: `Cannot return null for non-nullable field Drug.priceHistory`, which is why the field was briefly nullable). The nullable spell was the honest interim and is now closed — [ADR-010](adr/010-upstream-error-taxonomy.md) states the absence instead. When it does resolve, the series always carries `coverage`, and the *points* may be empty. |
| `alternatives(kind): [Drug!]!` | RxNorm `/rxcui/{id}/allrelated.json` | as `drug` | Non-null. **Q7 closed: the four dispensable product concepts — `SCD`, `SBD`, `GPCK`, `BPCK`.** Packs count: a GPCK/BPCK is a box a prescription can actually be filled with. Everything else `allrelated` returns (`IN`, `BN`, `DF`, `DFG`, `SCDC`, `SCDF`, `SCDG`, `SBDC`, `SBDF`, `SBDG`) is excluded — none is dispensable, and each would render as a Drug with a permanently null price and an `absent` label. The queried concept is dropped from its own list. **Note this set is identical to `LABEL_QUERYABLE_TTYS`**, so ADR-010's TTY assertion can never throw on an alternative; `tests/tty-mapping.test.ts` fails if they diverge. `conceptGroup` entries may have **no `conceptProperties` key at all** (`{"tty":"BPCK"}`); without a Zod `.optional()` this is a parse failure on a valid response (§1.3). |
| `ingredients: IngredientsResult!` | RxNorm `/rxcui/{id}/allrelated.json` | as `drug` | **Q7's other half (2026-09-18).** The `IN` concepts the alternatives rule excludes are identity, not alternatives, and get their own field rather than being discarded. `Ingredient` is deliberately **not** a `Drug`: that is the whole of Q7's finding — an ingredient rendered as a `Drug` carries a permanently null price and a permanently `absent` label. **Plural**, because a combination product returns several `IN` concepts (amlodipine / benazepril returns two) and a singular field would halve such a drug's identity silently. Degradable, because it rides the same `allrelated.json` call as `alternatives` and ADR-010 rule 3 makes enrichment partial; both read `ctx.loaders.related`, so the three fields cost **one** request. Never an empty `Ingredients` — RxNorm naming none is `Absent`, per the same rule as `alternatives`. |
| `doseForm: DoseFormResult!` | RxNorm `/rxcui/{id}/allrelated.json` | as `drug` | As above, singular: a dispensable product has exactly one dose form by construction. **`Absent` is the ordinary answer for a pack, not a gap** — a GPCK/BPCK is a box of several products (a contraceptive cycle, a steroid taper) with no single dose form, and the sentence says so rather than leaving a reader to read a blank as an outage. Reads `DF` only, never `DFG`: "Oral Product" sits beside "Oral Tablet" in every response and is the coarser concept, so a prefix match would take whichever came first and be right about half the time. |
| `label: Label` | openFDA | cached, one week (`cachedLabels`) — matching ADR-009's price TTL so the page has a single freshness story. `meta.last_updated` was one day stale when sampled. Caching a 404 is deliberate: the entry expires, so a drug that 404s recovers unaided within seven days rather than being skip-listed forever | Nullable. **Q3 is closed** by [ADR-010](adr/010-upstream-error-taxonomy.md). A label-less drug and a malformed query are still **byte-identical 404s** (§2.1), so the 404 is not disambiguated after the fact — every way *we* can provoke one is eliminated *before* the request: the TTY guard (`assertLabelQueryableTty`) and the CI-verified field list (`OPENFDA_QUERIED_FIELDS`). With both ruled out, a 404 has one meaning left and maps to `Absent`, naming openFDA as the source. |

## `Package`

| Field | Source | Freshness | Failure mode |
| --- | --- | --- | --- |
| `ndc: ID!` | RxNorm `ndcs.json` | as `drug` | 11 digits, no dashes. **Joins to NADAC with no normalization** — the one cross-source join that was easier than expected (§4). |
| `description: String!` | RxNorm / NADAC `ndc_description` | as source | Non-null. If it comes from NADAC it is only available for the ~8% that are priced; sourcing it from RxNorm keeps it available for all packages. **Pick one and record it here** once ADR-009 lands. |
| `price: PriceResult!` | NADAC snapshot | **snapshot (weekly)** | The same three states as `Drug.price`, from the same helpers, so the two fields cannot disagree about what "no price" means. The `Absent` sentence says "package" where the drug's says "drug". |

## `Price`

Money is `String!` throughout — [ADR-004](adr/004-bff-and-schema-design.md), Q6,
closed. NADAC ships `"0.02902"` as a string and the upstream schema types it
`decimal(10,5)`; parsing it into a float to serialise it back is a lossy
round-trip in exchange for nothing.

| Field | Source | Freshness | Failure mode |
| --- | --- | --- | --- |
| `pricePerUnit: String!` | NADAC `nadac_per_unit` | **snapshot (weekly)** | Non-null within a non-null `Price`. Never `""` — NADAC uses `""` *and* `null` for absent in the same record (§3.4); both normalise to no `Price` (`Absent`), not to an empty string. |
| `unit: String!` | NADAC `pricing_unit` | **snapshot (weekly)** | Non-null, and **measured rather than assumed** (2026-09-16): 2500 rows sampled across five offsets of the 1,118,109-row 2026 dataset carry one of exactly `EA`, `ML`, `GM` — no nulls, no `""`. The Zod boundary still types the column absentable because the *column* is; the non-null guarantee is the resolver's to keep. **A row arriving without a unit becomes a null `Price`**, the same absence as no NADAC record — ui-spec §9 renders every price with its unit, so a figure whose unit is unknown is not a price this app may state. `String!` and not an enum, matching `PriceSeries.unit`: a closed enum turns a fourth value NADAC ships into a hard response error on a field the page needs. |
| `effectiveDate: String!` | NADAC `effective_date` | **snapshot (weekly)** | **Always rendered** — ADR-009 requires the published date to be visible next to every price. ISO date as published. **The year in the dataset title is the publication year, not the coverage window** — 2026's rows start 2025-12-17 (§3.4). |
| `asOf: String!` | **this side**, when the snapshot job ran | **snapshot (weekly)** | Non-null. **Load-bearing, not informational** — ADR-009 makes this the only defence against a silently failed job. **Past 14 days (two missed weekly runs) the UI must show a staleness notice**; 14 rather than 7, because a single miss is indistinguishable from schedule jitter. Distinct from NADAC's own `as_of_date` column; if both are exposed they must be named apart. |

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
| `setId: ID!` | openFDA `set_id` | as `Drug.label` | Rows without one are passed over. Builds the DailyMed link. |
| `productName: String!` | `openfda.brand_name[0]`, else `generic_name[0]` | as `Drug.label` | Rows without either are passed over. |
| `manufacturer: String!` | `openfda.manufacturer_name[0]` | as `Drug.label` | Rows without one are passed over. |
| `effectiveDate: String!` | `effective_time` | as `Drug.label` | `YYYYMMDD` sliced to ISO, never through `Date`. |
| `chosenBy: LabelChoice!` | server | — | Which step of ADR-015's chain found it: `OWN_LABEL`, `REFERENCE_IN_RESULTS`, `BRAND_VERSION`, `ORIGINAL_PACKAGER`. |
| `sections: [LabelSection!]!` | seven narrative fields | as `Drug.label` | ui-spec §11 order, boxed warning first. A missing or blank section is left out. `warnings` stands in for `warnings_and_cautions` on older labels. |

**Q2 closed by ADR-015 (Option A).** The chain is in `src/server/label.ts`. It
asks openFDA two filtered, newest-first searches rather than pulling every row:
NDA or BLA rows (steps 1 to 3) and `is_original_packager` rows (step 4), five
per page. Within a page, an original packager beats a relabel, then newest,
then `set_id` breaks a tie on the date. Measured live 2026-09-25: Lipitor and
atorvastatin both show Viatris's NDA020702 label; metformin ER reaches step 4
(Granules, 2026-07-17) in ~1.8 s over three round trips.

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
| Q4 | Does openFDA batch by `OR`? | `Drug.label` batching |
| Q8 | Does search tolerate typos? | `search` |

**Q2, closed 2026-09-24 by ADR-015; kept for provenance.** Measured 2026-09-11: Sampled live:
`atorvastatin 10 MG Oral Tablet` (SCD 617312) has **91 SPLs from 55 distinct
labelers**. They are not copies — `indications_and_usage` runs 0, 1,093, 2,199,
2,197 and 4,330 characters across the first five, and at least one is empty. The
most prolific labelers are **repackagers** (Bryant Ranch Prepack, REMEDYREPACK,
A-S Medication Solutions, Cardinal Health), i.e. the ones a reader has least
reason to care about.

So "most recent" surfaces a repackager and "first" can surface an empty
document; both are arbitrary picks dressed as an answer. The real question is
therefore **what `Label` is** — one document, a merged view, or a count plus a
link — not which of the 91 to choose. `Label.openFDALabel: String` presumes the
first of those and should not be treated as settled.

`LABEL_PAGE_SIZE` is now 5 per filtered search, and no longer a placeholder.

**Q7 is closed** (2026-09-11), folded into the rows above and implemented in
`src/server/tty.ts`. An alternative is a dispensable product — `SCD`, `SBD`,
`GPCK`, `BPCK` — and generic/brand splits `SCD`/`GPCK` from `SBD`/`BPCK`. The
ingredient (`IN`) and dose form (`DF`) are **not** alternatives but are not
discarded either: they are the drug's own identity and belong in their own
fields on `Drug`. **That SDL change landed 2026-09-18** as
`Drug.ingredients: IngredientsResult!` and `Drug.doseForm: DoseFormResult!`.

**Q3 is closed** (2026-09-16) by [ADR-010](adr/010-upstream-error-taxonomy.md),
and the answer is neither "partial" nor "fatal" as the question assumed. openFDA's
404 is never *interpreted*; it is made unambiguous before it can happen. Two guards
run ahead of the request — the TTY assertion (openFDA answers only for `SCD`, `SBD`,
`GPCK`, `BPCK`, measured) and `OPENFDA_QUERIED_FIELDS`, checked against the live API
in CI by `npm run check:openfda-fields`. Those are the only two ways we can provoke
a 404 ourselves, so once both are eliminated a 404 means *this drug has no label*,
and it maps to ADR-010's `Absent` with openFDA named as the source. Asking with the
wrong TTY throws instead of degrading: rendering `absent` there would be a lie,
because we never asked. Implemented in `src/server/openfda-client.ts`.

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
