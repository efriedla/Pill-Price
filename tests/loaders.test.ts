import { describe, expect, it } from "vitest";

import { createLoaders } from "@/server/loaders";

/**
 * Loaders are claimed to do two things (ADR-003/004, and `loaders.ts`'s own
 * header). Both are worth pinning because both are easy to lose silently:
 *
 *   1. Deduplicate within a request — the only N+1 win available, since neither
 *      upstream offers a multi-get we are allowed to use.
 *   2. Keep one key's failure to itself, so an unreachable drug does not take
 *      out every other drug on the page. ADR-010 needs that granularity:
 *      enrichment is always partial, and each degradable field states its own
 *      outcome.
 */

/** Counts requests per URL so dedupe is observable. */
function countingFetch(handler: (url: string) => Response | Error) {
  const urls: string[] = [];
  const fn = (async (url: string | URL | Request) => {
    urls.push(String(url));
    const out = handler(String(url));
    if (out instanceof Error) throw out;
    return out;
  }) as unknown as typeof globalThis.fetch;
  return { fn, urls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const propertiesFor = (rxcui: string) => ({
  properties: {
    rxcui,
    name: `drug ${rxcui}`,
    tty: "SCD",
    synonym: "",
    language: "ENG",
    suppress: "N",
    umlscui: "",
  },
});

describe("request-scoped deduplication", () => {
  it("asks once when the same RxCUI is reached twice in a request", async () => {
    const { fn, urls } = countingFetch((url) =>
      json(propertiesFor(url.includes("/617314/") ? "617314" : "0")),
    );
    const loaders = createLoaders({ fetch: fn, sleep: async () => {} });

    const [a, b] = await Promise.all([
      loaders.properties.load("617314"),
      loaders.properties.load("617314"),
    ]);

    expect(urls).toHaveLength(1);
    expect(a).toEqual(b);
  });

  it("keeps separate RxCUIs separate", async () => {
    const { fn, urls } = countingFetch((url) => {
      const rxcui = /rxcui\/(\d+)\//.exec(url)?.[1] ?? "0";
      return json(propertiesFor(rxcui));
    });
    const loaders = createLoaders({ fetch: fn, sleep: async () => {} });

    const results = await loaders.properties.loadMany(["617314", "860975"]);

    expect(urls).toHaveLength(2);
    expect(results.map((r) => (r as { rxcui: string }).rxcui)).toEqual([
      "617314",
      "860975",
    ]);
  });

  it("caches by rxcui AND tty for labels, not by object identity", async () => {
    // Without `cacheKeyFn` every object key is a fresh miss, which quietly
    // turns the loader into a no-op against openFDA's 1,000/day unkeyed cap.
    const { fn, urls } = countingFetch(() =>
      json({ meta: { results: { total: 0 } }, results: [] }),
    );
    const loaders = createLoaders({ fetch: fn, sleep: async () => {} });

    await Promise.all([
      loaders.label.load({ rxcui: "617314", tty: "SCD" }),
      loaders.label.load({ rxcui: "617314", tty: "SCD" }),
    ]);

    expect(urls).toHaveLength(1);
  });
});

describe("one key's failure stays with that key", () => {
  it("resolves the healthy key even when a sibling is unreachable", async () => {
    // Promise.all in the batch function would reject wholesale here, taking
    // out a drug that answered perfectly well.
    const { fn } = countingFetch((url) =>
      url.includes("/999/")
        ? new Error("ECONNREFUSED")
        : json(propertiesFor("617314")),
    );
    const loaders = createLoaders({ fetch: fn, sleep: async () => {} });

    const settled = await Promise.allSettled([
      loaders.properties.load("617314"),
      loaders.properties.load("999"),
    ]);

    expect(settled[0]?.status).toBe("fulfilled");
    expect(settled[1]?.status).toBe("rejected");
  });
});

describe("loaders are per request", () => {
  it("does not share a cache between two createLoaders calls", async () => {
    // DataLoader's cache has no TTL, so a module-level instance would serve one
    // user's answers to the next forever. Cross-request caching is cacheLife's
    // job (ADR-001), not this.
    const { fn, urls } = countingFetch(() => json(propertiesFor("617314")));

    await createLoaders({ fetch: fn, sleep: async () => {} }).properties.load(
      "617314",
    );
    await createLoaders({ fetch: fn, sleep: async () => {} }).properties.load(
      "617314",
    );

    expect(urls).toHaveLength(2);
  });
});
