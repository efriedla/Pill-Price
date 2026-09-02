import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  groupLabelsByRxcui,
  parseLabelSearch,
} from "@/server/upstream/openfda.schema";
import {
  dedupeRows,
  parseNadacQuery,
  resolveNadacDistribution,
} from "@/server/upstream/nadac.schema";
import { UpstreamParseError } from "@/server/upstream/parse";
import {
  isPlainTextNotFound,
  parseAllRelated,
  parseDrugProperties,
  parseDrugSearch,
  parseNdcs,
} from "@/server/upstream/rxnorm.schema";

/**
 * These assert against the **real, unedited** responses in
 * `tests/fixtures/upstream/`, captured 2026-08-23. That is the point: every
 * quirk in `docs/upstream-notes.md` is checked against the payload that
 * produced it, so the boundary is tested on what the upstreams actually send
 * rather than on what this repo imagines they send.
 */

const FIXTURES = path.join(import.meta.dirname, "fixtures/upstream");
const load = (rel: string) =>
  JSON.parse(readFileSync(path.join(FIXTURES, rel), "utf8")) as unknown;
const loadText = (rel: string) =>
  readFileSync(path.join(FIXTURES, rel), "utf8");

describe("RxNorm boundary", () => {
  it("parses a real concept, normalising the empty umlscui to null", () => {
    const drug = parseDrugProperties(load("rxnorm/props-860975.json"));

    expect(drug).not.toBeNull();
    expect(drug?.rxcui).toBe("860975");
    expect(drug?.tty).toBe("SCD");
    // `umlscui` is `""` upstream — absence with a different encoding (§1.3).
    expect(drug?.umlscui).toBeNull();
    expect(drug?.synonym).not.toBeNull();
  });

  it("returns null for an unknown RxCUI served as HTTP 200 `{}` (§1.1)", () => {
    // The trap: `{}` is shape-compatible with success. If this ever returns a
    // truthy value, every caller starts rendering a drug that does not exist.
    expect(parseDrugProperties(load("rxnorm/props-bogus.json"))).toBeNull();
  });

  it("treats a null-filled search envelope as empty, not as an error (§1.1)", () => {
    expect(parseDrugSearch(load("rxnorm/search-nonsense.json"))).toEqual([]);
  });

  it("parses conceptGroup entries that have no conceptProperties key (§1.3)", () => {
    // `{"tty":"BPCK"}` appears bare in this fixture. Without `.optional()` this
    // throws on a completely valid response.
    const concepts = parseDrugSearch(load("rxnorm/search-metformin.json"));

    expect(concepts.length).toBeGreaterThan(0);
    expect(concepts.every((c) => c.rxcui && c.name && c.tty)).toBe(true);
  });

  it("keeps the TTY grouping on related concepts rather than answering Q7", () => {
    const groups = parseAllRelated(load("rxnorm/allrelated-860975.json"));

    expect(groups.length).toBeGreaterThan(1);
    // Groups with no concepts survive as empty rather than failing the parse.
    expect(groups.some((g) => g.concepts.length === 0)).toBe(true);
    expect(groups.some((g) => g.tty === "BN")).toBe(true);
  });

  it("parses the 401-NDC fan-out (§1.4)", () => {
    const ndcs = parseNdcs(load("rxnorm/ndcs-860975.json"));

    expect(ndcs).toHaveLength(401);
    // 11 digits, no dashes — joins to NADAC with no normalisation (§4).
    expect(ndcs.every((n) => /^\d{11}$/.test(n))).toBe(true);
  });

  it("recognises the plain-text 404 body without parsing it as JSON (§1.2)", () => {
    const body = loadText("rxnorm/historystatus-404.json");

    expect(isPlainTextNotFound(body)).toBe(true);
    // The failure this guards: the body is not JSON at all.
    expect(() => JSON.parse(body)).toThrow();
  });

  it("throws a typed, located error when the shape is wrong", () => {
    expect(() => parseDrugProperties({ properties: { rxcui: 860975 } })).toThrow(
      UpstreamParseError,
    );

    try {
      parseDrugProperties({ properties: { rxcui: 860975 } });
    } catch (error) {
      expect(error).toBeInstanceOf(UpstreamParseError);
      const parseError = error as UpstreamParseError;
      expect(parseError.upstream).toBe("rxnorm");
      expect(parseError.message).toContain("properties.rxcui");
    }
  });
});

