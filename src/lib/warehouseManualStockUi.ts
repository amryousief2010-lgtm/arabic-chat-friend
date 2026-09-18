import { FEATURE_FLAGS } from "@/config/featureFlags";

/**
 * UI-only gates for manual warehouse stock add/out.
 *
 * When a flag is false the matching button is hidden. Historical
 * MAN-IN / MAN-OUT movements are never deleted or rolled back here,
 * and this module does not touch SQL/RPC auto-stock behavior.
 */
export type ManualStockUiFlags = {
  allow_manual_warehouse_stock_addition: boolean;
  allow_manual_main_warehouse_stock_addition: boolean;
  allow_manual_warehouse_stock_out: boolean;
};

export function isManualStockAdditionUiEnabled(
  isMainWarehouse: boolean,
  flags: ManualStockUiFlags = FEATURE_FLAGS,
): boolean {
  if (!flags.allow_manual_warehouse_stock_addition) return false;
  // Extra kill-switch for the main warehouse only (see flag comment).
  if (isMainWarehouse && !flags.allow_manual_main_warehouse_stock_addition) return false;
  return true;
}

export function isManualStockOutUiEnabled(
  isMainWarehouse: boolean,
  flags: ManualStockUiFlags = FEATURE_FLAGS,
): boolean {
  // Flag comment: manual out is from the main warehouse only.
  if (!isMainWarehouse) return false;
  return flags.allow_manual_warehouse_stock_out === true;
}
