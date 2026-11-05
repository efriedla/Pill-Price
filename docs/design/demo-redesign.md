# Pill Price — Visual & Interactivity Upgrade

Instructions for Claude Code. Read fully before touching code. Work in the order of the phases; each phase ships on its own.

## 0. Non-negotiables (do not regress these)

- **Lighthouse accessibility stays at 100.** Every new widget is keyboard-operable, has a visible focus ring, and exposes its data in an accessible form (a `<table>` or `aria-label`/`aria-describedby` text) — never SVG only.
- **Every figure keeps its unit and its date.** A chart without an axis label, unit, and "NADAC as of <date>" caption is a bug.
- **Money stays a decimal string end to end.** Charts may convert to `Number` at the render boundary only, inside the chart component, never in data fetching, GraphQL types, or the snapshot.
- **"Acquisition cost, not retail price" stays above the fold** and appears on any shareable/exported view.
- **Respect `prefers-reduced-motion`.** All animation (count-ups, chart draws, transitions) is wrapped in a `useReducedMotion()` hook / `@media (prefers-reduced-motion: reduce)` and degrades to a static render.
- **Partial prerendering is preserved.** New widgets live inside existing `<Suspense>` boundaries or get their own; the shell must still render instantly. Do not add client-side waterfalls.
- **Static demo must keep working** with the frozen 85-drug JSON. Every widget takes data as props; nothing fetches directly from the browser.
- **Write a decision record (ADR) before each new widget**, matching the existing 12. The homepage counter should go to 12 + N and stay truthful.
- **No new runtime dependencies for charts.** Use hand-rolled SVG (small, tree-shakable, themeable with CSS vars). Allowed: `d3-scale` and `d3-shape` only (ESM, ~10 KB), if you prove you need them.

## 1. Design language (apply once, globally)

Keep the current serif display + sans body + mono figures — it's distinctive. Make it richer:

- **Tokens:** add `--accent` (one saturated hue, suggest indigo `#4f46e5`), `--brand` (warm, for brand-name prices, suggest `#b45309`), `--generic` (cool, for generic prices, suggest `#0f766e`), `--surface-2`, `--grid`. Define light + dark values. Brand vs generic color pairing must be used consistently everywhere (chips, bars, legend, table cells).
- **Numbers:** all prices use `font-variant-numeric: tabular-nums` and right-align. Keep 4 decimals as NADAC reports them; add a subtle `<abbr title="per unit">/u</abbr>`.
- **Depth:** cards get a 1px border + a soft inner top highlight; hover lifts by 1px with a shadow. No big drop shadows.
- **Background texture:** a faint dotted grid behind the hero only (CSS `radial-gradient`, 24px cell, 3% opacity). Nothing animated.
- **Hero title:** add a word-level highlight: underline the word "pay" with an SVG brush stroke in `--accent` that draws in on load (reduced-motion: static).

## 2. Phase A — Make the existing page breathe (1 PR)

1. **Animated stat counters** (`22 ms`, `100`, `93 / 93`, `12`). Count up from 0 over 600 ms on first intersection (`IntersectionObserver`). Reduced-motion: render final value. Mark with `aria-live="off"` and render the final number in a visually-hidden span so screen readers never hear partial values.
2. **Brand-vs-generic gap bar inside each price card.** Under the two prices, a horizontal bar: generic as a tiny segment, brand as the full width, with a label "Brand costs **861×** generic" (compute the multiple with `Decimal`/big.js-style string math — do not use floats — then format to 0 decimals, or 1 decimal if < 10). Add an `aria-label` carrying the same sentence.
3. **Quick-pick chips become a scrollable, keyboard-navigable row** with roving tabindex (←/→), and show the generic per-unit price on hover/focus as a tooltip (`role="tooltip"`, delay 150 ms).
4. **Search input upgrades:** typeahead over the 85-drug (demo) / RxNorm (prod) list. Results listbox follows the APG combobox pattern (`role="combobox"`, `aria-expanded`, `aria-activedescendant`). Each row shows name, form, and a muted generic price. ⌘K / Ctrl+K focuses the search; show the shortcut hint inside the input.
5. **Empty state illustration** when search has no match: a small inline SVG pill with a question mark, plus "Not in the 85-drug demo set" vs "Not found in RxNorm" (static vs real).

