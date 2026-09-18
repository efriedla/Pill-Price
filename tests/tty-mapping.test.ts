import { describe, expect, it } from "vitest";

import { LABEL_QUERYABLE_TTYS } from "@/server/openfda-client";
import {
  ALTERNATIVE_TTYS,
  BRAND_TTYS,
  GENERIC_TTYS,
  isAlternativeTty,
  isGenericTty,
  selectAlternatives,
  selectDoseForm,
  selectIngredients,
  ttysForKind,
} from "@/server/tty";
import type { ConceptProperties } from "@/server/upstream/rxnorm.schema";

/** Q7's answer, pinned. */

const concept = (rxcui: string, name: string, tty: string): ConceptProperties =>
  ({
    rxcui,
    name,
    tty,
    synonym: "",
    language: "ENG",
    suppress: "N",
    umlscui: "",
  }) as ConceptProperties;

/** The real shape of `allrelated.json` for atorvastatin 10 MG Oral Tablet. */
const ATORVASTATIN_GROUPS = [
  { tty: "BN", concepts: [concept("153165", "Lipitor", "BN")] },
  { tty: "DF", concepts: [concept("317541", "Oral Tablet", "DF")] },
  { tty: "DFG", concepts: [concept("1151133", "Oral Product", "DFG")] },
  { tty: "IN", concepts: [concept("83367", "atorvastatin", "IN")] },
  {
    tty: "SBD",
    concepts: [
      concept("617318", "atorvastatin 10 MG Oral Tablet [Lipitor]", "SBD"),
    ],
  },
  { tty: "SCDC", concepts: [concept("329002", "atorvastatin 10 MG", "SCDC")] },
  {
    tty: "SCD",
    concepts: [concept("617312", "atorvastatin 10 MG Oral Tablet", "SCD")],
  },
];

describe("what counts as an alternative", () => {
  it("admits only the four dispensable product concepts", () => {
    expect([...ALTERNATIVE_TTYS].sort()).toEqual(
      ["BPCK", "GPCK", "SBD", "SCD"].sort(),
    );
  });

  it("excludes ingredients, dose forms and brand names", () => {
    // None of these is something a pharmacy can hand over, and each would
    // render as a Drug with a permanently null price and an absent label.
    for (const tty of ["IN", "DF", "DFG", "BN", "SCDC", "SCDF", "SBDG"]) {
      expect(isAlternativeTty(tty)).toBe(false);
    }
  });

  it("drops the non-dispensable groups from a real allrelated response", () => {
    const names = selectAlternatives(ATORVASTATIN_GROUPS, "ALL").map(
      (c) => c.name,
    );

    expect(names).not.toContain("atorvastatin");
    expect(names).not.toContain("Oral Tablet");
    expect(names).not.toContain("Lipitor");
    expect(names.sort()).toEqual([
      "atorvastatin 10 MG Oral Tablet",
      "atorvastatin 10 MG Oral Tablet [Lipitor]",
    ]);
  });

  it("does not list a drug as an alternative to itself", () => {
    const names = selectAlternatives(ATORVASTATIN_GROUPS, "ALL", "617312").map(
      (c) => c.name,
    );

    expect(names).toEqual(["atorvastatin 10 MG Oral Tablet [Lipitor]"]);
  });
});

describe("generic versus brand", () => {
  it("splits on RxNorm's own naming", () => {
    expect(isGenericTty("SCD")).toBe(true);
    expect(isGenericTty("GPCK")).toBe(true);
    expect(isGenericTty("SBD")).toBe(false);
    expect(isGenericTty("BPCK")).toBe(false);
  });

  it("partitions the alternative set exactly, with nothing left over", () => {
    // If a TTY were in neither list, `kind: ALL` would return a drug that
    // `GENERIC` and `BRAND` both deny — a filter that loses rows.
    expect([...GENERIC_TTYS, ...BRAND_TTYS].sort()).toEqual(
      [...ALTERNATIVE_TTYS].sort(),
    );
  });

  it("filters by kind", () => {
    expect(selectAlternatives(ATORVASTATIN_GROUPS, "GENERIC")).toHaveLength(1);
    expect(selectAlternatives(ATORVASTATIN_GROUPS, "BRAND")).toHaveLength(1);
    expect(ttysForKind("ALL")).toEqual(ALTERNATIVE_TTYS);
  });
});

describe("every alternative is a drug openFDA can answer for", () => {
  it("matches the TTY set the label client accepts", () => {
    // Not a coincidence — both sets are "dispensable product concepts", so the
    // ADR-010 TTY assertion can never throw on something we listed as an
    // alternative. If these ever diverge, one of two things is true: openFDA
    // changed what it answers for, or Q7 was reopened. Either way the resolver
    // that walks alternatives into label lookups needs revisiting, so this
    // fails loudly rather than surfacing as a WrongTtyError in production.
    expect([...ALTERNATIVE_TTYS].sort()).toEqual(
      [...LABEL_QUERYABLE_TTYS].sort(),
    );
  });
});

/**
 * Q7's other half: the concepts excluded from `alternatives` are not discarded,
 * they are identity. These assert the selectors read the same groups without
 * borrowing each other's rules.
 */
describe("identity, as distinct from alternatives", () => {
  it("reads the ingredient out of the same related groups", () => {
    expect(selectIngredients(ATORVASTATIN_GROUPS)).toEqual([
      expect.objectContaining({ rxcui: "83367", name: "atorvastatin", tty: "IN" }),
    ]);
  });

  it("reads the dose form, and never the dose form *group*", () => {
    // DFG ("Oral Product") sits next to DF ("Oral Tablet") in every response
    // and is a coarser concept. Matching on a prefix would take whichever came
    // first and be right about half the time.
    expect(selectDoseForm(ATORVASTATIN_GROUPS)).toEqual(
      expect.objectContaining({ rxcui: "317541", name: "Oral Tablet", tty: "DF" }),
    );
  });

  it("returns every ingredient of a combination product", () => {
    // The case a singular field would silently halve.
    const groups = [
      {
        tty: "IN",
        concepts: [
          concept("17767", "amlodipine", "IN"),
          concept("18867", "benazepril", "IN"),
        ],
      },
    ];
    expect(selectIngredients(groups).map((c) => c.name)).toEqual([
      "amlodipine",
      "benazepril",
    ]);
  });

  it("reports no dose form for a pack, rather than inventing one", () => {
    // A BPCK is a box of several products. Null here is the ordinary answer,
    // and the resolver states it as an Absent.
    const pack = [
      { tty: "BPCK", concepts: [concept("749783", "Medrol Dosepak", "BPCK")] },
      { tty: "IN", concepts: [concept("6902", "methylprednisolone", "IN")] },
    ];
    expect(selectDoseForm(pack)).toBeNull();
    expect(selectIngredients(pack)).toHaveLength(1);
  });

  it("keeps identity and alternatives from leaking into each other", () => {
    // The regression that matters: if either selector ever reuses
    // ALTERNATIVE_TTYS, atorvastatin's SCD/SBD would arrive as ingredients.
    const ingredientTtys = new Set(
      selectIngredients(ATORVASTATIN_GROUPS).map((c) => c.tty),
    );
    expect([...ingredientTtys]).toEqual(["IN"]);
    for (const alt of selectAlternatives(ATORVASTATIN_GROUPS, "ALL")) {
      expect(isAlternativeTty(alt.tty)).toBe(true);
    }
  });
});
