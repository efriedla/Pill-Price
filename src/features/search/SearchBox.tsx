"use client";

import Form from "next/form";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

import { Input } from "@/ui/Input";

/** Long enough to skip the keystrokes of a word being typed. */
export const DEBOUNCE_MS = 300;

/**
 * The search input (ADR-005 Q4 A). It writes `?q=` and nothing else: the
 * results are the server's, re-rendered from the URL, so there is no client
 * state for a pasted link to be missing.
 *
 * Typing replaces the URL after a pause. Replace, not push: a query being
 * typed is not a place to go Back to. Enter submits at once, and without
 * JavaScript the same `<Form>` is a plain GET to /search.
 *
 * Reads `useSearchParams`, so it must sit inside a Suspense boundary; its
 * fallback is `SearchBoxFallback`, the same form without the typing loop.
 */
export function SearchBox() {
  const router = useRouter();
  const params = useSearchParams();
  const current = params.get("q") ?? "";
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <Form action="/search" role="search">
      <Input
        name="q"
        type="search"
        label="Search by drug name"
        placeholder="e.g. metformin, Lipitor"
        defaultValue={current}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => {
          const q = event.currentTarget.value.trim();
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => {
            if (q === current) return;
            router.replace(
              q ? `/search?q=${encodeURIComponent(q)}` : "/search",
              {
                scroll: false,
              },
            );
          }, DEBOUNCE_MS);
        }}
      />
    </Form>
  );
}
