import { formatIsoDate } from "@/lib/calendar-date";

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

/**
 * Renders a drug's price line, per ui-spec §9. Never returns a bare number: a
 * price without its unit and date is not a fact this app may state.
 *
 * **Every state has a sentence, and only the priced one is written here.**
 * `price` is a `PriceResult` (ADR-010 amendment, 2026-09-23): when there is no
 * figure, the server says why, in copy the author wrote: NADAC publishing none
 * (`Absent`) or this side failing to load its snapshot (`Unavailable`). This
 * used to return "No NADAC record" for a bare null, which was also what a
 * missing snapshot produced, so a build without prices stated a falsehood.
 * The switch has no default: a fourth member fails to compile here.
 */
export function formatPerUnit(drug: DrugSummary): string {
  const price = drug.price;
  switch (price.__typename) {
    case "Price":
      return `$${roundDecimalString(price.pricePerUnit)} per unit · as of ${formatIsoDate(price.effectiveDate)}`;
    case "Absent":
    case "Unavailable":
      return price.reason;
  }
}
