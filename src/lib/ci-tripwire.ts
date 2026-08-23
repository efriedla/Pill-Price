/**
 * DELIBERATE FAILURE — do not merge, do not fix.
 *
 * W1 definition of done: "CI is green and blocks merge on failure — verify by
 * opening a deliberately failing PR." A PR that fails one check proves that
 * one check is required. This file trips all four at once, so a single run
 * demonstrates that lint, typecheck, test, and build are each required and
 * each block the merge button.
 *
 *   lint       raw hex literal, banned outside src/lib/tokens.css (ADR-002)
 *   lint       cross-layer import: lib → ui, denied by default (ADR-003)
 *   typecheck  string assigned to number
 *   build      same type error; next build runs tsc
 *   test       tests/ci-tripwire.test.ts asserts something false
 *
 * Delete this branch once the blocked-merge screenshot is filed.
 */
import { Button } from "@/ui/Button";

export const accent = "#B27C66";

export const unitsPerPack: number = "12";

export const tripwire = Button;
