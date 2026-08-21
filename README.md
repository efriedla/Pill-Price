# Pill Price

A drug-pricing reference built on RxNorm, openFDA, and NADAC.

**NADAC reports what pharmacies pay to acquire a drug.** It is not what a
patient pays at the counter and it is not an insurance price. Every figure in
this app is labelled accordingly — see [`docs/ui-spec.md`](docs/ui-spec.md) §9.

## Status

**Week 1 of 8.** Foundation only — design system, module boundaries, and CI.
There is no data layer yet; the GraphQL BFF lands in week 2. The plan is in
[`docs/roadmap.md`](docs/roadmap.md).

## Local setup

```bash
nvm use               # Node 24, per .nvmrc
npm ci
npm run dev           # http://localhost:3000
npm run storybook     # http://localhost:6006
```

## Checks

All four are required to merge ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

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
src/app/          routes, layouts, route handlers
src/server/       GraphQL BFF: schema, resolvers, upstream clients
src/features/     vertical slices: drug, search, compare
src/ui/           presentational primitives
src/lib/          types, formatters, tokens, generated GraphQL
docs/adr/         decision records — read before changing architecture
docs/sketches/    throwaway layout sketches against the real tokens
docs/ui-spec.md   field mapping, colour semantics, copy rules
docs/roadmap.md   the 8-week plan
tests/            repo-level tests (boundary enforcement)
```

Imports travel one way — `app → feature → ui → lib`, with `server → lib` — and
never sideways between slices. Default is deny, nothing imports `app`, and
features are reachable only through their `index.ts` barrel. Enforced by lint
and asserted by [`tests/boundaries.test.ts`](tests/boundaries.test.ts), which
fails if the config ever stops rejecting a violation.

## Design

The palette, type scale, and spacing live in
[`src/lib/tokens.css`](src/lib/tokens.css) — the only file permitted to contain
raw colour values. Two rules there are load-bearing and easy to undo by
accident:

- **Price direction is never encoded in colour.** Green-up/red-down means
  gain/loss in finance; on drug pricing the polarity is inverted and either
  mapping misleads. Direction is carried by a glyph and a sentence.
- **Colour is never the only signal.** Every colour-coded category also carries
  a text label, and the boxed-warning treatment combines hue, a 3px rule, an
  icon, and a bold label.

`docs/sketches/` holds static HTML sketches of the three routes. They link the
real token file rather than a copy, so they cannot drift from the palette. Open
them directly in a browser; nothing there ships.

## Data sources

| Source | Used for | Freshness |
| --- | --- | --- |
| RxNorm | drug concepts, ingredients, related products | live |
| openFDA | labels, NDC, manufacturer, pharmacologic class | live |
| NADAC | acquisition cost per unit | weekly |

The API contract lands in week 2 as `docs/api-contract.md`.

## Limitations

Written honestly, and expanded as they are discovered:

- Pricing is acquisition cost, not consumer price
- NADAC is weekly, so there is no intraday or daily price history
- Drugs enter and leave NADAC; gaps in a series are real and are never
  interpolated across
- Composition bars are drawn to a compressed scale, stated on the page — a
  325 mg / 5 mg combination at true proportion renders the smaller ingredient
  invisible
- No auth, no accounts, no database — by design

## Contributing

[`CONTRIBUTING.md`](CONTRIBUTING.md) covers the layer rules, the token rules,
and the process: an ADR before the code it authorizes, every change on a
branch, and a PR description written from memory with the diff closed.
