// Pure helpers for order total calculation.
// Used by EditOrderItemsDialog so the UI preview and the DB write
// always agree on the same numbers.

export interface OrderTotalItem {
  product_id?: string | null;
  product_name?: string;
  offer_name?: string | null;
  quantity: number;
  unit_price: number;
  _deleted?: boolean;
}

export const SHIPPING_LINE_NAME = "تكلفة الشحن";

/**
 * A "shipping line" is the synthetic order_item that AddOfferDialog
 * inserts to bundle an offer's shipping cost inside the offer.
 * It is identified by: belongs to an offer AND has no product_id.
 */
export const isOfferShippingLine = (it: OrderTotalItem): boolean => {
  return (
    !!it.offer_name &&
    (it.product_id === null || it.product_id === undefined) &&
    (it.product_name?.trim() === SHIPPING_LINE_NAME || true)
  );
};

export interface ComputedTotals {
  /** Sum of real (non-shipping) item lines. */
  subtotal: number;
  /** Shipping cost bundled inside the offer (sum of shipping lines). */
  includedShippingCost: number;
  /** True if any non-shipping offer item remains. */
  hasOfferItems: boolean;
  /** Final customer total = subtotal + includedShippingCost + extraDeliveryFee - discount. */
  total: number;
}

export interface ComputeOptions {
  discount?: number;
  /** Extra delivery fee for non-offer orders (offer orders ignore this — shipping is in items). */
  extraDeliveryFee?: number;
}

export function computeOrderTotals(
  items: OrderTotalItem[],
  opts: ComputeOptions = {}
): ComputedTotals {
  const live = items.filter((it) => !it._deleted);

  let subtotal = 0;
  let includedShippingCost = 0;
  let hasOfferItems = false;

  for (const it of live) {
    const lineTotal = Number(it.quantity || 0) * Number(it.unit_price || 0);
    if (isOfferShippingLine(it)) {
      includedShippingCost += lineTotal;
    } else {
      subtotal += lineTotal;
      if (it.offer_name) hasOfferItems = true;
    }
  }

  // If no real offer item remains, drop the bundled shipping entirely.
  if (!hasOfferItems) includedShippingCost = 0;

  const discount = Number(opts.discount || 0);
  const extraDelivery = hasOfferItems ? 0 : Number(opts.extraDeliveryFee || 0);
  const total = subtotal + includedShippingCost + extraDelivery - discount;

  return { subtotal, includedShippingCost, hasOfferItems, total };
}
