import { describe, expect, it } from "vitest";
import { buildCatalogRows, bulkPushCandidates, type CocBox, type CocProduct, type MapRow, type SiteProduct } from "@/lib/websiteProducts";
import {
  buildOfferOverview,
  filterAndSortOffers,
  offerAddDisabledReason,
  offerStatus,
  rowsForSection,
  sectionCounts,
  sectionOfRow,
} from "@/lib/websiteOffers";

const NOW = new Date("2026-11-28T00:00:00Z");
const P1 = "p1";
const B1 = "b1"; // مربوط، سعر مطابق
const B2 = "b2"; // مربوط، سعر مختلف
const B3 = "b3"; // غير مربوط، نشط
const B4 = "b4"; // غير مربوط، موقوف
const B5 = "b5"; // منتهي الصلاحية، مربوط لكن غير ظاهر

const site = (id: number, name: string, price: number | null, extra: Partial<SiteProduct> = {}): SiteProduct => ({
  woo_product_id: id, woo_variation_id: 0, name, sku: null, price, regular_price: price, sale_price: null, permalink: `https://example.test/p/${id}`, removed_at: null, ...extra,
});
const products: CocProduct[] = [{ id: P1, name: "لحم مفروم", price: 500, barcode: null, is_active: true, unit: "kg" }];
const item = (name: string, quantity: number) => ({ name, quantity, is_gift: false, unit: "kg" });
const boxes: CocBox[] = [
  { id: B1, name: "عرض ١٠كيلو", offer_price: 2960, shipping_cost: 120, is_active: true, items: [item("كفتة", 2)] },
  { id: B2, name: "بوكس 1010", offer_price: 1010, shipping_cost: 120, is_active: true, items: [item("برجر", 1)] },
  { id: B3, name: "بوكس التوفير", offer_price: 1080, shipping_cost: 0, is_active: true, items: [item("سجق", 1)] },
  { id: B4, name: "عرض الرقاب", offer_price: 900, shipping_cost: 120, is_active: false, items: [item("رقبة", 3)] },
  { id: B5, name: "بوكس قديم", offer_price: 700, shipping_cost: 0, is_active: true, expires_at: "2026-11-01T00:00:00Z", items: [] },
];
const maps: MapRow[] = [
  { woo_product_id: 1, woo_variation_id: 0, kind: "product", product_id: P1, offer_box_id: null, site_pack_qty: 1 },
  { woo_product_id: 10, woo_variation_id: 0, kind: "offer_box", product_id: null, offer_box_id: B1 },
  { woo_product_id: 11, woo_variation_id: 0, kind: "offer_box", product_id: null, offer_box_id: B2 },
  { woo_product_id: 12, woo_variation_id: 0, kind: "offer_box", product_id: null, offer_box_id: B5 },
];
const siteRows = [
  site(1, "لحم مفروم", 500),
  site(2, "كبدة", 400), // منتج غير مربوط
  site(10, "عرض ١٠كيلو", 2960),
  site(11, "بوكس 1010", 1100),
  site(12, "بوكس قديم", 700, { removed_at: "2026-11-02T00:00:00Z" }),
  site(13, "عرض جديد على الموقع", 500), // عرض بالاسم غير مربوط
];
const rows = buildCatalogRows(siteRows, maps, products, boxes);

describe("sectionOfRow / rowsForSection", () => {
  it("splits site rows into products vs offers (mapped kind or offer-like name)", () => {
    expect(rows.map(sectionOfRow)).toEqual(["products", "products", "offers", "offers", "offers", "offers"]);
    expect(rowsForSection(rows, "products").map((r) => r.site.woo_product_id)).toEqual([1, 2]);
    expect(rowsForSection(rows, "offers").map((r) => r.site.woo_product_id)).toEqual([10, 11, 12, 13]);
  });
});

