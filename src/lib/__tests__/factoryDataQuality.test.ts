import { describe, expect, it } from "vitest";
import {
  buildFactoryPendingReviewRows,
  countZeroCostWithStock,
  zeroCostSplit,
} from "../factoryDataQuality";

const items = [
  { item_code: "M1", name: "لحم", module: "meat", unit_cost: 0, stock: 4, sku: "x" },
  { item_code: "M2", name: "لحم 2", module: "meat", unit_cost: 10, stock: 1, sku: "y" },
  { item_code: "F1", name: "علف", module: "feed", unit_cost: 0, stock: 2, sku: null },
  { item_code: "F2", name: "علف سالب", module: "feed", unit_cost: 3, stock: -1, sku: "z" },
  // Warehouse SKU must never inflate factory KPIs (the old unfiltered query bug).
  { item_code: "W1", name: "مخزن", module: "warehouse", unit_cost: 0, stock: 99, sku: "w" },
];

describe("factory data-quality alerts", () => {
  it("counts zero-cost+stock for meat+feed only (overview  vs feed split)", () => {
    const split = zeroCostSplit(items);
    expect(split).toEqual({ meat: 1, feed: 1, total: 2 });
    expect(countZeroCostWithStock(items, "feed")).toBe(1);
    expect(countZeroCostWithStock(items)).toBe(2);
  });

  it("does not count the Invoice 164 sentinel toward the KPI", () => {
    const rows = buildFactoryPendingReviewRows(items);
    const actionable = rows.filter((r) => r.actionable);
    const sentinel = rows.filter((r) => r.type === "invoice_review");
    expect(sentinel).toHaveLength(1);
    expect(sentinel[0].actionable).toBe(false);
    expect(actionable.some((r) => r.type === "zero_cost" && r.item_code === "W1")).toBe(false);
    // F1 appears twice (zero cost AND missing barcode) — that is per-issue listing,
    // not double counting of the overview KPI.
    expect(actionable.filter((r) => r.item_code === "F1").map((r) => r.type).sort()).toEqual([
      "missing_barcode",
      "zero_cost",
    ]);
  });
});
