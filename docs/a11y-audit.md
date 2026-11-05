# Accessibility audit — WCAG 2.2 AA

Scope: the two shipped routes, `/search` and `/drug/[rxcui]`, plus the home
page and the not-found and error pages. This covers the roadmap's W7 items: the
audit, and "full keyboard traversal with a visible focus ring", which ADR-013
kept for the two shipped routes. Done 2026-11-05 against a local production
build at `cd256a5`.

## How it was checked

| Check | Tool | Result |
| --- | --- | --- |
| Automated rules (axe-core, inside Lighthouse 12.8.2) | `npm run lighthouse` | **100 on all 4 pages, at both form factors. No failing audit in any of 24 runs.** |
| Keyboard traversal with visible focus | `npm run keyboard-walk` (`scripts/keyboard-walk.ts`) | **93 tab stops across 7 pages; every one shows a focus ring, none is hidden or zero-sized** |
| Loading, empty and error states | `docs/screenshots/` (32 images) | Every state reads as a sentence that says what failed and what still works (ui-spec §9) |
| Reading the markup by hand | — | Two findings, below |

The keyboard walk presses Tab until focus wraps, and records for every stop
whether the element has a non-`none` outline or a box-shadow and is on screen.
It covers `/`, `/search`, `/search?q=metformin` (first 80 of 134 results),
`/drug/617312` (priced, with a label), `/drug/206765` (no price, no label),
a soft-404 drug and an unknown path.

**What automation cannot see:** whether a name makes sense, whether an
announcement is useful, and anything about a real screen reader. No screen
reader (VoiceOver, NVDA) was run. That is the largest gap in this audit.

## Fixed

**Six buttons all named "Show more"** (2.4.6 Headings and Labels). A label has
several long sections, each clamped behind a Show more button. In a screen
reader's list of buttons they were indistinguishable. Each button now has the
section title in visually hidden text, so it is announced as "Show more:
Indications and usage". The visible text is unchanged and comes first, so the
accessible name still contains the visible label (2.5.3 Label in Name). The
buttons already had `aria-expanded` and `aria-controls`. Tested in
`DrugLabel.test.tsx`.

## Already right, and worth saying

- **States are sentences, not colours.** An outage, a missing price and a
  missing label each name the source that failed and say what still works
  (`drug-label-unavailable-*`: price and versions still render). No state is
  carried by colour alone (1.4.1).
- **The waits are announced once.** The loading skeleton is replaced by a game
  after 1.5 s. The skeleton is then `aria-hidden`, and the game's status line
  is `aria-live="polite"`, so the wait is not read twice.
- **No layout shift.** CLS is 0.000 on every measured page, so nothing moves
  under a pointer or a magnifier.
- **The boxed warning is never clamped** or put behind a button.
- **Reflow at 390 px** (1.4.10): every screenshot at phone width reflows to a
  single column without horizontal scrolling.

## Known gaps

1. **No screen-reader pass.** See above.
2. **No way back to search from a drug page** except the browser's Back
   button. There is no site header. It is not a WCAG failure (2.4.5 Multiple
   Ways is met through search plus direct URLs), but it is a real navigation
   gap.
3. **The search box is blank while results load.** At `/search?q=lisinopril`
   the input shows its placeholder until the results stream in
   (`docs/screenshots/search-loading-*`). A screen-reader user who lands
   mid-load hears an empty field.
4. **The loading games are not checked against 2.5.7 Dragging Movements.**
   The pill-shot game is drag-to-aim. It is optional (the page loads
   regardless), but no single-pointer alternative was verified.
5. **320 px reflow is not checked**; the screenshots are at 390 px. The 320 px
   item was part of the deferred compare feature (ADR-013).
6. **Contrast is checked only by axe's rule**, which tests text over solid
   backgrounds. Text over the games' illustrated shelves was not measured by
   hand.
