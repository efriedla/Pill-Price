// Exact decimal arithmetic on price strings, for the demo's computed figures
// (multiples and "what $100 buys"). Strings in, strings out, with BigInt
// fixed-point in between: a float would round "8.14515" the wrong way, the
// bug the app's own roundDecimalString exists to avoid.
//
// The real app does no arithmetic on money (ui-spec §5). The demo does, by
// the author's decision of 2026-11-05, recorded in ui-spec §5.

const SCALE = 12; // NADAC publishes at most 5 decimals; 12 leaves room for division.
const ONE = 10n ** BigInt(SCALE);

/** "0.0101" -> 10100000000n (value × 10^12). Throws on anything but a plain decimal. */
export function toUnits(value) {
  const m = /^(\d+)(?:\.(\d*))?$/.exec(String(value).trim());
  if (!m) throw new Error(`not a decimal: ${value}`);
  const [, whole, frac = ""] = m;
  return BigInt(whole) * ONE + BigInt((frac + "0".repeat(SCALE)).slice(0, SCALE));
}

/** -1, 0 or 1. */
export function cmp(a, b) {
  const x = toUnits(a), y = toUnits(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** a / b as a decimal string with `places` decimals, rounded half-up. */
export function div(a, b, places) {
  const x = toUnits(a), y = toUnits(b);
  if (y === 0n) throw new Error("division by zero");
  const p = 10n ** BigInt(places);
  // (x / y) × 10^places, rounded half-up: (2·x·p + y) / (2·y)
  const scaled = (2n * x * p + y) / (2n * y);
  const s = scaled.toString().padStart(places + 1, "0");
  return places ? `${s.slice(0, -places)}.${s.slice(-places)}` : s;
}

/** floor(a / b) as an integer string: how many whole units `a` dollars buys. */
export function floorDiv(a, b) {
  const y = toUnits(b);
  if (y === 0n) throw new Error("division by zero");
  return (toUnits(a) / y).toString();
}

/** Thousands separators on an integer or decimal string, without Number(). */
export function group(s) {
  const [i, f] = String(s).split(".");
  const g = i.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return f === undefined ? g : `${g}.${f}`;
}

/** A multiple for display: one decimal under 10 ("4.7"), whole above ("861"). */
export function fmtMultiple(a, b) {
  const one = div(a, b, 1);
  return cmp(one, "10") < 0 ? one : group(div(a, b, 0));
}
