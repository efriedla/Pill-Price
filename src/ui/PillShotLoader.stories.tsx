import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useEffect, useState } from "react";

import { PillShotLoader } from "./PillShotLoader";

/**
 * A loading-screen mini game, for a wait long enough that a spinner is an
 * insult. ADR-011 is what creates a legitimately pending state to cover: a
 * failing upstream call costs 5 s (RxNorm) or 7 s (openFDA) across two
 * attempts, contained to one suspended boundary.
 *
 * It is **only** correct for a call genuinely in flight. ADR-010 rules a
 * loader wrong for `absent` — dressing a settled fact as a pending one is the
 * silent-empty failure in costume — and a game sharpens that, because playing
 * for six seconds and then being told "openFDA has no label for this drug" is
 * worse than being told instantly.
 */
const meta = {
  title: "UI/PillShotLoader",
  component: PillShotLoader,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="mx-auto w-full max-w-4xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PillShotLoader>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The state the component spends nearly all its life in. */
export const Loading: Story = { args: { isLoading: true } };

/** Prices arrived. The game keeps running under the card. */
export const Ready: Story = {
  args: { isLoading: false, onContinue: () => {} },
};

/** Ready, with the card dismissed via "Keep playing". */
export const ReadyWithSkip: Story = {
  args: { isLoading: true, onSkip: () => {}, onContinue: () => {} },
};

/** Copy is per-call-site, so the failing source can be named (ADR-010). */
export const CustomCopy: Story = {
  args: {
    isLoading: true,
    message: "Asking openFDA for the label",
    readyMessage: "Label found",
    continueLabel: "Read the label",
  },
};

/**
 * The real shape: a wait that resolves on its own. Fifteen seconds is chosen
 * to sit just past ADR-011's 7 s openFDA worst case.
 */
export const ResolvesAfterFifteenSeconds: Story = {
  args: {},
  render: () => {
    const Demo = () => {
      const [loading, setLoading] = useState(true);
      useEffect(() => {
        const t = setTimeout(() => setLoading(false), 15000);
        return () => clearTimeout(t);
      }, []);
      return <PillShotLoader isLoading={loading} onContinue={() => {}} />;
    };
    return <Demo />;
  },
};
