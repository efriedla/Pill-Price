import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { NADAC_DATASET_ID, NADAC_DATASET_YEAR } from "@/server/nadac/config";
import {
  datasetQueryUrl,
  resolveDataset,
  type FetchJson,
} from "@/server/nadac/distribution";
import {
  buildSnapshot,
  fetchAllRows,
  isSnapshotStale,
  toLatestByNdc,
} from "@/server/nadac/snapshot";
import type { NadacRow } from "@/server/upstream/nadac.schema";

const FIXTURES = path.join(import.meta.dirname, "fixtures/upstream");
const load = (rel: string) =>
  JSON.parse(readFileSync(path.join(FIXTURES, rel), "utf8")) as unknown;

const NOW = new Date("2026-08-26T12:00:00Z");

/** A fetch stub. Routes by URL substring so tests read as intent, not plumbing. */
function stubFetch(
  routes: { match: string; status?: number; body?: unknown }[],
): FetchJson {
  return async (url: string) => {
    const route = routes.find((r) => url.includes(r.match));
    const status = route?.status ?? (route ? 200 : 404);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => route?.body ?? {},
    };
  };
}

const row = (over: Partial<NadacRow> = {}): NadacRow => ({
  ndc: "29300038901",
  ndc_description: "METFORMIN HCL ER 500 MG TABLET",
  nadac_per_unit: "0.02982",
  effective_date: "2025-12-17",
  pricing_unit: "EA",
  pharmacy_type_indicator: "C/I",
  otc: "N",
  explanation_code: "1",
  classification_for_rate_setting: "G",
  corresponding_generic_drug_nadac_per_unit: null,
  corresponding_generic_drug_effective_date: null,
  as_of_date: "2026-01-07",
  ...over,
});

const dataset = {
  datasetId: NADAC_DATASET_ID,
  year: NADAC_DATASET_YEAR,
  index: 0,
  source: "pinned" as const,
};

/**
 * The captured metastore index with one synthetic entry appended, standing in
 * for the year NADAC has not published yet.
 *
 * Derived from the real fixture rather than captured separately, so a
 * re-capture (as in #43) cannot leave a hand-built 2027 file behind to drift.
 * The identifiers are the only invented part: a new dataset is a fresh UUIDv4
 * and a fresh UUIDv5 distribution, neither derivable from 2026's.
 */
function indexWithYear(year: number): unknown {
  const items = load("nadac/datasets.json") as {
    title: string;
    identifier: string;
    distribution: { identifier: string }[];
  }[];
  const previous = items.find((item) => item.title.endsWith(String(year - 1)));
  if (!previous) throw new Error(`fixture has no ${year - 1} dataset to clone`);

  return [
    ...items,
    {
      ...previous,
      title: previous.title.replace(String(year - 1), String(year)),
      identifier: `0000${year}00-0000-4000-8000-000000000000`,
      distribution: [
        { ...previous.distribution[0], identifier: `0000${year}00-0000-5000-8000-000000000000` },
      ],
    },
  ];
}

/** A fetch stub whose pinned-dataset probe succeeds, as a live-but-old pin does. */
function stubLivePin(routes: { match: string; status?: number; body?: unknown }[]): {
  fetchJson: FetchJson;
  metastoreCalls: () => number;
} {
  let metastoreCalls = 0;
  const inner = stubFetch([{ match: NADAC_DATASET_ID }, ...routes]);
  return {
    fetchJson: async (url) => {
      if (url.includes("metastore")) metastoreCalls += 1;
      return inner(url);
    },
    metastoreCalls: () => metastoreCalls,
  };
}

