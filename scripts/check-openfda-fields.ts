/**
 * openFDA field-name check — ADR-010, the build-time half of the 404 guard.
 *
 * Usage: npm run check:openfda-fields
 *
 * Asserts that every field name in `OPENFDA_QUERIED_FIELDS` still exists
 * upstream, and exits non-zero when one does not. This is what makes `absent` a
 * conclusion at request time: a query against a renamed field 404s *identically*
 * to a drug with no label, so the only place to catch it is before the code
 * ships. It costs one request per field, once per run — not one per 404, which
 * is when the 1,000/day budget is tightest.
 *
 * **How a field is proved to exist.** Measured against the live API on
 * 2026-09-04, `count=<field>` gives three distinguishable answers:
 *
 *   200 + `meta`                     the field exists and is countable
 *   500 `illegal_argument_exception` the field exists but is a text field, which
 *                                    Elasticsearch will only aggregate in its
 *                                    `.exact` form — still proof of existence
 *   404 `Nothing to count`           the field cannot be counted, which is not
 *                                    the same as not existing (see below)
 *
 * The middle case is why this retries rather than trusting the first answer:
 * `count=openfda.rxcui` 500s while `count=openfda.rxcui.exact` succeeds, and a
 * checker that read the 500 as failure would fail on every `openfda.*` field.
 *
 * **`count=` alone is not enough, and ADR-010 understates this.** The long
 * narrative fields — `indications_and_usage`, `warnings`, `description` and the
 * rest — are analysed text with no keyword sub-field, so *neither* form can be
 * counted: `count=indications_and_usage` and `count=indications_and_usage.exact`
 * both return "Nothing to count", identically to a fabricated field. A
 * count-only check reports six live fields as gone.
 *
 * So an uncountable field falls back to `search=_exists_:<field>`, which
 * separates them cleanly: `_exists_:indications_and_usage` matches 253,295
 * labels while `_exists_:nonsense_field` returns "No matches found!". The
 * fallback assumes a real field is populated somewhere in the corpus — true of
 * every field here by six orders of magnitude, and false only for a field that
 * exists in the mapping but is set on no document at all, which we would have no
 * reason to read anyway.
 */
import {
  OPENFDA_BASE_URL,
  OPENFDA_QUERIED_FIELDS,
} from "../src/server/openfda-client";

type Verdict =
  | { field: string; ok: true; how: "countable" | "text-field" | "populated" }
  | { field: string; ok: false; why: string };

/** openFDA's rate limit is 240/min without a key; this stays well inside it. */
const DELAY_MS = 350;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function query(params: string) {
  const url = `${OPENFDA_BASE_URL}/drug/label.json?${params}&limit=1`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  // openFDA answers errors as JSON with a non-2xx status. Reading the body is
  // safe here and necessary — the status alone does not say which error it is.
  const body: unknown = await res.json().catch(() => null);
  return { status: res.status, body };
}

const countField = (field: string) =>
  query(`count=${encodeURIComponent(field)}`);

/** How many labels carry this field at all. `null` when openFDA errored. */
async function existsCount(field: string): Promise<number | null> {
  const { body } = await query(`search=_exists_:${encodeURIComponent(field)}`);
  if (readError(body)) return null;
  const total = (body as { meta?: { results?: { total?: unknown } } } | null)
    ?.meta?.results?.total;
  return typeof total === "number" ? total : null;
}

function readError(body: unknown): { code: string; message: string } | null {
  if (typeof body !== "object" || body === null || !("error" in body))
    return null;
  const err = (body as { error: unknown }).error;
  if (typeof err !== "object" || err === null) return null;
  const { code, message } = err as { code?: unknown; message?: unknown };
  return {
    code: typeof code === "string" ? code : "",
    message: typeof message === "string" ? message : "",
  };
}

const isTextFieldComplaint = (body: unknown) =>
  (readError(body)?.message ?? "").includes("illegal_argument_exception") ||
  JSON.stringify(body ?? "").includes("illegal_argument_exception");

async function checkField(field: string): Promise<Verdict> {
  const first = await countField(field);
  if (first.status === 200 && !readError(first.body)) {
    return { field, ok: true, how: "countable" };
  }

  // A text field is not countable raw. Its `.exact` form is, and openFDA only
  // offers `.exact` for a field it knows — so this distinguishes "text" from
  // "gone" without trusting the 500's wording alone.
  if (isTextFieldComplaint(first.body) || first.status >= 500) {
    await sleep(DELAY_MS);
    const exact = await countField(`${field}.exact`);
    if (exact.status === 200 && !readError(exact.body)) {
      return { field, ok: true, how: "text-field" };
    }
    await sleep(DELAY_MS);
    return orExists(
      field,
      `neither ${field} nor ${field}.exact could be counted (${exact.status} ${readError(exact.body)?.message ?? "no message"})`,
    );
  }

  const err = readError(first.body);
  await sleep(DELAY_MS);
  return orExists(
    field,
    `${first.status} ${err?.code ?? "?"}: ${err?.message ?? "no message"}`,
  );
}

/**
 * Last resort for a field `count=` cannot speak about: is it set on any label?
 *
 * A populated field exists, whatever the aggregation says. Only a field that is
 * both uncountable *and* present on nothing is reported gone.
 */
async function orExists(field: string, countWhy: string): Promise<Verdict> {
  const total = await existsCount(field);
  if (total !== null && total > 0) return { field, ok: true, how: "populated" };
  return {
    field,
    ok: false,
    why: `${countWhy}; and _exists_:${field} matched ${total ?? "an error"}`,
  };
}

async function main() {
  console.log(
    `checking ${OPENFDA_QUERIED_FIELDS.length} openFDA field names against ${OPENFDA_BASE_URL}\n`,
  );

  const verdicts: Verdict[] = [];
  for (const field of OPENFDA_QUERIED_FIELDS) {
    const verdict = await checkField(field);
    verdicts.push(verdict);
    console.log(
      verdict.ok
        ? `  ok    ${field}${
            verdict.how === "text-field"
              ? "  (text field, verified via .exact)"
              : verdict.how === "populated"
                ? "  (uncountable narrative field, verified via _exists_)"
                : ""
          }`
        : `  GONE  ${field} — ${verdict.why}`,
    );
    await sleep(DELAY_MS);
  }

  const gone = verdicts.filter((v) => !v.ok);
  if (gone.length > 0) {
    console.error(
      `\n${gone.length} openFDA field name(s) no longer exist.\n` +
        `Until this is fixed, every 404 from those queries is indistinguishable from a\n` +
        `drug with no label, and the page will silently show "no label" for drugs that\n` +
        `have one. Fix the field names, or update OPENFDA_QUERIED_FIELDS if we genuinely\n` +
        `stopped using them. See ADR-010.`,
    );
    process.exit(1);
  }

  console.log(`\nall ${verdicts.length} field names still exist.`);
}

main().catch((err: unknown) => {
  // A network failure is not the same as a renamed field, and must not be
  // reported as one — but it still fails the run, because an unverified field
  // list is exactly what this check exists to prevent shipping.
  console.error("\nopenFDA field check could not complete:", err);
  process.exit(1);
});
