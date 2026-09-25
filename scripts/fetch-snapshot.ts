/**
 * Fetch the NADAC snapshot for a deploy build — ADR-016.
 *
 * Usage: NADAC_SNAPSHOT_URL=<raw url> npm run fetch:snapshot
 *
 * The weekly job (`.github/workflows/snapshot-nadac.yml`) commits the snapshot
 * to the `data` branch. A Vercel build starts from `main`, which has no
 * snapshot (`.data/` is gitignored), so this downloads it to the path the
 * resolvers read, before `next build` runs. The repo is public, so the raw
 * URL needs no credentials.
 *
 * Refuses anything it cannot vouch for, and exits non-zero: a build that
 * went ahead without a snapshot would prerender "couldn't load price data",
 * and `REQUIRE_NADAC_SNAPSHOT=1` exists to stop exactly that. A snapshot the
 * job marked incomplete is refused for the reason the job refuses to write
 * one: a partial price table reads as drugs having no published price.
 */
import type { Snapshot } from "../src/server/nadac/snapshot";
import {
  createFileSnapshotStore,
  DEFAULT_SNAPSHOT_PATH,
} from "../src/server/nadac/store";

async function main() {
  const url = process.env.NADAC_SNAPSHOT_URL;
  if (!url) {
    throw new Error(
      "NADAC_SNAPSHOT_URL is not set. A deploy build needs the snapshot the weekly job commits to the data branch (ADR-016).",
    );
  }

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Fetching the snapshot failed: HTTP ${res.status} from ${url}`,
    );
  }
  const snapshot = (await res.json()) as Snapshot;

  if (!snapshot?.manifest || !Array.isArray(snapshot.latestByNdc)) {
    throw new Error(
      `${url} is not a NADAC snapshot: no manifest or price table.`,
    );
  }
  if (!snapshot.manifest.complete) {
    throw new Error(
      `The snapshot at ${url} is marked incomplete (${snapshot.manifest.rowsFetched} of ${snapshot.manifest.rowsReported} rows). Refusing to build on it.`,
    );
  }

  await createFileSnapshotStore().write(snapshot);

  const { asOf, pricedNdcs, datasetYear } = snapshot.manifest;
  const quarters = snapshot.quarterlySeries?.quarters.length ?? 0;
  console.log(
    `snapshot: ${pricedNdcs.toLocaleString()} priced NDCs, dataset ${datasetYear}, ` +
      `as of ${asOf}, ${quarters} quarter(s) of history → ${DEFAULT_SNAPSHOT_PATH}`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
