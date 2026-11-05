/**
 * Screenshots of every state W3 asks for: loading, empty and error, on both
 * routes, at a desktop and a phone width.
 *
 * Usage: npm run build:deploy (with NADAC_SNAPSHOT_URL set), then
 *        npm run screenshots
 *
 * Every state is forced from outside the app, against the production build,
 * with no test-only code paths:
 *
 *   - an upstream that is **down** is a base URL at a closed port, the same
 *     trick `check-build-degradation.ts` uses;
 *   - an upstream that is **slow** is a local proxy that holds each request
 *     for `SLOW_MS` before forwarding it. That is under each source's timeout
 *     (src/server/http.ts), so the page loads late rather than failing, which
 *     is what a fallback exists for;
 *   - **no snapshot** is the snapshot file moved aside while the server runs,
 *     and put back afterwards.
 *
 * Each scenario gets its own `next start`, because `use cache` is per process:
 * a state rendered once is served from memory the second time, so a warm
 * server cannot show a loading or an outage state. For the same reason the
 * loading shots use a different drug or query at each width.
 *
 * A fresh process is not enough on its own. A drug page upgraded after its
 * first visit (ADR-005 Q3) is written to `.next/server/route-cache/` on disk
 * and outlives the process: without a reset, the "no snapshot" server served
 * the "loaded" scenario's page, price and all. So the route cache is copied
 * as the build left it, put back before every scenario, and put back again at
 * the end so the next run starts from the same place. Run this straight after
 * a build.
 *
 * Not in CI: it talks to the real RxNorm and openFDA, and a screenshot is
 * evidence to look at, not an assertion. It writes `docs/screenshots/`,
 * including the README that says what each image shows and how it was forced.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";

import { chromium, type Browser } from "playwright";

import { DEFAULT_SNAPSHOT_PATH } from "../src/server/nadac/store";

const root = path.resolve(import.meta.dirname, "..");
const outDir = path.join(root, "docs/screenshots");
const PORT = 3457;
const BASE = `http://127.0.0.1:${PORT}`;
const DEAD = "http://127.0.0.1:9";
const SLOW_MS = 2_200;
const ROUTE_CACHE = path.join(root, ".next/server/route-cache");
const ROUTE_CACHE_AS_BUILT = path.join(root, ".next/route-cache.as-built");

/** Puts the route cache back as the build left it; see the header. */
function resetRouteCache() {
  rmSync(ROUTE_CACHE, { recursive: true, force: true });
  if (existsSync(ROUTE_CACHE_AS_BUILT)) cpSync(ROUTE_CACHE_AS_BUILT, ROUTE_CACHE, { recursive: true });
}

/** Long pages (a full label) are cut here; the state is above the fold. */
const MAX_HEIGHT = 2_400;

const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 390, height: 844 },
} as const;
type Viewport = keyof typeof VIEWPORTS;

interface Shot {
  /** File stem; the viewport is appended. */
  name: string;
  /** What the image shows, for the README. */
  shows: string;
  /** One URL for both widths, or one per width when a warm cache would hide the state. */
  url: string | Record<Viewport, string>;
  /** Screenshot this long after navigation starts, instead of once loaded. */
  atMs?: number;
  /**
   * Reach `url` by clicking its link on this page, instead of loading it
   * directly: an in-app navigation, not a fresh document.
   */
  via?: string;
  /** With `via`: screenshot once this selector is present, plus a moment to draw. */
  waitFor?: string;
}

interface Scenario {
  title: string;
  /** How the state is forced, for the README. */
  how: string;
  env?: Record<string, string>;
  withoutSnapshot?: boolean;
  shots: Shot[];
}

const SLOW_RXNORM = "http://127.0.0.1:9100";
const SLOW_OPENFDA = "http://127.0.0.1:9101";

