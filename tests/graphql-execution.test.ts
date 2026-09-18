import { makeExecutableSchema } from "@graphql-tools/schema";
import { graphql } from "graphql";
import { describe, expect, it } from "vitest";

import { UpstreamUnavailableError } from "@/server/http";
import { resolvers } from "@/server/resolvers";
import { typeDefs } from "@/server/schema";

/**
 * The first tests that execute a real GraphQL query against the real SDL and
 * the real resolver map.
 *
 * **Why these did not exist until now.** Combining `makeExecutableSchema` with
 * `graphql` under vitest threw *"Cannot use GraphQLSchema from another module
 * or realm"*: graphql@17 ships both a CJS and an ESM build, the test file was
 * transformed by Vite and got the `.mjs` one, and `@graphql-tools/schema` was
 * externalised and `require`d the `.js` one. Two module instances, one
 * `instanceof` check between them. `server.deps.inline` in `vitest.config.ts`
 * is what collapses them — this file is the regression test for that, since a
 * config change with no test would quietly rot.
 *
 * What is actually being asserted is ADR-010's contract *as a client sees it*.
 * `tests/kill-one-upstream.test.ts` asserts degradation at the transport and
 * loader layer and says so in its own header; these assert that the same three
 * outcomes survive execution and arrive with `__typename` on them, which is the
 * only thing a client can switch on.
 */

const schema = makeExecutableSchema({ typeDefs, resolvers });

const drug = {
  rxcui: "860975",
  name: "metformin hydrochloride 500 MG Extended Release Oral Tablet",
  tty: "SCD",
};

type LoaderStubs = {
  label?: () => Promise<unknown>;
  related?: () => Promise<{ tty: string; concepts: unknown[] }[]>;
  ndcs?: () => Promise<string[]>;
};

const context = (stubs: LoaderStubs = {}) => ({
  loaders: {
    properties: { load: async () => drug },
    ndcs: { load: stubs.ndcs ?? (async () => []) },
    related: { load: stubs.related ?? (async () => []) },
    label: { load: stubs.label ?? (async () => null) },
  },
  prices: null,
});

const run = (source: string, stubs: LoaderStubs = {}) =>
  graphql({ schema, source, contextValue: context(stubs) });

describe("executing a real query", () => {
  it("resolves identity fields off the RxNorm concept", async () => {
    const res = await run(`{ drug(rxcui:"860975"){ rxcui name tty isGeneric } }`);
    expect(res.errors).toBeUndefined();
    expect(res.data?.drug).toEqual({
      rxcui: "860975",
      name: drug.name,
      tty: "SCD",
      // Derived from the TTY, never fetched — SCD is a generic product concept.
      isGeneric: true,
    });
  });

  it("returns null for an unknown rxcui without raising an error", async () => {
    // ADR-010: not-found is not a failure. RxNorm answers `{}` with HTTP 200,
    // and that has to arrive as a null drug rather than as a GraphQL error.
    const res = await graphql({
      schema,
      source: `{ drug(rxcui:"99999999"){ rxcui } }`,
      contextValue: {
        ...context(),
        loaders: { ...context().loaders, properties: { load: async () => null } },
      },
    });
    expect(res.errors).toBeUndefined();
    expect(res.data).toEqual({ drug: null });
  });
});

