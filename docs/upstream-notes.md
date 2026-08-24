# Upstream Reconnaissance — RxNorm, openFDA, NADAC

**Status:** findings, not decisions. This document exists to feed the W2 focused
hours (`schema.graphql`, the error taxonomy, per-source cache TTLs) with what the
three APIs *actually* do, rather than what their docs claim. Every number below
was measured on 2026-08-23 from a US residential connection; raw responses are
committed under `tests/fixtures/upstream/` and reproducible with
`scripts/capture-upstream.sh`.

Nothing here chooses anything. Open questions for ADR-004 are collected at the end.

---

## Headline

A naive, sequential drug-detail fetch — RxNorm properties → related → NDCs →
openFDA label → NADAC prices — takes **~6.0 seconds** cold:

| Step | Cold latency |
| --- | --- |
| RxNorm `/rxcui/{id}/properties.json` | 1269 ms |
| RxNorm `/rxcui/{id}/related.json` | 1120 ms |
| RxNorm `/rxcui/{id}/ndcs.json` | 115 ms |
| openFDA `/drug/label.json` | 793 ms |
| NADAC datastore query | 2680 ms |
| **Total** | **≈5977 ms** |

The p95 target is 200 ms. The gap is not closable by parallelizing — NADAC alone
is 2.7 s, and it is 2.7 s *every time*, including for a miss (see below). Whatever
ADR-004 decides, the pricing path cannot be a per-request upstream call.

---

## 1. RxNorm (`rxnav.nlm.nih.gov/REST`)

Fast (110–250 ms warm, ~1.2 s cold), no auth, no documented rate limit beyond a
courtesy 20 req/s. It is the best-behaved of the three, and still has traps.

### 1.1 Everything is HTTP 200, including "not found"

| Request | Status | Body |
| --- | --- | --- |
| `drugs.json?name=metformin` | 200 | full result |
| `drugs.json?name=zzzqqq` | 200 | `{"drugGroup":{"name":null}}` |
| `rxcui/99999999/properties.json` | 200 | `{}` |

There is no status-code signal for an unknown RxCUI. "Drug does not exist" and
"drug exists but has no data" are the same shape, and both are 200. A Zod schema
that models `properties` as optional will parse `{}` happily — the *absence* has
to be detected deliberately, not fallen into.

### 1.2 …except when it is 200-shaped plain text

`rxcuistatus.json?rxcui=860975` returns **HTTP 404 with the body `Not found`** —
not JSON. Any client that does `res.json()` on a non-2xx path, or that assumes an
error body is JSON, throws a `SyntaxError` instead of a typed upstream error. This
is the single most likely source of an unhandled 500 in the BFF.

### 1.3 Envelopes are inconsistent and half-populated

- `relatedGroup.rxcui` is `null` even though the RxCUI was in the request path.
- `drugGroup.name` is `null` on every response, populated or empty.
- `conceptGroup` entries may have **no `conceptProperties` key at all** —
  `{"tty":"BPCK"}` appears as a bare object. With `noUncheckedIndexedAccess` this
  is caught; without a Zod `.optional()` it is a parse failure on a valid response.
- `synonym` and `umlscui` are frequently `""` rather than absent.

### 1.4 The fan-out is worse than an N+1

`/rxcui/860975/ndcs.json` (one metformin ER 500 MG SCD) returns **401 NDCs**.
`allrelated.json` for the same concept spans 19 term types (SCD, SBD, SCDG, SBDG,
GPCK, BPCK, DF, DFG, MIN, …). "Related products" is not a small list, and which
TTYs count as a *generic alternative* is a modelling decision, not a lookup.

The batching opportunity is real but it is not the classic per-row N+1: it is one
concept fanning out to hundreds of NDCs, which then have to be collapsed back to a
handful of price series (see §3.3).

### 1.5 Spelling correction does not work

`approximateTerm.json?term=metfromin` — an obvious transposition of *metformin* —
returns **merbromin** at rank 1, with metformin nowhere in the top 10. `drugs.json`
with the same typo returns an empty group. If search is expected to tolerate typos,
that capability does not come from RxNorm's approximate matcher.

---

## 2. openFDA (`api.fda.gov/drug/label.json`)

