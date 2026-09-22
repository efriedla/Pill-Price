# ADR-014: What `Drug.priceHistory` actually returns

**Status:** proposed — options only, no decision
**Date:** 2026-09-22

<!-- Roadmap rule 3: the author owns schema and product copy decisions. This
     lays the options out for that decision; the Decision section is
     deliberately empty. Same shape as ADR-012 (#59 options, #60 decision) and
     ADR-013 (#63). -->

## Context

ADR-012 decided what is *stored*: quarterly buckets, no backfill, accumulating
forward, each bucket the last price NADAC published in that quarter. #62
shipped it — `toQuarterlySeries` and `accumulateInto` are in `snapshot.ts` and
the weekly job is read-merge-write.

Nothing reads it. `Drug.priceHistory` still resolves to
`Unavailable { retryable: false }`, which was the honest answer while there was
no store and is now merely a stale one. Wiring the read path is one PR, and it
is blocked on three questions that are product and copy decisions rather than
implementation ones.

They are gathered here because they interact: the answer to Q1 decides what a
point on the chart *is*, and Q2 and Q3 are about what the field says when it
cannot say that.

### What is measured

Against the real 32,621-NDC snapshot and the shipped code. The percentages in
the spread table were computed with floats — they are ratios for display, not
prices, and nothing in the read path does arithmetic on money.

| Quantity | Figure | Source |
| --- | --- | --- |
| NDCs RxNorm returns for one metformin ER 500 MG SCD | 401 | measured, §schema |
| Of those, carrying a NADAC price | 34 | measured, §schema |
| Packages with no published price, overall | ~92% | ADR-009 |
| Quarters available at launch | **4** (2025Q4 partial, 2026 Q1-Q3) | ADR-012 |
| NADAC descriptions covering more than one NDC | 3,836 | measured |
| **Of those, where the NDCs do not all share one price** | **1,206 (31.4%)** | measured |
| Spread within one description, median / p90 / max | **9.9% / 95.1% / 6,210%** | measured |

**The third row from the bottom is the one that makes Q1 a decision.**
`Drug.price` takes the cheapest package and its comment says NADAC "prices a
product rather than a package, so these are usually all identical". That is true
for about two thirds of multi-NDC products. For the other third the packages
disagree, and the disagreement is not a rounding difference: at the median the
cheapest is ~10% below the dearest, and in the top decile it is half.

A chart drawn from "whichever package is cheapest this quarter" can therefore
move by tens of percent because a *different* package became cheapest, with no
underlying price having changed at all. That is a line that looks like news and
isn't.

### What the UI spec already says, and where it no longer fits

`docs/ui-spec.md` §3 was written against NADAC's weekly publication, before
ADR-012 chose quarterly buckets. Three of its rules are now in tension with the
schema, and the read path has to land on one side of each:

1. **Range selector `3M · 6M · 1Y · 5Y · ALL`** against the SDL's
   `CURRENT · QUARTER · YEAR · FIVE_YEAR · MAX`. Five values each, and they do
   not correspond: there is no 6M, and `CURRENT` is not a range.
2. **"Plot with visible weekly points at short ranges"** is unbuildable. The
   store keeps one point per quarter; `Granularity` has `WEEKLY` and `MONTHLY`
   members that nothing can now return.
3. **"Sparse series (< 4 points) render as a labeled point set, not a chart"**
   is already an answer to Q2, arrived at for a different reason. At launch
   every series has at most four points, so the spec's exceptional case is the
   normal one for the first year.

None of that needs deciding here beyond what Q1-Q3 force, but the spec will need
an amendment either way, and it should follow the decision rather than lead it.

## Options considered — Q1: which NDC's series does the chart draw?

`PriceSeries.unit` is a single `String!` and `points` is one line. A drug fans
out to up to 401 NDCs. Something has to choose, and averaging them is arithmetic
on money — ruled out by ADR-012 for the same reason it refused a median bucket.

### Option A — the cheapest package, recomputed each quarter

Mirrors `Drug.price` exactly: per quarter, take the lowest price among the
drug's priced NDCs.

- **For:** one rule for the whole page. The headline number is the cheapest and
  so is every point behind it, so the chart's right-hand end always equals the
  big number above it — which is the single most likely thing a reader checks.
- **Against:** the line hops between products. In the 31.4% of cases where
  packages disagree it can move ~10% at the median and ~95% at p90 with no price
  change at all, and the chart has no way to say so. It is the option most
  likely to state something false.

### Option B — the cheapest package *as of now*, held fixed across the series

Pick one NDC — today's cheapest — and draw only that NDC's history.

- **For:** a real series for a real package: every point is a thing NADAC
  published about the same product, which is what ADR-012 said a point is. No
  hopping, and gaps stay honest.
- **Against:** the identity of "the drug's price" now silently depends on when
  you loaded the page, and yesterday's chart is not today's. A package that was
  cheapest in 2026Q3 may have had no price in 2025Q4, so the series can be
  shorter than the data available. The headline and the chart can also disagree
  historically — the current cheapest was not the cheapest a year ago.

### Option C — the most-published package

Pick the NDC with the most quarters of data (ties broken by price, lowest).

- **For:** the longest, densest line available, which is the one that actually
  shows a price moving. Stable across page loads in a way B is not — it changes
  only when coverage changes.
- **Against:** "the package we happen to know most about" is hard to explain in
  UI copy, and it can be a package nobody buys. It can also disagree with the
  headline price permanently rather than occasionally, which is worse than A's
  intermittent disagreement because it never resolves.

### Option D — don't choose: one series per package, and the UI picks

Return a list — `priceHistory` yields a series per priced NDC, with the
package's identity attached.

- **For:** the server stops making a product decision it has no basis for. It is
  also the only option that can *show* the disagreement, which for the 31.4% is
  the most truthful rendering available.
- **Against:** it is a schema change to a settled contract (ADR-004), it moves
  the choice into the UI rather than removing it, and up to 34 lines on one
  chart is not a drug page, it is a spreadsheet. The 92%-unpriced majority get a
  more complicated field for no benefit.

### Option E — the whole drug, with the series restricted to one unit

Draw the cheapest per quarter as in A, but **only across packages sharing the
newest `pricing_unit`**, and state in copy that the line tracks the lowest
published price rather than one package.

- **For:** it keeps the headline agreement of A, satisfies `PriceSeries.unit`
  honestly, and answers the hopping objection with copy rather than with a
  different number — "the lowest published price for this drug" is a true
  description of what A computes.
- **Against:** copy is not a fix for a misleading shape. A reader who sees a 40%
  drop will not read the caption first, and "lowest published price" still looks
  like a price history when it is really the history of a minimum.

## Options considered — Q2: what does `range: FIVE_YEAR` return with four quarters?

The store holds four quarters and grows one per quarter. Every range above
`YEAR` is asking for data that provably does not exist yet, and will keep doing
so for years.

- **Return what exists, with the requested `range` echoed.** Four points and a
  `PriceSeries { range: FIVE_YEAR }`. Simple, and the field already promises to
  echo what it was asked. But it silently states a five-year series that is four
  quarters long, and nothing in the payload says the window was not met.
- **Return what exists, with `range` set to what was actually covered.** The
  series answers `YEAR` to a `FIVE_YEAR` request. Honest about the window, and
  `granularity` already sets the precedent of reporting "what the server
  actually returned". But a client that asked for five years and renders the
  echo will silently relabel its own selector.
- **`Absent` for ranges the store cannot cover.** Unambiguous, and it reuses the
  degradable shape the page already handles. But `Absent` means "the upstream
  has nothing", and NADAC *does* have five years — this would blame them for our
  retention window, the exact error the current `Unavailable` was chosen to
  avoid.
- **Drop the unreachable members from `PriceRange`.** Ship `CURRENT · QUARTER ·
  YEAR` and add `FIVE_YEAR`/`MAX` when the data reaches them. No lie is
  representable. But it is a breaking schema change later rather than now, and
  ADR-004 settled this enum deliberately.

**Coupled to this:** whatever is chosen, `Coverage` is on the series and the UI
spec's "< 4 points renders as a labeled point set" means the first year of this
app shows point sets, not charts. That is worth deciding on purpose.

## Options considered — Q3: a drug with no priced packages

~92% of packages have no published price, and a drug can have none at all. The
series is then empty — not missing, not broken, and not NADAC's failure to
publish history: NADAC simply prices nothing here.

- **An empty `PriceSeries` carrying `Coverage { pricedPackages: 0 }`.** The
  denominator is the point — it is what lets the UI say "no published price for
  14 of 14 packages" rather than rendering an empty axis, which is the reason
  `Coverage` exists at all. But an empty `points` list on a type called a series
  invites every client to render an empty chart, and `[PricePoint!]!` cannot
  distinguish "none published" from "nothing stored".
- **`Absent`.** Says the true thing plainly — the upstream has nothing — and
  matches how `label` and `alternatives` already behave, so the page has one
  mental model. But `Absent` carries no coverage, so the "0 of 14 packages"
  sentence loses its denominator unless the copy is written without it.
- **`Absent` when there are no *packages*, an empty series when there are
  packages but no prices.** Distinguishes "we know nothing about this drug" from
  "we know its packages and none are priced" — arguably two different facts with
  two different sentences. But it is two code paths and two copy strings for a
  distinction a reader may not care about.

**The copy is yours either way**, and it is the part that matters more than the
shape: a drug with no NADAC price is the *ordinary* case, not a fault, and must
not read like one — the same rule ADR-012's sibling applied to the dose-form
`Absent` for a GPCK.

## Decision

<!-- Yours. Q1, Q2, Q3, and the copy for whichever absences survive. -->

## Consequences

<!-- Written once the decision is made. -->

## Revisit if

- **Coverage rises materially above 8%,** or community-submitted prices
  (issue #11) become a second source. Q1 is a question about disagreement
  between packages; a second source makes it a question about disagreement
  between *sources*, which is a different ADR.
- **The accumulated series passes eight quarters** (within a year of the first
  run). Q2's options are weighted by the fact that every range above `YEAR` is
  currently unreachable; that stops being true on a schedule.
- **A measured case of the Option A line moving on a package change rather than
  a price change.** The spread figures say it will happen; seeing it happen to a
  real drug is the thing that should force a rethink if A was chosen.
