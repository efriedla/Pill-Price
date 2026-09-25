import { Input } from "@/ui/Input";

/**
 * The input before the client one hydrates, and the whole of it without
 * JavaScript: a plain GET form to /search. It paints in the static shell, so
 * the box is there before any search has run.
 */
export function SearchBoxFallback() {
  return (
    <form action="/search" role="search">
      <Input
        name="q"
        type="search"
        label="Search by drug name"
        placeholder="e.g. metformin, Lipitor"
        autoComplete="off"
        spellCheck={false}
      />
    </form>
  );
}
