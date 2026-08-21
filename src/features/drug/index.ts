// Public API of the `drug` feature. Nothing outside this slice may import
// past this file — deep paths into the slice's internals are a lint error.

export { formatPerUnit } from "./formatPerUnit";
export type { DrugSummary } from "./types";
