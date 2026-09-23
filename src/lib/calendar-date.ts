/**
 * Calendar dates, shared by `server/` (which authors sentences containing one)
 * and `features/` (which renders them). Moved here from the drug slice on
 * 2026-09-23 so the two sides cannot drift into two spellings of one date.
 */

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
 * The UTC calendar day of an ISO-8601 instant: `2026-09-11T15:06:56Z` becomes
 * `2026-09-11`. Anything else is returned untouched.
 *
 * For `SnapshotManifest.asOf`, which is an instant (when the job ran), not a
 * calendar date like NADAC's `effective_date`. Taking the UTC day is a choice
 * with a known edge: within a few hours of midnight UTC it can name the day
 * after the one a US reader is living in. The weekly job has run mid-afternoon
 * UTC, so in practice it names the right day. It is still a slice, never a
 * `Date`: nothing here is converted between zones, which is the bug the
 * calendar-date rule exists to stop.
 */
export function utcCalendarDate(instant: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T/.exec(instant);
  return match?.[1] ?? instant;
}