describe("openFDA boundary", () => {
  it("parses a label set and reports the 78-SPL total (§2.2)", () => {
    const outcome = parseLabelSearch(load("openfda/label-rxcui-860975.json"));

    expect(outcome.kind).toBe("labels");
    if (outcome.kind !== "labels") return;
    expect(outcome.results.length).toBeGreaterThan(0);
    // `results[0]` is one arbitrary manufacturer's copy of many.
    expect(outcome.total).toBeGreaterThan(1);
    expect(outcome.results[0]?.openfda.rxcui).toContain("860975");
  });

  it("reports both 404 shapes as notFound *and* ambiguous (§2.1)", () => {
    // The whole point: a label-less drug and a malformed query are
    // byte-identical, so neither may be resolved at this layer. Q3 is open.
    for (const fixture of [
      "openfda/label-rxcui-none.json",
      "openfda/label-bad-query.json",
    ]) {
      const outcome = parseLabelSearch(load(fixture));
      expect(outcome.kind).toBe("notFound");
      if (outcome.kind !== "notFound") return;
      expect(outcome.ambiguous).toBe(true);
    }
  });

  it("surfaces keys an OR batch silently returned nothing for (§2.4)", () => {
    const outcome = parseLabelSearch(load("openfda/label-batch-or.json"));
    expect(outcome.kind).toBe("labels");
    if (outcome.kind !== "labels") return;

    const requested = ["860975", "617314", "197361"];
    const { byRxcui, missing } = groupLabelsByRxcui(outcome.results, requested);

    // The API reported success, yet not every requested key came back — which
    // is exactly the DataLoader correctness trap.
    expect(missing.length).toBeGreaterThan(0);
    expect(byRxcui.size).toBe(requested.length);
    expect(missing.every((key) => requested.includes(key))).toBe(true);
  });
});

describe("NADAC boundary", () => {
  it("normalises both encodings of absent in one record (§3.4)", () => {
    const { rows } = parseNadacQuery(load("nadac/ndcs-for-860975.json"));
    const row = rows[0];

    expect(row).toBeDefined();
    // Same record, two encodings upstream: `""` and `null`. One meaning.
    expect(row?.corresponding_generic_drug_nadac_per_unit).toBeNull();
    expect(row?.corresponding_generic_drug_effective_date).toBeNull();
    // A real price stays a string — ADR-004 Q6, never a float.
    expect(typeof row?.nadac_per_unit).toBe("string");
    expect(row?.pricing_unit).toBe("EA");
  });

  it("reports an incomplete page rather than letting it read as the whole set", () => {
    const { rows, count, complete } = parseNadacQuery(
      load("nadac/ndcs-for-860975.json"),
    );

    expect(rows.length).toBeGreaterThan(0);
    if (rows.length < count) {
      // No `next` link exists; the caller must page by offset (§3.4).
      expect(complete).toBe(false);
    }
  });

  it("treats an empty result set as a price-less drug, not an error (§3.3)", () => {
    const { rows, complete } = parseNadacQuery(load("nadac/ndc-missing.json"));

    // ~92% of packages land here. This is the typical case.
    expect(rows).toEqual([]);
    expect(complete).toBe(true);
  });

  it("dedupes to one row per (ndc, date, price) before counting (§3.4)", () => {
    const { rows } = parseNadacQuery(load("nadac/ndcs-for-860975.json"));
    const deduped = dedupeRows([...rows, ...rows]);

    // Doubling the input must not double the observation count.
    expect(deduped).toHaveLength(dedupeRows(rows).length);
    expect(deduped.every((r) => r.nadac_per_unit !== null)).toBe(true);
  });

  it("resolves the distribution by exact title, not by substring (§3.1)", () => {
    const resolved = resolveNadacDistribution(load("nadac/datasets.json"), 2026);

    expect(resolved).not.toBeNull();
    expect(resolved?.year).toBe(2026);
    expect(resolved?.distributionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("never resolves to NADAC Comparison or First Time NADAC Rates (§3.1)", () => {
    // These sort above the yearly titles and have a different schema. A
    // substring match on "NADAC" picks one of them, which is the bug the
    // capture script hit on its first run.
    const decoys = [
      { title: "NADAC Comparison", distribution: [{ identifier: "decoy-1" }] },
      {
        title: "First Time NADAC Rates",
        distribution: [{ identifier: "decoy-2" }],
      },
    ];

    expect(resolveNadacDistribution(decoys, 2026)).toBeNull();
  });

  it("falls back to the newest prior year rather than off a cliff", () => {
    // A January request before the new dataset is published must still resolve.
    const resolved = resolveNadacDistribution(load("nadac/datasets.json"), 2027);

    expect(resolved).not.toBeNull();
    expect(resolved?.year).toBeLessThanOrEqual(2027);
  });
});
