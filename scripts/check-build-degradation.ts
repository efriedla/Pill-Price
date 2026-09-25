/**
 * ADR-005 finding 7: what a static page holds when openFDA is down at build.
 *
 * Usage: npm run check:build-degradation
 *
 * Runs a real `next build` with openFDA refusing every connection
 * (`OPENFDA_BASE_URL` pointed at a closed local port), then reads each
 * prerendered drug page and asserts:
 *
 *   1. the build succeeds. An openFDA outage must not block a deploy, and
 *      before 2026-09-25 it did: Next fails a prerender on any error thrown
 *      inside a `use cache` function, caught or not (see src/server/cached.ts);
 *   2. no outage sentence is baked in. "We could not reach openFDA" in static
 *      HTML would be served for a week after openFDA came back;
 *   3. no label is baked in either, because there was none to bake. The label
 *      boundary is a dynamic hole, and its fallback stands in the HTML.
 *
 * Not in CI: it is a second full build (~40 s) and a slow-changing property.
 * Run it before a deploy, and after any change to a page loader's cacheLife.
 * It deletes `.next`, because a warm cache from a live build would pass it.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

import { PRERENDERED_RXCUIS } from "../src/app/drug/[rxcui]/prerendered";

const root = path.resolve(import.meta.dirname, "..");
const DEAD_OPENFDA = "http://127.0.0.1:9";

const checks: Array<[string, (html: string) => boolean]> = [
  ["no outage sentence", (h) => !h.includes("We could not reach openFDA")],
  [
    "no label baked in",
    (h) =>
      !h.includes("Generic labels follow") &&
      !h.includes("No brand-name label is published"),
  ],
  [
    "the label fallback stands in",
    (h) => h.includes("Loading this drug&#x27;s label"),
  ],
  // The rest of the page is unaffected: openFDA is only the label's source.
  [
    "the versions boundary rendered",
    (h) => h.includes("Brand and generic versions"),
  ],
];

rmSync(path.join(root, ".next"), { recursive: true, force: true });
process.stdout.write(`building with openFDA at ${DEAD_OPENFDA} (refused)\n`);

try {
  execFileSync("npx", ["next", "build"], {
    cwd: root,
    env: { ...process.env, OPENFDA_BASE_URL: DEAD_OPENFDA },
    stdio: ["ignore", "ignore", "pipe"],
  });
} catch (error) {
  const stderr = String((error as { stderr?: Buffer }).stderr ?? error);
  process.stderr.write(
    `FAIL  the build did not survive an openFDA outage:\n${stderr.slice(0, 2000)}\n`,
  );
  process.exit(1);
}
process.stdout.write("  ok    the build succeeded\n");

let failed = 0;
for (const rxcui of PRERENDERED_RXCUIS) {
  const file = path.join(root, ".next/server/app/drug", `${rxcui}.html`);
  if (!existsSync(file)) {
    process.stderr.write(`  FAIL  /drug/${rxcui} was not prerendered\n`);
    failed++;
    continue;
  }
  const html = readFileSync(file, "utf8");
  for (const [name, holds] of checks) {
    const ok = holds(html);
    if (!ok) failed++;
    process.stdout.write(
      `  ${ok ? "ok  " : "FAIL"}  /drug/${rxcui}: ${name}\n`,
    );
  }
}

// The .next left behind was built against a dead openFDA; never ship it.
rmSync(path.join(root, ".next"), { recursive: true, force: true });

process.stdout.write(
  failed ? `\n${failed} check(s) failed.\n` : "\nall checks passed.\n",
);
process.exit(failed ? 1 : 0);
