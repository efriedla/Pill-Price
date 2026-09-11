/**
 * Loading-game illustration palette — shared by every mini game.
 *
 * These are NOT design tokens, and deliberately live outside
 * `src/lib/tokens.css`. ADR-002's token layer is a semantic system for the
 * product surface: five cool palette colours, exposed only as roles
 * (`--text-primary`, `--accent`, `--surface-base`). The values below are the
 * artwork of a mini game — a warm candy palette with zero overlap with the
 * product's, no semantic role, and no meaning outside a canvas.
 *
 * Putting them in `tokens.css` would add ~25 entries no component may use and
 * would make the token file stop being a design system. This is the same
 * category as the pixels inside an image asset, which the token rule has never
 * claimed.
 *
 * Two constraints that make the exemption narrow rather than a loophole:
 *
 *  1. A canvas `fillStyle` takes a colour string. It cannot read a CSS custom
 *     property, so `var(--x)` is not an option here even in principle.
 *  2. This file is the ONLY place in `src/ui` exempt from the raw-hex rule,
 *     declared by path in `eslint.config.mjs`. The component itself stays
 *     under the rule, so a stray hex in game logic still fails the build.
 *
 * If the games ship to users, this exemption wants ratifying in ADR-002 (or in
 * ADR-005, which owns the boundary they render into) rather than resting on
 * this comment. It is deliberately ONE file for all of them: a second exempt
 * palette would widen the hole every time someone adds a game.
 */

/** A two-tone capsule. `stroke` null means the capsule is drawn unoutlined. */
export type Palette = {
  readonly a: string;
  readonly b: string;
  readonly stroke: string | null;
};

/** Outline and text colour for the whole illustration. */
export const INK = "#2B3A4A";

/**
 * Named separately so `randPal` has a total fallback: under
 * `noUncheckedIndexedAccess` an array index is `Palette | undefined`, and a
 * non-null assertion would be the wrong way to spend that safety.
 */
export const DEFAULT_PALETTE: Palette = {
  a: "#FFC845",
  b: "#BE1931",
  stroke: null,
};

/** Capsule colourways, chosen at random per pill. */
export const PALETTES: readonly Palette[] = [
  DEFAULT_PALETTE,
  { a: "#F06178", b: "#7CCBC5", stroke: INK },
  { a: "#FFFFFF", b: "#4C7BE0", stroke: INK },
  { a: "#B9A3F0", b: "#FFE08A", stroke: null },
  { a: "#6FCF97", b: "#F4F4F4", stroke: INK },
];

/** Bottle body, cap and label. */
export const BOTTLE = {
  back: "#E08A36",
  front: "rgba(251,186,99,0.72)",
  rim: "#F2A248",
  rimShadow: "#C9742A",
  label: "#FFF3E6",
  capBody: "#EEE7E2",
  capHighlight: "#F8F4F1",
  capRidge: "#BDB2AB",
} as const;

/** Background shelf props, drawn only when no photo is supplied. */
export const SHELF_COLORS: readonly string[] = [
  "#F4A94F",
  "#7CCBC5",
  "#F06178",
  "#4C7BE0",
  "#6FCF97",
  "#B9A3F0",
];

/** Confetti thrown on a scoring shot, alongside the pill's own two tones. */
export const SPARK = "#FBBA63";

/** Confetti thrown when the bottle fills. */
export const FULL_BOTTLE_SPARKS: readonly string[] = [
  "#FFC845",
  "#F06178",
  "#7CCBC5",
  "#FBBA63",
];

/** Chrome drawn in the DOM layer rather than on the canvas. */
export const SURFACE = {
  /** Default accent; overridable via the component's `accentColor` prop. */
  accent: "#E8892F",
  white: "#fff",
  backdropTop: "#F7F8FA",
  backdropBottom: "#ECEFF3",
} as const;

/**
 * Sort-puzzle capsules.
 *
 * Each carries an imprint as well as two tones, so the pills are
 * distinguishable **without relying on colour** — the puzzle is unplayable for
 * a colour-blind reader otherwise, and hue is never the sole carrier of meaning
 * anywhere else in this app either (ui-spec §13).
 *
 * `name` is the accessible name read out by the live region, so it has to
 * describe the pill rather than label a swatch.
 */
export type SortPill = {
  readonly name: string;
  readonly a: string;
  readonly b: string;
  readonly mark: string;
};

export const SORT_PILLS: readonly SortPill[] = [
  { name: "yellow and red", a: "#FFC845", b: "#BE1931", mark: "5" },
  { name: "pink and teal", a: "#F7A1B0", b: "#3FA9A0", mark: "10" },
  { name: "white and blue", a: "#FFFFFF", b: "#4C7BE0", mark: "20" },
  { name: "lavender and purple", a: "#DCCFFB", b: "#7B5CD6", mark: "40" },
  { name: "white and green", a: "#F4F4F4", b: "#3DAA6B", mark: "50" },
  { name: "grey and navy", a: "#C9D2DB", b: INK, mark: "80" },
];

/** Sort-puzzle bottle chrome, which differs from the Pill Shot bottle. */
export const SORT_BOTTLE = {
  back: "rgba(224,138,54,0.30)",
  front: "rgba(251,186,99,0.26)",
  stroke: "#E0913F",
  strokeInvalid: "#D64545",
  rim: "#F2A248",
  rimShadow: "#C9742A",
  shine: "rgba(255,255,255,0.4)",
} as const;
