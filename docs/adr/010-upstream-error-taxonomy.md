# ADR-010: Upstream error taxonomy — what is partial and what is fatal

**Status:** accepted
**Date:** 2026-08-27 (decided 2026-09-04)

## Context

The Week 2 focused hours name three decisions. Two are done: the schema was
written first ([ADR-004](004-bff-and-schema-design.md)) and NADAC's cache
strategy is settled ([ADR-009](009-nadac-on-the-request-path.md)). This is the
third — _"design the error taxonomy: which failures are partial (return data +
error field) vs. fatal"_ — and it is the last W2 focused-hours item without a
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
  inferring it from a successful parse — but _what the resolver does with it_ is
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
condition: the failure mode is a _stale snapshot_, which has its own signal
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

**2. But the ambiguity is narrower than §2.1 implies — it is a _field-name_
problem, not a query-bug problem.** A syntactically broken query does not 404 at
all:

| Query defect                      | Status  | Body                                                |
| --------------------------------- | ------- | --------------------------------------------------- |
| Valid field, no matches           | 404     | `NOT_FOUND` / "No matches found!"                   |
| **Nonexistent field name**        | 404     | `NOT_FOUND` / "No matches found!" — _identical_     |
| **Unbalanced quote / bad syntax** | **500** | `SERVER_ERROR` / `[token_mgr_error] Lexical error…` |

So malformed _syntax_ is already loud, and Option B's `malformed` kind catches it
for free. The silent-failure class this ADR exists to prevent is exactly one
thing: **a field name that is wrong or has been renamed upstream.** That is a
much smaller target than "a BFF query bug," and it does not vary per request —
the field names are constants in our source.

**3. `count=` is a field-name validator, and it does not cost a request per
lookup.** The `count` parameter rejects unknown fields with a _distinguishable_
message:

| `count=`              | Status | Body                                 |
| --------------------- | ------ | ------------------------------------ |
| `openfda.rxcui.exact` | 200    | 1 bucket                             |
| `effective_time`      | 200    | 6,207 buckets                        |
| `nonsense_field`      | 404    | `NOT_FOUND` / **"Nothing to count"** |
| `openfda.nonsense`    | 404    | `NOT_FOUND` / **"Nothing to count"** |

`"Nothing to count"` is a different message from `"No matches found!"`, and it
depends only on whether the field exists. Since our field names are compile-time
constants, this can run **once in CI or at boot** — not once per 404. The canary
idea was right that a second request is the only available evidence; it was wrong
about when to spend it.

**4. There is a _third_ cause of a silent 404, and it is the likeliest real
bug: querying at the wrong RxCUI level.** `openfda.rxcui` holds **product-level**
RxCUIs. Ingredient-level ones 404 exactly like an absent label:

| RxCUI                        | TTY    | openFDA | Labels |
| ---------------------------- | ------ | ------- | ------ |
| 860975 (metformin ER 500 MG) | SCD    | 200     | 79     |
| 617310                       | SCD    | 200     | 106    |
| 1049221                      | SCD    | 200     | 39     |
| 29046 (lisinopril)           | **IN** | **404** | —      |

Eight of eight ingredient-level RxCUIs — metformin, lisinopril, atorvastatin,
gabapentin, levothyroxine, amlodipine, sertraline, montelukast — returned 404.
Not one is a drug without labels; every one of them has scores of labels under
its _product_ RxCUIs. The 404 means "you asked the wrong question," and it is
byte-identical to "this drug has no label."

This matters more than it first looks, for three reasons. It is a **live risk
today**, because §1.4 already establishes that one concept fans out across 19
TTYs and picking which ones count is an open decision (Q7) — so passing the
wrong level is a plausible bug, not a hypothetical one. It is **invisible to
Option E**, because `openfda.rxcui` is a perfectly valid field name; the
build-time check passes while every lookup silently returns nothing. And it
would present as _the product working correctly_ — a drug page rendering with no
label section, which is exactly what a label-less drug looks like.

Any decision that makes 404 mean `absent` therefore needs a second guard beyond
field names: an assertion about the **TTY of the RxCUI being queried**, which is
ours to know before the request goes out.

**The set is now enumerated (2026-09-02).** Twenty pack concepts sampled at
random from RxNorm's 656 GPCK and 742 BPCK, plus one concept from each remaining
term type:

| TTY                          | openFDA answers? | Evidence                                     |
| ---------------------------- | ---------------- | -------------------------------------------- |
| **SCD**                      | **yes**          | 5 of 5 sampled returned labels (10–106 each) |
| **SBD**                      | **yes**          | 213269 → 2 labels                            |
| **GPCK**                     | **yes**          | 8 of 10 sampled returned labels              |
| **BPCK**                     | **yes**          | 7 of 10 sampled returned labels              |
| IN, MIN, PIN, BN             | no               | 404                                          |
| DF, DFG                      | no               | 404                                          |
| SCDG, SBDG, SCDF, SBDF, SCDC | no               | 404                                          |

