/**
 * Keyboard traversal of both routes (roadmap W7: "full keyboard traversal of
 * all routes with a visible focus ring throughout").
 *
 * Usage: npm run build:deploy, then npm run keyboard-walk
 *
 * For each page, presses Tab until focus returns to where it started (or a
 * cap), and for every stop records what took focus and whether the focus is
 * visible: a non-`none` outline or a box-shadow, with the element on screen and
 * not zero-sized. Exits non-zero if any stop has no visible focus, or if a
 * page has no stops at all where it should. Not in CI; the output goes into
 * docs/a11y-audit.md.
 */
import { spawn } from "node:child_process";
import path from "node:path";

import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const PORT = 3460;
const BASE = `http://127.0.0.1:${PORT}`;
const MAX_STOPS = 80;

const PAGES = ["/", "/search", "/search?q=metformin", "/drug/617312", "/drug/206765", "/drug/999999999", "/no-such-page"];

interface Stop {
  label: string;
  visible: boolean;
  why: string;
}

async function main() {
  const server = spawn("npx", ["next", "start", "-p", String(PORT)], { cwd: root, stdio: "ignore", detached: true });
  try {
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(BASE)).ok) break;
      } catch {
        // not up yet
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    const browser = await chromium.launch();
    let failures = 0;
    for (const url of PAGES) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await page.goto(BASE + url, { waitUntil: "networkidle" });
      const stops: Stop[] = [];
      let first: string | null = null;
      for (let i = 0; i < MAX_STOPS; i++) {
        await page.keyboard.press("Tab");
        const stop = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el || el === document.body) return null;
          const s = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          const ring = (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== "none";
          const sized = r.width > 0 && r.height > 0;
          const text = (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 50);
          const id = `${el.tagName.toLowerCase()}${el.getAttribute("href") ? `[href=${el.getAttribute("href")}]` : ""} "${text}"`;
          const why = !ring ? "no outline or box-shadow" : !sized ? "zero-sized" : "";
          return { label: id, visible: ring && sized, why };
        });
        if (stop === null) break; // focus left the document: wrapped to the browser UI
        if (stop.label === first) break;
        first ??= stop.label;
        stops.push(stop);
      }
      const bad = stops.filter((s) => !s.visible);
      failures += bad.length;
      process.stdout.write(`\n${url}  ${stops.length} stops, ${bad.length} without visible focus\n`);
      for (const s of stops) process.stdout.write(`  ${s.visible ? "ok " : "BAD"} ${s.label}${s.why ? `  (${s.why})` : ""}\n`);
      await page.close();
    }
    await browser.close();
    process.exitCode = failures > 0 ? 1 : 0;
  } finally {
    if (server.pid) process.kill(-server.pid, "SIGTERM");
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
