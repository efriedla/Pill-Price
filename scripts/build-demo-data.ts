/**
 * Freezes real answers from the real BFF into `demo/data.json`, for the static
 * demo on GitHub Pages (`demo/`). The app itself cannot run on Pages: it needs a
 * server (ADR-013 close-out). This runs the app's own four operations
 * (`src/features/** /*.graphql`) against `/api/graphql` on a local production
 * build and saves what comes back. Nothing is invented: every price, name and
 * label sentence is what the app would have shown on the day this ran.
 *
 * Usage: npm run build:deploy (with NADAC_SNAPSHOT_URL set), then
 *        npm run demo:data
 *
 * The drug set: for each search term below, the first few results, plus every
 * brand and generic version of those (one level). Label sections are trimmed
 * to keep the file small; the demo links to DailyMed for the full label.
 */
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const PORT = 3462;
const API = `http://127.0.0.1:${PORT}/api/graphql`;

const TERMS = [
  "atorvastatin", "metformin", "lisinopril", "amlodipine", "levothyroxine",
  "omeprazole", "sertraline", "losartan", "gabapentin", "albuterol",
  "amoxicillin", "escitalopram", "rosuvastatin", "montelukast", "semaglutide",
];
const PER_TERM = 3;
const MAX_SECTIONS = 4;
const MAX_CHARS = 1_400;

const op = (file: string) => readFileSync(path.join(root, "src/features", file), "utf8");
const OPS = {
  search: op("search/DrugSearch.graphql"),
  header: op("drug/DrugHeader.graphql"),
  versions: op("drug/DrugVersions.graphql"),
  label: op("drug/DrugLabel.graphql"),
};

async function gql<T>(query: string, variables: Record<string, string>): Promise<T> {
  const res = await fetch(API, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await res.json()) as { data?: T; errors?: unknown };
  if (!body.data) throw new Error(`GraphQL error: ${JSON.stringify(body.errors)}`);
  return body.data;
}

/** A transient upstream failure can null a whole drug; ask again before giving up. */
async function retry<T>(call: () => Promise<T>, ok: (r: T) => boolean, tries = 3): Promise<T> {
  let last = await call();
  for (let i = 1; i < tries && !ok(last); i++) {
    await new Promise((r) => setTimeout(r, 1_000 * i));
    last = await call();
  }
  return last;
}

type SearchHit = { rxcui: string; name: string; isGeneric: boolean };
type Drug = Record<string, unknown> & { rxcui: string; name: string };

/** Plain single-ingredient tablets and capsules first: they read best in a demo. */
function rank(hit: SearchHit): number {
  const n = hit.name.toLowerCase();
  return (n.includes("/") ? 2 : 0) + (/extended|delayed|24 hr|12 hr/.test(n) ? 1 : 0);
}

function trimLabel(label: Record<string, unknown>) {
  if (label.__typename !== "Label") return label;
  const sections = (label.sections as { kind: string; paragraphs: string[] }[])
    .slice(0, MAX_SECTIONS)
    .map((s) => {
      const text = s.paragraphs.join(" ");
      return {
        kind: s.kind,
        paragraphs: [text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS).replace(/\s+\S*$/, "")} …` : text],
        trimmed: text.length > MAX_CHARS,
      };
    });
  return { ...label, sections };
}

async function main() {
  const server = spawn("npx", ["next", "start", "-p", String(PORT)], { cwd: root, stdio: "ignore", detached: true });
  try {
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(`http://127.0.0.1:${PORT}`)).ok) break;
      } catch {
        // not up yet
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    const searches: Record<string, SearchHit[]> = {};
    const wanted = new Set<string>();
    for (const term of TERMS) {
      const { search } = await gql<{ search: SearchHit[] }>(OPS.search, { term });
      searches[term] = search;
      [...search].sort((a, b) => rank(a) - rank(b)).slice(0, PER_TERM).forEach((h) => wanted.add(h.rxcui));
      process.stdout.write(`search ${term}: ${search.length}\n`);
    }

    const drugs: Record<string, Drug> = {};
    const fetchDrug = async (rxcui: string) => {
      if (drugs[rxcui]) return drugs[rxcui];
      const h = await gql<{ drug: Drug | null }>(OPS.header, { rxcui });
      if (!h.drug) return null;
      const v = await retry(() => gql<{ drug: Record<string, unknown> | null }>(OPS.versions, { rxcui }), (r) => r.drug !== null);
      const l = await retry(() => gql<{ drug: { label: Record<string, unknown> } | null }>(OPS.label, { rxcui }), (r) => r.drug !== null);
      if (!v.drug || !l.drug) throw new Error(`no versions or label for ${rxcui} after retries`);
      drugs[rxcui] = { ...h.drug, ...v.drug, label: trimLabel(l.drug.label) };
      process.stdout.write(`  drug ${rxcui} ${h.drug.name}\n`);
      return drugs[rxcui];
    };

    for (const rxcui of wanted) {
      const d = await fetchDrug(rxcui);
      const alts = (d?.alternatives as { __typename: string; drugs?: { rxcui: string }[] } | undefined)?.drugs ?? [];
      for (const a of alts) await fetchDrug(a.rxcui);
    }

    const asOf = Object.values(drugs)
      .map((d) => (d.price as { asOf?: string }).asOf)
      .find(Boolean);
    const out = {
      generatedAt: new Date().toISOString().slice(0, 10),
      snapshotAsOf: asOf ?? null,
      terms: TERMS,
      searches,
      drugs,
    };
    writeFileSync(path.join(root, "demo/data.json"), JSON.stringify(out));
    process.stdout.write(`\n${Object.keys(drugs).length} drugs, snapshot as of ${asOf}\n`);
  } finally {
    if (server.pid) process.kill(-server.pid, "SIGTERM");
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
