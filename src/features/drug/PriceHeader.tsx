import type { DrugHeaderQuery } from "@/lib/gql";

import { PriceLine } from "./PriceLine";

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
      <PriceLine price={drug.price} className="mt-5" />
    </header>
  );
}
