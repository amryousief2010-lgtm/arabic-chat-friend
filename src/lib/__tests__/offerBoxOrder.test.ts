import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ABDELMONEM_USER_ID,
  MARIAM_USER_ID,
  OFFER_INSTANCE_WRITER_ROLES,
  buildOfferInstanceRows,
  canRecordOfferInstances,
  customerPayable,
  deliveryFeeForItemEdit,
  includedShippingFromBoxes,
  instancesAfterAddingBox,
  instancesAfterRemovingOne,
  instancesAfterSwap,
  quoteOfferOrder,
  type OfferOrderLine,
} from "@/lib/offerBoxOrder";

const BOX_1500 = "بوكس 1500";
const OFFER_1000 = "عرض 1000";

/** Live بوكس 1500 product lines. Shipping 120 is not inside these prices. */
const box1500Lines = (copies: number): OfferOrderLine[] => [
  { product_name: "برجر", offer_name: BOX_1500, quantity: 1 * copies, unit_price: 250 },
  { product_name: "حواوشي", offer_name: BOX_1500, quantity: 1 * copies, unit_price: 180 },
  { product_name: "سجق", offer_name: BOX_1500, quantity: 1 * copies, unit_price: 250 },
  { product_name: "كفتة", offer_name: BOX_1500, quantity: 1 * copies, unit_price: 250 },
  { product_name: "كفتة الرز", offer_name: BOX_1500, quantity: 1 * copies, unit_price: 200 },
  { product_name: "مفروم", offer_name: BOX_1500, quantity: 1 * copies, unit_price: 250 },
  { product_name: "نخاع", offer_name: BOX_1500, quantity: 0.5 * copies, unit_price: 0, is_gift: true },
];

/** عرض with no shipping_cost. Four kilos at 250 = 1000. */
const offer1000Lines = (copies: number): OfferOrderLine[] => [
  { product_name: "كيلو", offer_name: OFFER_1000, quantity: 4 * copies, unit_price: 250 },
];

const box1500 = (quantity: number) => ({ name: BOX_1500, quantity, shipping_cost: 120 });
const offer1000 = (quantity: number) => ({ name: OFFER_1000, quantity, shipping_cost: null });

describe("quoteOfferOrder", () => {
  it("1 box: subtotal 1380, fee 120, total 1500", () => {
    const quote = quoteOfferOrder({ lines: box1500Lines(1), boxes: [box1500(1)] });
    expect(quote).toMatchObject({ subtotal: 1380, includedShipping: 120, delivery_fee: 120, total: 1500 });
    expect(customerPayable(quote)).toBe(1500);
    expect(customerPayable(quote)).not.toBe(quote.total + quote.delivery_fee);
  });

  it("2 same boxes: subtotal 2760, fee 240, total 3000", () => {
    const quote = quoteOfferOrder({ lines: box1500Lines(2), boxes: [box1500(2)] });
    expect(quote).toMatchObject({ subtotal: 2760, includedShipping: 240, delivery_fee: 240, total: 3000 });
  });

  it("3 boxes: subtotal 4140, fee 360, total 4500", () => {
    const quote = quoteOfferOrder({ lines: box1500Lines(3), boxes: [box1500(3)] });
    expect(quote).toMatchObject({ subtotal: 4140, includedShipping: 360, delivery_fee: 360, total: 4500 });
  });

  it("2 different boxes keep their own prices: 1500 + 1000 = 2500, fee 120", () => {
    const quote = quoteOfferOrder({
      lines: [...box1500Lines(1), ...offer1000Lines(1)],
      boxes: [box1500(1), offer1000(1)],
    });
    expect(quote).toMatchObject({ subtotal: 2380, includedShipping: 120, delivery_fee: 120, total: 2500 });
    expect(quote.subtotal).toBe(1380 + 1000);
  });

  it("2 offers with no shipping: 1000×2 = 2000 and fee 0", () => {
    const quote = quoteOfferOrder({ lines: offer1000Lines(2), boxes: [offer1000(2)] });
    expect(quote).toMatchObject({ subtotal: 2000, includedShipping: 0, delivery_fee: 0, total: 2000 });
    expect(includedShippingFromBoxes([{ name: OFFER_1000, quantity: 2, shipping_cost: 0 }])).toBe(0);
  });

  it("2 boxes plus a non-offer product at 880: subtotal 3640, fee 240, total 3880", () => {
    const quote = quoteOfferOrder({
      lines: [
        ...box1500Lines(2),
        { product_name: "إضافي", offer_name: null, quantity: 1, unit_price: 880 },
      ],
      boxes: [box1500(2)],
    });
    expect(quote).toMatchObject({ subtotal: 3640, includedShipping: 240, delivery_fee: 240, total: 3880 });
  });

  it("manual shipping replaces the included fee instead of stacking on it", () => {
    const quote = quoteOfferOrder({
      lines: box1500Lines(1),
      boxes: [box1500(1)],
      manualShipping: 50,
    });
    expect(quote).toMatchObject({ subtotal: 1380, includedShipping: 120, delivery_fee: 50, total: 1430 });
    expect(quote.total).not.toBe(1380 + 120 + 50);
  });
});

