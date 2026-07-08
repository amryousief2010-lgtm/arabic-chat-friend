import { supabase } from "@/integrations/supabase/client";
import {
  AGOUZA_WAREHOUSE_ID,
  commitAgouzaForOrder,
  releaseAgouzaForOrder,
} from "@/lib/agouzaReservations";

export type SharedOrderStatus = "pending" | "processing" | "shipped" | "delivered" | "cancelled";

/**
 * Reusable order-status update that mirrors the primary Orders.tsx handler:
 *  - Agouza reservation lifecycle (commit on delivered / release on cancelled)
 *  - orders.status update (DB trigger writes to order_status_audit)
 *  - update_status_marker for UI freshness
 *  - notes append for cancellation reason
 *
 * Callers must already have gated on role permissions before invoking.
 */
export async function updateOrderStatusShared(params: {
  orderId: string;
  newStatus: SharedOrderStatus;
  userId?: string | null;
  cancelReason?: string | null;
  /** If true, skip Agouza reservation commit even when there is no active hold (shortage override). */
  agouzaShortageOverride?: boolean;
}): Promise<void> {
  const { orderId, newStatus, userId, cancelReason, agouzaShortageOverride } = params;

  // Fetch current order snapshot for lifecycle decisions.
  const { data: order, error: fetchErr } = await supabase
    .from("orders")
    .select("id, status, source_warehouse_id, notes")
    .eq("id", orderId)
    .maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!order) throw new Error("الأوردر غير موجود");

  const prevStatus = order.status as SharedOrderStatus;
  const isAgouza = order.source_warehouse_id === AGOUZA_WAREHOUSE_ID;

  // Build update payload
  const updatePayload: Record<string, any> = { status: newStatus };
  if (newStatus === "cancelled" && cancelReason && cancelReason.trim()) {
    const stamp = new Date().toLocaleString("ar-EG");
    const prefix = order.notes ? order.notes + "\n" : "";
    updatePayload.notes = `${prefix}[مرتجع - ${stamp}] ${cancelReason.trim()}`;
  }

  const { error: updErr } = await supabase
    .from("orders")
    .update(updatePayload)
    .eq("id", orderId);
  if (updErr) throw updErr;

  // Agouza reservation lifecycle — mirrors Orders.tsx.
  if (isAgouza) {
    if (newStatus === "delivered" && prevStatus !== "delivered") {
      if (!agouzaShortageOverride) {
        try {
          await commitAgouzaForOrder(orderId);
        } catch (e) {
          console.warn("commitAgouzaForOrder failed", e);
        }
      } else {
        try {
          await (supabase as any).from("agouza_override_audit_log").insert({
            order_id: orderId,
            action: "deliver_without_reservation",
            reason: "shortage_override_by_user",
          });
        } catch { /* best-effort */ }
      }
    } else if (newStatus === "cancelled" && prevStatus !== "cancelled") {
      try {
        await releaseAgouzaForOrder(orderId, "order_cancelled");
      } catch (e) {
        console.warn("releaseAgouzaForOrder failed", e);
      }
    }
  }

  // Update status marker (best-effort)
  if (newStatus === "delivered" || newStatus === "cancelled") {
    try {
      await supabase
        .from("orders")
        .update({
          update_status_marker: newStatus === "delivered" ? "delivered" : "cancelled",
          update_status_updated_at: new Date().toISOString(),
          update_status_updated_by: userId ?? null,
        } as any)
        .eq("id", orderId);
    } catch (e) {
      console.warn("markOrderUpdate failed", e);
    }
  }
}
