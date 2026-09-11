import { describe, expect, it } from "vitest";

import {
  BACKOFF_BASE_MS,
  MAX_ATTEMPTS,
  TIMEOUT_MS,
  UpstreamRequestError,
  UpstreamUnavailableError,
  backoffDelay,
  requestUpstream,
} from "@/server/http";

/**
 * ADR-011's policy, tested at the level the ADR argues at.
 *
 * The numbers themselves are derived (2x each source's slowest measured real
 * success), so asserting them here would only restate a constant. What is
 * worth pinning is the *behaviour the derivation exists to protect*: that a
 * retry gets a full budget rather than a remainder, that a failure we caused
 * is never retried or degraded, and that a 404 survives to the caller because
 * for openFDA it is an answer rather than a failure.
 */

type FetchArgs = { url: string; init: RequestInit | undefined };

/** A fetch stub that plays a scripted sequence and records how it was called. */
function stubFetch(steps: Array<Response | Error>) {
  const calls: FetchArgs[] = [];
  let i = 0;
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const step = steps[Math.min(i++, steps.length - 1)];
    if (step instanceof Error) throw step;
    return step as Response;
  }) as unknown as typeof globalThis.fetch;
  return { fn, calls };
}

const ok = (body: string, status = 200) =>
  new Response(body, { status, headers: { "content-type": "application/json" } });

function abortError() {
  const e = new Error("The operation was aborted.");
  e.name = "AbortError";
  return e;
}

/** Records every backoff the policy asked for. */
function recordSleeps() {
  const slept: number[] = [];
  return {
    slept,
    sleep: async (ms: number) => {
      slept.push(ms);
    },
  };
}

describe("ADR-011 — per-source budgets", () => {
  it("gives each source its own timeout rather than one shared number", () => {
    // The point of per-source budgets: openFDA's typical response (589 ms) is
    // slower than RxNorm's worst-case p95 (322 ms), so one value cannot be
    // right for both. The relation is what matters, not the constants.
    expect(TIMEOUT_MS.openfda).toBeGreaterThan(TIMEOUT_MS.rxnorm);
  });

  it("sets every budget above the slowest measured real success", () => {
    // Never cut off a request that would have returned correct data.
    // Measured 2026-09-11: RxNorm max 1197 ms, openFDA max 1757 ms.
    expect(TIMEOUT_MS.rxnorm).toBeGreaterThan(1197);
    expect(TIMEOUT_MS.openfda).toBeGreaterThan(1757);
  });
});

