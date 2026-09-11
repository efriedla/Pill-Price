import { readFileSync } from "node:fs";
import path from "node:path";

import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { UpstreamUnavailableError } from "@/server/http";
import { createLoaders } from "@/server/loaders";

/**
 * The W2 definition of done asks for a test that kills one upstream and shows
 * the page still works. This is that test, run against real recorded payloads
 * with the network intercepted by MSW rather than by hand-stubbed `fetch`.
 *
 * **What it can and cannot assert yet, stated rather than implied.** The
 * resolvers are still stubs — `drug` returns null pending Q2 and the price
 * path — so this exercises the transport and loader layer, which is where
 * degradation is actually decided. It asserts the *shape* ADR-010 requires:
 * that killing openFDA leaves every RxNorm-sourced fact intact, and that the
 * two failure kinds stay distinguishable. When the resolvers land, the same
 * scenarios should be re-asserted through a GraphQL query.
 *
 * The three cases matter because ADR-010's whole taxonomy rests on them being
 * different: an upstream that is *down* is not an upstream that says *no*.
 */

const fixture = (upstream: string, name: string): Record<string, unknown> =>
  JSON.parse(
    readFileSync(
      path.join(
        import.meta.dirname,
        "fixtures",
        "upstream",
        upstream,
        `${name}.json`,
      ),
      "utf8",
    ),
  );

const RXCUI = "860975"; // metformin ER 500 MG, an SCD — openFDA answers for it
const TTY = "SCD";

const RXNAV = "https://rxnav.nlm.nih.gov/REST";
const OPENFDA = "https://api.fda.gov";

/** Every upstream healthy. Individual tests override one handler. */
const healthy = [
  http.get(`${RXNAV}/rxcui/:rxcui/properties.json`, () =>
    HttpResponse.json(fixture("rxnorm", "props-860975")),
  ),
  http.get(`${RXNAV}/rxcui/:rxcui/ndcs.json`, () =>
    HttpResponse.json(fixture("rxnorm", "ndcs-860975")),
  ),
  http.get(`${RXNAV}/rxcui/:rxcui/allrelated.json`, () =>
    HttpResponse.json(fixture("rxnorm", "allrelated-860975")),
  ),
  http.get(`${OPENFDA}/drug/label.json`, () =>
    HttpResponse.json(fixture("openfda", "label-rxcui-860975")),
  ),
];

const server = setupServer(...healthy);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/** No real backoff: ADR-011's retry is exercised, not waited out. */
const deps = { sleep: async () => {} };

describe("everything healthy", () => {
  it("answers every field", async () => {
    const loaders = createLoaders(deps);

    const [props, ndcs, label] = await Promise.all([
      loaders.properties.load(RXCUI),
      loaders.ndcs.load(RXCUI),
      loaders.label.load({ rxcui: RXCUI, tty: TTY }),
    ]);

    expect(props?.tty).toBe(TTY);
    expect(ndcs.length).toBeGreaterThan(0);
    expect(label?.kind).toBe("labels");
  });
});