## 3. Phase B — Three signature widgets (one PR each)

### B1. "What does $100 buy?" (interactive comparison)
- A slider (`<input type="range">`, 1–1000, default 100, with a visible numeric input bound to it) and a drug picker.
- Shows "At NADAC, $100 buys **9,901 tablets** of generic amlodipine 5 mg, or **11 tablets** of Norvasc." Pills render as a dot-matrix SVG (cap at 500 dots; past that show "500 shown of 9,901").
- Computation: `floor(amount / unitPrice)` in decimal-string math.
- Caption carries unit (tablet/capsule/mL) and the NADAC date.
- Accessible: the sentence IS the accessible output; the dot matrix is `aria-hidden`.

### B2. Price landscape (scatter / beeswarm of all 85 demo drugs)
- X axis: generic per-unit price, **log scale** (prices span 4 orders of magnitude; say so in a caption). Y: jittered beeswarm, or group lanes by dosage form (tablet, capsule, solution, injection).
- Each dot is a `<a>` to the drug page, `tabindex=0`, with tooltip on hover/focus. Color = `--generic`. Toggle to overlay brand prices as hollow `--brand` rings connected by a thin line to their generic (the "gap" line).
- Highlight the currently searched/hovered drug in `--accent` and pulse once (reduced-motion: no pulse).
- Provide a "View as table" toggle that swaps the SVG for a sortable `<table>` with the same rows. This is the accessibility fallback and must be the DOM default when JS hasn't hydrated.
- Static demo: build from the frozen JSON at build time (`generateStaticParams`-style), prod: from the weekly snapshot branch, computed in a server component.

### B3. Price history sparkline + trend
- Per drug page and as a mini sparkline in each price card.
- Data: NADAC publishes weekly files; the weekly snapshot job should start **retaining the last 52 weeks per NDC/RxCUI** (one more column in the snapshot, `history: [{date, price}]`). Until history accumulates, show "History begins Nov 2026" — never fabricate back-data. In the static demo, if only one point exists, render a single dot and the sentence "1 data point".
- Sparkline SVG, 120×32 in cards, full chart on the drug page with hover crosshair, the min/max annotated, and a `<table>` fallback (collapsed under a `<details>`).
- Trend chip: "▲ 3.2% vs 4 wk ago" using decimal math; red/green must also encode with the arrow glyph, not color only.

## 4. Phase C — Drug page polish

1. **Dose ladder:** all strengths of the same ingredient+form as a vertical ladder, bar length = per-unit price, with a "price per mg" toggle (compute `price / strength` in decimal math; show "per mg" unit). Point out non-linear pricing with a note when the 2× strength costs < 1.5×.
2. **FDA label as a tabbed reader:** Indications / Dosage / Warnings / Adverse reactions, using `role="tablist"` with arrow-key navigation. Keep a "Read full label" link. Add a sticky section nav on wide screens.
3. **Versions table:** make it sortable (click headers, `aria-sort`), filter chips for brand/generic, and show the gap bar from Phase A in each row.
4. **Share card:** `/drug/[id]/opengraph-image` via `next/og` showing name, generic vs brand price, the "acquisition cost, not retail" line, and the NADAC date. Static demo: pre-render for the 85.

## 5. Phase D — Delight, cheap

- **Theme toggle** (system/light/dark) in the header; dark palette already tokenized in Phase 1.
- **Skeletons** for streaming sections shaped like the final content (price block, versions table, label), replacing any generic spinners.
- **"How it works" becomes an animated architecture diagram:** three source boxes (RxNorm, openFDA, NADAC) flowing into the GraphQL BFF, then into the Next.js shell + streamed slots. Draw arrows with `stroke-dasharray` animation on scroll-in. Static when reduced-motion. Keep the existing prose below it.
- **Data freshness badge** in the header: "NADAC Oct 30, 2026 · snapshot Nov 5" with a `<time datetime>` and a tooltip explaining the two dates.
- **View transitions** between home → drug page (`next/view-transitions` or the CSS View Transitions API) so the price card morphs into the drug page header. Progressive enhancement only.

## 6. Engineering notes

