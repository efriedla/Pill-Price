# ADR-013: What ships, now that the calendar and the roadmap disagree

**Status:** accepted
**Date:** 2026-09-21 (options), 2026-09-23 (decided)

<!-- Roadmap rule 3: the author owns scope and product decisions. Options in
     #63, decision here. Same shape as ADR-012 (#59 options, #60 decision). -->

## Context

This is not an architecture decision, and it is in `docs/adr/` anyway. ADR-012
set the precedent in its own words: the deliverable's "no auth, no database"
line "is a scope commitment, not a technical one, so it is the author's to
relax; but it should be relaxed on purpose and in writing, not by the storage
layer quietly becoming Postgres." The same applies to a schedule. Scope that
slips silently is scope nobody chose.

The roadmap is an 8-week plan that began **2026-08-21**. Today is
**2026-09-21**: day 31, **calendar week 5 of 8**. The work completed is weeks 1
and 2.

So three roadmap weeks remain on the calendar and six remain on the board.

### What is measured

Counted from git and the merged-PR history, not estimated:

| Quantity | Figure |
| --- | --- |
| Calendar days elapsed | 31 |
| **Days with a merged PR** | **13** |
| Merged PRs | 58 |
| Roadmap weeks delivered | 2 (W1, W2) |
| Unit tests / Storybook tests | 190 / 30 |
| ADRs accepted | 8 (001–004, 009–012) |

**The gap is not pace, it is cadence.** 58 PRs across 13 active days is ~4.5
merged PRs on a day work happens — that is not slow. Work happened on 42% of
the calendar days available. A roadmap "week" has cost about **6.5 active
days**, which is roughly what a week of focused evenings and weekends is.

Projected on the observed cadence, W3–W8 is ~39 active days ≈ **13 more
calendar weeks**, finishing around **late December 2026**.

Two things that could move that, in opposite directions and neither measured:

- **Faster:** the design system, CI, module boundaries, error taxonomy and data
  layer are all done. W3–W4 consume that work rather than creating it, and the
  hardest architectural questions are behind rather than ahead.
- **Slower:** W1 and W2 are the two weeks that had *no UI*. Screenshots,
  keyboard passes, 320px checks and three explicit states per async surface are
  per-surface costs that the last five weeks never paid.

### The forcing function

A phone screen may land within weeks. That changes what the deliverable is for:
not "the plan, completed", but "what a screener can click on and what I can
talk about". Those are not the same list, and the roadmap was written before
this was a live question.

### What each deliverable is actually worth in a screen

Stated as a judgement, not a measurement, and the one most worth arguing with:

| Deliverable | Clicked on | Talked about |
| --- | --- | --- |
| Deployed app | **High** — the first and sometimes only thing opened | Medium |
| PR history + ADRs | Low | **High** — already the strongest thing here |
| Walkthrough video | Medium | **High** |
| README | **High** | Medium |
| A11y audit | Low | **High** for a frontend role |
| Performance case study | Low | **High** — the 22 ms number needs a before/after |
| Threat model | Low | Medium |
| Compare feature | Medium | **High** — it is the URL-as-state story |
| Blog posts | Low | Medium |
| Contentful guides | Low | Low — already marked optional |

The asymmetry worth noticing: **the repo is already strong on the things that
get talked about and empty on the thing that gets clicked.** There is no
deployed app and no UI at all.

## Options considered — Q1: what does "done" mean now

### Option A — hold the scope, move the date

Finish all eight weeks as written. Ship around late December on the measured
cadence.

- **For:** the deliverable list is the deliverable list. Every artifact on it
  exists for a reason, and a half-built version of it is a weaker story than a
  complete one that took longer. Nothing is cut, so nothing has to be defended
  as cut.
- **Against:** it fails the forcing function completely. If a screen lands in
  October there is still no app to open, and "it's a data layer with twelve
  ADRs" is a hard thing to show someone in five minutes. It also assumes the
  cadence holds for thirteen more weeks, which is a long time for a side
  project to keep 42% of days active.

