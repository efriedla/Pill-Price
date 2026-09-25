# ADR-015: What `Label` is (Q2)

**Status:** accepted
**Date:** 2026-09-23 (options), 2026-09-24 (decided)

<!-- Roadmap rule 3: the author owns this. Options in #79, decision here.
     Same shape as ADR-012 (#59 options, #60 decision) and ADR-013. -->

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

**Option A: the reference label, with a stated fallback.**

The label boundary shows one document, chosen by this chain. The first step
that finds a label wins:

1. **A brand drug (SBD):** its own label.
2. **A generic (SCD):** the NDA row among its own results.
3. **A generic with no NDA row:** the label of its SBD twin (ADR-005
   boundary 2 already fetches the twin).
4. **Otherwise:** the most recent label with `is_original_packager`.

Every step matches by RxCUI, never by name. The page always says which
document it is showing and why it was chosen.

### Checked before deciding (2026-09-24)

- **Finding 3 holds, with one exception the copy must respect.** 21 CFR
  314.94(a)(8)(iv) requires an ANDA's labeling to be "the same as the
  labeling approved for the reference listed drug". The permitted differences
  include **leaving out an indication that is protected by patent or
  exclusivity** (a "carve-out"). So a brand label shown on a generic's page
  can list a use that the generic's own label leaves out. "Generic labels
  follow this one" is true. "Generic labels are identical to this one" is
  not, and the page must not say it.
- **Finding 4, measured: metformin ER reaches step 4.** Its SBD twin, 860977
  (Glucophage XR), has **no label on openFDA** (by `openfda.rxcui`, and by
  `brand_name` "Glucophage" and "Glucophage XR"). The brand has been
  discontinued. So step 4 is the **ordinary** path for a generic whose brand
  has left the market, not a rare edge. Its copy must not read as a fault,
  the same rule as the dose-form `Absent` (Q7).
- **Why "by RxCUI, never by name":** searching NDA labels by
  `generic_name:"metformin"` returns 28 rows, and nearly all of them are
  combination products (Janumet, Synjardy, Xigduo XR, and others). A
  name-based step 2 would show a sitagliptin label on a metformin page.

### Rejected

- **B: newest original-packager label.** This picks one of 32 manufacturers by
  date. It survives only as step 4, where the page says it is a pick.
- **C: a count and a link.** It puts the boxed warning off-site, which
  ui-spec §11 does not allow.
- **D: merge.** Rejected in the options: it would mean authoring a label.

## Consequences

- **An SDL change (yours) before the boundary is built.** `Label` needs to
  name the document and why it was chosen. At minimum that means: the
  manufacturer, `effective_time` (a calendar date, not a `Date`), `spl_set_id`
  for the DailyMed link, **which step of the chain chose it**, and the
  sections the page renders, with the boxed warning first.
  `Label.openFDALabel: String` goes away. The field names are yours to set.
- **Copy (yours), one sentence per step.** The options' example, "Label:
  Lipitor, from Viatris · updated Apr 15, 2024. Generic labels follow this
  one.", was drafted by me and fits steps 1 to 3. Step 4 needs its own
  sentence, one that says a manufacturer's label was chosen because no brand
  label is published. It must not claim to be *the* label.
- **Two openFDA round trips at most on the generic path** (the drug's own
  rows, then the twin's). This happens in the label boundary, which already
  streams last (ADR-005 Q2 B), so the header and the versions list are not
  affected.
- **Four tests for the chain, one per step,** using the three measured drugs:
  Lipitor for step 1, atorvastatin generic for step 2, and metformin ER for
  step 4. Step 3 has no measured example yet, so it needs a fixture.
- **The build-time openFDA-failure test** (ADR-005 finding 7) ships in the
  same PR as the boundary, as already noted above.
- `LABEL_PAGE_SIZE = 25` stops being a placeholder. Step 2 must see every
  row, and atorvastatin has 91. The query should filter by
  `is_original_packager` and by application type in openFDA, rather than
  pulling every page and filtering in our code.
