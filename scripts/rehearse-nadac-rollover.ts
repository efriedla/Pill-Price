/**
 * NADAC annual-rollover rehearsal — ADR-009's "Committed to" clause.
 *
 * Usage: npm run rehearse:rollover
 *
 * ADR-009 commits to exercising the annual dataset-ID rollover path at least
 * once before January. `tests/nadac-snapshot.test.ts` covers the branching
 * against a captured fixture; this covers the part a fixture cannot, which is
 * the only part anyone doubts: **does the title-matching contract still hold
 * against the live metastore, and does what it resolves actually answer?**
 *
 * The fallback is the one path where a wrong assumption is invisible until
 * January, and it runs at most once a year — so the fixture proves the code
 * branches correctly while this proves the upstream still looks the way the
 * fixture says. Neither substitutes for the other.
 *
 * **It forces a real 404 rather than stubbing one.** The dead-pin rehearsal
 * rewrites the probe URL to a dataset ID that does not exist and lets CMS
 * answer, so the status code, the metastore payload, the title regex and the
 * resolved distribution are all the live article. A stub would test our belief
 * about the 404 instead of the 404.
 *
 * Costs six requests, one of them the 1.16 MB index. Not wired into CI: it
 * depends on a third party being up, and a weekly red build on someone else's
 * outage teaches people to ignore the build. Run it by hand — and **run it
 * again in January**, when check 7 stops being a formality and becomes the
 * thing that tells you to update the pin.
 */
import {
  NADAC_BASE_URL,
  NADAC_DATASET_ID,
  NADAC_DATASET_YEAR,
} from "../src/server/nadac/config";
import {
  datasetQueryUrl,
  resolveDataset,
  type FetchJson,
} from "../src/server/nadac/distribution";
import { resolveNadacDistribution } from "../src/server/upstream/nadac.schema";

const METASTORE_URL = `${NADAC_BASE_URL}/metastore/schemas/dataset/items?show-reference-ids=true`;

const fetchJson: FetchJson = async (url: string) => {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  return { ok: res.ok, status: res.status, json: () => res.json() };
};

/** A live fetch whose pinned-dataset probe is redirected at a dead ID. */
const withDeadPin =
  (dead: string): FetchJson =>
  (url) =>
    fetchJson(url.includes(NADAC_DATASET_ID) ? url.replace(NADAC_DATASET_ID, dead) : url);

let failures = 0;
let checks = 0;

