import { describe, it, expect } from "vitest";
import {
  resolveWindow,
  rowInWindow,
  shouldStopPaging,
  dedupeByBill,
  parseZodexDate,
  shouldRunWeeklyFullReview,
  OVERLAP_HOURS,
} from "../../../supabase/functions/_shared/zodexSync";

const CYCLE = "2026-09-15T22:00:00.000Z";

describe("resolveWindow", () => {
  it("quick sync starts 48h before the last successful sync", () => {
    const w = resolveWindow({ mode: "quick", lastSuccessAt: "2026-09-15T20:00:00.000Z", cycleStart: CYCLE });
    expect(w.mode).toBe("quick");
    expect(w.from).toBe("2026-09-13T20:00:00.000Z");
    expect(w.to).toBe(CYCLE);
    expect(OVERLAP_HOURS).toBe(48);
  });

  it("falls back to a full review on the first run", () => {
    const w = resolveWindow({ mode: "quick", lastSuccessAt: null, cycleStart: CYCLE });
    expect(w.mode).toBe("full");
    expect(w.first_run).toBe(true);
    expect(w.from).toBe("2026-08-16T22:00:00.000Z"); // 30 days
  });

  it("full review honours the user-chosen period", () => {
    const w = resolveWindow({ mode: "full", lastSuccessAt: "2026-09-15T20:00:00.000Z", cycleStart: CYCLE, fullDays: 7 });
    expect(w.from).toBe("2026-09-08T22:00:00.000Z");
  });

  it("window ends at the cycle start so rows created during the sync are not lost", () => {
    const w = resolveWindow({ mode: "quick", lastSuccessAt: "2026-09-15T20:00:00.000Z", cycleStart: CYCLE });
    // A bill created after the cycle start keeps a later date than the committed
    // timestamp, so the next quick sync (from cycleStart - 48h) still sees it.
    const next = resolveWindow({ mode: "quick", lastSuccessAt: w.to, cycleStart: "2026-09-16T22:00:00.000Z" });
    expect(new Date(next.from).getTime()).toBeLessThan(new Date(CYCLE).getTime());
  });
});

describe("rowInWindow", () => {
  const win = resolveWindow({ mode: "quick", lastSuccessAt: "2026-09-15T20:00:00.000Z", cycleStart: CYCLE });

  it("detects a bill created after the last sync", () => {
    expect(rowInWindow({ created_at: "2026-09-15T21:00:00.000Z", updated_at: null }, win)).toBe(true);
  });

  it("detects an old bill whose status changed after the last sync", () => {
    expect(rowInWindow({ created_at: "2026-08-01T10:00:00.000Z", updated_at: "2026-09-15T21:30:00.000Z" }, win)).toBe(true);
  });

  it("skips an untouched old bill", () => {
    expect(rowInWindow({ created_at: "2026-08-01T10:00:00.000Z", updated_at: "2026-08-02T10:00:00.000Z" }, win)).toBe(false);
  });

  it("never silently skips a row with no readable date", () => {
    expect(rowInWindow({ created_at: null, updated_at: null }, win)).toBe(true);
  });
});

describe("shouldStopPaging", () => {
  const win = resolveWindow({ mode: "quick", lastSuccessAt: "2026-09-15T20:00:00.000Z", cycleStart: CYCLE });
  const inWin = { created_at: "2026-09-15T12:00:00.000Z", updated_at: null };
  const oldRow = { created_at: "2026-01-01T12:00:00.000Z", updated_at: "2026-01-01T12:00:00.000Z" };

  it("keeps paging while rows are inside the window (page 2+ rows are reached)", () => {
    expect(shouldStopPaging([inWin, oldRow], win, 2).stop).toBe(false);
  });

  it("stops only after two consecutive fully-old pages", () => {
    const a = shouldStopPaging([oldRow], win, 2);
    expect(a.stop).toBe(false);
    const b = shouldStopPaging([oldRow], win, a.gracePagesLeft);
    expect(b.stop).toBe(true);
  });

  it("stops on an empty page", () => {
    expect(shouldStopPaging([], win, 2).stop).toBe(true);
  });
});

describe("dedupeByBill (idempotency across the 48h overlap)", () => {
  it("keeps one row per waybill and prefers the freshest", () => {
    const out = dedupeByBill([
      { bill_no: "ZX1", created_at: "2026-09-10T10:00:00.000Z", updated_at: "2026-09-10T10:00:00.000Z" },
      { bill_no: "zx1", created_at: "2026-09-10T10:00:00.000Z", updated_at: "2026-09-14T10:00:00.000Z" },
      { bill_no: "ZX2", created_at: "2026-09-11T10:00:00.000Z", updated_at: null },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].updated_at).toBe("2026-09-14T10:00:00.000Z");
  });
});

describe("parseZodexDate", () => {
  it("parses Cairo date/time with AM/PM", () => {
    expect(parseZodexDate("2026-07-04 04:42 PM")).toBe("2026-07-04T16:42:00+02:00");
    expect(parseZodexDate("2026-07-04 12:05 AM")).toBe("2026-07-04T00:05:00+02:00");
    expect(parseZodexDate("2026-07-04")).toBe("2026-07-04T00:00:00+02:00");
    expect(parseZodexDate("ZX12345")).toBeNull();
  });
});

describe("weekly full review", () => {
  it("runs when none happened yet or a week has passed", () => {
    expect(shouldRunWeeklyFullReview(null, CYCLE)).toBe(true);
    expect(shouldRunWeeklyFullReview("2026-09-01T22:00:00.000Z", CYCLE)).toBe(true);
    expect(shouldRunWeeklyFullReview("2026-09-14T22:00:00.000Z", CYCLE)).toBe(false);
  });
});