### 2.1 404 is ambiguous by design

```
search=openfda.rxcui:"99999999"   → 404 {"error":{"code":"NOT_FOUND","message":"No matches found!"}}
search=nonsense_field:"x"         → 404 {"error":{"code":"NOT_FOUND","message":"No matches found!"}}
```

A malformed query and a legitimately label-less drug are **byte-identical**. There
is no way to distinguish "this drug has no label" (a normal, user-facing empty
state) from "we sent a broken query" (a bug that should page someone). Any error
taxonomy that maps openFDA 404 → partial-data notice will silently swallow BFF
query bugs in production.

### 2.2 There is no such thing as "the label" for a drug

`openfda.rxcui:"860975"` reports **`meta.results.total: 78`**. Each SPL submission
— per manufacturer, per repackager, per revision — is its own result. Picking
`results[0]` is picking an arbitrary manufacturer's copy. Merging them is a
content decision. Either way the schema field `label` is one-of-78, and the UI is
making a claim about which one.

### 2.3 Payloads are enormous

| Response | Size |
| --- | --- |
| One label, `limit=1` | **118 KB** |
| Three RxCUIs OR'd, `limit=10` | **772 KB** |

Every narrative field (`warnings`, `precautions`, `adverse_reactions`, …) is an
**array of strings**, each string frequently many KB of prose. openFDA supports no
field projection — you cannot ask for only `indications_and_usage`. You download
118 KB to render a paragraph.

### 2.4 Batching by `OR` is a correctness trap

`search=openfda.rxcui:("860975" OR "617314" OR "197361")&limit=10` returns 10
results — nine amlodipine, one metformin, with a reported total of 146. Results are
ranked globally, not grouped by key. A DataLoader that batches this way can return
**zero rows for one of its keys** while the API reports success. Per-key coverage
is not guaranteed by any parameter; only per-key requests guarantee it.

### 2.5 Operational

- No rate-limit headers are returned. Documented limits are 240 req/min per IP and
  1,000 req/day without an API key (120,000/day with one).
- `cache-control: no-cache, no-store, must-revalidate` on every response —
  upstream will not help; any caching is entirely ours to own.
- `meta.last_updated` was `2026-08-22` (one day stale) and `meta.disclaimer`
  explicitly says results are unvalidated. That disclaimer is upstream's; ours
  still has to be written separately.

---

## 3. NADAC (`data.medicaid.gov/api/1/datastore`)

### 3.1 The dataset identifier changes every year

NADAC is published as **one dataset per calendar year**, each with its own UUID:

| Year | Distribution ID |
| --- | --- |
| 2025 | `ae004d7f-5799-5de3-91ec-f1247f1a5452` |
| 2026 | `b391aa55-d8f1-5894-be06-ea28d64a4186` |

Hard-coding the 2026 UUID means the app silently serves stale prices from
2027-01-01. Resolving it requires the metastore index at
`/api/1/metastore/schemas/dataset/items`, which is **1.1 MB** and returns all 549
CMS datasets — you filter client-side by title. That index is itself a cached
lookup with its own TTL question.

Filtering by the substring `NADAC` is not enough. The index also contains
**NADAC Comparison** (3,434,973 rows, a different schema) and **First Time NADAC
Rates**, and "NADAC Comparison" sorts above every yearly title. The capture
script hit exactly this bug on its first run. The reliable key is the literal
title pattern `NADAC (National Average Drug Acquisition Cost) <year>`, which is
a string-matching contract on a field nobody promised to keep stable.

The 2026 dataset holds **998,332 rows**.

### 3.2 Every query is a full scan — ~2.7 s, hit or miss

| Query | Latency |
| --- | --- |
| Unfiltered `limit=1` | 0.28 s |
| Filter `ndc = <real>` | 2.73 s |
| Filter `ndc = <nonexistent>` | 2.72 s |
| `ndc in (401 values)`, POST | 2.68 s |

A miss costs the same as a hit. Latency is essentially independent of result size,
which reads as an unindexed scan over the million rows. A timeout budget tuned to
"fast source" will fail 100% of NADAC calls.

### 3.3 Coverage is the real finding: 34 of 401

