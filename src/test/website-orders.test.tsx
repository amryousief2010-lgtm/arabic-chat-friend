import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { WEBSITE_ORDERS_PATH, WEBSITE_ORDERS_ROLES, canManageWebsiteOrders } from "@/config/websiteOrders";
import { moduleSections } from "@/components/layout/SidebarMenuSections";
import {
  assignBlocker, attributionLabel, findMapping, mapItems, maskPhone, unmappedCount, websiteErrorMessage,
  type ProductMapRow,
} from "@/lib/websiteOrders";

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

const renderAt = () =>
  render(
    <MemoryRouter initialEntries={[WEBSITE_ORDERS_PATH]}>
      <Routes>
        <Route path={WEBSITE_ORDERS_PATH} element={<ProtectedRoute allowedRoles={WEBSITE_ORDERS_ROLES}><div data-testid="page">ok</div></ProtectedRoute>} />
        <Route path="*" element={<div data-testid="redirected">x</div>} />
      </Routes>
    </MemoryRouter>,
  );

describe("website orders access (SM / GM / EM only)", () => {
  beforeEach(() => cleanup());

  it("roles are exactly the decided three", () => {
    expect(WEBSITE_ORDERS_ROLES).toEqual(["general_manager", "executive_manager", "sales_manager"]);
    expect(canManageWebsiteOrders(["sales_manager", "marketing_sales_manager"])).toBe(true);
    for (const r of ["marketing_sales_manager", "marketing_sales_viewer", "sales_moderator", "accountant"])
      expect(canManageWebsiteOrders([r])).toBe(false);
    expect(canManageWebsiteOrders(null)).toBe(false);
  });

  it.each([[["sales_manager"]], [["sales_manager", "marketing_sales_manager"]], [["general_manager"]], [["executive_manager"]]])(
    "route allows %j", async (roles) => {
      currentRoles = roles;
      renderAt();
      await waitFor(() => expect(screen.getByTestId("page")).toBeInTheDocument());
    });

  it.each([[["marketing_sales_manager"]], [["marketing_sales_viewer"]], [["sales_moderator"]], [["accountant"]]])(
    "route blocks %j", async (roles) => {
      currentRoles = roles;
      renderAt();
      await waitFor(() => expect(screen.queryByTestId("page")).not.toBeInTheDocument());
    });

  it("sidebar entry is in the sales section with the same roles", () => {
    const sales = moduleSections.find((s) => s.id === "sales")!;
    const item = sales.items.find((i) => i.path === WEBSITE_ORDERS_PATH)!;
    expect(item.label).toBe("طلبات الموقع");
    expect(item.roles).toEqual(WEBSITE_ORDERS_ROLES);
  });
});

describe("website orders helpers", () => {
  const maps: ProductMapRow[] = [
    { woo_product_id: 11, woo_variation_id: 0, kind: "offer_box", product_id: null, offer_box_id: "box" },
    { woo_product_id: 12, woo_variation_id: 34, kind: "product", product_id: "p34", offer_box_id: null },
    { woo_product_id: 12, woo_variation_id: 0, kind: "product", product_id: "p12", offer_box_id: null },
  ];

  it("masks phones", () => {
    expect(maskPhone("01001234567")).toBe("010*****567");
    expect(maskPhone("+20 100 123 4567")).toBe("201*****567");
    expect(maskPhone(null)).toBe("—");
    expect(maskPhone("123")).toBe("***");
  });

  it("finds variation mapping then parent fallback", () => {
    expect(findMapping({ woo_product_id: 12, woo_variation_id: 34, name: "a", quantity: 1, unit_price: 1 }, maps)?.product_id).toBe("p34");
    expect(findMapping({ woo_product_id: 12, woo_variation_id: 99, name: "a", quantity: 1, unit_price: 1 }, maps)?.product_id).toBe("p12");
    expect(findMapping({ woo_product_id: 50, name: "a", quantity: 1, unit_price: 1 }, maps)).toBeNull();
  });

  it("blocks assignment until mapping, moderator and customer choice are done", () => {
    const items = mapItems([
      { woo_product_id: 11, name: "بوكس", quantity: 1, unit_price: 1500 },
      { woo_product_id: 50, name: "غير مربوط", quantity: 1, unit_price: 100 },
    ], maps);
    expect(unmappedCount(items)).toBe(1);
    const base = { kind: "order" as const, status: "new" as const, items, moderatorId: "m", possibleDuplicate: false, customerChoice: null };
    expect(assignBlocker({ ...base, moderatorId: null })).toContain("المودريتور");
    expect(assignBlocker(base)).toContain("غير مربوط");
    const mapped = items.slice(0, 1);
    expect(assignBlocker({ ...base, items: mapped })).toBeNull();
    expect(assignBlocker({ ...base, items: mapped, possibleDuplicate: true })).toContain("عميل جديد");
    expect(assignBlocker({ ...base, items: mapped, possibleDuplicate: true, customerChoice: "new" })).toBeNull();
    expect(assignBlocker({ ...base, items: [], kind: "registration" })).toBeNull();
    expect(assignBlocker({ ...base, items: mapped, status: "assigned" })).not.toBeNull();
  });

  it("translates DB error codes to Arabic", () => {
    expect(websiteErrorMessage("WEB_UNMAPPED_ITEMS: [x]")).toContain("غير مربوط");
    expect(websiteErrorMessage("WEB_NOT_NEW")).toContain("بالفعل");
    expect(websiteErrorMessage("random")).toContain("تعذّر");
  });

  it("summarizes attribution", () => {
    expect(attributionLabel({ utm_source: "facebook", utm_campaign: "nov" })).toBe("facebook · nov");
    expect(attributionLabel({ gclid: "x" })).toBe("google");
    expect(attributionLabel(null)).toBe("مباشر / غير معروف");
  });
});
