import { describe, it, expect } from "vitest";
import {
  isManualStockAdditionUiEnabled,
  isManualStockOutUiEnabled,
  type ManualStockUiFlags,
} from "../warehouseManualStockUi";
import { FEATURE_FLAGS } from "@/config/featureFlags";

const allOn: ManualStockUiFlags = {
  allow_manual_warehouse_stock_addition: true,
  allow_manual_main_warehouse_stock_addition: true,
  allow_manual_warehouse_stock_out: true,
};

describe("isManualStockAdditionUiEnabled", () => {
  it("shows add on every warehouse when both addition flags are on", () => {
    expect(isManualStockAdditionUiEnabled(true, allOn)).toBe(true);
    expect(isManualStockAdditionUiEnabled(false, allOn)).toBe(true);
  });

  it("hides add everywhere when the general addition flag is off", () => {
    const flags = { ...allOn, allow_manual_warehouse_stock_addition: false };
    expect(isManualStockAdditionUiEnabled(true, flags)).toBe(false);
    expect(isManualStockAdditionUiEnabled(false, flags)).toBe(false);
  });

  it("hides add on main only when the main-warehouse kill-switch is off", () => {
    const flags = { ...allOn, allow_manual_main_warehouse_stock_addition: false };
    expect(isManualStockAdditionUiEnabled(true, flags)).toBe(false);
    expect(isManualStockAdditionUiEnabled(false, flags)).toBe(true);
  });
});

describe("isManualStockOutUiEnabled", () => {
  it("shows out on main when the out flag is on", () => {
    expect(isManualStockOutUiEnabled(true, allOn)).toBe(true);
  });

  it("never shows out on non-main warehouses", () => {
    expect(isManualStockOutUiEnabled(false, allOn)).toBe(false);
  });

  it("hides out on main when the out flag is off", () => {
    const flags = { ...allOn, allow_manual_warehouse_stock_out: false };
    expect(isManualStockOutUiEnabled(true, flags)).toBe(false);
  });
});

describe("FEATURE_FLAGS defaults (all currently true)", () => {
  it("keeps add visible on main and other warehouses, and out only on main", () => {
    expect(isManualStockAdditionUiEnabled(true, FEATURE_FLAGS)).toBe(true);
    expect(isManualStockAdditionUiEnabled(false, FEATURE_FLAGS)).toBe(true);
    expect(isManualStockOutUiEnabled(true, FEATURE_FLAGS)).toBe(true);
    expect(isManualStockOutUiEnabled(false, FEATURE_FLAGS)).toBe(false);
  });
});
