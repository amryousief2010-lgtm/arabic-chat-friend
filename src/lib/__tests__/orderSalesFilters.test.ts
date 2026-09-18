import { describe, it, expect } from "vitest";
import {
  CANCELLED_ORDER_STATUS,
  CANCELLED_ORDER_STATUSES,
  applySalesNetFilter,
  filterSalesNetOrders,
  isCancelledOrderStatus,
  isSalesNetOrder,
  sumSalesNet,
} from "../orderSalesFilters";

describe("orderSalesFilters — sales net excludes cancelled", () => {
  it("treats only status cancelled as cancelled (case/whitespace insensitive)", () => {
    expect(isCancelledOrderStatus("cancelled")).toBe(true);
    expect(isCancelledOrderStatus(" cancelled ")).toBe(true);
    expect(isCancelledOrderStatus("CANCELLED")).toBe(true);
    expect(isCancelledOrderStatus("delivered")).toBe(false);
    expect(isCancelledOrderStatus("pending")).toBe(false);
    expect(isCancelledOrderStatus("returned")).toBe(false);
    expect(isCancelledOrderStatus(null)).toBe(false);
    expect(isCancelledOrderStatus(undefined)).toBe(false);
    expect(CANCELLED_ORDER_STATUSES).toEqual([CANCELLED_ORDER_STATUS]);
  });

  it("keeps open and delivered orders in sales net", () => {
    const rows = [
      { status: "pending", total: 100 },
      { status: "processing", total: 200 },
      { status: "shipped", total: 50 },
      { status: "delivered", total: 300 },
      { status: "cancelled", total: 999 },
    ];
    expect(filterSalesNetOrders(rows).map((r) => r.status)).toEqual([
      "pending",
      "processing",
      "shipped",
      "delivered",
    ]);
    expect(rows.filter(isSalesNetOrder).length).toBe(4);
  });

  it("matches GM Sep MTD example: 494 orders / 826240.01 EGP after excluding cancelled", () => {
    // Synthetic mix whose net equals the trusted September MTD snapshot.
    const netOrders = Array.from({ length: 493 }, () => ({ status: "delivered", total: 1000 }));
    netOrders.push({ status: "pending", total: 333240.01 });
    const cancelled = [
      { status: "cancelled", total: 18500 },
      { status: "cancelled", total: 5259.99 },
    ];
    const all = [...netOrders, ...cancelled];
    const totals = sumSalesNet(all);

    expect(totals.orderCount).toBe(494);
    expect(totals.sales).toBeCloseTo(826240.01, 2);
    expect(totals.cancelledCount).toBe(2);
    expect(totals.cancelledSales).toBeCloseTo(23759.99, 2);
    expect(totals.grossOrderCount).toBe(496);
    expect(totals.grossSales).toBeCloseTo(850000, 2);
  });

  it("applySalesNetFilter uses neq(status, cancelled)", () => {
    const calls: Array<[string, string]> = [];
    const query = {
      neq(column: string, value: string) {
        calls.push([column, value]);
        return this;
      },
    };
    expect(applySalesNetFilter(query)).toBe(query);
    expect(calls).toEqual([["status", "cancelled"]]);
    applySalesNetFilter(query, "orders.status");
    expect(calls[1]).toEqual(["orders.status", "cancelled"]);
  });
});
