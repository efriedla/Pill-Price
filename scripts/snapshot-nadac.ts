/**
 * Weekly NADAC snapshot job — ADR-009.
 *
 * Usage: npm run snapshot:nadac
 *
 * Pages the whole NADAC dataset, reduces it to the current price per NDC, and
 * writes it where resolvers can read it locally. **Takes ~19 minutes**: ~205
 * unfiltered requests, measured at 1,149 s for 1,028,250 rows. It issues no
 * filtered query, because filtering is what costs 2.7 s per call.
 *
 * Exits non-zero on anything that would produce a partial or misattributed
 * snapshot. A stale snapshot is recoverable; a wrong one is not.
 */
import { resolveDataset } from "../src/server/nadac/distribution";
import { buildSnapshot, fetchAllRows } from "../src/server/nadac/snapshot";
import { createFileSnapshotStore } from "../src/server/nadac/store";

const fetchJson = async (url: string) => {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  return { ok: res.ok, status: res.status, json: () => res.json() };
};

async function main() {
  const now = new Date();
  const started = Date.now();

  const dataset = await resolveDataset(fetchJson, now);
  console.log(
    `dataset ${dataset.datasetId} (${dataset.year}, ${dataset.source})`,
  );
  if (dataset.alert) console.warn(`\n⚠ ${dataset.alert}\n`);

  let lastLogged = 0;
  const { rows, reported } = await fetchAllRows(
    fetchJson,
    dataset,
    (fetched, total) => {
      if (fetched - lastLogged < 50_000) return;
      lastLogged = fetched;
      console.log(`  ${fetched.toLocaleString()} / ${total.toLocaleString()}`);
    },
  );

  const snapshot = buildSnapshot(rows, reported, dataset, now);
  const { manifest } = snapshot;

  if (!manifest.complete) {
    throw new Error(
      `Incomplete: fetched ${manifest.rowsFetched} of ${manifest.rowsReported} rows. Refusing to write — a partial price table is indistinguishable from drugs having no published price.`,
    );
  }

  await createFileSnapshotStore().write(snapshot);

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `\nwrote ${manifest.pricedNdcs.toLocaleString()} priced NDCs from ` +
      `${manifest.rowsFetched.toLocaleString()} rows in ${elapsed}s`,
  );
  if (manifest.effectiveDateRange) {
    const { earliest, latest } = manifest.effectiveDateRange;
    console.log(`effective dates ${earliest} … ${latest}`);
  }
  // The pin being stale is the one outcome that needs a human, so it is the
  // last thing printed as well as the first.
  if (dataset.alert) console.warn(`\n⚠ ${dataset.alert}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
