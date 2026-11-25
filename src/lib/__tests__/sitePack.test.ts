import { describe, expect, it, vi } from "vitest";
import {
  cocPriceFromSite, cocQtyFromSite, packPriceExplanation, packQtyLine, packStateFor, parseWeightKg, sitePackPrice, suggestPackQty, validPackQty,
} from "@/lib/sitePack";
import { buildCatalogRows } from "@/lib/websiteProducts";
import { assignBlocker, mapItems } from "@/lib/websiteOrders";
import { desiredFields, handleCatalogSync, packQtyOf, type CatalogDeps } from "../../../supabase/functions/woo-catalog-sync/handler";

const PID = "10000000-0000-0000-0000-000000000009";

describe("parseWeightKg", () => {
  it("reads grams, kilos and Arabic words", () => {
    expect(parseWeightKg("لانشون نعام – 500 جرام")).toBe(0.5);
    expect(parseWeightKg("لحم نعام مدخن – 250 جرام")).toBe(0.25);
    expect(parseWeightKg("هوت دوج ٥٠٠ جم")).toBe(0.5);
    expect(parseWeightKg("برجر نصف كيلو")).toBe(0.5);
    expect(parseWeightKg("كبدة ربع كيلو")).toBe(0.25);
    expect(parseWeightKg("لحم غزال بالعظم – 1 كيلو")).toBe(1);
    expect(parseWeightKg("رول 1.5 كجم")).toBe(1.5);
    expect(parseWeightKg("ostrich 500g")).toBe(0.5);
    expect(parseWeightKg("استيك نعام")).toBeNull();
    expect(parseWeightKg("")).toBeNull();
  });
});

describe("suggestPackQty", () => {
  it("suggests from the site name for kg products only", () => {
    expect(suggestPackQty("لانشون نعام – 500 جرام", { name: "لانشون", unit: "كجم" })).toMatchObject({ qty: 0.5, label: "500 جم" });
    expect(suggestPackQty("استيك نعام", { name: "استيك", unit: "كجم" })).toBeNull();
    expect(suggestPackQty("لانشون 500 جرام", { name: "لانشون", unit: "قطعة" })).toBeNull();
    // COCEG already sells the half-kg pack → 1
    expect(suggestPackQty("لانشون 500 جرام", { name: "لانشون نص كيلو", unit: "كجم" })?.qty).toBe(1);
  });
  it("pack state needs confirmation only when the suggestion differs and nothing is confirmed", () => {
    const map = { kind: "product", site_pack_qty: 1, site_pack_confirmed_at: null };
    expect(packStateFor(map, "لانشون – 500 جرام", { name: "لانشون", unit: "كجم" }).needsConfirm).toBe(true);
    expect(packStateFor({ ...map, site_pack_qty: 0.5 }, "لانشون – 500 جرام", { name: "لانشون", unit: "كجم" }).needsConfirm).toBe(false);
    expect(packStateFor({ ...map, site_pack_confirmed_at: "2026-11-26T00:00:00Z" }, "لانشون – 500 جرام", { name: "لانشون", unit: "كجم" }).needsConfirm).toBe(false);
    expect(packStateFor({ kind: "offer_box", site_pack_qty: 1 }, "بوكس 4 كيلو", null).suggestion).toBeNull();
  });
});

describe("pack maths and wording", () => {
  it("price and quantity", () => {
    expect(sitePackPrice(350, 0.5)).toBe(175);
    expect(cocPriceFromSite(175, 0.5)).toBe(350);
    expect(cocQtyFromSite(2, 0.5)).toBe(1);
    expect(validPackQty("0")).toBeNull();
    expect(validPackQty("101")).toBeNull();
    expect(validPackQty("0.5")).toBe(0.5);
  });
  it("Arabic text with Latin numerals", () => {
    expect(packPriceExplanation(350, 0.5, "كجم", "500 جم")).toBe("سعر الكيلو في \u2066COCEG\u2069 350 ج.م × 0.5 كجم = 175 ج.م للعبوة (500 جم)");
    expect(packQtyLine(2, 0.5, "كجم")).toBe("2 عبوة × 0.5 كجم = 1 كجم");
  });
});

describe("screen rows use the pack price", () => {
  it("لانشون 175 on site vs 350/kg × 0.5 → no difference", () => {
    const site = [{ woo_product_id: 16173, woo_variation_id: 0, name: "لانشون نعام – 500 جرام", sku: null, price: 175, regular_price: 175, sale_price: null, permalink: null, removed_at: null }];
    const product = { id: PID, name: "لانشون", price: 350, barcode: null, is_active: true, unit: "كجم" };
    const unconfirmed = buildCatalogRows(site, [{ woo_product_id: 16173, woo_variation_id: 0, kind: "product", product_id: PID, offer_box_id: null }], [product], []);
    expect(unconfirmed[0]).toMatchObject({ cocPackPrice: 350, priceDiff: -175 });
    expect(unconfirmed[0].pack?.needsConfirm).toBe(true);
    const confirmed = buildCatalogRows(site, [{ woo_product_id: 16173, woo_variation_id: 0, kind: "product", product_id: PID, offer_box_id: null, site_pack_qty: 0.5, site_pack_confirmed_at: "2026-11-26T00:00:00Z" }], [product], []);
    expect(confirmed[0]).toMatchObject({ cocPrice: 350, cocPackPrice: 175, priceDiff: 0 });
  });
});

