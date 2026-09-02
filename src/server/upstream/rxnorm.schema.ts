import "server-only";

import { z } from "zod";

import { absentableString, parseUpstream } from "./parse";

/**
 * RxNorm boundary schemas. Upstream: `rxnav.nlm.nih.gov/REST`.
 *
 * RxNorm is the best-behaved of the three and still needs the most care here,
 * because it signals nothing through status codes. See upstream-notes §1.
 */

/**
 * The concept shape RxNorm repeats in every envelope.
 *
 * `synonym` and `umlscui` arrive as `""` far more often than they arrive absent
 * (§1.3), which is why they go through `absentableString` rather than
 * `z.string()`. `suppress` is passed through as published rather than coerced
 * to a boolean: RxNorm documents values beyond `N`, and silently mapping an
 * unknown one to `false` would assert something we did not check.
 */
export const conceptPropertiesSchema = z.object({
  rxcui: z.string().min(1),
  name: z.string().min(1),
  tty: z.string().min(1),
  synonym: absentableString,
  language: absentableString,
  suppress: absentableString,
  umlscui: absentableString,
});

export type ConceptProperties = z.infer<typeof conceptPropertiesSchema>;

/**
 * A `conceptGroup` entry may be a bare `{"tty":"BPCK"}` with **no
 * `conceptProperties` key at all** (§1.3) — a valid response that a schema
 * without `.optional()` rejects. Defaulting to `[]` means callers can always
 * flat-map without a guard, which is the whole point of validating here.
 */
export const conceptGroupSchema = z.object({
  tty: z.string().min(1),
  conceptProperties: z.array(conceptPropertiesSchema).optional().default([]),
});

/** `/rxcui/{rxcui}/properties.json` */
export const propertiesResponseSchema = z.object({
  properties: conceptPropertiesSchema.optional(),
});

/** `/drugs.json?name=` */
export const drugsResponseSchema = z.object({
  drugGroup: z.object({
    /** `null` on **every** response, populated or empty (§1.3). Never a signal. */
    name: absentableString,
    conceptGroup: z.array(conceptGroupSchema).optional().default([]),
  }),
});

/** `/rxcui/{rxcui}/ndcs.json` */
export const ndcsResponseSchema = z.object({
  ndcGroup: z.object({
    /**
     * `null` even though the RxCUI was in the request path (§1.3). Parsed so
     * the shape is honest, and never read — the caller already knows it.
     */
    rxcui: absentableString,
    ndcList: z
      .object({ ndc: z.array(z.string().min(1)).optional().default([]) })
      .prefault({}),
  }),
});

/** `/rxcui/{rxcui}/allrelated.json` */
export const allRelatedResponseSchema = z.object({
  allRelatedGroup: z.object({
    rxcui: absentableString,
    conceptGroup: z.array(conceptGroupSchema).optional().default([]),
  }),
});

const at = (endpoint: string) =>
  <T extends z.ZodType>(schema: T, data: unknown) =>
    parseUpstream("rxnorm", endpoint, schema, data);

/**
 * Parse a concept lookup, returning `null` for "no such RxCUI".
 *
 * This is the function §1.1 is about. `rxcui/99999999/properties.json` is
 * **HTTP 200 with `{}`** — byte-identical in status and shape-compatible with a
 * successful response. The absence is asserted here, deliberately, so that no
 * caller can mistake a parsed `{}` for a drug.
 */
export function parseDrugProperties(data: unknown): ConceptProperties | null {
  const parsed = at("properties.json")(propertiesResponseSchema, data);
  return parsed.properties ?? null;
}

/**
 * Parse a search response into a flat concept list.
 *
 * `drugGroup.name` is `null` on every response and carries no information;
 * emptiness is the absence of concepts, nothing else. An empty list is a
 * legitimate result — the empty state, never an error (§1.1).
 */
export function parseDrugSearch(data: unknown): ConceptProperties[] {
  const parsed = at("drugs.json")(drugsResponseSchema, data);
  return parsed.drugGroup.conceptGroup.flatMap((g) => g.conceptProperties);
}

/**
 * Parse the NDC list for a concept.
 *
 * Expect hundreds: one metformin ER 500 MG SCD returns 401 (§1.4). These join
 * to NADAC as-is, with no normalisation (§4).
 */
export function parseNdcs(data: unknown): string[] {
  const parsed = at("ndcs.json")(ndcsResponseSchema, data);
  return parsed.ndcGroup.ndcList.ndc;
}

/**
 * Parse related concepts, keeping the TTY grouping intact.
 *
 * The grouping is preserved rather than flattened because **which of the 19
 * TTYs count as a generic alternative is Q7, still open**. Flattening here
 * would quietly answer it.
 */
export function parseAllRelated(
  data: unknown,
): { tty: string; concepts: ConceptProperties[] }[] {
  const parsed = at("allrelated.json")(allRelatedResponseSchema, data);
  return parsed.allRelatedGroup.conceptGroup.map((g) => ({
    tty: g.tty,
    concepts: g.conceptProperties,
  }));
}

/**
 * True when a response body is RxNorm's plain-text `Not found`.
 *
 * `rxcuistatus.json` answers with **HTTP 404 and a plain-text body** (§1.2),
 * which upstream-notes names the single most likely source of an unhandled 500
 * in the BFF: calling `.json()` on it throws `SyntaxError`, not an upstream
 * error. A client must reach for this on the raw text *before* parsing.
 */
export function isPlainTextNotFound(body: string): boolean {
  return body.trim().toLowerCase() === "not found";
}
