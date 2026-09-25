import { DelayedFallback } from "@/ui/DelayedFallback";
import { Skeleton } from "@/ui/Skeleton";

/**
 * Results while RxNorm answers: 110–250 ms warm, ~1.2 s cold (upstream-notes
 * §1), so usually just the skeleton, and the sorting game on a cold miss.
 */
export function SearchResultsFallback() {
  return (
    <DelayedFallback game="sort" message="Searching RxNorm">
      <div className="flex flex-col gap-3">
        <Skeleton label="Searching" shape="text" height="h-3" width="w-40" />
        <Skeleton shape="text" height="h-4" width="w-3/4" />
        <Skeleton shape="text" height="h-4" width="w-2/3" />
        <Skeleton shape="text" height="h-4" width="w-3/4" />
      </div>
    </DelayedFallback>
  );
}
