// Pill Price, static demo. Renders data.json (frozen from the real app's own
// GraphQL API by scripts/build-demo-data.ts) with hash routes:
//   #/                  home
//   #/search?q=term     search
//   #/drug/<rxcui>      a drug
// The formatting helpers below are ports of the app's, not approximations:
// money stays a decimal string and dates stay calendar dates.

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
function unitLabel(unit) {
  return { EA: "per unit", ML: "per mL", GM: "per gram" }[unit] ?? `per ${unit}`;
}

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
const CLAMP_AFTER_CHARS = 220;

// ---- Helpers ----
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const has = (rxcui) => Boolean(DATA.drugs[rxcui]);
const drugHref = (rxcui) => `#/drug/${encodeURIComponent(rxcui)}`;

function priceLine(price, size = "large") {
  if (price.__typename === "Price") {
    return `<p class="price ${size}"><span class="fig">$${esc(roundDecimalString(price.pricePerUnit))}</span>` +
      `<span class="qual">${esc(unitLabel(price.unit))} · as of ${esc(formatIsoDate(price.effectiveDate))}</span></p>`;
  }
  return `<p class="reason ${size === "small" ? "small" : ""}">${esc(price.reason)}</p>`;
}

function shortFig(price) {
  return price?.__typename === "Price" ? `$${roundDecimalString(price.pricePerUnit)}` : "—";
}

function setTitle(t) { document.title = t ? `${t} · Pill Price demo` : "Pill Price — static demo"; }

// ---- Views ----
function homeView() {
  setTitle("");
  const chips = DATA.terms.map((t) => `<li><a href="#/search?q=${encodeURIComponent(t)}">${esc(t)}</a></li>`).join("");

  // Generic and brand side by side, from the frozen data. No difference is
  // computed: ui-spec §5 forbids arithmetic on money; the reader compares.
  const pairs = [];
  for (const d of Object.values(DATA.drugs)) {
    if (!d.isGeneric || d.price.__typename !== "Price") continue;
    const brand = (d.alternatives.drugs || []).find((a) => !a.isGeneric && a.price?.__typename === "Price");
    const ingredient = d.ingredients.ingredients?.[0]?.name;
    if (brand && pairs.length < 4 && !pairs.some((p) => p.ingredient === ingredient)) pairs.push({ d, brand, ingredient });
  }
  const pairHtml = pairs.map(({ d, brand }) => `
    <li><a href="${drugHref(d.rxcui)}">
      <div class="row"><span>${esc(d.name)}</span><span class="fig">${esc(shortFig(d.price))}</span></div>
      <div class="row muted"><span>${esc(brand.name.replace(/^.*\[/, "[").replace(/[[\]]/g, ""))} (brand)</span><span class="fig">${esc(shortFig(brand.price))}</span></div>
    </a></li>`).join("");

  main.innerHTML = `
    <section class="hero">
      <h1>What pharmacies pay for a drug.</h1>
      <p class="lede">Search a drug, then see its NADAC acquisition cost, its brand and generic versions with their own prices, and its FDA label. Every figure carries its unit and its date.</p>
      <p class="notice"><strong>This is an acquisition cost, not a retail price.</strong> NADAC reports what pharmacies pay to buy a drug, not what you pay at the counter, and not an insurance price.</p>
      <form class="search" role="search" id="home-search">
        <label for="q">Search by drug name</label>
        <input id="q" name="q" type="search" placeholder="e.g. atorvastatin, Lipitor" autocomplete="off">
      </form>
      <ul class="chips" aria-label="Try a search">${chips}</ul>
    </section>

    ${pairs.length ? `<section class="compare-strip" aria-labelledby="pairs-h">
      <h2 id="pairs-h">Generic and brand, per unit</h2>
      <ul class="pairs">${pairHtml}</ul>
    </section>` : ""}

    <ul class="stats" aria-label="Measured">
      <li><strong>22 ms</strong><span>p95 API response, cached drug</span></li>
      <li><strong>100</strong><span>Lighthouse accessibility, mobile and desktop</span></li>
      <li><strong>93 / 93</strong><span>tab stops with a visible focus ring</span></li>
      <li><strong>12</strong><span>decision records, written before the code</span></li>
    </ul>

    <section class="how" aria-label="How the real app works">
      <div><h2>Three sources, one API</h2><p>A GraphQL backend-for-frontend over RxNorm, openFDA and NADAC. Every missing value says which source is missing it, and whether that is a fact or a failure.</p></div>
      <div><h2>Static where it can be</h2><p>Next.js partial prerendering: an instant shell, then price, versions and label stream in independently. A drug is static after its first visit.</p></div>
      <div><h2>Prices off the request path</h2><p>A weekly job froze ~1M NADAC rows into a snapshot on a data branch. Money is a decimal string end to end, never a float.</p></div>
    </section>`;

  document.getElementById("home-search").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = document.getElementById("q").value.trim();
    if (q) location.hash = `#/search?q=${encodeURIComponent(q)}`;
  });
}