describe("dataset resolution (ADR-009 primary/fallback)", () => {
  it("uses the pinned dataset ID without touching the metastore", async () => {
    let metastoreCalls = 0;
    const fetchJson: FetchJson = async (url) => {
      if (url.includes("metastore")) metastoreCalls += 1;
      return { ok: true, status: 200, json: async () => ({ results: [], count: 0 }) };
    };

    const resolved = await resolveDataset(fetchJson, NOW);

    expect(resolved.source).toBe("pinned");
    expect(resolved.datasetId).toBe(NADAC_DATASET_ID);
    // The whole point of the pin: the 1.16 MB index is not on the normal path.
    expect(metastoreCalls).toBe(0);
    expect(resolved.alert).toBeUndefined();
  });

  it("rediscovers and alerts when the pin 400s (year rollover)", async () => {
    const resolved = await resolveDataset(
      stubFetch([
        { match: NADAC_DATASET_ID, status: 400 },
        { match: "metastore", body: load("nadac/datasets.json") },
      ]),
      NOW,
    );

    expect(resolved.source).toBe("rediscovered");
    // Running on a discovery rather than a reviewed constant needs a human.
    expect(resolved.alert).toContain("NADAC_DATASET_ID");
  });

  it("refuses to repin on a transient 500 rather than a rollover", async () => {
    // The failure this prevents: a blip silently repointing the job at a
    // weekly-rotating distribution ID, which then dies seven days later.
    await expect(
      resolveDataset(stubFetch([{ match: NADAC_DATASET_ID, status: 500 }]), NOW),
    ).rejects.toThrow(/not treating this as a year rollover/i);
  });

  it("fails loudly when the pin is dead and the metastore is unreachable", async () => {
    await expect(
      resolveDataset(
        stubFetch([
          { match: NADAC_DATASET_ID, status: 400 },
          { match: "metastore", status: 503 },
        ]),
        NOW,
      ),
    ).rejects.toThrow(/cannot resolve a dataset/i);
  });
});

describe("query URLs (DKAN's two endpoints are not interchangeable)", () => {
  // Measured against the live API on 2026-09-17, by the rehearsal script:
  //   datastore/query/{datasetId}/{index}  200
  //   datastore/query/{distributionId}     200
  //   datastore/query/{distributionId}/0   404 "No resource found for dataset
  //                                            … at index 0"
  // The fallback resolves a *distribution*, so it is the second form or
  // nothing — and it had been building the third.
  it("addresses a dataset with its distribution index", () => {
    expect(datasetQueryUrl("dataset-id", 0)).toMatch(/\/query\/dataset-id\/0$/);
  });

  it("addresses a distribution with no index at all", () => {
    expect(datasetQueryUrl("distribution-id", null)).toMatch(
      /\/query\/distribution-id$/,
    );
  });

  it("gives the rediscovered distribution a URL that has no index", async () => {
    // The regression that shipped: `index: 0` on a rediscovered distribution
    // 404s every page, so the rollover fallback resolved successfully and then
    // failed on the first request — the one combination the fixture-only tests
    // could not see, because they stub the query layer.
    const resolved = await resolveDataset(
      stubFetch([
        { match: NADAC_DATASET_ID, status: 400 },
        { match: "metastore", body: load("nadac/datasets.json") },
      ]),
      NOW,
    );

    expect(resolved.index).toBeNull();
    expect(datasetQueryUrl(resolved.datasetId, resolved.index)).toBe(
      `https://data.medicaid.gov/api/1/datastore/query/${resolved.datasetId}`,
    );
  });

  it("pages a rediscovered distribution off the indexless URL", async () => {
    // End of the same thread: what `fetchAllRows` actually requests.
    const urls: string[] = [];
    const resolved = await resolveDataset(
      stubFetch([
        { match: NADAC_DATASET_ID, status: 400 },
        { match: "metastore", body: load("nadac/datasets.json") },
      ]),
      NOW,
    );

    await fetchAllRows(async (url) => {
      urls.push(url);
      return { ok: true, status: 200, json: async () => ({ results: [], count: 0 }) };
    }, resolved);

    expect(urls[0]).toContain(`/query/${resolved.datasetId}?`);
    expect(urls[0]).not.toContain(`/${resolved.datasetId}/0`);
  });
});

