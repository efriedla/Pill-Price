/**
 * Join class names, dropping falsy entries.
 *
 * Deliberately not `clsx` + `tailwind-merge`: with `class-variance-authority`
 * absent and variants resolved by lookup table, there is nothing to merge.
 * Revisit if a component ever needs to accept overriding utilities.
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
