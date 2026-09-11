# ADR-011: Timeout budgets, retries and backoff on the request path

**Status:** proposed
**Date:** 2026-09-11

## Context

[ADR-010](010-upstream-error-taxonomy.md) settled how an upstream failure is
*classified and shown*: `absent` versus `unavailable` versus `malformed`, a union
per degradable field, and `retryable` carried on `Unavailable`. It did not settle
what makes a call fail in the first place. Nothing in ADR-001..010 names a timeout,
a retry count, or a backoff — ADR-009 mentions timeouts only to reject them as an
absence detector, and ADR-003/004 merely *promise* DataLoader without saying what
happens when a batched call hangs.

That gap is the last thing blocking resolvers. `src/server/resolvers.ts` is still
an 8-line `_placeholder` stub, and under `docs/adr/README.md` rule 1 it stays one
until this document exists. A resolver cannot be written without knowing how long
it waits and how many times it asks.

The obvious answer — "set a timeout near p95 so the page stays fast" — is wrong
here, and the measurements below say why.

## Measurements (2026-09-11)

36 sequential samples per endpoint across 18 real RxCUIs spanning six ingredients
(two passes over the set, so the same key is sampled warm and cold), plus a 12-way
concurrent burst. Single machine, single afternoon; per ADR-009's correction, every
figure below is a **floor**, not an average.

| Endpoint | n | p50 | p95 | max | codes |
| --- | --- | --- | --- | --- | --- |
| RxNorm `/rxcui/{id}/properties.json` | 36 | 114 ms | 322 ms | **1197 ms** | 36 × 200 |
| RxNorm `/rxcui/{id}/related.json?tty=` | 36 | 119 ms | 243 ms | 309 ms | 36 × 200 |
| RxNorm `/rxcui/{id}/ndcs.json` | 36 | 118 ms | 226 ms | 275 ms | 36 × 200 |
| openFDA `/drug/label.json` | 36 | **589 ms** | 730 ms | **1757 ms** | 20 × 200, 16 × 404 |
| RxNorm `properties`, 12 concurrent | 12 | 121 ms | 346 ms | 346 ms | 12 × 200 |
| openFDA `label`, 12 concurrent | 12 | 693 ms | 793 ms | 793 ms | 200 / 404 |

**1. The tails are long against very tight bodies.** RxNorm's p50 is 114 ms and 34
of 36 samples land inside ±25 ms of it — then one returns in 1197 ms, a 10×
outlier, **with correct data**. openFDA is the same shape at a different scale:
a 589 ms body and a 1757 ms max. The distributions are not bell-shaped, so a
timeout placed at p95 is not "cutting off the slow 5%," it is cutting off real
successes at a rate the percentile does not describe.

**2. openFDA's typical response is slower than RxNorm's worst-case p95.** 589 ms
against 322 ms. Any single app-wide timeout is either too tight for openFDA or far
too loose for RxNorm; there is no number that is correct for both.

**3. A 404 costs exactly what a 200 costs.** openFDA's 16 404s are distributed
through the same latency band as its 20 successes. This is ADR-009's NADAC finding
in a second place, and it generalises into a rule: **a timeout can never be an
absence detector.** ADR-010's `absent` has to be concluded by exhausting
alternatives — the TTY assertion and the CI field check — never by waiting.

**4. Concurrency is free on both upstreams.** 12 parallel requests cost what 1
costs (RxNorm p50 121 ms vs 114 ms; openFDA 693 ms vs 589 ms). This is the
*opposite* of NADAC, whose sustained paging degraded 3–8× against its spot checks
(ADR-009 finding 4, as corrected). Fanning out the request path is therefore free,
and a concurrency limiter would be solving a problem neither upstream has.

**5. The parallel fan-out is ~700 ms p50** — RxNorm ×3 and openFDA together,
bounded by openFDA. That is 3.5× the 200 ms p95 budget, which confirms the budget
is the **cache's** job (ADR-001's `cacheLife`, and ADR-009's snapshot), not the
timeout's. No timeout value makes a live fan-out meet 200 ms, so tuning one
towards that number is tuning the wrong dial.

