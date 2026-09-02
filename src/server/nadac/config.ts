import "server-only";

/**
 * NADAC snapshot configuration — ADR-009.
 *
 * The dataset identifier is **pinned here rather than resolved on every run.**
 * That is the ADR's decision, and it rests on a measured distinction:
 *
 * - The **distribution** identifier rotates *weekly, by design*. NADAC
 *   republishes the whole CSV under a new filename, DKAN registers a new source
 *   version, and the distribution ID is derived from `file + version` — it is a
 *   **UUIDv5**, so a republish *must* mint a new one. Pinning one would break
 *   within a week, and observed rotations bear that out: `b391aa55…` (08-23),
 *   `16fd6484…` (08-27), `eb5b20dc…` (09-02), each predecessor now HTTP 400.
 * - The **dataset** identifier is per calendar year, and is a **UUIDv4** —
 *   random, assigned once, with nothing to re-derive it from on republish.
 *   Querying `datastore/query/{datasetId}/{index}` makes CMS resolve the
 *   distribution server-side, so the weekly rotation stops being our problem.
 *
 * ADR-009 finding 6 originally flagged dataset-ID stability as *inferred, not
 * proven*. It is now measured (correction of 2026-09-02): the metastore lists
 * one NADAC dataset per year for 2013–2026, every identifier unchanged — the
 * 2013–2021 datasets still carry the IDs they had when last modified in 2021 —
 * across three distribution rotations in ten days.
 *
 * The fallback below is still what handles the case this pinning cannot cover:
 * the **annual rollover**, when the next year's dataset is minted with a new v4
 * ID. On a 400/404 the job re-resolves by title, pins, and alerts, so a wrong
 * assumption surfaces as an alert rather than as bad data.
 */

/** 2026. Verified live 2026-08-26 (1,028,250 rows) and again 2026-09-02. */
export const NADAC_DATASET_ID = "fbb83258-11c7-47f5-8b18-5f8e79f7e704";

/** The year `NADAC_DATASET_ID` refers to, so a rollover is detectable. */
export const NADAC_DATASET_YEAR = 2026;

/** Distribution index within the dataset. NADAC publishes exactly one. */
export const NADAC_DISTRIBUTION_INDEX = 0;

export const NADAC_BASE_URL = "https://data.medicaid.gov/api/1";

/**
 * Rows per page. Measured 2026-08-26: 5,000 returns in 0.68 s at offset 0 and
 * 1.85 s at offset 1,000,000. `upstream-notes.md` §3.4 recorded 500 as the page
 * size; that was the default, not the cap.
 */
export const PAGE_SIZE = 5_000;

/**
 * Staleness threshold in days — ADR-009.
 *
 * Fourteen, not seven: the job runs weekly, so a single missed run is
 * indistinguishable from schedule jitter or a one-off retry, and a warning that
 * fires on jitter stops being read. Two consecutive misses is unambiguous.
 */
export const STALE_AFTER_DAYS = 14;