function searchView(q) {
  setTitle(q ? `“${q}”` : "Search");
  const term = q.trim().toLowerCase();
  // A frozen term shows the real app's full result list. Anything else
  // searches the drugs in this demo, and says that is what it did.
  const frozen = DATA.searches[term];
  const hits = frozen ?? Object.values(DATA.drugs)
    .filter((d) => d.name.toLowerCase().includes(term))
    .map((d) => ({ rxcui: d.rxcui, name: d.name, isGeneric: d.isGeneric }));

  const row = (h) => {
    const d = DATA.drugs[h.rxcui];
    const side = !d ? `<span class="side">not in this demo</span>`
      : d.price.__typename === "Price" ? `<span class="side"><span class="fig">${esc(shortFig(d.price))}</span> ${esc(unitLabel(d.price.unit))}</span>`
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

  const count = !term ? ""
    : frozen ? `${hits.length} products match “${esc(q)}” in RxNorm. ${inDemo} of them are in this demo.`
    : hits.length ? `${hits.length} drugs in this demo match “${esc(q)}”. The real app searches all of RxNorm.`
    : `No drug in this demo matches “${esc(q)}”. The demo holds ${Object.keys(DATA.drugs).length} drugs; the real app searches all of RxNorm. Try one of: ${DATA.terms.slice(0, 5).map((t) => `<a href="#/search?q=${encodeURIComponent(t)}">${esc(t)}</a>`).join(", ")}.`;

  main.innerHTML = `
    <h1 class="sr-only">Search drugs</h1>
    <form class="search" role="search" id="s-form">
      <label for="q">Search by drug name</label>
      <input id="q" name="q" type="search" value="${esc(q)}" autocomplete="off">
    </form>
    <p class="count" aria-live="polite">${count}</p>
    ${group("Generic", generic)}${group("Brand", brand)}`;

  document.getElementById("s-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = document.getElementById("q").value.trim();
    location.hash = `#/search?q=${encodeURIComponent(v)}`;
  });
}

