# ADR-005: Static/dynamic split for /search and /drug/[rxcui]

**Status:** proposed — options only, no decision
**Date:** 2026-09-23

<!-- Roadmap rule 3: the author owns these decisions. This lays out the
     options; the Decision section is deliberately empty. Same shape as
     ADR-012 and ADR-013. -->

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

<!-- Yours. -->

## Consequences

<!-- Written once the decision is made. -->

## Revisit if

- A screener-facing page loads slowly on its first visit after a deploy. That is
  the only thing the prerender list buys.
- openFDA's keyless quota is hit by CI builds.
- A second consumer of the schema appears (ADR-004's revisit condition). That
  changes the weight on Q1.
