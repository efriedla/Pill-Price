import { describe, expect, it } from "vitest";

// DELIBERATE FAILURE — see src/lib/ci-tripwire.ts. Do not fix.
describe("ci tripwire", () => {
  it("fails on purpose so the PR cannot be merged", () => {
    expect(1).toBe(2);
  });
});