describe("offerStatus", () => {
  it("inactive wins, then validity window", () => {
    expect(offerStatus({ is_active: false, expires_at: "2027-01-01" }, NOW)).toBe("inactive");
    expect(offerStatus({ is_active: true }, NOW)).toBe("active");
    expect(offerStatus({ is_active: true, expires_at: "2026-11-01T00:00:00Z" }, NOW)).toBe("expired");
    expect(offerStatus({ is_active: true, starts_at: "2026-12-10T00:00:00Z", expires_at: "2026-12-20T00:00:00Z" }, NOW)).toBe("scheduled");
  });
});

describe("buildOfferOverview", () => {
  const ov = buildOfferOverview(boxes, maps, rows, NOW);
  const by = (id: string) => ov.find((o) => o.box.id === id)!;

  it("includes every COCEG box, published or not", () => {
    expect(ov.map((o) => o.box.id)).toEqual([B1, B2, B3, B4, B5]);
  });

  it("linked status, woo id, site price, permalink, mismatch", () => {
    expect(by(B1)).toMatchObject({ linked: true, wooProductId: 10, sitePrice: 2960, priceMismatch: false, hiddenOnSite: false, permalink: "https://example.test/p/10" });
    expect(by(B2)).toMatchObject({ linked: true, wooProductId: 11, sitePrice: 1100, priceMismatch: true });
    expect(by(B3)).toMatchObject({ linked: false, wooProductId: null, sitePrice: null, priceMismatch: false });
    expect(by(B5)).toMatchObject({ linked: true, hiddenOnSite: true, status: "expired", priceMismatch: false });
    expect(by(B4).status).toBe("inactive");
  });

  it("linked map without a cached site row still counts as linked (woo id from map)", () => {
    const o = buildOfferOverview([boxes[2]], [{ woo_product_id: 99, woo_variation_id: 0, kind: "offer_box", product_id: null, offer_box_id: B3 }], [], NOW)[0];
    expect(o).toMatchObject({ linked: true, wooProductId: 99, hiddenOnSite: true, primary: null });
  });

  it("add-to-site only for unlinked boxes that are active and not expired", () => {
    expect(offerAddDisabledReason(by(B3))).toBeNull();
    expect(offerAddDisabledReason(by(B4))).toMatch(/موقوف/);
    expect(offerAddDisabledReason(by(B1))).toBeNull();
    expect(offerAddDisabledReason({ ...by(B3), status: "expired" })).toMatch(/صلاحية/);
  });

  it("filters and sorts", () => {
    const ids = (f: Parameters<typeof filterAndSortOffers>[1]) => filterAndSortOffers(ov, f).map((o) => o.box.id);
    expect(ids({ query: "", filter: "linked", sort: "name_asc" }).sort()).toEqual([B1, B2, B5].sort());
    expect(ids({ query: "", filter: "unlinked", sort: "price_desc" })).toEqual([B3, B4]);
    expect(ids({ query: "", filter: "diff", sort: "name_asc" })).toEqual([B2]);
    expect(ids({ query: "", filter: "expired", sort: "name_asc" })).toEqual([B5]);
    expect(ids({ query: "", filter: "inactive", sort: "name_asc" })).toEqual([B4]);
    expect(ids({ query: "سجق", filter: "all", sort: "name_asc" })).toEqual([B3]);
    expect(ids({ query: "11", filter: "all", sort: "name_asc" })).toEqual([B2]);
  });
});

describe("sectionCounts", () => {
  it("counts per tile, and diffs still cover products and boxes together", () => {
    const ov = buildOfferOverview(boxes, maps, rows, NOW);
    const c = sectionCounts(rows, ov, []);
    expect(c.products).toEqual({ onSite: 2, linked: 1, notOnSite: 0, diffs: 0 });
    expect(c.offers).toEqual({ total: 5, linked: 3, unlinked: 2, diffs: 1 });
    const drift = buildCatalogRows([site(1, "لحم مفروم", 450), ...siteRows.slice(1)], maps, products, boxes);
    const c2 = sectionCounts(drift, buildOfferOverview(boxes, maps, drift, NOW), []);
    expect(c2.products.diffs + c2.offers.diffs).toBe(bulkPushCandidates(drift).length);
    expect(bulkPushCandidates(drift).map((b) => b.target.kind).sort()).toEqual(["offer_box", "product"]);
  });
});
