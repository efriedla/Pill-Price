/**
 * The drug pages prerendered at build (ADR-005 Q3 A).
 *
 * **A named file, so every addition is its own diff with a reason.** Under
 * Next 16.3 an unlisted page is served as an instant App Shell and upgraded to
 * fully static after its first visit, so this list only speeds up the *first*
 * visit per deploy. That makes it a list of pages someone is going to be
 * shown: add a drug when a screenshot, demo or the walkthrough uses it, and
 * say which in the commit.
 *
 * Kept small on purpose: each entry costs openFDA calls on every build, and
 * the build is keyless (1,000 requests/day, ADR-005 finding 6).
 *
 * Under Cache Components this may not be empty: an empty list is a build
 * error (ADR-005 finding 4).
 */
export const PRERENDERED_RXCUIS: readonly [string, ...string[]] = [
  // Metformin ER 500 MG. The repo's reference drug: the 401-NDC fan-out
  // (upstream-notes §1.4), the 22 ms p95 and most of the test fixtures.
  "860975",
];
