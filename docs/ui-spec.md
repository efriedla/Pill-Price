# Pill Price — UI Spec

Translation of the annotated reference screens into real fields, real components, and the decisions that need an ADR.

**Structural inspiration only.** Take the *shape* — big number + sparkline, stats grid, composition bar, related cards — and give it your own type, palette, and spacing. A recognizable clone of a known app is a mild negative in an interview and a legal gray zone. The value is in the information architecture, not the skin.

---

## 1. Field Mapping

Every displayed value must trace to a real API field. If it doesn't appear below, it doesn't ship.

| Your annotation | Real field | Source | Notes |
|---|---|---|---|
| Drug abbreviation | `rxcui` | RxNorm | Not really an abbreviation — use it as a small mono ID under the name |
| Drug name | `openfda.brand_name` / `generic_name` | openFDA | Show brand as title, generic as subtitle |
| Drug price | `nadac_per_unit` (latest) | NADAC | **Must** be labeled "per unit" + acquisition-cost caveat |
| Drug price change | Δ vs. earliest in range | NADAC | Computed, not fetched. Label the window explicitly |
| Price chart | `nadac_per_unit` over `effective_date` | NADAC | Weekly granularity — see §3 |
| Drug description | `description` or `indications_and_usage` | openFDA label | Long prose. Needs a Show-more clamp |
| Parent companies | `labeler_name`, `openfda.manufacturer_name` | openFDA NDC | Often several per drug. List, don't singularize |
| Category: what it's treating | `openfda.pharm_class_epc` | openFDA | This is *drug class*, not condition. Label it "Drug class" |
| Ingredients | `active_ingredients[]` (name + strength) | openFDA NDC | Also `inactive_ingredient` from label, in a secondary section |
| Ingredient breakdown | strength composition | openFDA NDC | Stacked bar — see §4 |
| Date it got on the market | `marketing_start_date` | openFDA NDC | Marketing start ≠ FDA approval. Label precisely |
| Alternatives | same-ingredient concepts | RxNorm `/related` | See §5 |
| Number of ailments it treats | — | — | **Cut.** No such field |

**Additional stats worth showing** (fills the grid honestly): dosage form, route, available strengths, brand vs. generic (`classification_for_rate_setting`), NDC count, latest NADAC effective date.

**No analog — do not force these:** bid/ask, volume, AUM, P/E, expense ratio, short inventory, dividends, borrow rate.

---

## 2. Color Semantics — ADR required

**Decision: price direction is never encoded in color.**

Rationale: green-up/red-down is a finance convention meaning gain/loss. On drug pricing, rising price is bad news for the reader and falling price is good — the opposite polarity. Either mapping misleads. So:

- All price figures in `--price-figure` (amethyst). One color, always
- Direction carried by an arrow glyph **and** a text label: `↓ 12% since Jan 2025`
- `--accent` (space blue) is for interactive affordances only — links, selected range, compare CTA
- `--warning-fg` (crimson) is reserved for warnings, recalls, and errors. Never for price

**Series colors in `/compare`** are the one place two hues appear together: space blue for the drug you arrived from, cinnamon for the comparison. Neither means good or bad — they differ in value and temperature so they separate in grayscale and for colorblind users. Each series also carries a direct label; no color-only legend.

This removes the red/green colorblind dependency before the W7 audit, which is much better decided now than retrofitted.

---

## 3. Chart

NADAC publishes weekly. That has consequences the reference design doesn't account for:

- **Range selector:** `3M · 6M · 1Y · 5Y · ALL`. Drop 1D/1W/1M — no intraday data exists to fill them
- Plot as a step or line with visible weekly points at short ranges; smooth only at 5Y/ALL
- Gaps are real (drugs enter and leave NADAC). Break the line — never interpolate across a gap
- Sparse series (< 4 points) render as a labeled point set, not a chart
- **Accessibility:** the chart needs a keyboard-navigable data table equivalent, or a visually hidden `<table>`. This is the single most likely a11y failure in the project — build it now, not in W7

---

## 4. Ingredient Composition Bar

