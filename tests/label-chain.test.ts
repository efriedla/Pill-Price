import { describe, expect, it, vi } from "vitest";

import { chooseLabel, labelSections, type LabelLookups } from "@/server/label";
import type { LabelQuery } from "@/server/openfda-client";
import {
  labelResultSchema,
  type LabelOutcome,
} from "@/server/upstream/openfda.schema";

/**
 * ADR-015's chain, one test per step. The rows are shaped on what openFDA
 * returned for the three measured drugs on 2026-09-25: Lipitor (617314),
 * atorvastatin 10 mg (617312) and metformin ER 500 mg (860975), whose brand
 * twin Glucophage XR (860977) has no label at all. Step 3 has no measured
 * example yet, so it gets a fixture, as the ADR says.
 */

type RowInput = {
  set_id?: string;
  effective_time?: string;
  manufacturer?: string;
  brand?: string;
  generic?: string;
  application?: string;
  original?: boolean;
  sections?: Record<string, string[]>;
};

function row(r: RowInput) {
  return labelResultSchema.parse({
    set_id: r.set_id ?? "set-1",
    effective_time: r.effective_time ?? "20240415",
    openfda: {
      manufacturer_name:
        r.manufacturer === undefined
          ? ["Maker"]
          : [r.manufacturer].filter(Boolean),
      brand_name: r.brand ? [r.brand] : undefined,
      generic_name: [r.generic ?? "atorvastatin calcium"],
      application_number: [r.application ?? "ANDA000001"],
      is_original_packager: r.original ? [true] : undefined,
    },
    indications_and_usage: ["Indicated for things."],
    ...r.sections,
  });
}

const found = (...rows: ReturnType<typeof row>[]): LabelOutcome => ({
  kind: "labels",
  results: rows,
  total: rows.length,
});

/** openFDA answers, keyed by `${rxcui}:${query}`. Anything unlisted is a 404. */
function lookups(
  answers: Record<string, LabelOutcome>,
  twins: { rxcui: string; tty: string }[] = [],
) {
  const search = vi.fn(
    async (rxcui: string, _tty: string, query: LabelQuery) =>
      answers[`${rxcui}:${query}`] ?? null,
  );
  const brandTwins = vi.fn(async () =>
    twins.map((t) => ({ ...t, name: "twin" }) as never),
  );
  return { search, brandTwins } satisfies LabelLookups;
}

const LIPITOR = row({
  set_id: "a60cc18b-0631-4cf0-b021-9f52224ece65",
  effective_time: "20240415",
  manufacturer: "Viatris Specialty LLC",
  brand: "Lipitor",
  application: "NDA020702",
  original: true,
});

describe("ADR-015's chain", () => {
  it("step 1: a brand drug shows its own label", async () => {
    const l = lookups({ "617314:reference": found(LIPITOR) });
    const label = await chooseLabel({ rxcui: "617314", tty: "SBD" }, l);

    expect(label).toMatchObject({
      setId: "a60cc18b-0631-4cf0-b021-9f52224ece65",
      productName: "Lipitor",
      manufacturer: "Viatris Specialty LLC",
      // Sliced, never through Date: this must not become 2024-04-14.
      effectiveDate: "2024-04-15",
      chosenBy: "OWN_LABEL",
    });
    // A brand never looks for a twin.
    expect(l.brandTwins).not.toHaveBeenCalled();
  });

  it("step 2: a generic whose results include the NDA row shows that one", async () => {
    // Atorvastatin 10 mg: 90 labels, one of them Viatris's NDA020702.
    const l = lookups({ "617312:reference": found(LIPITOR) });
    const label = await chooseLabel({ rxcui: "617312", tty: "SCD" }, l);

    expect(label).toMatchObject({
      productName: "Lipitor",
      chosenBy: "REFERENCE_IN_RESULTS",
    });
    expect(l.brandTwins).not.toHaveBeenCalled();
    expect(l.search).toHaveBeenCalledTimes(1);
  });

  it("step 3: a generic with no NDA row shows its brand twin's label", async () => {
    const l = lookups(
      { "200002:reference": found(row({ brand: "Brandix", original: true })) },
      [{ rxcui: "200002", tty: "SBD" }],
    );
    const label = await chooseLabel({ rxcui: "200001", tty: "SCD" }, l);

    expect(label).toMatchObject({
      productName: "Brandix",
      chosenBy: "BRAND_VERSION",
    });
    // Matched by the twin's RxCUI, never by name.
    expect(l.search).toHaveBeenCalledWith("200002", "SBD", "reference");
  });

  it("step 4: metformin ER, whose brand has no label, shows the newest original packager's", async () => {
    // Glucophage XR (860977) is a twin with no label on openFDA, so step 3
    // asks and gets a 404. That is the ordinary path, not an edge.
    const l = lookups(
      {
        "860975:originalPackager": found(
          row({
            set_id: "granules",
            effective_time: "20260717",
            manufacturer: "Granules India Ltd",
            generic: "metformin hydrochloride",
            original: true,
          }),
        ),
      },
      [{ rxcui: "860977", tty: "SBD" }],
    );
    const label = await chooseLabel({ rxcui: "860975", tty: "SCD" }, l);

    expect(label).toMatchObject({
      manufacturer: "Granules India Ltd",
      productName: "metformin hydrochloride",
      effectiveDate: "2026-07-17",
      chosenBy: "ORIGINAL_PACKAGER",
    });
    expect(l.search).toHaveBeenCalledWith("860977", "SBD", "reference");
  });

  it("a brand with no reference label also falls to step 4", async () => {
    const l = lookups({
      "617314:originalPackager": found(
        row({ brand: "Lipitor", original: true }),
      ),
    });
    const label = await chooseLabel({ rxcui: "617314", tty: "SBD" }, l);
    expect(label?.chosenBy).toBe("ORIGINAL_PACKAGER");
  });

  it("returns null when no step finds a label", async () => {
    expect(
      await chooseLabel({ rxcui: "1", tty: "SCD" }, lookups({})),
    ).toBeNull();
  });
});