describe("website order card", () => {
  it("shows the pack and blocks assignment until an unconfirmed suggestion is confirmed", () => {
    const items = [{ woo_product_id: 16173, name: "لانشون نعام – 500 جرام", quantity: 2, unit_price: 175 }];
    const products = [{ id: PID, name: "لانشون", unit: "كجم" }];
    const base = { woo_product_id: 16173, woo_variation_id: 0, kind: "product" as const, product_id: PID, offer_box_id: null };
    const unconfirmed = mapItems(items, [base], products);
    expect(assignBlocker({ kind: "order", status: "new", items: unconfirmed, moderatorId: "m", possibleDuplicate: false, customerChoice: null })).toContain("وزن عبوته");
    const ok = mapItems(items, [{ ...base, site_pack_qty: 0.5, site_pack_confirmed_at: "2026-11-26T00:00:00Z" }], products);
    expect(ok[0].pack?.qty).toBe(0.5);
    expect(packQtyLine(ok[0].quantity, ok[0].pack!.qty, ok[0].unit)).toBe("2 عبوة × 0.5 كجم = 1 كجم");
    expect(assignBlocker({ kind: "order", status: "new", items: ok, moderatorId: "m", possibleDuplicate: false, customerChoice: null })).toBeNull();
  });
});

describe("woo-catalog-sync pack factor", () => {
  it("desiredFields multiplies product prices only", () => {
    const t = { kind: "product" as const, id: PID };
    const src = { id: PID, name: "لانشون", price: 350, barcode: null };
    expect(desiredFields("update", t, src, { regular_price: "175", sale_price: "" }, {}, false, 0.5)).toMatchObject({ regular_price: "175" });
    expect(desiredFields("update", t, src, { regular_price: "175", sale_price: "" }, {}, false, 1)).toMatchObject({ regular_price: "350" });
    // keep_sale: the pack price becomes the sale price under the current regular
    expect(desiredFields("update", t, src, { regular_price: "200", sale_price: "180" }, {}, true, 0.5)).toEqual({ sale_price: "175" });
    const box = { id: "b", name: "بوكس", offer_price: 1000, shipping_cost: 0, items: [{ name: "x", quantity: 1, is_gift: false }] };
    expect(desiredFields("update", { kind: "offer_box", id: "b" }, box, { regular_price: "1000" }, {}, false, 0.5).regular_price).toBe("1000");
    expect(packQtyOf({ kind: "offer_box", site_pack_qty: 0.5 })).toBe(1);
  });

  it("preview for لانشون: no change when the site already sells the 500 g pack at 175", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: 16173, name: "لانشون", regular_price: "175", sale_price: "", sku: "", status: "publish", catalog_visibility: "visible", images: [] }))) as unknown as typeof fetch;
    const deps: CatalogDeps = {
      env: { WOO_CONSUMER_KEY: "ck", WOO_CONSUMER_SECRET: "cs" },
      fetchImpl,
      authenticate: async () => ({ userId: "u1", token: "jwt" }),
      canManage: async () => true,
      saveSiteProducts: async () => ({}),
      loadProduct: async () => ({ id: PID, name: "لانشون", price: 350, barcode: null, unit: "كجم" }),
      loadBox: async () => null,
      mappingForTarget: async () => ({ woo_product_id: 16173, woo_variation_id: 0, kind: "product", product_id: PID, offer_box_id: null, site_pack_qty: 0.5, site_pack_label: "500 جم", site_pack_confirmed_at: "2026-11-26T00:00:00Z" }),
      cachedSiteProduct: async () => null,
      mapAsUser: async () => {},
      log: async () => {},
    };
    const req = new Request("https://x/functions/v1/woo-catalog-sync", { method: "POST", headers: { Authorization: "Bearer jwt" }, body: JSON.stringify({ action: "preview", mode: "update", target: { kind: "product", id: PID }, woo_product_id: 16173 }) });
    const pv = await (await handleCatalogSync(req, deps)).json();
    expect(pv.after.regular_price).toBe("175");
    expect(pv.changes).toEqual([]);
    expect(pv.pack).toMatchObject({ qty: 0.5, label: "500 جم", coc_price: 350, site_pack_price: 175, unit: "كجم" });
    expect(pv.warnings).toContain("site_pack_applied");
  });
});
