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
