# ADR-002: Styling and design tokens

**Status:** accepted
**Date:** 2026-08-23

## Context

The app is a price reference for prescription drugs. Its entire value rests on
being believed, and ui-spec §12 already commits to that in the imagery policy:
"cheerful clipart says pamphlet, and pamphlets get trusted less." The styling
layer has to carry the same argument. That rules out a component library with a
strong visual opinion of its own, and it raises the cost of any decision that
makes an unsafe color reachable by accident.

Three constraints were fixed before this ADR:

1. **ui-spec §2** — price direction is never encoded in color. Green-up/red-down
   is a finance convention meaning gain/loss; on drug pricing the polarity is
   inverted, so either mapping misleads. Direction is carried by a glyph and a
   text label.
2. **ui-spec §13** — the palette is resolved, and two of its values are not
   text-safe. `--cinnamon` lands near 3:1 on the light surface; `--deep-cyan`
   and the tints are graphic-only. A design system that lets someone write
   `text-cinnamon` has shipped an accessibility bug that no reviewer will catch
   by reading a diff.
3. **W7** — a WCAG 2.2 AA audit against this palette, with the findings
   published. Anything the token layer can prevent now is a finding that never
   has to be written up.

The typefaces are still open (ui-spec §10). The styling architecture has to be
decidable without them, and swapping them in later must not be a refactor.

## Options considered

### Option A — A component library (MUI, Mantine, Chakra)

- **For:** primitives, a11y behaviour, and a theming system arrive on day one.
  W1 finishes faster.
- **Against:** every one of them ships a visual opinion, and overriding it is
  the majority of the work — the library's tokens and ours would be two systems
  in a trench war. The palette constraints above are ours, not theirs; nothing
  in a third-party theme knows that cinnamon is not text-safe. It also weakens
  the interview claim: "built a design system" and "configured someone else's"
  are different sentences.

### Option B — CSS Modules with hand-written custom properties

- **For:** no framework, no build-time magic, complete control. Scoping is real
  rather than conventional.
- **Against:** every spacing and type decision becomes a hand-written rule, so
  consistency depends on discipline instead of on constraint. No mechanism stops
  a raw hex from being typed into a module. Storybook and the a11y addon work,
  but the composition ergonomics are noticeably worse for a solo build on a
  two-hour-a-day budget.

### Option C — Tailwind v4, with a token layer bridged through `@theme inline`

Tokens are authored as CSS custom properties in one file; only *semantic* tokens
are re-exported to Tailwind's utility generator.

- **For:** the constraint is enforceable at the layer where it is violated. A
  token that is never bridged has no utility class, so `text-cinnamon` is not a
  mistake to be caught in review — it is a class that does not exist. Tailwind
  v4's CSS-first config means the token file is real CSS rather than a JS object
  compiled into CSS, so the same file works in Storybook, in the sketches, and
  in the app without a second source of truth.
- **Against:** utility classes in markup are polarising and a reviewer may read
  them as noise. `@theme inline` is v4-specific and its behaviour differs from
  the v3 `theme.extend` most references describe. The indirection —
  palette → semantic token → bridged theme variable → utility — is four names for
  one color, and it has to be explained to anyone reading the code.

### Option D — Option C without the bridge; expose every token as a utility

- **For:** one less layer, no explaining.
- **Against:** re-admits exactly the failure the palette section warns about.
  `text-cinnamon` and `bg-light-blue` would both be one keystroke away, both
  would look reasonable in a diff, and both would fail the W7 audit. The bridge
  is the entire point.

## Decision

**Tailwind v4 with a two-tier token layer: raw palette values live only in
`src/lib/tokens.css`, and only semantic tokens are bridged into Tailwind through
`@theme inline` in `src/app/globals.css`, so unsafe values are unreachable as
utility classes.**

This ratifies the scaffold's provisional choice. Four rules follow from it:

- **Palette values are private.** `--amethyst`, `--cinnamon`, `--light-blue`,
  `--lavender`, `--deep-cyan` are declared in `tokens.css` and referenced only
  by semantic tokens in that same file. They are not bridged, so no utility
  generates from them.
- **Components address semantic tokens only** — `--text-primary`, `--accent`,
  `--chart-series-2`, `--warning-fg`. A component never learns which hue it got.
- **Raw hex is a lint error** anywhere in `src/**/*.{ts,tsx}`, enforced by the
  `no-restricted-syntax` rule in `eslint.config.mjs`. `tokens.css` is the only
  place a hex literal is legitimate, and being a `.css` file it is outside the
  rule's glob by construction.
- **Color is never the sole carrier of meaning.** Every category coded by color
  also carries a text label; the boxed warning combines crimson with a 3px rule,
  an icon, and a bold label; chart series are ordered by lightness (L* 19 / 57 /
  43 / 7) so they separate in grayscale, and each carries a direct end-of-line
  label rather than a legend.

**Typefaces remain deliberately unresolved.** `--font-display`, `--font-body`,
and `--font-numeric` hold system-stack placeholders. When ui-spec §10 closes,
the faces load through `next/font` in the root layout and those three tokens are
repointed at the generated CSS variables. Nothing else in the app changes — that
property is the reason the indirection exists, and it is worth verifying the
first time a real face lands. `--font-numeric` must have true tabular figures;
`/compare`'s price columns do not align without them.

**Dark theme is out of scope** for the eight weeks. `--amethyst` works as a dark
surface base if it is ever wanted, so the palette does not foreclose it.

## Consequences

**Easier.** An entire class of W7 audit finding is now unrepresentable rather
than merely discouraged. Retheming is a single file. Storybook, the app, and the
paper sketches read the same token file, so a story cannot drift from the app's
appearance. The typeface decision stays genuinely deferrable instead of
accumulating a debt that grows each week.

**Harder.** Adding a color is a four-step edit: palette value, semantic token,
bridge entry, then use it. This is friction on purpose, and it will feel like
bureaucracy the first time a one-off shade is wanted at 11pm. Utility-dense
markup is harder to skim than a named class, and the mitigation is composition —
extract a `ui` primitive rather than repeat a fourteen-class string.

**Committed to.** Tailwind v4 specifically. The `@theme inline` mechanism has no
v3 equivalent, so a downgrade is a rewrite of the bridge. Also committed to
`next/font` for the eventual faces, which rules out a runtime `<link>` to a font
CDN — acceptable, and it happens to help the W7 CSP work.

**Watch for.** The `--chart-compare` alias in `tokens.css` is a retained name
from before the four-series ramp existed. It is one indirection with no current
justification and should be removed once nothing references it.

## Revisit if

- The W7 audit finds a contrast failure that the token layer permitted. That
  means a semantic token is bridged at a value it should not hold, and the
  bridge's contents — not the rule — need revisiting.
- A chosen display or body face fails to load cleanly through `next/font`, or
  the numeric face turns out to lack real tabular figures.
- Utility strings in a component pass roughly fifteen classes on a regular
  basis. That is the signal that a `ui` primitive is missing, not that the
  approach is wrong — but if extracting the primitive does not fix it, the
  approach is what to question.
