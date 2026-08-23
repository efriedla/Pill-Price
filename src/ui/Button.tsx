import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "quiet";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-text-inverse hover:bg-accent-hover disabled:bg-text-secondary",
  secondary:
    "bg-surface-raised text-accent border border-border-hairline hover:bg-accent-quiet",
  quiet: "bg-transparent text-accent hover:bg-accent-quiet",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-step--1",
  md: "h-10 px-4 text-step-0",
};

/**
 * The app's only button. `--accent` (space blue) carries every interactive
 * affordance; cinnamon and crimson are never used here — see ui-spec §2.
 */
export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md font-medium",
        "transition-colors duration-[var(--duration-fast)] ease-[var(--ease)]",
        "disabled:cursor-not-allowed disabled:opacity-60",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  );
}