describe("picking one row out of a search", () => {
  it("prefers an original packager over a newer relabel under the same NDA", async () => {
    // A-S Medication ships Lantus under Sanofi's BLA021081.
    const l = lookups({
      "1:reference": found(
        row({
          set_id: "relabel",
          effective_time: "20260101",
          manufacturer: "A-S Medication Solutions",
        }),
        row({
          set_id: "sanofi",
          effective_time: "20250602",
          manufacturer: "sanofi-aventis U.S. LLC",
          original: true,
        }),
      ),
    });
    const label = await chooseLabel({ rxcui: "1", tty: "SBD" }, l);
    expect(label?.setId).toBe("sanofi");
  });

  it("breaks a tie on the date by set_id, so a cache fill cannot change the answer", async () => {
    // Measured: Apotex and Quallent both 20260908, same ANDA, in either order.
    const apotex = row({
      set_id: "b-apotex",
      effective_time: "20260908",
      original: true,
    });
    const quallent = row({
      set_id: "a-quallent",
      effective_time: "20260908",
      original: true,
    });

    for (const order of [
      [apotex, quallent],
      [quallent, apotex],
    ]) {
      const l = lookups({ "1:originalPackager": found(...order) });
      const label = await chooseLabel({ rxcui: "1", tty: "SCD" }, l);
      expect(label?.setId).toBe("a-quallent");
    }
  });

  it("passes over a row that cannot fill the type rather than padding it", async () => {
    const l = lookups({
      "1:originalPackager": found(
        row({
          set_id: "no-maker",
          effective_time: "20260908",
          manufacturer: "",
          original: true,
        }),
        row({ set_id: "complete", effective_time: "20250101", original: true }),
      ),
    });
    const label = await chooseLabel({ rxcui: "1", tty: "SCD" }, l);
    expect(label?.setId).toBe("complete");
  });
});

describe("label sections", () => {
  it("are in ui-spec §11 order, boxed warning first, whatever order openFDA sends", () => {
    const sections = labelSections(
      row({
        sections: {
          drug_interactions: ["Interacts."],
          boxed_warning: ["WARNING: LACTIC ACIDOSIS"],
          contraindications: ["Do not use."],
        },
      }),
    );
    expect(sections.map((s) => s.kind)).toEqual([
      "BOXED_WARNING",
      "INDICATIONS_AND_USAGE",
      "CONTRAINDICATIONS",
      "DRUG_INTERACTIONS",
    ]);
  });

  it("read the older warnings field when warnings_and_cautions is missing", () => {
    // 13 of 78 metformin ER labels use the pre-2006 name.
    const [warnings] = labelSections(
      row({
        sections: { indications_and_usage: [], warnings: ["Old style."] },
      }),
    );
    expect(warnings).toEqual({
      kind: "WARNINGS_AND_CAUTIONS",
      paragraphs: ["Old style."],
    });
  });

  it("collapse whitespace and leave out a section with no text", () => {
    const sections = labelSections(
      row({
        sections: {
          indications_and_usage: ["  Indicated \n\n for   things. "],
          adverse_reactions: ["   "],
        },
      }),
    );
    expect(sections).toEqual([
      { kind: "INDICATIONS_AND_USAGE", paragraphs: ["Indicated for things."] },
    ]);
  });
});
