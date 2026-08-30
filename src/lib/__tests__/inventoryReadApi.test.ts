import { describe, it, expect } from "vitest";
import {
  mapAvailabilityError,
  mapItemToProduct,
  sumAvailableByProduct,
  type SalesAvailabilityRow,
} from "@/lib/inventoryReadApi";

const row = (o: Partial<SalesAvailabilityRow>): SalesAvailabilityRow => ({
  inventory_item_id: "i1",
  product_id: "p1",
  warehouse_id: "w1",
  warehouse_name: "الرئيسي",
  item_code: null,
  item_name: "صنف",
  unit: "كجم",
  current_stock: 0,
  reserved_stock: 0,
  blocked_stock: 0,
  available_stock: 0,
  is_active: true,
  is_low_stock: false,
  ...o,
});

describe("inventoryReadApi helpers", () => {
  it("aggregates multiple inventory rows of the same product in one warehouse", () => {
    const rows = [
      row({ inventory_item_id: "i1", available_stock: 5 }),
      row({ inventory_item_id: "i2", available_stock: 7 }),
      row({ inventory_item_id: "i3", warehouse_id: "w2", available_stock: 100 }),
    ];
    expect(sumAvailableByProduct(rows, "w1")).toEqual({ p1: 12 });
    expect(sumAvailableByProduct(rows, "w2")).toEqual({ p1: 100 });
  });

  it("includes inactive rows when they are returned by the RPC", () => {
    const rows = [row({ available_stock: 3, is_active: false })];
    expect(sumAvailableByProduct(rows, "w1")).toEqual({ p1: 3 });
  });

  it("maps inventory item ids to product ids", () => {
    const rows = [
      row({ inventory_item_id: "a", product_id: "pa" }),
      row({ inventory_item_id: "b", product_id: "pb" }),
    ];
    expect(mapItemToProduct(rows)).toEqual({ a: "pa", b: "pb" });
  });

  it("maps RPC authorization errors to Arabic messages", () => {
    expect(mapAvailabilityError("NOT_AUTHENTICATED")).toContain("تسجيل الدخول");
    expect(mapAvailabilityError("NOT_AUTHORIZED_FOR_INVENTORY_AVAILABILITY")).toContain("صلاحية");
  });
});
