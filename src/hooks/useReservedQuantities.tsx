import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { MAIN_WAREHOUSE_OPERATIONAL_START_ISO } from "@/constants/warehouseOperations";
import { getSalesInventoryAvailability, mapItemToProduct } from "@/lib/inventoryReadApi";

/**
 * Returns reserved (pending-but-not-dispatched) qty per inventory_item.id for a warehouse,
 * derived from orders.source_warehouse_id + order_items.quantity.
 * Respects the main-warehouse cutoff: archived old reservations are excluded.
 */
export function useReservedQuantities(warehouseId: string | null | undefined, itemIds: string[]) {
  const [reservedByItem, setReservedByItem] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);

  const key = `${warehouseId || ""}|${[...itemIds].sort().join(",")}`;

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!warehouseId || itemIds.length === 0) {
        setReservedByItem({});
        return;
      }
      setLoading(true);
      try {
        // map inventory_item.id -> product_id (secure read layer, no cost columns)
        const invRows = await getSalesInventoryAvailability({
          inventoryItemIds: itemIds,
          warehouseIds: [warehouseId],
          activeOnly: false,
        });
        const itemToProduct = mapItemToProduct(invRows);

        const productIds: string[] = Array.from(new Set(Object.values(itemToProduct)));
        if (productIds.length === 0) { if (!cancelled) setReservedByItem({}); return; }

        // pending orders for this warehouse
        const { data: orders } = await supabase
          .from("orders")
          .select("id, source_warehouse_id, status, stock_status, created_at")
          .eq("source_warehouse_id", warehouseId)
          .not("status", "in", "(delivered,cancelled)")
          .or("stock_status.is.null,stock_status.neq.dispatched");

        const cutoffMs = new Date(MAIN_WAREHOUSE_OPERATIONAL_START_ISO).getTime();
        const eligible = (orders || []).filter((o: any) => new Date(o.created_at).getTime() >= cutoffMs);
        const orderIds = eligible.map((o: any) => o.id);

        const productReserved: Record<string, number> = {};
        for (let i = 0; i < orderIds.length; i += 500) {
          const slice = orderIds.slice(i, i + 500);
          if (slice.length === 0) continue;
          const { data: oi } = await supabase
            .from("order_items")
            .select("product_id, quantity")
            .in("order_id", slice)
            .in("product_id", productIds);
          (oi || []).forEach((row: any) => {
            const q = Number(row.quantity || 0);
            productReserved[row.product_id] = (productReserved[row.product_id] || 0) + q;
          });
        }

        const out: Record<string, number> = {};
        for (const itemId of itemIds) {
          const pid = itemToProduct[itemId];
          out[itemId] = pid ? (productReserved[pid] || 0) : 0;
        }
        if (!cancelled) setReservedByItem(out);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { reservedByItem, loading };
}
