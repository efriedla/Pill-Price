import { cn } from "@/lib/cn";

export interface SkeletonProps {
  /** Tailwind width utility or arbitrary value, e.g. `w-32` / `w-[12ch]`. */
  width?: string;
  height?: string;
  shape?: "block" | "text" | "pill";
  className?: string;
  /**
   * Announced to screen readers as the thing being loaded, e.g. "Loading price
   * history". Only set this on the *outermost* skeleton of a region — repeating
   * it per line produces a wall of announcements.
   */
  label?: string;
}

const SHAPES = {
  block: "rounded-md",
  text: "rounded-sm",
  pill: "rounded-[var(--radius-pill)]",
} as const;

export function Skeleton({
  width = "w-full",
  height = "h-4",
  shape = "block",
  className,
  label,
}: SkeletonProps) {
  return (
    <div
      // A busy status region rather than aria-hidden: the user needs to know
      // something is coming, not just see grey boxes.
      role={label ? "status" : undefined}
      aria-live={label ? "polite" : undefined}
      aria-hidden={label ? undefined : true}
      className={cn(
        "animate-pulse bg-surface-sunken motion-reduce:animate-none",
        SHAPES[shape],
        width,
        height,
        className,
      )}
    >
      {label ? <span className="sr-only">{label}</span> : null}
    </div>
  );
}
