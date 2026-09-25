import "server-only";

import type { LabelQuery } from "./openfda-client";
import { BRAND_TTYS } from "./tty";
import type { LabelOutcome, LabelResult } from "./upstream/openfda.schema";
import type { ConceptProperties } from "./upstream/rxnorm.schema";

/**
 * ADR-015, Option A: which one of a drug's labels the page shows, and why.
 *
 * The chain, first step that finds a label wins:
 *
 *   1. a brand drug (SBD/BPCK): its own NDA/BLA label      OWN_LABEL
 *   2. a generic (SCD/GPCK): the NDA/BLA row in its results REFERENCE_IN_RESULTS
 *   3. a generic with no such row: its brand twin's label   BRAND_VERSION
 *   4. otherwise: the newest original-packager label        ORIGINAL_PACKAGER
 *
 * Every step matches by RxCUI, never by name. By name, "metformin" returns
 * Janumet and Synjardy, and step 2 would put a sitagliptin label on a
 * metformin page.
 *
 * Pure apart from the two lookups it is handed, so the chain is tested
 * without a network, one test per step.
 */

export type LabelChoice =
  "OWN_LABEL" | "REFERENCE_IN_RESULTS" | "BRAND_VERSION" | "ORIGINAL_PACKAGER";

export type LabelSectionKind =
  | "BOXED_WARNING"
  | "INDICATIONS_AND_USAGE"
  | "DOSAGE_AND_ADMINISTRATION"
  | "CONTRAINDICATIONS"
  | "WARNINGS_AND_CAUTIONS"
  | "ADVERSE_REACTIONS"
  | "DRUG_INTERACTIONS";

export type LabelSection = { kind: LabelSectionKind; paragraphs: string[] };

export type ChosenLabel = {
  setId: string;
  productName: string;
  manufacturer: string;
  effectiveDate: string;
  chosenBy: LabelChoice;
  sections: LabelSection[];
};

export type LabelLookups = {
  search: (
    rxcui: string,
    tty: string,
    query: LabelQuery,
  ) => Promise<LabelOutcome | null>;
  /** The drug's brand twins, from RxNorm. Only asked on the generic path. */
  brandTwins: () => Promise<ConceptProperties[]>;
};

export async function chooseLabel(
  drug: { rxcui: string; tty: string },
  lookups: LabelLookups,
): Promise<ChosenLabel | null> {
  const own = (query: LabelQuery) =>
    lookups.search(drug.rxcui, drug.tty, query);

  if (isBrandTty(drug.tty)) {
    const label = pick(await own("reference"), "OWN_LABEL");
    if (label) return label;
  } else {
    const label = pick(await own("reference"), "REFERENCE_IN_RESULTS");
    if (label) return label;

    // Twins in RxNorm's order. A generic with more than one brand is rare at
    // one strength and form, and the page names whichever label it shows.
    for (const twin of (await lookups.brandTwins()).filter((c) =>
      isBrandTty(c.tty),
    )) {
      const twinLabel = pick(
        await lookups.search(twin.rxcui, twin.tty, "reference"),
        "BRAND_VERSION",
      );
      if (twinLabel) return twinLabel;
    }
  }

  return pick(await own("originalPackager"), "ORIGINAL_PACKAGER");
}

function isBrandTty(tty: string): boolean {
  return (BRAND_TTYS as readonly string[]).includes(tty);
}

/**
 * The one row a search result stands for.
 *
 * openFDA already sorted newest first, but three things are still ours:
 *
 *   - A reference search returns repackagers too (A-S Medication ships Lantus
 *     under Sanofi's BLA), so an original packager wins over a newer relabel.
 *   - Dates tie (Apotex and Quallent both 20260908, measured 2026-09-25), and
 *     openFDA's order within a tie is not documented, so set_id breaks it.
 *     Otherwise the page could show a different label on each cache fill.
 *   - A row missing what the type promises (set_id, a date, a manufacturer, a
 *     name) cannot be shown honestly, so it is passed over rather than padded.
 */
function pick(
  outcome: LabelOutcome | null,
  chosenBy: LabelChoice,
): ChosenLabel | null {
  if (outcome === null || outcome.kind === "notFound") return null;

  const rows = outcome.results
    .map((row) => ({ row, label: toLabel(row, chosenBy) }))
    .filter(
      (r): r is { row: LabelResult; label: ChosenLabel } => r.label !== null,
    )
    .sort(
      (a, b) =>
        Number(isOriginalPackager(b.row)) - Number(isOriginalPackager(a.row)) ||
        b.label.effectiveDate.localeCompare(a.label.effectiveDate) ||
        a.label.setId.localeCompare(b.label.setId),
    );

  return rows[0]?.label ?? null;
}

function isOriginalPackager(row: LabelResult): boolean {
  return row.openfda.is_original_packager.includes(true);
}

function toLabel(row: LabelResult, chosenBy: LabelChoice): ChosenLabel | null {
  const effectiveDate = isoFromYyyymmdd(row.effective_time);
  const manufacturer = row.openfda.manufacturer_name[0];
  const productName = row.openfda.brand_name[0] ?? row.openfda.generic_name[0];
  if (!row.set_id || !effectiveDate || !manufacturer || !productName) {
    return null;
  }
  return {
    setId: row.set_id,
    productName,
    manufacturer,
    effectiveDate,
    chosenBy,
    sections: labelSections(row),
  };
}

/**
 * "20240415" to "2024-04-15", by slicing. Never through Date: an ISO date
 * parsed by Date is UTC midnight, the previous day everywhere in the US.
 * The schema has already checked the eight digits.
 */
function isoFromYyyymmdd(value: string | null): string | null {
  if (value === null) return null;
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

/**
 * ui-spec §11's seven sections, in order, each from the openFDA field that
 * carries it. `warnings` is the pre-2006 name for `warnings_and_cautions`, and
 * is read only when the newer field is missing.
 */
const SECTION_FIELDS: ReadonlyArray<
  [LabelSectionKind, (row: LabelResult) => string[]]
> = [
  ["BOXED_WARNING", (r) => r.boxed_warning],
  ["INDICATIONS_AND_USAGE", (r) => r.indications_and_usage],
  ["DOSAGE_AND_ADMINISTRATION", (r) => r.dosage_and_administration],
  ["CONTRAINDICATIONS", (r) => r.contraindications],
  [
    "WARNINGS_AND_CAUTIONS",
    (r) =>
      r.warnings_and_cautions.length > 0 ? r.warnings_and_cautions : r.warnings,
  ],
  ["ADVERSE_REACTIONS", (r) => r.adverse_reactions],
  ["DRUG_INTERACTIONS", (r) => r.drug_interactions],
];

/**
 * Whitespace collapsed and blanks dropped, nothing more. The rest of §11's
 * normalization pass (section numbers, all-caps runs, dangling table
 * references) needs the hand-written preserved-terms list and is its own
 * change. A section with no text left is omitted, never sent empty.
 */
export function labelSections(row: LabelResult): LabelSection[] {
  return SECTION_FIELDS.flatMap(([kind, read]) => {
    const paragraphs = read(row)
      .map((p) => p.replace(/\s+/g, " ").trim())
      .filter((p) => p.length > 0);
    return paragraphs.length > 0 ? [{ kind, paragraphs }] : [];
  });
}
