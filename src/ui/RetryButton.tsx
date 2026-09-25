"use client";

/**
 * An error page's retry. Next 16's error boundary passes `retry`, which
 * re-fetches and re-renders the segment; `reset` would re-render without
 * re-fetching, which cannot fix an upstream that did not answer.
 */
export function RetryButton({ retry }: { retry: () => void }) {
  return (
    <button
      type="button"
      onClick={() => retry()}
      className="font-semibold text-accent underline-offset-4 hover:text-accent-hover hover:underline"
    >
      Try again
    </button>
  );
}
