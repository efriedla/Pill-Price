import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/cn";

export type CardTone = "default" | "sunken" | "warning";

export interface CardProps
  extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  /** Rendered as the card's heading. Omit for cards that sit under an outer heading. */
  title?: ReactNode;
  /** Heading level. Cards do not assume a level — the page owns document outline. */
  headingLevel?: 2 | 3 | 4;
  /** Provenance line, e.g. `Source: FDA label · updated 2026-08-12` (ui-spec §11). */
  footer?: ReactNode;
  tone?: CardTone;
}

const TONES: Record<CardTone, string> = {
  default: "bg-surface-raised border border-border-hairline",
  sunken: "bg-surface-sunken border border-transparent",
  // Boxed-warning treatment: hue + 3px rule + weight. Never hue alone.
  warning: "bg-warning-bg border-l-[3px] border-warning-rule",
};

export function Card({
  title,
  headingLevel = 2,
  footer,
  tone = "default",
  className,
  children,
  ...props
}: CardProps) {
  const Heading = `h${headingLevel}` as const;

  return (
    <section
      className={cn("rounded-md p-4", TONES[tone], className)}
      {...props}
    >
      {title ? (
        <Heading
          className={cn(
            "mb-2 text-step-1 font-semibold",
            tone === "warning" ? "text-warning-fg" : "text-text-primary",
          )}
        >
          {title}
        </Heading>
      ) : null}

      {children}

      {footer ? (
        <p className="mt-4 text-step--1 text-text-secondary">{footer}</p>
      ) : null}
    </section>
  );
}
