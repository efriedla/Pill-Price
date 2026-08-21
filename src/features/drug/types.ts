/** Internal to the `drug` slice. Re-exported from `index.ts` where public. */
export interface DrugSummary {
  rxcui: string;
  brandName: string | null;
  genericName: string;
  /** NADAC price per unit. `null` when the product has no survey record. */
  nadacPerUnit: number | null;
  /** Effective date of `nadacPerUnit`, ISO-8601. */
  effectiveDate: string | null;
}