describe("add, remove, and swap a box on an existing order", () => {
  const one = [{ offer_name: BOX_1500, quantity: 1, offer_box_id: "box-1500" }];

  it("adding a second بوكس 1500 goes from 1500 / 120 to 3000 / 240", () => {
    const next = instancesAfterAddingBox(one, { offer_name: BOX_1500, offer_box_id: "box-1500" });
    expect(next).toEqual([{ offer_name: BOX_1500, quantity: 2, offer_box_id: "box-1500" }]);
    const quote = quoteOfferOrder({
      lines: box1500Lines(2),
      boxes: [{ name: BOX_1500, quantity: next[0].quantity, shipping_cost: 120 }],
    });
    expect(quote).toMatchObject({ subtotal: 2760, delivery_fee: 240, total: 3000 });
  });

  it("a failed first save that left product lines but no instance row records the second box as quantity 2", () => {
    const next = instancesAfterAddingBox([], { offer_name: BOX_1500, offer_box_id: "box-1500" }, {
      priorProductLines: true,
    });
    expect(next).toEqual([{ offer_name: BOX_1500, quantity: 2, offer_box_id: "box-1500" }]);
  });

  it("removing one of two boxes returns to 1500 / 120", () => {
    const next = instancesAfterRemovingOne(
      [{ offer_name: BOX_1500, quantity: 2, offer_box_id: "box-1500" }],
      BOX_1500,
    );
    expect(next).toEqual([{ offer_name: BOX_1500, quantity: 1, offer_box_id: "box-1500" }]);
    const quote = quoteOfferOrder({
      lines: box1500Lines(1),
      boxes: [{ name: BOX_1500, quantity: 1, shipping_cost: 120 }],
    });
    expect(quote).toMatchObject({ subtotal: 1380, delivery_fee: 120, total: 1500 });
  });

  it("swapping بوكس 1500 for عرض 1000 drops the old shipping: total 1000, fee 0", () => {
    const next = instancesAfterSwap(one, BOX_1500, { offer_name: OFFER_1000, offer_box_id: "box-1000" });
    expect(next).toEqual([{ offer_name: OFFER_1000, quantity: 1, offer_box_id: "box-1000" }]);
    const quote = quoteOfferOrder({
      lines: offer1000Lines(1),
      boxes: [{ name: OFFER_1000, quantity: 1, shipping_cost: null }],
    });
    expect(quote).toMatchObject({ subtotal: 1000, delivery_fee: 0, total: 1000 });
  });

  it("keeps the other box when a swap lands on a name already on the order", () => {
    const next = instancesAfterSwap(
      [
        { offer_name: BOX_1500, quantity: 1, offer_box_id: "box-1500" },
        { offer_name: OFFER_1000, quantity: 1, offer_box_id: "box-1000" },
      ],
      BOX_1500,
      { offer_name: OFFER_1000, offer_box_id: "box-1000" },
    );
    expect(next).toEqual([{ offer_name: OFFER_1000, quantity: 2, offer_box_id: "box-1000" }]);
    const quote = quoteOfferOrder({ lines: offer1000Lines(2), boxes: [offer1000(2)] });
    expect(quote.total).toBe(2000);
    expect(quote.delivery_fee).toBe(0);
  });

  it("deleting a box recomputes included shipping, and a price or بدون عرض edit does not", () => {
    expect(
      deliveryFeeForItemEdit({
        shippingTouched: false,
        typedFee: 75,
        previousFee: 75,
        previousOfferNames: ["بوكس العيلة"],
        nextOfferNames: ["بوكس العيلة"],
        remainingBoxes: [{ name: "بوكس العيلة", quantity: 1, shipping_cost: 120 }],
      }),
    ).toBe(75);

    expect(
      deliveryFeeForItemEdit({
        shippingTouched: false,
        typedFee: 240,
        previousFee: 240,
        previousOfferNames: [BOX_1500],
        nextOfferNames: [],
        remainingBoxes: [],
      }),
    ).toBe(0);

    expect(
      deliveryFeeForItemEdit({
        shippingTouched: true,
        typedFee: 50,
        previousFee: 120,
        previousOfferNames: [BOX_1500],
        nextOfferNames: [BOX_1500],
        remainingBoxes: [box1500(1)],
      }),
    ).toBe(50);
  });
});

