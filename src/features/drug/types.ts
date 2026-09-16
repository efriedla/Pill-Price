import type { Drug } from "@/lib/gql";

/**
 * Internal to the `drug` slice. Re-exported from `index.ts` where public.
 *
 * **Derived from the schema, never restated.** This was a hand-written
 * interface until 2026-09-16, and restating a response shape by hand let it
 * drift from the SDL in three ways that all compiled:
 *
 *   - `nadacPerUnit: number`, where the schema says `pricePerUnit: String!`.
 *     ADR-004 chose a string deliberately — NADAC ships `"0.02902"` and binary
 *     floats cannot hold decimal money. The hand-written type handed the UI a
 *     float and invited arithmetic on it, which is what `formatPerUnit` did.
 *   - `brandName` / `genericName`, which **do not exist** in the SDL. `Drug`
 *     has `name` and `isGeneric`.
 *   - a top-level nullable `effectiveDate`, where the schema nests a non-null
 *     `effectiveDate` inside a nullable `Price` — so "priced" and "undated"
 *     were representable separately here, and are not real states.
 *
 * `Pick` rather than a restatement is the point: nullability and optionality
 * come from the generated type, so a schema change breaks this file instead of
 * silently disagreeing with it.
 */
export type DrugSummary = Pick<
  Drug,
  "rxcui" | "name" | "isGeneric" | "price"
>;
