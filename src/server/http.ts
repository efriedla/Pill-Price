import "server-only";

/**
 * The request-path transport, per ADR-011.
 *
 * One rule underneath every number here: **cutting off a request that would
 * have returned correct data is the worse failure.** RxNorm answers in ~115 ms
 * and its slowest measured real success was 1197 ms — correct data arriving
 * late, not a problem to be solved. What a timeout exists to stop is an upstream
 * that has hung and will never answer.
 *
 * The timeout is therefore *not* the render's defence. Streaming is (ADR-001's
 * Cache Components, ADR-005's boundaries): a slow call suspends its own
 * boundary while the rest of the page ships. Which also means no value here is
 * tuned toward the 200 ms p95 budget — a live fan-out is ~700 ms p50 and cannot
 * meet it at any timeout. That budget belongs to `cacheLife` and ADR-009's
 * snapshot.
 *
 * NADAC is absent on purpose: ADR-009 keeps it off the request path entirely.
 */

/** The upstreams reachable from a resolver. NADAC is not one of them. */
export type UpstreamSource = "rxnorm" | "openfda";

/**
 * Per-source timeouts at 2x each source's slowest measured real success
 * (ADR-011, measured 2026-09-11: RxNorm 1197 ms, openFDA 1757 ms).
 *
 * The multiple is the defensible part, not the millisecond value. 36 samples
 * from one machine have certainly not seen the slowest real success that
 * exists, so the number sits above the observed max by a margin wide enough to
 * absorb one. Re-measure and re-derive; do not hand-tune.
 *
 * A single app-wide number was rejected: openFDA's *typical* response (589 ms)
 * is slower than RxNorm's worst-case p95 (322 ms), so one value is either too
 * tight for one source or far too loose for the other.
 */
export const TIMEOUT_MS: Record<UpstreamSource, number> = {
  rxnorm: 2_500,
  openfda: 3_500,
};

/**
 * Two attempts, one retry. A lot of failures are transient and a second try
 * usually works; past two the failure is not transient any more and further
 * attempts are pure latency.
 */
export const MAX_ATTEMPTS = 2;

/**
 * Backoff base. At one retry the delay itself is nearly inert — the *jitter*
 * is what earns its place, spreading a simultaneous fleet-wide failure so a
 * recovering upstream is not hit by a synchronised second wave. Full jitter:
 * the wait is uniform in [0, base), not base +/- a wobble.
 *
 * Short relative to the timeout it follows (150 ms against 2.5-3.5 s), because
 * the user has already waited the whole first timeout before this runs.
 */
export const BACKOFF_BASE_MS = 150;

/**
 * ADR-010's `unavailable`: we could not ask, or the answer never came.
 * Timeout, network error, or 5xx — with both attempts spent. The only kind
 * that is retryable, and the only one a UI may offer a retry for.
 */
export class UpstreamUnavailableError extends Error {
  readonly retryable = true;

  constructor(
    readonly source: UpstreamSource,
    readonly url: string,
    readonly attempts: number,
    readonly cause_: string,
  ) {
    super(
      `${source} did not answer after ${attempts} attempt(s): ${cause_} (${url})`,
    );
    this.name = "UpstreamUnavailableError";
  }
}

/**
 * A 4xx that is *our* fault, and never `unavailable`.
 *
 * ADR-011's measured trap: `related.json` without a `tty=` or `rela=` parameter
 * returns HTTP 400 on every request. The first sweep pass scored 36/36 400s and
 * read as an upstream outage. It is a malformed request, so it throws loudly
 * and is never retried — degrading it into a user-facing absence would tell the
 * reader a drug has no alternatives when in truth we asked the question wrong.
 *
 * 404 is excluded: for openFDA that is a real answer (ADR-010's `absent`), so
 * it is returned to the caller rather than thrown.
 */
export class UpstreamRequestError extends Error {
  constructor(
    readonly source: UpstreamSource,
    readonly url: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(
      `${source} rejected our request with ${status} — this is a bug in the query, not an upstream failure (${url})`,
    );
    this.name = "UpstreamRequestError";
  }
}

/** What a completed request hands back. The body stays a string: JSON parsing
 * is the Zod boundary's job (`upstream/parse.ts`), so a non-JSON body becomes
 * ADR-010's `malformed` there rather than an ambiguous throw here. RxNorm also
 * has a plain-text not-found body that a JSON parse would destroy. */
export type UpstreamResponse = {
  status: number;
  ok: boolean;
  body: string;
};

/**
 * Injected so tests can drive the policy without a network or a real clock —
 * the same shape as `FetchJson` in the NADAC module, for the same reason.
 */
export type HttpDeps = {
  fetch?: typeof globalThis.fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
};

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Full jitter: uniform in [0, BACKOFF_BASE_MS). */
export function backoffDelay(random: () => number): number {
  return Math.floor(random() * BACKOFF_BASE_MS);
}

/**
 * Issue one request under this source's policy.
 *
 * Each attempt gets a **fresh full timeout**. There is deliberately no overall
 * deadline: a shared budget would cut a retry short precisely when the first
 * attempt was slow, which is the case most likely to be a genuine transient.
 * The consequence is stated rather than hidden — a fully failing call costs
 * ~5 s on RxNorm and ~7 s on openFDA before it gives up.
 */
export async function requestUpstream(
  source: UpstreamSource,
  url: string,
  deps: HttpDeps = {},
): Promise<UpstreamResponse> {
  const doFetch = deps.fetch ?? globalThis.fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const random = deps.random ?? Math.random;

  let lastFailure = "unknown";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS[source]);

    try {
      const res = await doFetch(url, {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      // Read the body inside the timeout window: a response whose headers
      // arrive and whose body never does is still a hang.
      const body = await res.text();
      clearTimeout(timer);

      // 5xx is the upstream failing, which is retryable.
      if (res.status >= 500) {
        lastFailure = `HTTP ${res.status}`;
        if (attempt < MAX_ATTEMPTS) {
          await sleep(backoffDelay(random));
          continue;
        }
        break;
      }

      // Any other 4xx is our malformed request. Loud, and never retried:
      // asking again the same wrong way cannot start working.
      if (res.status >= 400 && res.status !== 404) {
        throw new UpstreamRequestError(source, url, res.status, body);
      }

      return { status: res.status, ok: res.ok, body };
    } catch (err) {
      clearTimeout(timer);

      // Our own bug: propagate immediately rather than burning the retry.
      if (err instanceof UpstreamRequestError) throw err;

      lastFailure =
        err instanceof Error && err.name === "AbortError"
          ? `timed out after ${TIMEOUT_MS[source]}ms`
          : err instanceof Error
            ? err.message
            : String(err);

      if (attempt < MAX_ATTEMPTS) {
        await sleep(backoffDelay(random));
        continue;
      }
    }
  }

  throw new UpstreamUnavailableError(source, url, MAX_ATTEMPTS, lastFailure);
}
