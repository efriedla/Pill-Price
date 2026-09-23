import { describe, expect, it } from "vitest";

import type { PriceResult } from "@/lib/gql";

import { formatPerUnit, roundDecimalString } from "./formatPerUnit";
import type { DrugSummary } from "./types";

/**
 * The interesting assertions here are the ones where a float would disagree.
 * ADR-004 made `pricePerUnit` a `String!` so that decimal money survives the
 * request path; these tests are what stop a later refactor from quietly
 * calling `Number()` on it and undoing that.
 */

const summary = (price: PriceResult): DrugSummary => ({
  rxcui: "860975",
  name: "metformin hydrochloride 500 MG Extended Release Oral Tablet",
  isGeneric: true,
  price,
});

const priced = (pricePerUnit: string): DrugSummary =>
  summary({
    __typename: "Price",
    pricePerUnit,
    unit: "EA",
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
  // ui-spec §9 line 120, character for character. If the copy rule changes,
  // this fails rather than drifting quietly.
  it("reproduces the ui-spec §9 example exactly", () => {
    expect(
      formatPerUnit(
        summary({
          __typename: "Price",
          pricePerUnit: "0.0412",
          unit: "EA",
          effectiveDate: "2026-08-12",
          asOf: "2026-08-14",
        }),
      ),
    ).toBe("$0.0412 per unit · as of Aug 12, 2026");
  });

  it("states the figure with its unit and its date", () => {
    expect(formatPerUnit(priced("0.0412"))).toBe(
      "$0.0412 per unit · as of Mar 18, 2026",
    );
  });

  it("rounds the published figure to four places", () => {
    expect(formatPerUnit(priced("0.02902"))).toBe(
      "$0.0290 per unit · as of Mar 18, 2026",
    );
  });

  // The server authors both sentences (ADR-010 amendment, 2026-09-23). This
  // passes them through rather than restating them, so the copy has one home.
  it("says NADAC publishes nothing, in the server's words", () => {
    const reason =
      "NADAC doesn't publish an acquisition cost for this drug (as of Sep 11, 2026).";
    expect(
      formatPerUnit(summary({ __typename: "Absent", reason, source: "NADAC" })),
    ).toBe(reason);
  });

  it("says prices did not load, never that none exist", () => {
    const reason =
      "We couldn't load price data. This is on our side, not NADAC's. Everything else on this page is current.";
    expect(
      formatPerUnit(
        summary({
          __typename: "Unavailable",
          reason,
          source: "NADAC",
          retryable: false,
        }),
      ),
    ).toBe(reason);
  });
});
