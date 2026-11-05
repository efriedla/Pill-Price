// Medians over the runs that scripts/lighthouse.sh wrote, as a Markdown table,
// plus every failing accessibility audit (any run) so none is averaged away.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const dir = process.argv[2];
const groups = new Map();
for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
  const r = JSON.parse(readFileSync(path.join(dir, file), "utf8"));
  const preset = file.startsWith("desktop") ? "desktop" : "mobile";
  const key = `${preset} ${new URL(r.finalDisplayedUrl).pathname}${new URL(r.finalDisplayedUrl).search}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(r);
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const score = (rs, c) => Math.round(median(rs.map((r) => r.categories[c].score)) * 100);
const ms = (rs, a) => Math.round(median(rs.map((r) => r.audits[a].numericValue)));

console.log("| Page | Form | Perf | A11y | BP | SEO | LCP | TBT | CLS | FCP |");
console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
const failing = new Map();
for (const [key, rs] of [...groups].sort()) {
  const [preset, page] = key.split(" ");
  const cls = median(rs.map((r) => r.audits["cumulative-layout-shift"].numericValue)).toFixed(3);
  console.log(
    `| \`${page}\` | ${preset} | ${score(rs, "performance")} | ${score(rs, "accessibility")} | ` +
      `${score(rs, "best-practices")} | ${score(rs, "seo")} | ${ms(rs, "largest-contentful-paint")} ms | ` +
      `${ms(rs, "total-blocking-time")} ms | ${cls} | ${ms(rs, "first-contentful-paint")} ms |`,
  );
  for (const r of rs) {
    for (const ref of r.categories.accessibility.auditRefs) {
      const a = r.audits[ref.id];
      if (ref.weight > 0 && a.score !== null && a.score < 1) {
        const where = failing.get(ref.id) ?? { title: a.title, pages: new Set() };
        where.pages.add(page);
        failing.set(ref.id, where);
      }
    }
  }
}
console.log("\nFailing accessibility audits:");
if (failing.size === 0) console.log("  none");
for (const [id, { title, pages }] of failing) console.log(`  ${id}: ${title} — ${[...pages].join(", ")}`);
