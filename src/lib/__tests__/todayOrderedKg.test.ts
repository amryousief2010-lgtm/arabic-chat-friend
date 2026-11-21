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
    expect(r.total).toEqual({ orders: 2, meat: 1.5, bone: 0, processed: 3, gifts: 0 });
    expect(r.perGirl[0]).toMatchObject({ orders: 1, meat: 1.5, processed: 2 });
    expect(r.unassigned).toMatchObject({ orders: 1, processed: 1 });
  });
});

import { totalKg, compareWithYesterday, canSeeDailyKgCounter } from "@/lib/todayOrderedKg";
describe("daily kg counter helpers", () => {
  it("totalKg sums meat+bone+processed once", () => {
    expect(totalKg({ orders: 3, meat: 2, bone: 1.5, processed: 0.5, gifts: 1 })).toBe(5);
  });
  it("compares with yesterday", () => {
    expect(compareWithYesterday(12, 10)).toEqual({ diff: 2, dir: "up", pct: 20 });
    expect(compareWithYesterday(5, 10)).toEqual({ diff: -5, dir: "down", pct: -50 });
    expect(compareWithYesterday(0, 0)).toEqual({ diff: 0, dir: "same", pct: null });
    expect(compareWithYesterday(3, 0).pct).toBeNull();
  });
  it("is visible to every role with full order read access", () => {
    for (const r of ["general_manager", "executive_manager", "sales_manager", "marketing_sales_manager",
      "accountant", "warehouse_supervisor", "marketing_sales_viewer", "social_media_manager"])
      expect(canSeeDailyKgCounter([r])).toBe(true);
  });
  it("is hidden for roles whose RLS would give partial/empty numbers", () => {
    for (const r of ["financial_manager", "production_manager", "quality_manager", "sales_moderator",
      "shipping_company", "private_delivery_rep", "hr_manager"])
      expect(canSeeDailyKgCounter([r])).toBe(false);
    expect(canSeeDailyKgCounter(undefined)).toBe(false);
  });
});
