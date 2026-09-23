/**
 * The acquisition-cost caveat (roadmap: "the UI must say so plainly, near
 * every price"). Copy is the drug-detail sketch's, verbatim.
 *
 * In the static shell, above the first boundary, so it is on screen before any
 * price is. A definition, not a warning, so it uses the accent rule and never
 * crimson (sketch.css: crimson stays for boxed warnings and recalls).
 *
 * **Not yet dismissible.** ui-spec §7 asks for "dismissible per session but
 * never absent on first view". That needs a client leaf and session storage,
 * and it is a follow-up. Never absent is the half that matters, and it holds.
 */
export function AcquisitionCostNotice() {
  return (
    <aside
      aria-label="About these prices"
      className="mt-8 max-w-[var(--measure)] border-l-2 border-accent py-1 pl-4 text-step--1 text-text-primary"
    >
      <p>
        <strong>This is an acquisition cost, not a retail price.</strong> NADAC
        reports what pharmacies pay to buy a drug — not what you pay at the
        counter, and not an insurance price.
      </p>
    </aside>
  );
}
