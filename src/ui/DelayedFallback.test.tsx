import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DelayedFallback } from "./DelayedFallback";

// The game is a canvas that jsdom cannot draw, and what matters here is when it
// is asked for, not what it paints.
vi.mock("./PillShotLoader", () => ({
  PillShotLoader: ({ message }: { message: string }) => <p>{message}</p>,
}));

describe("DelayedFallback", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const renderIt = () =>
    render(
      <DelayedFallback game="shot" message="Loading this drug's price" delayMs={1500}>
        <div data-testid="skeleton" />
      </DelayedFallback>,
    );

  it("shows only the skeleton for a short wait", () => {
    renderIt();
    act(() => vi.advanceTimersByTime(1499));
    expect(screen.getByTestId("skeleton")).toBeVisible();
    expect(screen.queryByTestId("fallback-game")).toBeNull();
  });

  it("lays the game over the skeleton once the wait is real", async () => {
    renderIt();
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    vi.useRealTimers();
    expect(await screen.findByText("Loading this drug's price")).toBeInTheDocument();
    // Still in the tree, holding the box: the swap must not move the layout.
    const skeleton = screen.getByTestId("skeleton");
    expect(skeleton.parentElement).toHaveClass("invisible");
    expect(skeleton.parentElement).toHaveAttribute("aria-hidden", "true");
  });

  it("never starts a game after it has unmounted", () => {
    const { unmount } = renderIt();
    unmount();
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.queryByTestId("fallback-game")).toBeNull();
  });
});
