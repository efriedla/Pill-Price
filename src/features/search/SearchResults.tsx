import Link from "next/link";

import type { DrugSearchQuery } from "@/lib/gql";

export type SearchResult = DrugSearchQuery["search"][number];

/**
 * /search's results: generics first, then brands, each alphabetical. RxNorm
 * returns them grouped by term type in no useful order, and a reader looking
 * for "metformin" wants the generic before 58 branded variants of it.
 *
 * Each result is a name, a brand/generic tag and a link. No price: see
 * DrugSearch.graphql.
 *
 * **Copy is my draft** (2026-09-25), like the label's, until the author
 * writes theirs. The no-match line says why the usual fix works: RxNorm
 * matches names, with no typo tolerance (Q8, open), so "metformin 500" and
 * "metfromin" both return nothing.
 */
export function SearchResults({
  q,
  results,
}: {
  q: string;
  results: readonly SearchResult[];
}) {
  if (results.length === 0) {
    return (
      <p className="max-w-[var(--measure)] text-text-secondary">
        No drugs match “{q}”. Search matches drug names only, so try the name
        alone, without a strength, and check the spelling.
      </p>
    );
  }

  const generics = sortByName(results.filter((r) => r.isGeneric));
  const brands = sortByName(results.filter((r) => !r.isGeneric));

  return (
    <div className="flex flex-col gap-10">
      <p className="text-step--1 text-text-secondary" aria-live="polite">
        {results.length === 1
          ? `1 product matches “${q}”.`
          : `${results.length} products match “${q}”.`}
      </p>
      <Group heading="Generic" results={generics} />
      <Group heading="Brand" results={brands} />
    </div>
  );
}

function Group({
  heading,
  results,
}: {
  heading: string;
  results: readonly SearchResult[];
}) {
  if (results.length === 0) return null;
  const id = `h-results-${heading.toLowerCase()}`;
  return (
    <section aria-labelledby={id}>
      <h2
        id={id}
        className="mb-4 text-step--1 font-semibold tracking-[0.12em] text-text-secondary uppercase"
      >
        {heading} · {results.length}
      </h2>
      <ul className="flex flex-col">
        {results.map((r) => (
          <li
            key={r.rxcui}
            className="border-t border-border-hairline py-3 first:border-t-0"
          >
            <Link
              href={`/drug/${r.rxcui}`}
              className="text-text-primary underline-offset-4 hover:underline"
            >
              {r.name}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function sortByName(results: readonly SearchResult[]): SearchResult[] {
  return [...results].sort((a, b) => a.name.localeCompare(b.name));
}
