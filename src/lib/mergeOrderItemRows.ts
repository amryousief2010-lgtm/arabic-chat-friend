// Group cart lines into order_items rows at save time.
//
// Choice:
// - Different offers never collapse, even when they share a product.
//   Identity is offer_name plus offer_box_id (empty for a non-offer line).
// - Gift and paid stay apart.
// - Different unit prices never average together.
// - Lines that match on all of the above still merge. That keeps the
//   existing half-kg behavior: two نصف كيلو packets of the same product,
//   at the same full-kg price, inside the same offer (or both non-offer),
//   become one kilogram line. Adding the same offer twice is already
//   summed in the cart; if two matching rows still reach save, they merge
//   the same way instead of averaging a foreign offer's price.

export interface MergeableOrderItem {
  order_id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  is_half_kg: boolean;
  is_gift: boolean;
  offer_name: string | null;
  /** Distinguishes two boxes that happen to share a name. Not stored on order_items. */
  offer_box_id?: string | null;
}

export interface SavedOrderItem {
  order_id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  is_half_kg: boolean;
  is_gift: boolean;
  offer_name: string | null;
}

const priceKey = (price: number) => {
  const n = Number(price);
  if (!Number.isFinite(n)) return "0";
  return String(Math.round(n * 10000) / 10000);
};

export const orderItemMergeKey = (row: MergeableOrderItem) =>
  JSON.stringify([
    row.product_id,
    row.is_gift ? "gift" : "paid",
    row.offer_name ?? "",
    row.offer_box_id ?? "",
    priceKey(row.unit_price),
  ]);

const toSaved = (row: MergeableOrderItem): SavedOrderItem => ({
  order_id: row.order_id,
  product_id: row.product_id,
  product_name: row.product_name,
  quantity: row.quantity,
  unit_price: row.unit_price,
  total_price: row.total_price,
  is_half_kg: row.is_half_kg,
  is_gift: row.is_gift,
  offer_name: row.offer_name,
});

export const mergeOrderItemRows = (rows: MergeableOrderItem[]): SavedOrderItem[] => {
  const grouped = new Map<string, MergeableOrderItem[]>();
  for (const row of rows) {
    const key = orderItemMergeKey(row);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(row);
    else grouped.set(key, [row]);
  }

  return Array.from(grouped.values()).map((arr) => {
    if (arr.length === 1) return toSaved(arr[0]);

    let totalQty = 0;
    let totalPrice = 0;
    let anyHalf = false;
    for (const row of arr) {
      totalQty += row.quantity;
      totalPrice += row.total_price;
      if (row.is_half_kg) anyHalf = true;
    }

    return {
      order_id: arr[0].order_id,
      product_id: arr[0].product_id,
      product_name: arr[0].product_name,
      quantity: totalQty,
      unit_price: totalQty > 0 ? Math.round((totalPrice / totalQty) * 10000) / 10000 : 0,
      total_price: totalPrice,
      is_half_kg: anyHalf && arr.every((row) => row.is_half_kg),
      is_gift: arr[0].is_gift,
      offer_name: arr[0].offer_name,
    };
  });
};
