import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  SHIP_BOX_LABEL, SHIP_RULE_TEXT, SHIP_SITE_LABEL, SHIP_SITE_NOTE, mapItems, shippingSummary,
  type InboxItem, type ProductMapRow,
} from "@/lib/websiteOrders";

// طلب موقع بمثال م. عمرو: بوكس 4 كيلو + 4 منتجات منفردة، شحن الموقع 120، إجمالي الموقع 1940.
const items: InboxItem[] = [
  { woo_product_id: 16133, woo_variation_id: 0, name: "بوكس 4 كيلو", quantity: 1, unit_price: 1000, line_total: 1000 },
  { woo_product_id: 933, woo_variation_id: 0, name: "قوانص نعام", quantity: 1, unit_price: 240, line_total: 240 },
  { woo_product_id: 1535, woo_variation_id: 0, name: "دهن نعام", quantity: 4, unit_price: 70, line_total: 280 },
  { woo_product_id: 16173, woo_variation_id: 0, name: "لانشون نعام – 500 جرام", quantity: 1, unit_price: 175, line_total: 175 },
  { woo_product_id: 16180, woo_variation_id: 0, name: "لحم نعام مدخن – 250 جرام", quantity: 1, unit_price: 125, line_total: 125 },
];
const maps: ProductMapRow[] = [
  { woo_product_id: 16133, woo_variation_id: 0, kind: "offer_box", product_id: null, offer_box_id: "box-4" },
  { woo_product_id: 933, woo_variation_id: 0, kind: "product", product_id: "p-qawani", offer_box_id: null },
  { woo_product_id: 1535, woo_variation_id: 0, kind: "product", product_id: "p-dahn", offer_box_id: null },
  { woo_product_id: 16173, woo_variation_id: 0, kind: "product", product_id: "p-lanchon", offer_box_id: null, site_pack_qty: 0.5, site_pack_confirmed_at: "2026-11-26T10:00:00Z" },
  { woo_product_id: 16180, woo_variation_id: 0, kind: "product", product_id: "p-smoked", offer_box_id: null, site_pack_qty: 0.25, site_pack_confirmed_at: "2026-11-26T10:00:00Z" },
];
const products = ["p-qawani", "p-dahn", "p-lanchon", "p-smoked"].map((id) => ({ id, name: id, unit: "كجم" }));
const mapped = mapItems(items, maps, products);

describe("order card shipping: offer-box shipping only", () => {
  it("single products never add shipping; only registered offer shipping counts", () => {
    const s = shippingSummary(mapped, [{ id: "box-4", name: "عرض 4 كيلو", shipping_cost: 120 }], 120);
    expect(s.boxTotal).toBe(120);
    expect(s.boxLines).toEqual([{ offerBoxId: "box-4", name: "عرض 4 كيلو", quantity: 1, perBox: 120, total: 120 }]);
    expect(s.siteShipping).toBe(120);
    expect(s.siteShippingIgnored).toBe(true);
  });

  it("the site shipping (120) is not part of the box shipping even when the offer has none registered", () => {
    const s = shippingSummary(mapped, [{ id: "box-4", name: "عرض 4 كيلو", shipping_cost: null }], 120);
    expect(s.boxTotal).toBe(0);
    expect(s.boxesWithoutShipping).toEqual(["عرض 4 كيلو"]);
    expect(s.siteShippingIgnored).toBe(true);
  });

  it("multiplies the offer shipping by the number of boxes and sums several offers", () => {
    const two: InboxItem[] = [
      { woo_product_id: 16133, woo_variation_id: 0, name: "بوكس 4 كيلو", quantity: 2, unit_price: 1000 },
      { woo_product_id: 16134, woo_variation_id: 0, name: "بوكس 5 كيلو", quantity: 1, unit_price: 1250 },
    ];
    const m: ProductMapRow[] = [
      { woo_product_id: 16133, woo_variation_id: 0, kind: "offer_box", product_id: null, offer_box_id: "box-4" },
      { woo_product_id: 16134, woo_variation_id: 0, kind: "offer_box", product_id: null, offer_box_id: "box-5" },
    ];
    const s = shippingSummary(mapItems(two, m), [
      { id: "box-4", name: "عرض 4 كيلو", shipping_cost: 120 }, { id: "box-5", name: "عرض 5 كيلو", shipping_cost: 60.5 },
    ], 0);
    expect(s.boxTotal).toBe(300.5);
    expect(s.siteShippingIgnored).toBe(false);
  });

  it("an order of single products only has no shipping at all", () => {
    const only = mapped.filter((i) => i.map?.kind === "product");
    const s = shippingSummary(only, [], 120);
    expect(s.boxLines).toEqual([]);
    expect(s.boxTotal).toBe(0);
    expect(s.siteShippingIgnored).toBe(true);
  });

  it("wording: standard Arabic, site shipping is information only", () => {
    expect(SHIP_BOX_LABEL).toBe("شحن البوكسات (من بيانات العرض)");
    expect(SHIP_SITE_LABEL).toBe("شحن الموقع");
    expect(SHIP_SITE_NOTE).toContain("لا يُضاف إلى الطلب");
    expect(SHIP_RULE_TEXT).toContain("لا يُنقل شحن المنتجات المنفردة");
    expect(SHIP_RULE_TEXT).toContain("يدويًا");
  });

  it("pack factor still applies to the same card (0.5 and 0.25 kg packs stay confirmed)", () => {
    const lanchon = mapped.find((i) => i.woo_product_id === 16173)!;
    expect(lanchon.pack?.qty).toBe(0.5);
    expect(lanchon.pack?.needsConfirm).toBe(false);
  });
});

describe("migration 20261126110000: delivery_fee never uses the site shipping", () => {
  const sql = readFileSync(resolve(__dirname, "../../../supabase/migrations/20261126110000_website_assign_offer_shipping_only.sql"), "utf8");
  const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

  it("delivery_fee comes only from the offer-box accumulator", () => {
    expect(code).toMatch(/v_fee := v_fee \+ coalesce\(v_box\.shipping_cost, 0\) \* v_qty;/);
    expect(code).toMatch(/UPDATE public\.orders SET delivery_fee = v_fee WHERE id = v_order_id;/);
    expect(code).not.toMatch(/delivery_fee\s*=\s*[^;]*shipping_total/);
    expect(code).not.toMatch(/v_fee\s*:=\s*[^;]*shipping_total/);
  });

  it("notes call the site shipping information only; audit records that it was not added", () => {
    expect(code).toContain("شحن الموقع (للعلم فقط، لا يُضاف إلى الطلب): ");
    expect(code).toContain("'site_shipping_added', false");
    expect(code).toContain("'site_packs', v_packs");
  });

  it("keeps the pack factor and does not touch the address/fulfilment wrapper or the offer prices", () => {
    expect(code).toContain("v_pack := coalesce(nullif(v_map.site_pack_qty, 0), 1);");
    expect(code).not.toMatch(/website_inbox_assign_v2/);
    expect(code).not.toMatch(/UPDATE public\.offer_boxes/);
    expect(code).not.toMatch(/ALTER TABLE/);
  });
});
