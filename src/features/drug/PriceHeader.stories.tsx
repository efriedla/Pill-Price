import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { PriceHeader, type HeaderDrug } from "./PriceHeader";
import { PriceHeaderFallback } from "./PriceHeaderFallback";

/**
 * The first boundary of /drug/[rxcui] in each of its states (ui-spec §7: every
 * component gets its loading, empty and error states). The two absences use
 * the server's sentences verbatim (ADR-010 amendment), since the UI renders
 * them as written.
 */

const drug: Omit<HeaderDrug, "price"> = {
  rxcui: "860975",
  name: "24 HR metformin hydrochloride 500 MG Extended Release Oral Tablet",
  tty: "SCD",
  isGeneric: true,
};

const meta = {
  title: "Drug/PriceHeader",
  component: PriceHeader,
  parameters: { layout: "padded" },
} satisfies Meta<typeof PriceHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Priced: Story = {
  args: {
    drug: {
      ...drug,
      price: {
        __typename: "Price",
        pricePerUnit: "0.02882",
        unit: "EA",
        effectiveDate: "2026-08-19",
        asOf: "2026-09-11T15:06:56.239Z",
      },
    },
  },
};

/** The typical case: ~92% of packages have no published price. */
export const NotPublished: Story = {
  args: {
    drug: {
      ...drug,
      price: {
        __typename: "Absent",
        reason:
          "NADAC doesn't publish an acquisition cost for this drug (as of Sep 11, 2026).",
        source: "NADAC",
      },
    },
  },
};

/** No snapshot loaded: our side, never a claim about NADAC. */
export const NotLoaded: Story = {
  args: {
    drug: {
      ...drug,
      price: {
        __typename: "Unavailable",
        reason:
          "We couldn't load price data. This is on our side, not NADAC's. Everything else on this page is current.",
        source: "NADAC",
        retryable: false,
      },
    },
  },
};

/** The skeleton. After ~1.5 s it becomes a pill game in the same box. */
export const Loading: Story = {
  args: Priced.args,
  render: () => <PriceHeaderFallback />,
};
