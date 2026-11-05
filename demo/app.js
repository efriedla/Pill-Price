// Pill Price, static demo. Renders data.json (frozen from the real app's own
// GraphQL API by scripts/build-demo-data.ts) with hash routes:
//   #/                  home
//   #/search?q=term     search
//   #/drug/<rxcui>      a drug
// Formatting helpers are ports of the app's: prices stay decimal strings and
// dates stay calendar dates. Computed figures (multiples, "$100 buys") use
// exact decimal math in decimal.js; that arithmetic is a demo-only exception
// to ui-spec §5, by the author's decision of 2026-11-05.

import { cmp, fmtMultiple } from "./decimal.js";
import {
  PILL_EMPTY, bindSearchShortcut, buyWidget, byPrice, combobox, countUp, esc, gapBar,
  landscape, laneOf, reduced, roving, sortableTable, tabs, tooltip,
} from "./widgets.js";

const main = document.getElementById("main");
let DATA = null;

// ---- Ported from src/features/drug/formatPerUnit.ts ----
function roundDecimalString(value) {
  const m = /^(-?)(\d+)(?:\.(\d*))?$/.exec(value);
  if (!m) return value;
  const [, sign, whole, fraction = ""] = m;
  if (fraction.length <= 4) return `${sign}${whole}.${fraction.padEnd(4, "0")}`;
  const kept = fraction.slice(0, 4);
  if (fraction.charCodeAt(4) < 53) return `${sign}${whole}.${kept}`;
  const out = `${whole}${kept}`.split("");
  let i = out.length - 1;
  for (; i >= 0; i--) {
    if (out[i] !== "9") { out[i] = String(Number(out[i]) + 1); break; }
    out[i] = "0";
  }
  const digits = (i < 0 ? "1" : "") + out.join("");
  const cut = digits.length - 4;
  return `${sign}${digits.slice(0, cut)}.${digits.slice(cut)}`;
}

// ---- Ported from src/lib/calendar-date.ts ----
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function formatIsoDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || "");
  if (!m) return value;
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

// ---- Ported from src/features/drug/unitLabel.ts ----
const unitLabel = (unit) => ({ EA: "per unit", ML: "per mL", GM: "per gram" })[unit] ?? `per ${unit}`;

// ---- Copy, from src/features/drug/DrugLabel.tsx ----
const SECTION_TITLES = {
  BOXED_WARNING: "Boxed warning",
  INDICATIONS_AND_USAGE: "Indications and usage",
  DOSAGE_AND_ADMINISTRATION: "Dosage and administration",
  CONTRAINDICATIONS: "Contraindications",
  WARNINGS_AND_CAUTIONS: "Warnings and cautions",
  ADVERSE_REACTIONS: "Adverse reactions",
  DRUG_INTERACTIONS: "Drug interactions",
};
const WHY = {
  OWN_LABEL: "Generic labels follow this one.",
  REFERENCE_IN_RESULTS: "Generic labels follow this one.",
  BRAND_VERSION: "Generic labels follow this one.",
  ORIGINAL_PACKAGER: "No brand-name label is published, so this is the newest from a company that makes this drug.",
};
const NOTICE = `<p class="notice"><strong>This is an acquisition cost, not a retail price.</strong> NADAC reports what pharmacies pay to buy a drug, not what you pay at the counter, and not an insurance price.</p>`;

// ---- Helpers ----
const has = (rxcui) => Boolean(DATA.drugs[rxcui]);
const drugHref = (rxcui) => `#/drug/${encodeURIComponent(rxcui)}`;
const money = (p) => `$${roundDecimalString(p)}`;
const priced = (d) => d?.price?.__typename === "Price";
const brandShort = (name) => name.match(/\[(.+)\]/)?.[1] ?? name;
const perUnit = `<abbr title="per unit">/u</abbr>`;
function setTitle(t) { document.title = t ? `${t} · Pill Price demo` : "Pill Price — what pharmacies pay for a drug"; }

