"use client";

import { RetryButton } from "@/ui/RetryButton";
import { StatusPage } from "@/ui/StatusPage";

/**
 * A drug page that failed as a whole. Its sections degrade on their own
 * (ADR-010), so reaching here means identity failed: RxNorm could not say
 * which drug this is, and without that there is no page. Draft copy.
 */
export default function DrugError({ retry }: { retry: () => void }) {
  return (
    <StatusPage
      title="We couldn’t load this drug"
      action={<RetryButton retry={retry} />}
    >
      <p>
        RxNorm, which tells us which drug this is, didn’t answer. Prices and
        labels depend on it, so there is nothing we can show until it does.
      </p>
    </StatusPage>
  );
}
