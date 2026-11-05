// The redesign's widgets (docs/design/demo-redesign.md). Each takes its data
// as arguments and fetches nothing. Each is keyboard-operable and exposes its
// data as text: no information lives only in SVG.

import { cmp, div, floorDiv, fmtMultiple, group } from "./decimal.js";

export const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ---------------------------------------------------------------------------
// Tooltip: one shared element, shown on hover and on focus, role="tooltip",
// tied to its trigger with aria-describedby.
let tipEl;
export function tooltip(trigger, html) {
  if (!tipEl) {
    tipEl = document.createElement("div");
    tipEl.className = "tip"; tipEl.id = "tip"; tipEl.setAttribute("role", "tooltip"); tipEl.hidden = true;
    document.body.append(tipEl);
    addEventListener("keydown", (e) => { if (e.key === "Escape") tipEl.hidden = true; });
  }
  let timer;
  const show = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      tipEl.innerHTML = typeof html === "function" ? html() : html;
      tipEl.hidden = false;
      const r = trigger.getBoundingClientRect();
      const t = tipEl.getBoundingClientRect();
      const left = Math.min(Math.max(8, r.left + r.width / 2 - t.width / 2), innerWidth - t.width - 8);
      const top = r.top - t.height - 8 < 8 ? r.bottom + 8 : r.top - t.height - 8;
      tipEl.style.left = `${left + scrollX}px`; tipEl.style.top = `${top + scrollY}px`;
      trigger.setAttribute("aria-describedby", "tip");
    }, 150);
  };
  const hide = () => { clearTimeout(timer); tipEl.hidden = true; trigger.removeAttribute("aria-describedby"); };
  trigger.addEventListener("mouseenter", show); trigger.addEventListener("focus", show);
  trigger.addEventListener("mouseleave", hide); trigger.addEventListener("blur", hide);
}

// ---------------------------------------------------------------------------
// Count-up stats. The animated digits are aria-hidden; the final value sits in
// a visually hidden span, so a screen reader never hears a partial number.
export function countUp(root) {
  const items = root.querySelectorAll("[data-count]");
  const finish = (el) => { el.querySelector("[aria-hidden]").textContent = el.dataset.final; };
  if (reduced() || !("IntersectionObserver" in window)) { items.forEach(finish); return; }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      const el = e.target, target = Number(el.dataset.count), shown = el.querySelector("[aria-hidden]");
      const t0 = performance.now();
      const tick = (t) => {
        const k = Math.min(1, (t - t0) / 600), eased = 1 - (1 - k) ** 3;
        shown.textContent = el.dataset.final.replace(String(target), String(Math.round(target * eased)));
        if (k < 1) requestAnimationFrame(tick); else finish(el);
      };
      requestAnimationFrame(tick);
    }
  }, { threshold: 0.4 });
  items.forEach((el) => io.observe(el));
}

// ---------------------------------------------------------------------------
// Brand-vs-generic gap bar. The multiple is exact decimal math; the bar width
// converts to Number at the render boundary only.
export function gapBar(genericPrice, brandPrice) {
  const times = fmtMultiple(brandPrice, genericPrice);
  const pct = Math.max(0.6, (Number(genericPrice) / Number(brandPrice)) * 100);
  const sentence = `Per unit, the brand costs ${times} times the generic.`;
  return `<div class="gap" role="img" aria-label="${esc(sentence)}">
    <div class="gap-track" aria-hidden="true"><span class="b"></span><span class="g" style="width:${pct.toFixed(2)}%"></span></div>
    <p class="gap-label" aria-hidden="true">Brand costs <strong>${esc(times)}×</strong> generic</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// Typeahead combobox, after the APG "combobox with listbox popup" pattern.
// ⌘K / Ctrl+K focuses it from anywhere.
export function combobox(root, { items, onPick, onSubmit }) {
  const input = root.querySelector("input");
  const list = root.querySelector("[role=listbox]");
  let matches = [], active = -1;

  const render = () => {
    const q = input.value.trim().toLowerCase();
    matches = q.length < 2 ? [] : items.filter((i) => i.name.toLowerCase().includes(q)).slice(0, 8);
    active = matches.length ? 0 : -1;
    list.innerHTML = matches.map((m, i) => `<li role="option" id="opt-${i}" aria-selected="${i === active}" data-i="${i}">
      <span><span class="nm">${esc(m.name)}</span><br><span class="sub">${esc(m.form)}${m.isGeneric ? " · generic" : " · brand"}</span></span>
      <span class="fig num">${esc(m.priceText)}</span></li>`).join("");
    const open = matches.length > 0;
    list.hidden = !open;
    input.setAttribute("aria-expanded", String(open));
    if (open) input.setAttribute("aria-activedescendant", "opt-0");
    else input.removeAttribute("aria-activedescendant");
  };
  const move = (d) => {
    if (!matches.length) return;
    active = (active + d + matches.length) % matches.length;
    list.querySelectorAll("[role=option]").forEach((o, i) => o.setAttribute("aria-selected", String(i === active)));
    input.setAttribute("aria-activedescendant", `opt-${active}`);
    list.querySelector(`#opt-${active}`)?.scrollIntoView({ block: "nearest" });
  };
  const close = () => { list.hidden = true; input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant"); };

  input.addEventListener("input", render);
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); if (list.hidden) render(); else move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Escape") { if (!list.hidden) { e.preventDefault(); close(); } else input.value = ""; }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (!list.hidden && active >= 0) onPick(matches[active]); else onSubmit(input.value.trim());
    }
  });
  list.addEventListener("mousedown", (e) => {
    const o = e.target.closest("[role=option]");
    if (o) { e.preventDefault(); onPick(matches[Number(o.dataset.i)]); }
  });
  input.addEventListener("blur", () => setTimeout(close, 100));
  close();
}

