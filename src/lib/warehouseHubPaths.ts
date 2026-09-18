/**
 * Canonical warehouses hub paths.
 *
 * Dedicated `/warehouse-stock/*` routes remain mounted (see AnimatedRoutes)
 * only where a landing or allowlist still depends on them:
 * - `/warehouse-stock` — sales_moderator المتاح (ProtectedRoute prefix allowlist)
 * - `/warehouse-stock/agouza` — agouza_warehouse_keeper landing
 * - `/warehouse-stock/moderator/:slug` — per-moderator stock pages
 * - `/warehouse-stock/main/guide` — same MainWarehouseGuide page as
 *   `/modules/warehouses/main-guide`, kept because the hub-adjacent route is
 *   role-restricted while the legacy path is any authenticated user
 *
 * Non-landing scopes that Phase 2 already maps to hub tabs
 * (`/warehouse-stock/main`, hyper healthy, hyper carrefour) redirect via
 * `LEGACY_WAREHOUSE_STOCK_HUB_REDIRECTS`.
 */
export const WAREHOUSE_HUB_PATH = "/modules/warehouses";

export const WAREHOUSE_HUB_TABS = [
  "dashboard-all",
  "available",
  "items",
  "movements",
  "low",
  "distribution",
  "wh-main",
  "wh-agouza",
  "wh-hht",
  "wh-carrefour",
  "wh-packaging",
  "reports",
  "menu",
  "more",
] as const;

export type WarehouseHubTab = (typeof WAREHOUSE_HUB_TABS)[number];

export const isWarehouseHubTab = (value: string | null | undefined): value is WarehouseHubTab =>
  !!value && (WAREHOUSE_HUB_TABS as readonly string[]).includes(value);

export function warehouseHubTabPath(tab: WarehouseHubTab): string {
  return `${WAREHOUSE_HUB_PATH}?tab=${tab}`;
}

/** Non-landing `/warehouse-stock/*` scopes that now redirect to hub tabs. */
export const LEGACY_WAREHOUSE_STOCK_HUB_REDIRECTS: ReadonlyArray<{
  from: string;
  tab: WarehouseHubTab;
}> = [
  { from: "/warehouse-stock/main", tab: "wh-main" },
  { from: "/warehouse-stock/hyper-healthy-test", tab: "wh-hht" },
  { from: "/warehouse-stock/hyper-carrefour", tab: "wh-carrefour" },
];

/** Landings / allowlist routes that must keep resolving (do not redirect). */
export const LEGACY_WAREHOUSE_STOCK_KEEP = {
  moderatorAvailable: "/warehouse-stock",
  agouzaKeeperLanding: "/warehouse-stock/agouza",
  moderatorSlug: "/warehouse-stock/moderator/:slug",
  mainGuide: "/warehouse-stock/main/guide",
} as const;

/**
 * Union of roles allowed on `/modules/warehouses/zodex-review`.
 * Sidebar item roles must stay in sync so anyone who can open the page
 * also sees the menu entry.
 */
export const ZODEX_REVIEW_ALLOWED_ROLES = [
  "general_manager",
  "executive_manager",
  "warehouse_supervisor",
  "agouza_warehouse_keeper",
  "sales_manager",
  "marketing_sales_manager",
  "marketing_sales_viewer",
  "financial_manager",
  "accountant",
] as const;

/** "Open warehouse" target used by location cards. */
export function warehouseLocationOpenPath(name: string, type?: string, id?: string): string {
  const n = name || "";
  if (n.includes("الرئيسي")) return warehouseHubTabPath("wh-main");
  if (n.includes("العجوزة")) return warehouseHubTabPath("wh-agouza");
  if (n.includes("هيلثي")) return warehouseHubTabPath("wh-hht");
  if (n.includes("كارفور")) return warehouseHubTabPath("wh-carrefour");
  if (n.includes("تغليف") || type === "packaging") return "/modules/packaging";
  if (n.includes("مصنع اللحوم")) return "/meat-factory/factory-warehouses";
  return id ? `${WAREHOUSE_HUB_PATH}/${id}` : WAREHOUSE_HUB_PATH;
}
