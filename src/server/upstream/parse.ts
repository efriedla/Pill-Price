import "server-only";

import { z } from "zod";

/**
 * Upstream JSON is untrusted input (roadmap W2). These helpers exist so that
 * every boundary fails the same way, and so that the two things all three
 * upstreams get wrong are handled once rather than per call site:
 *
 * 1. **Absence has more than one encoding.** NADAC uses `""` and `null` in the
 *    same record for the same meaning (upstream-notes §3.4); RxNorm returns
 *    `""` for `synonym` and `umlscui` where the field is simply not there
 *    (§1.3). Parsing these into empty strings pushes the distinction into every
 *    consumer, so they normalise to `null` here, once.
 *
 * 2. **"Not found" is not a status code.** RxNorm answers unknown RxCUIs with
 *    HTTP 200 and `{}` (§1.1). A schema that models the payload as optional
 *    parses that happily, which is exactly the trap. Every not-found case in
 *    this directory is therefore an explicit predicate, never an inference from
 *    a successful parse.
 */

/** Which upstream failed, so an error is actionable without a stack read. */
export type Upstream = "rxnorm" | "openfda" | "nadac";

/**
 * A parse failure is a *contract* failure — the upstream changed shape, or we
 * asked the wrong question. It is deliberately not the same class as a network
 * error, because the two want different responses: retrying a malformed payload
 * just spends the budget again.
 */
export class UpstreamParseError extends Error {
  constructor(
    readonly upstream: Upstream,
    readonly endpoint: string,
    readonly issues: z.core.$ZodIssue[],
  ) {
    const first = issues[0];
    const where = first?.path.join(".") || "(root)";
    super(
      `${upstream} ${endpoint}: response did not match the expected shape at ${where}: ${first?.message ?? "unknown"}`,
    );
    this.name = "UpstreamParseError";
  }
}

/** Parse or throw `UpstreamParseError`. The only way these schemas are used. */
export function parseUpstream<T extends z.ZodType>(
  upstream: Upstream,
  endpoint: string,
  schema: T,
  data: unknown,
): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new UpstreamParseError(upstream, endpoint, result.error.issues);
  }
  return result.data;
}

/**
 * A string field where `""`, `null`, and absent all mean "no value".
 *
 * This is the single most repeated quirk across all three upstreams, and
 * collapsing it here is what lets the resolvers treat `null` as the only
 * absence. Whitespace-only is treated as absent too: it carries no more meaning
 * than `""` and would otherwise render as a blank line in the UI.
 */
export const absentableString = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => {
    const trimmed = v?.trim();
    return trimmed ? trimmed : null;
  });

/**
 * A decimal that stays a string.
 *
 * ADR-004 closed Q6: money is `String` end to end. NADAC ships `"0.02902"` and
 * types the column `decimal(10,5)`; parsing that into an IEEE double in order to
 * serialise it back out is a lossy round-trip bought for nothing. What is worth
 * doing is *validating* it, so a malformed price fails at the boundary rather
 * than reaching a formatter that will render `NaN` next to a dollar sign.
 *
 * `""` and `null` are absence, not zero — a drug with no published price must
 * never read as free.
 */
export const decimalString = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => {
    const trimmed = v?.trim();
    return trimmed ? trimmed : null;
  })
  .refine((v) => v === null || /^-?\d+(\.\d+)?$/.test(v), {
    message: "expected a decimal string, or an empty encoding of absent",
  });

/**
 * An ISO `YYYY-MM-DD` date, kept as a string.
 *
 * Dates are not parsed into `Date` at the boundary for the same reason prices
 * are not parsed into numbers: `new Date("2026-03-18")` is UTC midnight, which
 * renders as the 17th for anyone west of Greenwich. These are *published
 * effective dates*, not instants, and they have no timezone to be converted to.
 */
export const isoDateString = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => {
    const trimmed = v?.trim();
    return trimmed ? trimmed : null;
  })
  .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), {
    message: "expected YYYY-MM-DD, or an empty encoding of absent",
  });
