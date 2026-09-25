import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DrugLabel, provenance, type LabelDrug } from "./DrugLabel";

const LONG = "Lactic acidosis has occurred. ".repeat(20);

const shown = (
  over: Partial<Extract<LabelDrug["label"], { __typename: "Label" }>> = {},
): LabelDrug => ({
  label: {
    __typename: "Label",
    setId: "a60cc18b-0631-4cf0-b021-9f52224ece65",
    productName: "Lipitor",
    manufacturer: "Viatris Specialty LLC",
    effectiveDate: "2024-04-15",
    chosenBy: "REFERENCE_IN_RESULTS",
    sections: [
      { kind: "BOXED_WARNING", paragraphs: [LONG] },
      { kind: "INDICATIONS_AND_USAGE", paragraphs: [LONG] },
      { kind: "CONTRAINDICATIONS", paragraphs: ["Do not use."] },
    ],
    ...over,
  },
});

describe("provenance", () => {
  const label = shown().label as Extract<
    LabelDrug["label"],
    { __typename: "Label" }
  >;

  it("names the document and says generic labels follow it, for steps 1 to 3", () => {
    for (const chosenBy of [
      "OWN_LABEL",
      "REFERENCE_IN_RESULTS",
      "BRAND_VERSION",
    ] as const) {
      expect(provenance({ ...label, chosenBy })).toBe(
        "Label: Lipitor, from Viatris Specialty LLC · updated Apr 15, 2024. Generic labels follow this one.",
      );
    }
  });

  it("never says identical: a generic may carve out a patented indication", () => {
    expect(provenance(label)).not.toMatch(/identical/i);
  });

  it("says why on step 4, without claiming to be the label", () => {
    const text = provenance({
      ...label,
      productName: "Metformin ER 500 mg",
      manufacturer: "Granules India Ltd",
      effectiveDate: "2026-07-17",
      chosenBy: "ORIGINAL_PACKAGER",
    });
    expect(text).toBe(
      "Label: Metformin ER 500 mg, from Granules India Ltd · updated Jul 17, 2026. No brand-name label is published, so this is the newest from a company that makes this drug.",
    );
    expect(text).not.toMatch(/\bthe label\b/i);
  });
});

describe("DrugLabel", () => {
  it("never clamps the boxed warning and never puts it behind a button", () => {
    render(<DrugLabel drug={shown()} />);
    const boxed = document.getElementById("label-boxed-warning");
    expect(boxed).not.toBeNull();
    expect(boxed?.querySelector("button")).toBeNull();
    expect(boxed?.querySelector(".line-clamp-3")).toBeNull();
  });

  it("clamps a long section behind a real button that reports its state", () => {
    render(<DrugLabel drug={shown()} />);
    const button = screen.getByRole("button", { name: "Show more" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveTextContent("Show less");
  });

  it("offers no button on a section short enough to read whole", () => {
    render(<DrugLabel drug={shown()} />);
    // Two long sections, one of them the boxed warning: one button in all.
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("deep-links each section and footers it with its source", () => {
    render(<DrugLabel drug={shown()} />);
    expect(
      document.getElementById("label-indications-and-usage"),
    ).not.toBeNull();
    expect(
      screen.getAllByText("Source: FDA label · updated Apr 15, 2024"),
    ).toHaveLength(3);
  });

  it("links the full document on DailyMed by set id", () => {
    render(<DrugLabel drug={shown()} />);
    expect(
      screen.getByRole("link", { name: "Full label on DailyMed" }),
    ).toHaveAttribute(
      "href",
      "https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=a60cc18b-0631-4cf0-b021-9f52224ece65",
    );
  });

  it("renders an absence as the server's sentence, verbatim", () => {
    render(
      <DrugLabel
        drug={{
          label: {
            __typename: "Absent",
            reason: "openFDA has no label for this drug.",
          },
        }}
      />,
    );
    expect(
      screen.getByText("openFDA has no label for this drug."),
    ).toBeInTheDocument();
  });
});