function priceLine(price, size = "large") {
  if (price.__typename === "Price") {
    return `<p class="price ${size}"><span class="fig">${esc(money(price.pricePerUnit))}</span>` +
      `<span class="qual">${esc(unitLabel(price.unit))} · as of ${esc(formatIsoDate(price.effectiveDate))}</span></p>`;
  }
  return `<p class="reason">${esc(price.reason)}</p>`;
}

/** Generic drugs with a priced brand version, one per ingredient. */
function brandPairs(limit) {
  const out = [];
  for (const d of Object.values(DATA.drugs)) {
    if (!d.isGeneric || !priced(d)) continue;
    const brand = (d.alternatives.drugs || []).find((a) => !a.isGeneric && priced(a));
    const ing = d.ingredients.ingredients?.[0]?.name;
    if (brand && !out.some((p) => p.ing === ing)) out.push({ d, brand, ing });
    if (out.length === limit) break;
  }
  return out;
}

function comboItems() {
  return Object.values(DATA.drugs).map((d) => ({
    rxcui: d.rxcui, name: d.name, isGeneric: d.isGeneric,
    form: d.doseForm.name ?? "", priceText: priced(d) ? `${money(d.price.pricePerUnit)}/u` : "no NADAC price",
  }));
}

function comboHtml(value = "") {
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  return `<div class="combo" role="search">
    <label for="q" id="q-label">Search by drug name</label>
    <div class="field">
      <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="m20 20-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      <input id="q" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="q-list"
        aria-describedby="q-hint" autocomplete="off" spellcheck="false" placeholder="e.g. atorvastatin, Lipitor" value="${esc(value)}">
      <span class="hint" id="q-hint"><span class="sr-only">Shortcut: </span><kbd>${mac ? "⌘" : "Ctrl"} K</kbd></span>
    </div>
    <ul role="listbox" id="q-list" aria-labelledby="q-label" hidden></ul>
  </div>`;
}
function wireCombo() {
  combobox(main.querySelector(".combo"), {
    items: comboItems(),
    onPick: (item) => { location.hash = drugHref(item.rxcui); },
    onSubmit: (q) => { if (q) location.hash = `#/search?q=${encodeURIComponent(q)}`; },
  });
}

