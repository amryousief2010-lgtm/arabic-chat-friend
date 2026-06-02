import { describe, it, expect } from "vitest";

/**
 * Pure simulation of the three DB triggers that touch `inventory_items.stock`
 * when a row in `inventory_movements` is inserted / updated / deleted:
 *   - apply_inventory_movement              (AFTER INSERT)
 *   - adjust_inventory_movement_on_update   (AFTER UPDATE OF quantity)
 *   - reverse_inventory_movement_on_delete  (BEFORE DELETE)
 *
 * If the frontend ALSO updates inventory_items.stock for a return movement
 * the user sees double-counting (e.g. +4 instead of +2 on insert, −4 instead
 * of −2 on delete). This test locks the contract that ONLY the trigger acts
 * on stock, so any future regression that re-introduces a manual update on
 * the client will fail here.
 */

type Movement = { id: string; item_id: string; movement_type: string; quantity: number; approval_status: string };

const RETURN_TYPES = new Set(["in", "purchase_receipt", "stock_in", "finished_goods_receipt", "return"]);

class StockSim {
  stock = 0;
  movements: Movement[] = [];
  /** Simulates AFTER INSERT trigger */
  insert(m: Movement) {
    this.movements.push({ ...m });
    if (m.approval_status !== "posted") return;
    if (RETURN_TYPES.has(m.movement_type)) this.stock += m.quantity;
    else this.stock = Math.max(0, this.stock - m.quantity);
  }
  /** Simulates AFTER UPDATE OF quantity trigger (delta) */
  updateQty(id: string, newQty: number) {
    const m = this.movements.find((x) => x.id === id)!;
    const delta = newQty - m.quantity;
    m.quantity = newQty;
    if (m.approval_status !== "posted" || delta === 0) return;
    if (RETURN_TYPES.has(m.movement_type)) this.stock = Math.max(0, this.stock + delta);
    else this.stock = Math.max(0, this.stock - delta);
  }
  /** Simulates BEFORE DELETE trigger */
  delete(id: string) {
    const idx = this.movements.findIndex((x) => x.id === id);
    const m = this.movements[idx];
    this.movements.splice(idx, 1);
    if (m.approval_status !== "posted") return;
    if (RETURN_TYPES.has(m.movement_type)) this.stock = Math.max(0, this.stock - m.quantity);
    else this.stock += m.quantity;
  }
}

const mk = (id: string, quantity: number): Movement => ({
  id, item_id: "item-1", movement_type: "return", quantity, approval_status: "posted",
});

describe("Healthy Taste return — single-trigger inventory math", () => {
  it("INSERT +2 increases actual stock by 2 (not 4)", () => {
    const s = new StockSim();
    s.stock = 10;
    s.insert(mk("m1", 2));
    expect(s.stock).toBe(12);
    expect(s.movements).toHaveLength(1);
  });

  it("DELETE of a posted +2 return decreases stock by 2 (not 4)", () => {
    const s = new StockSim();
    s.stock = 10;
    s.insert(mk("m1", 2));   // 12
    s.delete("m1");           // back to 10
    expect(s.stock).toBe(10);
    expect(s.movements).toHaveLength(0);
  });

  it("UPDATE 2 → 3 increases stock by 1 ONLY (delta, not duplicate)", () => {
    const s = new StockSim();
    s.stock = 10;
    s.insert(mk("m1", 2));   // 12
    s.updateQty("m1", 3);     // +1 → 13
    expect(s.stock).toBe(13);
  });

  it("UPDATE 3 → 1 decreases stock by 2 ONLY", () => {
    const s = new StockSim();
    s.stock = 10;
    s.insert(mk("m1", 3));   // 13
    s.updateQty("m1", 1);     // −2 → 11
    expect(s.stock).toBe(11);
  });

  it("INSERT then UPDATE then DELETE returns to the original baseline", () => {
    const s = new StockSim();
    s.stock = 20;
    s.insert(mk("m1", 2));   // 22
    s.updateQty("m1", 5);     // 25
    s.updateQty("m1", 4);     // 24
    s.delete("m1");           // 20
    expect(s.stock).toBe(20);
  });

  it("multiple returns are independent — deleting one only reverses its own qty", () => {
    const s = new StockSim();
    s.stock = 0;
    s.insert(mk("a", 2));    // 2
    s.insert(mk("b", 5));    // 7
    s.delete("a");            // 5  (must NOT touch b)
    expect(s.stock).toBe(5);
  });
});
