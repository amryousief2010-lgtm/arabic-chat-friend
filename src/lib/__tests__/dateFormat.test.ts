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

describe("dateFormat — calendar edge cases (no silent rollover)", () => {
  it("accepts 29/02 in a leap year (2024)", () => {
    expect(dmyToISO("29/02/2024")).toBe("2024-02-29");
    expect(formatDate("2024-02-29")).toBe("29/02/2024");
  });

  it("rejects 29/02 in a non-leap year (2023, 2025, 2026)", () => {
    expect(dmyToISO("29/02/2023")).toBe("");
    expect(dmyToISO("29/02/2025")).toBe("");
    expect(dmyToISO("29/02/2026")).toBe("");
  });

  it("rejects 30/02 every year", () => {
    expect(dmyToISO("30/02/2024")).toBe(""); // even in a leap year
    expect(dmyToISO("30/02/2026")).toBe("");
  });

  it("rejects 31/04, 31/06, 31/09, 31/11 (30-day months)", () => {
    expect(dmyToISO("31/04/2026")).toBe("");
    expect(dmyToISO("31/06/2026")).toBe("");
    expect(dmyToISO("31/09/2026")).toBe("");
    expect(dmyToISO("31/11/2026")).toBe("");
  });

  it("accepts 30/04 and 31/05 (valid 30 & 31-day boundaries)", () => {
    expect(dmyToISO("30/04/2026")).toBe("2026-04-30");
    expect(dmyToISO("31/05/2026")).toBe("2026-05-31");
  });

  it("accepts 28/02 in any year", () => {
    expect(dmyToISO("28/02/2023")).toBe("2023-02-28");
    expect(dmyToISO("28/02/2024")).toBe("2024-02-28");
  });

  it("rejects 00 as day or month", () => {
    expect(dmyToISO("00/01/2026")).toBe("");
    expect(dmyToISO("01/00/2026")).toBe("");
  });

  it("rejects 32 as day and 13 as month", () => {
    expect(dmyToISO("32/01/2026")).toBe("");
    expect(dmyToISO("01/13/2026")).toBe("");
  });
});

describe("dateFormat — round-trip: UI ↔ DB ↔ UI", () => {
  // Simulates the full lifecycle: user picks date → save via toISODate →
  // DB stores YYYY-MM-DD → fetch → display via formatDate.
  // Asserts the displayed value matches the originally-entered value.

  const fakeDB = new Map<string, string>();
  const save = (id: string, userInput: string) => fakeDB.set(id, toISODate(userInput));
  const load = (id: string) => fakeDB.get(id) ?? "";

  it("DD/MM/YYYY input round-trips identically through DB (ambiguous date)", () => {
    save("a", "03/04/2026"); // 3 April 2026
    expect(load("a")).toBe("2026-04-03");
    expect(formatDate(load("a"))).toBe("03/04/2026");
  });

  it("31/12/2026 round-trips", () => {
    save("b", "31/12/2026");
    expect(load("b")).toBe("2026-12-31");
    expect(formatDate(load("b"))).toBe("31/12/2026");
  });

  it("01/01/2026 round-trips", () => {
    save("c", "01/01/2026");
    expect(load("c")).toBe("2026-01-01");
    expect(formatDate(load("c"))).toBe("01/01/2026");
  });

  it("29/02/2024 (leap day) round-trips", () => {
    save("d", "29/02/2024");
    expect(load("d")).toBe("2024-02-29");
    expect(formatDate(load("d"))).toBe("29/02/2024");
  });

  it("ISO from <input type='date'> round-trips without swap", () => {
    // <input type="date"> always emits YYYY-MM-DD regardless of UI locale
    const fromHtmlInput = "2026-04-03";
    save("e", fromHtmlInput);
    expect(load("e")).toBe("2026-04-03");
    expect(formatDate(load("e"))).toBe("03/04/2026");
  });

  it("never silently swaps day/month for a hostile DMY input", () => {
    // 04/03/2026 → DMY = 4 March, MDY = 3 April. We must always get 4 March.
    save("f", "04/03/2026");
    expect(load("f")).toBe("2026-03-04");
    expect(formatDate(load("f"))).toBe("04/03/2026");
  });
});

describe("dateFormat — codebase guard", () => {
  // Static guard: no source file should display dates via .toLocaleDateString()
  // with no formatting options. All such calls must go through formatDate().
  it("no bare .toLocaleDateString('xx-XX') calls remain in src/", async () => {
    const { execSync } = await import("child_process");
    let matches = "";
    try {
      matches = execSync(
        `rg -n "\\.toLocaleDateString\\([\\"'][a-zA-Z-]+[\\"']\\)" src -g '*.{ts,tsx}' || true`,
        { cwd: process.cwd() }
      ).toString();
    } catch {
      matches = "";
    }
    expect(matches.trim()).toBe("");
  });
});
