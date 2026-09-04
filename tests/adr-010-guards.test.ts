import type { GraphQLObjectType, GraphQLUnionType } from "graphql";
import { describe, expect, it } from "vitest";

import {
  LABEL_QUERYABLE_TTYS,
  OPENFDA_QUERIED_FIELDS,
  WrongTtyError,
  assertLabelQueryableTty,
  isLabelQueryableTty,
} from "@/server/openfda-client";
import { resolvers, schema } from "@/server/schema";
import {
  labelResultSchema,
  openFdaMetaSchema,
} from "@/server/upstream/openfda.schema";

/**
 * ADR-010's guards, tested at the level the ADR argues at: `absent` is only a
 * safe reading of a 404 because the two ways *we* can provoke one are ruled out
 * before the request. These tests are what stop either guard being quietly
 * weakened later — a widened TTY list or a field dropped from the checked set
 * would both restore the ambiguity without any test failing otherwise.
 */

describe("TTY precondition (ADR-010 measurement 4)", () => {
  it("accepts exactly the four product-level term types openFDA answers for", () => {
    expect([...LABEL_QUERYABLE_TTYS]).toEqual(["SCD", "SBD", "GPCK", "BPCK"]);
    for (const tty of LABEL_QUERYABLE_TTYS) {
      expect(() => assertLabelQueryableTty("860975", tty)).not.toThrow();
    }
  });

  it("throws for every non-product term type probed, not just ingredients", () => {
    // All eleven 404 for *every* drug, indistinguishably from a real absence —
    // which is the whole reason this guard is at the call site.
    const rejected = [
      "IN",
      "MIN",
      "PIN",
      "BN",
      "DF",
      "DFG",
      "SCDG",
      "SBDG",
      "SCDF",
      "SBDF",
      "SCDC",
    ];
    for (const tty of rejected) {
      expect(() => assertLabelQueryableTty("6809", tty)).toThrow(WrongTtyError);
    }
  });

  it("throws rather than degrading, and says which RxCUI asked", () => {
    // A programming error, not a runtime condition: there is no user-facing
    // situation in which the right answer to "we asked the wrong question" is
    // an empty label section.
    try {
      assertLabelQueryableTty("6809", "IN");
      expect.unreachable("expected WrongTtyError");
    } catch (err) {
      expect(err).toBeInstanceOf(WrongTtyError);
      const wrong = err as WrongTtyError;
      expect(wrong.rxcui).toBe("6809");
      expect(wrong.tty).toBe("IN");
      expect(wrong.message).toContain("ADR-010");
    }
  });

  it("offers a non-throwing form for deciding whether to ask at all", () => {
    expect(isLabelQueryableTty("SCD")).toBe(true);
    expect(isLabelQueryableTty("IN")).toBe(false);
    // Casing is not normalised on purpose: RxNorm publishes TTYs uppercase, and
    // quietly accepting "scd" would hide a caller that is not using RxNorm's
    // own value.
    expect(isLabelQueryableTty("scd")).toBe(false);
  });
});

describe("openFDA field list (ADR-010's build-time guard)", () => {
  it("covers the field the label search is written against", () => {
    expect(OPENFDA_QUERIED_FIELDS).toContain("openfda.rxcui");
  });

  it("covers every field the boundary schema reads, so neither can drift", () => {
    // The check in CI can only verify field names it is given. If a field is
    // added to the Zod schema and not here, a rename of it goes back to being
    // silent — the response simply parses as absent.
    const modelled = [
      ...Object.keys(labelResultSchema.shape).filter((k) => k !== "openfda"),
      ...Object.keys(openFdaMetaSchema.shape).map((k) => `openfda.${k}`),
    ];
    expect([...OPENFDA_QUERIED_FIELDS].sort()).toEqual(modelled.sort());
  });
});

describe("degradable fields are unions (ADR-010 response shape)", () => {
  const labelResult = schema.getType("LabelResult");

  /** The SDL type of one field, or a failure naming what is missing. */
  const fieldType = (typeName: string, fieldName: string) => {
    const type = schema.getType(typeName) as GraphQLObjectType | undefined;
    const field = type?.getFields()[fieldName];
    if (!field) throw new Error(`${typeName}.${fieldName} is not in the SDL`);
    return String(field.type);
  };

  it("makes LabelResult a three-member union, not a nullable Label", () => {
    // `instanceof` is unusable here: vitest resolves graphql's ESM build while
    // @graphql-tools/schema pulls the CJS one, so the classes are not identical
    // objects. The name is the stable fact.
    expect(labelResult?.constructor.name).toBe("GraphQLUnionType");
    const members = (labelResult as GraphQLUnionType)
      .getTypes()
      .map((t) => t.name)
      .sort();
    expect(members).toEqual(["Absent", "Label", "Unavailable"]);
  });

  it("makes drug.label non-null, so a null can never mean three things", () => {
    expect(fieldType("Drug", "label")).toBe("LabelResult!");
  });

  it("states the source on both degraded members, per the naming rule", () => {
    for (const name of ["Absent", "Unavailable"]) {
      expect(fieldType(name, "reason")).toBe("String!");
      expect(fieldType(name, "source")).toBe("String!");
    }
  });

  it("marks only Unavailable retryable — an Absent is settled", () => {
    expect(fieldType("Unavailable", "retryable")).toBe("Boolean!");
    expect(() => fieldType("Absent", "retryable")).toThrow();
  });

  it("makes enrichment a union too — an empty list is not an answer", () => {
    // ADR-010: enrichment is always partial, and "RxNorm found no alternatives"
    // and "RxNorm was unreachable" are different sentences. A bare [Drug!]!
    // renders both as an empty section.
    const alternatives = schema.getType("AlternativesResult");
    expect(alternatives?.constructor.name).toBe("GraphQLUnionType");
    expect(
      (alternatives as GraphQLUnionType)
        .getTypes()
        .map((t) => t.name)
        .sort(),
    ).toEqual(["Absent", "Alternatives", "Unavailable"]);
    expect(fieldType("Drug", "alternatives")).toBe("AlternativesResult!");
  });

  it("discriminates the members of every degradable union alike", () => {
    const label = resolvers.LabelResult.__resolveType;
    expect(label({ openFDALabel: "…" })).toBe("Label");
    expect(label({ reason: "openFDA has no label…", source: "openfda" })).toBe(
      "Absent",
    );
    // Unavailable carries a reason too, so the retryable check has to come
    // first or every Unavailable resolves as Absent.
    expect(label({ reason: "…", source: "openfda", retryable: true })).toBe(
      "Unavailable",
    );

    const alternatives = resolvers.AlternativesResult.__resolveType;
    expect(alternatives({ drugs: [] })).toBe("Alternatives");
    expect(
      alternatives({ reason: "RxNorm found none", source: "rxnorm" }),
    ).toBe("Absent");
  });
});
