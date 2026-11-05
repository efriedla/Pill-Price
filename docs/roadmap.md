# RxLens — 8-Week Build Roadmap

**Goal:** a small, deeply-documented project that produces defensible interview evidence for every non-people bullet on the target JD.

**Re-scoped 2026-09-23 — [ADR-013](adr/013-scope-under-schedule.md).** The calendar reached week 5 with W1–W2 done. What ships, in order: search + detail deployed (W3), the performance case study (from W6), the a11y audit against the real build (from W7), then the README and one post (from W8). Everything else below is struck through and dated rather than deleted — deferred, not abandoned. Compare (W4) is the largest cut; ADR-013 is the written answer to why.

**Closed 2026-11-05 — [ADR-013 close-out](adr/013-scope-under-schedule.md#amendment-2026-11-05-close-out).** The author ended the project. Every box below is now either ticked, with its evidence, or cut, with a reason. Two more cuts were made at close-out: **no hosting** (screenshots, local Lighthouse and the local a11y audit stand in for a deployment), and the **performance case study stops at its baseline**. Nothing is open.

**Time budget:** 2 hrs/day focused + 4 hrs/day Claude Code, 5–6 days/week.

**Calibration:** TypeScript, App Router, and GraphQL are not new to you. Week 1 is compressed accordingly and the depth is pushed into the data layer (W2), performance (W6), and the written artifacts.

---

## The Deliverable

The repo is the smaller half. Ship all of this:

- [ ] ~~Deployed app~~ — 4 routes, no auth, no database — **2 routes, not 4** (`/search`, `/drug/[rxcui]`) — [ADR-013](adr/013-scope-under-schedule.md), 2026-09-23. **Built, not deployed — [ADR-013 close-out](adr/013-scope-under-schedule.md#amendment-2026-11-05-close-out).** Evidence instead: [`docs/screenshots/`](screenshots/README.md)
- [x] 8 ADRs — **12 accepted** (001–005, 009–013, 015, 016); ADR-014 left proposed, options only
- [x] API contract document — [`docs/api-contract.md`](api-contract.md)
- [ ] ~~Performance case study (before/after, with numbers)~~ — **the "before" only:** [`docs/performance.md`](performance.md) (BFF p95 22 ms; Lighthouse baseline) — [ADR-013 close-out](adr/013-scope-under-schedule.md#amendment-2026-11-05-close-out)
- [x] Accessibility audit (WCAG 2.2 AA) — [`docs/a11y-audit.md`](a11y-audit.md); no screen-reader pass, stated as its largest gap
- [ ] ~~Threat model~~ — **deferred — [ADR-013](adr/013-scope-under-schedule.md), 2026-09-23**
- [x] `CONTRIBUTING.md` + component API guidelines — its "Components" section
- [ ] PR history with substantive review comments on every PR — **not met as written.** ~108 PRs. Every one not opened by Dependabot has a written description that links its authorizing ADR or states its exemption. Inline review threads are on some, not every one.
- [ ] ~~3 blog posts + 1 eight-minute architecture walkthrough video~~ — **1 post; the other two and the video deferred** — [ADR-013](adr/013-scope-under-schedule.md), 2026-09-23. **The one post is cut too — [ADR-013 close-out](adr/013-scope-under-schedule.md#amendment-2026-11-05-close-out)**

---

## Operating Rules

Non-negotiable. These are what convert "a repo exists" into "I can defend this."

1. **ADR before code.** No feature starts until the decision doc exists: options considered, tradeoffs, choice, consequences. Claude Code implements a decision — it never makes one.
2. **The 2 focused hours are for deciding and writing.** Schema design, ADRs, the perf investigation, the gnarly bug. The 4 delegate hours are execution against decisions already made.
3. **Hand-write the defensible parts.** GraphQL schema, caching strategy, error taxonomy, compare-diff logic, every perf fix, and the Playwright tests for the critical journey. Delegate freely: config, scaffolding, Storybook stories, test boilerplate, codegen wiring, CSS.
4. **Every change is a PR.** Claude Code works on a branch. You review with real inline comments, request changes at least once, then merge. Never commit to `main`.
5. **Explain-back gate.** End each session by writing the PR description from memory with the diff closed. Can't explain why a file changed? Revert it and redo it yourself.
6. **Conventional commits + linked ADR.** Every PR body links the ADR that authorized it. This is the trail you'll walk an interviewer through.

---

## Scope Lock

**In:** `/search`, `/drug/[rxcui]`, `/compare`, `/guides/[slug]` (W7, optional). One GraphQL BFF over RxNorm + openFDA + NADAC.

**Out — do not build these, regardless of how good the idea feels in week 5:** auth, user accounts, a database, a monorepo, mobile app, admin panel, interaction checker, i18n.

**Data honesty requirement:** NADAC is *pharmacy acquisition* cost, not consumer price. The UI must say so plainly, near every price. Ship the disclaimer as its own PR with an ADR — "I shipped a caveat because the data doesn't support the claim users would assume" is a strong healthcare-interview signal.

---

## Week 1 — Foundation

**Focused hours:** ADR-001 (rendering strategy per route), ADR-002 (styling + design tokens), ADR-003 (module boundaries). Sketch the four routes on paper before any component exists.

**Delegate:** Next.js App Router scaffold, TS strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`, Tailwind + token layer, Storybook, GitHub Actions (lint / typecheck / test / build, all required), PR template, CODEOWNERS, Dependabot, `eslint-plugin-boundaries` config.

**Definition of done:**
- [x] CI is green and **blocks merge** on failure — proved by PR #7, opened deliberately red and closed unmerged
- [x] `tsc --noEmit` passes with `strict` + `noUncheckedIndexedAccess`; zero `any` in `src/`
- [x] 4 primitives (Button, Input, Card, Skeleton) in Storybook with controls + a11y addon
- [x] Boundaries lint rule actually rejects a cross-layer import — `tests/boundaries.test.ts`, 17 cases
- [x] ADR-001/002/003 merged — all three accepted 2026-08-25
- [x] `CONTRIBUTING.md` good enough that a stranger could open a PR

---

## Week 2 — The Data Layer (the centerpiece)

This is the week that carries the most interview weight. Spend the focused hours here without exception.

**Focused hours:** Write `schema.graphql` as a document *first* — before a single resolver. Design the error taxonomy: which failures are partial (return data + error field) vs. fatal. Decide cache TTLs per upstream source and justify each in writing.

**Delegate:** GraphQL Yoga in a route handler, resolvers, GraphQL Codegen wiring, upstream clients, MSW fixtures captured from real responses.

**Depth requirements (this is where you earn the seniority signal):**
- DataLoader batching for the N+1 across RxNorm ingredient lookups
- Per-source timeouts + retry with exponential backoff and jitter
- Graceful degradation: openFDA down → page still renders with pricing, surfaces a partial-data notice
- Cache layers: in-memory for hot RxCUIs, `unstable_cache` for NADAC (weekly TTL), no cache for search
- Zod validation at every upstream boundary — upstream JSON is untrusted input

**Definition of done:**
- [x] `api-contract.md` published: every field, its source, its freshness, its failure mode — [`docs/api-contract.md`](api-contract.md); the last two `TTL TBD` cells closed 2026-09-16
- [x] Schema is codegen'd into ~~typed hooks~~ **typed operations**; no hand-written response types — **amended 2026-09-23:** [ADR-005](adr/005-static-dynamic-split.md) has pages execute codegen'd `TypedDocumentNode`s against the schema in-process, and search has no client data layer, so no client hook exists to be typed. The typed-operations half closes when the first page queries through one. **Closed:** `/drug/[rxcui]` and `/search` both run codegen'd documents through `runQuery`. No hand-written response types remain: `DrugSummary` is `Pick<Drug, …>` off the generated SDL types (2026-09-16); `SearchQuery` and `CompareState` stay hand-written on purpose — they are URL state, not responses.
- [x] Kill one upstream in MSW → app degrades gracefully, no crash, user sees why — `tests/kill-one-upstream.test.ts`, 9 cases
- [x] p95 BFF response for a cached drug < 200ms (measure it, record it) — **22 ms**, recorded in [`docs/performance.md`](performance.md)
- [x] ADR-004 (BFF + schema design) merged — accepted 2026-08-25

---

## Week 3 — Search + Detail

**Focused hours:** Decide the streaming boundaries — what's in the Suspense shell vs. what streams in. Decide ~~`generateStaticParams` cutoff (top ~300 RxCUIs by NADAC volume) and defend the number~~ **which pages to prerender, and defend the set — replaced by a small fixed set, [ADR-005](adr/005-static-dynamic-split.md) Q3, 2026-09-23**.

**Delegate:** search UI with debounce + URL sync, detail page layout, NADAC price chart, generic-alternatives section, loading skeletons, error boundaries.

**Definition of done:**
- [x] Search is SSR + streaming; results shell paints before data resolves — `◐ /search` in the build; [`search-loading-*`](screenshots/README.md) shows the shell before the results
- [ ] ~~Detail pages: top 300 static at build, tail via ISR~~ — **replaced — [ADR-005](adr/005-static-dynamic-split.md) Q3, 2026-09-23**
- [x] Detail pages: the fixed prerender set (`src/app/drug/[rxcui]/prerendered.ts`, now `860975`) static at build; every other drug served as an App Shell and upgraded after its first visit — verify by checking build output and a cold-tail request. *Local build 2026-09-28: `○ /drug/860975`, `◐ /drug/[rxcui]`; a cold `/drug/617312` returned 200 in 1.1 s. Tick once the same holds on the deployed build.* **Ticked on the local production build** (there is no deployed one — [ADR-013 close-out](adr/013-scope-under-schedule.md#amendment-2026-11-05-close-out)): rechecked 2026-11-05 at `fbc0f76`, same output.
- [x] Every async surface has an explicit loading, empty, and error state (screenshot all three) — [`docs/screenshots/`](screenshots/README.md), 16 states × 2 widths (#107)
- [x] **Lighthouse baseline recorded and committed** — you need the "before" for W6 — [`docs/performance.md`](performance.md), local production build (#108)
- [x] Acquisition-cost disclaimer shipped — on the home page and above every drug page's price (not dismissible)
- [x] ADR-005 (static/dynamic split) merged

---

## Week 4 — Compare (the complex feature)

**Deferred in full — [ADR-013](adr/013-scope-under-schedule.md), 2026-09-23.** Kept below as written, so the plan and the cut stay side by side.

Your "independently led a complex feature from concept through launch" story.

**Focused hours:** URL-as-state design — how do 4 drug IDs, a sort, and a units toggle serialize into a shareable, back-button-correct URL? Write the diffing logic yourself. Design the empty and partial states deliberately (1 drug selected, 4 selected, one drug missing label data).

**Delegate:** compare table UI, add/remove flow, responsive collapse for mobile, sticky column header.

**Definition of done:**
- [ ] ~~All compare state in the URL — zero `useState` for anything shareable~~ — **deferred — [ADR-013](adr/013-scope-under-schedule.md), 2026-09-23**
- [ ] ~~Back/forward buttons behave correctly through 5+ state changes~~ — **deferred — [ADR-013](adr/013-scope-under-schedule.md), 2026-09-23**
- [ ] ~~Copy the URL into a fresh incognito window → identical view~~ — **deferred — [ADR-013](adr/013-scope-under-schedule.md), 2026-09-23**
- [ ] ~~Handles 1–4 drugs and missing-data rows without layout break~~ — **deferred — [ADR-013](adr/013-scope-under-schedule.md), 2026-09-23**
- [ ] ~~Usable at 320px width~~ — **deferred — [ADR-013](adr/013-scope-under-schedule.md), 2026-09-23**
- [ ] ~~ADR-006 (URL-as-state over client store) merged — explicitly address why not Redux~~ — **deferred — [ADR-013](adr/013-scope-under-schedule.md), 2026-09-23**

---

## Week 5 — Testing

**Focused hours:** Write the Playwright specs for the three critical journeys yourself. Decide what is *not* worth testing and write that down — knowing what to skip is a senior signal.

**Delegate:** Vitest + RTL setup, MSW server, unit tests for diffing/formatting/URL serialization, Storybook interaction tests, `jest-axe` in CI.

**Three critical journeys:** search → detail; detail → add to compare → compare view; shared compare URL → cold load.

**Definition of done:**
- [ ] ~~Coverage floor set in CI, then **raised in a separate follow-up PR** so the history shows improvement~~ — **deferred — [ADR-013](adr/013-scope-under-schedule.md), 2026-09-23**
- [ ] ~~3 Playwright journeys green in CI against a production build~~ — **deferred — [ADR-013](adr/013-scope-under-schedule.md), 2026-09-23**
- [ ] ~~`jest-axe` fails the build on a violation (prove it)~~ — **deferred — [ADR-013](adr/013-scope-under-schedule.md), 2026-09-23**
- [ ] MSW covers every upstream failure mode from W2 — **closed as is, not verified mode by mode — [ADR-013 close-out](adr/013-scope-under-schedule.md#amendment-2026-11-05-close-out).** `tests/kill-one-upstream.test.ts` takes each upstream down and checks the app degrades with a stated reason; `npm run check:build-degradation` does the same for a build. Nobody has mapped the tests to every row of ADR-010's taxonomy.
- [ ] ~~`testing-strategy.md`: what's tested, at what level, and what's deliberately not~~ — **deferred — [ADR-013](adr/013-scope-under-schedule.md), 2026-09-23**

---

## Week 6 — Performance + Observability

The week that produces your best interview artifact.

**Focused hours:** The optimization pass itself. Profile before changing anything. Form a hypothesis, change one thing, measure, record. Keep a running log including the changes that *didn't* help — that log is the case study.

**Delegate:** Sentry with source maps + release tracking, Web Vitals reporting, Lighthouse CI config, bundle analyzer, `next/font` and image optimization.

**Definition of done:**
- [ ] ~~Lighthouse CI budgets **fail the build** when exceeded~~ — **deferred — [ADR-013](adr/013-scope-under-schedule.md), 2026-09-23**
- [ ] ~~Bundle-size check in CI with a hard ceiling~~ — **deferred — [ADR-013](adr/013-scope-under-schedule.md), 2026-09-23**
- [ ] ~~Sentry catching real errors with readable stack traces from the deployed build~~ — **deferred — [ADR-013](adr/013-scope-under-schedule.md), 2026-09-23**
- [ ] ~~Web Vitals flowing to a dashboard you can screenshot~~ — **deferred — [ADR-013](adr/013-scope-under-schedule.md), 2026-09-23**
- [ ] ~~`performance-case-study.md`: before/after LCP, INP, CLS, TBT, bundle size — plus two things you tried that didn't work and why~~ — **baseline only**, in [`docs/performance.md`](performance.md) — [ADR-013 close-out](adr/013-scope-under-schedule.md#amendment-2026-11-05-close-out)
- [ ] ~~ADR-007 (perf budgets + enforcement) merged~~ — **deferred — [ADR-013](adr/013-scope-under-schedule.md), 2026-09-23**

---

## Week 7 — A11y, Security, and (optional) Contentful

**Focused hours:** Manual screen-reader pass — VoiceOver or NVDA, keyboard only, no mouse, all four routes. Write the threat model yourself.

**Delegate:** focus management fixes, skip links, ARIA corrections, CSP with nonces, security headers, BFF rate limiting, Contentful models + page-builder mapping if you take the option.

**Definition of done:**
- [x] `a11y-audit.md`: WCAG 2.2 AA, what failed, what you fixed, what's a known gap and why — [`docs/a11y-audit.md`](a11y-audit.md)
- [x] Full keyboard traversal of all routes with a visible focus ring throughout — `npm run keyboard-walk`: 93 stops on 7 pages, all visible — **kept, for the two shipped routes** — [ADR-013](adr/013-scope-under-schedule.md)
- [ ] ~~CSP with nonces, no `unsafe-inline`, verified in the deployed build~~ — **deferred — [ADR-013](adr/013-scope-under-schedule.md), 2026-09-23**
- [ ] ~~BFF rate-limited; Zod rejects malformed input at every boundary~~ — **rate limiting deferred; the Zod half is not decided by ADR-013** — [ADR-013](adr/013-scope-under-schedule.md), 2026-09-23. **Zod half cut — [ADR-013 close-out](adr/013-scope-under-schedule.md#amendment-2026-11-05-close-out)**
- [ ] ~~`threat-model.md` — including why the app stores nothing sensitive, and what that decision buys~~ — **deferred — [ADR-013](adr/013-scope-under-schedule.md), 2026-09-23**
- [ ] ~~*Optional:* `/guides/[slug]` from Contentful with draft preview + webhook ISR revalidation, ADR-008~~ — **deferred — [ADR-013](adr/013-scope-under-schedule.md), 2026-09-23**

**Cut rule:** if W1–6 slipped at all, skip Contentful entirely. A shallow CMS integration is worth less than a finished, polished app.

---

## Week 8 — Ship and Communicate

**Focused hours:** all of it. This week is writing, not code.

**Definition of done:**
- [ ] ~~Deployed, custom domain, no console errors, no Sentry noise~~ — **deploy kept; Sentry deferred** — [ADR-013](adr/013-scope-under-schedule.md), 2026-09-23. **Deploy cut — [ADR-013 close-out](adr/013-scope-under-schedule.md#amendment-2026-11-05-close-out)**
- [x] README: what it is, architecture diagram, data sources, local setup, the honest limitations
- [ ] ~~8-minute Loom walkthrough: problem → architecture → one hard tradeoff → results. Linked in the README and on your resume.~~ — **deferred — [ADR-013](adr/013-scope-under-schedule.md), 2026-09-23**
- [ ] ~~3 posts drawn from ADRs.~~ ~~**One post**~~ **cut — [ADR-013 close-out](adr/013-scope-under-schedule.md#amendment-2026-11-05-close-out).** Was: **One post** — [ADR-013](adr/013-scope-under-schedule.md), 2026-09-23; which one is chosen once the case study and audit exist. Suggested: (1) designing a GraphQL BFF over three uncooperative REST APIs, ~~(2) URL-as-state instead of a client store~~ (compare deferred), (3) the performance case study.
- [x] Resume bullets rewritten to cite specific numbers ~~from the case study~~ — drafted at close-out from the measured numbers; the case study was cut

---

## Parallel Track — the people bullets

Code cannot produce these. One hour a week, starting week 1. **Not done, and outside the repo: left open at close-out, not cut.** They are the author's to pick up or drop.

- [ ] **Mentoring:** ADPList sessions or substantive reviews on open-source PRs. Target 6+ real reviews by W8. Log each one — you need two concrete stories.
- [ ] **Distilling complex topics:** the 3 posts and the Loom cover this. Have a non-engineer read one post and tell you where they got lost, then fix it.
- [ ] **Standards influence:** your `CONTRIBUTING.md`, component API guidelines, and lint config are the evidence. Polish them like they're going to be read — because they are.

---

## JD Bullet → Evidence Map

Rehearse until you can name the artifact for each without hesitating.

**After ADR-013,** several rows below point at deferred work. Its Consequences section has the current map: *Complex feature* is answered by ADR-013 itself, *Evaluating new tech* falls back to ADR-012, and *3rd-party SDKs* / *Observability* have no artifact.

| JD requirement | Your evidence |
|---|---|
| Scalable frontend architecture | ADR-001/003/005, boundaries lint |
| Frameworks, components, services | Design tokens, Storybook, BFF |
| Coding standards & best practices | `CONTRIBUTING.md`, component guidelines, strict TS |
| CI/CD + dev workflows | Actions pipeline, Lighthouse CI, coverage gate |
| Unit tests + improving coverage | Vitest suite, coverage-raise PR |
| Code reviews | PR history with inline review threads |
| Evaluating new tech / POCs | ADR-006 with the alternatives analysis |
| Complex feature end to end | Compare (W4) |
| Collaborating on API design | `api-contract.md` + schema-first process |
| Next.js SSR/SSG/perf | ADR-005 + performance case study |
| Performance, a11y, web standards | Case study, a11y audit, CSP |
| REST + GraphQL integration | BFF over three REST sources |
| 3rd-party SDKs | Sentry, Web Vitals, Contentful |
| Complex systems: perf/scale/reliability | Caching layers, degradation, retry logic |
| Observability *(good to have)* | Sentry + Vitals dashboard |
| CMS *(good to have)* | Contentful guides (W7, optional) |
| Security controls | Threat model, CSP, Zod, rate limiting |

---

## Weekly Retro

Friday, 20 minutes, in the repo as `retros.md`:

1. What did I build that I could **not** explain to an interviewer right now?
2. Which artifact is furthest behind?
3. What am I cutting next week to protect the finish?

If the answer to #1 is ever more than one item, spend Monday's focused hours re-doing it by hand instead of moving forward.
