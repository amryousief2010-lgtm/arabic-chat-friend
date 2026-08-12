import { describe, it, expect } from "vitest";
import { summarizeOrderItems } from "../orderItemSummary";

describe("summarizeOrderItems", () => {
  it("merges same product with different prices", () => {
    const r = summarizeOrderItems([
      { product_id: "k", product_name: "كفتة", quantity: 1, unit: "كجم" },
      { product_id: "k", product_name: "كفتة", quantity: 1, unit: "كجم" },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].quantity).toBe(2);
  });
  it("merges halves", () => {
    const r = summarizeOrderItems([
      { product_id: "w", product_name: "كوارع", quantity: 0.5, unit: "كجم" },
      { product_id: "w", product_name: "كوارع", quantity: 0.5, unit: "كجم" },
    ]);
    expect(r[0].quantity).toBe(1);
  });
  it("keeps different products apart", () => {
    const r = summarizeOrderItems([
      { product_id: "a", product_name: "كفتة", quantity: 1, unit: "كجم" },
      { product_id: "b", product_name: "كفتة أرز", quantity: 1, unit: "كجم" },
    ]);
    expect(r).toHaveLength(2);
  });
});
