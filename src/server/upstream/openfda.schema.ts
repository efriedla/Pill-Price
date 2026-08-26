import "server-only";

import { z } from "zod";

import { absentableString, parseUpstream } from "./parse";

/**
 * openFDA boundary schemas. Upstream: `api.fda.gov/drug/label.json`.
 *
 * See upstream-notes §2. The defining problem is that this API's 404 is
 * ambiguous by design, and that ambiguity is **Q3, still open** — so nothing
 * here decides it. What these schemas do is make the ambiguity *visible and
 * typed*, so the resolver has to handle it on purpose.
 */

/**
 * The `openfda` sub-object. Every field is an array, and every field is
 * optional — openFDA omits keys rather than sending empty arrays.
 *
 * `rxcui` is the join key to RxNorm and it is an **array**: one label covers up
 * to three RxCUIs in the sampled data, so the join is many-to-many in both
 * directions (§4).
 */
export const openFdaMetaSchema = z.object({
  rxcui: z.array(z.string()).optional().default([]),
  brand_name: z.array(z.string()).optional().default([]),
  generic_name: z.array(z.string()).optional().default([]),
  manufacturer_name: z.array(z.string()).optional().default([]),
  product_ndc: z.array(z.string()).optional().default([]),
  product_type: z.array(z.string()).optional().default([]),
  route: z.array(z.string()).optional().default([]),
  substance_name: z.array(z.string()).optional().default([]),
  spl_id: z.array(z.string()).optional().default([]),
  application_number: z.array(z.string()).optional().default([]),
});

/**
 * One SPL submission.
 *
 * Narrative fields are arrays of strings, each frequently many KB of prose, and
 * openFDA supports **no field projection** — one label is 118 KB and you cannot
 * ask for less (§2.3). Only the fields the schema actually exposes are modelled;
 * `.loose()` lets the other ~80 through unvalidated rather than pretending we
 * checked them, and keeps a new upstream field from failing the parse.
 *
 * `effective_time` is `YYYYMMDD`, not ISO — deliberately **not** run through
 * `isoDateString`, which would reject every real response. It is the field a
 * "newest label" rule would sort on if **Q2** lands that way.
 */
export const labelResultSchema = z
  .object({
    id: absentableString,
    set_id: absentableString,
    effective_time: absentableString.refine(
      (v) => v === null || /^\d{8}$/.test(v),
      { message: "expected YYYYMMDD" },
    ),
    // `.prefault` seeds the *input* before parsing, so the sub-schema's own
    // per-field defaults still apply. `.default({})` would have to name every
    // field, and would drift the moment one is added.
    openfda: openFdaMetaSchema.prefault({}),
    indications_and_usage: z.array(z.string()).optional().default([]),
    warnings: z.array(z.string()).optional().default([]),
    dosage_and_administration: z.array(z.string()).optional().default([]),
    adverse_reactions: z.array(z.string()).optional().default([]),
    contraindications: z.array(z.string()).optional().default([]),
    description: z.array(z.string()).optional().default([]),
  })
  .loose();

export type LabelResult = z.infer<typeof labelResultSchema>;

/** A successful search. `meta.results.total` is the 78-SPL number from §2.2. */
export const labelSearchResponseSchema = z.object({
  meta: z
    .object({
      disclaimer: absentableString,
      last_updated: absentableString,
      results: z
        .object({
          skip: z.number().int().optional().default(0),
          limit: z.number().int().optional().default(0),
          total: z.number().int().optional().default(0),
        })
        .prefault({}),
    })
    .prefault({}),
  results: z.array(labelResultSchema),
});

/** The error envelope. `NOT_FOUND` is the only code observed. */
export const openFdaErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
  }),
});

/**
 * The outcome of an openFDA call, as a type the caller cannot ignore.
 *
 * `notFound` carries `ambiguous: true` and it is not decoration. A label-less
 * drug and a **malformed query** produce byte-identical 404s (§2.1). There is no
 * evidence in the response that distinguishes them, so the boundary reports the
 * ambiguity rather than resolving it — resolving it is Q3, and mapping this to
 * a partial-data notice without deciding Q3 silently swallows BFF query bugs in
 * production, which is precisely what upstream-notes warns about.
 */
export type LabelOutcome =
  | { kind: "labels"; results: LabelResult[]; total: number }
  | { kind: "notFound"; ambiguous: true; message: string };

/**
 * Parse a label search, distinguishing the error envelope from a result set.
 *
 * The two are told apart by shape, not by status code, so this works whether or
 * not the caller checked `res.ok` — which matters because openFDA returns 404
 * for the ordinary empty case.
 */
export function parseLabelSearch(data: unknown): LabelOutcome {
  if (typeof data === "object" && data !== null && "error" in data) {
    const err = parseUpstream(
      "openfda",
      "drug/label.json",
      openFdaErrorSchema,
      data,
    );
    return { kind: "notFound", ambiguous: true, message: err.error.message };
  }

  const parsed = parseUpstream(
    "openfda",
    "drug/label.json",
    labelSearchResponseSchema,
    data,
  );
  return {
    kind: "labels",
    results: parsed.results,
    total: parsed.meta.results.total,
  };
}

/**
 * Group a batched response back by RxCUI — and report which keys got nothing.
 *
 * This exists to make §2.4's trap survivable *if* Q4 ever lands as "yes, batch".
 * `search=openfda.rxcui:("a" OR "b" OR "c")` ranks results **globally rather
 * than per key**, so a DataLoader can receive zero rows for one of its keys
 * while the API reports success. Returning `missing` forces that outcome into
 * the caller's hands instead of letting it read as an empty label.
 *
 * It does not make `OR` batching correct. Per-key requests remain the only
 * thing that guarantees coverage.
 */
export function groupLabelsByRxcui(
  results: LabelResult[],
  requestedRxcuis: readonly string[],
): { byRxcui: Map<string, LabelResult[]>; missing: string[] } {
  const byRxcui = new Map<string, LabelResult[]>(
    requestedRxcuis.map((r) => [r, []]),
  );
  for (const result of results) {
    for (const rxcui of result.openfda.rxcui) {
      byRxcui.get(rxcui)?.push(result);
    }
  }
  return {
    byRxcui,
    missing: requestedRxcuis.filter((r) => byRxcui.get(r)?.length === 0),
  };
}
