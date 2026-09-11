import "server-only";

/**
 * The resolver map. `schema.ts` owns the SDL and imports this to execute it.
 *
 * These two lived in `schema.ts` until ADR-011 unblocked real resolvers, next
 * to a second `resolvers` export here that resolved a `_placeholder` field the
 * SDL never declared. One of the two was dead and neither said which.
 */

/**
 * Unions cannot be executed without a type discriminator, and ADR-010's two
 * degraded members are shared across every degradable field — so the rule that
 * recognises them is written once. Resolving on the presence of a
 * member-specific field rather than on a stored `__typename` keeps resolvers
 * free to return plain objects.
 *
 * `retryable` is checked before `reason` because `Unavailable` carries both.
 * Testing `reason` first resolves every `Unavailable` as `Absent` — a retryable
 * outage rendered as a settled fact with its retry affordance stripped. Nothing
 * in the type system enforces the order; ADR-010's Consequences records it and
 * `tests/adr-010-guards.test.ts` pins it.
 */
const resolveDegradable =
  (present: string) => (value: Record<string, unknown>) =>
    "retryable" in value
      ? "Unavailable"
      : "reason" in value
        ? "Absent"
        : present;

export const resolvers = {
  LabelResult: { __resolveType: resolveDegradable("Label") },
  AlternativesResult: { __resolveType: resolveDegradable("Alternatives") },

  Query: {
    // Still "no data" rather than plausible-looking fixtures: the transport
    // layer (ADR-011) lands before the field resolvers that use it, and a stub
    // that invented a price would read as a working feature.
    drug: () => null,
    search: () => [],
  },
};
