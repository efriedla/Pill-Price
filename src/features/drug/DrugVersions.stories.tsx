import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { DrugVersions, type VersionsDrug } from "./DrugVersions";
import { DrugVersionsFallback } from "./DrugVersionsFallback";

/**
 * The second boundary in each state it meets on real drugs (measured
 * 2026-09-23: 1, 1, 1, 2, 1, 8 and 0 versions across seven). Sentences are
 * the server's, verbatim.
 */

const notPublished = {
  __typename: "Absent" as const,
  reason:
    "NADAC doesn't publish an acquisition cost for this drug (as of Sep 11, 2026).",
};

const metformin: VersionsDrug = {
  name: "24 HR metformin hydrochloride 500 MG Extended Release Oral Tablet",
  doseForm: { __typename: "DoseForm", name: "Extended Release Oral Tablet" },
  ingredients: {
    __typename: "Ingredients",
    ingredients: [{ rxcui: "6809", name: "metformin" }],
  },
  alternatives: {
    __typename: "Alternatives",
    drugs: [
      {
        rxcui: "860981",
        name: "24 HR metformin hydrochloride 500 MG Extended Release Oral Tablet [Glucophage]",
        isGeneric: false,
        price: notPublished,
      },
    ],
  },
};

const meta = {
  title: "Drug/DrugVersions",
  component: DrugVersions,
  parameters: { layout: "padded" },
} satisfies Meta<typeof DrugVersions>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One brand version, unpriced: the most common shape. */
export const OneVersion: Story = { args: { drug: metformin } };

/** Percocet: two ingredients, and a priced generic. */
export const TwoIngredients: Story = {
  args: {
    drug: {
      name: "acetaminophen 325 MG / oxycodone hydrochloride 5 MG Oral Tablet [Percocet]",
      doseForm: { __typename: "DoseForm", name: "Oral Tablet" },
      ingredients: {
        __typename: "Ingredients",
        ingredients: [
          { rxcui: "161", name: "acetaminophen" },
          { rxcui: "7804", name: "oxycodone" },
        ],
      },
      alternatives: {
        __typename: "Alternatives",
        drugs: [
          {
            rxcui: "1049621",
            name: "acetaminophen 325 MG / oxycodone hydrochloride 5 MG Oral Tablet",
            isGeneric: true,
            price: {
              __typename: "Price",
              pricePerUnit: "0.07512",
              effectiveDate: "2026-08-19",
            },
          },
        ],
      },
    },
  },
};

/** Ibuprofen's eight OTC brands, none priced: the long case. */
export const ManyVersions: Story = {
  args: {
    drug: {
      ...metformin,
      name: "ibuprofen 200 MG Oral Tablet",
      ingredients: {
        __typename: "Ingredients",
        ingredients: [{ rxcui: "5640", name: "ibuprofen" }],
      },
      doseForm: { __typename: "DoseForm", name: "Oral Tablet" },
      alternatives: {
        __typename: "Alternatives",
        drugs: ["Advil", "Motrin IB", "Midol", "Proprinal", "IBU", "Addaprin", "A-G Profen", "I-Prin"].map(
          (brand, i) => ({
            rxcui: String(900000 + i),
            name: `ibuprofen 200 MG Oral Tablet [${brand}]`,
            isGeneric: false,
            price: notPublished,
          }),
        ),
      },
    },
  },
};

/** RxNorm answered and lists none. */
export const NoVersions: Story = {
  args: {
    drug: {
      ...metformin,
      alternatives: {
        __typename: "Absent",
        reason: "RxNorm lists no other products for this drug.",
      },
    },
  },
};

/** RxNorm did not answer: all three fields share the one call. */
export const RxNormUnreachable: Story = {
  args: {
    drug: {
      name: metformin.name,
      doseForm: {
        __typename: "Unavailable",
        reason: "We could not reach RxNorm for this drug's dose form.",
      },
      ingredients: {
        __typename: "Unavailable",
        reason: "We could not reach RxNorm for this drug's ingredients.",
      },
      alternatives: {
        __typename: "Unavailable",
        reason: "We could not reach RxNorm for alternatives to this drug.",
      },
    },
  },
};

/** The skeleton. After ~1.5 s it becomes the sorting game in the same box. */
export const Loading: Story = {
  args: { drug: metformin },
  render: () => <DrugVersionsFallback />,
};
