# ADR-012: How much price history do we keep, and where?

**Status:** accepted
**Date:** 2026-09-21 (options), 2026-09-21 (decided)

<!-- Roadmap rule 3: the author owns schema and product decisions. The options
     below were laid out for that decision; the Decision section records what
     was chosen. -->

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

### Correction, 2026-09-21: how much history one dataset actually holds

The options below were first written with the current dataset spanning
**2025-01-01 -> 2026-09-09**, read off the snapshot manifest's
`effectiveDateRange`. **That reading was wrong, and it mattered** — it made the
no-backfill window look like ~21 months.

`effectiveDateRange` is computed over `latestByNdc`, not over all rows
(`snapshot.ts`). So `earliest` does not mean "the oldest row in the dataset"; it
means "the oldest *most-recent* price of any NDC" — a package that stopped being
repriced in January 2025 and has carried the same figure since.

Measured directly against the live 2026 dataset instead, with filtered counts:

| Query | Rows |
| --- | --- |
| All rows | 1,118,109 |
| `effective_date = 2025-12-17` (one weekly batch) | 60,682 |
| `effective_date < 2025-12-17` | 15,387 |
| `effective_date < 2025-12-01` | 15,227 (oldest seen: 2025-01-22) |

And the same first-row probe on the two datasets before it: the 2025 dataset
starts **2024-12-18**, the 2024 dataset **2023-12-20**.

So **a yearly dataset holds ~12.5 months, not ~21**: a dense weekly series from
mid-December of the prior year, plus a sparse ~15,000-row tail of older dates —
1.4% of rows, late corrections and long-unchanged packages, not a series anyone
can chart.

The no-backfill window is therefore **the four quarters the current dataset
covers** (2025Q4 from 12-17, then 2026 Q1-Q3), not seven.

### Measured, not estimated: what a series actually encodes to

The per-option figures below were arithmetic on the 99 B slim row. Encoded for
real against the snapshot's 32,621 NDCs, with the bucket dates held once in the
manifest and each NDC carrying a bare price array:

