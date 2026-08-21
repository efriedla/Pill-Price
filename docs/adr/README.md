# Architecture Decision Records

Operating rule 1: no feature starts until the decision doc exists. Copy
`000-template.md`, number it sequentially, and link it from the PR body.

| ADR | Title | Status |
| --- | --- | --- |
| 001 | Rendering strategy per route | **not yet written** |
| 002 | Styling and design tokens | **not yet written** |
| 003 | Module boundaries | **not yet written** |

## Decisions the W1 scaffold assumed

The scaffold had to pick something in order to compile. Each item below is a
*provisional* choice awaiting the ADR that either ratifies it or replaces it.
None of them are load-bearing enough to be expensive to reverse today, and all
of them get more expensive to reverse every week.

**ADR-002 — styling and design tokens**

- Tailwind v4 with the token layer bridged through `@theme inline` in
  `src/app/globals.css`. Only *semantic* tokens are bridged; raw palette values
  (`--cinnamon`, `--lavender`, …) are deliberately not reachable as utilities,
  so `text-cinnamon` cannot be written by accident. See ui-spec §13.
- An ESLint rule rejects hex literals anywhere in `src/` outside
  `src/styles/tokens.css`.
- Typefaces remain placeholders — ui-spec §10 is still open. When chosen, load
  them with `next/font` in the root layout and repoint `--font-display`,
  `--font-body`, and `--font-numeric`. Nothing else should change.

**ADR-003 — module boundaries**

Four layers, one direction of travel:

```
app  →  feature  →  ui  →  lib
        (never feature → feature)
```

- `app` — routes and layouts; composes features and ui
- `feature` — a vertical slice (`search`, `compare`, `drug-detail`); owns its
  own data fetching and state
- `ui` — presentational primitives; knows nothing about the domain
- `lib` — pure helpers, clients, schemas; imports nothing but `lib`

Enforced by `eslint-plugin-boundaries` and, more usefully, asserted on every CI
run by `tests/boundaries.test.ts`, which lints synthetic violations of each
edge and fails if they are *not* rejected.

The rule that earns its keep is `feature → feature`. Without it two slices
quietly grow a shared dependency, and "independently led a complex feature end
to end" stops being a true sentence.

**ADR-001 — rendering strategy**

Untouched. Only `/` exists, and it is static. The real decision arrives with
`/search` and `/drug/[rxcui]` in W3.

Related: `tsc` runs with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`noUnusedLocals/Parameters`, and `verbatimModuleSyntax` on top of `strict`. The
root layout is typed by hand rather than with Next's generated `LayoutProps`,
so `npm run typecheck` is a standalone CI check that does not require a build
to have run first.
