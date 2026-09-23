import { describe, it, expect } from "vitest";
import { computeOrderTotals, isOfferShippingLine, orderHeaderAfterItemChange } from "@/lib/orderTotals";

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

  it("removing offer products does not drop a legacy shipping line", () => {
    const items = [
      { product_id: "k", product_name: "كفتة", offer_name: "عرض", quantity: 1, unit_price: 290, _deleted: true },
      shippingLine("عرض"),
      { product_id: "x", product_name: "بطاطس", quantity: 1, unit_price: 50 },
    ];
    const t = computeOrderTotals(items);
    expect(t.hasOfferItems).toBe(false);
    expect(t.includedShippingCost).toBe(110);
    expect(t.shipping).toBe(110);
    expect(t.subtotal).toBe(50);
    expect(t.total).toBe(160);
  });

  it("a real offer product with no product_id is not treated as shipping", () => {
    const burger = {
      product_id: null,
      product_name: "برجر",
      offer_name: "عرض 4 كيلو",
      quantity: 1,
      unit_price: 250,
    };
    expect(isOfferShippingLine(burger)).toBe(false);
    const t = computeOrderTotals([burger], { extraDeliveryFee: 70 });
    expect(t.subtotal).toBe(250);
    expect(t.includedShippingCost).toBe(0);
    expect(t.shipping).toBe(70);
    expect(t.total).toBe(320);
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

  it("two boxes @1000 with no bundled shipping line: saved shipping 80 stays in the total", () => {
    const items = [
      { product_id: "a", product_name: "برجر", offer_name: "عرض 4 كيلو", quantity: 2, unit_price: 250 },
      { product_id: "b", product_name: "كفتة", offer_name: "عرض 4 كيلو", quantity: 2, unit_price: 250 },
      { product_id: "c", product_name: "سجق", offer_name: "عرض 4 كيلو", quantity: 2, unit_price: 250 },
      { product_id: "d", product_name: "مفروم", offer_name: "عرض 4 كيلو", quantity: 2, unit_price: 250 },
      // gifts priced at zero must not change money
      { product_id: "g1", product_name: "نخاع", offer_name: "عرض 4 كيلو", quantity: 1, unit_price: 0 },
    ];
    const t = computeOrderTotals(items, { extraDeliveryFee: 80 });
    expect(t.subtotal).toBe(2000);
    expect(t.includedShippingCost).toBe(0);
    expect(t.total).toBe(2080);
  });

  it("explicit zero shipping stays zero", () => {
    const items = [
      { product_id: "a", product_name: "برجر", offer_name: "عرض 4 كيلو", quantity: 2, unit_price: 500 },
    ];
    const t = computeOrderTotals(items, { extraDeliveryFee: 0 });
    expect(t.total).toBe(1000);
  });

  it("bundled shipping line is never double counted with a saved shipping value", () => {
    const items = [
      { product_id: "k", product_name: "كفتة", offer_name: "عرض", quantity: 1, unit_price: 500 },
      shippingLine("عرض", 110),
    ];
    const t = computeOrderTotals(items, { extraDeliveryFee: 110 });
    expect(t.shipping).toBe(110);
    expect(t.total).toBe(610);
  });

  it("header shipping 70 wins over a different legacy shipping line", () => {
    const items = [
      { product_id: "a", product_name: "برجر", offer_name: "بوكس 1", quantity: 1, unit_price: 1000 },
      shippingLine("بوكس 1", 110),
    ];
    const t = computeOrderTotals(items, { extraDeliveryFee: 70 });
    expect(t.subtotal).toBe(1000);
    expect(t.shipping).toBe(70);
    expect(t.total).toBe(1070);
  });
});

const box = (name: string, price: number) => ({
  product_id: name,
  product_name: name,
  offer_name: name,
  quantity: 1,
  unit_price: price,
});

describe("order shipping stays independent of box edits", () => {
  const box1 = box("بوكس 1", 1000);
  const box2 = box("بوكس 2", 800);

  it("add box keeps shipping 70 and total = boxes + shipping", () => {
    const before = orderHeaderAfterItemChange([box1], { deliveryFee: 70 });
    expect(before.delivery_fee).toBe(70);
    expect(before.total).toBe(1070);

    const after = orderHeaderAfterItemChange([box1, box2], { deliveryFee: before.delivery_fee });
    expect(after.delivery_fee).toBe(70);
    expect(after.subtotal).toBe(1800);
    expect(after.shipping).toBe(70);
    expect(after.total).toBe(1870);
  });

  it("remove box keeps shipping 70", () => {
    const after = orderHeaderAfterItemChange(
      [{ ...box1, _deleted: true }, box2],
      { deliveryFee: 70 }
    );
    expect(after.delivery_fee).toBe(70);
    expect(after.subtotal).toBe(800);
    expect(after.total).toBe(870);
  });

  it("removing the only box still keeps shipping 70", () => {
    const after = orderHeaderAfterItemChange(
      [{ ...box1, _deleted: true }],
      { deliveryFee: 70 }
    );
    expect(after.delivery_fee).toBe(70);
    expect(after.subtotal).toBe(0);
    expect(after.total).toBe(70);
  });

  it("swap box keeps shipping 70", () => {
    const after = orderHeaderAfterItemChange(
      [{ ...box1, _deleted: true }, box2],
      { deliveryFee: 70 }
    );
    expect(after.delivery_fee).toBe(70);
    expect(after.subtotal).toBe(800);
    expect(after.total).toBe(870);
  });

  it("quantity change keeps shipping 70", () => {
    const after = orderHeaderAfterItemChange(
      [{ ...box1, quantity: 3 }],
      { deliveryFee: 70 }
    );
    expect(after.delivery_fee).toBe(70);
    expect(after.subtotal).toBe(3000);
    expect(after.total).toBe(3070);
  });

  it("manual shipping edit updates the fee and the total", () => {
    const after = orderHeaderAfterItemChange([box1, box2], {
      deliveryFee: 90,
      shippingEdited: true,
    });
    expect(after.delivery_fee).toBe(90);
    expect(after.shipping).toBe(90);
    expect(after.total).toBe(1890);
  });

  it("manual clear to 0 sticks even if a legacy shipping line remains", () => {
    const items = [box1, shippingLine("بوكس 1", 110)];
    const after = orderHeaderAfterItemChange(items, {
      deliveryFee: 0,
      shippingEdited: true,
    });
    expect(after.delivery_fee).toBe(0);
    expect(after.shipping).toBe(0);
    expect(after.subtotal).toBe(1000);
    expect(after.total).toBe(1000);
  });

  it("does not re-derive shipping from a new box when the header is already set", () => {
    const after = orderHeaderAfterItemChange(
      [box1, box2, shippingLine("بوكس 2", 110)],
      { deliveryFee: 70 }
    );
    expect(after.delivery_fee).toBe(70);
    expect(after.shipping).toBe(70);
    expect(after.total).toBe(1870);
  });
});