### Option B — hold the date, ship a vertical slice

Three weeks: search + one detail page, deployed, with a README and the
walkthrough video. Everything else is cut — compare, Playwright, Lighthouse CI,
Sentry, the a11y audit, the threat model, the posts.

- **For:** it produces the missing thing — a URL a screener can open — inside
  the original 8-week window. One route done properly with real data, real
  degradation and the acquisition-cost disclaimer demonstrates the whole stack.
- **Against:** it cuts the a11y audit and the performance case study, which the
  table above rates **High** for exactly the roles this is aimed at. It also
  cuts compare, and compare is the URL-as-state story — the second of the three
  planned blog posts and one of the better interview answers available here.
  Three weeks is also the estimate most likely to be wrong, since it is the
  first UI work on the project.

### Option C — hold the date, ship the repo as the artifact

Deploy nothing. Finish the documentation set — a11y and threat model written
against the design rather than a build, the posts drawn from the ADRs — and
present the repo and its PR history as the deliverable.

- **For:** it plays to what is measurably strongest. 58 reviewed PRs, 8 ADRs,
  190 tests and a measured 22 ms p95 is a real body of evidence, and it is
  *finishable* in three weeks because it needs no new surface.
- **Against:** an a11y audit of an app that does not exist is not an audit, and
  a reviewer will know. It also concedes the "Deployed app" line on the
  deliverable list rather than moving it, and that line is the one with the
  highest click-through in the table above. Hard to tell a screener "it isn't
  running anywhere" without it sounding like the project stalled.

### Option D — rebalance by value, not by week order

Ignore the W3–W8 sequence. Pick the deliverables that rate High in either
column and build only those, in dependency order: search + detail deployed,
then the a11y audit against the real build, then one post. Explicitly drop
compare, Contentful, Sentry, Playwright, and the performance case study's
before/after.

- **For:** it is the only option that optimises for the thing the deliverable
  was always *for* — the roadmap's own framing is that the repo is the smaller
  half and the evidence is the point. It keeps the a11y audit, which is High
  for a frontend role and cheap once a real page exists.
- **Against:** it abandons the roadmap's week structure, which has itself been
  a working artifact — the weekly DoD is why W1 and W2 closed with evidence
  rather than vibes. Dropping the performance case study also strands the 22 ms
  measurement, which is currently a number with no story around it. And
  "dropped compare" needs an answer in an interview, because the roadmap
  calls it the complex feature.

## Options considered — Q2: does the 8-week frame survive

Only live if Q1 is B, C or D — Option A answers this by moving the date.

- **Rename the window.** Call it what it has been: an 8-week plan executed at
  part-time cadence. The honest version is "eight weeks of work over four
  months", which is not a worse story and is a true one.
- **Keep the 8 weeks and mark the remainder explicitly deferred.** A roadmap
  with W5–W8 struck through and dated is itself evidence of scoping under
  constraint — arguably a better artifact than a plan that was silently
  abandoned.
- **Re-cut into a 12-week plan** with the remaining work re-sequenced by the
  value table rather than by the original order.

## Decision

**Q1: Option D, plus the performance case study. Q2: keep the 8-week frame
and mark the rest deferred.**

The target is the JD this project was started for: a senior frontend role
centred on Next.js, performance and accessibility. Measured against the
roadmap's JD → evidence map, Option D as written left two core rows with no
evidence: "Complex feature end to end" (compare) and "Next.js SSR/SSG/perf"
(the case study). Both could not come back without giving up the date, so one
did. **The performance case study comes back and compare stays dropped.** Once
a real page exists the case study is cheap. It also gives the 22 ms figure a
before and after, and it is the stronger of the two for this JD.

### What ships, in dependency order

1. **Search + drug detail, deployed.** This is the W3 definition of done as
   written: streaming search, the static/tail split for detail pages, three
   explicit states per async surface, the acquisition-cost disclaimer, and
   ADR-005. W3 already requires the Lighthouse baseline, and the case study
   needs it as its "before".
