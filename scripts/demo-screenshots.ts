/**
 * Screenshots of the static demo (demo/), light and dark, for the README.
 *
 * Usage: npm run demo:screenshots
 *
 * Serves the demo exactly as storybook-pages.yml assembles it (demo/ plus the
 * app's tokens.css and icon) from a throwaway directory, then shoots it with
 * reduced motion on, so counters and the hero underline are in their final
 * state rather than caught mid-animation.
 *
 * Writes docs/demo-screenshots/. Not docs/screenshots/: that folder is the
 * real app's state evidence, and `npm run screenshots` empties it on each run.
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium, type Page } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const outDir = path.join(root, "docs/demo-screenshots");
const PORT = 3463;
const TYPES: Record<string, string> = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2",
};

function serve(dir: string): http.Server {
  return http.createServer((req, res) => {
    const rel = decodeURIComponent((req.url ?? "/").split("?")[0]!);
    const file = path.join(dir, rel.endsWith("/") ? `${rel}index.html` : rel);
    if (!file.startsWith(dir)) { res.writeHead(403); res.end(); return; }
    try {
      const body = readFileSync(file);
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404); res.end();
    }
  }).listen(PORT, "127.0.0.1");
}

async function main() {
  const site = mkdtempSync(path.join(tmpdir(), "pp-demo-"));
  cpSync(path.join(root, "demo"), site, { recursive: true });
  cpSync(path.join(root, "src/lib/tokens.css"), path.join(site, "tokens.css"));
  cpSync(path.join(root, "src/app/icon.svg"), path.join(site, "icon.svg"));
  const server = serve(site);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();

  const open = async (scheme: "light" | "dark", width: number, hash: string): Promise<Page> => {
    const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: scheme, reducedMotion: "reduce", deviceScaleFactor: 2 });
    await page.goto(`http://127.0.0.1:${PORT}/${hash}`, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    return page;
  };
  const write = (name: string) => path.join(outDir, `${name}.png`);

  try {
    for (const scheme of ["light", "dark"] as const) {
      let p = await open(scheme, 1280, "");
      await p.screenshot({ fullPage: true, path: write(`home-${scheme}`), clip: { x: 0, y: 0, width: 1280, height: 1640 } });
      // Element shots scroll the page; a sticky header would sit over their tops.
      await p.addStyleTag({ content: ".bar { position: static; }" });
      await p.locator('section[aria-labelledby="land-h"]').screenshot({ path: write(`landscape-${scheme}`) });
      await p.locator('section[aria-labelledby="buy-h"]').screenshot({ path: write(`buy-${scheme}`) });
      await p.close();

      p = await open(scheme, 1280, "#/drug/617312");
      await p.screenshot({ fullPage: true, path: write(`drug-${scheme}`), clip: { x: 0, y: 0, width: 1280, height: 1500 } });
      await p.close();

      p = await open(scheme, 390, "#/drug/617312");
      await p.screenshot({ fullPage: true, path: write(`drug-mobile-${scheme}`), clip: { x: 0, y: 0, width: 390, height: 1100 } });
      await p.close();
      process.stdout.write(`  ${scheme}\n`);
    }
  } finally {
    await browser.close();
    server.close();
    rmSync(site, { recursive: true, force: true });
  }
  process.stdout.write(`wrote ${outDir}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
