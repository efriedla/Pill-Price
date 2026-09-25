import { describe, expect, it, vi } from "vitest";

import { settle, unwrap } from "@/server/cached";
import { UpstreamRequestError, UpstreamUnavailableError } from "@/server/http";

/**
 * The cache boundary's outage envelope (found 2026-09-25). A throw inside
 * `use cache` reaches the caller as React's obfuscated error, not the class
 * that was thrown, so an outage has to cross as a value and become an error
 * again on the far side. `structuredClone` stands in for the serialization:
 * it drops class identity exactly as the boundary does.
 */

const outage = new UpstreamUnavailableError(
  "openfda",
  "https://api.fda.gov/drug/label.json?search=x",
  2,
  "timed out after 8000ms",
);

describe("settle and unwrap", () => {
  it("passes a value through untouched, without shortening the cache", async () => {
    const onOutage = vi.fn();
    const outcome = structuredClone(
      await settle(Promise.resolve([1, 2]), onOutage),
    );
    expect(unwrap(outcome)).toEqual([1, 2]);
    expect(onOutage).not.toHaveBeenCalled();
  });

  it("carries an outage across serialization and rethrows the class degrade() checks", async () => {
    const onOutage = vi.fn();
    const outcome = structuredClone(
      await settle(Promise.reject(outage), onOutage),
    );

    // The boundary's own behaviour, for contrast: a thrown instance loses its class.
    expect(structuredClone(outage)).not.toBeInstanceOf(
      UpstreamUnavailableError,
    );

    let thrown: unknown;
    try {
      unwrap(outcome);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(UpstreamUnavailableError);
    expect(thrown).toMatchObject({
      source: "openfda",
      url: outage.url,
      attempts: 2,
      cause_: "timed out after 8000ms",
      retryable: true,
    });
    // And the outage is cached briefly, never for the week.
    expect(onOutage).toHaveBeenCalledTimes(1);
  });

  it("lets any other error throw: a bug is loud, never a stated absence", async () => {
    const onOutage = vi.fn();
    const bug = new UpstreamRequestError(
      "openfda",
      "https://api.fda.gov/x",
      400,
      "",
    );
    await expect(settle(Promise.reject(bug), onOutage)).rejects.toBe(bug);
    expect(onOutage).not.toHaveBeenCalled();
  });
});