Replaces the bid/ask spread widget, which has no analog.

Horizontal stacked bar showing active ingredients by strength — e.g. acetaminophen 325mg / oxycodone 5mg. Segments labeled, each with a tooltip and an accessible name. For single-ingredient drugs, degrade to a simple strength badge rather than a one-segment bar.

This is the closest honest analog to the fund-holdings bar in the reference, and it reuses the same component shape.

---

## 5. Alternatives

Two distinct, factual sections. Never one blended "you might also like" list.

**Same active ingredient** — RxNorm related concepts sharing the ingredient. This is the substitution question users actually have, and it's a factual relationship.

**Same drug class** — grouped by `pharm_class_epc`. Framed as informational, explicitly not interchangeable.

Each card: name, class, current NADAC per unit, and the price delta versus the drug being viewed. Copy requirement: *"Shares an active ingredient with X. Not a substitution recommendation — talk to a pharmacist."* Never "people also take."

---

## 6. Primary Action

The reference's persistent green "Trade" button has no analog — there is nothing to transact. Replace with **Add to compare**, persistent in the same position, with a compare tray showing current selections and a link to `/compare`. This makes the W4 feature discoverable from every detail page instead of stranded behind a nav item.

---

## 7. Component Inventory

Build in this order; each gets a Storybook story with loading, empty, and error states.

1. `PriceHeader` — name, rxcui, price, direction label, sticky on scroll
2. `PriceChart` + `RangeSelector` + hidden data table
3. `StatGrid` — 3-col responsive label/value pairs, 2-col at 640px, 1-col at 380px
4. `CompositionBar` — stacked, labeled, keyboard-reachable segments
5. `ProseSection` — clamped label text with Show more, preserving heading structure
6. `RelatedDrugCard` + `RelatedRow` — horizontal scroll with keyboard support
7. `DisclaimerBanner` — acquisition-cost caveat, dismissible per session but never absent on first view
8. `CompareTray` — persistent selection state, reads from URL

---

## 8. Responsive

The reference is mobile-only. Yours is web, and a stretched phone layout reads as unfinished.

- **≥1024px:** two columns — chart + stats left, ingredients + alternatives right. Sticky price header
- **640–1023px:** single column, stats grid to 2-col
- **<640px:** the reference layout
- **320px:** must not break. This is in the W4 definition of done

---

## 9. Copy Rules

- Every price is followed by its unit and its date: `$0.0412 per unit · as of Aug 12, 2026`
- "Drug class," never "what it treats" — the field is pharmacologic class
- "Marketing start," never "approved" — different regulatory events
- Errors state what failed and what still works: *"Label data is unavailable right now. Pricing below is current."*
- Empty compare state is an invitation: *"Add a second drug to see how they differ."*

---

## 10. Open Decisions

Resolve these before W3:

- [x] ~~Accent color + full palette~~ — resolved, see §13
- [ ] Display and body typefaces — the numeric face matters most; pick one with real tabular figures
- [ ] Density: airy like the reference, or tighter to fit desktop two-column
- [ ] What the signature element is — the thing this page is remembered by. The composition bar is the strongest candidate

---

## 11. Label Content — the `ProseSection` component

The clamped card is the right pattern. Real FDA label data will break a naive version of it.

**What the data actually looks like:** each label field is an array, usually containing one very long string. Prescription labels run into the thousands of words. Expect all-caps runs, embedded section numbers (`1.1`, `17.2`), references to tables and figures that aren't in the text, and inconsistent whitespace. OTC labels are short by comparison — the component must handle both without looking broken.

**Structure — one accordion, fixed section order, not one card:**

1. Boxed warning — **always fully expanded**, never clamped
2. Indications and usage
3. Dosage and administration
4. Contraindications
5. Warnings and cautions
6. Adverse reactions
7. Drug interactions
8. Inactive ingredients
9. Storage and handling

Sections absent from the label are omitted entirely — never rendered empty.

**Rules:**

