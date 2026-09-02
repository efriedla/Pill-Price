# ADR-010: Upstream error taxonomy — what is partial and what is fatal

**Status:** proposed
**Date:** 2026-08-27

<!-- SKELETON. Context and options are drafted from measured upstream behaviour.
     The Decision, Consequences, and Revisit-if sections are blank on purpose:
     this is a Week 2 focused-hours item, authored not delegated. Delete this
     comment when the decision lands. -->

## Context

The Week 2 focused hours name three decisions. Two are done: the schema was
written first ([ADR-004](004-bff-and-schema-design.md)) and NADAC's cache
strategy is settled ([ADR-009](009-nadac-on-the-request-path.md)). This is the
third — *"design the error taxonomy: which failures are partial (return data +
error field) vs. fatal"* — and it is the last W2 focused-hours item without a
decision doc.

It is not a formality. `docs/api-contract.md` already publishes a degradation
table, and that table is explicitly labelled **a goal rather than a spec**,
because it cannot be implemented safely today. This ADR is what turns it into a
spec.

**The blocking problem is that openFDA's 404 is ambiguous by design** — this is
Q3, and it changes every resolver:

```
search=openfda.rxcui:"99999999"   → 404 {"error":{"code":"NOT_FOUND",…}}
search=nonsense_field:"x"         → 404 {"error":{"code":"NOT_FOUND",…}}
```

A drug that legitimately has no label and **a malformed query we sent** are
byte-identical (`upstream-notes.md` §2.1). Mapping 404 → partial-data notice is
the obvious choice, and it means a BFF query bug renders in production as a
normal empty state, forever, with nothing in the logs. Mapping it to fatal means
every label-less drug is an error page. Neither is right, which is why this is a
decision rather than a default.

**Three other measured behaviours constrain the taxonomy:**

- **RxNorm signals nothing through status codes.** An unknown RxCUI is HTTP 200
  with `{}` (§1.1). "Not found" and "found, but empty" are the same response.
  `src/server/upstream/` already asserts this absence explicitly rather than
  inferring it from a successful parse — but *what the resolver does with it* is
  this ADR's call.
- **One RxNorm path returns HTTP 404 with the plain-text body `Not found`**
  (§1.2), which `upstream-notes` names the single most likely source of an
  unhandled 500 in the BFF. Any taxonomy has to have a slot for "upstream
  returned something that is not JSON at all."
- **A parse failure is not a network failure.** The two want opposite
  responses — retrying a malformed payload just spends the budget again — and
  `UpstreamParseError` already separates them at the boundary.

**What is already decided and is not reopened here.** ADR-009 removed NADAC from
the request path entirely, so "NADAC is down" is no longer a request-time
condition: the failure mode is a *stale snapshot*, which has its own signal
(`Price.asOf`, a notice past 14 days). What remains genuinely request-time is
RxNorm and openFDA.

## Measurements (2026-09-02)

Taken to answer the two questions this skeleton flagged as ungathered. The first
came back **no**; the second came back **the question was wrong**.

**1. The two 404s are byte-identical, and there is no side channel.** A valid
field with no matches (`openfda.rxcui:"99999999"`) and a field that does not
exist (`nonsense_field:"x"`) return the same status, the same
`content-length: 80`, and the same body. No header distinguishes them — the only
per-response headers are request IDs and `x-cache`, neither of which carries
meaning here. §2.1's claim survives contact: **you cannot tell them apart from
the response.**

**2. But the ambiguity is narrower than §2.1 implies — it is a *field-name*
problem, not a query-bug problem.** A syntactically broken query does not 404 at
all:

| Query defect | Status | Body |
| --- | --- | --- |
| Valid field, no matches | 404 | `NOT_FOUND` / "No matches found!" |
| **Nonexistent field name** | 404 | `NOT_FOUND` / "No matches found!" — *identical* |
| **Unbalanced quote / bad syntax** | **500** | `SERVER_ERROR` / `[token_mgr_error] Lexical error…` |

