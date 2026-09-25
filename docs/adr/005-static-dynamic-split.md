# ADR-005: Static/dynamic split for /search and /drug/[rxcui]

**Status:** accepted
**Date:** 2026-09-23 (options), 2026-09-23 (decided)

<!-- Roadmap rule 3: the author owns these decisions. Options in #69,
     decision here. Same shape as ADR-012 (#59/#60) and ADR-013 (#63/#67). -->

## Context

ADR-001 set the model: Cache Components on, a prerendered shell for every
route, upstream data inside `use cache` functions, and dynamic only where a
written reason says so. It deferred the detail of two routes to this ADR.
ADR-013 then made those two routes the whole of the shipped app.

The roadmap asks W3 two questions: where the Suspense boundaries go, and how
many detail pages to prerender. It suggests "top ~300 RxCUIs by NADAC volume"
and asks for the number to be defended. Working through them turned up four
questions, not two. The last three depend on the first.

### What was checked, not assumed

1. **NADAC has no volume.** The live 2026 dataset has 12 columns:
   `as_of_date`, `classification_for_rate_setting`,
   `corresponding_generic_drug_effective_date`,
   `corresponding_generic_drug_nadac_per_unit`, `effective_date`,
   `explanation_code`, `nadac_per_unit`, `ndc`, `ndc_description`, `otc`,
   `pharmacy_type_indicator`, `pricing_unit`. None of them counts
   prescriptions. The roadmap's ranking cannot be built from NADAC.
2. **A real utilization source exists on the same host.** data.medicaid.gov
   publishes *State Drug Utilization Data* per year, 2021–2026. The 2025
   dataset has 5,308,547 rows keyed by `ndc`, with `number_of_prescriptions`
   per state per quarter. 320,609 of those rows are national totals
   (`state = XX`). 2,670,330 rows use `suppression_used = true` (CMS hides
   counts under 11). That affects the tail, not a top-300. It counts
   **Medicaid** prescriptions, which is not the same population as all
   prescriptions.
3. **The installed Next is 16.3.4.** From 16.3, a detail page that was not
   prerendered is served as an instant App Shell, and the params stream in.
   After the first visit, Next renders it in the background and later visitors
   get the static result
   (`docs/01-app/02-guides/incremental-static-regeneration-cache-components.md`).
   That behaviour also needs `partialPrefetching: true`, which is **not** set in
   `next.config.ts` today.
4. **`generateStaticParams` must return at least one param** under Cache
   Components. An empty array is a build error
   (`docs/01-app/03-api-reference/04-functions/generate-static-params.md`).
   "Prerender nothing" really means "prerender a small fixed set".
5. **Server Components must not fetch our own `/api/graphql`.** From
   `docs/01-app/02-guides/backend-for-frontend.md`: for pages prerendered at
   build time, "using Route Handlers will fail the build step", because no
   server is listening during a build.
6. **Prerendering calls live upstreams at build time.** openFDA allows 1,000
   requests a day per IP without an API key (upstream-notes §2.5), and
   `openfda-client.ts` sends none. CI runs `npm run build` on every PR push,
   and each prerendered detail page makes at least one openFDA label call.
7. **A failed upstream call is not cached as data.** `requestUpstream` throws
   after its retries, and the throw leaves `cachedLabels` without storing
   anything. **Not verified:** what the prerendered *page* does with it. A
   build during an openFDA outage may still bake a degraded label section into
   a static page. That needs a test, not an assumption.
   **Measured 2026-09-25 (`npm run check:build-degradation`):** worse than
   feared, then fixed. Next fails a prerender on any error thrown inside a
   `use cache` function, caught or not, so an openFDA outage failed the
   whole build, and at request time the thrown error arrived obfuscated, so
   the label boundary errored instead of rendering `Unavailable`. Fixed in
   #85 (outages cross the cache as values). Now the build succeeds, and the
   static page holds the label fallback, with no outage sentence baked in.

## Q1 — How do Server Components reach the schema?

This comes first because the last three questions assume an answer to it.

### Option A — In-process GraphQL with typed documents

Pages run `graphql.execute` against `schema` directly, with query documents
compiled to `TypedDocumentNode`s by codegen. No HTTP. `app → server` is already
a granted edge (ADR-003), so a page can import the schema.

- **For:** the UI goes through the same contract `api-contract.md` documents,
  so the schema stays the only interface to the data. Query results are typed
  by codegen, not by hand. The DataLoaders and error unions work unchanged.
- **Against:** every request pays for GraphQL parsing and validation that an
  in-process caller doesn't need. There is still no client hook, so the
  "typed hooks" half of W2's definition of done still has no consumer.

### Option B — Call the server functions directly

Pages import the loaders and `cached*` functions and assemble their own
props.

- **For:** the fastest and simplest path, with the least new machinery.
- **Against:** the schema becomes something only `/api/graphql` uses, and no
  page does. The error taxonomy (ADR-010) lives in the resolvers, so each page
  would have to re-apply it or skip it. That is how two versions of "what a
  missing label means" appear.

### Option C — Client-side hooks over `/api/graphql`

Pages ship a shell; client components fetch with codegen'd hooks.

- **For:** it closes the "typed hooks" definition-of-done item exactly as
  written.
- **Against:** it is ADR-001's rejected Option D in another form. The label
  text leaves the HTML, LCP waits on a client round trip, and there is nothing
  to prerender.

## Q2 — Where do the Suspense boundaries go on /drug/[rxcui]?

Most of this only shapes the **first** visit to an unlisted page, and anything
uncached. Once all the data is in `use cache`, the page upgrades to fully
static after that visit (finding 3). Under ADR-010, failures are data, not
throws, so these boundaries are about latency, not errors. The `params` read
has to happen inside a boundary either way, or it ties the App Shell to one
URL.

### Option A — One boundary around the page body

Header and disclaimer in the shell; everything else behind one skeleton.

- **For:** one loading state to design and screenshot, and no layout shift
  between sections.
- **Against:** the whole page waits for the slowest source, which is the openFDA
  label (118 KB for one label, upstream-notes §2.3). The price, the reason the
  app exists, waits for prose.

### Option B — By source and latency (three boundaries)

1. Identity and price (RxNorm properties + the NADAC snapshot).
2. Ingredients and alternatives (one shared `allrelated` call).
3. Label prose (openFDA).

- **For:** the boundaries follow the fan-out's real shape, so the price paints
  before the label. It is three loading states, not seven, and each has one
  upstream to blame.
- **Against:** three skeletons have to hold their space or the layout jumps.
  With `PriceHeader` sticky on desktop, that matters.

### Option C — One boundary per component

Each of the ui-spec §7 components suspends on its own.

- **For:** each section appears as soon as it can. It maps one-to-one onto the
  Storybook states the spec already asks for.
- **Against:** several sections share one upstream call. Ingredients and
  alternatives both read `allrelated`, so their separate boundaries resolve
  together anyway. It is more fallbacks, more CLS risk and more screenshots,
  for no earlier paint.

## Q3 — Which detail pages are prerendered, and how many?

After finding 3, the prerender list only speeds up the **first** visit to each
page per deployment. Every other page gets an instant shell and upgrades on its
own. So this list trades build time and upstream quota for a better first
visit. It is not about whether a page works.

### Option A — A small fixed set

A handful of RxCUIs committed to the repo: the ones in the demo, the
walkthrough and the screenshots. The minimum under finding 4 is one.

- **For:** it costs almost nothing at build and stays well inside openFDA's
  keyless quota. The pages a screener is shown are exactly the ones already
  warm.
- **Against:** it doesn't answer the roadmap's "defend the number" on the
  roadmap's terms. The number is chosen by hand, not measured.

### Option B — Ranked by Medicaid utilization

The weekly snapshot job also pages the national rows of State Drug Utilization
Data, sums `number_of_prescriptions` by NDC, maps the top NDCs to RxCUIs through
RxNorm, and writes the ranked list to a file that `generateStaticParams` reads.
N is chosen against build time and quota.

- **For:** a real ranking, defensible with a number and a source. It runs at
  job time, not on the request path, and uses the same DKAN host and paging
  code as NADAC.
- **Against:** it is a fourth upstream, and ADR-009's rules for a new dataset
  (pinning, the yearly rollover) would apply to it too. Medicaid volume is
  skewed and should not be described as "most popular" without that caveat.
  Prerendering N pages makes about N openFDA calls per build, so it needs an
  API key in CI or a small N.

### Option C — A proxy from data already held

Rank by how many NADAC NDCs share a description, as a stand-in for "widely
made".

- **For:** no new source.
- **Against:** that measures how many packages a drug comes in, not how often
  it is prescribed. It would be a number presented as something it isn't, which
  is the kind of claim this app was built to avoid.

## Q4 — How does /search render?

`searchParams` is runtime data, so the results have to sit in a Suspense
boundary. The static shell is the input and the page frame. RxNorm search takes
110–250 ms warm and about 1.2 s cold (upstream-notes §1), and ADR-001 leaves
search uncached.

### Option A — Server-rendered results, URL as the only state

The input updates `?q=` with a debounced `router.replace`. The page re-renders
on the server and the results stream in behind the boundary.

- **For:** the roadmap's "Search is SSR + streaming" is met literally. A pasted
  URL renders complete results with no client JavaScript. There is no client
  data layer, and the query keeps one code path.
- **Against:** every debounced keystroke is a server round trip, with no client
  cache to answer a repeated query.

### Option B — Client-fetched results

The shell renders on the server; results come from a client hook over
`/api/graphql`.

- **For:** it gives "typed hooks" a real consumer, and fast repeat queries from
  a client cache.
- **Against:** a pasted `?q=` URL paints a skeleton and then fetches. That fails
  "results shell paints before data resolves" in spirit, since there is no
  server data behind the shell at all.

### Option C — Hybrid

Server-render the initial `?q=`, then switch to client hooks for typing.

- **For:** complete first loads and a fast typing loop.
- **Against:** two code paths for one query, which must render the same result.
  That is the class of bug Option A cannot have.

## What some answers force

- **Q1 A or B, together with Q4 A**, leaves the W2 "typed hooks" item with no
  consumer permanently. That line would need amending: typed *operations*
  rather than hooks. Under the amendment rule that is a decision change, so it
  gets its own code-free PR.
- **Q3 B** makes the utilization dataset a fourth upstream, which reopens
  ADR-009's pinning and rollover rules for it.
- **Any Q3 option** turns on `partialPrefetching` (finding 3), and needs the
  build-time degradation test from finding 7 before the first deploy.

## Decision

**Q1 A, Q2 B, Q3 A, Q4 A.** Pages query the schema in-process. The drug page
has three boundaries, by source. A small fixed set of drug pages is
prerendered. Search is server-rendered with the URL as its only state.

1. **Q1: in-process GraphQL with typed documents.** Pages `execute` codegen'd
   `TypedDocumentNode`s against `schema`, with a fresh context (and so fresh
   DataLoaders) per request. Nothing on a page imports a loader or a
   `cached*` function directly. The schema is the only way the UI reaches data.
2. **Q2: three Suspense boundaries on `/drug/[rxcui]`, by source.** Identity
   and price; then ingredients and alternatives; then label prose. The header
   frame and the acquisition-cost disclaimer sit in the static shell, and
   `params` is read inside the first boundary. Each fallback reserves its
   section's space, because the sticky `PriceHeader` makes any jump visible.
3. **Q3: a small fixed prerender set, committed to the repo.** It starts as
   **860975** (metformin ER 500 MG), the drug the repo already measures and
   documents. Other drugs are added only when a screenshot, demo or the
   walkthrough uses them. The set is a named file, not a literal inside
   `generateStaticParams`, so every addition is its own diff with a reason.
   `partialPrefetching: true` is turned on with it. Everything else is served
   as an App Shell and upgraded after its first visit.
4. **Q4: `/search` is server-rendered, and the URL is its only state.** The
   input writes `?q=` through a debounced `router.replace`. The results read
   `searchParams` inside a Suspense boundary and stream in. There is no client
   data layer and no client cache.

### Rejected

- **Q1 B** (direct server functions): the page would bypass ADR-010's error
  taxonomy, and the schema would stop being the contract. **Q1 C** (client
  hooks): ADR-001's rejected SPA option in another form.
- **Q2 A** (one boundary): the price waits for the label. **Q2 C** (one per
  component): more fallbacks, and no earlier paint, because sections share
  upstream calls.
- **Q3 B** (Medicaid utilization ranking): a real ranking, but it adds a
  fourth upstream for a first-visit speedup, which is the only thing the list
  buys under 16.3. It stays the answer if the list ever needs defending by
  volume. **Q3 C** (NADAC package-count proxy): it would present a count of
  packages as popularity.
- **Q4 B** (client-fetched): a pasted URL paints no data. **Q4 C** (hybrid):
  two code paths for one query.

## Consequences

**Easier.** One way to reach data, one error taxonomy, one set of types.
Every page and the `/api/graphql` route run the same resolvers, so a test
against the schema covers what the UI shows. The build stays small and far
inside openFDA's keyless quota.

**Harder.** Each search keystroke that settles costs a server render, with no
client cache in front of it. That is the cost Q4 A accepts, and W6 can measure
it. The three drug-page fallbacks each have to hold their layout, and each
needs its loading, empty and error states in Storybook (W3's definition of
done).

**Committed to, before the first deploy.**

- **The build-time degradation test** from finding 7: build with openFDA
  failing, and prove what the prerendered page holds. Until it passes, a build
  during an outage may bake a degraded page for a week.
- **`partialPrefetching: true`** in `next.config.ts`. Without it the on-demand
  App Shell described in finding 3 is not served.

**Forced by this decision: the W2 "typed hooks" line.** Q1 A with Q4 A leaves
no client hook anywhere, so W2's definition of done cannot close as worded.
The honest replacement is typed *operations* (codegen'd documents executed
in-process). That changes a definition of done, so under the amendment rule it
goes in its own code-free PR, not here.

**Not decided here.** Where the app is hosted, and so where the NADAC snapshot
file lives in production (ADR-012 left this open). The first deploy needs it
answered.

## Revisit if

- A screener-facing page loads slowly on its first visit after a deploy. That is
  the only thing the prerender list buys.
- openFDA's keyless quota is hit by CI builds.
- A second consumer of the schema appears (ADR-004's revisit condition). That
  changes the weight on Q1.

## Amendment, 2026-09-23: what a fallback shows

**Status:** accepted. Decided by the author in conversation on 2026-09-23.
Code-free under the amendment rule.

Q2 B said each of the three fallbacks reserves its section's space. It did not
say what fills that space. **A skeleton first. If the wait passes ~1.5 s, the
skeleton gives way to one of the pill loading games (`PillShotLoader`,
`PillSortLoader`) at the same size.**

- **Why the delay.** A warm or prerendered page never shows a fallback, and a
  cold one usually shows it for a few hundred milliseconds. A game that flashes
  for 300 ms and disappears reads as the app working harder than it has to.
  Past ~1.5 s the user is really waiting, and a game is better than a blank.
- **Rejected: a game in every fallback immediately,** for the flash above, and
  because the 1000 × 700 canvas does not fit the smaller sections.
- **Rejected: a game in the label section only.** It's simpler, but a slow
  search or a cold identity fetch would still be a bare skeleton.
- **Committed to:** the swap never moves the layout (same box, same size). The
  games already honour `prefers-reduced-motion`. They are client components, so
  they load only when the timer fires, never as part of the static shell's
  JavaScript. W6 measures the shell, and a game should not be in it.

