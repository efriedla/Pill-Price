<!--
Operating rule 6: every PR body links the ADR that authorized it.
If there is no ADR, this PR should not exist yet — go write the decision first.
-->

## What

<!-- One paragraph. What changed, in the language of the product, not the diff. -->

## Why

**Authorizing ADR:** <!-- docs/adr/ADR-00X-....md — required, or state why this is exempt (chore/config) -->

<!-- What problem this solves. If the ADR covers it, one line and a link is enough. -->

## How

<!-- The parts of the approach a reviewer could not infer from the diff.
     Call out anything you would want challenged. -->

## Verification

- [ ] `npm run lint` · `npm run typecheck` · `npm test` · `npm run build` pass locally
- [ ] Loading, empty, and error states exist for every async surface touched
- [ ] Keyboard-only pass over the changed UI; focus ring visible throughout
- [ ] No raw hex outside `src/styles/tokens.css`
- [ ] Any new price figure carries its unit and its date (ui-spec §9)

## Explain-back

<!-- Operating rule 5: written from memory, with the diff closed.
     If you cannot account for why a file changed, revert it and redo it by hand. -->

## Screenshots

<!-- Required for UI changes. Include the empty and error states, not just the happy path.
     Include 320px if layout changed. -->
