import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { SearchResults } from "./SearchResults";
import { SearchResultsFallback } from "./SearchResultsFallback";

/**
 * /search's results in the states RxNorm produces (measured 2026-09-25:
 * "lipitor" 4, "atorvastatin" 32, "metformin" 134, "metformin 500" 0).
 * The error state is the route's error boundary, not this component:
 * `search` is a list, so an RxNorm outage throws.
 */

const meta = {
  title: "Search/SearchResults",
  component: SearchResults,
  parameters: { layout: "padded" },
} satisfies Meta<typeof SearchResults>;

export default meta;
type Story = StoryObj<typeof meta>;

export const GenericsAndBrands: Story = {
  args: {
    q: "atorvastatin",
    results: [
      {
        rxcui: "617312",
        name: "atorvastatin 10 MG Oral Tablet",
        isGeneric: true,
      },
      {
        rxcui: "617310",
        name: "atorvastatin 20 MG Oral Tablet",
        isGeneric: true,
      },
      {
        rxcui: "617311",
        name: "atorvastatin 40 MG Oral Tablet",
        isGeneric: true,
      },
      {
        rxcui: "617314",
        name: "atorvastatin 10 MG Oral Tablet [Lipitor]",
        isGeneric: false,
      },
      {
        rxcui: "617320",
        name: "atorvastatin 20 MG Oral Tablet [Lipitor]",
        isGeneric: false,
      },
    ],
  },
};

export const BrandOnly: Story = {
  args: {
    q: "lipitor",
    results: [
      {
        rxcui: "617314",
        name: "atorvastatin 10 MG Oral Tablet [Lipitor]",
        isGeneric: false,
      },
    ],
  },
};

/** RxNorm matches names only: a strength or a typo returns nothing. */
export const NoMatch: Story = { args: { q: "metformin 500", results: [] } };

export const Loading: Story = {
  args: { q: "metformin", results: [] },
  render: () => <SearchResultsFallback />,
};
