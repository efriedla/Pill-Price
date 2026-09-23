import { DelayedFallback } from "@/ui/DelayedFallback";
import { Skeleton } from "@/ui/Skeleton";

/**
 * The second boundary's fallback: two sections' worth of grey, becoming the
 * sorting game if the wait passes ~1.5 s (ADR-005 amendment). The header's
 * boundary uses the other game, so a slow page does not show the same one
 * twice.
 *
 * Sized to one version row. Most drugs have one or two (ui-spec §5), so the
 * common case does not jump; ibuprofen's eight will grow the page downward,
 * below everything already painted.
 */
export function DrugVersionsFallback() {
  return (
    <DelayedFallback
      game="sort"
      message="Loading ingredients and versions"
      className="pb-12"
    >
      <div className="flex flex-col gap-12">
        <div className="flex flex-col gap-4 border-t border-border-hairline pt-6">
          <Skeleton
            label="Loading ingredients and brand and generic versions"
            shape="text"
            height="h-3"
            width="w-24"
          />
          <Skeleton shape="text" height="h-4" width="w-2/3" />
          <Skeleton shape="text" height="h-4" width="w-1/2" />
        </div>
        <div className="flex flex-col gap-4 border-t border-border-hairline pt-6">
          <Skeleton shape="text" height="h-3" width="w-48" />
          <Skeleton shape="text" height="h-4" width="w-full" />
          <Skeleton height="h-12" width="w-full" />
        </div>
      </div>
    </DelayedFallback>
  );
}
