"use client";

import { useId, useState } from "react";

/**
 * One label section's prose, clamped to three lines with a real Show more
 * button (ui-spec §11). Expands in place: the clamp is removed, nothing is
 * inserted above the text, so nothing already read moves.
 *
 * Whether to clamp at all is decided by the server component from the text's
 * length, not measured here. Measuring would need layout, which the first
 * paint does not have, and a button that appears after hydration is a jump.
 */
export function ClampedProse({
  paragraphs,
  clamp,
}: {
  paragraphs: readonly string[];
  clamp: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const clamped = clamp && !expanded;

  return (
    <>
      <div
        id={id}
        className={`flex flex-col gap-3 ${clamped ? "line-clamp-3" : ""}`}
      >
        {paragraphs.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
      {clamp ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded((e) => !e)}
          className="mt-2 text-step--1 font-semibold text-accent underline-offset-4 hover:text-accent-hover hover:underline"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      ) : null}
    </>
  );
}