// ---- Home ----
function homeView() {
  setTitle("");
  // Six: whole rows at three, two or one across.
  const pairs = brandPairs(6);
  const buyPairs = brandPairs(12);
  const chips = DATA.terms.map((t) => `<li><a href="#/search?q=${encodeURIComponent(t)}" data-term="${esc(t)}">${esc(t)}</a></li>`).join("");

  const pairHtml = pairs.map(({ d, brand }) => `
    <li><a class="card lift" href="${drugHref(d.rxcui)}">
      <div class="pair-row"><span class="swatch generic" aria-hidden="true"></span><span>${esc(d.name)}</span><span class="fig t-generic">${esc(money(d.price.pricePerUnit))}${perUnit}</span></div>
      <div class="pair-row"><span class="swatch brand" aria-hidden="true"></span><span class="who">${esc(brandShort(brand.name))} <span class="muted">(brand)</span></span><span class="fig t-brand">${esc(money(brand.price.pricePerUnit))}${perUnit}</span></div>
      ${gapBar(d.price.pricePerUnit, brand.price.pricePerUnit)}
    </a></li>`).join("");

  const stat = (count, final, label) =>
    `<li class="card" data-count="${count}" data-final="${esc(final)}"><span class="big" aria-hidden="true">${esc(final)}</span><span class="sr-only">${esc(final)}</span><span class="lbl">${esc(label)}</span></li>`;

  main.innerHTML = `<div class="view">
    <section class="hero" aria-labelledby="hero-h">
      <h1 id="hero-h">What pharmacies <span class="hl">pay<svg viewBox="0 0 100 12" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path class="${reduced() ? "" : "draw"}" pathLength="1" d="M2 8 C 22 3, 45 2, 60 5 S 88 9, 98 4"/></svg></span> for a drug.</h1>
      <p class="lede">Search a drug, then see its NADAC acquisition cost, its brand and generic versions side by side, and its FDA label. Every figure carries its unit and its date.</p>
      ${NOTICE}
      ${comboHtml()}
      <ul class="chips" aria-label="Try a search">${chips}</ul>
    </section>

    <section class="block" aria-labelledby="pairs-h">
      <p class="eyebrow">Same drug, two prices</p>
      <h2 class="title" id="pairs-h">Generic and brand, per unit</h2>
      <p class="sub">NADAC per-unit acquisition cost. The multiple is exact decimal arithmetic on the published prices, which carry up to five decimals; the figures shown are rounded to four.</p>
      <ul class="pairs">${pairHtml}</ul>
    </section>

    <section class="block" aria-labelledby="buy-h">
      <p class="eyebrow">Interactive · What does $100 buy?</p>
      <div class="buy band">
        <h2 id="buy-h">What does your money buy at acquisition cost?</h2>
        <div class="buy-controls">
          <div><label for="buy-drug">Drug</label><select id="buy-drug">${buyPairs.map((p, i) => `<option value="${i}">${esc(p.ing)} · ${esc(brandShort(p.brand.name))}</option>`).join("")}</select></div>
          <div><label for="buy-amt">Amount, in dollars</label><input id="buy-amt" type="number" min="1" max="1000" step="1" value="100" inputmode="numeric"></div>
          <div><label for="buy-range">Adjust</label><input id="buy-range" type="range" min="1" max="1000" step="1" value="100" aria-controls="buy-out"></div>
        </div>
        <output class="buy-out" id="buy-out" for="buy-drug buy-amt buy-range" aria-live="polite"></output>
        <div class="matrices"></div>
        <p class="caption"></p>
      </div>
    </section>

    <section class="block" aria-labelledby="land-h">
      <p class="eyebrow">The price landscape · every priced drug in this demo</p>
      <div class="land band">
        <div class="band-head">
          <h2 id="land-h">Per-unit prices span more than three orders of magnitude</h2>
          <div class="segs">
            <div class="seg" role="group" aria-label="Overlay"><button type="button" id="land-gen" aria-pressed="false">Generic only</button><button type="button" id="land-brand" aria-pressed="true">+ Brand</button></div>
            <div class="seg" role="group" aria-label="View"><button type="button" id="land-chart" aria-pressed="true">Chart</button><button type="button" id="land-table" aria-pressed="false">Table</button></div>
          </div>
        </div>
        <p class="sub" style="margin:0">From about a cent a tablet (generic amlodipine) to over thirty dollars (Rybelsus). The axis is logarithmic, so each gridline is ten times the last.</p>
        <div class="legend"><span><span class="dotk" aria-hidden="true"></span>Generic per unit</span><span><span class="ring" aria-hidden="true"></span>Brand per unit</span></div>
        <div id="land-view"></div>
        <p class="caption">NADAC per-unit prices, most recent effective dates up to ${esc(formatIsoDate((DATA.snapshotAsOf || "").slice(0, 10)))}. Lines join a brand to its generic.</p>
      </div>
    </section>

    <section class="block" aria-labelledby="stats-h">
      <p class="eyebrow">Measured, not claimed</p>
      <h2 class="title" id="stats-h">The real app, by the numbers</h2>
      <ul class="stats">
        ${stat(22, "22 ms", "p95 API response, cached drug")}
        ${stat(100, "100", "Lighthouse accessibility, mobile and desktop")}
        ${stat(93, "93 / 93", "tab stops with a visible focus ring")}
        ${stat(12, "12", "decision records, written before the code")}
      </ul>
    </section>

    <section class="block" aria-labelledby="how-h">
      <p class="eyebrow">How the real app works</p>
      <h2 class="title" id="how-h">Three sources, one API, a streamed page</h2>
      <div class="arch card">${archSvg()}</div>
      <div class="how">
        <div><h3>Three sources, one API</h3><p>A GraphQL backend-for-frontend over RxNorm, openFDA and NADAC. Every missing value says which source is missing it, and whether that is a fact or a failure.</p></div>
        <div><h3>Static where it can be</h3><p>Next.js partial prerendering: an instant shell, then price, versions and label stream in independently. A drug is static after its first visit.</p></div>
        <div><h3>Prices off the request path</h3><p>A weekly job froze ~1M NADAC rows into a snapshot on a data branch. Money is a decimal string end to end, never a float.</p></div>
      </div>
    </section>
  </div>`;

  wireCombo();
  const chipList = main.querySelector(".chips");
  roving(chipList);
  chipList.querySelectorAll("a").forEach((a) => tooltip(a, () => chipTip(a.dataset.term)));
  countUp(main.querySelector(".stats"));
  buyWidget(main.querySelector(".buy"), buyPairs, formatIsoDate);
  wireLandscape();
  animateArch();
}

