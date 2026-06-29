/**
 * M4-B: Agouza warehouse stock reservation integration helpers.
 *
 * Scope: ONLY orders whose source_warehouse_id === AGOUZA_WAREHOUSE_ID.
 * No effect on Main warehouse, Kimo (courier), couriers, Carrefour, Healthy Taste,
 * warehouse_transfers, or any other workflow.
 *
 * Rules:
 *  - reserve  → only places a hold, never mutates inventory stock.
 *  - release  → frees a hold, never mutates inventory stock.
 *  - commit   → executed on delivery; the ONLY operation that decrements stock
 *               and writes an inventory_movements row (sales_dispatch).
 *
 * All operations are also recorded in agouza_reservation_audit_log by the RPCs.
 */
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const AGOUZA_WAREHOUSE_ID = "a970d469-37df-40e1-b99f-a49195a3778e";

export function isAgouzaOrder(order: { source_warehouse_id?: string | null } | null | undefined): boolean {
  return !!order && order.source_warehouse_id === AGOUZA_WAREHOUSE_ID;
}

type Shortage = {
  product_id?: string;
  inventory_item_id?: string;
  requested?: number;
  available?: number;
  shortage?: number;
  reason?: string;
};

type ReserveResult =
  | { ok: true; reserved: Array<{ inventory_item_id: string; product_id: string; quantity: number }> }
  | { ok: false; shortages: Shortage[] };

/** Build a readable Arabic shortage message using product_id → name map (best effort). */
async function describeShortages(shortages: Shortage[]): Promise<string> {
  if (!shortages?.length) return "عجز في مخزون العجوزة";
  const ids = Array.from(new Set(shortages.map((s) => s.product_id).filter(Boolean))) as string[];
  let nameById: Record<string, string> = {};
  if (ids.length) {
    const { data } = await supabase.from("products").select("id, name").in("id", ids);
    nameById = Object.fromEntries((data ?? []).map((p: any) => [p.id, p.name]));
  }
  const lines = shortages.map((s) => {
    const nm = (s.product_id && nameById[s.product_id]) || "صنف غير معروف";
    if (s.reason) return `• ${nm}: ${s.reason}`;
    return `• ${nm}: المطلوب ${s.requested ?? 0}، المتاح ${s.available ?? 0}، العجز ${s.shortage ?? 0}`;
  });
  return lines.join("\n");
}

/**
 * Reserve Agouza stock for an order. Call ONLY for Agouza orders.
 * Returns true on success, false on shortage (toast shown automatically).
 */
export async function reserveAgouzaForOrder(orderId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("reserve_agouza_stock_for_order", { p_order_id: orderId });
    if (error) throw error;
    const res = data as ReserveResult;
    if (res?.ok) {
      toast.success("تم حجز الكمية من مخزن العجوزة بنجاح.");
      return true;
    }
    const desc = await describeShortages((res as any)?.shortages ?? []);
    toast.error("لا يمكن حجز الكمية من مخزن العجوزة بسبب عجز في المخزون:", {
      description: desc,
      duration: 12000,
    });
    return false;
  } catch (e: any) {
    console.error("reserveAgouzaForOrder error", e);
    toast.error(e?.message || "تعذّر حجز مخزون العجوزة");
    return false;
  }
}

/** Release any active Agouza reservation tied to this order. Safe to call even if none exists. */
export async function releaseAgouzaForOrder(orderId: string, reason: string): Promise<boolean> {
  try {
    const { error } = await supabase.rpc("release_agouza_stock_reservation", {
      p_order_id: orderId,
      p_reason: reason,
    });
    if (error) throw error;
    return true;
  } catch (e: any) {
    console.error("releaseAgouzaForOrder error", e);
    toast.error(e?.message || "تعذّر فك حجز مخزون العجوزة");
    return false;
  }
}

/**
 * Commit Agouza stock on delivery — this is the ONLY place we decrement stock.
 * Idempotent (RPC guards against double commit).
 */
export async function commitAgouzaForOrder(orderId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("commit_agouza_stock_on_delivery", { p_order_id: orderId });
    if (error) throw error;
    const res = data as any;
    const committed = Array.isArray(res?.committed) ? res.committed.length : 0;
    const skipped = Array.isArray(res?.skipped) ? res.skipped.length : 0;
    if (committed === 0 && skipped === 0) {
      toast.warning("لا يوجد حجز نشط لهذا الأوردر، برجاء مراجعة حجز مخزون العجوزة قبل التسليم.");
    }
    return true;
  } catch (e: any) {
    console.error("commitAgouzaForOrder error", e);
    toast.error(e?.message || "تعذّر خصم مخزون العجوزة عند التسليم");
    return false;
  }
}

/** Look up an order's source_warehouse_id (used when only the orderId is in hand). */
export async function fetchOrderSourceWarehouseId(orderId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("orders")
    .select("source_warehouse_id")
    .eq("id", orderId)
    .maybeSingle<{ source_warehouse_id: string | null }>();
  if (error) {
    console.warn("fetchOrderSourceWarehouseId error", error);
    return null;
  }
  return data?.source_warehouse_id ?? null;
}
