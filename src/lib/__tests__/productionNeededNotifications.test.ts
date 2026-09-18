import { describe, expect, it } from "vitest";
import {
  duplicateProductionNeededIds,
  isUnreadProductionNeeded,
  quantityExceedsStock,
  shouldInsertProductionNeeded,
  shouldMarkProductionNeededRead,
} from "../productionNeededNotifications";

describe("shouldInsertProductionNeeded", () => {
  it("inserts once per order when qty exceeds catalog stock", () => {
    expect(
      shouldInsertProductionNeeded({
        productId: "p1",
        quantity: 12,
        stock: 3,
        existingUnreadForOrder: false,
      }),
    ).toBe(true);
  });

  it("skips a second line on the same order (the live duplicate pattern)", () => {
    expect(
      shouldInsertProductionNeeded({
        productId: "p2",
        quantity: 5,
        stock: 0,
        existingUnreadForOrder: true,
      }),
    ).toBe(false);
  });

  it("does not insert when stock covers the truncated quantity", () => {
    expect(quantityExceedsStock(0.5, 0)).toBe(false);
    expect(
      shouldInsertProductionNeeded({
        productId: "p1",
        quantity: 2,
        stock: 2,
        existingUnreadForOrder: false,
      }),
    ).toBe(false);
  });
});

describe("shouldMarkProductionNeededRead", () => {
  it("clears the alert when the order is delivered, cancelled, or returned", () => {
    expect(shouldMarkProductionNeededRead("delivered", "pending")).toBe(true);
    expect(shouldMarkProductionNeededRead("cancelled", "processing")).toBe(true);
    expect(shouldMarkProductionNeededRead("returned", "shipped")).toBe(true);
  });

  it("does not clear on in-flight status changes", () => {
    expect(shouldMarkProductionNeededRead("processing", "pending")).toBe(false);
    expect(shouldMarkProductionNeededRead("shipped", "processing")).toBe(false);
  });
});

describe("duplicateProductionNeededIds", () => {
  it("keeps the newest unread row per order_id", () => {
    const dupes = duplicateProductionNeededIds([
      { id: "old", order_id: "o1", created_at: "2026-09-01T00:00:00.000Z" },
      { id: "mid", order_id: "o1", created_at: "2026-09-02T00:00:00.000Z" },
      { id: "new", order_id: "o1", created_at: "2026-09-03T00:00:00.000Z" },
      { id: "other", order_id: "o2", created_at: "2026-09-03T00:00:00.000Z" },
    ]);
    expect(dupes.sort()).toEqual(["mid", "old"]);
  });
});

describe("isUnreadProductionNeeded", () => {
  it("matches only unread manufacturing alerts", () => {
    expect(isUnreadProductionNeeded({ type: "production_needed", is_read: false })).toBe(true);
    expect(isUnreadProductionNeeded({ type: "production_needed", is_read: true })).toBe(false);
    expect(isUnreadProductionNeeded({ type: "low_stock", is_read: false })).toBe(false);
    expect(isUnreadProductionNeeded({ type: "manual_note", is_read: false })).toBe(false);
  });
});