describe("kill openFDA — the page keeps its name, packages and alternatives", () => {
  it("loses only the label when openFDA is unreachable", async () => {
    server.use(
      http.get(`${OPENFDA}/drug/label.json`, () => HttpResponse.error()),
    );

    const loaders = createLoaders(deps);
    const settled = await Promise.allSettled([
      loaders.properties.load(RXCUI),
      loaders.ndcs.load(RXCUI),
      loaders.related.load(RXCUI),
      loaders.label.load({ rxcui: RXCUI, tty: TTY }),
    ]);

    // ADR-010: enrichment is always partial. openFDA supplies the label, not
    // the drug — so a dead openFDA must not cost the user the page.
    expect(settled.slice(0, 3).map((r) => r.status)).toEqual([
      "fulfilled",
      "fulfilled",
      "fulfilled",
    ]);
    expect(settled[3]?.status).toBe("rejected");
  });

  it("reports that loss as unavailable and retryable, not as absent", async () => {
    server.use(
      http.get(`${OPENFDA}/drug/label.json`, () => HttpResponse.error()),
    );

    const loaders = createLoaders(deps);
    const err = await loaders.label
      .load({ rxcui: RXCUI, tty: TTY })
      .catch((e: unknown) => e);

    // The distinction the whole taxonomy rests on: "openFDA is down" is a
    // temporary state with a retry affordance; "openFDA has no label for this
    // drug" is a settled fact with none. Collapsing them would either offer a
    // pointless retry or state a fact we never established.
    expect(err).toBeInstanceOf(UpstreamUnavailableError);
    expect((err as UpstreamUnavailableError).retryable).toBe(true);
    expect((err as UpstreamUnavailableError).source).toBe("openfda");
  });

  it("retries once before giving up, per ADR-011", async () => {
    let attempts = 0;
    server.use(
      http.get(`${OPENFDA}/drug/label.json`, () => {
        attempts++;
        return HttpResponse.error();
      }),
    );

    const loaders = createLoaders(deps);
    await loaders.label.load({ rxcui: RXCUI, tty: TTY }).catch(() => {});

    expect(attempts).toBe(2);
  });

  it("recovers on the retry when openFDA is only briefly down", async () => {
    let attempts = 0;
    server.use(
      http.get(`${OPENFDA}/drug/label.json`, () => {
        attempts++;
        return attempts === 1
          ? HttpResponse.error()
          : HttpResponse.json(fixture("openfda", "label-rxcui-860975"));
      }),
    );

    const loaders = createLoaders(deps);
    const label = await loaders.label.load({ rxcui: RXCUI, tty: TTY });

    expect(label?.kind).toBe("labels");
    expect(attempts).toBe(2);
  });
});

describe("openFDA says no — a different thing entirely", () => {
  it("treats a 404 as an answer, costing one request and no retry", async () => {
    let attempts = 0;
    server.use(
      http.get(`${OPENFDA}/drug/label.json`, () => {
        attempts++;
        return HttpResponse.json(
          { error: { code: "NOT_FOUND", message: "No matches found!" } },
          { status: 404 },
        );
      }),
    );

    const loaders = createLoaders(deps);
    const label = await loaders.label.load({ rxcui: RXCUI, tty: TTY });

    // `null` here is ADR-010's `absent`, which the resolver will render as
    // "openFDA has no label for this drug" — naming the source, because a
    // reader who cannot see which source came up empty cannot rule it out.
    expect(label).toBeNull();
    expect(attempts).toBe(1);
  });
});

describe("kill RxNorm — this one is fatal", () => {
  it("fails the identity call rather than degrading it", async () => {
    server.use(
      http.get(`${RXNAV}/rxcui/:rxcui/properties.json`, () =>
        HttpResponse.error(),
      ),
    );

    const loaders = createLoaders(deps);
    const err = await loaders.properties
      .load(RXCUI)
      .catch((e: unknown) => e);

    // RxNorm is identity, not enrichment. There is no partial page to render
    // when we cannot establish which drug this is — inventing one would be
    // worse than failing.
    expect(err).toBeInstanceOf(UpstreamUnavailableError);
    expect((err as UpstreamUnavailableError).source).toBe("rxnorm");
  });

  it("still fails loudly rather than looking like a drug that does not exist", async () => {
    server.use(
      http.get(`${RXNAV}/rxcui/:rxcui/properties.json`, () =>
        HttpResponse.json({}, { status: 500 }),
      ),
    );

    const loaders = createLoaders(deps);
    const err = await loaders.properties
      .load(RXCUI)
      .catch((e: unknown) => e);

    // RxNorm says "no such drug" with HTTP 200 and `{}`. A 500 must never be
    // read that way: not-found is a settled answer, a 500 is an outage.
    expect(err).toBeInstanceOf(UpstreamUnavailableError);
  });
});

describe("one dead upstream does not poison its siblings", () => {
  it("resolves healthy drugs while one RxCUI is unreachable", async () => {
    server.use(
      http.get(`${RXNAV}/rxcui/:rxcui/properties.json`, ({ params }) =>
        params.rxcui === "999999"
          ? HttpResponse.error()
          : HttpResponse.json(fixture("rxnorm", "props-860975")),
      ),
    );

    const loaders = createLoaders(deps);
    const settled = await Promise.allSettled([
      loaders.properties.load(RXCUI),
      loaders.properties.load("999999"),
    ]);

    expect(settled[0]?.status).toBe("fulfilled");
    expect(settled[1]?.status).toBe("rejected");
  });
});
