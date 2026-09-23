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
 *
 * Two sources: schema types (everything a `Drug` *could* have) and operation
 * types (what one query actually selected, ADR-005). A component should take
 * the operation type — e.g. `DrugHeaderQuery` — so that reading a field its
 * query never asked for is a compile error rather than a runtime `undefined`.
 *
 * The operation *documents* are runtime values and are deliberately not here;
 * they live behind `./documents` so this entry stays type-only.
 */
export type * from "./types.generated";
export type * from "./operations.generated";
