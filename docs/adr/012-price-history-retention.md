# ADR-012: How much price history do we keep, and where?

**Status:** proposed — **options only. The decision is the author's.**
**Date:** 2026-09-21

<!-- Roadmap rule 3: the author owns schema and product decisions; this file
     lays out what was measured and what each option costs. The Decision
     section is deliberately unwritten. -->

## Context

ADR-009 chose the weekly snapshot and closed with the sentence that produced
this file: "Backfilling price history means keeping ~102 MB rather than the
~3 MB a latest-price table needs, and that is a second decision the sync job's
shape will force." That decision is now the thing blocking real work —
`Drug.priceHistory` is non-null over `PriceSeriesResult` and resolves to
`Unavailable { retryable: false }` **permanently** until this lands (#50, #51).

`src/server/nadac/store.ts` says the same thing from the code side: ADR-009
chose the snapshot, not the storage engine, and `SnapshotStore` is the seam
left open for whatever answers this.

**Two questions, not one.** They are separable and the second only matters
for some answers to the first:

1. **How much history does a chart need?** A product question.
2. **What stores it?** An engineering question, constrained by (1) and by the
   deliverable line "Deployed app — 4 routes, no auth, **no database**".

### What is measured

From ADR-009 finding 5, plus a live re-measurement today
(`npm run rehearse:rollover`, 9/9, 2026-09-21):

| Quantity | Figure | Source |
| --- | --- | --- |
| Row as returned | 375 B | finding 5 |
| Row slimmed to `(ndc, perUnit, effectiveDate, unit)` | 99 B | finding 5 |
| Rows in the 2026 dataset, 2026-08-27 | 1,028,250 | finding 4 |
| Rows in the 2026 dataset, 2026-09-11 | 1,088,173 | finding 4 |
| **Rows in the 2026 dataset, 2026-09-21** | **1,118,109** | rehearsal check 9 |
| Distinct priced NDCs | 32,509 | real snapshot run |
| Latest-price-per-NDC table on disk | **3.9 MB** | real snapshot run |
| Full page-through of one yearly dataset | 5–19 min | finding 4, two runs |
| Yearly datasets published | **14** (2013–2026) | rehearsal check 3 |

**The ~102 MB figure understates the real cost, and that is the finding this
worksheet exists to surface.** 102 MB was one year, priced at the row count of
2026-08-27. Two corrections:

- The 2026 dataset is still filling. 1,118,109 rows at week 38 extrapolates to
  **~1.53 M rows ≈ ~151 MB slim** for a complete year.
- **One year is not "price history".** A chart with one partial year on it is a
  chart of 2026. Anything longer means paging *additional yearly datasets* —
  and there are 13 more of them, each its own 5–19 minute page-through, each
  its own ~150 MB. Full history is on the order of **1.5–2 GB slim and a
  multi-hour backfill**, not 102 MB.

So question 1 is not a detail to settle after the engine is picked. It is the
question that decides whether an engine is needed at all.

## Options considered — Q1: how much history

### Option A — none. `priceHistory` stays `Unavailable` and is removed.

- **For:** costs nothing, and the schema already states the absence honestly
  rather than lying with a null (#51). No storage layer, no backfill, the
  "no database" line holds without argument. The weekly snapshot stays the
  only job.
- **Against:** a drug-pricing site with no price trend is missing the thing
  that makes the data interesting. And a field that is permanently
  `Unavailable` is dead weight in the schema — if this is the answer, the
  honest follow-through is to *delete the field*, not leave it resolving to a
  stated absence forever.

### Option B — a rolling window of the current dataset (e.g. 52 weeks)

- **For:** falls out of the job that already runs. The weekly page-through
  reads every row anyway; keeping the last N effective dates per NDC instead
  of only the newest is a change to what the reducer retains, not a new job
  and not a backfill. At 34 weekly dates per NDC today, a 52-week window is
  roughly **32,509 × 52 × 99 B ≈ 167 MB slim** — bounded, and it never grows.
- **Against:** 167 MB is well past what the single JSON file in
  `createFileSnapshotStore` can carry, so it still forces Q2. A window that
  stops at the dataset-year boundary also has a discontinuity every January
  unless the job keeps last year's tail across the rollover.

### Option C — downsample: monthly aggregates, not weekly rows

- **For:** the smallest option that still draws a real chart. One row per NDC
  per month over 5 years is **32,509 × 60 ≈ 1.95 M rows**. At the 99 B slim row
  that is ~193 MB — but a monthly row does not need the 99 B shape: packed as
  `(ndc, month, perUnit)` with the NDC hoisted into a per-drug key, it is
  **~30 B, so ~60 MB**, and a 12-month window is **~12 MB**. Storing
  min/median/max instead of a single figure roughly doubles it. A price trend
  is what the chart is for, and weekly resolution is not what makes a trend
  legible.
- **Against:** it is a lossy derived artifact. Once stored, the weekly figure
  behind it is gone, and any later question ("what was this on 2026-04-15?")
  cannot be answered from our data — we would re-fetch upstream.
  Aggregation also needs a defensible rule: NADAC republishes corrections, so
  "the price in April" is not a single fact.

### Option D — full multi-year history, indexed

- **For:** the only option where `priceHistory` means what the field name says.
- **Against:** 1.5–2 GB, a multi-hour 14-dataset backfill, and it plainly
  requires a database — which contradicts the deliverable's "no auth, no
  database" line. That line is a scope commitment, not a technical one, so it
  is the author's to relax; but it should be relaxed on purpose and in
  writing, not by the storage layer quietly becoming Postgres.

## Options considered — Q2: what stores it

Only live if Q1 is B, C or D. Sketched, not weighed — the shape of Q1's answer
decides how much of this matters.

- **The existing JSON file** — works to roughly 10–20 MB before parse time and
  process memory become the problem, since `read()` parses the whole thing.
  Sufficient for Option C at monthly-single-price resolution. Nothing else.
- **SQLite / DuckDB as a build artifact** — a read-only file shipped with the
  deploy, rebuilt by the weekly job. Indexed, no server, arguably not "a
  database" in the sense the deliverable means. Constrained by whether W8's
  host gives the running app a filesystem it can read at that size.
- **Object storage + a range-addressable layout** (one blob per NDC prefix) —
  no engine at all, one fetch per drug page, works on any host.
- **A hosted Postgres** — the honest answer for Option D, and the one that
  spends the "no database" line.

**A constraint that is not yet written down anywhere:** `.data/nadac-snapshot.json`
lives on the local filesystem, which does not survive a serverless deploy and is
not shared between instances. Even at 3.9 MB, *today's* store has an unanswered
production question. ADR-001 already flags that cacheComponents narrows W8's
hosting options; this narrows them again, and the two should be decided
together.

## Decision

<!-- Author's. Not filled in by an agent. -->

## Consequences

<!-- Follows the decision. -->

## Revisit if

- Coverage rises materially above 8%, or community-submitted prices (issue #11)
  become a second source — either changes what a "price history" is a history
  *of*, and #11's figures are not NADAC's and must not share a series.
- NADAC's query API gains a real index, which would make a narrow
  history-on-demand fetch viable and moot most of Q2.