| Series | On disk |
| --- | --- |
| Quarterly, 4 buckets (today's no-backfill window) | **1.6 MB** |
| Quarterly, 8 buckets | 2.8 MB |
| Quarterly, 12 buckets | 4.1 MB |
| Quarterly, 20 buckets (5 years) | 6.6 MB |
| Yearly, 14 buckets (all datasets) | 4.7 MB |
| Monthly, 60 buckets (5 years) | 19.2 MB |

Roughly **0.28 MB per quarter**. Labelling every point with its own date instead
of sharing one axis doubles all of it — measured, not assumed. **Where these
figures and the per-option arithmetic below disagree, these win**; the options are
kept as the record of what was weighed.

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

**Quarterly buckets, no backfill, accumulating forward, in the existing JSON
snapshot store.**

Four parts, each load-bearing:

1. **Quarterly, not monthly and not yearly.** Size is not the constraint —
   measured against the real 32,621-NDC snapshot, a quarterly series costs
   **1.6 MB at four quarters, 2.8 MB at eight, 6.6 MB at twenty**, against
   today's 3.9 MB latest-only file. Quarterly is the coarsest granularity that
   still shows a price *moving*; yearly over a window this short would be three
   or four points and would read as a trend we do not have the data to claim.

2. **No backfill.** The 13 older yearly datasets are not paged. The series is
   whatever the weekly job already reads, bucketed — so this adds no job, no
   multi-hour one-time cost, and no new failure mode at launch. The chart opens
   with **four quarters** and must not be framed as more.

3. **Accumulating forward.** Each weekly run merges its buckets into the stored
   series rather than replacing it, so depth grows a quarter at a time and
   passes eight quarters within a year — without ever paging an old dataset.
   This is what makes "no backfill" a starting position rather than a ceiling.

   **A closed quarter is immutable; only the open quarter is recomputed.** The
   stored series stops being purely derived from the current dataset the moment
   it accumulates, which means it can carry forward a mistake — so: a run with
   `complete: false` writes nothing (it already must not serve, per ADR-009), and
   a closed bucket is never rewritten by a later run. Rebuilding the series from
   scratch is then a deliberate act, not a side effect of a bad week.

4. **The existing `SnapshotStore`, unchanged.** At 1.6-2.8 MB the single JSON
   file carries this, so **Q2 does not open** and no database is added — the
   deliverable's "no auth, no database" line holds. The engine question returns
   only past ~20 MB, which is monthly-over-five-years or
   quarterly-over-all-fourteen-years.

**The bucket's value is the last published price in that quarter** — an actual
NADAC figure with a real `effective_date`, not a computed one. Two reasons, and
the second is the stronger: a median or mean over an even number of weeks
requires arithmetic on money, and money here is a decimal string precisely
because float arithmetic rounds it wrong; and every point on the chart stays a
thing NADAC published on a date we can name, which is the same standard the rest
of this app holds itself to about stating facts rather than deriving them.

**Gaps stay gaps.** An NDC with no publication in a quarter has no point for
that quarter — not zero, and not the previous quarter's price carried forward.
`PriceSeries` must therefore allow a sparse series, and the ~15,000-row
pre-window tail is dropped rather than charted.

## Consequences

**Easier.** `Drug.priceHistory` stops being permanently `Unavailable` and starts
resolving to real data without any new infrastructure, any backfill, or any
change below `SnapshotStore`. The reducer in `snapshot.ts` gains a second output
alongside `latestByNdc`; nothing else in the job changes. Depth improves on its
own with every weekly run.

**Harder.** The snapshot becomes **accumulated state rather than a pure
derivation**, which is a genuinely different thing to reason about: it can drift,
and the immutability rule above is the only thing preventing a bad run from
becoming permanent. That rule needs a test, not just a sentence here. The
snapshot file also roughly doubles, which is still well inside the JSON store but
worth watching against the ~20 MB ceiling as the series accumulates — **at
0.28 MB per quarter, that ceiling is roughly 14 years away**, so it is a note,
not a risk. *(Superseded — the shipped shape costs ~0.88 MB per quarter and
reaches the ceiling in about five years. See the amendment below; the sentence
is kept as written because it is what was decided on.)*

**Committed to.** A four-quarter chart at launch, stated as such in the UI rather
than presented as "price history" without qualification. And the pre-window tail
is *not* history: 1.4% of rows scattered over the prior year cannot be charted,
and reading `effectiveDateRange` as a span is the mistake the correction above
records.

**Still open, deliberately.** Where the snapshot file lives in production. That
is unchanged by this decision — the local-filesystem problem is the same at
1.6 MB as at 3.9 MB — and it belongs with ADR-001's hosting constraint, not
here.

## Amendment, 2026-09-22: the headroom is five years, not fourteen

**Status:** proposed — the correction is measured; the choice it forces is the
author's. Decision section below is deliberately empty.

Code-free per the amendment rule: the measurement rode with #62, but what to do
about it changes a consequence this ADR committed to, and accepting a fix and
accepting a change of mind should not be the same click.

### What the measurement says

The **0.28 MB per quarter** above was measured on a shape holding *only prices*
— one bare array per NDC against a shared axis. But this ADR also commits, in
the Decision, to every point being "a thing NADAC published on a date we can
name", and `PricePoint.observations` is in the SDL. The shape that carries both
is what #62 shipped, and it costs more than the ADR priced.

Measured with the shipped encoder against the real 32,621-NDC snapshot, dense
(every NDC in every quarter), so an upper bound in every row:

| Stored shape | 4q | 8q | 12q | 20q | Marginal | ~20 MB reached |
| --- | --- | --- | --- | --- | --- | --- |
| Named-field objects, all three fields | 12.6 | 24.0 | 35.4 | 58.1 | ~2.8 MB/q | ~2 years |
| **Tuples: price + date + observations (shipped)** | **4.8** | **8.4** | **11.9** | **19.0** | **~0.88 MB/q** | **~5 years** |
| Tuples: price + date | 4.6 | 7.8 | 11.1 | 17.7 | ~0.82 MB/q | ~5.5 years |
| Tuples: price + observations | 3.1 | 5.0 | 6.8 | 10.5 | ~0.46 MB/q | ~10 years |
| Price only (the shape measured above) | 2.6 | 3.9 | 5.2 | 7.9 | ~0.33 MB/q | ~14 years |

Three things fall out of that table, and the third is the one that matters:

1. **The original 14-year figure was arithmetically right and structurally
   wrong.** It is exactly what the bottom row still measures. It priced a shape
   that does not carry this ADR's own commitments.
2. **The positional tuple encoding is what keeps this inside the JSON store at
   all** — 4.8 MB against 12.6 MB for the same data as named-field objects,
   because the keys outweigh the values roughly two to one. Without it the
   ceiling is two years, not five, and Q2 reopens almost immediately.
3. **The per-point `effectiveDate` is nearly the whole remaining cost.**
   Dropping `observations` buys about six months; dropping the date roughly
   doubles the headroom. The expensive field is the one the Decision names.

Caveats, so the figures are not read as more precise than they are:
`observations` was encoded as a single digit (real counts run 1-13, so two
digits late in a quarter); the rows are dense, which no real quarter is; and
"~20 MB" is itself a soft working ceiling from Q2, not a measured parse-time
cliff.

### Options considered

**Option A — change nothing; correct the number and keep the shape.** Five years
of headroom, and the ceiling arrives a quarter at a time with plenty of warning.
*For:* the shape carries exactly what the Decision committed to, and five years
is still far past launch for a project whose hosting question is itself still
open. *Against:* the ADR's "it is a note, not a risk" was written about 14
years; at five it is closer to a dated commitment than a note, and the accumulation
is deliberately one-way.

**Option B — drop `observations` from the stored point.** Recompute nothing; the
field leaves the store and the SDL field is either removed or resolves to an
absence. *For:* it is the cheapest field to defend losing — a count of
publications in a quarter is context, not the figure. *Against:* it buys about
six months, which is not worth an SDL change, and `observations` is what tells a
reader whether a quarter's price is one publication or thirteen.

**Option C — drop the per-point `effectiveDate` and label points by bucket.**
Roughly doubles the headroom to ~10 years. *For:* it is the only field-level
change that materially moves the number. *Against:* it contradicts the Decision
directly — the bucket label is ours, NADAC's date is theirs, and without the date
the chart's points stop being things anyone published. It also removes the
distinction this ADR leaned on when it refused to average weeks.

**Option D — keep the shape, cap the depth.** A rolling window — say 20 quarters
— dropping the oldest bucket as a new one closes, so the store reaches a steady
state under the ceiling and stays there. *For:* it bounds the file permanently
without giving up a field, and five years of quarterly history is already more
than "no backfill" promised. *Against:* it makes the accumulation lossy, which
is a second way for the store to stop being derivable; it needs its own
immutability argument; and it would discard history the job paid for.

**Option E — accept that Q2 reopens on a date.** Keep everything, and treat "the
engine question returns past ~20 MB" as scheduled for ~2031 rather than ~2040.
*For:* it is the honest reading of the Decision's own part 4, which already
names the ceiling as the trigger. *Against:* it defers a decision this amendment
exists to surface, and the hosting question (still open) is entangled with it.

### Decision

<!-- Yours. -->

### Consequences

<!-- Written once the decision is made. -->

## Revisit if

- Coverage rises materially above 8%, or community-submitted prices (issue #11)
  become a second source — either changes what a "price history" is a history
  *of*, and #11's figures are not NADAC's and must not share a series.
- NADAC's query API gains a real index, which would make a narrow
  history-on-demand fetch viable and moot most of Q2.
- **The accumulated series and a fresh rebuild disagree.** That is the signal the
  immutability rule has a hole in it, and it is worth checking deliberately once
  rather than waiting for someone to notice a wrong chart.
- **Users ask for depth the accumulation cannot reach yet.** Backfilling older
  yearly datasets stays available at ~5-19 minutes each and ~0.88 MB per
  quarter in the shipped shape (see the amendment); it was declined as launch
  scope, not ruled out. Backfill and accumulation draw on the same headroom,
  so a backfill now costs years off the ceiling rather than months.
