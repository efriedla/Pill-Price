# Architecture Decision Records

Operating rule 1: no feature starts until the decision doc exists. Copy
`000-template.md`, number it sequentially, and link it from the PR body.

| ADR                                     | Title                                                  | Status   |
| --------------------------------------- | ------------------------------------------------------ | -------- |
| [001](001-rendering-strategy.md)        | Rendering strategy per route                           | accepted |
| [002](002-styling-and-design-tokens.md) | Styling and design tokens                              | accepted |
| [003](003-module-boundaries.md)         | Module boundaries                                      | accepted |
| [004](004-bff-and-schema-design.md)     | BFF and schema design                                  | accepted |
| 005                                     | Static/dynamic split for `/search` and `/drug/[rxcui]` | W3       |
| 006                                     | URL-as-state over a client store                       | W4       |
| 007                                     | Performance budgets + enforcement                      | W6       |
| 008                                     | Contentful guides _(optional)_                         | W7       |
| [009](009-nadac-on-the-request-path.md) | Does NADAC belong on the request path? (Q5)            | accepted |
| [010](010-upstream-error-taxonomy.md)   | Upstream error taxonomy: partial vs fatal (Q3)         | accepted |

## What the W1 scaffold assumed, and where it landed

The scaffold had to pick something in order to compile. Every provisional choice
it made has now been either ratified or replaced by ADR-001/002/003 above. This
section records what moved, so the trail is legible without diffing.

**Ratified as-is.**

- Tailwind v4 with the token layer bridged through `@theme inline`, only
  semantic tokens exposed, raw hex a lint error outside `src/lib/tokens.css`
  (ADR-002).
- The five-layer graph, default-deny, features reachable only through their
  `index.ts` barrel, asserted on every CI run by `tests/boundaries.test.ts`
  (ADR-003).

**Changed by an ADR.**

- **`app → server` is now granted** (ADR-003). The scaffold implemented the
  original spec literally, which left a GraphQL route handler at
  `app/api/graphql/route.ts` unable to import its own schema — W2 blocked on day
  one. The edge is added; `import "server-only"` in every `src/server/` module
  is the second guard on it. `feature ⇸ server` is untouched, and that is the
  boundary that was actually carrying the weight.
- **Cache Components will be enabled** (ADR-001). This is Next 16, where the
  static/dynamic boundary is at the component level rather than the route level,
  so the scaffold's route-level default is superseded by a static shell plus
  `use cache` functions whose lifetimes match each upstream's real freshness.
  The roadmap's W2 mention of `unstable_cache` is superseded with it.

**Still open, deliberately.**

- **Typefaces** — ui-spec §10. `--font-display`, `--font-body`, and
  `--font-numeric` hold system-stack placeholders. When the faces are chosen
  they load through `next/font` in the root layout and those three tokens are
  repointed; nothing else changes. `--font-numeric` must carry true tabular
  figures or `/compare`'s price columns will not align.
- **The static/dynamic cutoff** for `/drug/[rxcui]` — ADR-005 owns the number
  and has to defend it.

<!-- 009 is dated before 005–008 on purpose: it is a W2 decision, and 005–008
     are reserved for later weeks and already cross-referenced from ADR-001 and
     the roadmap. It took the next free number rather than renumbering live
     links in an accepted ADR. -->

## Related, not ADR material

`tsc` runs with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`noUnusedLocals/Parameters`, and `verbatimModuleSyntax` on top of `strict`. The
root layout is typed by hand rather than with Next's generated `LayoutProps`, so
`npm run typecheck` is a standalone CI check that does not require a build to
have run first.
