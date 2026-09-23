import { DelayedFallback } from "@/ui/DelayedFallback";
import { Skeleton } from "@/ui/Skeleton";

/**
 * The first boundary's fallback: `PriceHeader`'s shape in grey, becoming a
 * pill game only if the wait passes ~1.5 s (ADR-005 amendment).
 *
 * Sized to the header it stands in for (same padding, name line, ID line and
 * figure), so neither the swap to the game nor the arrival of the data moves
 * anything below it.
 */
export function PriceHeaderFallback() {
  return (
    <DelayedFallback
      game="shot"
      message="Loading this drug's price"
      className="pt-12 pb-8"
    >
      <div className="flex flex-col gap-3">
        <Skeleton label="Loading this drug's name and price" height="h-10" width="w-3/4" />
        <Skeleton shape="text" height="h-4" width="w-32" />
        <Skeleton className="mt-5" height="h-10" width="w-56" />
      </div>
    </DelayedFallback>
  );
}
