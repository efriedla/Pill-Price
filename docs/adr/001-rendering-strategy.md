# ADR-001: Rendering strategy per route

**Status:** accepted
**Date:** 2026-08-23

## Context

Four routes ship: `/search`, `/drug/[rxcui]`, `/compare`, and `/guides/[slug]`
(W7, optional). There is no auth, no database, and no user account. Every byte
the app renders is derived from three public upstreams — RxNorm, openFDA, and
NADAC — and is therefore identical for every visitor.

That last sentence is the whole decision. The reflex for an API-backed app is
to server-render on every request, but with nothing per-user in the response,
dynamic rendering buys no correctness and costs a fan-out to three third-party
REST APIs on every page view. Those upstreams are slow, rate-limited, and
occasionally down; W2's definition of done already assumes they will fail and
requires the page to degrade rather than crash. Rendering per request puts that
failure on the critical path of the first byte.

The upstreams also disagree about freshness, which rules out one global answer:

| Source | Changes | Implication |
| --- | --- | --- |
| NADAC pricing | weekly | a day-old figure is correct; a week-old one is not |
| openFDA labels | rarely, unpredictably | stale is tolerable, absent is not |
| RxNorm concepts | slowly | effectively reference data |
| search queries | unbounded | not enumerable at build time |

The constraint that makes the obvious answer wrong is version-specific. This is
Next 16, where the static/dynamic boundary is **at the component level, not the
route level** (`node_modules/next/dist/docs/01-app/02-guides/rendering-philosophy.md`).
Cache Components (`use cache`) and Partial Prerendering make "is this route
static or dynamic?" the wrong question — a route can serve a prerendered shell
at CDN latency while a priced section streams in behind it. Picking a
route-level answer for each of the four routes would be answering a question
the framework no longer asks.

`cacheComponents` is **not** currently enabled in `next.config.ts`, so today the
app is on the previous model by default. The roadmap's W2 line about
`unstable_cache` for NADAC is written against that older model and is superseded
by this ADR.

## Options considered

### Option A — Dynamic by default, opt into static

Every route server-renders per request; add `generateStaticParams` where it
obviously pays.

- **For:** freshness is never wrong; no build-time enumeration problem; the
  simplest mental model, and the one most teams default to.
- **Against:** puts three flaky upstreams on the first-byte path of every
  request, for data that is identical for all visitors. Makes W6's LCP target a
  fight against our own architecture. Caching then has to be retrofitted as a
  defensive layer rather than designed in, which is the same work done later and
  worse.

### Option B — Static by default, opt into dynamic with a written reason (route-level)

Prerender everything possible; declare specific routes dynamic.

- **For:** correct instinct for this data; cheap to host; fast.
- **Against:** all-or-nothing per route. `/drug/[rxcui]` is a mostly-static page
  with one weekly-changing number in it. Under a route-level model that page is
  either fully static and can go stale, or fully dynamic and pays the upstream
  cost for the 90% of itself that never changes. The escape hatch is
  client-fetching the price after load, which is worse than either.

### Option C — Static by default, with Cache Components for the boundary

Enable `cacheComponents: true`. Prerender the shell of every route; mark data
functions `use cache` with an explicit `cacheLife` matched to the upstream's real
freshness; leave genuinely per-request work uncached and let it stream.

- **For:** the boundary lands where the data's freshness actually differs, not
  where the router happens to draw a line. Each upstream gets the TTL it
  deserves. On-demand `revalidateTag` means a NADAC drop can invalidate pricing
  without a redeploy. The static shell gives W6 a good LCP essentially for free.
- **Against:** it is the newer model and a smaller share of the ecosystem's
  documentation and Stack Overflow answers apply. It transfers complexity to the
  hosting platform — streaming and cache coordination become deployment
  requirements, which constrains W8's hosting choice. Every cached function now
  needs a deliberate `cacheLife`, and an un-thought-through one is a silent
  correctness bug rather than a loud failure.

### Option D — Client-rendered SPA shell over the BFF

Ship a static shell; fetch everything from the browser.

- **For:** trivially cacheable HTML; one rendering model to hold in your head.
- **Against:** surrenders the entire Next.js argument. Every page becomes a
  spinner, LCP depends on a client round trip to three upstreams, and the label
  text — the most content-heavy thing on the page — stops being in the HTML.
  Rejected on W6 and W7 grounds before any preference is involved.

## Decision

**Enable Cache Components and render statically by default: every route serves a
prerendered shell, every piece of upstream data is fetched inside a `use cache`
function whose `cacheLife` is justified against that source's real update
frequency, and a route becomes dynamic only where a written reason says it must.**

Server Components are the default component kind. `"use client"` is pushed to
interaction leaves — the range selector, the Show-more control, the compare
tray — and never applied to a layout or a page.

The per-route allocation below is this ADR's *starting position*, not its final
word. ADR-005 owns the `/search` and `/drug/[rxcui]` split in detail and may
overturn any row; ADR-006 owns `/compare`'s URL-as-state.

| Route | Shell | Dynamic part | Why |
| --- | --- | --- | --- |
| `/` | static | none | no upstream data |
| `/search` | static | results stream | query space is unbounded; nothing to enumerate |
| `/drug/[rxcui]` | static, bounded prefix + tail on demand | pricing revalidates weekly | ~30k RxCUIs is too many to prerender; the head is worth it. ADR-005 sets the cutoff |
| `/compare` | static | table streams per selection | state is in `searchParams`, so the shell prerenders and the rows resolve behind it |
| `/guides/[slug]` | static | none | CMS content, revalidated on webhook |

Cache lifetimes are stated per source, not per route: NADAC weekly, openFDA
labels long with on-demand invalidation, RxNorm concepts long, search
uncached. ADR-004 ratifies the exact profiles alongside the BFF's own cache
layers.

## Consequences

**Easier.** W6 starts from a prerendered shell, so the LCP work is about payload
and fonts rather than about undoing a rendering decision. Upstream outages stop
being first-byte events: a cached page still serves while a source is down,
which is most of what W2's graceful-degradation requirement asks for. Freshness
becomes a per-source number that can be argued about in `api-contract.md`
instead of a property of the router.

**Harder.** Every `use cache` needs a deliberate `cacheLife`; forgetting one
applies the implicit default silently. Cache keys close over arguments and
captured scope, so a careless closure can fragment the cache without any error.
Debugging gets a new failure mode — "wrong because stale" looks nothing like a
crash.

**Committed to.** A host that supports streaming and cache coordination. This
narrows W8's deployment options and needs to be checked before the domain is
bought, not after. Also committed to `revalidateTag` as the invalidation
mechanism, which means tags have to be designed in W2 rather than added later.

**Given up.** The option of a pure static export. Nothing in the roadmap wants
one, but it is genuinely off the table now.

## Revisit if

- A hosting constraint appears in W8 that cannot serve a streamed response or
  coordinate cache invalidation across instances.
- Measured p95 for a cached drug page misses the W2 target of 200ms and
  profiling attributes it to the caching layer rather than the upstreams.
- Cache Components turns out to cost more debugging time in W2–W3 than the
  previous model would have. The fallback is documented at
  `node_modules/next/dist/docs/01-app/02-guides/caching-without-cache-components.md`,
  and reverting is a config flag plus rewriting the `use cache` functions —
  cheap in W2, expensive by W6.
