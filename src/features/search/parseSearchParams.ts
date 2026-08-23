import type { SearchQuery } from "./types";

const SORTS = ["price", "name", "updated"] as const;

function isSort(value: string): value is SearchQuery["sort"] {
  return (SORTS as readonly string[]).includes(value);
}

/** Search state lives in the URL, never in a client store — see W3/W4. */
export function parseSearchParams(params: URLSearchParams): SearchQuery {
  const sort = params.get("sort");
  return {
    q: params.get("q") ?? "",
    form: params.get("form"),
    sort: sort !== null && isSort(sort) ? sort : "price",
  };
}
