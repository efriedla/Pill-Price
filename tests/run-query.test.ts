import { describe, expect, expectTypeOf, it } from "vitest";

import type { DrugHeaderQuery } from "@/lib/gql";
import { DrugHeaderDocument } from "@/lib/gql/documents";
import type { GraphQLContext } from "@/server/context";
import { QueryError, runQuery } from "@/server/run-query";

/**
 * ADR-005 Q1 A: pages read data by executing a codegen'd document in-process.
 *
 * These run the real `DrugHeader` document against the real schema — the same
 * `schema` object `/api/graphql` serves — with the loaders and price index
 * stubbed, the way `graphql-execution.test.ts` stubs them. What they pin down
 * is the part `runQuery` adds on top of execution: the types come from the
 * document, and a GraphQL `errors` entry throws rather than returning a
 * partial result a page could mistake for an absence.
 */

const drug = {
  rxcui: "860975",
  name: "metformin hydrochloride 500 MG Extended Release Oral Tablet",
  tty: "SCD",
};

const stubContext = (overrides: {
  properties?: () => Promise<unknown>;
  prices?: Record<string, string>;
} = {}) =>
  async () =>
    ({
      loaders: {
        properties: { load: overrides.properties ?? (async () => drug) },
        ndcs: { load: async () => Object.keys(overrides.prices ?? {}) },
        related: { load: async () => [] },
        label: { load: async () => null },
      },
      prices: overrides.prices
        ? {
            asOf: "2026-09-14T03:00:00Z",
            forNdc: (ndc: string) => {
              const perUnit = overrides.prices?.[ndc];
              return perUnit
                ? {
                    pricePerUnit: perUnit,
                    effectiveDate: "2026-09-09",
                    asOf: "2026-09-14T03:00:00Z",
                    unit: "EA",
                  }
                : null;
            },
            coverage: () => ({ pricedPackages: 0, totalPackages: 0 }),
          }
        : null,
    }) as unknown as GraphQLContext;

describe("runQuery", () => {
  it("executes DrugHeader against the real schema and returns its selection", async () => {
    const data = await runQuery(
      DrugHeaderDocument,
      { rxcui: "860975" },
      stubContext({ prices: { "00093726701": "0.08145", "00093726710": "0.09" } }),
    );

    // No __typename anywhere: DrugHeader never selects it, and graphql-js adds
    // none. The generated `DrugHeaderQuery` must say the same — it once claimed
    // `__typename: 'Drug'` here, which is what `skipTypename` in codegen.ts
    // fixes. (Not `toStrictEqual`: graphql-js builds null-prototype objects,
    // so that fails on the prototype with "no visual difference".)
    expect(data).not.toHaveProperty("__typename");
    expect(data.drug).not.toHaveProperty("__typename");
    expect(data.drug?.price).not.toHaveProperty("__typename");
    expect(data).toEqual({
      drug: {
        rxcui: "860975",
        name: drug.name,
        tty: "SCD",
        isGeneric: true,
        price: {
          // The cheaper package, digit for digit — a decimal string end to end.
          pricePerUnit: "0.08145",
          unit: "EA",
          effectiveDate: "2026-09-09",
          asOf: "2026-09-14T03:00:00Z",
        },
      },
    });
  });

  it("returns null for an unknown rxcui — an absence, not an error", async () => {
    const data = await runQuery(
      DrugHeaderDocument,
      { rxcui: "0" },
      stubContext({ properties: async () => null }),
    );
    expect(data.drug).toBeNull();
  });

  it("throws on a GraphQL error instead of returning partial data", async () => {
    // A resolver that throws is a bug, not a degraded state: ADR-010 puts
    // every expected failure in the data. Partial data here would be a null
    // `drug` indistinguishable from "no such drug".
    const run = runQuery(
      DrugHeaderDocument,
      { rxcui: "860975" },
      stubContext({
        properties: async () => {
          throw new Error("resolver exploded");
        },
      }),
    );
    await expect(run).rejects.toBeInstanceOf(QueryError);
    await expect(run).rejects.toThrow(/resolver exploded/);
  });

  it("builds a fresh context for every call", async () => {
    // A shared context would share DataLoaders, whose cache has no TTL.
    let built = 0;
    const counting = async () => {
      built += 1;
      return stubContext()();
    };
    await runQuery(DrugHeaderDocument, { rxcui: "860975" }, counting);
    await runQuery(DrugHeaderDocument, { rxcui: "860975" }, counting);
    expect(built).toBe(2);
  });
});

describe("operation types", () => {
  it("are inferred from the document, with no annotation at the call site", () => {
    expectTypeOf(
      runQuery(DrugHeaderDocument, { rxcui: "860975" }, stubContext()),
    ).resolves.toEqualTypeOf<DrugHeaderQuery>();
  });

  it("exclude fields the query did not select", () => {
    // Checked by `tsc`, not at runtime: the schema's `Drug` has a `label`, but
    // DrugHeader never asks for it, so reading it must not compile.
    const read = (data: DrugHeaderQuery) =>
      // @ts-expect-error — `label` is not in DrugHeader's selection.
      data.drug?.label;
    expect(read).toBeTypeOf("function");
  });

  it("carry no __typename the query did not select", () => {
    // The type half of the toStrictEqual above. If this starts failing, the
    // types are promising a discriminant the runtime result does not have.
    expectTypeOf<NonNullable<DrugHeaderQuery["drug"]>>().not.toHaveProperty(
      "__typename",
    );
  });

  it("reject variables the document does not declare", () => {
    const call = () =>
      // @ts-expect-error — DrugHeader takes `rxcui`, not `id`.
      runQuery(DrugHeaderDocument, { id: "860975" }, stubContext());
    expect(call).toBeTypeOf("function");
  });
});
