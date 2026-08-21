import type { CompareState } from "./types";

/** ui-spec §8 and the W4 scope: at most four drugs in one comparison. */
export const MAX_COMPARE = 4;

/**
 * Every control on /compare writes to the URL, so a shared link always reopens
 * the identical view. There is no `useState` for anything shareable.
 */
export function parseCompareParams(params: URLSearchParams): CompareState {
  const rxcuis = (params.get("rxcui") ?? "")
    .split(",")
    .filter(Boolean)
    .slice(0, MAX_COMPARE);

  return {
    rxcuis,
    baseline: params.get("baseline") ?? rxcuis[0] ?? null,
    units: params.get("units") === "hundred" ? "hundred" : "unit",
    window:
      params.get("window") === "year"
        ? "year"
        : params.get("window") === "first"
          ? "first"
          : "quarter",
  };
}
