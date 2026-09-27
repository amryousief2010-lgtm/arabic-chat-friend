import { supabase } from "@/integrations/supabase/client";

/** Roles that may read inventory unit cost and valuation. There is no admin role. */
export const INVENTORY_COST_ROLES = [
  "general_manager",
  "executive_manager",
  "accountant",
  "financial_manager",
  "cost_accountant",
] as const;

export function canViewInventoryCost(roles: readonly string[] | null | undefined): boolean {
  if (!roles?.length) return false;
  return roles.some((role) => (INVENTORY_COST_ROLES as readonly string[]).includes(role));
}

/** Columns granted to authenticated. unit_cost is intentionally absent. */
export const INVENTORY_ITEM_SAFE_COLUMNS =
  "id, warehouse_id, name, category, sku, unit, stock, low_stock_threshold, expiry_date, notes, is_active, created_at, updated_at, reserved_qty, blocked_qty, module, item_code, last_movement_date, product_id, pack_weight_kg";

/** Columns granted to authenticated. unit_cost and total_cost are intentionally absent. */
export const INVENTORY_MOVEMENT_SAFE_COLUMNS =
  "id, item_id, warehouse_id, movement_type, quantity, destination_warehouse_id, reference, party, notes, performed_by, performed_at, created_at, movement_no, module, source_warehouse_id, reference_type, reference_id, batch_id, reason, approval_status, approved_by, approved_at, order_item_id, product_id, package_count, package_weight_kg, quantity_kg, stock_before, stock_after, effect_mode, period_lock_override_reason";

async function loadVisibleCosts(
  table: "inventory_items_visible" | "inventory_movements_visible",
  ids: string[],
  columns: string,
): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  const unique = Array.from(new Set(ids.filter(Boolean)));
  for (let i = 0; i < unique.length; i += 200) {
    const slice = unique.slice(i, i + 200);
    const { data, error } = await (supabase as any).from(table).select(columns).in("id", slice);
    if (error) throw error;
    for (const row of data || []) map.set(row.id, row);
  }
  return map;
}

/** Attach unit_cost from the masking view. Non-finance roles receive null. */
export async function withItemUnitCost<T extends { id: string }>(rows: T[]): Promise<(T & { unit_cost: number | null })[]> {
  if (!rows.length) return rows as (T & { unit_cost: number | null })[];
  const costs = await loadVisibleCosts("inventory_items_visible", rows.map((r) => r.id), "id, unit_cost");
  return rows.map((row) => ({ ...row, unit_cost: costs.get(row.id)?.unit_cost ?? null }));
}

export async function withMovementCosts<T extends { id: string }>(
  rows: T[],
): Promise<(T & { unit_cost: number | null; total_cost: number | null })[]> {
  if (!rows.length) return rows as (T & { unit_cost: number | null; total_cost: number | null })[];
  const costs = await loadVisibleCosts("inventory_movements_visible", rows.map((r) => r.id), "id, unit_cost, total_cost");
  return rows.map((row) => ({
    ...row,
    unit_cost: costs.get(row.id)?.unit_cost ?? null,
    total_cost: costs.get(row.id)?.total_cost ?? null,
  }));
}

/**
 * PostgREST embeds follow foreign keys. The cost-masking views have none,
 * so callers select the view and attach related rows here.
 */
export async function attachRelated<T extends Record<string, any>>(
  rows: T[],
  relations: Array<{ as: string; idField: string; table: string; columns: string }>,
): Promise<T[]> {
  for (const rel of relations) {
    const ids = Array.from(new Set(rows.map((row) => row[rel.idField]).filter(Boolean).map(String)));
    const byId = new Map<string, Record<string, unknown>>();
    for (let i = 0; i < ids.length; i += 200) {
      const slice = ids.slice(i, i + 200);
      const { data, error } = await (supabase as any).from(rel.table).select(rel.columns).in("id", slice);
      if (error) throw error;
      for (const row of data || []) {
        if (row?.id) byId.set(String(row.id), row);
      }
    }
    for (const row of rows) {
      const record = row as Record<string, any>;
      const id = record[rel.idField];
      record[rel.as] = id ? byId.get(String(id)) ?? null : null;
    }
  }
  return rows;
}