**The allowed set is `{SCD, SBD, GPCK, BPCK}`** — the dispensable product
concepts, which is exactly what an SPL is written about. Everything else is an
abstraction over products (an ingredient, a dose form, a grouper) and has no
label of its own to find.

Two caveats on the evidence. The "no" rows are **one concept each**, so they are
consistent with the structural story rather than proof of it; the "yes" rows are
sampled and are proof. And the packs' 404s (2 of 10 GPCK, 3 of 10 BPCK) are
ordinary absences, not level errors — same as the SCD and SBD 404s below.

**A follow-up probe narrows what that guard can promise.** Product-level TTYs are
_necessary but not sufficient_: SBD 213269 returns 2 labels while SBD 860977
404s, and SCD 1000126 returns labels while SCD 833036 404s. Non-product TTYs, by
contrast, appear to 404 unconditionally — IN 6809 and DF 316945 both do, as did
all eight ingredients above.

So the TTY check cannot _predict_ whether a label exists, and it is not meant to.
Its job is elimination: rule out the one cause that is always our bug, so that a
404 on a correctly-levelled RxCUI has only one remaining meaning. Combined with a
field-name check, that is what licenses reading 404 as `absent` — the guards do
not detect absence, they exhaust the alternatives.

**5. No rate-limit headers are exposed.** Anonymous responses carry no
`X-RateLimit-*`, so budget against the 240/min and 1,000/day caps has to be
tracked client-side. This is what makes a _per-404_ canary (Option C) expensive
and a _per-deploy_ field check (below) nearly free.

## Options considered

### Option A — Two states: fatal or partial, decided per upstream

Each upstream is statically classified. RxNorm failure is fatal (it supplies
identity; there is no page without it). openFDA failure is partial (`label` goes
null, everything else renders).

- **For:** Simplest thing that can work, and it matches the degradation table
  already published. One rule per upstream, easy to test by killing one in MSW,
  which is exactly what the W2 definition of done asks for.
- **Against:** Says nothing about _why_ a call failed, so it cannot separate
  openFDA's ambiguous 404 from a real openFDA outage — both become "partial,"
  and the query-bug case stays invisible. Treats a parse failure and a timeout
  identically when they want opposite handling.

### Option B — Classify by failure _kind_, not by upstream

The axis is what went wrong — `unavailable` (network, timeout, 5xx), `malformed`
(parse failure, non-JSON body), `absent` (a real, meaningful empty) — and each
kind maps to partial or fatal per field.

- **For:** `malformed` becomes loud wherever it happens, which is the only way
  the plain-text-404 path and a BFF query bug ever reach a log instead of a
  user's empty state. Matches what the boundary already produces: an
  `UpstreamParseError` is `malformed`, a fetch rejection is `unavailable`.
- **Against:** More machinery, and it still does not resolve Q3 on its own —
  openFDA's 404 has to be _assigned_ to `absent` or `malformed`, and the
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
  cap** (§2.5) — and a broken query shape means _every_ label lookup 404s, so the
  canary fires on every one of them, which is precisely when the budget is
  tightest. Needs its own caching, and a canary result cached too long
  reintroduces the ambiguity it exists to remove.

### Option D — Defer: leave the degradation table a goal

Ship resolvers with openFDA 404 → partial and revisit when something breaks.

- **For:** Costs nothing now, and the failure it risks is invisible-but-benign
  in the common case.
- **Against:** The failure mode is a class of bug that is _silent by
  construction_ — it renders as a normal empty state with nothing logged. This
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
  because a broken field name 404s _every_ lookup, exactly when the 1,000/day
  budget is tightest (measurement 5). Catches the failure earlier than
  production: an upstream field rename breaks CI rather than silently emptying a
  page. Needs no caching, no canary TTL, no new request-time state.
- **Against:** Covers only _field names_, and measurement 4 shows the likeliest
  real bug is not a field name but a wrong-level RxCUI — a valid field, a valid
  query, an empty answer. E has to be paired with a TTY precondition on the call
  site or it resolves the wrong half of the problem. Beyond that it covers only
  fields known at build time — a dynamically constructed field would slip through
  (we have none, and this makes that a constraint worth keeping). Does not detect a rename landing _between_ deploys,
  so a long gap between deploys is a gap in coverage; a scheduled run of the same
  check closes it, at the cost of leaning on the scheduled job ADR-009 already
  introduced. Leaves the request path unable to distinguish anything on its own,
  which is only safe _because_ the build-time check ran.

## Decision