- Create `components/charts/` with `Sparkline.tsx`, `GapBar.tsx`, `Beeswarm.tsx`, `DoseLadder.tsx`, `DotMatrix.tsx`. Each exports a pure SVG component plus a `*Table.tsx` fallback. Each has a Storybook/Ladle story if the repo has one; otherwise a `/components` route entry (the existing Components page).
- Shared `lib/decimal.ts`: `mul`, `div`, `cmp`, `fmtMoney`, `fmtMultiple`, all string-in/string-out. Unit test the rounding.
- Scales: `lib/scale.ts` with `logScale(domain, range)` and `linearScale` if not using d3-scale.
- Tests: Playwright axe scan on home + one drug page must stay at 0 violations; add a keyboard-traversal test that counts focusable elements and asserts each has a visible focus ring (keep "93 / 93" style stat honest — update the number).
- Perf budget: homepage JS ≤ +25 KB gzip after all phases. Beeswarm and $100 widget are client components; everything else should be server-rendered SVG with minimal hydration.
- Update the decisions page and the homepage counter with the new ADRs. Update `README` screenshots.

## 7. Definition of done per phase

- [ ] Lighthouse: a11y 100, perf ≥ 95 mobile.
- [ ] Reduced-motion verified in DevTools.
- [ ] Keyboard-only walkthrough recorded (GIF in PR).
- [ ] Static demo rebuilt and visually checked.
- [ ] ADR committed.

---

## Implementation status (2026-11-05)

Applied to the static demo only (`demo/`); the app is closed and unchanged. Price arithmetic is allowed in the demo by the author's decision (ui-spec §5 exception).

**Built:** design language (brand/generic colour pairing, card depth, hero dot grid, brush underline), dark mode with a theme toggle, count-up stats, gap bars with exact multiples, roving-tabindex chips with price tooltips, ⌘K typeahead combobox (APG pattern), empty-state pill, "What does $100 buy?" with dot matrices, the price landscape (log scale, brand rings on their generic's row, table view), tabbed label reader (boxed warning kept outside the tabs), sortable and filterable versions table, freshness badge, architecture diagram, view transitions.

**Changed from this document:**
- `--brand` is `#9f4807`, not `#b45309`: the latter measured 4.48:1 on its own quiet background, under AA.
- The diagram's arrows draw once, rather than looping: looping motion past 5 s needs a pause control (WCAG 2.2.2).
- The amlodipine example: $100 at $0.01012 buys 9,881 tablets, not 9,901. The displayed $0.0101 is rounded; the arithmetic uses the published price, and the widget's caption shows it.

**Not built, and why:** sparklines and trend chips (one data point per drug; nothing to draw, and nothing is fabricated); dose ladder and per-mg toggle (the 85 drugs rarely include several strengths of one product); `next/og` share cards, skeletons and PPR work (they need the app's server); per-widget ADRs (no app change).

**Measured** (Lighthouse 12.8.2, mobile, gzip-served, median of 3): home and a drug page both performance 100, accessibility 100, CLS 0. axe-core 4.13: 0 violations over 28 checks (light/dark × desktop/mobile × 7 views).

## Prototype pass (2026-11-05)

The author's widget prototype is kept in [`prototype/`](prototype/demoPage.html), outside `demo/` so it is not published. Its look was applied to the demo: Fraunces and IBM Plex (self-hosted, `demo/fonts/`), three-across price cards with a gradient gap bar and inline label, widgets in panels with serif titles, segmented toggles, tinted dot-matrix panels, a beeswarm (dodge) layout, a live dot on the freshness badge, dashed diagram wires.

**Not carried over, and why:** the sparklines and "vs 4 wk ago" trends, and 81 of the 85 beeswarm dots, are placeholder data in the prototype (its own notes say so); the demo uses the 59 real priced drugs and shows no history. The prototype's float arithmetic (9,900 tablets; the published price gives 9,881), its counters that show 0 until scrolled into view, and its endlessly looping wires (WCAG 2.2.2) were not copied. Its "four orders of magnitude" is 3.5 on the real data, and so was the demo's own caption; both now say "more than three".

**Measured after:** axe 0 violations over 28 checks; Lighthouse mobile (gzip) performance 98 home / 95 drug, accessibility 100, CLS 0. Loading the fonts from Google instead measured 90 / 92 with CLS 0.046, which is why they are self-hosted.

