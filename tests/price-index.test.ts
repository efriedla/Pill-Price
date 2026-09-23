import { describe, expect, it } from "vitest";

import type { PriceEntry, Snapshot } from "@/server/nadac/snapshot";
import {
  buildPriceIndex,
  IncompleteSnapshotError,
  MissingSnapshotError,
  requireNadacSnapshot,
  type PriceIndex,
} from "@/server/prices";

/**
 * The read side of ADR-009: the local index resolvers meet instead of calling
 * `data.medicaid.gov` on a request.
 *
 * Two invariants are load-bearing enough to be asserted rather than assumed:
 * an incomplete snapshot must be refused outright, and `forNdc` and `coverage`
 * must never disagree about which packages are priced — a page that renders two
 * prices while claiming three are published is worse than one that renders
 * none.
 */

const entry = (over: Partial<PriceEntry> = {}): PriceEntry => ({
  ndc: "29300038901",
  perUnit: "0.02982",
  effectiveDate: "2025-12-17",
  unit: "EA",
  description: "METFORMIN HCL ER 500 MG TABLET",
  ...over,
});

const snapshot = (
  latestByNdc: PriceEntry[],
  over: Partial<Snapshot["manifest"]> = {},
): Snapshot => ({
  manifest: {
    asOf: "2026-09-14T03:00:00Z",
    datasetId: "fbb83258-11c7-47f5-8b18-5f8e79f7e704",
    datasetYear: 2026,
    datasetSource: "pinned",
    rowsReported: 10,
    rowsFetched: 10,
    pricedNdcs: latestByNdc.length,
    effectiveDateRange: { earliest: "2025-12-17", latest: "2026-03-18" },
    complete: true,
    ...over,
  },
  latestByNdc,
});

describe("buildPriceIndex", () => {
  it("refuses an incomplete snapshot rather than serving a partial table", () => {
    // A partial table is indistinguishable from "no published price", which is
    // the one confusion the whole snapshot design exists to prevent.
    expect(() =>
      buildPriceIndex(
        snapshot([entry()], { complete: false, rowsFetched: 4, rowsReported: 10 }),
      ),
    ).toThrow(IncompleteSnapshotError);
  });

  it("resolves a price with its unit and the snapshot's asOf", () => {
    const index = buildPriceIndex(snapshot([entry()]));
    expect(index.forNdc("29300038901")).toEqual({
      pricePerUnit: "0.02982",
      effectiveDate: "2025-12-17",
      asOf: "2026-09-14T03:00:00Z",
      unit: "EA",
    });
  });

  it("returns null for an NDC NADAC does not publish", () => {
    const index = buildPriceIndex(snapshot([entry()]));
    expect(index.forNdc("00000000000")).toBeNull();
  });

  it("counts the priced packages against the total asked about", () => {
    const index = buildPriceIndex(
      snapshot([entry(), entry({ ndc: "00093721410" })]),
    );
    expect(index.coverage(["29300038901", "00093721410", "00000000000"])).toEqual({
      pricedPackages: 2,
      totalPackages: 3,
    });
  });
});

describe("a price with no unit", () => {
  // `Price.unit` is `String!` and ui-spec §9 renders every price with its unit,
  // so a figure whose unit is unknown is not a price this app may state. NADAC
  // types the column absentable, so this is reachable even though 2500 sampled
  // rows all carried one.
  const index = () =>
    buildPriceIndex(
      snapshot([entry(), entry({ ndc: "00093721410", unit: null })]),
    );

  it("is absent rather than a price with a blank unit", () => {
    expect(index().forNdc("00093721410")).toBeNull();
  });

  it("does not count toward coverage", () => {
    // The regression this guards: were the unit checked inside `forNdc`,
    // coverage would still count the entry and the page would claim two
    // published prices while rendering one.
    expect(index().coverage(["29300038901", "00093721410"])).toEqual({
      pricedPackages: 1,
      totalPackages: 2,
    });
  });

  it("leaves other packages untouched", () => {
    expect(index().forNdc("29300038901")?.unit).toBe("EA");
  });
});

describe("requireNadacSnapshot, the deploy-build guard", () => {
  // ADR-010 amendment, 2026-09-23: only deploy builds fail without prices. A
  // PR build prerenders the honest Unavailable state, because the snapshot
  // job takes ~19 minutes and build is a required check.
  const none = async () => null;
  const some = async () => ({ asOf: "2026-09-14T03:00:00Z" }) as PriceIndex;

  it("fails a deploy build that has no snapshot", async () => {
    await expect(
      requireNadacSnapshot({ REQUIRE_NADAC_SNAPSHOT: "1" }, none),
    ).rejects.toBeInstanceOf(MissingSnapshotError);
  });

  it("passes a deploy build that has one", async () => {
    await expect(
      requireNadacSnapshot({ REQUIRE_NADAC_SNAPSHOT: "1" }, some),
    ).resolves.toBeUndefined();
  });

  it("does not load anything when the variable is unset", async () => {
    let loaded = false;
    await requireNadacSnapshot({}, async () => {
      loaded = true;
      return null;
    });
    expect(loaded).toBe(false);
  });

  it("treats any value but 1 as unset, so a stray 'false' cannot arm it", async () => {
    await expect(
      requireNadacSnapshot({ REQUIRE_NADAC_SNAPSHOT: "false" }, none),
    ).resolves.toBeUndefined();
  });
});
