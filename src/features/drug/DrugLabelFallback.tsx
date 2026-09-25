import { DelayedFallback } from "@/ui/DelayedFallback";
import { Skeleton } from "@/ui/Skeleton";

/**
 * The third boundary's fallback. The label streams last and is the slowest
 * of the three (up to four upstream calls on the generic path, ~1.8 s cold
 * for metformin ER), so this is the one most likely to reach the game.
 *
 * Also what a static page holds when openFDA was unreachable at build: the
 * page's loader keeps that answer out of the prerender, and this fallback
 * stands in until the request-time render asks again.
 */
export function DrugLabelFallback() {
  return (
    <DelayedFallback
      game="shot"
      message="Loading this drug's label"
      className="pb-12"
    >
      <div className="flex flex-col gap-4 border-t border-border-hairline pt-6">
        <Skeleton
          label="Loading this drug's label"
          shape="text"
          height="h-3"
          width="w-16"
        />
        <Skeleton shape="text" height="h-4" width="w-2/3" />
        <Skeleton height="h-24" width="w-full" />
        <Skeleton shape="text" height="h-4" width="w-full" />
        <Skeleton shape="text" height="h-4" width="w-5/6" />
      </div>
    </DelayedFallback>
  );
}
