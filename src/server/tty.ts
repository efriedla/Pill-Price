import "server-only";

import type { ConceptProperties } from "./upstream/rxnorm.schema";

/**
 * The TTY→product mapping. **Q7, closed 2026-09-11.**
 *
 * `api-contract.md` requires this to live in one documented place rather than
 * inline in a resolver, because two fields depend on it — `alternatives` and
 * `isGeneric` — and a mapping duplicated across resolvers is a mapping that
 * will disagree with itself.
 *
 * RxNorm's `allrelated.json` returns up to 12 groups for a single product. Only
 * four of them are things a pharmacy can hand over. For
 * `atorvastatin 10 MG Oral Tablet` the rest are:
 *
 *   IN    atorvastatin              the ingredient — not dispensable
 *   BN    Lipitor                   a brand name — not a product
 *   DF    Oral Tablet               a dose form
 *   DFG   Oral Product              a dose form group
 *   SCDC  atorvastatin 10 MG        a component
 *   SCDF/SCDG/SBDC/SBDF/SBDG        abstract groupings
 *
 * None of those is an alternative. "Oral Tablet" is not something you could be
 * given instead of your pill, and listing it would also mean rendering a Drug
 * with a permanently null price and a permanently `absent` label, since neither
 * NADAC nor openFDA has anything to say about a dose form.
 *
 * The ingredient and the dose form are not discarded — they are *identity*
 * rather than alternatives, and belong in their own fields on `Drug`. That SDL
 * change is the author's to write (roadmap rule 3); it is owed, not done.
 */

/**
 * What counts as an alternative: the dispensable product concepts.
 *
 * A pack is included deliberately. GPCK/BPCK is a box of several products — a
 * contraceptive cycle, a steroid taper — and it is a real thing a prescription
 * can be filled with, so it is a genuine alternative to a single pill.
 */
export const ALTERNATIVE_TTYS = ["SCD", "SBD", "GPCK", "BPCK"] as const;

export type AlternativeTty = (typeof ALTERNATIVE_TTYS)[number];

/**
 * Generic versus branded, split on RxNorm's own naming: the *C*linical and
 * *G*eneric forms carry no brand, the *B*randed ones do.
 *
 *   SCD   Semantic Clinical Drug    atorvastatin 10 MG Oral Tablet
 *   GPCK  Generic Pack
 *   SBD   Semantic Branded Drug     atorvastatin 10 MG Oral Tablet [Lipitor]
 *   BPCK  Branded Pack
 */
export const GENERIC_TTYS = ["SCD", "GPCK"] as const;
export const BRAND_TTYS = ["SBD", "BPCK"] as const;

export function isAlternativeTty(tty: string): tty is AlternativeTty {
  return (ALTERNATIVE_TTYS as readonly string[]).includes(tty);
}

/**
 * Backs `Drug.isGeneric`. Derived from the TTY, never fetched — there is no
 * upstream field for it, and inferring it from a name would be guesswork.
 */
export function isGenericTty(tty: string): boolean {
  return (GENERIC_TTYS as readonly string[]).includes(tty);
}

export type AlternativeKind = "GENERIC" | "BRAND" | "ALL";

/** Which TTYs a given `AlternativeKind` admits. */
export function ttysForKind(kind: AlternativeKind): readonly string[] {
  if (kind === "GENERIC") return GENERIC_TTYS;
  if (kind === "BRAND") return BRAND_TTYS;
  return ALTERNATIVE_TTYS;
}

/**
 * Flatten `allrelated.json`'s TTY groups into the alternatives for one kind.
 *
 * Pure, and separate from any resolver, so the mapping can be tested without a
 * network. The grouping is preserved all the way from the parser to here
 * precisely so this decision is made in one place and made visibly.
 *
 * `self` is dropped: a drug is not an alternative to itself, and RxNorm
 * includes the queried concept in its own related groups.
 */
export function selectAlternatives(
  groups: readonly { tty: string; concepts: ConceptProperties[] }[],
  kind: AlternativeKind,
  self?: string,
): ConceptProperties[] {
  const admitted = ttysForKind(kind);
  return groups
    .filter((g) => admitted.includes(g.tty))
    .flatMap((g) => g.concepts)
    .filter((c) => c.rxcui !== self);
}
