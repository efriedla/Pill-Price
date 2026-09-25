import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import DrugError from "@/app/drug/[rxcui]/error";
import DrugNotFound from "@/app/drug/[rxcui]/not-found";

/**
 * The not-found and error pages share one frame (ui-spec §9: say what failed
 * and what still works). Error pages retry with Next 16's `retry`, which
 * re-fetches; not-found pages have nothing to retry.
 */
describe("status pages", () => {
  it("an error page's Try again calls retry, and it is a real button", () => {
    const retry = vi.fn();
    render(<DrugError retry={retry} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("an error page names the source that failed", () => {
    render(<DrugError retry={() => {}} />);
    expect(screen.getByText(/RxNorm/)).toBeInTheDocument();
  });

  it("a not-found page offers a way on and no retry", () => {
    render(<DrugNotFound />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(
      screen.getByRole("link", { name: "Search for a drug" }),
    ).toHaveAttribute("href", "/search");
  });
});