function chipTip(term) {
  const gens = (DATA.searches[term] || []).map((h) => DATA.drugs[h.rxcui]).filter((d) => d && d.isGeneric && priced(d));
  if (!gens.length) return `No generic NADAC price for ${esc(term)} in this demo`;
  const low = gens.reduce((a, b) => (cmp(b.price.pricePerUnit, a.price.pricePerUnit) < 0 ? b : a));
  return `Generic ${esc(term)} from <span class="num">${esc(money(low.price.pricePerUnit))}</span> per unit`;
}

function landscapeRows() {
  const genericOf = {};
  for (const d of Object.values(DATA.drugs)) {
    if (!d.isGeneric || !priced(d)) continue;
    for (const a of d.alternatives.drugs || []) if (!a.isGeneric) genericOf[a.rxcui] ??= d.rxcui;
  }
  return Object.values(DATA.drugs).filter((d) => priced(d) && d.price.unit === "EA").map((d) => ({
    rxcui: d.rxcui, name: d.name, isGeneric: d.isGeneric, price: d.price.pricePerUnit,
    lane: laneOf(d.doseForm.name ?? ""), genericOf: genericOf[d.rxcui],
  }));
}
function wireLandscape() {
  const view = main.querySelector("#land-view"), bBtn = main.querySelector("#land-brand"), tBtn = main.querySelector("#land-table");
  const gBtn = main.querySelector("#land-gen"), cBtn = main.querySelector("#land-chart");
  const rows = landscapeRows();
  const draw = () => {
    const brands = bBtn.getAttribute("aria-pressed") === "true";
    const visible = rows.filter((r) => r.isGeneric || brands);
    if (tBtn.getAttribute("aria-pressed") === "true") {
      view.innerHTML = `<div class="table-wrap" id="land-tbl"></div>`;
      sortableTable(view.querySelector("#land-tbl"), {
        columns: [
          { key: "name", label: "Drug", compare: (a, b) => a.name.localeCompare(b.name) },
          { key: "kind", label: "Type", compare: (a, b) => Number(a.isGeneric) - Number(b.isGeneric) },
          { key: "lane", label: "Form", compare: (a, b) => a.lane.localeCompare(b.lane) },
          { key: "price", label: "NADAC per unit", num: true, compare: byPrice },
        ],
        rows: visible, initial: { key: "price", dir: 1 },
        rowHtml: (r) => `<tr><td><a href="${drugHref(r.rxcui)}">${esc(r.name)}</a></td><td><span class="kindpill ${r.isGeneric ? "generic" : "brand"}">${r.isGeneric ? "Generic" : "Brand"}</span></td><td>${esc(r.lane)}</td><td class="n">${esc(money(r.price))}</td></tr>`,
      });
    } else {
      landscape(view, rows, { showBrand: brands, fmt: money, href: drugHref });
    }
  };
  // Two segmented controls: exactly one button of each pair is pressed.
  const pick = (on, off) => () => { on.setAttribute("aria-pressed", "true"); off.setAttribute("aria-pressed", "false"); draw(); };
  bBtn.addEventListener("click", pick(bBtn, gBtn)); gBtn.addEventListener("click", pick(gBtn, bBtn));
  tBtn.addEventListener("click", pick(tBtn, cBtn)); cBtn.addEventListener("click", pick(cBtn, tBtn));
  draw();
}

