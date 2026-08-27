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

<!-- Not yet gathered, and it would sharpen the openFDA option:
     - whether an openFDA malformed-field query can be distinguished by any
       other signal at all (response headers, meta block, timing)
     - whether a known-good canary query alongside each real one is affordable
       against the 240 req/min and 1,000 req/day anonymous limits -->

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

<!-- Add an Option E if none of these is what you'd actually do. -->

## Decision

<!-- One sentence, active voice. This section also has to answer, because the
     resolvers cannot be written without them:
       - openFDA 404: absent, malformed, or decided by canary?
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
