"use client";

import { RetryButton } from "@/ui/RetryButton";
import { StatusPage } from "@/ui/StatusPage";

/**
 * Search failed. `search` is a list, not a degradable union, so an RxNorm
 * outage throws to here (ADR-005 Q4 A). What still works: a drug page already
 * cached, which does not ask RxNorm again for a week. Draft copy.
 */
export default function SearchError({ retry }: { retry: () => void }) {
  return (
    <StatusPage
      title="Search is unavailable"
      action={<RetryButton retry={retry} />}
    >
      <p>
        RxNorm, which we search, didn’t answer. Drug pages you have visited
        recently should still load.
      </p>
    </StatusPage>
  );
}
