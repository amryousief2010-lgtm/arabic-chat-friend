import { describe, it, expect } from "vitest";
import { computeOrderTotals } from "@/lib/orderTotals";

// Mirrors how AddOfferDialog inserts the synthetic shipping line.
const shippingLine = (offerName: string, cost = 110) => ({
  product_id: null,
  product_name: "تكلفة الشحن",
  offer_name: offerName,
  quantity: 1,
  unit_price: cost,
});

describe("computeOrderTotals", () => {
  it("product-only order: no shipping is added", () => {
    const t = computeOrderTotals([
      { product_id: "p1", product_name: "لحم", quantity: 1, unit_price: 500 },
      { product_id: "p2", product_name: "سجق", quantity: 1, unit_price: 300 },
      { product_id: "p3", product_name: "برجر", quantity: 1, unit_price: 200 },
    ]);
    expect(t.includedShippingCost).toBe(0);
    expect(t.subtotal).toBe(1000);
    expect(t.total).toBe(1000);
    expect(t.hasOfferItems).toBe(false);
  });

  it("offer order with shipping 110 → total 1335", () => {
    const items = [
      { product_id: "k", product_name: "كفتة", offer_name: "عرض الأسرة", quantity: 1, unit_price: 290 },
      { product_id: "b", product_name: "برجر", offer_name: "عرض الأسرة", quantity: 1, unit_price: 305 },
      { product_id: "s", product_name: "سجق", offer_name: "عرض الأسرة", quantity: 1, unit_price: 320 },
      { product_id: "h", product_name: "حواوشي", offer_name: "عرض الأسرة", quantity: 1, unit_price: 310 },
      shippingLine("عرض الأسرة"),
    ];
    const t = computeOrderTotals(items);
    expect(t.subtotal).toBe(1225);
    expect(t.includedShippingCost).toBe(110);
    expect(t.total).toBe(1335);
    expect(t.hasOfferItems).toBe(true);
  });

  it("editing offer and saving without changes preserves total 1335 and shipping 110", () => {
    const items = [
      { product_id: "k", product_name: "كفتة", offer_name: "عرض الأسرة", quantity: 1, unit_price: 290 },
      { product_id: "b", product_name: "برجر", offer_name: "عرض الأسرة", quantity: 1, unit_price: 305 },
      { product_id: "s", product_name: "سجق", offer_name: "عرض الأسرة", quantity: 1, unit_price: 320 },
      { product_id: "h", product_name: "حواوشي", offer_name: "عرض الأسرة", quantity: 1, unit_price: 310 },
      shippingLine("عرض الأسرة"),
    ];
    const t = computeOrderTotals(items);
    expect(t.total).toBe(1335);
    expect(t.includedShippingCost).toBe(110);
  });

  it("replace kofta 290 with meat 500 inside offer → total 1545, shipping still 110", () => {
    const items = [
      { product_id: "m", product_name: "لحم", offer_name: "عرض الأسرة", quantity: 1, unit_price: 500 },
      { product_id: "b", product_name: "برجر", offer_name: "عرض الأسرة", quantity: 1, unit_price: 305 },
      { product_id: "s", product_name: "سجق", offer_name: "عرض الأسرة", quantity: 1, unit_price: 320 },
      { product_id: "h", product_name: "حواوشي", offer_name: "عرض الأسرة", quantity: 1, unit_price: 310 },
      shippingLine("عرض الأسرة"),
    ];
    const t = computeOrderTotals(items);
    expect(t.subtotal).toBe(1435);
    expect(t.includedShippingCost).toBe(110);
    expect(t.total).toBe(1545);
  });

  it("add a normal extra product to an offer order: shipping stays 110, counted once", () => {
    const items = [
      { product_id: "k", product_name: "كفتة", offer_name: "عرض الأسرة", quantity: 1, unit_price: 290 },
      { product_id: "b", product_name: "برجر", offer_name: "عرض الأسرة", quantity: 1, unit_price: 305 },
      { product_id: "s", product_name: "سجق", offer_name: "عرض الأسرة", quantity: 1, unit_price: 320 },
      { product_id: "h", product_name: "حواوشي", offer_name: "عرض الأسرة", quantity: 1, unit_price: 310 },
      shippingLine("عرض الأسرة"),
      // extra non-offer product (just like adding "إضافة منتج" in the dialog)
      { product_id: "x", product_name: "بطاطس", quantity: 1, unit_price: 50 },
    ];
    const t = computeOrderTotals(items);
    expect(t.includedShippingCost).toBe(110);
    expect(t.subtotal).toBe(1225 + 50);
    expect(t.total).toBe(1335 + 50);
  });

  it("remove all offer items → includedShippingCost collapses to 0", () => {
    const items = [
      { product_id: "k", product_name: "كفتة", offer_name: "عرض", quantity: 1, unit_price: 290, _deleted: true },
      shippingLine("عرض"),
      { product_id: "x", product_name: "بطاطس", quantity: 1, unit_price: 50 },
    ];
    const t = computeOrderTotals(items);
    expect(t.hasOfferItems).toBe(false);
    expect(t.includedShippingCost).toBe(0);
    expect(t.subtotal).toBe(50);
    expect(t.total).toBe(50);
  });

  it("non-offer order ignores extraDeliveryFee=0 default and never auto-adds shipping", () => {
    const t = computeOrderTotals(
      [{ product_id: "p", product_name: "لحم", quantity: 2, unit_price: 250 }],
      { discount: 0 }
    );
    expect(t.total).toBe(500);
  });

  it("موزة @ 290 with quantity 2 → line total 580 (NOT 1160). unit_price stays 290", () => {
    const item = { product_id: "mz", product_name: "موزة", quantity: 2, unit_price: 290 };
    const t = computeOrderTotals([item]);
    // unit_price must remain the price of ONE unit
    expect(item.unit_price).toBe(290);
    // line total = qty * unit_price = 580 (never 1160)
    expect(t.subtotal).toBe(580);
    expect(t.total).toBe(580);
  });
});