describe("the annual rollover, across the year boundary", () => {
  // ADR-009 commits to exercising this path before January. Everything above
  // runs at NOW (August 2026), where the pinned year is the current year and
  // the interesting branches are unreachable.
  const JANUARY = new Date("2027-01-06T12:00:00Z");
  const MARCH = new Date("2027-03-03T12:00:00Z");

  it("keeps using the pinned dataset in January, before the new year is published", async () => {
    // Not a fault, and deliberately not an alert. NADAC publishes the new
    // year's dataset some weeks into January; until it exists, last year's
    // final weekly file is the most current acquisition cost there is.
    const { fetchJson, metastoreCalls } = stubLivePin([
      { match: "metastore", body: load("nadac/datasets.json") },
    ]);

    const resolved = await resolveDataset(fetchJson, JANUARY);

    expect(resolved).toMatchObject({
      datasetId: NADAC_DATASET_ID,
      year: NADAC_DATASET_YEAR,
      source: "pinned",
    });
    expect(resolved.alert).toBeUndefined();
    // The check itself is not free — it is the one time of year the index is
    // fetched on a *working* pin.
    expect(metastoreCalls()).toBe(1);
  });

  it("switches to the new year once NADAC publishes it, even though the pin still answers", async () => {
    // The failure this exists to prevent. A rolled-over dataset ID does not
    // die — ADR-009 finding 6 measured the 2013–2021 datasets still answering
    // under their original identifiers — so the 400 the fallback was written
    // around never arrives, and the job would snapshot 2026 forever while
    // reporting itself healthy.
    const { fetchJson } = stubLivePin([
      { match: "metastore", body: indexWithYear(2027) },
    ]);

    const resolved = await resolveDataset(fetchJson, MARCH);

    expect(resolved.source).toBe("rediscovered");
    expect(resolved.year).toBe(2027);
    expect(resolved.datasetId).not.toBe(NADAC_DATASET_ID);
    expect(resolved.alert).toContain("a year behind");
    expect(resolved.alert).toContain("NADAC_DATASET_ID");
    // A distribution, so no index — the same correction as the dead-pin path.
    expect(resolved.index).toBeNull();
  });

  it("does not touch the metastore in the eleven months the pin is current", async () => {
    // The cost of the check above, bounded. This is the assertion that keeps
    // the 1.16 MB index off the weekly path for the rest of the year.
    const { fetchJson, metastoreCalls } = stubLivePin([
      { match: "metastore", body: indexWithYear(2027) },
    ]);

    const resolved = await resolveDataset(fetchJson, NOW);

    expect(resolved.source).toBe("pinned");
    expect(metastoreCalls()).toBe(0);
  });

  it("snapshots the live pin rather than nothing when the rollover check cannot run", async () => {
    // The pinned dataset answered, so there is real data. Refusing to run
    // would trade a possibly-stale year for certainly no prices.
    const { fetchJson } = stubLivePin([{ match: "metastore", status: 503 }]);

    const resolved = await resolveDataset(fetchJson, MARCH);

    expect(resolved).toMatchObject({
      datasetId: NADAC_DATASET_ID,
      source: "pinned",
    });
    // But an unanswered check is not a passed one.
    expect(resolved.alert).toContain("could not be checked");
  });

  it("carries the year-behind alert into the manifest a human reads", async () => {
    // The alert is only worth anything if it survives into the snapshot.
    const { fetchJson } = stubLivePin([
      { match: "metastore", body: indexWithYear(2027) },
    ]);
    const resolved = await resolveDataset(fetchJson, MARCH);

    const snapshot = buildSnapshot([row()], 1, resolved, MARCH);

    expect(snapshot.manifest.datasetYear).toBe(2027);
    expect(snapshot.manifest.datasetSource).toBe("rediscovered");
    expect(snapshot.manifest.alert).toContain("a year behind");
  });
});

describe("paging", () => {
  it("issues no filtered query — filtering is the 2.7s cost", async () => {
    const urls: string[] = [];
    const fetchJson: FetchJson = async (url) => {
      urls.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({ results: [row()], count: 1 }),
      };
    };

    await fetchAllRows(fetchJson, dataset);

    expect(urls).toHaveLength(1);
    expect(urls[0]).not.toContain("conditions");
  });

  it("stops on a short page even if count disagrees", async () => {
    // Guards an infinite loop: a server reporting more rows than it will serve.
    const fetchJson: FetchJson = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ results: [row()], count: 999_999 }),
    });

    const { rows, reported } = await fetchAllRows(fetchJson, dataset);

    expect(rows).toHaveLength(1);
    expect(reported).toBe(999_999);
  });

  it("aborts on a failed page rather than writing a partial snapshot", async () => {
    await expect(
      fetchAllRows(stubFetch([{ match: "datastore", status: 502 }]), dataset),
    ).rejects.toThrow(/aborting rather than writing a partial snapshot/i);
  });
});