function archSvg() {
  const box = (x, y, w, h, cls, title, sub) => `<rect class="box ${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx="10"/>
    <text x="${x + w / 2}" y="${y + h / 2 - (sub ? 4 : -4)}" text-anchor="middle" font-weight="600">${title}</text>
    ${sub ? `<text class="small" x="${x + w / 2}" y="${y + h / 2 + 14}" text-anchor="middle">${sub}</text>` : ""}`;
  const wire = (d) => `<path class="wire" d="${d}"/>`;
  return `<svg viewBox="0 0 860 250" role="img" aria-labelledby="arch-t arch-d">
    <title id="arch-t">Architecture of the real app</title>
    <desc id="arch-d">RxNorm, openFDA and a weekly NADAC snapshot feed a GraphQL backend-for-frontend, which serves the Next.js page: an instant shell, then streamed price, versions and label.</desc>
    ${box(10, 20, 170, 56, "src", "RxNorm", "identity, search")}
    ${box(10, 97, 170, 56, "src", "openFDA", "labels")}
    ${box(10, 174, 170, 56, "src", "NADAC", "weekly snapshot")}
    ${box(320, 85, 200, 80, "bff", "GraphQL BFF", "typed results, DataLoader")}
    ${box(660, 30, 190, 50, "", "Next.js shell", "instant, prerendered")}
    ${box(660, 100, 190, 50, "", "Price · Versions", "streamed")}
    ${box(660, 170, 190, 50, "", "Label", "streamed")}
    ${wire("M180 48 C 250 48, 250 110, 320 110")}
    ${wire("M180 125 L 320 125")}
    ${wire("M180 202 C 250 202, 250 140, 320 140")}
    ${wire("M520 125 C 590 125, 590 55, 660 55 M520 125 L 660 125 M520 125 C 590 125, 590 195, 660 195")}
  </svg>`;
}
function animateArch() {
  const el = main.querySelector(".arch");
  if (!el) return;
  if (reduced() || !("IntersectionObserver" in window)) { el.classList.add("go"); return; }
  const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { el.classList.add("go"); io.disconnect(); } }, { threshold: 0.3 });
  io.observe(el);
}

