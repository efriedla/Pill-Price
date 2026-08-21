# Pill Price

A drug-pricing reference built on RxNorm, openFDA, and NADAC.

**NADAC reports what pharmacies pay to acquire a drug.** It is not what a
patient pays at the counter and it is not an insurance price. Every figure in
this app is labelled accordingly — see `docs/ui-spec.md` §9.

## Status

Week 1 of 8. Scaffold and design system only; no data layer yet.

## Local setup

```bash
npm ci
npm run dev          # http://localhost:3000
npm run storybook    # http://localhost:6006
```

## Checks

All four are required to merge (`.github/workflows/ci.yml`).

```bash
npm run lint         # eslint, incl. module boundaries and the no-raw-hex rule
npm run typecheck    # tsc --noEmit, strict + noUncheckedIndexedAccess
npm test             # vitest: unit (jsdom) + stories (real Chromium)
npm run build        # next build
```

`npm test` runs two projects. `npm run test:unit` skips the browser when you
just want the fast loop.

## Layout

```
src/app/          routes and layouts
src/features/     vertical slices — arrives W3
src/components/   presentational primitives
src/lib/          pure helpers, clients, schemas
src/styles/       the only file allowed to contain raw palette values
docs/adr/         decision records — read before changing architecture
docs/ui-spec.md   field mapping, colour semantics, copy rules
docs/roadmap.md   the 8-week plan
tests/            repo-level tests (boundary enforcement)
```

Imports travel one way: `app → feature → ui → lib`, and never
`feature → feature`. This is enforced by lint and asserted by
`tests/boundaries.test.ts`.

## Data sources

| Source | Used for | Freshness |
| --- | --- | --- |
| RxNorm | drug concepts, ingredients, related products | live |
| openFDA | labels, NDC, manufacturer, pharm class | live |
| NADAC | acquisition cost per unit | weekly |

The API contract lands in W2 as `docs/api-contract.md`.

## Limitations

Written honestly, and expanded as they are discovered:

- Pricing is acquisition cost, not consumer price
- NADAC is weekly, so there is no intraday or daily price history
- Drugs enter and leave NADAC; gaps in a series are real and are never
  interpolated across
- No auth, no accounts, no database — by design
