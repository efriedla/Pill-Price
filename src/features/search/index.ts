// Public API of the `search` feature. Nothing outside this slice may import
// past this file — deep paths into the slice's internals are a lint error.

export { parseSearchParams } from "./parseSearchParams";
export type { SearchQuery } from "./types";