describe("ADR-010's taxonomy, as a client receives it", () => {
  const labelQuery = `{
    drug(rxcui:"860975"){
      label {
        __typename
        ... on Label { openFDALabel }
        ... on Absent { reason source }
        ... on Unavailable { reason source retryable }
      }
    }
  }`;

  it("says openFDA came up empty, and names openFDA", async () => {
    const res = await run(labelQuery, { label: async () => null });
    expect(res.errors).toBeUndefined();
    expect(res.data?.drug).toEqual({
      label: {
        __typename: "Absent",
        reason: "openFDA has no label for this drug.",
        source: "openFDA",
      },
    });
  });

  it("distinguishes an upstream that is down from one that says no", async () => {
    // The distinction the whole taxonomy rests on: `Unavailable` is retryable,
    // `Absent` is a settled fact. Resolving one as the other strips the retry
    // affordance from an outage, or invites a retry of a published nothing.
    const res = await run(labelQuery, {
      label: async () => {
        throw new UpstreamUnavailableError(
          "openfda",
          "https://api.fda.gov/drug/label.json",
          2,
          "timeout",
        );
      },
    });
    expect(res.errors).toBeUndefined();
    expect(res.data?.drug).toEqual({
      label: {
        __typename: "Unavailable",
        reason: "We could not reach openFDA for this drug's label.",
        source: "openFDA",
        retryable: true,
      },
    });
  });

  it("degrades the label without taking the page with it", async () => {
    // "Identity is fatal, enrichment is partial." A dead openFDA costs the
    // label section; the name and rxcui still render.
    const res = await run(
      `{ drug(rxcui:"860975"){ rxcui name label { __typename } } }`,
      {
        label: async () => {
          throw new UpstreamUnavailableError(
          "openfda",
          "https://api.fda.gov/drug/label.json",
          2,
          "timeout",
        );
        },
      },
    );
    expect(res.errors).toBeUndefined();
    expect(res.data?.drug).toMatchObject({
      rxcui: "860975",
      name: drug.name,
      label: { __typename: "Unavailable" },
    });
  });

  it("states that RxNorm lists no alternatives rather than sending an empty list", async () => {
    // An empty `Alternatives` and "RxNorm found none" are two encodings of the
    // same thing, and a client renders one of them as nothing.
    const res = await run(`{
      drug(rxcui:"860975"){
        alternatives {
          __typename
          ... on Absent { reason source }
          ... on Alternatives { drugs { rxcui } }
        }
      }
    }`);
    expect(res.errors).toBeUndefined();
    expect(res.data?.drug).toEqual({
      alternatives: {
        __typename: "Absent",
        reason: "RxNorm lists no other products for this drug.",
        source: "RxNorm",
      },
    });
  });
});

describe("priceHistory, which has no store behind it yet", () => {
  it("states that we cannot build the series, and does not offer a retry", async () => {
    // The field is `PriceSeriesResult!` again after a spell as a nullable
    // `PriceSeries`. Non-null is safe here where `PriceSeries!` was not: the
    // union always has a member to return, so nothing propagates up and takes
    // `drug` with it (measured 2026-09-16, "Cannot return null for
    // non-nullable field Drug.priceHistory").
    const res = await run(`{
      drug(rxcui:"860975"){
        rxcui
        name
        priceHistory {
          __typename
          ... on Unavailable { reason source retryable }
          ... on Absent { reason source }
          ... on PriceSeries { range unit }
        }
      }
    }`);
    expect(res.errors).toBeUndefined();
    expect(res.data?.drug).toEqual({
      rxcui: "860975",
      name: drug.name,
      priceHistory: {
        __typename: "Unavailable",
        reason: "We do not store price history for this drug yet.",
        source: "NADAC",
        // Not retryable, and this is the assertion that matters: a retry
        // against a store that does not exist cannot succeed, and ADR-010
        // reads a retry affordance as a promise that it can.
        retryable: false,
      },
    });
  });

  it("is not Absent, which would be a false claim about NADAC", async () => {
    // NADAC does publish the history. The gap is ours, so `Absent` — "the
    // source answered, and its answer was nothing" — would attribute our
    // retention decision to them.
    const res = await run(
      `{ drug(rxcui:"860975"){ priceHistory { __typename } } }`,
    );
    expect(res.data?.drug).toEqual({
      priceHistory: { __typename: "Unavailable" },
    });
  });

  it("does not take the drug down when the range argument is given", async () => {
    const res = await run(
      `{ drug(rxcui:"860975"){ name priceHistory(range: MAX) { __typename } } }`,
    );
    expect(res.errors).toBeUndefined();
    expect(res.data?.drug).toMatchObject({ name: drug.name });
  });
});

describe("prices before the first snapshot job has run", () => {
  it("reports no price rather than failing", async () => {
    // `prices: null` is a legitimate cold start, and ADR-009 makes an absent
    // price a published fact rather than an error.
    const res = await run(`{ drug(rxcui:"860975"){ price { pricePerUnit unit } } }`, {
      ndcs: async () => ["29300038901"],
    });
    expect(res.errors).toBeUndefined();
    expect(res.data?.drug).toEqual({ price: null });
  });
});
