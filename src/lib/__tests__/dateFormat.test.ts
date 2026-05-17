import { describe, it, expect } from "vitest";
import {
  formatDate,
  formatDateTime,
  formatTime,
  toISODate,
  dmyToISO,
  toDate,
  todayISO,
} from "../dateFormat";

describe("dateFormat — display always DD/MM/YYYY", () => {
  it("formats a Date object as DD/MM/YYYY", () => {
    // 3 April 2026 — ambiguous month/day to catch swaps
    const d = new Date(2026, 3, 3); // month is 0-indexed → April
    expect(formatDate(d)).toBe("03/04/2026");
  });

  it("formats an ISO YYYY-MM-DD string as DD/MM/YYYY without swapping", () => {
    expect(formatDate("2026-04-03")).toBe("03/04/2026");
    expect(formatDate("2026-12-01")).toBe("01/12/2026");
    expect(formatDate("2026-01-31")).toBe("31/01/2026");
  });

  it("formats an ISO datetime string as DD/MM/YYYY", () => {
    expect(formatDate("2026-05-17T08:30:00Z")).toMatch(/^\d{2}\/05\/2026$/);
  });

  it("re-parses DD/MM/YYYY input back into the same display value", () => {
    expect(formatDate("03/04/2026")).toBe("03/04/2026");
    expect(formatDate("31/12/2026")).toBe("31/12/2026");
  });

  it("never reads DD/MM/YYYY as MM/DD/YYYY (no silent swap)", () => {
    // 13/05/2026 is unambiguous — month 13 doesn't exist
    // The parser MUST treat 13 as the day and 05 as the month.
    expect(formatDate("13/05/2026")).toBe("13/05/2026");
  });

  it("returns fallback for invalid / empty input", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
    expect(formatDate("")).toBe("—");
    expect(formatDate("not-a-date")).toBe("—");
    expect(formatDate("not-a-date", "N/A")).toBe("N/A");
  });

  it("formatDateTime appends 24h HH:mm", () => {
    const d = new Date(2026, 4, 17, 14, 5); // 17 May 2026 14:05 local
    expect(formatDateTime(d)).toBe("17/05/2026 14:05");
  });

  it("formatTime returns HH:mm", () => {
    const d = new Date(2026, 4, 17, 9, 3);
    expect(formatTime(d)).toBe("09:03");
  });
});

describe("dateFormat — storage always ISO YYYY-MM-DD", () => {
  it("converts a Date to ISO YYYY-MM-DD with no swap", () => {
    const d = new Date(2026, 3, 3); // 3 April 2026
    expect(toISODate(d)).toBe("2026-04-03");
  });

  it("converts a DD/MM/YYYY string to ISO YYYY-MM-DD without swap", () => {
    expect(dmyToISO("03/04/2026")).toBe("2026-04-03");
    expect(dmyToISO("31/12/2026")).toBe("2026-12-31");
    expect(dmyToISO("01/01/2026")).toBe("2026-01-01");
  });

  it("passes through an already-ISO string unchanged", () => {
    expect(toISODate("2026-04-03")).toBe("2026-04-03");
  });

  it("round-trip: ISO → display → ISO is stable", () => {
    const iso = "2026-04-03";
    const display = formatDate(iso); // "03/04/2026"
    const back = dmyToISO(display);
    expect(back).toBe(iso);
  });

  it("round-trip: display → ISO → display is stable", () => {
    const display = "17/05/2026";
    const iso = dmyToISO(display);
    expect(iso).toBe("2026-05-17");
    expect(formatDate(iso)).toBe(display);
  });

  it("todayISO returns the same calendar day as new Date() locally", () => {
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
      now.getDate()
    ).padStart(2, "0")}`;
    expect(todayISO()).toBe(expected);
  });

  it("toDate handles epoch numbers", () => {
    const d = toDate(0);
    expect(d).not.toBeNull();
    expect(d!.getTime()).toBe(0);
  });

  it("toDate rejects invalid strings", () => {
    expect(toDate("foo")).toBeNull();
    expect(toDate("32/13/2026")).toBeNull(); // impossible day & month
  });
});

describe("dateFormat — ambiguity guards", () => {
  // These tests would FAIL if the codebase ever silently used MM/DD/YYYY.
  it("treats 05/17/2026 (impossible day=17 as month) as invalid in DMY mode", () => {
    // 17 is not a valid month, so reading 05/17 as DD/MM means day=5, month=17 → invalid
    expect(dmyToISO("05/17/2026")).toBe("");
  });

  it("does NOT silently swap a valid DMY into MDY", () => {
    // 04/03/2026 in DMY = 4 March 2026 → ISO 2026-03-04
    // If swapped (MDY), it would become 3 April 2026 → ISO 2026-04-03
    expect(dmyToISO("04/03/2026")).toBe("2026-03-04");
  });
});
