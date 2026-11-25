import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { WEBSITE_PRODUCTS_PATH, WEBSITE_PRODUCTS_ROLES, canManageWebsiteProducts } from "@/config/websiteProducts";
import { moduleSections } from "@/components/layout/SidebarMenuSections";
import { WOO_MAP_SUGGESTIONS } from "@/data/wooMapSuggestions";
import {
  barcodeFromSiteSku, barcodeWarning, boxImportCheck, buildCatalogRows, buildMissingItems, cocNotOnSite,
  filterAndSortMissing, filterAndSortSiteRows, formatCairoLatn, formatEgp, formatNum, formatSignedEgp,
  importProductMissing, suggestionFor, summarizeBoxItems, syncErrorMessage,
  type CocBox, type CocProduct, type MapRow, type SiteProduct,
} from "@/lib/websiteProducts";

let currentRoles: string[] = [];
vi.mock("@/hooks/useAuth", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/hooks/useAuth");
  return { ...actual, useAuth: () => ({ user: { id: "u" }, role: currentRoles[0], roles: currentRoles, loading: false }) };
});
vi.mock("@/hooks/useCmFeatureGate", () => ({
  useCmFeatureGate: () => ({ mode: "roles", loading: false, allowed: null }),
  setCmGateModeCache: vi.fn(), resetCmGateCache: vi.fn(), loadCmGateMode: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
import ProtectedRoute from "@/components/ProtectedRoute";

const renderAt = () => render(
  <MemoryRouter initialEntries={[WEBSITE_PRODUCTS_PATH]}>
    <Routes>
      <Route path={WEBSITE_PRODUCTS_PATH} element={<ProtectedRoute allowedRoles={WEBSITE_PRODUCTS_ROLES}><div data-testid="page">ok</div></ProtectedRoute>} />
      <Route path="*" element={<div data-testid="redirected">x</div>} />
    </Routes>
  </MemoryRouter>,
);

describe("website products access (SM / GM / EM only)", () => {
  beforeEach(() => cleanup());
  it("roles", () => {
    expect(WEBSITE_PRODUCTS_ROLES).toEqual(["general_manager", "executive_manager", "sales_manager"]);
    expect(canManageWebsiteProducts(["marketing_sales_manager"])).toBe(false);
  });
  it.each([[["sales_manager"]], [["general_manager"]], [["executive_manager"]]])("allows %j", async (roles) => {
    currentRoles = roles; renderAt();
    await waitFor(() => expect(screen.getByTestId("page")).toBeInTheDocument());
  });
  it.each([[["marketing_sales_manager"]], [["sales_moderator"]], [["accountant"]]])("blocks %j", async (roles) => {
    currentRoles = roles; renderAt();
    await waitFor(() => expect(screen.queryByTestId("page")).not.toBeInTheDocument());
  });
  it("sidebar entry", () => {
    const item = moduleSections.find((s) => s.id === "sales")!.items.find((i) => i.path === WEBSITE_PRODUCTS_PATH)!;
    expect(item.label).toBe("منتجات الموقع");
    expect(item.roles).toEqual(WEBSITE_PRODUCTS_ROLES);
  });
});

describe("website products helpers", () => {
  const site: SiteProduct[] = [
    { woo_product_id: 937, woo_variation_id: 0, name: "استيك نعام", sku: null, price: 850, regular_price: 850, sale_price: null, permalink: null, removed_at: null },
    { woo_product_id: 960, woo_variation_id: 0, name: "بوكس 1500", sku: null, price: 1500, regular_price: 1500, sale_price: null, permalink: null, removed_at: null },
    { woo_product_id: 970, woo_variation_id: 0, name: "جديد", sku: "6224003201234", price: 100, regular_price: 100, sale_price: null, permalink: null, removed_at: null },
  ];
  const products: CocProduct[] = [
    { id: "p1", name: "استيك", price: 800, barcode: "6224003208018", is_active: true },
    { id: "p2", name: "كفتة", price: 620, barcode: null, is_active: true },
    { id: "p3", name: "قديم", price: 1, barcode: null, is_active: false },
  ];
  const boxes: CocBox[] = [
    { id: "b1", name: "بوكس 1500", offer_price: 1500, shipping_cost: 120, is_active: true },
    { id: "b2", name: "بوكس 500", offer_price: 500, shipping_cost: null, is_active: true },
  ];
  const maps: MapRow[] = [
    { woo_product_id: 937, woo_variation_id: 0, kind: "product", product_id: "p1", offer_box_id: null },
    { woo_product_id: 960, woo_variation_id: 0, kind: "offer_box", product_id: null, offer_box_id: "b1" },
  ];

  it("joins site rows with coceg and computes price diffs", () => {
    const rows = buildCatalogRows(site, maps, products, boxes);
    expect(rows[0]).toMatchObject({ cocPrice: 800, priceDiff: 50 });
    expect(rows[1]).toMatchObject({ cocPrice: 1500, priceDiff: 0 });
    expect(rows[2]).toMatchObject({ map: null, cocPrice: null, priceDiff: null });
  });
  it("lists active coceg items not on the site", () => {
    const m = cocNotOnSite(products, boxes, maps);
    expect(m.products.map((p) => p.id)).toEqual(["p2"]);
    expect(m.boxes.map((b) => b.id)).toEqual(["b2"]);
  });
  it("suggestions are shown only for known coceg products (never applied here)", () => {
    expect(WOO_MAP_SUGGESTIONS.length).toBe(28);
    const s = WOO_MAP_SUGGESTIONS[0];
    expect(suggestionFor(s.woo_product_id, WOO_MAP_SUGGESTIONS, [{ id: s.product_id, name: "x", price: 1, barcode: null, is_active: true }])?.product.id).toBe(s.product_id);
    expect(suggestionFor(s.woo_product_id, WOO_MAP_SUGGESTIONS, [])).toBeNull();
  });
  it("product rule: cost, pack weight and barcode/pending are required; barcode never invented", () => {
    const f = { name: "x", price: "100", cost_price: "", pack_weight_kg: "", barcode: "", barcode_pending: false };
    expect(importProductMissing(f)).toEqual(["التكلفة", "وزن العبوة", "الباركود أو «الكود تحت التسجيل»"]);
    expect(importProductMissing({ ...f, cost_price: "50", pack_weight_kg: "1", barcode_pending: true })).toEqual([]);
    expect(barcodeFromSiteSku("6224003201234")).toBe("6224003201234");
    expect(barcodeFromSiteSku("ABC-1")).toBe("");
    expect(barcodeWarning("123")).toContain("13");
    expect(barcodeWarning("6221234567890")).toContain("622400320");
    expect(barcodeWarning("6224003201234")).toBeNull();
  });
  it("box import must equal site price exactly (paid items + shipping)", () => {
    const items = [{ product_id: "p1", quantity: 1, custom_price: 800, is_gift: false }, { product_id: "p2", quantity: 1, custom_price: 0, is_gift: true }];
    expect(boxImportCheck(920, 120, items)).toEqual({ paid: 800, total: 920, ok: true });
    expect(boxImportCheck(1000, 120, items).ok).toBe(false);
    expect(boxImportCheck(800, null, []).ok).toBe(false);
  });
  it("error codes → Arabic", () => {
    expect(syncErrorMessage("WOO_BOX_PRICE_PULL_BLOCKED")).toContain("صناديق العروض");
    expect(syncErrorMessage("WOO_IMPORT_MISSING: التكلفة")).toBe("بيانات ناقصة: التكلفة");
    expect(syncErrorMessage("woo_keys_missing")).toContain("مفاتيح");
    expect(syncErrorMessage("WOO_NOT_MAPPED")).toBe("هذا المنتج غير مربوط");
  });

  it("formats all numbers and EGP prices consistently in Latin digits (no ١٬٠١٠)", () => {
    expect(formatNum(1010)).toBe("1,010");
    expect(formatEgp(1500)).toBe("1,500 ج.م");
    expect(formatSignedEgp(50)).toBe("+50 ج.م");
    expect(formatSignedEgp(-120)).toBe("-120 ج.م");
    const ts = formatCairoLatn("2026-11-25T18:00:00Z");
    expect(ts).not.toMatch(/[٠-٩]/);
  });

  it("filters, searches, sorts, and summarizes offer box contents", () => {
    const rows = buildCatalogRows(site, maps, products, boxes);
    expect(filterAndSortSiteRows(rows, { query: "1500", type: "all", status: "all", sort: "name_asc" })).toHaveLength(1);
    expect(filterAndSortSiteRows(rows, { query: "", type: "offer_box", status: "all", sort: "name_asc" }).map((r) => r.site.woo_product_id)).toEqual([960]);
    expect(filterAndSortSiteRows(rows, { query: "", type: "all", status: "diff", sort: "diff_desc" }).map((r) => r.site.woo_product_id)).toEqual([937]);

    const missing = cocNotOnSite(products, boxes, maps);
    const items = buildMissingItems(missing.products, missing.boxes);
    expect(filterAndSortMissing(items, { query: "", type: "offer_box", sort: "price_desc" }).map((i) => i.id)).toEqual(["b2"]);
    expect(summarizeBoxItems([
      { name: "استيك", quantity: 1, is_gift: false },
      { name: "كفتة", quantity: 2, is_gift: false },
      { name: "مرقة", quantity: 1, is_gift: true },
      { name: "سجق", quantity: 1, is_gift: false },
    ])).toBe("استيك × 1، كفتة × 2، مرقة × 1 (هدية) + 1 أخرى");
  });
});
