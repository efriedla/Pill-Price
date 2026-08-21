import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Skeleton } from "./Skeleton";

const meta = {
  title: "UI/Skeleton",
  component: Skeleton,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="w-96">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Skeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Block: Story = {};

export const Text: Story = { args: { shape: "text", height: "h-3", width: "w-2/3" } };

export const Pill: Story = { args: { shape: "pill", height: "h-6", width: "w-24" } };

/** The shape the price header streams in as, before NADAC resolves. */
export const PriceHeaderPlaceholder: Story = {
  args: { label: "Loading price" },
  render: (args) => (
    <div className="flex flex-col gap-2">
      <Skeleton {...args} height="h-8" width="w-56" />
      <Skeleton shape="text" height="h-3" width="w-32" />
      <Skeleton shape="text" height="h-3" width="w-40" />
    </div>
  ),
};
