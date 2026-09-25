import type { DrugLabelQuery, LabelChoice, LabelSectionKind } from "@/lib/gql";
import { formatIsoDate } from "@/lib/calendar-date";

import { ClampedProse } from "./ClampedProse";
import { SECTION_HEADING } from "./sectionHeading";

/** What `DrugLabel` selected for a drug that exists. */
export type LabelDrug = NonNullable<DrugLabelQuery["drug"]>;
type ShownLabel = Extract<LabelDrug["label"], { __typename: "Label" }>;

/** ui-spec §11's names, in its order. The server already sends that order. */
const SECTION_TITLES: Record<LabelSectionKind, string> = {
  BOXED_WARNING: "Boxed warning",
  INDICATIONS_AND_USAGE: "Indications and usage",
  DOSAGE_AND_ADMINISTRATION: "Dosage and administration",
  CONTRAINDICATIONS: "Contraindications",
  WARNINGS_AND_CAUTIONS: "Warnings and cautions",
  ADVERSE_REACTIONS: "Adverse reactions",
  DRUG_INTERACTIONS: "Drug interactions",
};

/**
 * Roughly three lines at the 65–75ch measure. Below this the text fits and a
 * Show more would open nothing.
 */
const CLAMP_AFTER_CHARS = 220;

/**
 * Why this document, one sentence per step of ADR-015's chain.
 *
 * **Draft copy (mine), used for now at the author's word, 2026-09-25.** Steps
 * 1 to 3 share one sentence. It says "follow", never "identical": a generic
 * may carve out an indication still under patent (21 CFR 314.94(a)(8)(iv)).
 * Step 4 is the ordinary path for a generic whose brand has left the market,
 * so it must not read as a fault, and it must not claim to be *the* label.
 */
export function provenance(label: ShownLabel): string {
  const date = formatIsoDate(label.effectiveDate);
  const head = `Label: ${label.productName}, from ${label.manufacturer} · updated ${date}.`;
  const why: Record<LabelChoice, string> = {
    OWN_LABEL: "Generic labels follow this one.",
    REFERENCE_IN_RESULTS: "Generic labels follow this one.",
    BRAND_VERSION: "Generic labels follow this one.",
    ORIGINAL_PACKAGER:
      "No brand-name label is published, so this is the newest from a company that makes this drug.",
  };
  return `${head} ${why[label.chosenBy]}`;
}

/** `#label-boxed-warning`, so a section is shareable (ui-spec §11). */
const anchor = (kind: LabelSectionKind) =>
  `label-${kind.toLowerCase().replaceAll("_", "-")}`;

/**
 * The drug page's third boundary (ADR-005 Q2 B): the label ADR-015 chose.
 *
 * The boxed warning is legally significant, so it is never clamped and never
 * behind a disclosure, and it is set apart by border weight and background,
 * not by hue alone. Every other section clamps to three lines.
 *
 * `Absent` and `Unavailable` render the server's sentence as written (ADR-010).
 */
export function DrugLabel({ drug }: { drug: LabelDrug }) {
  const { label } = drug;
  return (
    <section
      aria-labelledby="h-label"
      className="border-t border-border-hairline pt-6 pb-12"
    >
      <h2 id="h-label" className={SECTION_HEADING}>
        Label
      </h2>
      {label.__typename === "Label" ? (
        <ShownLabelBody label={label} />
      ) : (
        <p className="max-w-[var(--measure)] text-text-secondary">
          {label.reason}
        </p>
      )}
    </section>
  );
}

function ShownLabelBody({ label }: { label: ShownLabel }) {
  const date = formatIsoDate(label.effectiveDate);
  return (
    <>
      <p className="mb-8 max-w-[var(--measure)] text-step--1 text-text-secondary">
        {provenance(label)}{" "}
        <a
          href={`https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${encodeURIComponent(label.setId)}`}
          className="text-text-primary underline underline-offset-4"
        >
          Full label on DailyMed
        </a>
      </p>
      <div className="flex max-w-[var(--measure)] flex-col gap-10">
        {label.sections.map((section) => {
          const boxed = section.kind === "BOXED_WARNING";
          const length = section.paragraphs.join(" ").length;
          return (
            <section
              key={section.kind}
              id={anchor(section.kind)}
              aria-labelledby={`h-${anchor(section.kind)}`}
              className={
                boxed
                  ? "border-4 border-warning-rule bg-warning-bg p-4 text-text-primary"
                  : "text-text-primary"
              }
            >
              <h3
                id={`h-${anchor(section.kind)}`}
                className="mb-3 font-semibold"
              >
                {SECTION_TITLES[section.kind]}
              </h3>
              <ClampedProse
                paragraphs={section.paragraphs}
                clamp={!boxed && length > CLAMP_AFTER_CHARS}
              />
              <p className="mt-3 text-step--1 text-text-secondary">
                Source: FDA label · updated {date}
              </p>
            </section>
          );
        })}
      </div>
    </>
  );
}
