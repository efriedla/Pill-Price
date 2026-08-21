// Public API of the `compare` feature. Nothing outside this slice may import
// past this file — deep paths into the slice's internals are a lint error.

export { parseCompareParams, MAX_COMPARE } from "./parseCompareParams";
export type { CompareState } from "./types";
