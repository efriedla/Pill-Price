import { describe, expect, it } from "vitest";

import type { Price } from "@/lib/gql";

import { formatPerUnit, roundDecimalString } from "./formatPerUnit";
import type { DrugSummary } from "./types";

/**
 * The interesting assertions here are the ones where a float would disagree.
 * ADR-004 made `pricePerUnit` a `String!` so that decimal money survives the
 * request path; these tests are what stop a later refactor from quietly
 * calling `Number()` on it and undoing that.
 */

// `exactOptionalPropertyTypes` is on, so an explicitly-`undefined` `price` and
// an absent one are different types. The spread models the absent key, which is
// what a GraphQL response for an unpriced drug actually looks like.
const summary = (price?: Price | null): DrugSummary => ({
  rxcui: "860975",
  name: "metformin hydrochloride 500 MG Extended Release Oral Tablet",
  isGeneric: true,
  ...(price === undefined ? {} : { price }),
});

const priced = (pricePerUnit: string): DrugSummary =>
  summary({
    __typename: "Price",
    pricePerUnit,
    effectiveDate: "2026-03-18",
    asOf: "2026-03-20",
  });

describe("roundDecimalString", () => {
  it("pads a short fraction to four places", () => {
    expect(roundDecimalString("0.02")).toBe("0.0200");
    expect(roundDecimalString("3")).toBe("3.0000");
  });

  it("leaves an exact four-place value alone", () => {
    expect(roundDecimalString("0.0412")).toBe("0.0412");
  });

  it("truncates below the halfway digit", () => {
    expect(roundDecimalString("0.02902")).toBe("0.0290");
  });

  it("rounds half up", () => {
    expect(roundDecimalString("0.12345")).toBe("0.1235");
  });

  // The whole reason the schema carries a string. Number("8.14515") is a hair
  // under the halfway point in binary, so .toFixed(4) rounds it down.
  it("rounds half up where a float rounds down", () => {
    expect(roundDecimalString("8.14515")).toBe("8.1452");
    expect(Number("8.14515").toFixed(4)).toBe("8.1451");

    expect(roundDecimalString("2.71825")).toBe("2.7183");
    expect(Number("2.71825").toFixed(4)).toBe("2.7182");
  });

  it("carries a run of nines into the whole part", () => {
    expect(roundDecimalString("0.99999")).toBe("1.0000");
    expect(roundDecimalString("9.99999")).toBe("10.0000");
  });

  it("keeps precision a float would lose entirely", () => {
    expect(roundDecimalString("12345678901234567890.00005")).toBe(
      "12345678901234567890.0001",
    );
  });

  it("preserves a negative sign", () => {
    expect(roundDecimalString("-0.12345")).toBe("-0.1235");
  });

  it("returns anything that is not a decimal numeral untouched", () => {
    // Echoing is deliberate: coercing would invent a price.
    expect(roundDecimalString("")).toBe("");
    expect(roundDecimalString("N/A")).toBe("N/A");
    expect(roundDecimalString("1e-5")).toBe("1e-5");
  });
});

describe("formatPerUnit", () => {
  it("states the figure with its unit and its date, per ui-spec §9", () => {
    expect(formatPerUnit(priced("0.0412"))).toBe(
      "$0.0412 per unit · as of 2026-03-18",
    );
  });

  it("rounds the published figure to four places", () => {
    expect(formatPerUnit(priced("0.02902"))).toBe(
      "$0.0290 per unit · as of 2026-03-18",
    );
  });

  it("says there is no record rather than rendering nothing", () => {
    expect(formatPerUnit(summary(null))).toBe("No NADAC record");
    expect(formatPerUnit(summary())).toBe("No NADAC record");
  });
});