const scenarios: Scenario[] = [
  {
    title: "Loaded",
    how: "Real RxNorm and openFDA, and the live snapshot from the `data` branch.",
    shots: [
      { name: "home", shows: "The home page.", url: "/" },
      {
        name: "search-empty",
        shows: "Search with no query yet: the invitation, not an error.",
        url: "/search",
      },
      {
        name: "search-results",
        shows: "Search results.",
        url: "/search?q=metformin",
      },
      {
        name: "search-no-results",
        shows: "A query RxNorm matches nothing for.",
        url: "/search?q=qzxvq",
      },
      {
        name: "drug-prerendered",
        shows: "A drug in the prerender set (ADR-005 Q3), with a price.",
        url: "/drug/860975",
      },
      {
        name: "drug-streamed",
        shows: "A drug outside the prerender set, streamed on first visit, with a price.",
        url: "/drug/617312",
      },
      {
        name: "drug-price-absent",
        shows: "A drug NADAC publishes no price for (`Price` is `Absent`).",
        url: "/drug/206765",
      },
      {
        name: "drug-not-found",
        shows: "An RxCUI RxNorm does not know: a soft 404, status 200 and `noindex`.",
        url: "/drug/999999999",
      },
      {
        name: "not-found",
        shows: "Any other unknown path.",
        url: "/no-such-page",
      },
    ],
  },
  {
    title: "Loading",
    how: `RxNorm and openFDA behind a local proxy that holds every request ${SLOW_MS} ms, under both timeouts. The skeleton is taken at 600 ms; the fallback becomes a game at 1.5 s, taken at 2.5 s.`,
    env: { RXNORM_BASE_URL: SLOW_RXNORM, OPENFDA_BASE_URL: SLOW_OPENFDA },
    shots: [
      {
        name: "search-loading",
        shows: "Search results still loading: the skeleton.",
        url: { desktop: "/search?q=lisinopril", mobile: "/search?q=atorvastatin" },
        atMs: 600,
      },
      {
        name: "drug-loading-skeleton",
        shows: "A drug page under 1.5 s: the skeleton.",
        url: { desktop: "/drug/617310", mobile: "/drug/617318" },
        atMs: 600,
      },
      {
        name: "drug-loading-game",
        shows:
          "The same wait past 1.5 s, reached by clicking a search result: the fallback has become a game. **Only in-app navigation gets here.** A directly loaded page keeps the skeleton for the whole wait: React leaves a boundary the server is still streaming unhydrated, so the timer that swaps in the game never starts.",
        url: { desktop: "/drug/1050809", mobile: "/drug/2599173" },
        via: "/search?q=amlodipine",
        waitFor: '[data-testid="fallback-game"] [role="group"]',
      },
    ],
  },
  {
    title: "RxNorm down",
    how: `\`RXNORM_BASE_URL\` at a closed port (${DEAD}); every request is refused.`,
    env: { RXNORM_BASE_URL: DEAD },
    shots: [
      {
        name: "search-error",
        shows: "Search cannot run without RxNorm: the route's error boundary.",
        url: "/search?q=metformin",
      },
      {
        name: "drug-rxnorm-down",
        shows: "A drug page with RxNorm down.",
        url: "/drug/617312",
      },
    ],
  },
  {
    title: "openFDA down",
    how: `\`OPENFDA_BASE_URL\` at a closed port (${DEAD}); every request is refused.`,
    env: { OPENFDA_BASE_URL: DEAD },
    shots: [
      {
        name: "drug-label-unavailable",
        shows: "The label cannot load; price and versions still render.",
        url: "/drug/617312",
      },
    ],
  },
  {
    title: "No snapshot",
    how: "The snapshot file moved aside while the server runs. A deploy build refuses this state (`REQUIRE_NADAC_SNAPSHOT=1`); a running server can still reach it if the file is lost.",
    withoutSnapshot: true,
    shots: [
      {
        name: "drug-price-unavailable",
        shows: "No snapshot loaded: the price is `Unavailable`, and says whose fault it is.",
        url: "/drug/617312",
      },
    ],
  },
];

/** Holds each request, then forwards it to the real upstream. */
function slowProxy(port: number, target: string): http.Server {
  const server = http.createServer((req, res) => {
    setTimeout(() => {
      fetch(target + (req.url ?? ""))
        .then(async (upstream) => {
          res.writeHead(upstream.status, {
            "content-type": upstream.headers.get("content-type") ?? "application/json",
          });
          res.end(Buffer.from(await upstream.arrayBuffer()));
        })
        .catch(() => {
          res.writeHead(502);
          res.end();
        });
    }, SLOW_MS);
  });
  server.listen(port, "127.0.0.1");
  return server;
}