So malformed *syntax* is already loud, and Option B's `malformed` kind catches it
for free. The silent-failure class this ADR exists to prevent is exactly one
thing: **a field name that is wrong or has been renamed upstream.** That is a
much smaller target than "a BFF query bug," and it does not vary per request —
the field names are constants in our source.

**3. `count=` is a field-name validator, and it does not cost a request per
lookup.** The `count` parameter rejects unknown fields with a *distinguishable*
message:

| `count=` | Status | Body |
| --- | --- | --- |
| `openfda.rxcui.exact` | 200 | 1 bucket |
| `effective_time` | 200 | 6,207 buckets |
| `nonsense_field` | 404 | `NOT_FOUND` / **"Nothing to count"** |
| `openfda.nonsense` | 404 | `NOT_FOUND` / **"Nothing to count"** |

`"Nothing to count"` is a different message from `"No matches found!"`, and it
depends only on whether the field exists. Since our field names are compile-time
constants, this can run **once in CI or at boot** — not once per 404. The canary
idea was right that a second request is the only available evidence; it was wrong
about when to spend it.

**4. There is a *third* cause of a silent 404, and it is the likeliest real
bug: querying at the wrong RxCUI level.** `openfda.rxcui` holds **product-level**
RxCUIs. Ingredient-level ones 404 exactly like an absent label:

| RxCUI | TTY | openFDA | Labels |
| --- | --- | --- | --- |
| 860975 (metformin ER 500 MG) | SCD | 200 | 79 |
| 617310 | SCD | 200 | 106 |
| 1049221 | SCD | 200 | 39 |
| 29046 (lisinopril) | **IN** | **404** | — |

Eight of eight ingredient-level RxCUIs — metformin, lisinopril, atorvastatin,
gabapentin, levothyroxine, amlodipine, sertraline, montelukast — returned 404.
Not one is a drug without labels; every one of them has scores of labels under
its *product* RxCUIs. The 404 means "you asked the wrong question," and it is
byte-identical to "this drug has no label."

This matters more than it first looks, for three reasons. It is a **live risk
today**, because §1.4 already establishes that one concept fans out across 19
TTYs and picking which ones count is an open decision (Q7) — so passing the
wrong level is a plausible bug, not a hypothetical one. It is **invisible to
Option E**, because `openfda.rxcui` is a perfectly valid field name; the
build-time check passes while every lookup silently returns nothing. And it
would present as *the product working correctly* — a drug page rendering with no
label section, which is exactly what a label-less drug looks like.

Any decision that makes 404 mean `absent` therefore needs a second guard beyond
field names: an assertion about the **TTY of the RxCUI being queried**, which is
ours to know before the request goes out.

**5. No rate-limit headers are exposed.** Anonymous responses carry no
`X-RateLimit-*`, so budget against the 240/min and 1,000/day caps has to be
tracked client-side. This is what makes a *per-404* canary (Option C) expensive
and a *per-deploy* field check (below) nearly free.

## Options considered

### Option A — Two states: fatal or partial, decided per upstream

Each upstream is statically classified. RxNorm failure is fatal (it supplies
identity; there is no page without it). openFDA failure is partial (`label` goes
null, everything else renders).

- **For:** Simplest thing that can work, and it matches the degradation table
  already published. One rule per upstream, easy to test by killing one in MSW,
  which is exactly what the W2 definition of done asks for.
- **Against:** Says nothing about *why* a call failed, so it cannot separate
  openFDA's ambiguous 404 from a real openFDA outage — both become "partial,"
  and the query-bug case stays invisible. Treats a parse failure and a timeout
  identically when they want opposite handling.

### Option B — Classify by failure *kind*, not by upstream

The axis is what went wrong — `unavailable` (network, timeout, 5xx), `malformed`
(parse failure, non-JSON body), `absent` (a real, meaningful empty) — and each
kind maps to partial or fatal per field.

- **For:** `malformed` becomes loud wherever it happens, which is the only way
  the plain-text-404 path and a BFF query bug ever reach a log instead of a
  user's empty state. Matches what the boundary already produces: an
  `UpstreamParseError` is `malformed`, a fetch rejection is `unavailable`.