function drugView(rxcui) {
  const d = DATA.drugs[rxcui];
  if (!d) {
    setTitle("Not in this demo");
    main.innerHTML = `<h1 class="drug">Not in this demo</h1><p class="reason">This static demo holds ${Object.keys(DATA.drugs).length} drugs, and RxCUI ${esc(rxcui)} is not one of them. The real app looks up any drug in RxNorm.</p><p><a href="#/">Back to the start</a></p>`;
    return;
  }
  setTitle(d.name);

  const ing = d.ingredients.__typename === "Ingredients" ? d.ingredients.ingredients.map((i) => esc(i.name)).join(", ") : esc(d.ingredients.reason);
  const form = d.doseForm.__typename === "DoseForm" ? esc(d.doseForm.name) : esc(d.doseForm.reason);

  // Back to a search that lists this drug: the term it was frozen under, or
  // else its first ingredient.
  const backTerm = DATA.terms.find((t) => d.name.toLowerCase().includes(t))
    ?? (d.ingredients.ingredients?.[0]?.name ?? d.name).split(" ")[0].toLowerCase();

  let versions;
  if (d.alternatives.__typename === "Alternatives" && d.alternatives.drugs.length) {
    versions = `<p class="caveat">Same ingredients, strength and form as ${esc(d.name)}. Not a substitution recommendation — talk to a pharmacist.</p>
      <ul class="versions">${d.alternatives.drugs.map((a) => `
        <li>${has(a.rxcui) ? `<a class="nm" href="${drugHref(a.rxcui)}">${esc(a.name)}</a>` : `<span class="nm">${esc(a.name)}</span>`}<span class="kind">${a.isGeneric ? "Generic" : "Brand"}</span>
        ${priceLine(a.price, "small")}</li>`).join("")}</ul>`;
  } else {
    versions = `<p class="reason">${esc(d.alternatives.reason ?? "RxNorm lists no other products for this drug.")}</p>`;
  }

  let label;
  const L = d.label;
  if (L.__typename === "Label") {
    const daily = `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${encodeURIComponent(L.setId)}`;
    const date = formatIsoDate(L.effectiveDate);
    label = `<p class="label-src">Label: ${esc(L.productName)}, from ${esc(L.manufacturer)} · updated ${esc(date)}. ${esc(WHY[L.chosenBy] ?? "")} <a href="${daily}">Full label on DailyMed</a></p>` +
      L.sections.map((s, i) => {
        const title = SECTION_TITLES[s.kind] ?? s.kind;
        const boxed = s.kind === "BOXED_WARNING";
        const text = s.paragraphs.join(" ");
        const clamp = !boxed && text.length > CLAMP_AFTER_CHARS;
        const id = `sec-${i}`;
        return `<section class="label-sec ${boxed ? "boxed" : ""}" aria-labelledby="${id}-h">
          <h3 id="${id}-h">${esc(title)}</h3>
          <p class="prose ${clamp ? "clamped" : ""}" id="${id}">${esc(text)}</p>
          ${clamp ? `<button type="button" aria-expanded="false" aria-controls="${id}" data-clamp="${id}">Show more<span class="sr-only">: ${esc(title)}</span></button>` : ""}
          <p class="label-src">Source: FDA label · updated ${esc(date)}${s.trimmed ? " · shortened for this demo" : ""}</p>
        </section>`;
      }).join("");
  } else {
    label = `<p class="reason">${esc(L.reason)}</p>`;
  }

  main.innerHTML = `
    <article class="drug">
      <a class="back" href="#/search?q=${encodeURIComponent(backTerm)}">← Search “${esc(backTerm)}”</a>
      <p class="notice"><strong>This is an acquisition cost, not a retail price.</strong> NADAC reports what pharmacies pay to buy a drug, not what you pay at the counter, and not an insurance price.</p>
      <h1>${esc(d.name)}</h1>
      <p class="rxcui">rxcui ${esc(d.rxcui)}</p>
      ${priceLine(d.price)}
      <section class="sect" aria-labelledby="det-h"><h2 class="eyebrow" id="det-h">Details</h2>
        <dl class="facts"><div><dt>Active ingredient</dt><dd>${ing}</dd></div><div><dt>Dosage form</dt><dd>${form}</dd></div></dl>
      </section>
      <section class="sect" aria-labelledby="ver-h"><h2 class="eyebrow" id="ver-h">Brand and generic versions</h2>${versions}</section>
      <section class="sect" aria-labelledby="lab-h"><h2 class="eyebrow" id="lab-h">Label</h2>${label}</section>
    </article>`;

  main.querySelectorAll("button[data-clamp]").forEach((b) => b.addEventListener("click", () => {
    const p = document.getElementById(b.dataset.clamp);
    const open = b.getAttribute("aria-expanded") === "true";
    b.setAttribute("aria-expanded", String(!open));
    p.classList.toggle("clamped", open);
    b.firstChild.textContent = open ? "Show more" : "Show less";
  }));
}

// ---- Router ----
function route() {
  const hash = location.hash.slice(1) || "/";
  const [pathPart, query = ""] = hash.split("?");
  const params = new URLSearchParams(query);
  const drug = /^\/drug\/(.+)$/.exec(pathPart);
  if (drug) drugView(decodeURIComponent(drug[1]));
  else if (pathPart === "/search") searchView(params.get("q") ?? "");
  else homeView();
  window.scrollTo(0, 0);
  if (location.hash) main.focus({ preventScroll: true });
}

async function start() {
  try {
    DATA = await (await fetch("data.json")).json();
  } catch {
    main.innerHTML = `<p class="reason">The demo's data file didn't load. Reload the page to try again.</p>`;
    return;
  }
  const asOf = formatIsoDate((DATA.snapshotAsOf || "").slice(0, 10));
  document.getElementById("demo-note-text").innerHTML =
    `<strong>Static demo.</strong> ${Object.keys(DATA.drugs).length} real drugs, frozen from the app's own GraphQL API on ${esc(formatIsoDate(DATA.generatedAt))} (NADAC prices as of ${esc(asOf)}). ` +
    `The real app is server-rendered and searches all of RxNorm. <a href="https://github.com/efriedla/Pill-Price#readme">How it works</a>`;
  window.addEventListener("hashchange", route);
  route();
}

start();
