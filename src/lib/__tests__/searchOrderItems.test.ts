import { describe, expect, it } from "vitest";
import { itemsFromSearchPayload } from "@/lib/searchOrderItems";

const lines = [
  { id: "1", order_id: "ord", product_name: "برجر", quantity: 1, unit_price: 250, total_price: 250, offer_name: "عرض 1160" },
  { id: "2", order_id: "ord", product_name: "حواوشي", quantity: 0.5, unit_price: 180, total_price: 90, offer_name: "عرض 1160" },
  { id: "3", order_id: "ord", product_name: "سجق", quantity: 1, unit_price: 300, total_price: 300, offer_name: "عرض 1160" },
  { id: "4", order_id: "ord", product_name: "كفتة", quantity: 1, unit_price: 250, total_price: 250, offer_name: "عرض 1160" },
  { id: "5", order_id: "ord", product_name: "مفروم", quantity: 1, unit_price: 250, total_price: 250, offer_name: "عرض 1160" },
  { id: "6", order_id: "ord", product_name: "نخاع", quantity: 1, unit_price: 0, total_price: 0, offer_name: "عرض 1160" },
];

describe("itemsFromSearchPayload", () => {
  it("keeps every line from a search_orders items array for the detail dialog", () => {
    const items = itemsFromSearchPayload(lines);
    expect(items).toHaveLength(6);
    expect(items.map((item) => item.product_name)).toEqual(["برجر", "حواوشي", "سجق", "كفتة", "مفروم", "نخاع"]);
    expect(items.map((item) => item.quantity)).toEqual([1, 0.5, 1, 1, 1, 1]);
    expect(items.reduce((sum, item) => sum + Number(item.total_price), 0)).toBe(1140);
  });

  it("parses a jsonb string and does not invent lines for an empty payload", () => {
    expect(itemsFromSearchPayload(JSON.stringify(lines))).toEqual(lines);
    expect(itemsFromSearchPayload(null)).toEqual([]);
    expect(itemsFromSearchPayload(undefined)).toEqual([]);
    expect(itemsFromSearchPayload("not-json")).toEqual([]);
    expect(itemsFromSearchPayload({ product_name: "برجر" })).toEqual([]);
  });
});
