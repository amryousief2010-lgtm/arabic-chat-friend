import { describe, it, expect } from "vitest";
import { computeTodayKg } from "@/lib/todayOrderedKg";
import { ALL_MODERATOR_KEYS } from "@/constants/moderators";

describe("computeTodayKg", () => {
  it("excludes cancelled, classifies kg, attributes to girl", () => {
    const key = ALL_MODERATOR_KEYS[0];
    const r = computeTodayKg(
      [{ id: "a", moderator: key, created_by: null, status: "pending" },
       { id: "b", moderator: key, created_by: null, status: "cancelled" },
       { id: "c", moderator: null, created_by: null, status: "delivered" }],
      [{ order_id: "a", product_name: "كفتة", quantity: 2 }, { order_id: "a", product_name: "استيك", quantity: 1.5 },
       { order_id: "b", product_name: "كفتة", quantity: 9 }, { order_id: "c", product_name: "سجق", quantity: 1 }],
      new Map(), [{ key, name: "x" }]);
    expect(r.total).toEqual({ orders: 2, meat: 1.5, bone: 0, processed: 3 });
    expect(r.perGirl[0]).toMatchObject({ orders: 1, meat: 1.5, processed: 2 });
    expect(r.unassigned).toMatchObject({ orders: 1, processed: 1 });
  });
});

import { totalKg, compareWithYesterday, canSeeDailyKgCounter } from "@/lib/todayOrderedKg";
describe("daily kg counter helpers", () => {
  it("totalKg sums meat+bone+processed once", () => {
    expect(totalKg({ orders: 3, meat: 2, bone: 1.5, processed: 0.5 })).toBe(4);
  });
  it("compares with yesterday", () => {
    expect(compareWithYesterday(12, 10)).toEqual({ diff: 2, dir: "up", pct: 20 });
    expect(compareWithYesterday(5, 10)).toEqual({ diff: -5, dir: "down", pct: -50 });
    expect(compareWithYesterday(0, 0)).toEqual({ diff: 0, dir: "same", pct: null });
    expect(compareWithYesterday(3, 0).pct).toBeNull();
  });
  it("is GM only", () => {
    expect(canSeeDailyKgCounter(["general_manager"])).toBe(true);
    expect(canSeeDailyKgCounter(["marketing_manager", "moderator"])).toBe(false);
    expect(canSeeDailyKgCounter(undefined)).toBe(false);
  });
});
