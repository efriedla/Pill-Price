import type { CodegenConfig } from "@graphql-codegen/cli";

/**
 * The SDL in `src/server/schema.ts` is the source of truth; this turns it into
 * the types `features/` and `server/` meet on (ADR-003). Nothing here reads the
 * running server — codegen is a build-time tool, so pointing it at a `server/`
 * file is not a `lib → server` import and does not cross the layer graph.
 *
 * Roadmap W2, definition of done: "no hand-written response types."
 */
const config: CodegenConfig = {
  schema: "src/server/schema.ts",
  generates: {
    "src/lib/gql/types.generated.ts": {
      plugins: ["typescript"],
      config: {
        // A custom scalar with no mapping becomes `any` silently. Fail the
        // generate instead — ADR-004 deferred a `Decimal` scalar, and if it
        // ever lands it should break the build rather than erase a price type.
        strictScalars: true,
        // String unions rather than TS enums: the generated file stays
        // types-only, so importing it emits no runtime code into a bundle.
        enumsAsTypes: true,
        // Required by `verbatimModuleSyntax`.
        useTypeImports: true,
        // These are the BFF's own domain types, not a client cache's. Nothing
        // discriminates on __typename yet; add it back when something does.
        skipTypename: true,
      },
    },
  },
};

export default config;