- **Against:** More machinery, and it still does not resolve Q3 on its own —
  openFDA's 404 has to be *assigned* to `absent` or `malformed`, and the
  response gives no evidence either way. Risks a taxonomy that is precise about
  everything except the one case that motivated it.

### Option C — Option B, plus a canary for openFDA specifically

As B, and additionally: when openFDA returns 404, issue one known-good query
(an RxCUI known to have labels). If the canary also 404s, the query shape is
broken — classify `malformed` and alert. If the canary succeeds, the drug
genuinely has no label — classify `absent`.

- **For:** **Actually resolves Q3** rather than routing around it, using the only
  evidence available: a second request whose expected answer is known. Turns an
  undecidable case into a decidable one, and the cost lands only on the 404 path.
- **Against:** Doubles requests on that path against a **1,000/day anonymous
  cap** (§2.5) — and a broken query shape means *every* label lookup 404s, so the
  canary fires on every one of them, which is precisely when the budget is
  tightest. Needs its own caching, and a canary result cached too long
  reintroduces the ambiguity it exists to remove.

### Option D — Defer: leave the degradation table a goal

Ship resolvers with openFDA 404 → partial and revisit when something breaks.

- **For:** Costs nothing now, and the failure it risks is invisible-but-benign
  in the common case.
- **Against:** The failure mode is a class of bug that is *silent by
  construction* — it renders as a normal empty state with nothing logged. This
  is the exact shape of thing the ADR process exists to prevent shipping by
  default, and "revisit when something breaks" does not work when breakage is
  designed to look like success.

### Option E — Option B, with field-name validation moved off the request path

As B — classify by failure kind — and resolve Q3 not at request time but at
build/boot time: assert every openFDA field name we query against `count=<field>`
in CI, and fail the build when one stops existing. At request time a 404 is then
**unambiguously `absent`**, because the only other thing it could have meant has
already been ruled out.

- **For:** Resolves Q3 with the same evidence Option C uses, at a fraction of the
  cost — a handful of requests per deploy instead of one per 404, which matters
  because a broken field name 404s *every* lookup, exactly when the 1,000/day
  budget is tightest (measurement 5). Catches the failure earlier than
  production: an upstream field rename breaks CI rather than silently emptying a
  page. Needs no caching, no canary TTL, no new request-time state.
- **Against:** Covers only *field names*, and measurement 4 shows the likeliest
  real bug is not a field name but a wrong-level RxCUI — a valid field, a valid
  query, an empty answer. E has to be paired with a TTY precondition on the call
  site or it resolves the wrong half of the problem. Beyond that it covers only
  fields known at build time — a dynamically constructed field would slip through
  (we have none, and this makes that a constraint worth keeping). Does not detect a rename landing *between* deploys,
  so a long gap between deploys is a gap in coverage; a scheduled run of the same
  check closes it, at the cost of leaning on the scheduled job ADR-009 already
  introduced. Leaves the request path unable to distinguish anything on its own,
  which is only safe *because* the build-time check ran.

<!-- Add an Option F if none of these is what you'd actually do. -->

## Decision

<!-- One sentence, active voice. This section also has to answer, because the
     resolvers cannot be written without them:
       - openFDA 404: absent, malformed, decided by canary (C), or absent
         *because* a build-time field check ruled out the alternative (E)?
       - is an RxNorm 200-with-{} a fatal error or a legitimate null `drug`?
       - what does a partial failure look like *in the response* — GraphQL
         errors array, a nullable field, or a typed field on the payload?
       - what gets logged or alerted, and at what level, for each kind? -->

## Consequences

<!-- What becomes easier, what becomes harder, what you are committed to. -->

## Revisit if

<!-- Candidates:
     - openFDA gains any signal distinguishing a bad field from no matches
     - an API key raises the 1,000/day cap enough to make a canary cheap
     - a second label source appears, making openFDA non-critical -->