// ---- Search ----
function searchView(q) {
  setTitle(q ? `“${q}”` : "Search");
  const term = q.trim().toLowerCase();
  // A frozen term shows the real app's full RxNorm result list. Anything else
  // searches the drugs in this demo, and says that is what it did.
  const frozen = DATA.searches[term];
  const hits = frozen ?? Object.values(DATA.drugs)
    .filter((d) => d.name.toLowerCase().includes(term))
    .map((d) => ({ rxcui: d.rxcui, name: d.name, isGeneric: d.isGeneric }));

  const row = (h) => {
    const d = DATA.drugs[h.rxcui];
    const side = !d ? `<span class="side">not in this demo</span>`
      : priced(d) ? `<span class="side"><span class="fig">${esc(money(d.price.pricePerUnit))}</span> ${esc(unitLabel(d.price.unit))}</span>`
      : `<span class="side">no NADAC price</span>`;
    return d
      ? `<li><a href="${drugHref(h.rxcui)}"><span class="nm">${esc(h.name)}</span>${side}</a></li>`
      : `<li><span class="off"><span>${esc(h.name)}</span>${side}</span></li>`;
  };
  // Drugs in the demo first, so the clickable ones are not buried.
  const sorted = [...hits].sort((a, b) => Number(has(b.rxcui)) - Number(has(a.rxcui)));
  const generic = sorted.filter((h) => h.isGeneric);
  const brand = sorted.filter((h) => !h.isGeneric);
  const inDemo = hits.filter((h) => has(h.rxcui)).length;
  const group = (name, list) => list.length
    ? `<section class="group" aria-label="${name}"><h2 class="eyebrow">${name} · ${list.length}</h2><ul class="results">${list.map(row).join("")}</ul></section>` : "";

  let body;
  if (!term) body = `<p class="count">Type a drug name, or try one of: ${DATA.terms.slice(0, 6).map((t) => `<a href="#/search?q=${encodeURIComponent(t)}">${esc(t)}</a>`).join(", ")}.</p>`;
  else if (!hits.length) body = `<div class="empty">${PILL_EMPTY}<h2>Not in the ${Object.keys(DATA.drugs).length}-drug demo set</h2><p>Nothing in this demo matches “${esc(q)}”. The real app searches all of RxNorm. Try ${DATA.terms.slice(0, 4).map((t) => `<a href="#/search?q=${encodeURIComponent(t)}">${esc(t)}</a>`).join(", ")}.</p></div>`;
  else body = `<p class="count" aria-live="polite">${frozen ? `${hits.length} products match “${esc(q)}” in RxNorm. ${inDemo} of them are in this demo.` : `${hits.length} drugs in this demo match “${esc(q)}”. The real app searches all of RxNorm.`}</p>${group("Generic", generic)}${group("Brand", brand)}`;

  main.innerHTML = `<div class="view"><h1 class="sr-only">Search drugs</h1>${comboHtml(q)}${body}</div>`;
  wireCombo();
}

// ---- Drug ----
function drugView(rxcui) {
  const d = DATA.drugs[rxcui];
  if (!d) {
    setTitle("Not in this demo");
    main.innerHTML = `<div class="view empty">${PILL_EMPTY}<h1>Not in this demo</h1><p>This static demo holds ${Object.keys(DATA.drugs).length} drugs, and RxCUI ${esc(rxcui)} is not one of them. The real app looks up any drug in RxNorm.</p><p><a href="#/">Back to the start</a></p></div>`;
    return;
  }
  setTitle(d.name);
  const backTerm = DATA.terms.find((t) => d.name.toLowerCase().includes(t))
    ?? (d.ingredients.ingredients?.[0]?.name ?? d.name).split(" ")[0].toLowerCase();
  const ing = d.ingredients.__typename === "Ingredients" ? d.ingredients.ingredients.map((i) => esc(i.name)).join(", ") : esc(d.ingredients.reason);
  const form = d.doseForm.__typename === "DoseForm" ? esc(d.doseForm.name) : esc(d.doseForm.reason);
  const alts = d.alternatives.__typename === "Alternatives" ? d.alternatives.drugs : [];
  const brandAlt = d.isGeneric && priced(d) ? alts.find((a) => !a.isGeneric && priced(a)) : null;

  main.innerHTML = `<div class="view"><article class="drug">
    <a class="back" href="#/search?q=${encodeURIComponent(backTerm)}">← Search “${esc(backTerm)}”</a>
    ${NOTICE}
    <div class="drug-head">
      <p><span class="kindpill ${d.isGeneric ? "generic" : "brand"}">${d.isGeneric ? "Generic" : "Brand"}</span></p>
      <h1>${esc(d.name)}</h1>
      <p class="rxcui">rxcui ${esc(d.rxcui)}</p>
      ${priceLine(d.price)}
      ${brandAlt ? `<div style="max-width:28rem">${gapBar(d.price.pricePerUnit, brandAlt.price.pricePerUnit)}</div>` : ""}
    </div>
    <section class="sect card" aria-labelledby="det-h"><h2 id="det-h">Details</h2>
      <dl class="facts"><div><dt>Active ingredient</dt><dd>${ing}</dd></div><div><dt>Dosage form</dt><dd>${form}</dd></div></dl>
    </section>
    <section class="sect card" aria-labelledby="ver-h"><h2 id="ver-h">Brand and generic versions</h2>${versionsHtml(d, alts)}</section>
    <section class="sect card" aria-labelledby="lab-h"><h2 id="lab-h">Label</h2>${labelHtml(d.label)}</section>
  </article></div>`;

  if (alts.length) wireVersions(d, alts);
  const tl = main.querySelector(".tabs");
  if (tl) tabs(tl);
}

