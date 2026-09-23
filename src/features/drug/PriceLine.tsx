import { formatIsoDate } from "@/lib/calendar-date";
import { cn } from "@/lib/cn";

import { roundDecimalString } from "./formatPerUnit";

/**
 * Any `PriceResult` a query selected, reduced to what this line reads. Both
 * `DrugHeader` and `DrugVersions` select at least this much, so one component
 * serves both without widening either query.
 */
export type PriceLinePrice =
  | { __typename: "Price"; pricePerUnit: string; effectiveDate: string }
  | { __typename: "Absent"; reason: string }
  | { __typename: "Unavailable"; reason: string };

/**
 * ui-spec §9: every price is followed by its unit and its date. The figure and
 * its qualifier are split so the figure can carry §2's single price colour.
 *
 * The two absences are server-authored sentences (ADR-010 amendment), rendered
 * as written. The switch has no default, so a fourth member of `PriceResult`
 * fails to compile here. `size` is the only difference between the header's
 * figure and a version card's.
 */
export function PriceLine({
  price,
  size = "large",
  className,
}: {
  price: PriceLinePrice;
  size?: "large" | "small";
  className?: string;
}) {
  switch (price.__typename) {
    case "Price":
      return (
        <p
          className={cn(
            "flex flex-wrap items-baseline gap-x-3 gap-y-1",
            className,
          )}
        >
          <span
            className={cn(
              "font-numeric font-semibold tracking-tight text-price-figure tabular-nums",
              size === "large" ? "text-step-3" : "text-step-0",
            )}
          >
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
        <p
          className={cn(
            "max-w-[var(--measure)] text-text-secondary",
            size === "small" && "text-step--1",
            className,
          )}
        >
          {price.reason}
        </p>
      );
  }
}
