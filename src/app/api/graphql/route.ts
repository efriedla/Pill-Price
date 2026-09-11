import { graphql } from "graphql";

import { createContext } from "@/server/context";
import { schema } from "@/server/schema";

/**
 * The BFF endpoint. ADR-003 granted `app → server` for exactly this.
 *
 * Deliberately `graphql-js` directly rather than a server framework: the only
 * things this needs are a POST body, a context, and an execution call, and a
 * dependency that also brings a landing page, subscriptions and a plugin system
 * would be carrying weight nothing here uses. `graphql` is already a direct
 * dependency for the schema itself.
 *
 * POST only. A GET with the query in the URL would put drug names in access
 * logs and referrer headers — ADR-010's logging rule keeps user queries out of
 * logs, and that is easier to honour by never accepting them in a URL.
 */

// No `export const dynamic` here: route segment config is incompatible with
// `cacheComponents` and fails the build. Under Cache Components the boundary is
// per-cached-function, not per-route — a POST handler reading a request body is
// dynamic by construction, and the caching happens inside `server/cached.ts`.

type Body = {
  query?: unknown;
  variables?: unknown;
  operationName?: unknown;
};

export async function POST(request: Request): Promise<Response> {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json(
      { errors: [{ message: "Request body must be JSON." }] },
      { status: 400 },
    );
  }

  if (typeof body.query !== "string") {
    return Response.json(
      { errors: [{ message: "Expected a `query` string." }] },
      { status: 400 },
    );
  }

  const result = await graphql({
    schema,
    source: body.query,
    contextValue: await createContext(),
    variableValues:
      typeof body.variables === "object" && body.variables !== null
        ? (body.variables as Record<string, unknown>)
        : undefined,
    operationName:
      typeof body.operationName === "string" ? body.operationName : undefined,
  });

  // A GraphQL error is still HTTP 200: the response body is the contract, and
  // a partial result with an `errors` array is a success at the transport
  // level. ADR-010's degraded states are union members, not entries here.
  return Response.json(result);
}
