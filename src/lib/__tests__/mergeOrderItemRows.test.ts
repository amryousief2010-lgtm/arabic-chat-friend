import { describe, expect, it } from "vitest";
import { mergeOrderItemRows, type MergeableOrderItem } from "@/lib/mergeOrderItemRows";

const row = (patch: Partial<MergeableOrderItem> & Pick<MergeableOrderItem, "product_id" | "quantity" | "unit_price" | "total_price">): MergeableOrderItem => ({
  order_id: "order-1",
  product_name: "برجر",
  is_half_kg: false,
  is_gift: false,
  offer_name: null,
  offer_box_id: null,
  ...patch,
});

describe("mergeOrderItemRows", () => {
  it("keeps the same product from two offers as two lines with their own prices", () => {
    const saved = mergeOrderItemRows([
      row({
        product_id: "burger",
        quantity: 0.5,
        unit_price: 140,
        total_price: 70,
        is_half_kg: true,
        offer_name: "عرض 1500",
        offer_box_id: "box-1500",
      }),
      row({
        product_id: "burger",
        quantity: 1,
        unit_price: 250,
        total_price: 250,
        offer_name: "عرض 1000",
        offer_box_id: "box-1000",
      }),
    ]);

    expect(saved).toHaveLength(2);
    expect(saved.map((item) => item.offer_name).sort()).toEqual(["عرض 1000", "عرض 1500"]);
    expect(saved.find((item) => item.offer_name === "عرض 1500")).toMatchObject({
      quantity: 0.5,
      unit_price: 140,
      total_price: 70,
    });
    expect(saved.find((item) => item.offer_name === "عرض 1000")).toMatchObject({
      quantity: 1,
      unit_price: 250,
      total_price: 250,
    });
    expect(saved.every((item) => !("offer_box_id" in item))).toBe(true);
  });

  it("does not average prices when two boxes share a name", () => {
    const saved = mergeOrderItemRows([
      row({
        product_id: "burger",
        quantity: 1,
        unit_price: 140,
        total_price: 140,
        offer_name: "عرض",
        offer_box_id: "box-a",
      }),
      row({
        product_id: "burger",
        quantity: 1,
        unit_price: 250,
        total_price: 250,
        offer_name: "عرض",
        offer_box_id: "box-b",
      }),
    ]);

    expect(saved).toHaveLength(2);
    expect(saved.map((item) => item.unit_price).sort()).toEqual([140, 250]);
  });

  it("merges half-kg packets of the same product inside the same offer", () => {
    const saved = mergeOrderItemRows([
      row({
        product_id: "burger",
        quantity: 0.5,
        unit_price: 140,
        total_price: 70,
        is_half_kg: true,
        offer_name: "عرض 1500",
        offer_box_id: "box-1500",
      }),
      row({
        product_id: "burger",
        quantity: 0.5,
        unit_price: 140,
        total_price: 70,
        is_half_kg: true,
        offer_name: "عرض 1500",
        offer_box_id: "box-1500",
      }),
    ]);

    expect(saved).toEqual([
      expect.objectContaining({
        product_id: "burger",
        quantity: 1,
        unit_price: 140,
        total_price: 140,
        is_half_kg: true,
        offer_name: "عرض 1500",
      }),
    ]);
  });

  it("still merges non-offer half-kg lines that share a product and price", () => {
    const saved = mergeOrderItemRows([
      row({ product_id: "kofta", product_name: "كفتة", quantity: 0.5, unit_price: 400, total_price: 200, is_half_kg: true }),
      row({ product_id: "kofta", product_name: "كفتة", quantity: 0.5, unit_price: 400, total_price: 200, is_half_kg: true }),
    ]);

    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      quantity: 1,
      unit_price: 400,
      total_price: 400,
      offer_name: null,
      is_half_kg: true,
    });
  });

  it("does not collapse non-offer lines that have different unit prices", () => {
    const saved = mergeOrderItemRows([
      row({ product_id: "burger", quantity: 1, unit_price: 140, total_price: 140 }),
      row({ product_id: "burger", quantity: 1, unit_price: 250, total_price: 250 }),
    ]);

    expect(saved).toHaveLength(2);
    expect(saved.map((item) => item.unit_price).sort()).toEqual([140, 250]);
  });

  it("keeps a gift line separate from the paid line of the same offer product", () => {
    const saved = mergeOrderItemRows([
      row({
        product_id: "burger",
        quantity: 1,
        unit_price: 140,
        total_price: 140,
        offer_name: "عرض 1500",
        offer_box_id: "box-1500",
      }),
      row({
        product_id: "burger",
        quantity: 0.5,
        unit_price: 0,
        total_price: 0,
        is_gift: true,
        is_half_kg: true,
        offer_name: "عرض 1500",
        offer_box_id: "box-1500",
      }),
    ]);

    expect(saved).toHaveLength(2);
    expect(saved.find((item) => item.is_gift)).toMatchObject({ quantity: 0.5, unit_price: 0, offer_name: "عرض 1500" });
    expect(saved.find((item) => !item.is_gift)).toMatchObject({ quantity: 1, unit_price: 140, offer_name: "عرض 1500" });
  });
});
