import { describe, expect, it } from "vitest";
import {
  includedShippingForCopies,
  listBoxCopies,
  orderProductSubtotal,
  previewBoxCopyChange,
  shippingAfterCopyChange,
  splitQuantity,
  stockDelta,
  type BoxLine,
  type OfferInstanceRow,
} from "@/lib/boxCopies";

const month: OfferInstanceRow = {
  id: "inst-month",
  offer_name: "بوكس الشهر 1600",
  quantity: 2,
  offer_box_id: "box-month",
};
const monthLines: BoxLine[] = [
  { id: "b", product_id: "p1", product_name: "برجر", quantity: 2, unit_price: 400, offer_name: "بوكس الشهر 1600" },
  { id: "k", product_id: "p2", product_name: "كفتة", quantity: 2, unit_price: 340, offer_name: "بوكس الشهر 1600" },
  { id: "s", product_id: "p3", product_name: "سجق", quantity: 2, unit_price: 740, offer_name: "بوكس الشهر 1600" },
];
const shipping = { "بوكس الشهر 1600": 120, "عرض الرقاب": 40, "عرض بدون شحن": null };

describe("listBoxCopies", () => {
  it("shows one box at its recorded line total, not the catalog name", () => {
    const copies = listBoxCopies({
      instances: [{ id: "inst-neck", offer_name: "عرض الرقاب", quantity: 1, offer_box_id: "box-neck" }],
      items: [{ id: "n", product_id: "neck", product_name: "رقاب", quantity: 1, unit_price: 540, offer_name: "عرض الرقاب" }],
    });
    expect(copies).toHaveLength(1);
    expect(copies[0].key).toBe("inst:inst-neck:1");
    expect(copies[0].copyIndex).toBe(1);
    expect(copies[0].recordedPrice).toBe(540);
  });

  it("splits two identical boxes into two copies whose prices sum to the merged lines", () => {
    const copies = listBoxCopies({ instances: [month], items: monthLines });
    expect(copies.map((copy) => copy.key)).toEqual(["inst:inst-month:1", "inst:inst-month:2"]);
    expect(copies.every((copy) => copy.recordedPrice === 1480)).toBe(true);
    expect(copies.every((copy) => copy.lines.length === 3)).toBe(true);
    expect(copies[0].recordedPrice + copies[1].recordedPrice).toBe(2960);
    expect(orderProductSubtotal(monthLines)).toBe(2960);
  });

  it("splits three copies and keeps the original line total", () => {
    const copies = listBoxCopies({
      instances: [{ ...month, quantity: 3 }],
      items: monthLines.map((line) => ({ ...line, quantity: line.quantity * 1.5 })),
    });
    expect(copies).toHaveLength(3);
    expect(copies.reduce((sum, copy) => sum + copy.recordedPrice, 0)).toBe(4440);
  });

  it("keeps each copy on the unit price recorded for its own lines", () => {
    const copies = listBoxCopies({
      instances: [{ id: "inst-1500", offer_name: "بوكس 1500", quantity: 2, offer_box_id: "box-1500" }],
      items: [
        { id: "b", product_id: "p1", product_name: "برجر", quantity: 2, unit_price: 250, offer_name: "بوكس 1500", created_at: "2026-10-01T00:00:00Z" },
        { id: "h-old", product_id: "p2", product_name: "حواوشي", quantity: 2, unit_price: 180, offer_name: "بوكس 1500", created_at: "2026-10-01T00:00:01Z" },
        { id: "h-new", product_id: "p2", product_name: "حواوشي", quantity: 2, unit_price: 250, offer_name: "بوكس 1500", created_at: "2026-10-02T00:00:00Z" },
      ],
    });
    expect(copies).toHaveLength(2);
    expect(copies[0].lines.find((line) => line.product_name === "حواوشي")).toMatchObject({ quantity: 2, unit_price: 180 });
    expect(copies[1].lines.find((line) => line.product_name === "حواوشي")).toMatchObject({ quantity: 2, unit_price: 250 });
    expect(copies[0].lines.find((line) => line.product_name === "برجر")).toMatchObject({ quantity: 1, unit_price: 250 });
    expect(copies[1].lines.find((line) => line.product_name === "برجر")).toMatchObject({ quantity: 1, unit_price: 250 });
    expect(copies[0].recordedPrice).toBe(610);
    expect(copies[1].recordedPrice).toBe(750);
    const preview = previewBoxCopyChange({
      copies,
      targetKey: copies[0].key,
      operation: "delete",
      shippingByName: {},
      subtotal: 1360,
      deliveryFee: 0,
    });
    expect(preview.removedLines.find((line) => line.product_name === "حواوشي")?.unit_price).toBe(180);
    expect(copies[1].lines.find((line) => line.product_name === "حواوشي")?.unit_price).toBe(250);
    expect(preview.priceDelta).toBe(-610);
  });

  it("leaves already-separate identical rows whole instead of fractioning them", () => {
    const copies = listBoxCopies({
      instances: [{ id: "inst-neck", offer_name: "عرض الرقاب", quantity: 3, offer_box_id: "box-neck" }],
      items: [1, 2, 3].map((n) => ({
        id: `neck-${n}`,
        product_id: "neck",
        product_name: "رقاب",
        quantity: 2,
        unit_price: 270,
        offer_name: "عرض الرقاب",
        created_at: `2026-10-0${n}T00:00:00Z`,
      })),
    });
    expect(copies).toHaveLength(3);
    expect(copies.map((copy) => copy.recordedPrice)).toEqual([540, 540, 540]);
    expect(copies.every((copy) => copy.lines.length === 1 && copy.lines[0].quantity === 2 && copy.lines[0].unit_price === 270)).toBe(true);
  });

  it("puts a quantity remainder on the lower copy indexes", () => {
    expect(splitQuantity(2, 3, 1)).toBe(0.6667);
    expect(splitQuantity(2, 3, 2)).toBe(0.6667);
    expect(splitQuantity(2, 3, 3)).toBe(0.6666);
    expect(splitQuantity(2, 3, 1) + splitQuantity(2, 3, 2) + splitQuantity(2, 3, 3)).toBe(2);
  });

  it("keeps an inactive copy out of the list and leaves the sibling lines intact", () => {
    const copies = listBoxCopies({
      instances: [{ ...month, quantity: 1 }],
      copies: [
        { id: "c1", offer_name: "بوكس الشهر 1600", copy_index: 1, active: false },
        { id: "c2", offer_name: "بوكس الشهر 1600", copy_index: 2, active: true },
      ],
      items: [
        { id: "b", product_id: "p1", product_name: "برجر", quantity: 1, unit_price: 400, offer_name: "بوكس الشهر 1600", offer_copy_id: "c2" },
      ],
    });
    expect(copies.map((copy) => copy.key)).toEqual(["copy:c2"]);
    expect(copies[0].lines).toHaveLength(1);
    expect(copies[0].recordedPrice).toBe(400);
  });

  it("keeps products without an offer as one group", () => {
    const copies = listBoxCopies({
      instances: [],
      items: [
        { id: "a", product_id: "p4", product_name: "ستيك", quantity: 1, unit_price: 200 },
        { id: "b", product_id: "p2", product_name: "كبدة", quantity: 1, unit_price: 80 },
      ],
    });
    expect(copies).toEqual([
      expect.objectContaining({ key: "plain", offerName: null, recordedPrice: 280 }),
    ]);
  });
});