describe("reduction to current price", () => {
  it("takes the newest effective_date, not the last row seen", async () => {
    // Arrival order is deliberately wrong here: the API guarantees no ordering,
    // so a price that depends on pagination order is a bug.
    const entries = toLatestByNdc([
      row({ effective_date: "2026-04-22", nadac_per_unit: "0.02933" }),
      row({ effective_date: "2026-08-19", nadac_per_unit: "0.03100" }),
      row({ effective_date: "2026-03-18", nadac_per_unit: "0.02902" }),
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.effectiveDate).toBe("2026-08-19");
    expect(entries[0]?.perUnit).toBe("0.03100");
  });

  it("carries the pricing unit, without which prices are not comparable", () => {
    const entries = toLatestByNdc([row({ pricing_unit: "ML" })]);
    expect(entries[0]?.unit).toBe("ML");
  });

  it("drops rows with no price rather than recording them as zero", () => {
    // A drug with no published price must never read as free.
    expect(toLatestByNdc([row({ nadac_per_unit: null })])).toEqual([]);
  });

  it("reduces the real 401-NDC fixture to one entry per NDC", () => {
    const { results } = load("nadac/ndcs-for-860975.json") as {
      results: NadacRow[];
    };
    const entries = toLatestByNdc(results);

    expect(entries.length).toBeGreaterThan(0);
    expect(new Set(entries.map((e) => e.ndc)).size).toBe(entries.length);
  });
});

describe("manifest", () => {
  it("marks an under-fetched snapshot incomplete", () => {
    const { manifest } = buildSnapshot([row()], 1_028_250, dataset, NOW);

    // A resolver must refuse this: a partial table is indistinguishable from
    // drugs genuinely having no published price.
    expect(manifest.complete).toBe(false);
  });

  it("records asOf, the date range, and the priced-NDC count", () => {
    const { manifest } = buildSnapshot(
      [row({ effective_date: "2025-12-17" }), row({ ndc: "00185441605", effective_date: "2026-08-19" })],
      2,
      dataset,
      NOW,
    );

    expect(manifest.complete).toBe(true);
    expect(manifest.asOf).toBe(NOW.toISOString());
    expect(manifest.pricedNdcs).toBe(2);
    expect(manifest.effectiveDateRange).toEqual({
      earliest: "2025-12-17",
      latest: "2026-08-19",
    });
  });

  it("propagates the stale-pin alert into the manifest", () => {
    const { manifest } = buildSnapshot([row()], 1, {
      ...dataset,
      source: "rediscovered",
      alert: "pin is stale",
    }, NOW);

    expect(manifest.datasetSource).toBe("rediscovered");
    expect(manifest.alert).toBe("pin is stale");
  });
});

describe("staleness (ADR-009: 14 days, not 7)", () => {
  const manifestAt = (asOf: string) =>
    buildSnapshot([row()], 1, dataset, new Date(asOf)).manifest;

  it("does not warn after a single missed weekly run", () => {
    // 8 days: one miss, or ordinary schedule jitter. A warning that fires here
    // stops being read.
    expect(isSnapshotStale(manifestAt("2026-08-18T12:00:00Z"), NOW)).toBe(false);
  });

  it("warns after two missed runs", () => {
    expect(isSnapshotStale(manifestAt("2026-08-12T12:00:00Z"), NOW)).toBe(true);
  });

  it("treats an unparseable asOf as maximally stale", () => {
    // Fail visible, not silent: a corrupt timestamp must not read as fresh.
    expect(
      isSnapshotStale({ ...manifestAt(NOW.toISOString()), asOf: "nonsense" }, NOW),
    ).toBe(true);
  });
});
