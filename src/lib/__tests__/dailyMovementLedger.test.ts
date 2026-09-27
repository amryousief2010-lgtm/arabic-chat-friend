import { describe, expect, it } from "vitest";
import { buildDailyLedger, movementBucket } from "../dailyMovementLedger";

describe("daily movement ledger", () => {
  it("classifies ins and outs", () => {
    expect(movementBucket({ movement_type: "in", reference_type: "warehouse_transfer" })).toBe("transferIn");
    expect(movementBucket({ movement_type: "purchase_receipt" })).toBe("purchaseIn");
    expect(movementBucket({ movement_type: "sales_return" })).toBe("returnsIn");
    expect(movementBucket({ movement_type: "sales_dispatch" })).toBe("salesOut");
    expect(movementBucket({ movement_type: "transfer" })).toBe("transferOut");
    expect(movementBucket({ movement_type: "waste_loss" })).toBe("wasteOut");
    expect(movementBucket({ movement_type: "out" })).toBe("manualOut");
  });

  it("opens from the card and treats an absolute adjustment by its snapshot", () => {
    const rows = buildDailyLedger(
      [{ id: "a", name: "فيليه", unit: "كجم", warehouse_id: "w", stock: 9, unit_cost: 2 }],
      [
        { item_id: "a", performed_at: "2026-09-30T10:00:00", movement_type: "in", quantity: 4, reference_type: null, stock_before: 8, stock_after: 12 },
        { item_id: "a", performed_at: "2026-09-30T12:00:00", movement_type: "adjustment", quantity: 10, effect_mode: "set", stock_before: 12, stock_after: 10 },
        { item_id: "a", performed_at: "2026-10-01T09:00:00", movement_type: "sales_dispatch", quantity: 1, stock_before: 10, stock_after: 9 },
      ],
      "2026-09-30T00:00:00",
      "2026-09-30T23:59:59",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].opening).toBe(8);
    expect(rows[0].purchaseIn).toBe(4);
    expect(rows[0].adjustment).toBe(-2);
    expect(rows[0].closing).toBe(10);
    expect(rows[0].value).toBe(20);
  });
});
