"use client";

import type { InputHTMLAttributes } from "react";
import { useId } from "react";

import { cn } from "@/lib/cn";

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  /** Always required. There is no unlabelled variant — see a11y audit (W7). */
  label: string;
  /** Renders the label visually hidden while keeping it in the accessibility tree. */
  hideLabel?: boolean;
  hint?: string;
  error?: string;
}

export function Input({
  label,
  hideLabel = false,
  hint,
  error,
  className,
  ...props
}: InputProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") ||
    undefined;

  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={id}
        className={cn(
          "text-step--1 font-medium text-text-primary",
          hideLabel && "sr-only",
        )}
      >
        {label}
      </label>

      <input
        id={id}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        className={cn(
          "h-10 rounded-md border bg-surface-raised px-3 text-step-0 text-text-primary",
          "placeholder:text-text-secondary",
          error ? "border-warning-rule" : "border-border-hairline",
          className,
        )}
        {...props}
      />

      {hint ? (
        <p id={hintId} className="text-step--1 text-text-secondary">
          {hint}
        </p>
      ) : null}

      {/* Errors announce what failed; the icon + text pair means hue is never
          the only carrier of the signal — see tokens.css contrast rules. */}
      {error ? (
        <p
          id={errorId}
          className="flex items-center gap-1 text-step--1 text-warning-fg"
        >
          <span aria-hidden="true">⚠</span>
          {error}
        </p>
      ) : null}
    </div>
  );
}
