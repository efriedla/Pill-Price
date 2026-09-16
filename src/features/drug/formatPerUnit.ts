import type { DrugSummary } from "./types";

/**
 * Round a decimal *string* to four places, half-up, without ever making it a
 * number.
 *
 * This exists because ADR-004 made `pricePerUnit` a `String!` and that decision
 * is only worth anything if the string survives to the point of display.
 * `Number(s).toFixed(4)` re-introduces exactly the error the schema avoided:
 * `"8.14515"` is not representable in binary, lands a hair below the halfway
 * point, and rounds *down* to `8.1451` where decimal half-up gives `8.1452`.
 * `"2.71825"` fails the same way. The digits are pennies per unit today, but a
 * comparison view multiplies them, and the acquisition-cost framing means this
 * app states figures as published rather than as approximated.
 *
 * Anything that is not a plain decimal numeral is returned untouched. The value
 * is Zod-validated at the upstream boundary, so this is a last resort rather
 * than a parser — and echoing an unexpected string is honest, where coercing it
 * to `NaN` or `0` would invent a price.
 */
const DECIMALS = 4;

export function roundDecimalString(value: string): string {
  const match = /^(-?)(\d+)(?:\.(\d*))?$/.exec(value);
  if (!match) return value;

  const [, sign, whole, fraction = ""] = match;

  if (fraction.length <= DECIMALS) {
    return `${sign}${whole}.${fraction.padEnd(DECIMALS, "0")}`;
  }

  const kept = fraction.slice(0, DECIMALS);
  const roundUp = fraction.charCodeAt(DECIMALS) >= "5".charCodeAt(0);
  if (!roundUp) return `${sign}${whole}.${kept}`;

  // Carry digit by digit, so a 9-run like "0.99999" propagates into the whole
  // part without a float — or a `BigInt`, which this tsconfig's target rules
  // out — ever being involved. Digit-wise also means an arbitrarily long
  // numeral is safe, where `Number` would have quietly lost precision.
  const carried = increment(`${whole}${kept}`);
  const cut = carried.length - DECIMALS;
  return `${sign}${carried.slice(0, cut)}.${carried.slice(cut)}`;
}

/** Add one to a string of digits, growing it only on an all-nines carry. */
function increment(digits: string): string {
  const out = digits.split("");
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i] !== "9") {
      out[i] = String(Number(out[i]) + 1);
      return out.join("");
    }
    out[i] = "0";
  }
  return `1${out.join("")}`;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * Render an ISO-8601 calendar date the way ui-spec §9 writes it: `Aug 12, 2026`.
 *
 * **Parsed by parts, never through `Date`.** `new Date("2026-03-18")` is
 * midnight *UTC*, so formatting it in any timezone west of Greenwich yields
 * "Mar 17" — the price would carry the wrong effective date for most of the
 * United States, which is this app's entire audience. NADAC's `effective_date`
 * is a calendar date with no time and no zone; treating it as an instant is the
 * error, and there is nothing to convert.
 *
 * Month names are a fixed table rather than `Intl`, because §9 is a copy rule
 * with one spelling, not a localization requirement.
 *
 * Anything that is not an ISO calendar date is returned untouched, for the same
 * reason `roundDecimalString` echoes: inventing a date is worse than showing an
 * unexpected one.
 */
export function formatIsoDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;

  const [, year, month, day] = match;
  const name = MONTHS[Number(month) - 1];
  if (!name) return value;

  return `${name} ${Number(day)}, ${year}`;
}

/**
 * Renders a NADAC figure with its unit, per ui-spec §9. Never returns a bare
 * number: a price without its unit and date is not a fact this app may state.
 *
 * A missing `price` is the *only* unpriced state, which is what the schema
 * models — ADR-009 makes an absent NADAC row a published fact rather than an
 * unknown, so there is no "priced but undated" case to guard.
 */
export function formatPerUnit(drug: DrugSummary): string {
  const price = drug.price;
  if (!price) {
    return "No NADAC record";
  }
  return `$${roundDecimalString(price.pricePerUnit)} per unit · as of ${formatIsoDate(price.effectiveDate)}`;
}
