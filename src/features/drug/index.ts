// Public API of the `drug` feature. Nothing outside this slice may import
// past this file — deep paths into the slice's internals are a lint error.

export { AcquisitionCostNotice } from "./AcquisitionCostNotice";
export { DrugVersions, type VersionsDrug } from "./DrugVersions";
export { DrugVersionsFallback } from "./DrugVersionsFallback";
export { formatPerUnit } from "./formatPerUnit";
export { PriceHeader, type HeaderDrug } from "./PriceHeader";
export { PriceHeaderFallback } from "./PriceHeaderFallback";
export type { DrugSummary } from "./types";
