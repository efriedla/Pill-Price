# ADR-016: Where the app runs, and where the NADAC snapshot lives

**Status:** accepted
**Date:** 2026-09-25 (options and decision)

<!-- Roadmap rule 3: the author owns this. Options in #89, decision here.
     Same shape as ADR-012, ADR-013 and ADR-015. -->

## Context

ADR-013 says W3 ships **deployed**, and nothing is deployed. Two questions
have been left open on purpose until now:

- **The host.** ADR-001 committed to "a host that supports streaming and cache
  coordination" and gave up a static export. ADR-005 added `cacheComponents`,
  `partialPrefetching` and one prerendered page (`/drug/860975`); everything
  else is an App Shell upgraded on first visit.
- **Where the snapshot lives.** ADR-005: "Not decided here. Where the app is
  hosted, and so where the NADAC snapshot file lives in production (ADR-012
  left this open). The first deploy needs it answered."

### What the snapshot is, measured 2026-09-25

- One JSON file, `.data/nadac-snapshot.json`, gitignored. **4.1 MB** raw,
  **0.31 MB** gzipped (the 09-11 local copy, before ADR-012's series).
- Written by `npm run snapshot:nadac`, a weekly job (ADR-009) that takes
  **5 to 19 minutes** (ADR-009 finding 4: plan against the 19).
- **It accumulates.** ADR-012 is read-merge-write: each run folds the new week
  into the quarterly series already in the file, with **no backfill**. So
  production needs state that survives from one run to the next, and **losing
  the file loses history that cannot be rebuilt.** ADR-012 put the ceiling at
  ~0.88 MB per quarter, about five years to the ~20 MB JSON limit.
- Read by `loadPriceIndex`, memoised **per process**. A new snapshot needs a
  new process (a redeploy or a restart) to be seen.
- `REQUIRE_NADAC_SNAPSHOT=1` makes a build fail without it (ADR-010
  amendment), so a deploy can never prerender "couldn't load price data".

So Q2 is not a detail of Q1. The accumulating file is the only state this app
has, and it cannot be regenerated.

## Q1 — Where does the app run?

### Option A — Vercel

- **For:** the framework's own platform, so `cacheComponents`, `use cache`,
  partial prerendering and `partialPrefetching` are its default path rather
  than something to configure. Preview deploys per PR, which suits the
  review-heavy history here. A redeploy is also the restart `loadPriceIndex`
  needs. Free for a non-commercial project.
- **Against:** functions have no persistent disk, so the snapshot has to
  arrive with each build (or be fetched from storage), and a runtime `readFile`
  needs `outputFileTracingIncludes` so the file is bundled with the functions
  that read it. The cache runs on Vercel's infrastructure, so the W6 case
  study measures a platform we do not control. **To check before deciding:**
  the Hobby plan's current terms and limits (build minutes, function size).

### Option B — A Node server with a persistent volume (Fly.io, Railway, Render)

- **For:** `next start`, the same process `npm run build && next start`
  already measures locally, so W6's numbers would describe this exact setup.
  The weekly job can run on the same machine against the volume, which is
  ADR-009 as written, and the file store stays unchanged.
- **Against:** we operate it: health checks, restarts after each snapshot,
  one region, a few dollars a month. `use cache`'s default handler is
  in-memory per instance, which is fine for one instance and wrong for two.
  And the history's only copy is a volume, whose backups become our job.

### Option C — Static export

Ruled out by ADR-001, and by every streamed boundary since. Listed so the
rejection is visible.

## Q2 — Where does the snapshot live, and who runs the job?

### Option A — Git: a weekly GitHub Actions job commits it to a `data` branch

The job runs on a cron, reads the previous snapshot from the `data` branch,
merges the new week (ADR-012), and commits. The build fetches the file from
that branch (the repo is public, so a raw URL works without credentials),
and a deploy hook redeploys.

- **For:** the most durable copy of unrecoverable history is also free and
  already backed up. Every week's snapshot is a diffable, dated commit, which
  is provenance at no cost, in a project whose deliverable is process
  evidence. No storage service, no credentials. Works with either host.
- **Against:** git history grows by about the compressed size per week,
  ~0.3 to 1 MB: roughly 16 to 50 MB a year before delta compression.
  Tolerable, not free. A job that runs 19 minutes fits inside GitHub Actions'
  limits, but it is a third-party schedule we cannot see fail unless it
  reports. Also, `main` is protected, which is why the branch is separate.

### Option B — Object storage (Vercel Blob, S3, R2)

The same job, reading from and writing to a bucket; the build downloads it.

- **For:** no git growth. Blob storage is the conventional place for a build
  artifact that outlives builds.
- **Against:** a new service, a secret in CI and in the host, and a second
  `SnapshotStore` implementation. History is overwritten each week unless
  versioning is turned on, so provenance has to be built rather than being
  a side effect.

### Option C — The host's volume (only with Q1 B)

The job runs on the server, against its own disk.

- **For:** no moving parts beyond the server itself.
- **Against:** the single copy of history lives in one volume. A lost volume,
  or a migration done carelessly, is permanent data loss, the one failure
  ADR-012's no-backfill decision cannot absorb.

## My recommendation (taken)

**Q1 A with Q2 A.** Vercel runs the rendering model this repo was built
around, as its default, and preview deploys suit the PR-per-decision
history. Git is the only option that makes the unrecoverable file durable and
auditable at the same time, and it costs a few tens of MB a year. The cost I
would be accepting: W6 measures Vercel's cache rather than a process I run.

## Decision

**Q1 A, Q2 A: Vercel, and the snapshot in git on a `data` branch.** Decided
2026-09-25 by the author, in these words: "go with vercel and the data
branch".

1. **The weekly job runs in GitHub Actions**
   (`.github/workflows/snapshot-nadac.yml`), Fridays 09:00 UTC and on demand.
   It restores last week's file from `data`, runs `snapshot:nadac`
   (read-merge-write, ADR-012), and commits the result to `data` as one dated
   commit. `data` holds only `nadac-snapshot.json` and is never force-pushed:
   its history is the only copy of the price series.
2. **A new commit redeploys** through a Vercel deploy hook, stored as the
   `VERCEL_DEPLOY_HOOK_URL` secret. The redeploy is also the restart
   `loadPriceIndex` needs.
3. **The deploy build fetches the snapshot first.** `vercel.json` sets the
   build command to `npm run build:deploy`, which downloads the file from
   `NADAC_SNAPSHOT_URL` (the raw URL of `data`) and refuses one that is
   missing, malformed or marked incomplete. `REQUIRE_NADAC_SNAPSHOT=1` stays
   set in the deploy as the second guard.
4. **Every server function carries the file.** `outputFileTracingIncludes`
   names it for `/drug/[rxcui]`, `/search` and `/api/graphql`, since every
   page query loads the price index.

### Rejected

- **Q1 B (a Node server with a volume):** W6 would measure a process we run,
  which is its real advantage. But it makes us the operator, and it puts the
  only copy of the history on one disk unless Q2 is also git.
- **Q2 B (object storage):** a new service and secret for a file that git
  keeps durable and dated for free.
- **Q2 C (the host's volume):** the single-copy risk ADR-012's no-backfill
  decision cannot absorb.

## What any answer forces

- `REQUIRE_NADAC_SNAPSHOT=1` in the deploy build, and
  `npm run check:build-degradation` before the first deploy (ADR-005).
- A weekly job that fails loudly: whatever runs it must report a failed run,
  or a snapshot can silently stop updating while `asOf` keeps saying when it
  last succeeded.
- The January rollover rehearsal (`npm run rehearse:rollover`) runs against
  whatever schedules the job.
- Lighthouse (W3's last box) waits for the deploy, so the "before" for W6 is
  measured where users are.

## Revisit if

- The snapshot outgrows ADR-012's ~20 MB ceiling (a storage-engine decision).
- A second instance is ever needed (in-memory `use cache` stops being enough).
