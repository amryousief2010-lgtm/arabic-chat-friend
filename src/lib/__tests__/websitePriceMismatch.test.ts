import { describe, expect, it } from "vitest";
import {
  buildCatalogRows,
  bulkPreviewIssue,
  bulkPushCandidates,
  filterAndSortSiteRows,
  hasPriceMismatch,
  sellingPriceAfter,
  type CocBox,
  type CocProduct,
  type MapRow,
  type SiteProduct,
} from "@/lib/websiteProducts";

const P1 = "11111111-1111-1111-1111-111111111111";
const P2 = "22222222-2222-2222-2222-222222222222";
const B1 = "33333333-3333-3333-3333-333333333333";

const site = (id: number, name: string, price: number | null, extra: Partial<SiteProduct> = {}): SiteProduct => ({
  woo_product_id: id, woo_variation_id: 0, name, sku: null, price, regular_price: price, sale_price: null, permalink: null, removed_at: null, ...extra,
});
const products: CocProduct[] = [
  { id: P1, name: "لحم مفروم", price: 500, barcode: null, is_active: true, unit: "kg" },
  { id: P2, name: "كبدة", price: 400, barcode: null, is_active: true, unit: "kg" },
];
const boxes: CocBox[] = [{ id: B1, name: "عرض ١٠كيلو", offer_price: 2960, shipping_cost: 120, is_active: true }];

describe("hasPriceMismatch", () => {
  it("product price × pack weight; box price as-is (shipping not added)", () => {
    const maps: MapRow[] = [
      { woo_product_id: 1, woo_variation_id: 0, kind: "product", product_id: P1, offer_box_id: null, site_pack_qty: 0.5, site_pack_confirmed_at: "2026-11-01" },
      { woo_product_id: 2, woo_variation_id: 0, kind: "product", product_id: P2, offer_box_id: null, site_pack_qty: 1 },
      { woo_product_id: 3, woo_variation_id: 0, kind: "offer_box", product_id: null, offer_box_id: B1 },
    ];
    const rows = buildCatalogRows(
      [site(1, "لحم مفروم 500 جم", 250), site(2, "كبدة", 420), site(3, "عرض ١٠كيلو", 2960), site(4, "غير مربوط", 99)],
      maps, products, boxes,
    );
    expect(rows.map(hasPriceMismatch)).toEqual([false, true, false, false]);
    const boxMismatch = buildCatalogRows([site(3, "عرض ١٠كيلو", 3080)], maps, products, boxes)[0];
    expect(hasPriceMismatch(boxMismatch)).toBe(true);
    expect(boxMismatch.cocPackPrice).toBe(2960);
  });

  it("ignores removed rows and missing coceg price; flags a missing site price", () => {
    const maps: MapRow[] = [{ woo_product_id: 2, woo_variation_id: 0, kind: "product", product_id: P2, offer_box_id: null }];
    expect(hasPriceMismatch(buildCatalogRows([site(2, "كبدة", 420, { removed_at: "2026-11-01" })], maps, products, boxes)[0])).toBe(false);
    expect(hasPriceMismatch(buildCatalogRows([site(2, "كبدة", null)], maps, products, boxes)[0])).toBe(true);
    const noPrice = [{ ...products[1], price: null }];
    expect(hasPriceMismatch(buildCatalogRows([site(2, "كبدة", 420)], maps, noPrice, boxes)[0])).toBe(false);
  });

  it("the «diff» filter uses the same rule", () => {
    const maps: MapRow[] = [{ woo_product_id: 2, woo_variation_id: 0, kind: "product", product_id: P2, offer_box_id: null }];
    const rows = buildCatalogRows([site(2, "كبدة", 420), site(5, "كبدة قديمة", 420, { removed_at: "x" })], maps, products, boxes);
    expect(filterAndSortSiteRows(rows, { query: "", type: "all", status: "diff", sort: "name_asc" }).map((r) => r.site.woo_product_id)).toEqual([2]);
  });
});

describe("bulk push", () => {
  it("candidates carry expected price and skip unconfirmed pack weight", () => {
    const maps: MapRow[] = [
      { woo_product_id: 1, woo_variation_id: 0, kind: "product", product_id: P1, offer_box_id: null, site_pack_qty: 1 },
      { woo_product_id: 3, woo_variation_id: 0, kind: "offer_box", product_id: null, offer_box_id: B1 },
    ];
    const rows = buildCatalogRows([site(1, "لحم مفروم 500 جم", 300), site(3, "عرض ١٠كيلو", 3080)], maps, products, boxes);
    const c = bulkPushCandidates(rows);
    expect(c.map((x) => [x.target.kind, x.sitePrice, x.expectedPrice, x.skip])).toEqual([
      ["product", 300, 500, "pack_unconfirmed"],
      ["offer_box", 3080, 2960, null],
    ]);
  });

  it("only price-only previews are bulk-ready", () => {
    expect(bulkPreviewIssue({ keys_configured: false, changes: [{ field: "regular_price" }] })).toBe("keys_missing");
    expect(bulkPreviewIssue({ keys_configured: true, changes: [] })).toBe("no_changes");
    expect(bulkPreviewIssue({ keys_configured: true, changes: [{ field: "regular_price" }, { field: "shipping_class" }] })).toBe("extra_fields");
    expect(bulkPreviewIssue({ keys_configured: true, changes: [{ field: "regular_price" }, { field: "sale_price" }] })).toBeNull();
  });

  it("selling price after update", () => {
    expect(sellingPriceAfter({ regular_price: "520", sale_price: "" }, { regular_price: "580", sale_price: "540" })).toBe(520);
    expect(sellingPriceAfter({ sale_price: "470" }, { regular_price: "520", sale_price: "" })).toBe(470);
    expect(sellingPriceAfter({ regular_price: "2960" }, { regular_price: "3080", sale_price: "" })).toBe(2960);
  });
});
