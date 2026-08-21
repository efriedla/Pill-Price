import type { DrugSummary } from "./types";

/**
 * Renders a NADAC figure with its unit, per ui-spec §9. Never returns a bare
 * number: a price without its unit and date is not a fact this app may state.
 */
export function formatPerUnit(drug: DrugSummary): string {
  if (drug.nadacPerUnit === null || drug.effectiveDate === null) {
    return "No NADAC record";
  }
  return `$${drug.nadacPerUnit.toFixed(4)} per unit · as of ${drug.effectiveDate}`;
}
