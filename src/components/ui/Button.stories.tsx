import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Button } from "./Button";

const meta = {
  title: "UI/Button",
  component: Button,
  parameters: { layout: "centered" },
  args: { children: "Add to compare" },
  argTypes: {
    variant: { control: "inline-radio", options: ["primary", "secondary", "quiet"] },
    size: { control: "inline-radio", options: ["sm", "md"] },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {};

export const Secondary: Story = { args: { variant: "secondary" } };

export const Quiet: Story = { args: { variant: "quiet" } };

export const Small: Story = { args: { size: "sm" } };

/** Disabled is the closest thing a button has to a loading state — the
 *  spinner lives in the calling feature, not the primitive. */
export const Disabled: Story = { args: { disabled: true } };