export function bindSearchShortcut() {
  addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      const input = document.querySelector(".combo input");
      if (input) { e.preventDefault(); input.focus(); input.select(); }
    }
  });
}

// ---------------------------------------------------------------------------
// A row of links with one tab stop and arrow-key movement (roving tabindex).
export function roving(list) {
  const links = [...list.querySelectorAll("a")];
  links.forEach((a, i) => a.setAttribute("tabindex", i === 0 ? "0" : "-1"));
  list.addEventListener("keydown", (e) => {
    const i = links.indexOf(document.activeElement);
    if (i < 0) return;
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: links.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const j = (next + links.length) % links.length;
    links[i].setAttribute("tabindex", "-1"); links[j].setAttribute("tabindex", "0"); links[j].focus();
    links[j].scrollIntoView({ block: "nearest", inline: "nearest" });
  });
}

// ---------------------------------------------------------------------------
// "What does $100 buy?" Counts are floor(amount / unit price), exact.
const DOT_CAP = 500;
export function nounFor(form, n) {
  const one = n === "1";
  if (/tablet/i.test(form)) return one ? "tablet" : "tablets";
  if (/capsule/i.test(form)) return one ? "capsule" : "capsules";
  return one ? "unit" : "units";
}
function dotMatrix(count, cls) {
  const n = Math.min(Number(count), DOT_CAP), cols = 25, r = 4, gap = 11;
  const rows = Math.max(1, Math.ceil(n / cols));
  let dots = "";
  for (let i = 0; i < n; i++) dots += `<circle cx="${(i % cols) * gap + 6}" cy="${Math.floor(i / cols) * gap + 6}" r="${r}" class="${cls}"/>`;
  return `<svg viewBox="0 0 ${cols * gap + 1} ${rows * gap + 1}" aria-hidden="true" focusable="false">${dots}</svg>`;
}
export function buyWidget(root, pairs, asOf) {
  const sel = root.querySelector("select"), range = root.querySelector("input[type=range]"), num = root.querySelector("input[type=number]");
  const out = root.querySelector("output"), mats = root.querySelector(".matrices");
  const draw = () => {
    const amount = String(Math.min(1000, Math.max(1, Math.round(Number(num.value) || 1))));
    const { d, brand } = pairs[Number(sel.value)];
    const form = d.doseForm.name ?? "";
    const g = floorDiv(amount, d.price.pricePerUnit), b = floorDiv(amount, brand.price.pricePerUnit);
    const brandName = brand.name.match(/\[(.+)\]/)?.[1] ?? brand.name;
    out.innerHTML = `At NADAC, <strong>$${group(amount)}</strong> buys <strong class="t-generic">${group(g)} ${nounFor(form, g)}</strong> of generic ${esc(d.name)}, or <strong class="t-brand">${group(b)} ${nounFor(form, b)}</strong> of ${esc(brandName)}.`;
    const cap = (n) => (Number(n) > DOT_CAP ? `${DOT_CAP} shown of ${group(n)}` : `${group(n)} shown`);
    mats.innerHTML = `
      <div class="matrix"><h3><span class="swatch generic" aria-hidden="true"></span>Generic</h3>${dotMatrix(g, "dg")}<p class="cap" aria-hidden="true">${cap(g)}</p></div>
      <div class="matrix"><h3><span class="swatch brand" aria-hidden="true"></span>${esc(brandName)}</h3>${dotMatrix(b, "db")}<p class="cap" aria-hidden="true">${cap(b)}</p></div>`;
    root.querySelector(".caption").textContent = `Whole units, computed from NADAC's published prices before rounding for display: $${d.price.pricePerUnit} and $${brand.price.pricePerUnit} per unit, as of ${asOf(d.price.effectiveDate)}. Acquisition cost, not what a patient pays.`;
  };
  range.addEventListener("input", () => { num.value = range.value; draw(); });
  num.addEventListener("input", () => { if (num.value !== "") range.value = num.value; draw(); });
  num.addEventListener("change", () => { num.value = String(Math.min(1000, Math.max(1, Math.round(Number(num.value) || 1)))); range.value = num.value; draw(); });
  sel.addEventListener("change", draw);
  draw();
}

