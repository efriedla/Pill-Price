import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DrugVersions, sharedAbsence, type VersionsDrug } from "./DrugVersions";
import type { PriceLinePrice } from "./PriceLine";

const NOT_PUBLISHED =
  "NADAC doesn't publish an acquisition cost for this drug (as of Sep 11, 2026).";
const absent: PriceLinePrice = { __typename: "Absent", reason: NOT_PUBLISHED };
const priced: PriceLinePrice = {
  __typename: "Price",
  pricePerUnit: "0.1195",
  effectiveDate: "2026-08-19",
};

describe("sharedAbsence", () => {
  it("collapses two or more versions unpriced for the same reason", () => {
    expect(sharedAbsence([absent, absent, absent])).toBe(NOT_PUBLISHED);
  });

  it("leaves a single version's line in its card", () => {
    expect(sharedAbsence([absent])).toBeNull();
  });

  it("keeps per-card lines when any version is priced: which ones are unpriced is the point", () => {
    expect(sharedAbsence([absent, priced, absent])).toBeNull();
  });

  it("keeps per-card lines when the reasons differ", () => {
    expect(
      sharedAbsence([
        absent,
        { __typename: "Unavailable", reason: "We couldn't load price data." },
      ]),
    ).toBeNull();
  });
});

describe("DrugVersions", () => {
  const withVersions = (prices: PriceLinePrice[]): VersionsDrug => ({
    name: "ibuprofen 200 MG Oral Tablet",
    doseForm: { __typename: "DoseForm", name: "Oral Tablet" },
    ingredients: {
      __typename: "Ingredients",
      ingredients: [{ rxcui: "5640", name: "ibuprofen" }],
    },
    alternatives: {
      __typename: "Alternatives",
      drugs: prices.map((price, i) => ({
        rxcui: String(900000 + i),
        name: `ibuprofen 200 MG Oral Tablet [Brand ${i}]`,
        isGeneric: false,
        price,
      })),
    },
  });

  it("says a shared absence once, under the list, not once per card", () => {
    render(<DrugVersions drug={withVersions(Array(8).fill(absent))} />);
    expect(screen.getAllByText(NOT_PUBLISHED)).toHaveLength(1);
    expect(screen.getAllByRole("listitem")).toHaveLength(8);
  });

  it("keeps each card's line when the list is mixed", () => {
    render(<DrugVersions drug={withVersions([absent, priced])} />);
    expect(screen.getAllByText(NOT_PUBLISHED)).toHaveLength(1);
    expect(screen.getByText("$0.1195")).toBeInTheDocument();
  });
});
