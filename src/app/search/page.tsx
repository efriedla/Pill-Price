import { Suspense } from "react";

import {
  SearchBox,
  SearchBoxFallback,
  SearchResults,
  SearchResultsFallback,
} from "@/features/search";
import { DrugSearchDocument } from "@/lib/gql/documents";
import { runQuery } from "@/server/run-query";

/**
 * `/search`, per ADR-005 Q4 A: server-rendered, and the URL is the only state.
 *
 * The static shell is the heading and the input's fallback, a plain GET form,
 * so the box paints before anything has run and works with no JavaScript.
 * The results read `searchParams` inside their own boundary and stream in.
 *
 * Uncached, as ADR-001 leaves search. An RxNorm outage here is not a
 * degradable field (`search` is a list, not a union), so it throws to the
 * route's error boundary.
 */

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function Results({ searchParams }: { searchParams: SearchParams }) {
  const raw = (await searchParams).q;
  const q = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";
  if (!q) return null;
  const { search } = await runQuery(DrugSearchDocument, { term: q });
  return <SearchResults q={q} results={search} />;
}

export default function SearchPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8 sm:px-8">
      <h1 className="font-display text-step-3 text-text-primary">
        Search drugs
      </h1>
      <div className="max-w-[var(--measure)]">
        <Suspense fallback={<SearchBoxFallback />}>
          <SearchBox />
        </Suspense>
      </div>
      <Suspense fallback={<SearchResultsFallback />}>
        <Results searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