**An absence is always stated, never rendered as nothing.** Every other rule below
follows from it. A blank section is unreadable in two directions at once: we
cannot tell later whether we asked and got nothing or never asked, and the reader
cannot tell whether the drug has no label or whether we simply failed to find
out. The second matters more than it looks, because people arrive here to work
out what is known about a drug and where — ruling a source _out_ is a result they
came for. A silent empty section takes that away and looks identical to a bug.

**Failures are classified by kind — `absent`, `unavailable`, `malformed` — and
attributed by source.** Kind is what the resolver branches on and what the UI
renders, because the same upstream needs different handling on different calls
and different upstreams need identical handling when they fail the same way:
RxNorm is fatal on the identity call and merely partial on enrichment, which no
per-upstream rule can express (Option A). Source is carried alongside every
event, in logs and in the response, so "what is openFDA doing this week?" stays
answerable. Attribution is a label on the event, not a branch in the code.

**The source is named to the user.** A section reads "openFDA has no label for
this drug", not "no label available". Naming the vendor is the point of the rule
above: a reader who cannot see which source came up empty cannot rule that source
out, and the transparency is worth a vendor name appearing on a drug page.

### openFDA

**A 404 means `absent`,** surfaced as a label-unavailable state on an otherwise
complete page — openFDA supplies the label, not the price, and price comes from a
snapshot off the request path (ADR-009). The 404 is byte-identical for "this drug
has no label" and "we sent a query openFDA does not understand" (measurement 1),
so reading it as `absent` is only safe once we have ruled out every way we can
provoke one ourselves. There are exactly two, and both are eliminated before the
request rather than detected after it:

- **The TTY assertion, in the openFDA client.** Only `SCD`, `SBD`, `GPCK` and
  `BPCK` may be sent; anything else is rejected at the call site with no request
  made. Those four are the measured set, not a guess (measurement 4) — every
  other term type probed returns 404 regardless of the drug. This rules out
  asking about the wrong _kind of thing_. It throws rather than degrading,
  because there is no user-facing situation in which the right answer to "we
  asked the wrong question" is an empty label section; it is a programming error,
  and a test covers it. It lives in the client, not the resolver, because it is a
  fact about what that upstream can answer for and must hold for call sites that
  do not exist yet.
- **The `count=<field>` check, in CI.** Every openFDA field name we query is
  asserted to still exist at build time, and the build fails on a rename
  (measurement 3). This rules out asking with a field name that no longer means
  anything.

With both ruled out, a 404 that reaches the resolver has one meaning left.
`absent` is a conclusion reached by exhausting the alternatives, not a detection —
and both guards run before the request, so neither costs anything per lookup.

**A 404 is cached exactly like a label, for one week.** There is no skip-list and
no bespoke negative-cache subsystem: the label lookup is a cached function like
any other, with a single `cacheLife` and no branch on the outcome. One week
matches ADR-009's price TTL, so the page has one freshness story rather than two.
A permanent skip-list was rejected because it makes a drug that later gains a
label stay broken forever; an expiring result keeps the recover-unaided property
and merely slows it to seven days. Requests are still never spent on questions
that cannot be answered — product-level TTYs are asked about, anything else never
is.

**Every 404 is tagged `openFDANotFound` with RxCUI, TTY, field name and
timestamp.** Logging the TTY is deliberate: it is the retroactive side channel
openFDA does not offer.

**Ingredient-to-product resolution is out of scope.** Holding an ingredient RxCUI
and wanting a label is a lookup question — which products, and which of their
labels — belonging with Q2 and Q7. This ADR says only that an ingredient RxCUI
must not be sent to openFDA as though it were a product.

### RxNorm

**The identity call returning `200 {}` is not-found, not an error.** Nothing
broke; RxNorm answered, and its answer is that the concept does not exist. This
is measured rather than assumed — `rxcui/99999999/properties.json`, a fabricated
identifier, returns exactly that (§1.1) — and it means "does not exist" and
"exists but holds nothing" are genuinely indistinguishable. The ambiguity is
lopsided: a bad identifier in a URL is overwhelmingly the common cause, so we
read it as not-found and **do not** spend a second request on `related` or `ndcs`
to disambiguate. That request would land on the slowest path we have to change
the answer for a rare case. The absence is asserted from required fields, never
inferred from a successful parse (§1.1).

**Identity network failures, timeouts and 5xx are `unavailable`, and fatal.**
There is no page without identity.

**Enrichment calls — related products, NDCs — are always partial.** The page
renders with name, price and label regardless. Enrichment `absent` and enrichment
`unavailable` are stated separately: "no related products found" and "related
products unavailable right now" are different facts, and collapsing them into one
string, or into a silent empty section, is the failure this ADR exists to
prevent.

**A non-JSON body on any call is `malformed`** — loud, never retried, never read
as absent. Concretely: `res.json()` is never called on a non-2xx path, which
§1.2 names the single most likely source of an unhandled 500 in the BFF.