function check(label: string, ok: boolean, detail: string) {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "✓" : "✗"} ${label}\n    ${detail}`);
}

/** UUID version nibble — v5 is derived, v4 is random (ADR-009 finding 6). */
const uuidVersion = (id: string) => id[14];

async function timed<T>(fn: () => Promise<T>): Promise<[T, string]> {
  const started = Date.now();
  const value = await fn();
  return [value, `${((Date.now() - started) / 1000).toFixed(2)}s`];
}

async function main() {
  const now = new Date();
  console.log(
    `NADAC rollover rehearsal — ${now.toISOString().slice(0, 10)}\n` +
      `pin: ${NADAC_DATASET_ID} (${NADAC_DATASET_YEAR})\n`,
  );

  // 1. The pin answers. Everything else is only interesting if it does.
  const [probe, probeTime] = await timed(() =>
    fetchJson(`${datasetQueryUrl(NADAC_DATASET_ID)}?limit=1`),
  );
  check(
    "the pinned dataset answers",
    probe.ok,
    `HTTP ${probe.status} in ${probeTime} — ADR-009 recorded 0.28s`,
  );

  // 2. The normal weekly path, live: pinned, and no index fetch.
  let metastoreCalls = 0;
  const counted: FetchJson = (url) => {
    if (url.includes("metastore")) metastoreCalls += 1;
    return fetchJson(url);
  };
  const resolved = await resolveDataset(counted, now);
  check(
    "the normal path stays off the metastore",
    resolved.source === "pinned" &&
      resolved.datasetId === NADAC_DATASET_ID &&
      metastoreCalls === 0 &&
      !resolved.alert,
    `source=${resolved.source} year=${resolved.year} metastore fetches=${metastoreCalls}` +
      (resolved.alert ? `\n    ⚠ ${resolved.alert}` : ""),
  );

  // 3. The live index, and the title contract the fallback depends on.
  const [index, indexTime] = await timed(() => fetchJson(METASTORE_URL));
  if (!index.ok) {
    check("the metastore index is reachable", false, `HTTP ${index.status}`);
    return;
  }
  const payload = (await index.json()) as { title: string; identifier: string }[];
  const yearly = payload
    .filter((item) => /^NADAC \(National Average Drug Acquisition Cost\) \d{4}$/.test(item.title))
    .map((item) => ({ year: Number(item.title.slice(-4)), id: item.identifier }))
    .sort((a, b) => a.year - b.year);

  check(
    "the yearly title pattern still matches the live index",
    yearly.length > 0,
    `${yearly.length} yearly NADAC datasets in ${payload.length} total, ` +
      `${yearly[0]?.year}–${yearly[yearly.length - 1]?.year}, fetched in ${indexTime}`,
  );

  // 4. The pin is the live index's idea of this year, not a drifted constant.
  const live = yearly.find((entry) => entry.year === NADAC_DATASET_YEAR);
  check(
    `the ${NADAC_DATASET_YEAR} dataset ID in config matches the live index`,
    live?.id === NADAC_DATASET_ID,
    live ? `live: ${live.id}` : `no ${NADAC_DATASET_YEAR} dataset in the index`,
  );

  // 5. Finding 6's UUID claim, re-checked: v5 through 2021, v4 from 2022.
  const wrongVersion = yearly.filter(
    (entry) => uuidVersion(entry.id) !== (entry.year >= 2022 ? "4" : "5"),
  );
  check(
    "identifiers are v5 through 2021 and v4 from 2022 (finding 6)",
    wrongVersion.length === 0,
    wrongVersion.length === 0
      ? yearly.map((e) => `${e.year}:v${uuidVersion(e.id)}`).join(" ")
      : wrongVersion.map((e) => `${e.year} is v${uuidVersion(e.id)}`).join(", "),
  );

  // 6. The premise the year check rests on: an old dataset ID does not die.
  //    If the oldest one still answers, the pinned one will too, and the 400
  //    the fallback was originally keyed to never arrives.
  const oldest = yearly[0];
  const stale = oldest
    ? await fetchJson(`${datasetQueryUrl(oldest.id)}?limit=1`)
    : null;
  check(
    "a years-old dataset ID still answers, so a dead pin is not the signal",
    stale?.ok === true,
    oldest
      ? `${oldest.year} dataset ${oldest.id} → HTTP ${stale?.status}`
      : "no yearly dataset to probe",
  );

  // 7. The January branch, against the live index: the pin is a year behind,
  //    and next year's dataset does not exist yet. Expected outcome is the
  //    pin, used unchanged and quietly. In January this check is what reports
  //    that the new dataset has appeared.
  const january = new Date(Date.UTC(NADAC_DATASET_YEAR + 1, 0, 6));
  const overtaken = await resolveDataset(fetchJson, january);
  const published = resolveNadacDistribution(payload, NADAC_DATASET_YEAR + 1);
  const newYearExists = (published?.year ?? 0) > NADAC_DATASET_YEAR;
  check(
    `the year-behind path, as it will run on ${january.toISOString().slice(0, 10)}`,
    newYearExists
      ? overtaken.source === "rediscovered" && Boolean(overtaken.alert)
      : overtaken.source === "pinned" && !overtaken.alert,
    newYearExists
      ? `the ${NADAC_DATASET_YEAR + 1} dataset EXISTS — update NADAC_DATASET_ID and NADAC_DATASET_YEAR\n    ${overtaken.alert ?? "no alert, which is a bug"}`
      : `no ${NADAC_DATASET_YEAR + 1} dataset published yet, so source=${overtaken.source} and no alert — correct, and nothing to act on`,
  );

  // 8. The dead-pin rollover, end to end, on a real 404. This is the path
  //    ADR-009 asked to see exercised, and the assertion that matters is the
  //    last one: what the fallback resolves has to be queryable, because the
  //    metastore hands back a *distribution* ID, not a dataset ID.
  const dead = NADAC_DATASET_ID.slice(0, -1) + (NADAC_DATASET_ID.endsWith("4") ? "5" : "4");
  const rediscovered = await resolveDataset(withDeadPin(dead), now);
  check(
    "a dead pin rediscovers through the live metastore",
    rediscovered.source === "rediscovered" && Boolean(rediscovered.alert),
    `resolved the ${rediscovered.year} distribution ${rediscovered.datasetId}`,
  );

  const query = await fetchJson(
    `${datasetQueryUrl(rediscovered.datasetId, rediscovered.index)}?limit=1&count=true`,
  );
  const body = query.ok
    ? ((await query.json()) as { count?: number; results?: Record<string, unknown>[] })
    : null;
  const first = body?.results?.[0];
  check(
    "what the fallback resolved is queryable and shaped like NADAC",
    query.ok &&
      typeof body?.count === "number" &&
      body.count > 0 &&
      first !== undefined &&
      "ndc" in first &&
      "nadac_per_unit" in first,
    query.ok
      ? `HTTP ${query.status}, ${body?.count?.toLocaleString()} rows, ` +
          `ndc=${String(first?.ndc)} per_unit=${String(first?.nadac_per_unit)} ` +
          `effective=${String(first?.effective_date)}`
      : `HTTP ${query.status} — the fallback resolved something unqueryable`,
  );

  console.log(
    `\n${checks - failures}/${checks} checks passed.` +
      (failures ? " The rollover path is NOT safe to rely on." : ""),
  );
  if (failures) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
