import { describe, expect, it } from "vitest";
import {
  type CatalogRow,
  type SiteProduct,
  boxPriceFromItems,
  changeValueLabel,
  duplicateSiteSkus,
  filterAndSortSiteRows,
  imageFileProblem,
  imageStoragePath,
  skuState,
  skuWouldDuplicate,
  syncErrorMessage,
} from "@/lib/websiteProducts";
import { deliveryAddressLine, governorateFromWoo, splitWooAddress } from "@/lib/wooAddress";

const site = (id: number, sku: string | null, extra: Partial<SiteProduct> = {}): SiteProduct => ({
  woo_product_id: id, woo_variation_id: 0, name: `منتج ${id}`, sku, price: 100, regular_price: 100, sale_price: null,
  permalink: null, image_url: null, removed_at: null, ...extra,
});
const row = (s: SiteProduct, barcode: string | null, mapped = true): CatalogRow => ({
  site: s,
  map: mapped ? { woo_product_id: s.woo_product_id, woo_variation_id: 0, kind: "product", product_id: "p", offer_box_id: null } : null,
  product: mapped ? { id: "p", name: "استيك", price: 100, barcode, is_active: true } : null,
  box: null, cocPrice: 100, priceDiff: 0, displayImage: null, kind: "product",
});

describe("SKU parity (COCEG barcode is the source)", () => {
  it("match / mismatch / pending / na", () => {
    expect(skuState(row(site(1, "6224003208018"), "6224003208018"))).toBe("match");
    expect(skuState(row(site(1, ""), "6224003208018"))).toBe("mismatch");
    expect(skuState(row(site(1, "OLD-1"), "6224003208018"))).toBe("mismatch");
    expect(skuState(row(site(1, ""), null))).toBe("pending");
    expect(skuState(row(site(1, ""), "6221234567890"))).toBe("pending"); // non-company barcode is never pushed
    expect(skuState(row(site(1, ""), null, false))).toBe("na");
  });
  it("duplicates are detected and block matching", () => {
    const list = [site(1, "6224003208018"), site(2, "6224003208018"), site(3, "6224003208025", { removed_at: "2026-11-01" }), site(4, "6224003208025")];
    expect([...duplicateSiteSkus(list)]).toEqual(["6224003208018"]);
    expect(skuWouldDuplicate(row(site(5, ""), "6224003208018"), list)).toBe(true);
    expect(skuWouldDuplicate(row(site(4, "x"), "6224003208025"), list)).toBe(false);
  });
  it("filters by code mismatch and missing image", () => {
    const rows = [row(site(1, ""), "6224003208018"), { ...row(site(2, "6224003208025"), "6224003208025"), displayImage: "https://x/y.jpg" }];
    expect(filterAndSortSiteRows(rows, { query: "", type: "all", status: "sku_mismatch", sort: "name_asc" }).map((r) => r.site.woo_product_id)).toEqual([1]);
    expect(filterAndSortSiteRows(rows, { query: "", type: "all", status: "no_image", sort: "name_asc" }).map((r) => r.site.woo_product_id)).toEqual([1]);
  });
  it("error messages are Arabic", () => {
    expect(syncErrorMessage("duplicate_sku")).toContain("لا يُسمح بتكرار");
    expect(syncErrorMessage("coc_barcode_not_registered")).toContain("الكود تحت التسجيل");
  });
});

describe("box price rule and images", () => {
  it("box price = paid items × qty + shipping (gifts excluded)", () => {
    expect(boxPriceFromItems([
      { name: "استيك", quantity: 2, is_gift: false, custom_price: 300 },
      { name: "كفتة", quantity: 1, is_gift: false, custom_price: 290 },
      { name: "مرقة", quantity: 1, is_gift: true, custom_price: 50 },
    ], 120)).toBe(1010);
  });
  it("image checks and storage path", () => {
    expect(imageFileProblem({ type: "image/gif", size: 10 })).toContain("JPG");
    expect(imageFileProblem({ type: "image/png", size: 11 * 1024 * 1024 })).toContain("10");
    expect(imageFileProblem({ type: "image/webp", size: 500_000 })).toBeNull();
    expect(imageStoragePath("offer_box", "abc", 1)).toBe("offer_box/abc/1.webp");
  });
  it("diff values are readable", () => {
    expect(changeValueLabel("status", "draft")).toBe("مسودة (مخفي)");
    expect(changeValueLabel("catalog_visibility", "hidden")).toBe("مخفي من المتجر والبحث");
    expect(changeValueLabel("sale_price", "765")).toBe("765 ج.م");
  });
});

describe("Woo address → governorate / city / area / street", () => {
  it("maps Woo state codes to the unified governorate list", () => {
    expect(governorateFromWoo("EGC")).toBe("القاهرة");
    expect(governorateFromWoo("EGGZ")).toBe("الجيزة");
    expect(governorateFromWoo("EGALX")).toBe("الإسكندرية");
    expect(governorateFromWoo("الجيزه")).toBe("الجيزة");
    expect(governorateFromWoo("XX")).toBe("");
  });
  it("splits a one-line site address (order 16323 style)", () => {
    const r = splitWooAddress({
      address: "كمبوند روضه الأزهر عماره 1 الدور الأول شقه 12 شارع محور التحرير المستثمرين الشماليه التجمع الأول القاهره الجديده",
      city: "القاهره",
      state: "EGC",
    });
    expect(r).toEqual({
      governorate: "القاهرة",
      city: "القاهرة الجديدة",
      area: "التجمع الأول",
      address: "كمبوند روضه الأزهر عماره 1 الدور الأول شقه 12 شارع محور التحرير المستثمرين الشماليه",
    });
    expect(deliveryAddressLine(r)).toBe("كمبوند روضه الأزهر عماره 1 الدور الأول شقه 12 شارع محور التحرير المستثمرين الشماليه، التجمع الأول، القاهرة الجديدة، القاهرة");
  });
  it("uses address_2 as area and keeps a real city; never invents", () => {
    expect(splitWooAddress({ address_1: "12 شارع التحرير", address_2: "الدقي", city: "الجيزة", state: "EGGZ" }))
      .toEqual({ governorate: "الجيزة", city: "", area: "الدقي", address: "12 شارع التحرير" });
    expect(splitWooAddress({ address_1: "5 شارع البحر", city: "طنطا", state: "EGGH" }))
      .toEqual({ governorate: "الغربية", city: "طنطا", area: "", address: "5 شارع البحر" });
    expect(splitWooAddress({ address: "", city: "", state: "" })).toEqual({ governorate: "", city: "", area: "", address: "" });
  });
});
