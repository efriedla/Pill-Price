/**
 * "per unit", "per mL" or "per gram", from NADAC's pricing unit (`Price.unit`).
 *
 * ui-spec §9 originally said "per unit" for every price. For a liquid NADAC
 * prices by the millilitre, so "$0.0500 per unit" is false: the unit is a mL,
 * not a dose. EA stays "per unit", because one EA is one tablet, capsule,
 * patch or kit, and this function does not know which. `unit` is a `String!`
 * and not an enum (schema.ts), so an unknown value is shown as NADAC wrote it
 * rather than dropped: a price this app cannot qualify is not one it may hide.
 */
export function unitLabel(unit: string): string {
  switch (unit) {
    case "EA":
      return "per unit";
    case "ML":
      return "per mL";
    case "GM":
      return "per gram";
    default:
      return `per ${unit}`;
  }
}
