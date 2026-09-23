// Pure helpers for order total calculation.
// Used by the edit / add-box / swap-box flows so the preview and the DB write
// agree, and so item changes never rewrite the order's shipping.

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
 * A legacy synthetic order_item that bundled an offer's shipping inside the
 * offer. Real products are never shipping, even when product_id is missing.
 */
export const isOfferShippingLine = (it: OrderTotalItem): boolean => {
  const productId = it.product_id;
  const noProduct = productId === null || productId === undefined || productId === "";
  return (
    !!it.offer_name &&
    noProduct &&
    it.product_name?.trim() === SHIPPING_LINE_NAME
  );
};

export interface ComputedTotals {
  /** Sum of real (non-shipping) item lines. */
  subtotal: number;
  /** Sum of legacy "تكلفة الشحن" lines. Not added on top of a header fee. */
  includedShippingCost: number;
  /**
   * Shipping added to the customer total.
   * Header delivery_fee when it is set (or the employee just edited it).
   * Otherwise a legacy shipping line, so older orders do not lose الشحن.
   */
  shipping: number;
  /** True if any non-shipping offer item remains. */
  hasOfferItems: boolean;
  /** Final customer total = subtotal + shipping - discount. */
  total: number;
}

export interface ComputeOptions {
  discount?: number;
  /**
   * Order-header shipping (`orders.delivery_fee`). Independent of boxes.
   * A non-zero value is kept as-is. Zero falls back to a legacy shipping
   * line unless `shippingEdited` is set.
   */
  extraDeliveryFee?: number;
  /**
   * The employee changed the shipping input. The typed value, including 0,
   * replaces any legacy line. Item edits must leave this false.
   */
  shippingEdited?: boolean;
}

export function resolveOrderShipping(
  headerDeliveryFee: number,
  lineShipping = 0,
  shippingEdited = false
): number {
  const header = Number(headerDeliveryFee);
  const safeHeader = Number.isFinite(header) ? header : 0;
  if (shippingEdited) return safeHeader;
  if (safeHeader !== 0) return safeHeader;
  const line = Number(lineShipping);
  return Number.isFinite(line) ? line : 0;
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

  const discount = Number(opts.discount || 0);
  const headerProvided = opts.extraDeliveryFee !== undefined && opts.extraDeliveryFee !== null;
  const shipping = headerProvided || opts.shippingEdited
    ? resolveOrderShipping(Number(opts.extraDeliveryFee || 0), includedShippingCost, !!opts.shippingEdited)
    : includedShippingCost;
  const total = subtotal + shipping - discount;

  return { subtotal, includedShippingCost, shipping, hasOfferItems, total };
}

export interface OrderHeaderSnapshot {
  discount?: number;
  /** Stored `orders.delivery_fee` before the item edit. */
  deliveryFee?: number;
  extraCharge?: number;
  /** True only when the employee edited the shipping input. */
  shippingEdited?: boolean;
}

export interface OrderHeaderAfterItems {
  subtotal: number;
  /** Value to write back to `orders.delivery_fee`. */
  delivery_fee: number;
  shipping: number;
  total: number;
}

/**
 * Recalculate product totals after add / remove / swap / quantity change.
 * `delivery_fee` written back is the header value the caller passed
 * (the stored fee, or the value the employee just typed). It is never
 * replaced with a box's `shipping_cost`.
 */
export function orderHeaderAfterItemChange(
  items: OrderTotalItem[],
  header: OrderHeaderSnapshot = {}
): OrderHeaderAfterItems {
  const stored = Number(header.deliveryFee || 0);
  const safeStored = Number.isFinite(stored) ? stored : 0;
  const totals = computeOrderTotals(items, {
    discount: header.discount,
    extraDeliveryFee: safeStored,
    shippingEdited: !!header.shippingEdited,
  });
  const shipping = header.shippingEdited ? safeStored : totals.shipping;
  const extra = Number(header.extraCharge || 0);
  return {
    subtotal: totals.subtotal,
    delivery_fee: safeStored,
    shipping,
    total: totals.subtotal + shipping - Number(header.discount || 0) + extra,
  };
}
