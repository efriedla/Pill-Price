/**
 * Generated GraphQL types (GraphQL Codegen output from the SDL in
 * `src/server/schema.ts`). Regenerate with `npm run codegen`.
 *
 * This is the ONLY thing `features/` and `server/` share. They may never
 * import each other; they meet on these generated types and nothing else.
 *
 * `export type *` rather than a hand-listed surface: the roadmap's W2
 * definition of done is "no hand-written response types," and an explicit list
 * would have to be edited by hand on every schema change — which is the thing
 * being avoided. It is also type-only, so importing this emits no runtime code.
 */
export type * from "./types.generated";
