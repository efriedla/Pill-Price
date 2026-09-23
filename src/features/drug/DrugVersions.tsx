import Link from "next/link";

import type { DrugVersionsQuery } from "@/lib/gql";

import { PriceLine, type PriceLinePrice } from "./PriceLine";

/** What `DrugVersions` selected for a drug that exists. */
export type VersionsDrug = NonNullable<DrugVersionsQuery["drug"]>;

/**
 * Small structural label: the one place letterspaced caps survive (design-tone
 * rule), marking a section quietly rather than announcing it.
 */
const SECTION_HEADING =
  "mb-6 text-step--1 font-semibold tracking-[0.12em] text-text-secondary uppercase";

/**
 * The drug page's second boundary (ADR-005 Q2 B): what the drug is made of,
 * and its brand and generic versions. One RxNorm call feeds all three fields,
 * so they arrive together and share one fallback.
 *
 * Every field is a degradable union, and every non-present member renders the
 * server's sentence as written (ADR-010). Nothing here is left blank.
 */
export function DrugVersions({ drug }: { drug: VersionsDrug }) {
  return (
    <div className="flex flex-col gap-12 pb-12">
      <Facts drug={drug} />
      <Versions drug={drug} />
    </div>
  );
}

/**
 * Ingredient names and dose form, as plain facts. The composition bar is
 * deferred until the schema carries strengths (ui-spec §4, 2026-09-23).
 */
function Facts({ drug }: { drug: VersionsDrug }) {
  const { ingredients, doseForm } = drug;
  return (
    <section
      aria-labelledby="h-details"
      className="border-t border-border-hairline pt-6"
    >
      <h2 id="h-details" className={SECTION_HEADING}>
        Details
      </h2>
      <dl className="grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="font-semibold text-text-primary">
            {ingredients.__typename === "Ingredients" &&
            ingredients.ingredients.length > 1
              ? "Active ingredients"
              : "Active ingredient"}
          </dt>
          <dd className="text-text-secondary">
            {ingredients.__typename === "Ingredients"
              ? ingredients.ingredients.map((i) => i.name).join(", ")
              : ingredients.reason}
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-text-primary">Dosage form</dt>
          <dd className="text-text-secondary">
            {doseForm.__typename === "DoseForm"
              ? doseForm.name
              : doseForm.reason}
          </dd>
        </div>
      </dl>
    </section>
  );
}

/**
 * The one sentence every version shares, when there is one: two or more
 * versions, none priced, all for the same reason. Ibuprofen's eight OTC brands
 * each said "NADAC doesn't publish…" in full, eight times over, and the
 * author's call (2026-09-23) was to say it once under the list.
 *
 * Only when *every* version shares it. A list mixing priced and unpriced
 * versions keeps each card's own line, because which ones are unpriced is
 * then the information. A single version keeps its line in the card: there is
 * nothing repeated to collapse.
 */
export function sharedAbsence(prices: readonly PriceLinePrice[]): string | null {
  if (prices.length < 2) return null;
  const [first] = prices;
  if (!first || first.__typename === "Price") return null;
  return prices.every(
    (p) => p.__typename !== "Price" && p.reason === first.reason,
  )
    ? first.reason
    : null;
}

/**
 * ui-spec §5 as amended 2026-09-23: the same strength and form, from the
 * other side of the brand/generic line. Each card shows its own price and
 * nothing computed: a difference is arithmetic on money.
 */
function Versions({ drug }: { drug: VersionsDrug }) {
  const { alternatives } = drug;
  const shared =
    alternatives.__typename === "Alternatives"
      ? sharedAbsence(alternatives.drugs.map((v) => v.price))
      : null;
  return (
    <section
      aria-labelledby="h-versions"
      className="border-t border-border-hairline pt-6"
    >
      <h2 id="h-versions" className={SECTION_HEADING}>
        Brand and generic versions
      </h2>
      {alternatives.__typename === "Alternatives" ? (
        <>
          <p className="mb-6 max-w-[var(--measure)] text-step--1 text-text-secondary">
            Same ingredients, strength and form as {drug.name}. Not a
            substitution recommendation — talk to a pharmacist.
          </p>
          <ul className="flex flex-col">
            {alternatives.drugs.map((version) => (
              <li
                key={version.rxcui}
                className="flex flex-col gap-1 border-t border-border-hairline py-4 first:border-t-0"
              >
                <p className="flex flex-wrap items-baseline gap-x-3">
                  <Link
                    href={`/drug/${version.rxcui}`}
                    className="font-semibold text-text-primary underline-offset-4 hover:underline"
                  >
                    {version.name}
                  </Link>
                  <span className="text-step--1 text-text-secondary">
                    {version.isGeneric ? "Generic" : "Brand"}
                  </span>
                </p>
                {shared ? null : (
                  <PriceLine price={version.price} size="small" />
                )}
              </li>
            ))}
          </ul>
          {shared ? (
            <p className="mt-2 max-w-[var(--measure)] border-t border-border-hairline pt-4 text-step--1 text-text-secondary">
              {shared}
            </p>
          ) : null}
        </>
      ) : (
        <p className="max-w-[var(--measure)] text-text-secondary">
          {alternatives.reason}
        </p>
      )}
    </section>
  );
}
