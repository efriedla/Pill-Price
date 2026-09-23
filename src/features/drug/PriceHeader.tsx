import { formatIsoDate } from "@/lib/calendar-date";
import type { DrugHeaderQuery } from "@/lib/gql";

import { roundDecimalString } from "./formatPerUnit";

/** What `DrugHeader` selected for a drug that exists. */
export type HeaderDrug = NonNullable<DrugHeaderQuery["drug"]>;

/**
 * The drug page's first boundary (ADR-005 Q2 B): identity and price.
 *
 * Takes the *operation* type, not the schema's `Drug`, so reading a field
 * `DrugHeader` never selected is a compile error (#72).
 *
 * The name is RxNorm's, proper case and unscaled: a drug name is a proper
 * noun, not a headline (ui-spec, and the design-tone rule). The RxCUI sits
 * under it as a small mono ID (ui-spec §1).
 */
export function PriceHeader({ drug }: { drug: HeaderDrug }) {
  return (
    <header className="flex flex-col gap-3 pt-12 pb-8">
      <h1 className="font-display text-step-4 leading-tight font-semibold text-text-primary">
        {drug.name}
      </h1>
      <p className="font-numeric text-step--1 text-text-secondary tabular-nums">
        rxcui {drug.rxcui}
      </p>
      <PriceFigure price={drug.price} />
    </header>
  );
}

/**
 * ui-spec §9: every price is followed by its unit and its date. The figure and
 * its qualifier are split so the figure can carry §2's single price colour.
 *
 * Every state has something to say. The two absences are server-authored
 * sentences (ADR-010 amendment), rendered as written. The switch has no
 * default, so a fourth member of `PriceResult` fails to compile here.
 */
function PriceFigure({ price }: { price: HeaderDrug["price"] }) {
  switch (price.__typename) {
    case "Price":
      return (
        <p className="mt-5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="font-numeric text-step-3 font-semibold tracking-tight text-price-figure tabular-nums">
            ${roundDecimalString(price.pricePerUnit)}
          </span>
          <span className="text-step--1 text-text-secondary">
            per unit · as of {formatIsoDate(price.effectiveDate)}
          </span>
        </p>
      );
    case "Absent":
    case "Unavailable":
      return (
        <p className="mt-5 max-w-[var(--measure)] text-text-secondary">
          {price.reason}
        </p>
      );
  }
}
