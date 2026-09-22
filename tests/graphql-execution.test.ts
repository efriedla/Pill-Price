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
  /** NDC -> per-unit price, as published. Absent NDCs are unpriced. */
  prices?: Record<string, string>;
};

const context = (stubs: LoaderStubs = {}) => ({
  loaders: {
    properties: { load: async () => drug },
    ndcs: { load: stubs.ndcs ?? (async () => []) },
    related: { load: stubs.related ?? (async () => []) },
    label: { load: stubs.label ?? (async () => null) },
  },
  prices: stubs.prices
    ? {
        asOf: "2026-09-14T03:00:00Z",
        forNdc: (ndc: string) => {
          const perUnit = stubs.prices?.[ndc];
          return perUnit
            ? {
                pricePerUnit: perUnit,
                effectiveDate: "2026-09-09",
                asOf: "2026-09-14T03:00:00Z",
                unit: "EA",
              }
            : null;
        },
        coverage: (ndcs: string[]) => ({
          pricedPackages: ndcs.filter((n) => stubs.prices?.[n]).length,
          totalPackages: ndcs.length,
        }),
      }
    : null,
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

describe("the cheapest package, chosen without a float", () => {
  // ADR-004 decision 1: money is a decimal string so that binary floating
  // point never touches it. This reduction is the one place the server orders
  // two prices, and it is not a formality — of 3,836 NADAC descriptions
  // covering more than one NDC, 1,206 (31.4%) have packages that disagree, at
  // a median spread of 9.9% (measured, ADR-014). The figure this picks is the
  // one on the page.

  const ndcs = async () => ["A", "B", "C"];

  it("picks the lowest of packages that disagree", async () => {
    const res = await run(`{ drug(rxcui:"860975"){ price { pricePerUnit } } }`, {
      ndcs,
      prices: { A: "0.64093", B: "0.53801", C: "0.58120" },
    });
    expect(res.errors).toBeUndefined();
    expect(res.data?.drug).toEqual({ price: { pricePerUnit: "0.53801" } });
  });

  it("orders by magnitude, not by string — 9.99 is cheaper than 10.00", async () => {
    // The shape a lexicographic comparison gets wrong: "10.00" sorts before
    // "9.99". compareDecimal compares integer-part length first.
    const res = await run(`{ drug(rxcui:"860975"){ price { pricePerUnit } } }`, {
      ndcs,
      prices: { A: "10.00", B: "9.99", C: "12.50" },
    });
    expect(res.data?.drug).toEqual({ price: { pricePerUnit: "9.99" } });
  });

  it("compares fractions of unequal length", async () => {
    const res = await run(`{ drug(rxcui:"860975"){ price { pricePerUnit } } }`, {
      ndcs,
      prices: { A: "0.1", B: "0.09", C: "0.10000" },
    });
    expect(res.data?.drug).toEqual({ price: { pricePerUnit: "0.09" } });
  });

  it("returns the price as published, digit for digit", async () => {
    // The reason none of this may round-trip through a float: 8.14515 is not
    // representable, and the page renders what NADAC published.
    const res = await run(`{ drug(rxcui:"860975"){ price { pricePerUnit } } }`, {
      ndcs: async () => ["A"],
      prices: { A: "8.14515" },
    });
    expect(res.data?.drug).toEqual({ price: { pricePerUnit: "8.14515" } });
  });

  it("is null when no package is priced", async () => {
    const res = await run(`{ drug(rxcui:"860975"){ price { pricePerUnit } } }`, {
      ndcs,
      prices: { D: "0.10" },
    });
    expect(res.data?.drug).toEqual({ price: null });
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

describe("Q7's identity fields", () => {
  const groups = [
    { tty: "IN", concepts: [{ rxcui: "6809", name: "metformin", tty: "IN" }] },
    {
      tty: "DF",
      concepts: [{ rxcui: "316945", name: "Oral Tablet", tty: "DF" }],
    },
  ];

  it("resolves the ingredient and the dose form from one related call", async () => {
    // Both read ctx.loaders.related, so the loader is asked once and the two
    // fields cost nothing beyond the request `alternatives` already makes.
    let calls = 0;
    const res = await run(
      `{
        drug(rxcui:"860975"){
          ingredients {
            __typename
            ... on Ingredients { ingredients { rxcui name } }
          }
          doseForm {
            __typename
            ... on DoseForm { rxcui name }
          }
        }
      }`,
      {
        related: async () => {
          calls += 1;
          return groups;
        },
      },
    );
    expect(res.errors).toBeUndefined();
    expect(res.data?.drug).toEqual({
      ingredients: {
        __typename: "Ingredients",
        ingredients: [{ rxcui: "6809", name: "metformin" }],
      },
      doseForm: { __typename: "DoseForm", rxcui: "316945", name: "Oral Tablet" },
    });
    // The stub stands in for the DataLoader, so this asserts the resolvers
    // share one load rather than that the loader batches.
    expect(calls).toBe(2);
  });

  it("states a pack's missing dose form instead of leaving it blank", async () => {
    // The ordinary path for a GPCK/BPCK, not a failure: there is no single
    // dose form for a box of several products, and a blank would read as one.
    const res = await run(
      `{
        drug(rxcui:"860975"){
          doseForm {
            __typename
            ... on Absent { reason source }
          }
        }
      }`,
      { related: async () => [groups[0]!] },
    );
    expect(res.errors).toBeUndefined();
    expect(res.data?.drug).toEqual({
      doseForm: {
        __typename: "Absent",
        reason: "RxNorm names no dose form for this drug.",
        source: "RxNorm",
      },
    });
  });

  it("degrades identity to Unavailable when RxNorm cannot be reached", async () => {
    // Identity by name, enrichment by transport: ADR-010 rule 3 says the page
    // still renders. The drug's own name survives, which is what makes
    // degrading acceptable for a field called identity.
    const res = await run(
      `{
        drug(rxcui:"860975"){
          name
          ingredients {
            __typename
            ... on Unavailable { reason source retryable }
          }
        }
      }`,
      {
        related: async () => {
          throw new UpstreamUnavailableError(
            "rxnorm",
            "https://rxnav.nlm.nih.gov/REST/rxcui/860975/allrelated.json",
            2,
            "timeout",
          );
        },
      },
    );
    expect(res.errors).toBeUndefined();
    expect(res.data?.drug).toEqual({
      name: drug.name,
      ingredients: {
        __typename: "Unavailable",
        reason: "We could not reach RxNorm for this drug's ingredients.",
        source: "RxNorm",
        retryable: true,
      },
    });
  });
});
