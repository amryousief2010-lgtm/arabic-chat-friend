/**
 * Canonical warehouses hub paths.
 *
 * Dedicated `/warehouse-stock/*` routes remain mounted (see AnimatedRoutes)
 * for sales_moderator allowlisting, agouza_warehouse_keeper landing, and
 * moderator slug pages. Location cards and other staff deep-links should
 * prefer the hub when the destination is equivalent.
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