2. **Performance case study.** `performance-case-study.md` from W6: profile
   first, change one thing at a time, and report before and after for LCP, INP,
   CLS, TBT and bundle size, including the things that did not help.
3. **Accessibility audit against the real build.** `a11y-audit.md` from W7:
   WCAG 2.2 AA, a manual screen-reader pass and a keyboard-only traversal of
   the two shipped routes.
4. **README + one post.** The README from W8, since it is what a screener opens
   first. One post, chosen from the ADRs once the three items above exist.

### Deferred

**Deferred, not abandoned.** Each stays in the roadmap, marked with this ADR
and dated:

- `/compare` and ADR-006 (all of W4)
- Playwright journeys, the coverage floor and its raise, `testing-strategy.md`
  (W5)
- Sentry, Web Vitals dashboard, Lighthouse CI budgets, bundle-size ceiling,
  ADR-007 (the rest of W6)
- Threat model, CSP with nonces, BFF rate limiting (the rest of W7)
- Contentful and ADR-008 (already optional; the W7 cut rule has triggered)
- The walkthrough video and the other two posts (the rest of W8)

Option D named some of these and left the rest unmentioned. For the
unmentioned ones, the rule applied was: **keep only what an item on the ship
list depends on.** The README is kept because it is the first thing opened.
Everything else waits.

### Q2: how the roadmap records this

The roadmap keeps its eight weeks. Deferred definition-of-done items are
marked deferred with a link to this ADR rather than deleted, so the plan and
what was cut from it stay visible. That edit is a follow-up PR, made after
this decision is accepted, so the list above can still change in review.

### Rejected

- **A: hold scope, move the date.** It leaves nothing to open if a screen
  lands in October.
- **B: vertical slice.** It drops the a11y audit, which rates High for this JD.
- **C: the repo is the artifact.** An a11y audit of an app that does not exist
  is not an audit.
- **D as written.** It leaves "Next.js SSR/SSG/perf" with no evidence.
- **D + perf + compare.** It covers every core JD row, but compare costs a full
  roadmap week and the date slips again.

## Consequences

**The JD evidence map, after this decision.**

| JD requirement | Evidence now |
| --- | --- |
| Complex feature end to end | **Gone.** The answer is this ADR: the feature was cut on purpose, with the reasoning in writing. |
| Evaluating new tech / POCs | ADR-006 is deferred. **ADR-012 stands in**: four options, measured, one taken. |
| Next.js SSR/SSG/perf | ADR-005 + the performance case study, both kept |
| Performance, a11y, web standards | Case study + a11y audit; CSP deferred |
| CI/CD + dev workflows | The existing Actions pipeline; Lighthouse CI deferred |
| 3rd-party SDKs, Observability | **Empty.** Sentry, Vitals and Contentful are all deferred. Two of the three were good-to-haves. |
| Security controls | Zod at every boundary; threat model, CSP and rate limiting deferred |

**Committed to.** "Why is there no compare?" is now a question with a written
answer, and the answer has to be rehearsed like any other artifact on the map.

**Not claimed.** This does not fit in the original window. W3 alone is ~6.5
active days on the measured cadence, and the three items after it are
estimated, not measured, at roughly the same again. At 42% of days active that
is **about five calendar weeks, landing late October 2026**, against a window
that closes 2026-10-16. The first clickable URL comes at the end of step 1,
about 2–3 weeks out. That is the milestone the forcing function actually cares
about.

## Revisit if

- The interview lands, or does not. This whole worksheet exists because a screen
  became likely; if it resolves either way, the forcing function changes.
- The cadence changes materially in either direction. 13 active days in 31 is
  the number every projection here rests on, and it is a small sample.
- **W3 takes materially more or less than 6.5 active days.** It is the first UI
  week, so it is the measurement that tells us whether the per-surface costs
  above are real.
