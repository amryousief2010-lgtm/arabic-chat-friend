import { describe, it, expect } from "vitest";
import { toCairoDateString, isCairoSameDay } from "../cairoDate";

/**
 * Cairo midnight boundary scenarios for "today's sales".
 *
 * Egypt is UTC+2 year-round (no DST since 2014 — re-introduced 2023 but the
 * DB stores `Africa/Cairo` and the JS Intl API uses the same IANA rules,
 * so both stay in sync automatically).
 *
 * Cairo midnight = 22:00 UTC the previous day (standard) or 21:00 UTC (DST).
 */
describe("Cairo timezone — today's sales boundary", () => {
  it("order at 23:07 UTC on May 19 belongs to May 20 in Cairo", () => {
    // Real-world example from production data.
    expect(toCairoDateString("2026-05-19T23:07:44.192628Z")).toBe("2026-05-20");
  });

  it("order at 21:31 UTC on May 19 belongs to May 20 in Cairo", () => {
    expect(toCairoDateString("2026-05-19T21:31:57.214025Z")).toBe("2026-05-20");
  });

  it("order at 19:49 UTC on May 19 still belongs to May 19 in Cairo", () => {
    expect(toCairoDateString("2026-05-19T19:49:51.759556Z")).toBe("2026-05-19");
  });

  it("order at exactly 22:00 UTC (Cairo midnight, standard time) rolls to next day", () => {
    // Winter: UTC+2 → 22:00Z = 00:00 Cairo of next day.
    expect(toCairoDateString("2026-01-15T22:00:00Z")).toBe("2026-01-16");
    expect(toCairoDateString("2026-01-15T21:59:59Z")).toBe("2026-01-15");
  });

  it("order at exactly 21:00 UTC during DST (UTC+3) rolls to next day", () => {
    // Summer: UTC+3 → 21:00Z = 00:00 Cairo of next day.
    // July is firmly inside Egypt's DST window.
    expect(toCairoDateString("2026-07-15T21:00:00Z")).toBe("2026-07-16");
    expect(toCairoDateString("2026-07-15T20:59:59Z")).toBe("2026-07-15");
  });

  it("isCairoSameDay treats 23:30 UTC May 19 and 06:00 UTC May 20 as the same Cairo day", () => {
    // Both are May 20 in Cairo (one just after midnight, one in the morning).
    expect(
      isCairoSameDay("2026-05-19T23:30:00Z", "2026-05-20T06:00:00Z"),
    ).toBe(true);
  });

  it("isCairoSameDay treats 19:00 UTC May 19 and 06:00 UTC May 20 as different Cairo days", () => {
    // 19:00 UTC May 19 = 21:00 Cairo May 19. 06:00 UTC May 20 = 08:00 Cairo May 20.
    expect(
      isCairoSameDay("2026-05-19T19:00:00Z", "2026-05-20T06:00:00Z"),
    ).toBe(false);
  });

  it("a UTC-based date check would mis-classify late-night Cairo orders", () => {
    // This is the bug we fixed in get_dashboard_overview: using
    // `created_at::date` with the default UTC session timezone would
    // group these as May 19, hiding them from "today" on May 20.
    const lateNightCairo = "2026-05-19T23:07:44Z"; // = 01:07 May 20 Cairo
    const utcDate = lateNightCairo.slice(0, 10); // naive UTC slice
    const cairoDate = toCairoDateString(lateNightCairo);
    expect(utcDate).toBe("2026-05-19");
    expect(cairoDate).toBe("2026-05-20");
    expect(cairoDate).not.toBe(utcDate);
  });

  it("year/month boundaries also shift correctly", () => {
    // 31 Dec 22:30 UTC = 00:30 Jan 1 Cairo (standard time).
    expect(toCairoDateString("2026-12-31T22:30:00Z")).toBe("2027-01-01");
    // 31 Jan 22:30 UTC = 00:30 Feb 1 Cairo.
    expect(toCairoDateString("2026-01-31T22:30:00Z")).toBe("2026-02-01");
  });
});
