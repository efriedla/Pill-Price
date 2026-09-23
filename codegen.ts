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
  // ADR-005 Q1 A: pages execute these documents in-process against the schema
  // (`src/server/run-query.ts`), never over HTTP. Each operation lives in the
  // feature that renders its result, so the selection and the component that
  // reads it change together. They are read here at build time and imported by
  // nothing, so a `.graphql` file in a slice crosses no boundary.
  documents: "src/features/**/*.graphql",
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
        // ADR-010 put unions in the schema, and a union is only discriminable
        // by __typename — without it the generated LabelResult is a union of
        // structurally similar objects and `switch` on it does not narrow.
        // Something now discriminates on __typename, so it is back.
        skipTypename: false,
        // And non-optional, which is what actually makes LabelResult a
        // discriminated union: with an optional __typename a `switch` narrows
        // nothing, and a client that forgets the Unavailable branch compiles
        // fine — the exact failure the union exists to prevent.
        nonOptionalTypename: true,
      },
    },
    // Operation types: the result shaped by what the query *selects*, not by
    // everything the schema could return. Schema types alone let a component
    // read `drug.label` off a query that never asked for it — it compiles and
    // is `undefined` at runtime. Here an unselected field is a type error.
    //
    // **This file is not type-only.** `typed-document-node` emits each
    // operation as a runtime `DocumentNode` constant carrying its result and
    // variable types, which is what lets `runQuery` infer both from one
    // argument. So it is kept out of `index.ts` (which stays type-only) and
    // reached through `documents.ts` by the server-side caller that needs the
    // values.
    "src/lib/gql/operations.generated.ts": {
      plugins: ["typescript-operations", "typed-document-node"],
      config: {
        // Same reasons as above; each output's config is independent.
        strictScalars: true,
        enumsAsTypes: true,
        useTypeImports: true,
        // **The opposite of the schema-types setting, on purpose.** There,
        // __typename is required so a union narrows. Here the types describe
        // what `execute` actually returns, and plain graphql-js — unlike
        // Apollo — adds no __typename the document did not select. With
        // `nonOptionalTypename` these types claimed `__typename: 'Drug'` on a
        // result that had none (measured: `tests/run-query.test.ts`), so a
        // `switch` on a label would compile and match no branch at runtime.
        //
        // With `skipTypename`, __typename is in the type exactly where the
        // query selects it. A page that wants to discriminate a union must
        // select `__typename` on it — and if it forgets, the `switch` does not
        // compile. That keeps ADR-010's guarantee at the page, not just at the
        // schema.
        skipTypename: true,
      },
    },
  },
};

export default config;
