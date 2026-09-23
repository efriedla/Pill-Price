/**
 * The typed operation documents, as runtime values (ADR-005 Q1 A).
 *
 * Separate from `index.ts` on purpose: that entry is type-only and emits no
 * code, and these are `DocumentNode` objects a caller passes to `runQuery`.
 * A component never needs one — it takes the operation's result type from
 * `@/lib/gql` — so importing this from a feature is a smell even though the
 * layer graph allows it.
 */
export * from "./operations.generated";
