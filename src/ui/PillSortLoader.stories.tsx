import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useEffect, useState } from "react";

import { PillSortLoader } from "./PillSortLoader";

/**
 * A sort puzzle for a loading wait — the calmer sibling of PillShotLoader.
 * Tap a bottle to pick up its top run of pills, tap another to drop them.
 *
 * Same rule as the other game: it is only ever correct for a call genuinely in
 * flight. ADR-010 rules a loader wrong for `absent`, and a puzzle sharpens that
 * — finishing a level and then reading "openFDA has no label for this drug" is
 * worse than being told immediately.
 *
 * Two things here that the arcade game does not need:
 * - **Pills carry an imprint as well as two tones**, so they are separable
 *   without colour. `showImprints={false}` shows what that would cost.
 * - **Every board is proved solvable** before it is offered. A puzzle that
 *   turns out to be impossible is worse than no puzzle.
 */
const meta = {
  title: "UI/PillSortLoader",
  component: PillSortLoader,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="mx-auto w-full max-w-4xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PillSortLoader>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The state it spends nearly all its life in. */
export const Loading: Story = { args: { isLoading: true } };

/** Prices arrived. The puzzle stays playable under the card. */
export const Ready: Story = {
  args: { isLoading: false, onContinue: () => {} },
};

export const WithSkip: Story = {
  args: { isLoading: true, onSkip: () => {}, onContinue: () => {} },
};

/**
 * Imprints off — the accessibility regression, shown deliberately.
 * Two of the six pills differ only by hue here.
 */
export const WithoutImprints: Story = {
  args: { isLoading: true, showImprints: false },
};

/** Copy is per-call-site, so the failing source can be named (ADR-010). */
export const CustomCopy: Story = {
  args: {
    isLoading: true,
    message: "Asking RxNorm for alternatives",
    readyMessage: "Alternatives found",
    continueLabel: "Compare them",
  },
};

/** The real shape: a wait that resolves on its own, past ADR-011's 7 s worst case. */
export const ResolvesAfterFifteenSeconds: Story = {
  args: {},
  render: () => {
    const Demo = () => {
      const [loading, setLoading] = useState(true);
      useEffect(() => {
        const t = setTimeout(() => setLoading(false), 15000);
        return () => clearTimeout(t);
      }, []);
      return <PillSortLoader isLoading={loading} onContinue={() => {}} />;
    };
    return <Demo />;
  },
};