function versionsHtml(d, alts) {
  if (!alts.length) return `<p class="reason">${esc(d.alternatives.reason ?? "RxNorm lists no other products for this drug.")}</p>`;
  return `<p class="caveat">Same ingredients, strength and form as ${esc(d.name)}. Not a substitution recommendation — talk to a pharmacist.</p>
    <div class="filters" role="group" aria-label="Show">
      ${["All", "Generic", "Brand"].map((f, i) => `<button type="button" class="toggle" data-f="${f}" aria-pressed="${i === 0}">${f}</button>`).join("")}
    </div>
    <div class="table-wrap" id="ver-tbl"></div>`;
}
function wireVersions(d, alts) {
  const rows = [d, ...alts].map((a) => ({
    rxcui: a.rxcui, name: a.name, isGeneric: a.isGeneric, self: a.rxcui === d.rxcui,
    price: priced(a) ? a.price.pricePerUnit : null, date: priced(a) ? a.price.effectiveDate : null, reason: a.price?.reason,
  }));
  const base = priced(d) ? d.price.pricePerUnit : null;
  const table = sortableTable(main.querySelector("#ver-tbl"), {
    columns: [
      { key: "name", label: "Product", compare: (a, b) => a.name.localeCompare(b.name) },
      { key: "kind", label: "Type", compare: (a, b) => Number(a.isGeneric) - Number(b.isGeneric) },
      { key: "price", label: "NADAC per unit", num: true, compare: byPrice },
      { key: "x", label: "vs this drug", num: true, compare: byPrice },
    ],
    rows, initial: { key: "price", dir: 1 },
    rowHtml: (r) => `<tr class="${r.self ? "self" : ""}">
      <td>${r.self ? `<strong>${esc(r.name)}</strong> <span class="muted">(this drug)</span>` : has(r.rxcui) ? `<a href="${drugHref(r.rxcui)}">${esc(r.name)}</a>` : esc(r.name)}</td>
      <td><span class="kindpill ${r.isGeneric ? "generic" : "brand"}">${r.isGeneric ? "Generic" : "Brand"}</span></td>
      <td class="n">${r.price ? `${esc(money(r.price))}<br><span class="muted" style="font-family:var(--font-body)">as of ${esc(formatIsoDate(r.date))}</span>` : `<span class="muted" style="font-family:var(--font-body)">${esc(r.reason ?? "No price")}</span>`}</td>
      <td class="n">${r.self ? "—" : r.price && base ? `${esc(fmtMultiple(r.price, base))}×` : "—"}</td></tr>`,
  });
  main.querySelectorAll(".filters .toggle").forEach((b) => b.addEventListener("click", () => {
    main.querySelectorAll(".filters .toggle").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    const f = b.dataset.f;
    table.setRows(rows.filter((r) => r.self || f === "All" || (f === "Generic") === r.isGeneric));
  }));
}

