import "server-only";

import { z } from "zod";

import {
  absentableString,
  decimalString,
  isoDateString,
  parseUpstream,
} from "./parse";

/**
 * NADAC boundary schemas. Upstream: `data.medicaid.gov/api/1`.
 *
 * See upstream-notes §3 and ADR-009's Measurements section. Two things shape
 * everything here: absence has two encodings in the same record, and the
 * distribution UUID is not stable.
 *
 * **Where prices are fetched from is ADR-009 and is not decided.** Nothing in
 * this file assumes a request-path call or a snapshot — it validates the
 * response shape, which is identical either way. That is why it could be
 * written ahead of the decision.
 */

/**
 * One NADAC row.
 *
 * The field to look at is `corresponding_generic_drug_nadac_per_unit`, which is
 * `""` while `corresponding_generic_drug_effective_date` in the *same record*
 * is `null` (§3.4). Both mean absent. Both become `null` here, and that
 * normalisation is the main thing this schema is for.
 *
 * `nadac_per_unit` stays a **string** — ADR-004 Q6, and the upstream types the
 * column `decimal(10,5)`. It is validated, not converted.
 */
export const nadacRowSchema = z.object({
  ndc: z.string().min(1),
  ndc_description: absentableString,
  nadac_per_unit: decimalString,
  effective_date: isoDateString,
  /** `EA` / `ML` / `GM`. The source for the `Price.unit` field the SDL lacks. */
  pricing_unit: absentableString,
  pharmacy_type_indicator: absentableString,
  otc: absentableString,
  /** Comma-joined (`"1, 6"`), **not** an array (§3.4). Split, never indexed. */
  explanation_code: absentableString,
  classification_for_rate_setting: absentableString,
  corresponding_generic_drug_nadac_per_unit: decimalString,
  corresponding_generic_drug_effective_date: isoDateString,
  /** NADAC's own publication stamp. Distinct from the schema's `Price.asOf`. */
  as_of_date: isoDateString,
});

export type NadacRow = z.infer<typeof nadacRowSchema>;

/**
 * A datastore query response.
 *
 * `count` is the **total matching rows, not the number returned** — the 401-NDC
 * query reported 1045 and returned 500. There is no `next` link; you page by
 * `offset` until you have `count` (§3.4). Callers must compare
 * `results.length` against `count` rather than assuming a complete response.
 */
export const nadacQueryResponseSchema = z.object({
  results: z.array(nadacRowSchema),
  count: z.number().int().nonnegative().optional().default(0),
});

/** One dataset in the metastore index. */
export const metastoreItemSchema = z.object({
  title: z.string().min(1),
  modified: absentableString,
  distribution: z
    .array(z.object({ identifier: absentableString }))
    .optional()
    .default([]),
});

export const metastoreIndexSchema = z.array(metastoreItemSchema);

/**
 * The literal title pattern that identifies a yearly NADAC dataset.
 *
 * Substring-matching `NADAC` is **not** enough: the index also holds *NADAC
 * Comparison* (3.4M rows, a different schema) and *First Time NADAC Rates*, and
 * "NADAC Comparison" sorts above every yearly title. The capture script hit
 * exactly this bug on its first run (§3.1).
 */
const NADAC_YEARLY_TITLE =
  /^NADAC \(National Average Drug Acquisition Cost\) (\d{4})$/;

export function parseNadacQuery(data: unknown): {
  rows: NadacRow[];
  count: number;
  complete: boolean;
} {
  const parsed = parseUpstream(
    "nadac",
    "datastore/query",
    nadacQueryResponseSchema,
    data,
  );
  return {
    rows: parsed.results,
    count: parsed.count,
    /** False means more pages exist. Charting an incomplete series is a bug. */
    complete: parsed.results.length >= parsed.count,
  };
}

/**
 * Resolve the current distribution UUID from the metastore index.
 *
 * This is the function ADR-009's finding 1 is about. The UUID recorded on
 * 2026-08-23 was **dead by 2026-08-26** — HTTP 400. The identifier rotates on
 * *republish*, not per calendar year, so this resolution is not an annual
 * concern and cannot be cached for long. Any TTL here is measured in hours.
 *
 * The index must be fetched with `?show-reference-ids=true`; without it the
 * response carries no `distribution[].identifier` at all, and this returns
 * `null` for every entry.
 *
 * Returns the newest year at or below `preferYear`, so that a January request
 * does not fall off a cliff before the new year's dataset is published.
 */
export function resolveNadacDistribution(
  data: unknown,
  preferYear: number,
): { year: number; distributionId: string } | null {
  const items = parseUpstream(
    "nadac",
    "metastore/schemas/dataset/items",
    metastoreIndexSchema,
    data,
  );

  const candidates = items
    .flatMap((item) => {
      const year = Number(NADAC_YEARLY_TITLE.exec(item.title)?.[1]);
      const distributionId = item.distribution[0]?.identifier;
      return year && distributionId && year <= preferYear
        ? [{ year, distributionId }]
        : [];
    })
    .sort((a, b) => b.year - a.year);

  return candidates[0] ?? null;
}

/**
 * Collapse raw rows into one point per `(ndc, effective_date)`.
 *
 * Deduplication is **required, not defensive**: NADAC returns the same
 * `(ndc, effective_date, nadac_per_unit)` tuple more than once (§3.4), so
 * `PricePoint.observations` counted off raw rows would be inflated. Rows with
 * no price or no date are dropped — they cannot be placed on an axis, and
 * carrying them as zero would read as free.
 */
export function dedupeRows(rows: readonly NadacRow[]): NadacRow[] {
  const seen = new Map<string, NadacRow>();
  for (const row of rows) {
    if (row.nadac_per_unit === null || row.effective_date === null) continue;
    seen.set(`${row.ndc}|${row.effective_date}|${row.nadac_per_unit}`, row);
  }
  return [...seen.values()];
}