describe("offer instance rows", () => {
  it("groups the same offer name so the unique (order, name) row can store quantity 2", () => {
    expect(
      buildOfferInstanceRows([
        { offerBoxId: "a", offerName: BOX_1500, quantity: 2 },
        { offerBoxId: "b", offerName: OFFER_1000, quantity: 1 },
        { offerBoxId: "a-dup", offerName: `  ${BOX_1500}  `, quantity: 1 },
      ]),
    ).toEqual([
      { offer_box_id: "a", offer_name: BOX_1500, quantity: 3 },
      { offer_box_id: "b", offer_name: OFFER_1000, quantity: 1 },
    ]);
  });
});

describe("who can create an offer order", () => {
  it("lets moderator مريم record boxes and refuses warehouse supervisor عبدالمنعم", () => {
    expect(canRecordOfferInstances({ userId: MARIAM_USER_ID, role: "sales_moderator" })).toBe(true);
    expect(canRecordOfferInstances({ userId: ABDELMONEM_USER_ID, role: "warehouse_supervisor" })).toBe(false);
    expect(canRecordOfferInstances({ userId: null, role: "sales_moderator" })).toBe(false);
    expect(canRecordOfferInstances({ userId: MARIAM_USER_ID, role: null })).toBe(false);
  });

  it("keeps that role gate in set_order_offer_instances and does not grant it to anon", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/20261005180000_set_order_offer_instances.sql"),
      "utf8",
    );
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.set_order_offer_instances/);
    for (const role of OFFER_INSTANCE_WRITER_ROLES) {
      expect(sql).toContain(role);
    }
    expect(sql).not.toContain("warehouse_supervisor");
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.set_order_offer_instances\(uuid, jsonb\) TO authenticated/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.set_order_offer_instances\(uuid, jsonb\) FROM anon/);
  });

  it("still lets a sales moderator insert an order and does not let a warehouse supervisor", () => {
    const migrationsDir = join(process.cwd(), "supabase", "migrations");
    const policy = readdirSync(migrationsDir)
      .filter((file) => file.endsWith(".sql"))
      .sort()
      .reverse()
      .map((file) => readFileSync(join(migrationsDir, file), "utf8"))
      .find((sql) => /auth\.uid\(\)\s*=\s*created_by AND has_any_role/i.test(sql));
    expect(policy).toBeTruthy();
    const clause = policy!.match(/auth\.uid\(\)\s*=\s*created_by AND has_any_role\([\s\S]*?\)\s*\)/)?.[0] ?? "";
    expect(clause).toContain("sales_moderator");
    expect(clause).not.toContain("warehouse_supervisor");
  });
});
