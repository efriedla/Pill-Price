import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The frame every not-found and error page shares: what happened, what still
 * works, and a way on. ui-spec §9: "Errors state what failed and what still
 * works." A plain frame on purpose (design-tone rule): nothing on a page that
 * went wrong should look like it is working harder than the page it replaced.
 */
export function StatusPage({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  /** A retry button on an error page. Not-found pages have nothing to retry. */
  action?: ReactNode;
}) {
  return (
    <main className="mx-auto flex w-full max-w-[var(--measure)] flex-col gap-4 px-4 py-16 sm:px-8">
      <h1 className="font-display text-step-3 text-text-primary">{title}</h1>
      <div className="flex flex-col gap-3 text-text-secondary">{children}</div>
      <p className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-2">
        {action}
        <Link
          href="/search"
          className="text-text-primary underline underline-offset-4"
        >
          Search for a drug
        </Link>
      </p>
    </main>
  );
}