**Incidental, and a real trap:** `related.json` without a `tty=` or `rela=`
parameter returns **HTTP 400 on every request**. The first pass of this sweep
scored 36/36 400s and read as an outage. That is our own malformed request, not an
upstream failure, and under ADR-010 it is neither `absent` nor `unavailable` — a
4xx we caused is a bug, and must be loud rather than degraded into a user-facing
absence.

## Options considered

### Option A — No explicit timeouts; take the platform default

Let `fetch` and the runtime decide. No retry logic.

- **For:** No code, no numbers to defend, no configuration to drift. Honest
  baseline: the fan-out is already going behind a cache, so a hang is rare.
- **Against:** The platform default is long, undocumented at our layer, and not
  ours to rely on. A hung upstream holds a render-blocking request open until
  something else gives up, and ADR-010's `unavailable` state then has no trigger
  that ever fires. It makes the degraded path unreachable by the very failure it
  was designed for.

### Option B — One app-wide timeout for every upstream

A single number, set by the slowest source so nothing is unfairly cut.

- **For:** One constant, trivially explained. No per-source table to keep in sync
  with re-measurements.
- **Against:** Finding 2 kills it. Set for openFDA's 1757 ms tail, it lets a hung
  RxNorm call sit for well past twice its real tail before anything happens. The
  single number is not a simplification, it is the worst of each source applied to
  all of them, and re-measuring one upstream would force a renegotiation of all.

### Option C — Per-source timeouts derived from each source's measured tail, one retry, per-attempt deadline

Each upstream gets a timeout at a fixed multiple of its own observed slowest real
success. One retry after a short jittered backoff. The retry gets a fresh full
timeout.

- **For:** The rule is re-derivable rather than negotiated: re-measure a source and
  its number moves, with no argument about the others. Honours the constraint
  finding 1 imposes — never cut off a request that would have returned correct
  data. Streaming absorbs the wait, so the cost is paid in patience rather than in
  wrong answers.
- **Against:** Worst case is long — 5 s+ for RxNorm, 7 s+ for openFDA — and that is
  only tolerable because it is contained to one suspended boundary. Two numbers to
  maintain, and they are only as good as their last measurement. A retry doubles
  the request cost of a failing call against openFDA's 1,000/day unkeyed cap.

### Option D — An overall deadline per operation, shared across attempts

Budget the whole call (say 3 s); attempts draw down from it, and the retry gets
only what is left.

- **For:** Bounds the worst case, which is the strongest thing against Option C.
  Makes the user-visible ceiling a single stated number.
- **Against:** Guarantees the failure mode we just decided is the worst one. A
  retry starting with 800 ms left is cut off at 800 ms — so a request that would
  have succeeded in 1100 ms is killed *because the first attempt was slow*, which
  is the case most likely to be a genuine transient. It optimises a ceiling nobody
  sees (the boundary is already streaming) at the cost of the correctness property
  the whole ADR turns on.

### Option E — Adaptive timeouts or a circuit breaker

Track a rolling latency distribution per source and derive the timeout at runtime;
trip a breaker after N consecutive failures.

- **For:** Self-correcting. Never needs re-measuring by hand, and a breaker stops
  a dead upstream from costing every request 5 s.
- **Against:** Substantial machinery with state to hold, tune, and test, for a
  two-upstream request path that finding 4 shows has no contention. Nothing has
  been observed that it would fix. It is the right answer to a problem we would
  have to see first, and it is recorded in *Revisit if* rather than built.

## Decision

**Each upstream gets its own timeout, set at twice its slowest measured real
success, and a failed call is attempted exactly twice with a short jittered
backoff between, each attempt getting the full timeout** — Option C.

The rule underneath every number: **cutting off a request that would have returned
correct data is the worse failure.** A 1197 ms RxNorm response is not a problem to
be solved, it is correct data arriving late. What a timeout exists to stop is an
upstream that has hung and will never answer.

**The timeout is not the render's defence — streaming is.** ADR-001 commits to
Cache Components and ADR-005 owns the boundaries, so a slow label call suspends
its own boundary while the rest of the page ships. That takes the user-facing job
off the timeout and leaves it one job. It also means the timeout must never be
tuned toward the 200 ms p95 budget: finding 5 shows no value can get a live
fan-out there, and the budget belongs to `cacheLife` and ADR-009's snapshot.