### Response shape

A degradable field carries its own state as a union, not a nullable field and not
the GraphQL `errors` array:

```graphql
type Drug {
  label: LabelResult!
}
union LabelResult = Label | Absent | Unavailable
```

`Absent` and `Unavailable` are shared member types, reused across every degradable
field. GraphQL unions are not generic, so each field needs its own union — but not
its own absent type, and `LabelAbsent` / `RelatedAbsent` are not built.

This is the only shape where "the section must say which of the two happened" is
enforced by the type system instead of by remembering. A nullable field cannot
tell absent from unavailable: `null` means "no label", "openFDA is down" and "we
did not ask" identically, which is the silent-empty failure mode in a new coat.
Codegen turns the union into a discriminated type, so a component that forgets the
`Unavailable` branch fails to compile rather than rendering blank — the same move
already made at the client boundary with `UpstreamParseError`: make the
distinction structural so it cannot be flattened by accident. The `errors` array
was rejected from the other side: it is untyped, so absent-versus-unavailable
becomes string matching that codegen cannot check, and most clients read a
populated `errors` array as "the request failed", which is wrong when the page
rendered fine. `errors` keeps its meaning of a genuinely failed request.

**`Absent` carries the finished sentence, authored server-side**
(`Absent { reason: String! }`); `Unavailable` carries whether a retry is
meaningful. The copy lives next to the taxonomy that decided it, so a new
degradable field cannot ship without an explanation of what is missing. A
machine-readable code with client-owned wording was considered and not taken: it
puts copy where designers can reach it, but a forgotten enum case renders as an
empty string, which is the thing being ruled out.

### Logging and alerting

Level reflects who has to act, not how unusual the event is.

| Kind                                  | Level   | Alert      | Why                                                                        |
| ------------------------------------- | ------- | ---------- | -------------------------------------------------------------------------- |
| openFDA 404 → `absent`                | `info`  | rate-based | Expected and correct. Individually uninteresting, collectively the corpus. |
| RxNorm identity `200 {}` → `absent`   | `info`  | no         | A bad RxCUI in a URL. Nobody acts.                                         |
| Enrichment `absent`                   | `info`  | no         | Same.                                                                      |
| `unavailable` (any)                   | `warn`  | rate-based | Upstream's problem, not ours — until it is sustained.                      |
| `malformed` (parse failure, non-JSON) | `error` | immediate  | Our model of upstream broke (§1.2).                                        |
| Wrong-TTY assertion throw             | `error` | immediate  | Always our bug. Should never reach production; a test covers it.           |

**`openFDANotFound` alerts on rate, not on occurrence.** One 404 is normal — it
is what a drug without a label looks like. A spike means we broke something: a
field rename takes the 404 rate to roughly 100% instantly. But a _level_ bug only
touches whatever slice of traffic reaches that path, so the total rate may barely
move while the mix of TTYs we are sending shifts visibly. The alert therefore
fires on the 404 rate exceeding baseline over a rolling window **or** on a shift
in the TTY distribution, and the second is why TTY is logged at all.

**Log contents: RxCUI, TTY, field name, timestamp. No user identifiers, no query
strings, no IPs.** An RxCUI is a public drug identifier, not PHI. Stated
explicitly because this is a healthcare project with a threat-model deliverable.

## Consequences

- **Every degradable field needs a three-branch fragment in the UI.** The client
  is wordier, permanently. That verbosity is the guarantee — it is what makes a
  forgotten state a compile error instead of a blank section.
- **Vendor names are user-facing copy.** Adding, swapping or dropping a label
  source is now a copy change as well as a server change.
- **User-facing wording ships from the server.** A copy tweak is a deploy, and
  localisation reopens this decision.
- **An `absent` can be up to a week stale.** A drug that gains a label takes up
  to seven days to show it. Nobody has to intervene, which is the trade.
- **The request path cannot diagnose anything on its own.** `absent` is
  trustworthy _because_ CI ran, so a long gap between deploys is a gap in
  coverage. A scheduled run of the same check closes it, at the cost of leaning
  further on the scheduler ADR-009 introduced.
- **Ingredient-level RxCUIs hard-fail at the openFDA client.** Anything holding
  one must resolve it to products first, and Q2/Q7 do not answer that yet.

## Revisit if

- openFDA gains any signal distinguishing a bad field name from no matches — the
  build-time check could then move back onto the request path, or be dropped.
- An API key raises the 1,000/day cap enough to make a per-404 canary cheap.
- A second label source appears, making openFDA non-critical — which would also
  change the user-facing copy, since the source is named.
- The `openFDANotFound` corpus shows a TTY skew, or a set of drugs that a second
  source would cover.
- Request volume approaches the 1,000/day cap.
