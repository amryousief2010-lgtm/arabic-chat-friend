import { supabase } from "@/integrations/supabase/client";

export type ManualMovementResult = {
  id: string;
  stock_before: number | null;
  stock_after: number | null;
  status?: string;
};

/** Atomic relative stock change. The client must not write inventory_items.stock. */
export async function postManualInventoryMovement(args: {
  itemId: string;
  movementType: "in" | "out" | "adjustment";
  quantity: number;
  reason: string;
  notes?: string | null;
  party?: string | null;
  reference?: string | null;
  referenceType?: string | null;
  performedAt?: string | null;
  overrideReason?: string | null;
  packageCount?: number | null;
  packageWeightKg?: number | null;
}): Promise<ManualMovementResult> {
  const { data, error } = await (supabase as any).rpc("post_manual_inventory_movement", {
    p_item_id: args.itemId,
    p_movement_type: args.movementType,
    p_quantity: args.quantity,
    p_reason: args.reason,
    p_notes: args.notes ?? null,
    p_party: args.party ?? null,
    p_reference: args.reference ?? null,
    p_reference_type: args.referenceType ?? null,
    p_performed_at: args.performedAt ?? null,
    p_override_reason: args.overrideReason ?? null,
    p_package_count: args.packageCount ?? null,
    p_package_weight_kg: args.packageWeightKg ?? null,
  });
  if (error) throw error;
  return data as ManualMovementResult;
}

/** Any document the ledger accepts. The database assigns stock_before/stock_after. */
export async function postInventoryDocument(args: {
  itemId: string;
  movementType: string;
  quantity: number;
  sourceType: string;
  reason: string;
  sourceId?: string;
  sourceLineId?: string;
  notes?: string | null;
  party?: string | null;
  reference?: string | null;
  referenceType?: string | null;
  performedAt?: string | null;
  unitCost?: number | null;
  effectMode?: "delta" | "set" | null;
  warehouseId?: string | null;
  productId?: string | null;
  destinationWarehouseId?: string | null;
  packageCount?: number | null;
  packageWeightKg?: number | null;
  overrideReason?: string | null;
}): Promise<ManualMovementResult> {
  const { data, error } = await (supabase as any).rpc("post_inventory_movement", {
    p_item_id: args.itemId,
    p_movement_type: args.movementType,
    p_quantity: args.quantity,
    p_source_type: args.sourceType,
    p_source_id: args.sourceId ?? crypto.randomUUID(),
    p_source_line_id: args.sourceLineId ?? "1",
    p_reason: args.reason,
    p_notes: args.notes ?? null,
    p_performed_at: args.performedAt ?? null,
    p_unit_cost: args.unitCost ?? null,
    p_party: args.party ?? null,
    p_reference: args.reference ?? null,
    p_effect_mode: args.effectMode ?? null,
    p_allow_negative: false,
    p_warehouse_id: args.warehouseId ?? null,
    p_product_id: args.productId ?? null,
    p_module: "warehouse",
    p_reverses_movement_id: null,
    p_override_reason: args.overrideReason ?? null,
    p_reference_type: args.referenceType ?? args.sourceType,
    p_reference_id: null,
    p_destination_warehouse_id: args.destinationWarehouseId ?? null,
    p_package_count: args.packageCount ?? null,
    p_package_weight_kg: args.packageWeightKg ?? null,
    p_order_item_id: null,
  });
  if (error) throw error;
  return data as ManualMovementResult;
}

/** Posted rows stay in the ledger. This adds the opposite movement. */
export async function reversePostedMovement(movementId: string, reason: string): Promise<ManualMovementResult> {
  const { data, error } = await (supabase as any).rpc("reverse_posted_inventory_movement", {
    p_movement_id: movementId,
    p_reason: reason,
  });
  if (error) throw error;
  return data as ManualMovementResult;
}

/** Locked adjustment from an absolute target. The delta is computed inside the row lock. */
export async function setInventoryItemStock(itemId: string, newQty: number, reason: string): Promise<ManualMovementResult> {
  const { data, error } = await (supabase as any).rpc("set_inventory_item_stock", {
    p_item_id: itemId,
    p_new_qty: newQty,
    p_reason: reason,
  });
  if (error) throw error;
  return data as ManualMovementResult;
}
