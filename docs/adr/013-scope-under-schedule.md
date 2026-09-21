# ADR-013: What ships, now that the calendar and the roadmap disagree

**Status:** proposed — options only, no decision

<!-- Roadmap rule 3: the author owns scope and product decisions. This lays the
     options out for that decision; the Decision section is deliberately empty.
     Same shape as ADR-012 (#59 options, #60 decision). -->

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

<!-- Yours. -->

## Consequences

<!-- Written once the decision is made. -->

## Revisit if

- The interview lands, or does not. This whole worksheet exists because a screen
  became likely; if it resolves either way, the forcing function changes.
- The cadence changes materially in either direction. 13 active days in 31 is
  the number every projection here rests on, and it is a small sample.
- **W3 takes materially more or less than 6.5 active days.** It is the first UI
  week, so it is the measurement that tells us whether the per-surface costs
  above are real.
