/** Internal to the `compare` slice. Re-exported from `index.ts` where public. */
export interface CompareState {
  rxcuis: string[];
  baseline: string | null;
  units: "unit" | "hundred";
  window: "quarter" | "year" | "first";
}