describe("ADR-011 — attempts", () => {
  it("retries a 5xx exactly once, then reports unavailable", async () => {
    const { fn, calls } = stubFetch([ok("nope", 503), ok("nope", 503)]);
    const { sleep } = recordSleeps();

    await expect(
      requestUpstream("rxnorm", "https://x/y", { fetch: fn, sleep }),
    ).rejects.toBeInstanceOf(UpstreamUnavailableError);

    expect(calls).toHaveLength(MAX_ATTEMPTS);
  });

  it("succeeds on the retry when the first attempt was transient", async () => {
    // The reason a retry is worth its latency at all.
    const { fn, calls } = stubFetch([abortError(), ok(`{"ok":true}`)]);
    const { sleep } = recordSleeps();

    const res = await requestUpstream("rxnorm", "https://x/y", {
      fetch: fn,
      sleep,
    });

    expect(res.status).toBe(200);
    expect(res.body).toBe(`{"ok":true}`);
    expect(calls).toHaveLength(2);
  });

  it("gives the retry a fresh full timeout, not a remainder", async () => {
    // Rejecting an overall deadline is the whole reason this is two separate
    // budgets: a shared one would cut the retry short precisely when the first
    // attempt was slow — the case most likely to be transient. Each attempt
    // therefore carries its own unexpired AbortSignal.
    const { fn, calls } = stubFetch([abortError(), ok("{}")]);
    const { sleep } = recordSleeps();

    await requestUpstream("openfda", "https://x/y", { fetch: fn, sleep });

    const signals = calls.map((c) => c.init?.signal);
    expect(signals).toHaveLength(2);
    expect(signals[0]).not.toBe(signals[1]);
    expect(signals[1]?.aborted).toBe(false);
  });

  it("reports a timeout as unavailable, naming the budget it exceeded", async () => {
    const { fn } = stubFetch([abortError()]);
    const { sleep } = recordSleeps();

    const err = await requestUpstream("openfda", "https://x/y", {
      fetch: fn,
      sleep,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UpstreamUnavailableError);
    const unavailable = err as UpstreamUnavailableError;
    expect(unavailable.retryable).toBe(true);
    expect(unavailable.source).toBe("openfda");
    expect(unavailable.message).toContain(String(TIMEOUT_MS.openfda));
  });
});

describe("ADR-011 — backoff and jitter", () => {
  it("waits between attempts, with full jitter rather than a fixed delay", async () => {
    const { fn } = stubFetch([ok("x", 500), ok("y")]);
    const { slept, sleep } = recordSleeps();

    await requestUpstream("rxnorm", "https://x/y", {
      fetch: fn,
      sleep,
      random: () => 0.5,
    });

    expect(slept).toHaveLength(1);
    expect(slept[0]).toBe(Math.floor(0.5 * BACKOFF_BASE_MS));
  });

  it("draws the delay from [0, base) so a fleet does not retry in lockstep", () => {
    // Full jitter, not base +/- a wobble: the floor is 0.
    expect(backoffDelay(() => 0)).toBe(0);
    expect(backoffDelay(() => 0.999999)).toBeLessThan(BACKOFF_BASE_MS);
  });

  it("does not sleep when the first attempt succeeds", async () => {
    const { fn } = stubFetch([ok("{}")]);
    const { slept, sleep } = recordSleeps();

    await requestUpstream("rxnorm", "https://x/y", { fetch: fn, sleep });

    expect(slept).toEqual([]);
  });
});

describe("ADR-011 — a failure we caused is not an upstream failure", () => {
  it("throws on a 400 and never retries it", async () => {
    // The measured trap: related.json without tty= or rela= is HTTP 400 on
    // every request. Asking again the same wrong way cannot start working.
    const { fn, calls } = stubFetch([ok("bad request", 400)]);
    const { slept, sleep } = recordSleeps();

    await expect(
      requestUpstream("rxnorm", "https://x/related.json", {
        fetch: fn,
        sleep,
      }),
    ).rejects.toBeInstanceOf(UpstreamRequestError);

    expect(calls).toHaveLength(1);
    expect(slept).toEqual([]);
  });

  it("does not degrade our 400 into a retryable unavailable", async () => {
    // If this leaked out as `unavailable`, a UI would offer a retry for a bug.
    const { fn } = stubFetch([ok("bad request", 400)]);

    const err = await requestUpstream("rxnorm", "https://x/y", {
      fetch: fn,
      sleep: async () => {},
    }).catch((e: unknown) => e);

    expect(err).not.toBeInstanceOf(UpstreamUnavailableError);
    expect(err).toHaveProperty("status", 400);
  });
});

describe("ADR-011 — a timeout can never detect absence", () => {
  it("returns a 404 to the caller instead of throwing", async () => {
    // openFDA's 404 means "no label for this drug" (ADR-010's `absent`), and
    // it costs what a 200 costs. Absence is read off the response, never off
    // the clock — so the transport must not swallow it as a failure.
    const { fn, calls } = stubFetch([ok(`{"error":{"code":"NOT_FOUND"}}`, 404)]);
    const { slept, sleep } = recordSleeps();

    const res = await requestUpstream("openfda", "https://x/label.json", {
      fetch: fn,
      sleep,
    });

    expect(res.status).toBe(404);
    expect(res.ok).toBe(false);
    expect(calls).toHaveLength(1);
    expect(slept).toEqual([]);
  });
});

describe("ADR-011 — the body stays a string", () => {
  it("does not parse JSON, so malformed stays the Zod boundary's call", async () => {
    // ADR-010's `malformed` is loud and never read as absent. Deciding that
    // here would make a parse failure indistinguishable from a transport one —
    // and RxNorm has a plain-text not-found body a JSON parse would destroy.
    const { fn } = stubFetch([ok("<html>upstream is having a day</html>")]);

    const res = await requestUpstream("rxnorm", "https://x/y", {
      fetch: fn,
      sleep: async () => {},
    });

    expect(res.body).toBe("<html>upstream is having a day</html>");
    expect(res.ok).toBe(true);
  });
});
