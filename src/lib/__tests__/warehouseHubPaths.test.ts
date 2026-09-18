import { describe, it, expect } from "vitest";
import {
  isWarehouseHubTab,
  warehouseHubTabPath,
  warehouseLocationOpenPath,
  WAREHOUSE_HUB_PATH,
  LEGACY_WAREHOUSE_STOCK_HUB_REDIRECTS,
  LEGACY_WAREHOUSE_STOCK_KEEP,
  ZODEX_REVIEW_ALLOWED_ROLES,
} from "../warehouseHubPaths";
import { ROLE_LANDING } from "@/constants/roleLandings";
import { moduleSections } from "@/components/layout/SidebarMenuSections";

describe("warehouseLocationOpenPath", () => {
  it("sends known stock warehouses to the hub tab, not /warehouse-stock", () => {
    expect(warehouseLocationOpenPath("المخزن الرئيسي")).toBe("/modules/warehouses?tab=wh-main");
    expect(warehouseLocationOpenPath("مخزن العجوزة")).toBe("/modules/warehouses?tab=wh-agouza");
    expect(warehouseLocationOpenPath("هايبر هيلثي تيست")).toBe("/modules/warehouses?tab=wh-hht");
    expect(warehouseLocationOpenPath("هايبر كارفور")).toBe("/modules/warehouses?tab=wh-carrefour");
  });

  it("keeps packaging and meat-factory destinations", () => {
    expect(warehouseLocationOpenPath("مخزن التغليف")).toBe("/modules/packaging");
    expect(warehouseLocationOpenPath("مخزن", "packaging")).toBe("/modules/packaging");
    expect(warehouseLocationOpenPath("مخزن مصنع اللحوم")).toBe("/meat-factory/factory-warehouses");
  });

  it("falls back to the warehouse detail page", () => {
    expect(warehouseLocationOpenPath("مخزن عميل", "general", "abc")).toBe(
      `${WAREHOUSE_HUB_PATH}/abc`,
    );
  });
});

describe("warehouse hub tabs", () => {
  it("accepts known hub tabs and rejects unknown ones", () => {
    expect(isWarehouseHubTab("available")).toBe(true);
    expect(isWarehouseHubTab("wh-main")).toBe(true);
    expect(isWarehouseHubTab("not-a-tab")).toBe(false);
    expect(isWarehouseHubTab(null)).toBe(false);
  });

  it("builds a tab query on the hub path", () => {
    expect(warehouseHubTabPath("available")).toBe("/modules/warehouses?tab=available");
  });
});

describe("legacy /warehouse-stock hub redirects", () => {
  it("maps non-landing location-card scopes to hub tabs", () => {
    expect(LEGACY_WAREHOUSE_STOCK_HUB_REDIRECTS).toEqual([
      { from: "/warehouse-stock/main", tab: "wh-main" },
      { from: "/warehouse-stock/hyper-healthy-test", tab: "wh-hht" },
      { from: "/warehouse-stock/hyper-carrefour", tab: "wh-carrefour" },
    ]);
    for (const { from, tab } of LEGACY_WAREHOUSE_STOCK_HUB_REDIRECTS) {
      expect(warehouseHubTabPath(tab)).toMatch(/^\/modules\/warehouses\?tab=/);
      expect(from).not.toBe(LEGACY_WAREHOUSE_STOCK_KEEP.moderatorAvailable);
      expect(from).not.toBe(LEGACY_WAREHOUSE_STOCK_KEEP.agouzaKeeperLanding);
    }
  });

  it("does not redirect keeper landing, moderator routes, or the any-auth guide", () => {
    const froms = LEGACY_WAREHOUSE_STOCK_HUB_REDIRECTS.map((r) => r.from);
    expect(froms).not.toContain("/warehouse-stock");
    expect(froms).not.toContain("/warehouse-stock/agouza");
    expect(froms).not.toContain("/warehouse-stock/moderator/:slug");
    expect(froms).not.toContain("/warehouse-stock/main/guide");
    expect(LEGACY_WAREHOUSE_STOCK_KEEP).toEqual({
      moderatorAvailable: "/warehouse-stock",
      agouzaKeeperLanding: "/warehouse-stock/agouza",
      moderatorSlug: "/warehouse-stock/moderator/:slug",
      mainGuide: "/warehouse-stock/main/guide",
    });
  });
});

describe("intentionally left /warehouse-stock landings", () => {
  it("keeps agouza_warehouse_keeper on the scoped stock page", () => {
    expect(ROLE_LANDING.agouza_warehouse_keeper).toBe("/warehouse-stock/agouza");
  });
});

describe("Zodex review sidebar roles match the route allowlist", () => {
  it("includes warehouse_supervisor and agouza_warehouse_keeper (route union)", () => {
    expect(ZODEX_REVIEW_ALLOWED_ROLES).toContain("warehouse_supervisor");
    expect(ZODEX_REVIEW_ALLOWED_ROLES).toContain("agouza_warehouse_keeper");
    const item = moduleSections
      .find((s) => s.id === "warehouses")
      ?.items.find((i) => i.path === "/modules/warehouses/zodex-review");
    expect(item).toBeDefined();
    expect(item!.roles.slice().sort()).toEqual([...ZODEX_REVIEW_ALLOWED_ROLES].slice().sort());
  });
});
