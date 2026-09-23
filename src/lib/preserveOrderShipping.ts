import { supabase } from "@/integrations/supabase/client";
import {
  orderHeaderAfterItemChange,
  type OrderTotalItem,
} from "@/lib/orderTotals";

/**
 * After order_items change, write subtotal/total and put the previous
 * delivery_fee back on the row. Item triggers must not be the last writer:
 * they used to omit shipping from the total whenever the order had no offer
 * line left.
 */
export async function writeOrderTotalsPreservingShipping(
  orderId: string,
  header: { discount?: number; deliveryFee?: number; extraCharge?: number }
) {
  const { data: rows, error } = await supabase
    .from("order_items")
    .select("product_id, product_name, offer_name, quantity, unit_price")
    .eq("order_id", orderId);
  if (error) throw error;

  const items: OrderTotalItem[] = (rows || []).map((row) => ({
    product_id: row.product_id,
    product_name: row.product_name,
    offer_name: row.offer_name,
    quantity: Number(row.quantity || 0),
    unit_price: Number(row.unit_price || 0),
  }));

  const next = orderHeaderAfterItemChange(items, {
    discount: header.discount,
    deliveryFee: header.deliveryFee,
    extraCharge: header.extraCharge,
  });

  const { error: updateError } = await supabase
    .from("orders")
    .update({
      subtotal: next.subtotal,
      delivery_fee: next.delivery_fee,
      total: next.total,
    })
    .eq("id", orderId);
  if (updateError) throw updateError;
  return next;
}