- Clamp to 3 lines with a Show more control, except the boxed warning
- The boxed warning is legally significant. It is never behind a disclosure, never truncated, and is visually distinct by border weight and background — not by hue alone
- Show more is a real `<button>` with `aria-expanded`, expanding in place with no layout jump. Not a link, not a div
- Deep-link each section with a URL hash so a specific section is shareable
- Measure capped at 65–75ch regardless of viewport
- Every section footer carries provenance: `Source: FDA label · updated {effective_time}`

**Normalization pass** (server-side, in the BFF — not in the component):

- Strip leading section numbers
- Convert all-caps runs longer than ~4 words to sentence case, with a preserved-terms list so drug names and acronyms survive
- Collapse whitespace, split into paragraphs
- Drop dangling references to tables and figures that aren't present

Write the preserved-terms list by hand and keep it in the repo. Normalizing medical text is exactly the kind of decision that needs to be visible and reviewable rather than buried in a regex.

---

## 12. Imagery Policy

**No stock illustration or clipart.** Three reasons, and the third is the one that matters:

1. Watermarked or unlicensed assets can't ship
2. Generic stock reads as filler
3. It undercuts the credibility this app is built on. The disclaimers, the refusal to fabricate an ailment count, the factual framing of alternatives — all of that says "reference tool." Cheerful clipart says "pamphlet," and pamphlets get trusted less

**Instead, imagery must be informational:**

- A small custom icon set for dosage form — tablet, capsule, liquid, injection, patch, inhaler — driven off the `dosage_form` field. Simple geometric marks in token colors, drawn as inline SVG. Decorative icons get `aria-hidden`; the form name stays as text
- The composition bar is the page's visual anchor
- Illustration is permitted only in empty states and 404, drawn in your own token palette

---

## 13. Palette — resolved

Implemented in `tokens.css`. Components reference semantic tokens only; raw hex never appears outside that file.

| Token | Value | Role |
|---|---|---|
| `--amethyst` | `#0D0630` | Primary text, price figures |
| `--space-blue` | `#18314F` | Interactive accent, focus ring, chart line |
| `--cinnamon` | `#B27C66` | Comparison series, graphic accent. **Never text** |
| `--light-blue` | `#B0E0F0` | Surface tint, tablet form coding |
| `--lavender` | `#E6E6FA` | Surface tint, capsule form coding |
| `--surface-base` | `#F8F7FC` | Page background |
| `--warning-fg` | `#B3261E` | Warnings only |

**Why a cool base.** Four of the five palette colors are cold, leaving cinnamon as the only warm note. A cream background would compete with it for that role, so the base is a cool off-white derived from the lavender.

**Cinnamon is not text-safe.** Around 3:1 on the light surface — acceptable for large display type, graphics, and chart series, not for anything at body size. Space blue does all interactive work.

**Warning separation is now easy.** With the palette cold, crimson stands clearly apart from cinnamon. The boxed-warning treatment still combines crimson + a 3px left rule + an icon + a bold label — hue is never the sole carrier of that signal. Do not place crimson and cinnamon inside the same component.

**Dark theme is available but out of scope.** Amethyst works as a dark-surface base if you ever want one. Not in the 8 weeks.

Numerals need a utility face with true tabular figures — price columns in `/compare` must align.

Record the final ramp in ADR-002 as named tokens.

---

## 14. Brand Assets

- `pillprice-mark.svg` — two-color mark, app icon and header
- `pillprice-mark-mono.svg` — single color, favicon and any one-color context
- `pillprice-logo.svg` — horizontal lockup with wordmark

**Construction:** a P and a mirrored P set back to back, their bowls meeting to form a single capsule split at the seam. The stems terminate in downward arrowheads — down reads as prices falling, which is the product's promise. Deliberately no upward arrow in the mark; that would reintroduce the directional ambiguity §2 removes.

**Before shipping:**

- [ ] Render the mono mark at 16px and confirm the counters don't close up. If they do, widen the counters rather than narrowing the stems — the stems carry the arrow read
- [ ] Replace the placeholder Georgia wordmark once the display face is chosen, then convert the text to outlines so the file carries no font dependency
- [ ] Generate the favicon and PWA icon set from the mono mark
