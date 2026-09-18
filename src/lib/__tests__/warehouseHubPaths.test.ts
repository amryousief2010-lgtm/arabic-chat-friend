import { describe, it, expect } from "vitest";
import {
  isWarehouseHubTab,
  warehouseHubTabPath,
  warehouseLocationOpenPath,
  WAREHOUSE_HUB_PATH,
} from "../warehouseHubPaths";
import { ROLE_LANDING } from "@/constants/roleLandings";

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

describe("intentionally left /warehouse-stock landings", () => {
  it("keeps agouza_warehouse_keeper on the scoped stock page", () => {
    expect(ROLE_LANDING.agouza_warehouse_keeper).toBe("/warehouse-stock/agouza");
  });
});
