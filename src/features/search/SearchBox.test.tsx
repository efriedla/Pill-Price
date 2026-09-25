import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
let query = "";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(query),
}));
// next/form needs the app router's context; the GET form is what matters here.
vi.mock("next/form", () => ({
  default: ({ children, ...props }: { children: ReactNode }) => (
    <form {...props}>{children}</form>
  ),
}));

const { SearchBox, DEBOUNCE_MS } = await import("./SearchBox");

describe("SearchBox", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    replace.mockClear();
    query = "";
  });
  afterEach(() => vi.useRealTimers());

  const type = (value: string) =>
    fireEvent.change(screen.getByRole("searchbox"), { target: { value } });

  it("writes ?q= once, after the pause, not per keystroke", () => {
    render(<SearchBox />);
    type("m");
    type("me");
    type("metformin");
    expect(replace).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(DEBOUNCE_MS));
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("/search?q=metformin", {
      scroll: false,
    });
  });

  it("starts from the URL, so a pasted link shows its query", () => {
    query = "q=lipitor";
    render(<SearchBox />);
    expect(screen.getByRole("searchbox")).toHaveValue("lipitor");
  });

  it("does not navigate when the trimmed query has not changed", () => {
    query = "q=lipitor";
    render(<SearchBox />);
    type("lipitor ");
    act(() => vi.advanceTimersByTime(DEBOUNCE_MS));
    expect(replace).not.toHaveBeenCalled();
  });

  it("clears ?q= when the box is emptied", () => {
    query = "q=lipitor";
    render(<SearchBox />);
    type("");
    act(() => vi.advanceTimersByTime(DEBOUNCE_MS));
    expect(replace).toHaveBeenCalledWith("/search", { scroll: false });
  });

  it("is a GET form to /search, so Enter works without JavaScript", () => {
    render(<SearchBox />);
    const form = screen.getByRole("search");
    expect(form).toHaveAttribute("action", "/search");
    expect(screen.getByRole("searchbox")).toHaveAttribute("name", "q");
  });
});
