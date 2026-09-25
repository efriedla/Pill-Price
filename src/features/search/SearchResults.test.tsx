import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SearchResults, type SearchResult } from "./SearchResults";

const r = (rxcui: string, name: string, isGeneric: boolean): SearchResult => ({
  rxcui,
  name,
  isGeneric,
});

describe("SearchResults", () => {
  it("puts generics before brands, each alphabetical, whatever order RxNorm sends", () => {
    render(
      <SearchResults
        q="atorvastatin"
        results={[
          r("617314", "atorvastatin 10 MG Oral Tablet [Lipitor]", false),
          r("617318", "atorvastatin 80 MG Oral Tablet", true),
          r("617312", "atorvastatin 10 MG Oral Tablet", true),
        ]}
      />,
    );
    const [generic, brand] = screen.getAllByRole("region");
    expect(
      within(generic!)
        .getAllByRole("link")
        .map((a) => a.textContent),
    ).toEqual([
      "atorvastatin 10 MG Oral Tablet",
      "atorvastatin 80 MG Oral Tablet",
    ]);
    expect(within(brand!).getByRole("link")).toHaveAttribute(
      "href",
      "/drug/617314",
    );
  });

  it("counts what matched", () => {
    render(
      <SearchResults
        q="lipitor"
        results={[r("617314", "Lipitor 10", false)]}
      />,
    );
    expect(
      screen.getByText("1 product matches “lipitor”."),
    ).toBeInTheDocument();
  });

  it("leaves out a group with nothing in it", () => {
    render(
      <SearchResults
        q="lipitor"
        results={[r("617314", "Lipitor 10", false)]}
      />,
    );
    expect(screen.queryByRole("heading", { name: /Generic/ })).toBeNull();
  });

  it("says why nothing matched, and what usually fixes it", () => {
    render(<SearchResults q="metformin 500" results={[]} />);
    expect(
      screen.getByText(/No drugs match “metformin 500”\. .*without a strength/),
    ).toBeInTheDocument();
  });
});
