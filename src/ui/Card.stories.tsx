import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Card } from "./Card";

const meta = {
  title: "UI/Card",
  component: Card,
  parameters: { layout: "padded" },
  args: {
    title: "Indications and usage",
    children:
      "Atorvastatin is indicated as an adjunct to diet to reduce elevated total-C, LDL-C, apo B, and TG levels in adults with primary hyperlipidemia.",
  },
  decorators: [
    (Story) => (
      <div className="max-w-[var(--measure)]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Sunken: Story = { args: { tone: "sunken" } };

/**
 * Boxed warnings are legally significant: never truncated, never behind a
 * disclosure, and distinguished by border weight as well as hue (ui-spec §11).
 */
export const BoxedWarning: Story = {
  args: {
    tone: "warning",
    title: "Boxed warning",
    children:
      "Serious infections leading to hospitalization or death have occurred. Discontinue if a patient develops a serious infection.",
  },
};

export const WithProvenance: Story = {
  args: { footer: "Source: FDA label · updated Aug 12, 2026" },
};

export const Untitled: Story = { args: { title: undefined } };
