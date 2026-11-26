import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  firstFixedWeightViolation, fixedPieces, fixedWeightError, fixedWeightLabel, fixedWeightOf,
  isFixedWeightQtyValid, snapFixedWeightQty,
} from "../fixedWeight";

describe("fixedWeightOf", () => {
  it("returns the weight only for positive numbers", () => {
    expect(fixedWeightOf({ fixed_weight_kg: 6 })).toBe(6);
    expect(fixedWeightOf({ fixed_weight_kg: "6.000" })).toBe(6);
    expect(fixedWeightOf({ fixed_weight_kg: null })).toBeNull();
    expect(fixedWeightOf({ fixed_weight_kg: 0 })).toBeNull();
    expect(fixedWeightOf(undefined)).toBeNull();
    expect(fixedWeightOf({})).toBeNull();
  });
});

describe("isFixedWeightQtyValid", () => {
  it("accepts only whole multiples of the fixed weight", () => {
    expect(isFixedWeightQtyValid(6, 6)).toBe(true);
    expect(isFixedWeightQtyValid(12, 6)).toBe(true);
    expect(isFixedWeightQtyValid(18, 6)).toBe(true);
    expect(isFixedWeightQtyValid(1, 6)).toBe(false);
    expect(isFixedWeightQtyValid(7, 6)).toBe(false);
    expect(isFixedWeightQtyValid(5.99, 6)).toBe(false);
    expect(isFixedWeightQtyValid(9, 6)).toBe(false);
    expect(isFixedWeightQtyValid(0, 6)).toBe(false);
    expect(isFixedWeightQtyValid(-6, 6)).toBe(false);
    expect(isFixedWeightQtyValid(Number.NaN, 6)).toBe(false);
  });
});

describe("snapFixedWeightQty", () => {
  it("rounds up to the next whole piece and never below one piece", () => {
    expect(snapFixedWeightQty(1, 6)).toBe(6);
    expect(snapFixedWeightQty(7, 6)).toBe(12);
    expect(snapFixedWeightQty(12, 6)).toBe(12);
    expect(snapFixedWeightQty(0, 6)).toBe(6);
    expect(snapFixedWeightQty(Number.NaN, 6)).toBe(6);
  });
});

describe("labels and violations", () => {
  it("formats the label, pieces and error", () => {
    expect(fixedWeightLabel(6)).toBe("6 كجم");
    expect(fixedPieces(12, 6)).toBe(2);
    expect(fixedWeightError("دبوس بالعظم", 7, 6)).toContain("وزنها ثابت 6 كجم");
  });
  it("finds the first offending line", () => {
    const drumstick = { name: "دبوس بالعظم", fixed_weight_kg: 6 };
    const fillet = { name: "فيليه", fixed_weight_kg: null };
    expect(firstFixedWeightViolation([{ quantity: 1.5, product: fillet }, { quantity: 6, product: drumstick }])).toBeNull();
    expect(firstFixedWeightViolation([{ quantity: 7, product: drumstick }])).toEqual({ name: "دبوس بالعظم", qty: 7, fixedKg: 6 });
  });
});

describe("migration 20261126130000_products_fixed_weight", () => {
  const sql = readFileSync("supabase/migrations/20261126130000_products_fixed_weight.sql", "utf8");
  it("adds the generic column, grant and trigger", () => {
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS fixed_weight_kg numeric(10,3)");
    expect(sql).toContain("GRANT SELECT (fixed_weight_kg) ON public.products TO authenticated");
    expect(sql).toContain("BEFORE INSERT OR UPDATE OF product_id, quantity, is_half_kg ON public.order_items");
    expect(sql).toContain("FIXED_WEIGHT_QTY");
  });
  it("only flags the drumstick product and never touches old rows", () => {
    expect(sql).toContain("405ece91-0ad3-4b51-afb0-da90dc69cbbe");
    expect(sql).not.toMatch(/UPDATE\s+public\.order_items/i);
  });
});
