import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Input } from "./Input";

const meta = {
  title: "UI/Input",
  component: Input,
  parameters: { layout: "centered" },
  args: { label: "Drug name", placeholder: "e.g. atorvastatin" },
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithHint: Story = {
  args: { hint: "Search by brand or generic name." },
};

export const WithError: Story = {
  args: { error: "Enter at least 3 characters.", defaultValue: "at" },
};

/** The search field on `/search` uses this — the page heading is the label. */
export const HiddenLabel: Story = { args: { hideLabel: true } };

export const Disabled: Story = { args: { disabled: true } };
