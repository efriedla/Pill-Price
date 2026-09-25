"use client";

import { RetryButton } from "@/ui/RetryButton";
import { StatusPage } from "@/ui/StatusPage";

/**
 * The last boundary: anything no route handled. By ADR-010 an upstream being
 * down is data, not an error, so what reaches here is identity failing (fatal
 * by design) or a bug, and this page cannot tell which. It says so rather
 * than guess. Draft copy.
 */
export default function RootError({ retry }: { retry: () => void }) {
  return (
    <StatusPage
      title="This page didn’t load"
      action={<RetryButton retry={retry} />}
    >
      <p>Something went wrong on our side while building it.</p>
    </StatusPage>
  );
}