async function startServer(env: Record<string, string>): Promise<ChildProcess> {
  const child = spawn("npx", ["next", "start", "-p", String(PORT)], {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: "ignore",
    detached: true,
  });
  for (let i = 0; i < 60; i++) {
    try {
      // The home page is static and never touches an upstream.
      if ((await fetch(BASE)).ok) return child;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  stopServer(child);
  throw new Error("next start did not come up; run npm run build:deploy first");
}

function stopServer(child: ChildProcess) {
  // Negative pid: the whole group, since npx spawns next as a child.
  if (child.pid) process.kill(-child.pid, "SIGTERM");
}

async function shoot(browser: Browser, shot: Shot, viewport: Viewport) {
  const size = VIEWPORTS[viewport];
  const page = await browser.newPage({ viewport: size });
  const url = typeof shot.url === "string" ? shot.url : shot.url[viewport];
  if (shot.via !== undefined) {
    await page.goto(BASE + shot.via, { waitUntil: "networkidle" });
    await page.locator(`a[href="${url}"]`).first().click();
    if (shot.waitFor) await page.locator(shot.waitFor).first().waitFor();
    // The game draws on the frame after it mounts.
    await page.waitForTimeout(400);
  } else if (shot.atMs === undefined) {
    await page.goto(BASE + url, { waitUntil: "networkidle" });
  } else {
    const started = Date.now();
    await page.goto(BASE + url, { waitUntil: "commit" });
    await page.waitForTimeout(Math.max(0, shot.atMs - (Date.now() - started)));
  }
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  const file = `${shot.name}-${viewport}.png`;
  await page.screenshot({
    path: path.join(outDir, file),
    fullPage: true,
    clip: { x: 0, y: 0, width: size.width, height: Math.min(height, MAX_HEIGHT) },
    animations: shot.atMs === undefined && shot.via === undefined ? "disabled" : "allow",
  });
  await page.close();
  process.stdout.write(`  ${file}  ${url}\n`);
  return { file, url };
}

function readme(rows: string[], commit: string): string {
  return `# Screenshots

Every state W3 asks for, from a production build (\`next build\` +
\`next start\`) at \`${commit}\`, taken ${new Date().toISOString().slice(0, 10)}.
Desktop is 1280 px wide, mobile 390 px. Pages longer than ${MAX_HEIGHT} px are
cut there.

Generated by \`npm run screenshots\` (\`scripts/screenshots.ts\`), which also
says how each state is forced. Do not edit by hand; re-run it.

${rows.join("\n")}
`;
}

async function main() {
  const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  if (!existsSync(DEFAULT_SNAPSHOT_PATH)) {
    throw new Error("no snapshot at .data/; run npm run build:deploy first");
  }
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  rmSync(ROUTE_CACHE_AS_BUILT, { recursive: true, force: true });
  if (existsSync(ROUTE_CACHE)) cpSync(ROUTE_CACHE, ROUTE_CACHE_AS_BUILT, { recursive: true });

  const proxies = [slowProxy(9100, "https://rxnav.nlm.nih.gov/REST"), slowProxy(9101, "https://api.fda.gov")];
  const browser = await chromium.launch();
  const rows: string[] = [];
  const aside = `${DEFAULT_SNAPSHOT_PATH}.aside`;

  try {
    for (const scenario of scenarios) {
      process.stdout.write(`${scenario.title}\n`);
      resetRouteCache();
      if (scenario.withoutSnapshot) renameSync(DEFAULT_SNAPSHOT_PATH, aside);
      const server = await startServer(scenario.env ?? {});
      rows.push(`## ${scenario.title}\n\n${scenario.how}\n`);
      try {
        for (const shot of scenario.shots) {
          const desktop = await shoot(browser, shot, "desktop");
          const mobile = await shoot(browser, shot, "mobile");
          const urls = desktop.url === mobile.url ? `\`${desktop.url}\`` : `\`${desktop.url}\`, \`${mobile.url}\``;
          const from = shot.via ? ` (from \`${shot.via}\`)` : "";
          rows.push(
            `### ${shot.name}\n\n${shot.shows} ${urls}${from}\n\n` +
              `<img src="${desktop.file}" alt="${shot.name}, desktop" width="640"> ` +
              `<img src="${mobile.file}" alt="${shot.name}, mobile" width="195">\n`,
          );
        }
      } finally {
        stopServer(server);
        if (scenario.withoutSnapshot) renameSync(aside, DEFAULT_SNAPSHOT_PATH);
        // Let the port go before the next scenario binds it.
        await new Promise((r) => setTimeout(r, 1_000));
      }
    }
  } finally {
    await browser.close();
    for (const proxy of proxies) proxy.close();
    resetRouteCache();
  }

  writeFileSync(path.join(outDir, "README.md"), readme(rows, commit));
  process.stdout.write(`\nwrote ${outDir}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