**The budgets — 2× the observed max, rounded.**

| Source | Slowest measured real success | Timeout |
| --- | --- | --- |
| RxNorm (all endpoints) | 1197 ms | **2.5 s** |
| openFDA | 1757 ms | **3.5 s** |

The multiple is the defensible part. 36 samples from one machine on one afternoon
have certainly not seen the slowest real success that exists, so the number sits
above the observed max by a margin wide enough to absorb one, and the derivation is
stated so a re-measurement moves it without reopening the decision. NADAC needs no
entry: ADR-009 keeps it off the request path entirely, and the snapshot job's
timeouts are a batch concern where a slow page costs nobody a render.

**Two attempts, one retry, fresh full timeout on each.** No overall deadline —
that is Option D, and it kills a retry that was about to succeed, which is the one
thing this ADR refuses to do. The stated consequence is the honest one: a fully
failing RxNorm call costs **5 s+** and openFDA **7 s+** before the resolver gives
up.

**A short backoff with jitter before the retry.** At one retry the backoff itself
is nearly inert — the jitter is what earns its place, spreading a simultaneous
fleet-wide failure so the recovering upstream is not hit by a synchronised second
wave. Implementation: a base delay short relative to the timeout it follows, with
full jitter.

**What is retryable is already decided by ADR-010, and this ADR only maps onto
it.** `unavailable` — timeout, network error, 5xx — is the retryable kind, and is
the only one attempted twice. `absent` is a settled fact and is never retried:
openFDA's 404 and RxNorm's `200 {}` are answers, not failures, and finding 3 is why
a timeout can never produce one. `malformed` is never retried, per ADR-010. A 4xx
*we* caused — the `related.json` trap in the measurements — is a bug in our request
and must throw loudly rather than degrade into a user-facing absence.

**No concurrency limiter and no circuit breaker.** Finding 4 shows 12-way
concurrency is free on both sources, so the fan-out runs in parallel unthrottled.

## Consequences

**Easier.** Resolvers become writable: every call site has a number, a retry count,
and a mapping onto ADR-010's kinds. ADR-010's `unavailable` finally has a trigger
that fires, so the degraded path is reachable without fault injection — which is
what the MSW kill-one-upstream test will exercise. Per-source budgets make
re-measurement a local edit rather than a renegotiation.

**Harder.** The worst case is now long and stated — 5 s for RxNorm, 7 s for
openFDA — and it is only tolerable because it is contained to one suspended
boundary, so **ADR-011 depends on ADR-005 actually drawing that boundary.** If a
slow label call ever blocks the whole document, this decision becomes wrong
immediately. Retries double the request cost of a failing openFDA call against a
1,000/day unkeyed cap, and openFDA is per-key by Q4/`api-contract.md:146`, so there
is no batching to absorb it. And two numbers now depend on a measurement that will
age.

**Committed to.** The timeouts are configuration derived from a recorded
measurement, not constants — the table above is their provenance, and changing one
means re-running the sweep rather than picking a new number. The 200 ms p95 budget
is formally the cache's, not the timeout's. A loader or spinner is correct for a
call genuinely in flight and remains wrong for `absent`, per ADR-010 — the
distinction is pending versus settled, and this ADR is the only thing that creates
a legitimately pending state.

## Revisit if

- **A real success is observed beyond a timeout.** That is the signal the 2×
  margin is too thin, and it should surface as a timed-out call to a source that
  is otherwise healthy rather than as a user report.
- **Timeouts start firing at a rate rather than as one-offs.** Per ADR-010's
  logging rule, `unavailable` is a warn and the interesting signal is the *rate* —
  a sustained rate is the evidence that would justify Option E's circuit breaker,
  which is deliberately not built.
- **The one retry proves insufficient or wasteful.** If a second attempt rarely
  succeeds, it is pure latency and should go; if failures routinely need a third,
  the failure is not transient and a breaker is the right answer instead.
- **openFDA request volume nears the 1,000/day cap** — already ADR-010's
  revisit-if, and retries move that ceiling closer.
- **A source's latency distribution shifts materially** on re-measurement, or the
  fan-out stops being bounded by openFDA.