describe("previewBoxCopyChange", () => {
  const two = listBoxCopies({ instances: [month], items: monthLines });

  it("replaces one copy with another box and leaves the sibling", () => {
    const preview = previewBoxCopyChange({
      copies: two,
      targetKey: "inst:inst-month:1",
      operation: "replace_box",
      replacementOfferName: "عرض الرقاب",
      replacementLines: [{ product_id: "neck", product_name: "رقاب", quantity: 1, unit_price: 540 }],
      shippingByName: shipping,
      subtotal: 2960,
      deliveryFee: 240,
    });
    expect(preview.siblingKeys).toEqual(["inst:inst-month:2"]);
    expect(preview.deliveryFee).toBe(160);
    expect(preview.newTotal).toBe(2180);
  });

  it("replaces one copy with individual products and drops only that box's shipping", () => {
    const preview = previewBoxCopyChange({
      copies: two,
      targetKey: "inst:inst-month:2",
      operation: "replace_products",
      replacementLines: [
        { product_id: "p4", product_name: "ستيك", quantity: 2, unit_price: 100 },
        { product_id: "p2", product_name: "كبدة", quantity: 1, unit_price: 80 },
      ],
      shippingByName: shipping,
      subtotal: 2960,
      deliveryFee: 240,
    });
    expect(preview.addedLines).toHaveLength(2);
    expect(preview.deliveryFee).toBe(120);
    expect(preview.newSubtotal).toBe(1760);
    expect(preview.newTotal).toBe(1880);
    expect(preview.siblingKeys).toEqual(["inst:inst-month:1"]);
  });

  it("deletes one copy without a replacement", () => {
    const preview = previewBoxCopyChange({
      copies: two,
      targetKey: "inst:inst-month:1",
      operation: "delete",
      shippingByName: shipping,
      subtotal: 2960,
      deliveryFee: 240,
    });
    expect(preview.addedLines).toHaveLength(0);
    expect(preview.deliveryFee).toBe(120);
    expect(preview.newTotal).toBe(1600);
    expect(preview.siblingKeys).toEqual(["inst:inst-month:2"]);
  });

  it("keeps loose products when the last box is deleted", () => {
    const copies = listBoxCopies({
      instances: [{ id: "inst-neck", offer_name: "عرض الرقاب", quantity: 1 }],
      items: [
        { id: "n", product_id: "neck", product_name: "رقاب", quantity: 1, unit_price: 540, offer_name: "عرض الرقاب" },
        { id: "a", product_id: "p4", product_name: "ستيك", quantity: 2, unit_price: 100 },
        { id: "b", product_id: "p2", product_name: "كبدة", quantity: 1, unit_price: 80 },
      ],
    });
    const preview = previewBoxCopyChange({
      copies,
      targetKey: "inst:inst-neck:1",
      operation: "delete",
      shippingByName: shipping,
      subtotal: 820,
      deliveryFee: 40,
    });
    expect(preview.siblingKeys).toEqual(["plain"]);
    expect(preview.deliveryFee).toBe(0);
    expect(preview.newTotal).toBe(280);
  });

  it("replaces the plain group with a box and leaves the other box", () => {
    const copies = listBoxCopies({
      instances: [{ id: "inst-neck", offer_name: "عرض الرقاب", quantity: 1, offer_box_id: "box-neck" }],
      items: [
        { id: "n", product_id: "neck", product_name: "رقاب", quantity: 1, unit_price: 540, offer_name: "عرض الرقاب" },
        { id: "a", product_id: "p4", product_name: "ستيك", quantity: 1, unit_price: 200 },
      ],
    });
    const preview = previewBoxCopyChange({
      copies,
      targetKey: "plain",
      operation: "replace_box",
      replacementOfferName: "عرض بدون شحن",
      replacementLines: [{ product_id: "kilo", product_name: "كيلو", quantity: 4, unit_price: 250 }],
      shippingByName: shipping,
      subtotal: 740,
      deliveryFee: 40,
    });
    expect(preview.siblingKeys).toEqual(["inst:inst-neck:1"]);
    expect(preview.deliveryFee).toBe(40);
    expect(preview.newTotal).toBe(1580);
  });

  it("keeps a hand-typed shipping difference", () => {
    const preview = previewBoxCopyChange({
      copies: two,
      targetKey: "inst:inst-month:2",
      operation: "delete",
      shippingByName: shipping,
      subtotal: 800,
      deliveryFee: 300,
    });
    expect(preview.previousIncludedShipping).toBe(240);
    expect(preview.nextIncludedShipping).toBe(120);
    expect(preview.deliveryFee).toBe(180);
  });

  it("does not invent shipping for an offer stored without it", () => {
    expect(shippingAfterCopyChange(0, 0, 0)).toBe(0);
    expect(includedShippingForCopies([{ offerName: "عرض بدون شحن" }, { offerName: null }], shipping)).toBe(0);
  });
});

describe("stockDelta", () => {
  it("changes only the selected copy's products", () => {
    expect(
      stockDelta(
        [
          { product_id: "p1", quantity: 1 },
          { product_id: "p2", quantity: 1 },
        ],
        [{ product_id: "p4", quantity: 1 }],
      ),
    ).toEqual([
      { product_id: "p1", quantity: -1 },
      { product_id: "p2", quantity: -1 },
      { product_id: "p4", quantity: 1 },
    ]);
  });
});
