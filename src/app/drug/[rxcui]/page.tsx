import { cacheLife } from "next/cache";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import {
  AcquisitionCostNotice,
  DrugVersions,
  DrugVersionsFallback,
  PriceHeader,
  PriceHeaderFallback,
} from "@/features/drug";
import { DrugHeaderDocument, DrugVersionsDocument } from "@/lib/gql/documents";
import { requireNadacSnapshot } from "@/server/prices";
import { runQuery } from "@/server/run-query";

import { PRERENDERED_RXCUIS } from "./prerendered";

/**
 * `/drug/[rxcui]`, per ADR-005.
 *
 * The static shell is the page frame and the acquisition-cost notice. Each
 * section streams in behind its own boundary (Q2 B): identity and price, then
 * ingredients and brand/generic versions. The label is the third, still to
 * come.
 */

// Typed by hand rather than via the generated `PageProps<"/drug/[rxcui]">`,
// for the same reason as the root layout: `tsc --noEmit` must not need a build.
type Params = Promise<{ rxcui: string }>;

/**
 * Runs during `next build`, before any page is generated, which is what makes
 * it the place for the deploy guard (ADR-010 amendment): with
 * `REQUIRE_NADAC_SNAPSHOT=1` and no snapshot, the build stops here instead of
 * prerendering "couldn't load" for every price.
 */
export async function generateStaticParams() {
  await requireNadacSnapshot();
  return PRERENDERED_RXCUIS.map((rxcui) => ({ rxcui }));
}

/**
 * Cached, so the upgraded page is fully static (ADR-005 finding 3). Reading
 * the snapshot is file I/O, and uncached I/O inside a component keeps that
 * section dynamic on every request. A week, matching ADR-001's NADAC
 * freshness and the upstream clients' own `cacheLife`.
 */
async function loadDrugHeader(rxcui: string) {
  "use cache";
  cacheLife("weeks");
  return runQuery(DrugHeaderDocument, { rxcui });
}

/**
 * The second boundary's data. Cached for a week, unless RxNorm was down.
 *
 * The resolvers turn an RxNorm outage into `Unavailable`, which is data, so a
 * week-long cache would keep "we could not reach RxNorm" for a week, and a
 * build during the outage would bake it into the static page. An outage gets
 * the `seconds` profile instead, whose one-minute expiry keeps it out of the
 * prerender (a dynamic hole, per the cacheLife docs): the static page holds
 * the fallback, and the request-time render asks again.
 */
async function loadDrugVersions(rxcui: string) {
  "use cache";
  const result = await runQuery(DrugVersionsDocument, { rxcui });
  const drug = result.drug;
  const outage =
    drug !== null &&
    [drug.doseForm, drug.ingredients, drug.alternatives].some(
      (field) => field.__typename === "Unavailable",
    );
  if (outage) cacheLife("seconds");
  else cacheLife("weeks");
  return result;
}

async function Header({ params }: { params: Params }) {
  // Awaited inside the boundary, never above it: reading params in the page
  // itself would tie the App Shell to one URL (ADR-005 Q2).
  const { rxcui } = await params;
  const { drug } = await loadDrugHeader(rxcui);
  if (!drug) notFound();
  return <PriceHeader drug={drug} />;
}

/**
 * An unknown drug is the header's to report. Here a null simply renders
 * nothing: calling notFound() from two boundaries would race.
 */
async function Versions({ params }: { params: Params }) {
  const { rxcui } = await params;
  const { drug } = await loadDrugVersions(rxcui);
  return drug ? <DrugVersions drug={drug} /> : null;
}

export default function DrugPage({ params }: { params: Params }) {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 sm:px-8">
      <AcquisitionCostNotice />
      <Suspense fallback={<PriceHeaderFallback />}>
        <Header params={params} />
      </Suspense>
      <Suspense fallback={<DrugVersionsFallback />}>
        <Versions params={params} />
      </Suspense>
    </main>
  );
}