// ---------------------------------------------------------------------------
// Price landscape: every priced drug on a log scale, lanes by form. Each dot
// is a link with an accessible name; "View as table" swaps in a sortable
// table of the same rows.
export function laneOf(form) {
  if (/capsule/i.test(form)) return "Capsules";
  if (/tablet/i.test(form)) return "Tablets";
  return "Other forms";
}
export function landscape(root, rows, { showBrand, fmt, href }) {
  const W = 900, H = 330, L = 96, R = 20, T = 18, B = 44;
  const lanes = ["Tablets", "Capsules", "Other forms"];
  const laneH = (H - T - B) / lanes.length;
  const prices = rows.map((r) => Number(r.price));
  const lo = Math.floor(Math.log10(Math.min(...prices))), hi = Math.ceil(Math.log10(Math.max(...prices)));
  const x = (p) => L + ((Math.log10(Number(p)) - lo) / (hi - lo)) * (W - L - R);
  // Beeswarm: each generic sits on its lane's centre line and steps up or
  // down only as far as it must to clear the dots already placed. A brand
  // sits on its generic's row, so the line joining them is horizontal and its
  // length is the gap on the log scale. Deterministic: no randomness.
  const DOT = 6, STEP = 2 * DOT + 1;
  const byRx0 = Object.fromEntries(rows.map((r) => [r.rxcui, r]));
  const placedY = {};
  for (const lane of lanes) {
    const mid = T + lanes.indexOf(lane) * laneH + laneH / 2, limit = laneH / 2 - DOT;
    const placed = [];
    const owners = rows.filter((r) => (r.isGeneric || !byRx0[r.genericOf]) && r.lane === lane)
      .sort((a, b) => Number(a.price) - Number(b.price));
    for (const r of owners) {
      const px = x(r.price);
      let yy = mid;
      for (let k = 0; k < 40; k++) {
        const dy = (k % 2 ? -1 : 1) * Math.ceil(k / 2) * (STEP / 2);
        if (Math.abs(dy) > limit) continue;
        if (placed.every(([qx, qy]) => Math.hypot(px - qx, mid + dy - qy) >= STEP)) { yy = mid + dy; break; }
      }
      placed.push([px, yy]);
      placedY[r.rxcui] = yy;
    }
  }
  const y = (r) => placedY[!r.isGeneric && byRx0[r.genericOf] ? r.genericOf : r.rxcui];

  let grid = "";
  for (let e = lo; e <= hi; e++) {
    const gx = x(10 ** e);
    grid += `<line class="gridline" x1="${gx}" x2="${gx}" y1="${T}" y2="${H - B}"/><text x="${gx}" y="${H - B + 18}" text-anchor="middle">$${10 ** e >= 1 ? 10 ** e : (10 ** e).toFixed(-e)}</text>`;
  }
  const laneLabels = lanes.map((l, i) => `<text class="lane-label" x="${L - 12}" y="${T + i * laneH + laneH / 2 + 4}" text-anchor="end">${l}</text>`).join("");
  const byRx = Object.fromEntries(rows.map((r) => [r.rxcui, r]));
  const visible = rows.filter((r) => r.isGeneric || showBrand);
  const links = showBrand ? rows.filter((r) => !r.isGeneric && r.genericOf && byRx[r.genericOf])
    .map((r) => { const g = byRx[r.genericOf]; return `<line class="link" x1="${x(g.price)}" y1="${y(g)}" x2="${x(r.price)}" y2="${y(r)}"/>`; }).join("") : "";
  const dots = visible.map((r) => `<a href="${href(r.rxcui)}" data-rx="${r.rxcui}" aria-label="${esc(`${r.name}, ${r.isGeneric ? "generic" : "brand"}, ${fmt(r.price)} per unit`)}">
      <circle class="${r.isGeneric ? "g" : "b"}" cx="${x(r.price).toFixed(1)}" cy="${y(r).toFixed(1)}" r="6"/></a>`).join("");

  root.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="group" aria-label="Price landscape: ${visible.length} drugs by NADAC price per unit, log scale">
      <g class="axis" aria-hidden="true">${grid}${laneLabels}<text x="${(L + W - R) / 2}" y="${H - 6}" text-anchor="middle">NADAC price per unit (log scale)</text></g>
      <g aria-hidden="true">${links}</g>${dots}</svg>`;
  root.querySelectorAll("a[data-rx]").forEach((a) => {
    const r = byRx[a.dataset.rx];
    tooltip(a, () => `<strong>${esc(r.name)}</strong><br>${r.isGeneric ? "Generic" : "Brand"} · <span class="num">${esc(fmt(r.price))}</span> per unit`);
  });
}

// ---------------------------------------------------------------------------
// Sortable table: header buttons, aria-sort on the active column. Prices sort
// with decimal compare, never Number().
export function sortableTable(root, { columns, rows, rowHtml, initial }) {
  let sort = initial;
  const draw = () => {
    const c = columns.find((k) => k.key === sort.key);
    const sorted = [...rows].sort((a, b) => sort.dir * c.compare(a, b));
    root.innerHTML = `<table class="data"><thead><tr>${columns.map((k) => {
      const on = k.key === sort.key;
      return `<th scope="col" class="${k.num ? "n" : ""}" ${on ? `aria-sort="${sort.dir > 0 ? "ascending" : "descending"}"` : ""}>
        <button type="button" data-k="${k.key}">${esc(k.label)}<span class="arr" aria-hidden="true">${on ? (sort.dir > 0 ? "▲" : "▼") : "↕"}</span></button></th>`;
    }).join("")}</tr></thead><tbody>${sorted.map(rowHtml).join("")}</tbody></table>`;
    root.querySelectorAll("th button").forEach((b) => b.addEventListener("click", () => {
      sort = { key: b.dataset.k, dir: sort.key === b.dataset.k ? -sort.dir : 1 };
      draw();
      root.querySelector(`th button[data-k="${sort.key}"]`).focus();
    }));
  };
  draw();
  return { setRows(r) { rows = r; draw(); } };
}
export const byPrice = (a, b) => {
  if (!a.price && !b.price) return 0;
  if (!a.price) return 1;
  if (!b.price) return -1;
  return cmp(a.price, b.price);
};

// ---------------------------------------------------------------------------
// Tabs, after the APG tabs pattern: arrows, Home and End move and select.
export function tabs(root) {
  const tabEls = [...root.querySelectorAll("[role=tab]")];
  const select = (t, focus) => {
    tabEls.forEach((x) => {
      const on = x === t;
      x.setAttribute("aria-selected", String(on)); x.tabIndex = on ? 0 : -1;
      document.getElementById(x.getAttribute("aria-controls")).hidden = !on;
    });
    if (focus) t.focus();
  };
  tabEls.forEach((t, i) => {
    t.addEventListener("click", () => select(t));
    t.addEventListener("keydown", (e) => {
      const j = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabEls.length - 1 }[e.key];
      if (j === undefined) return;
      e.preventDefault(); select(tabEls[(j + tabEls.length) % tabEls.length], true);
    });
  });
}

// ---------------------------------------------------------------------------
export const PILL_EMPTY = `<svg viewBox="0 0 96 96" aria-hidden="true" focusable="false">
  <g transform="rotate(-35 48 48)"><rect x="18" y="34" width="60" height="28" rx="14" fill="var(--accent-quiet)" stroke="var(--accent)" stroke-width="3"/>
  <path d="M48 34v28" stroke="var(--accent)" stroke-width="3"/></g>
  <text x="48" y="58" text-anchor="middle" font-size="30" font-weight="700" fill="var(--accent)" font-family="var(--font-display)">?</text></svg>`;

export { div };
