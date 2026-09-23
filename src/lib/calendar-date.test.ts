import { describe, expect, it } from "vitest";

import { formatIsoDate, utcCalendarDate } from "./calendar-date";

describe("formatIsoDate", () => {
  it("writes the date the way ui-spec §9 does", () => {
    expect(formatIsoDate("2026-08-12")).toBe("Aug 12, 2026");
  });

  it("drops the leading zero from the day", () => {
    expect(formatIsoDate("2026-08-01")).toBe("Aug 1, 2026");
  });

  it("handles the first and last month", () => {
    expect(formatIsoDate("2026-01-31")).toBe("Jan 31, 2026");
    expect(formatIsoDate("2026-12-25")).toBe("Dec 25, 2026");
  });

  // `new Date("2026-03-18")` is midnight UTC, so any viewer west of Greenwich
  // would see the previous day. NADAC's effective_date is a calendar date with
  // no zone; parsing by parts is what keeps it one.
  it("does not shift the day in a western timezone", () => {
    const original = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      expect(formatIsoDate("2026-03-18")).toBe("Mar 18, 2026");
      expect(
        new Date("2026-03-18").toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
          timeZone: "America/Los_Angeles",
        }),
      ).toBe("Mar 17, 2026");
    } finally {
      process.env.TZ = original;
    }
  });

  it("returns anything that is not an ISO calendar date untouched", () => {
    expect(formatIsoDate("2026-13-01")).toBe("2026-13-01");
    expect(formatIsoDate("2026-03-18T00:00:00Z")).toBe("2026-03-18T00:00:00Z");
    expect(formatIsoDate("")).toBe("");
  });
});

describe("utcCalendarDate", () => {
  it("takes the UTC day of an instant, as a calendar date", () => {
    expect(utcCalendarDate("2026-09-11T15:06:56.239Z")).toBe("2026-09-11");
  });

  it("slices rather than converting, so the zone never moves the day", () => {
    const original = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      expect(utcCalendarDate("2026-09-12T02:00:00Z")).toBe("2026-09-12");
    } finally {
      process.env.TZ = original;
    }
  });

  it("returns anything that is not an ISO instant untouched", () => {
    expect(utcCalendarDate("2026-09-11")).toBe("2026-09-11");
    expect(utcCalendarDate("")).toBe("");
  });
});
