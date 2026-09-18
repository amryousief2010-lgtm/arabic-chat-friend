import { describe, expect, it } from "vitest";
import {
  EMPTY_YEAR_COUNTS,
  resolveYearGroupCounts,
  withTimeout,
  yearCountsFromOrders,
} from "../orderYearCounts";

describe("yearCountsFromOrders", () => {
  it("buckets by year so the heading (~loaded rows) can backfill tab counts", () => {
    const counts = yearCountsFromOrders(
      [
        { created_at: "2026-09-01T00:00:00.000Z" },
        { created_at: "2026-09-02T00:00:00.000Z" },
        { created_at: "2025-12-31T00:00:00.000Z" },
      ],
      (iso) => Number(iso.slice(0, 4)),
    );
    expect(counts).toEqual({ all: 3, "2026": 2, pre2026: 1 });
  });
});

describe("resolveYearGroupCounts", () => {
  const loaded = { all: 200, "2026": 200, pre2026: 0 };

  it("uses the remote HEAD counts when every query returned a number", () => {
    const { counts, usedRemote } = resolveYearGroupCounts({
      remote: {
        all: { count: 12000, error: null },
        y2026: { count: 8000, error: null },
        pre2026: { count: 4000, error: null },
      },
      loaded,
    });
    expect(usedRemote).toBe(true);
    expect(counts).toEqual({ all: 12000, "2026": 8000, pre2026: 4000 });
  });

  it("falls back to loaded list counts when remote count is null (timeout/RLS)", () => {
    const { counts, usedRemote } = resolveYearGroupCounts({
      remote: {
        all: { count: null, error: { message: "statement timeout" } },
        y2026: { count: null, error: null },
        pre2026: { count: null, error: null },
      },
      loaded,
    });
    expect(usedRemote).toBe(false);
    expect(counts).toEqual(loaded);
  });

  it("does not treat count || 0 as success — that is what painted (0) on الكل", () => {
    const { counts } = resolveYearGroupCounts({
      remote: {
        all: { count: null, error: null },
        y2026: { count: null, error: null },
        pre2026: { count: null, error: null },
      },
      loaded,
    });
    expect(counts).not.toEqual(EMPTY_YEAR_COUNTS);
    expect(counts.all).toBe(200);
  });
});

describe("withTimeout", () => {
  it("rejects when the count query never settles", async () => {
    await expect(withTimeout(new Promise(() => {}), 20, "year-counts")).rejects.toThrow(
      /timed out after 20ms/,
    );
  });
});
