# ADR-015: What `Label` is (Q2)

**Status:** proposed — options only, no decision
**Date:** 2026-09-23

<!-- Roadmap rule 3: the author owns this. Options only; the Decision section
     is deliberately empty. Same shape as ADR-005, ADR-012 and ADR-013. -->

## Context

The drug page's third boundary (ADR-005 Q2 B) is the label: openFDA prose,
the slowest and largest source (118 KB for one label, upstream-notes §2.3).
It is blocked on Q2, which has been open since 2026-09-11.

`openfda.rxcui` returns **one SPL per manufacturer, repackager and revision**
(upstream-notes §2.2), so "the label" does not exist. The 2026-09-11
measurement (api-contract, Q2) concluded that the real question is **what
`Label` is**, not which of the results to pick. "Most recent" surfaces a
repackager, and "first" can surface an empty document. Today
`Label.openFDALabel: String` presumes one document and resolves to `null`,
and `LABEL_PAGE_SIZE = 25` is a placeholder.

### Measured 2026-09-23 (live openFDA, `limit=100`)

| Drug | SPLs | Original packager | Under an NDA | Notes |
| --- | --- | --- | --- | --- |
| atorvastatin 10 MG, generic (SCD 617312) | 91 | 34, from **32 manufacturers** | **1** (Viatris) | 90 of 91 have `indications_and_usage` |
| Lipitor 10 MG, brand (SBD 617314) | **1** | 1 | 1 (Viatris) | the same document as the generic's NDA row |
| metformin ER 500 MG, generic (SCD 860975) | 78 | 22 | **0** | no brand label among its results |

1. **`openfda.is_original_packager` exists.** It removes repackagers (57 of
   91 for atorvastatin), but **32 manufacturers remain**, each with its own
   generic (ANDA) label.
2. **A brand drug has one label.** Lipitor returns exactly one SPL.
3. **A generic's label is required to match its reference brand's.** An ANDA's
   labeling must be the same as the reference listed drug's, apart from
   specific permitted differences (21 CFR 314.94(a)(8)). So the 32 are meant
   to say the same thing, and the brand's label is the one they follow.
   *This is a regulatory reading, not a measurement. It is worth confirming
   before relying on it in copy.*
4. **The brand's label is not always reachable.** Metformin ER has no NDA row
   among its 78, although RxNorm names a brand version (the Glucophage SBD,
   ADR-005 boundary 2). Whether that SBD has a label of its own is not yet
   measured.

## Options considered

### Option A — The reference label, with a stated fallback

For a brand drug, its own label. For a generic, the brand's label: the NDA row
among its results, else the SBD twin's label. If neither exists, fall back to
the most recent original-packager label. The UI always says which one it is:
"Label: Lipitor, from Viatris · updated Apr 15, 2024. Generic labels follow
this one."

- **For:** one document, chosen for a reason a reader can check, not an
  arbitrary pick. Brand and generic pages show the same label, which is what
  finding 3 says they should. Provenance is on the page.
- **Against:** it needs the regulatory reading confirmed, and a fallback chain
  (three steps) that each needs a test. The fallback case (metformin ER) is
  still a pick, just a better-labelled one.

### Option B — One original-packager label, most recent

Filter to `is_original_packager`, take the newest `effective_time`.

- **For:** a simple rule, and it removes the repackagers.
- **Against:** it still picks one of 32 manufacturers by a date, which is
  the "arbitrary pick dressed as an answer" the 2026-09-11 note rejected.

### Option C — A count and a link, no prose

"91 labels from 55 labelers", linking to DailyMed by `spl_set_id`. The page
carries no label text.

- **For:** it claims nothing it cannot back, and it's the cheapest to build.
- **Against:** the label is most of the page's content (ui-spec §11), and the
  boxed warning is the one thing ui-spec says must never be hidden. Sending it
  off-site fails that, and leaves the third boundary nearly empty.

### Option D — Merge the documents

- **Rejected before listing trade-offs:** combining prose from 32 manufacturers
  into one text is authoring a label, which this app should not do.

## What any answer forces

- **An SDL change** (yours): `Label.openFDALabel: String` becomes fields that
  name the document (manufacturer, `effective_time`, `spl_set_id`) and the
  sections the page renders.
- **The build-time openFDA-failure test** (ADR-005 finding 7) becomes live
  once the page calls openFDA. It belongs in the same PR as the label
  boundary.

## Decision

<!-- Yours. -->

## Consequences

<!-- Written once the decision is made. -->