Of the **401 NDCs** RxNorm returns for metformin ER 500 MG, only **34 appear in
NADAC 2026** — about 8%. The other 92% have no acquisition cost at any date.

All 34 carry *identical* prices on identical dates (`0.02902` on 2026-03-18,
`0.02933` on 2026-04-22). NADAC prices a product, not a package, so the 401→34
fan-out collapses to a single series. The per-unit spread across the whole result
set is 0.02902–0.02982 — under a third of a cent.

This is the disclaimer's evidentiary basis, and it is stronger than the roadmap
assumed: the honest statement is not only "this is pharmacy acquisition cost, not
what you pay" but also "most packages of this drug have no published price at all."

### 3.4 Response quirks

- **Numbers arrive as strings**: `"nadac_per_unit": "0.02902"`. Floating-point
  parsing of a currency-adjacent value is a decision, not an accident.
- **Missing is `""`, sometimes `null`**: `corresponding_generic_drug_nadac_per_unit`
  is `""`; `corresponding_generic_drug_effective_date` is `null`. Same record, two
  encodings of absent.
- **Duplicate rows**: the same `(ndc, effective_date, nadac_per_unit)` tuple is
  returned more than once. Deduplication is required before charting.
- **Pagination is mandatory**: the 401-NDC query reported `count: 1045` but
  returned 500 rows. There is no `next` link; you page by `offset`.
- `effective_date` values in the "2026" dataset start at **2025-12-17**. The year
  in the title is the publication year, not the coverage window.
- `explanation_code` is a comma-joined string (`"1, 6"`), not an array.

### 3.5 GET is length-limited; POST is not

A GET with 401 `conditions[0][value][]` parameters (19 KB URL) returns **400 Bad
Request**. The same filter as a JSON `POST` body to
`/api/1/datastore/query/{distributionId}` succeeds. Batch size for NADAC is
therefore bounded by transport, and only on the GET path.

---

## 4. Cross-source joins

- **RxNorm → NADAC** joins on 11-digit NDC, no dashes, and the formats match
  exactly as returned. No normalization was needed in any sample checked. This is
  the one thing that was easier than expected.
- **RxNorm → openFDA** joins on `openfda.rxcui`, which is an **array** — one label
  covers up to 3 RxCUIs in the sampled data. The join is many-to-many in both
  directions.
- There is no shared identifier across all three. NDC bridges RxNorm↔NADAC; RxCUI
  bridges RxNorm↔openFDA; NADAC and openFDA have no direct join at all.

---

## 5. Open questions for ADR-004

Recorded, not answered — these are the focused-hours decisions.

1. **Freshness vs. identity.** NADAC's yearly-UUID rotation means "current prices"
   is a resolution step, not a URL. Where does that resolution live, and what is
   its TTL relative to the price data's?
2. **What is `label` in the schema** when 78 candidates exist — first, newest by
   `effective_time`, or a merge? Whichever it is, the field's documentation has to
   say so, because the user will read it as "the label."
3. **Is openFDA 404 partial or fatal?** It is genuinely ambiguous (§2.1). Treating
   it as partial makes the app resilient and makes a class of bug invisible.
4. **Does batching openFDA by `OR` ever ship**, given §2.4's silent per-key
   misses? Per-key requests are correct and cost 240 req/min against a 1,000/day
   anonymous cap.
5. **Does NADAC belong on the request path at all**, given 2.7 s floor and 8%
   coverage? If not, what produces the cached view, and what does the UI show for
   the 92%?
6. **Where do prices become numbers** — at the Zod boundary, in the resolver, or
   in the formatter — and in what representation, given they arrive as strings?
7. **What counts as a generic alternative** across 19 RxNorm term types? This is a
   product decision that the schema will freeze.
8. **Does search tolerate typos?** RxNorm's approximate matcher does not deliver it
   (§1.5), so this is a build-or-drop decision, not a configuration one.

---

## 6. Reproducing this

```sh
scripts/capture-upstream.sh          # re-captures every fixture under tests/fixtures/upstream/
```

Fixtures are trimmed to a small number of `results` where the raw response ran to
hundreds of KB; sizes quoted above are of the untrimmed responses. Latencies are
single cold samples, not distributions — they establish orders of magnitude, and
W6 replaces them with real measurement.
