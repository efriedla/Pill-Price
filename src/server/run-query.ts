import "server-only";

import type { TypedDocumentNode } from "@graphql-typed-document-node/core";
import { execute } from "graphql";

import { createContext, type GraphQLContext } from "./context";
import { schema } from "./schema";

/**
 * How a page reads data: ADR-005 Q1 A.
 *
 * In-process execution of a codegen'd document against the real schema. Not a
 * `fetch` to `/api/graphql` — a Server Component prerendered at build time
 * has no server to call, and the Next docs say that fails the build
 * (`backend-for-frontend.md`). Not the loaders or `cached*` functions
 * directly either — ADR-010's error taxonomy lives in the resolvers, and a page
 * that skipped them would grow its own idea of what a missing label means.
 *
 * Both type parameters are inferred from the document, so a caller writes
 * `runQuery(DrugHeaderDocument, { rxcui })` and gets `DrugHeaderQuery` back
 * with no annotation and no hand-written response type.
 *
 * **A fresh context per call, never a shared one.** `createContext` builds new
 * DataLoaders, and a loader's cache has no TTL; a module-level context would
 * serve one request's answers to every later one. Cross-request caching is the
 * `use cache` layer's job (ADR-001), and it sits below the loaders.
 */
export async function runQuery<
  TData,
  TVariables extends Record<string, unknown>,
>(
  document: TypedDocumentNode<TData, TVariables>,
  variables: TVariables,
  // Injectable for tests only, the same way the upstream clients take
  // `HttpDeps`. Production never passes it.
  makeContext: () => Promise<GraphQLContext> = createContext,
): Promise<TData> {
  const result = await execute({
    schema,
    document,
    variableValues: variables,
    contextValue: await makeContext(),
  });

  // **Any `errors` entry is a bug, so it throws.** ADR-010 puts every expected
  // failure — an upstream down, a label absent — in the data as a union
  // member. What is left in `errors` is a resolver that threw or a document
  // the schema rejected, and neither is a state a page should render around.
  // Returning the partial `data` beside it would hand the page nulls that look
  // exactly like "NADAC publishes nothing", which is the silence ADR-010
  // exists to rule out. Throwing lets the route's error boundary own it.
  if (result.errors?.length) {
    throw new QueryError(result.errors.map((e) => e.message));
  }
  if (!result.data) {
    throw new QueryError(["Execution returned no data and no errors."]);
  }
  return result.data as TData;
}

export class QueryError extends Error {
  constructor(readonly messages: readonly string[]) {
    super(`GraphQL execution failed: ${messages.join("; ")}`);
    this.name = "QueryError";
  }
}
