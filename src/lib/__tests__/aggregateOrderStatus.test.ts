import { describe, it, expect } from "vitest";
import { orderBucket, countOrderBuckets, arabicMonthLabel } from "../aggregateOrderStatus";

describe("aggregate order buckets", () => {
  it("classifies statuses", () => {
    expect(orderBucket({ status: "delivered" }, null)).toBe("delivered");
    expect(orderBucket({ status: "pending" }, null)).toBe("pending");
    expect(orderBucket({ status: "shipped" }, null)).toBe("pending");
    expect(orderBucket({ status: "out_for_delivery" }, null)).toBe("pending");
    expect(orderBucket({ status: "cancelled" }, null)).toBe("returned");
    expect(orderBucket({ status: "returned" }, null)).toBe("returned");
  });
  it("delivered after closure cutoff counts as pending", () => {
    expect(orderBucket({ status: "delivered", delivered_at: "2026-11-02T00:00:00Z" }, "2026-11-01T00:00:00Z")).toBe("pending");
  });
  it("reconciles to total", () => {
    const orders = [
      ...Array(873).fill({ status: "delivered" }),
      ...Array(200).fill({ status: "pending" }),
      ...Array(31).fill({ status: "shipped" }),
      ...Array(144).fill({ status: "cancelled" }),
    ];
    const r = countOrderBuckets(orders, null);
    expect(r).toEqual({ orders: 1248, delivered: 873, pending: 231, returned: 144 });
  });
  it("arabic month label", () => {
    expect(arabicMonthLabel(2026, 9)).toBe("أكتوبر 2026");
  });
});