function labelHtml(L) {
  if (L.__typename !== "Label") return `<p class="reason">${esc(L.reason)}</p>`;
  const daily = `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${encodeURIComponent(L.setId)}`;
  const date = formatIsoDate(L.effectiveDate);
  // The boxed warning is never put behind a tab (ui-spec §11, as in the app).
  const boxed = L.sections.find((s) => s.kind === "BOXED_WARNING");
  const rest = L.sections.filter((s) => s.kind !== "BOXED_WARNING");
  const head = `<p class="label-src">Label: ${esc(L.productName)}, from ${esc(L.manufacturer)} · updated ${esc(date)}. ${esc(WHY[L.chosenBy] ?? "")} <a href="${daily}">Read the full label on DailyMed</a></p>`;
  const boxedHtml = boxed ? `<section class="boxed" aria-labelledby="bw-h"><h3 id="bw-h">⚠ Boxed warning</h3><p>${esc(boxed.paragraphs.join(" "))}</p></section>` : "";
  if (!rest.length) return head + boxedHtml;
  const tabBtns = rest.map((s, i) => `<button type="button" role="tab" id="tab-${i}" aria-controls="panel-${i}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${esc(SECTION_TITLES[s.kind] ?? s.kind)}</button>`).join("");
  const panels = rest.map((s, i) => `<div role="tabpanel" id="panel-${i}" aria-labelledby="tab-${i}" tabindex="0" ${i === 0 ? "" : "hidden"}>
      <p>${esc(s.paragraphs.join(" "))}</p>
      <p class="label-src">Source: FDA label · updated ${esc(date)}${s.trimmed ? " · shortened for this demo" : ""}</p></div>`).join("");
  return `${head}${boxedHtml}<div class="tabs"><div class="tablist" role="tablist" aria-label="Label sections">${tabBtns}</div>${panels}</div>`;
}

// ---- Header: theme toggle and freshness badge ----
const THEMES = ["system", "light", "dark"];
function applyTheme(t) {
  if (t === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
  const b = document.getElementById("theme-btn");
  b.querySelector(".t-name").textContent = t[0].toUpperCase() + t.slice(1);
}
function wireTheme() {
  let t = "system";
  try { t = localStorage.getItem("pp-theme") || "system"; } catch { /* storage blocked: system default */ }
  applyTheme(THEMES.includes(t) ? t : "system");
  document.getElementById("theme-btn").addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme") || "system";
    const next = THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length];
    applyTheme(next);
    try { localStorage.setItem("pp-theme", next); } catch { /* not persisted */ }
  });
}
function wireFresh() {
  const nadac = (DATA.snapshotAsOf || "").slice(0, 10);
  const el = document.getElementById("fresh");
  el.innerHTML = `NADAC <time datetime="${esc(nadac)}">${esc(formatIsoDate(nadac))}</time> · snapshot <time datetime="${esc(DATA.generatedAt)}">${esc(formatIsoDate(DATA.generatedAt).replace(/, \d{4}$/, ""))}</time>`;
  tooltip(el, `<strong>Two dates.</strong> NADAC: when the weekly price file was taken. Snapshot: when this demo froze its data from the app's API.`);
}

// ---- Router ----
function render() {
  const hash = location.hash.slice(1) || "/";
  const [pathPart, query = ""] = hash.split("?");
  const drug = /^\/drug\/(.+)$/.exec(pathPart);
  if (drug) drugView(decodeURIComponent(drug[1]));
  else if (pathPart === "/search") searchView(new URLSearchParams(query).get("q") ?? "");
  else homeView();
}
function route() {
  // View transitions as progressive enhancement only.
  if (document.startViewTransition && !reduced()) document.startViewTransition(render);
  else render();
  window.scrollTo(0, 0);
  if (location.hash) main.focus({ preventScroll: true });
}

async function start() {
  wireTheme();
  bindSearchShortcut();
  try {
    DATA = await (await fetch("data.json")).json();
  } catch {
    main.innerHTML = `<p class="reason">The demo's data file didn't load. Reload the page to try again.</p>`;
    return;
  }
  wireFresh();
  const asOf = formatIsoDate((DATA.snapshotAsOf || "").slice(0, 10));
  document.getElementById("demo-note-text").innerHTML =
    `<strong>Static demo.</strong> ${Object.keys(DATA.drugs).length} real drugs, frozen from the app's own GraphQL API on ${esc(formatIsoDate(DATA.generatedAt))} (NADAC prices as of ${esc(asOf)}). ` +
    `The real app is server-rendered and searches all of RxNorm. <a href="https://github.com/efriedla/Pill-Price#readme">How it works</a>`;
  window.addEventListener("hashchange", route);
  route();
}

start();
