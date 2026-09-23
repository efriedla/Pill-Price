"use client";

import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * A Suspense fallback that starts as a skeleton and becomes a pill game only
 * if the wait turns out to be real (ADR-005 amendment, 2026-09-23).
 *
 * **Why the delay.** A warm or prerendered page never shows a fallback, and a
 * cold one usually shows it for a few hundred milliseconds. A game that flashes
 * for 300 ms and disappears reads as the app working harder than it has to.
 * Past ~1.5 s the reader is actually waiting, and a game beats a grey box.
 *
 * **Same box, same size.** The skeleton stays in flow, made invisible rather
 * than removed, and the game is laid over it. So the swap cannot move the
 * layout, and the section's reserved height is whatever the skeleton already
 * reserved.
 *
 * **Never in the shell's JavaScript.** The games are `lazy()`, and rendered
 * only after the timer fires, so their chunks are requested at that moment and
 * not before. W6 measures the static shell, and a canvas game should not be in
 * it. The timer only runs on the client, so the server always renders the
 * skeleton, and hydration cannot disagree with it.
 */

const GAMES = {
  shot: lazy(() =>
    import("./PillShotLoader").then((m) => ({ default: m.PillShotLoader })),
  ),
  sort: lazy(() =>
    import("./PillSortLoader").then((m) => ({ default: m.PillSortLoader })),
  ),
};

export type FallbackGame = keyof typeof GAMES;

export interface DelayedFallbackProps {
  /** The skeleton. It sets the box's size, before and after the swap. */
  children: ReactNode;
  game: FallbackGame;
  /** The game's status line, e.g. "Loading this drug's price". */
  message: string;
  /** ADR-005's ~1.5 s. A prop so stories and tests need not wait for it. */
  delayMs?: number;
  className?: string;
}

export function DelayedFallback({
  children,
  game,
  message,
  delayMs = 1500,
  className,
}: DelayedFallbackProps) {
  const [waited, setWaited] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setWaited(true), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs]);

  const Game = GAMES[game];

  return (
    <div className={cn("relative", className)}>
      {/* Hidden from assistive tech once the game (which has its own status
          line) takes over, so the wait is not announced twice. */}
      <div
        className={waited ? "invisible" : undefined}
        aria-hidden={waited ? true : undefined}
      >
        {children}
      </div>
      {waited ? (
        <div
          className="absolute inset-0 overflow-hidden rounded-md"
          data-testid="fallback-game"
        >
          {/* No inner fallback: until the chunk arrives the invisible skeleton
              still holds the box, so there is nothing to show twice. */}
          <Suspense fallback={null}>
            <Game message={message} />
          </Suspense>
        </div>
      ) : null}
    </div>
  );
}
