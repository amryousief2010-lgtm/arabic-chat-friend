import { supabase } from "@/integrations/supabase/client";

/**
 * Typed wrapper around the secure inventory read layer (Phase 5B).
 * NOTE: this layer intentionally exposes NO cost/value columns.
 */
export interface SalesAvailabilityRow {
  inventory_item_id: string;
  product_id: string;
  warehouse_id: string;
  warehouse_name: string | null;
  item_code: string | null;
  item_name: string | null;
  unit: string | null;
  current_stock: number;
  reserved_stock: number;
  blocked_stock: number;
  available_stock: number;
  is_active: boolean;
  is_low_stock: boolean;
}

export interface SalesAvailabilityParams {
  productIds?: string[] | null;
  warehouseIds?: string[] | null;
  inventoryItemIds?: string[] | null;
  /** Keep `false` to preserve legacy behaviour where inactive rows were included. */
  activeOnly?: boolean;
  limit?: number;
  offset?: number;
}

const MAX_PAGE = 2000;

const toNum = (v: unknown) => Number(v ?? 0);

/**
 * Calls `inv_get_sales_availability`. Throws a normalized Error on failure —
 * callers must surface the error, never fall back to direct table reads.
 */
export async function getSalesInventoryAvailability(
  params: SalesAvailabilityParams = {},
): Promise<SalesAvailabilityRow[]> {
  const {
    productIds = null,
    warehouseIds = null,
    inventoryItemIds = null,
    activeOnly = false,
    limit = MAX_PAGE,
    offset = 0,
  } = params;

  const { data, error } = await (supabase as any).rpc("inv_get_sales_availability", {
    p_product_ids: productIds && productIds.length ? productIds : null,
    p_warehouse_ids: warehouseIds && warehouseIds.length ? warehouseIds : null,
    p_inventory_item_ids: inventoryItemIds && inventoryItemIds.length ? inventoryItemIds : null,
    p_active_only: activeOnly,
    p_limit: Math.min(Math.max(limit, 1), MAX_PAGE),
    p_offset: Math.max(offset, 0),
  });

  if (error) {
    throw new Error(mapAvailabilityError(error.message));
  }

  return ((data as any[]) || []).map((r) => ({
    inventory_item_id: r.inventory_item_id,
    product_id: r.product_id,
    warehouse_id: r.warehouse_id,
    warehouse_name: r.warehouse_name ?? null,
    item_code: r.item_code ?? null,
    item_name: r.item_name ?? null,
    unit: r.unit ?? null,
    current_stock: toNum(r.current_stock),
    reserved_stock: toNum(r.reserved_stock),
    blocked_stock: toNum(r.blocked_stock),
    available_stock: toNum(r.available_stock),
    is_active: Boolean(r.is_active),
    is_low_stock: Boolean(r.is_low_stock),
  }));
}

export function mapAvailabilityError(message?: string | null): string {
  const m = message || "";
  if (m.includes("NOT_AUTHENTICATED")) return "يجب تسجيل الدخول لعرض أرصدة المخزون.";
  if (m.includes("NOT_AUTHORIZED_FOR_INVENTORY_AVAILABILITY"))
    return "لا تملك صلاحية عرض أرصدة المخزون.";
  return m || "تعذر تحميل أرصدة المخزون.";
}

/** Aggregates available_stock per product for a single warehouse. */
export function sumAvailableByProduct(
  rows: SalesAvailabilityRow[],
  warehouseId?: string | null,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    if (warehouseId && r.warehouse_id !== warehouseId) continue;
    if (!r.product_id) continue;
    out[r.product_id] = (out[r.product_id] || 0) + r.available_stock;
  }
  return out;
}

/** Maps inventory_item_id -> product_id. */
export function mapItemToProduct(rows: SalesAvailabilityRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) {
    if (r.product_id) out[r.inventory_item_id] = r.product_id;
  }
  return out;
}
