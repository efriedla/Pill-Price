import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { DrugLabel, type LabelDrug } from "./DrugLabel";
import { DrugLabelFallback } from "./DrugLabelFallback";

/**
 * The third boundary in each state ADR-015's chain reaches on the measured
 * drugs (2026-09-25). Prose is abridged from the real labels; sentences from
 * the server are verbatim.
 */

const lipitor: LabelDrug = {
  label: {
    __typename: "Label",
    setId: "a60cc18b-0631-4cf0-b021-9f52224ece65",
    productName: "Lipitor",
    manufacturer: "Viatris Specialty LLC",
    effectiveDate: "2024-04-15",
    chosenBy: "REFERENCE_IN_RESULTS",
    sections: [
      {
        kind: "INDICATIONS_AND_USAGE",
        paragraphs: [
          "LIPITOR is indicated: To reduce the risk of: Myocardial infarction (MI), stroke, revascularization procedures, and angina in adults with multiple risk factors for coronary heart disease (CHD) but without clinically evident CHD. Myocardial infarction and stroke in adults with type 2 diabetes mellitus with multiple risk factors for CHD but without clinically evident CHD. As an adjunct to diet to reduce low-density lipoprotein cholesterol (LDL-C) in adults with primary hyperlipidemia.",
        ],
      },
      {
        kind: "CONTRAINDICATIONS",
        paragraphs: [
          "Acute liver failure or decompensated cirrhosis. Hypersensitivity to atorvastatin or any excipients in LIPITOR.",
        ],
      },
      {
        kind: "DRUG_INTERACTIONS",
        paragraphs: [
          "Atorvastatin is a substrate of CYP3A4 and transporters. Atorvastatin plasma levels can be significantly increased with concomitant administration of inhibitors of CYP3A4 and transporters. Consider the risk/benefit of concomitant use and follow the dosage recommendations for these drugs.",
          "Concomitant use of cyclosporine, gemfibrozil, tipranavir plus ritonavir, or glecaprevir plus pibrentasvir with LIPITOR is not recommended.",
        ],
      },
    ],
  },
};

const meta = {
  title: "Drug/DrugLabel",
  component: DrugLabel,
  parameters: { layout: "padded" },
} satisfies Meta<typeof DrugLabel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Atorvastatin: the brand's label, found among the generic's own results. */
export const ReferenceLabel: Story = { args: { drug: lipitor } };

/**
 * Metformin ER: no brand label is published, so step 4, with a boxed warning,
 * which is never clamped.
 */
export const OriginalPackager: Story = {
  args: {
    drug: {
      label: {
        __typename: "Label",
        setId: "b857eccf-b9ff-45ba-8241-f47f5caada2a",
        productName: "Metformin ER 500 mg",
        manufacturer: "Granules India Ltd",
        effectiveDate: "2026-07-17",
        chosenBy: "ORIGINAL_PACKAGER",
        sections: [
          {
            kind: "BOXED_WARNING",
            paragraphs: [
              "WARNING: LACTIC ACIDOSIS. Postmarketing cases of metformin-associated lactic acidosis have resulted in death, hypothermia, hypotension, and resistant bradyarrhythmias. The onset of metformin-associated lactic acidosis is often subtle, accompanied only by nonspecific symptoms such as malaise, myalgias, respiratory distress, somnolence, and abdominal pain.",
            ],
          },
          {
            kind: "INDICATIONS_AND_USAGE",
            paragraphs: [
              "Metformin hydrochloride extended-release tablets are indicated as an adjunct to diet and exercise to improve glycemic control in adults with type 2 diabetes mellitus.",
            ],
          },
        ],
      },
    },
  },
};

/** openFDA answered, and has nothing: a settled fact, with no retry. */
export const NoLabel: Story = {
  args: {
    drug: {
      label: {
        __typename: "Absent",
        reason: "openFDA has no label for this drug.",
      },
    },
  },
};

/** openFDA did not answer. */
export const OpenFdaUnreachable: Story = {
  args: {
    drug: {
      label: {
        __typename: "Unavailable",
        reason: "We could not reach openFDA for this drug's label.",
        retryable: true,
      },
    },
  },
};

/** The skeleton. After ~1.5 s it becomes the pill-shot game in the same box. */
export const Loading: Story = {
  args: { drug: lipitor },
  render: () => <DrugLabelFallback />,
};
