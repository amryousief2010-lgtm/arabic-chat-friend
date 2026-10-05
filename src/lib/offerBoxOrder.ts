import { isOfferShippingLine, resolveOrderShipping } from "@/lib/orderTotals";

/**
 * Box shipping lives inside the named box price.
 * `orders.subtotal` stays the product lines only.
 * `orders.delivery_fee` is the included shipping (or a manual replacement).
 * `orders.total` adds that fee once: subtotal − discount + extra + fee.
 */

export interface OfferOrderLine {
  product_id?: string | null;
  product_name?: string;
  offer_name?: string | null;
  quantity: number;
  unit_price: number;
  is_gift?: boolean;
}

export interface OfferBoxCount {
  name: string;
  quantity: number;
  shipping_cost?: number | null;
}

export interface OfferOrderQuote {
  subtotal: number;
  /** Shipping implied by the boxes actually on the order. */
  includedShipping: number;
  /** Value stored in orders.delivery_fee. */
  delivery_fee: number;
  /** Customer payable. COD and sales targets read this, not total + fee. */
  total: number;
}

export interface OfferInstance {
  offer_name: string;
  quantity: number;
  offer_box_id?: string | null;
}

const finite = (value: number) => (Number.isFinite(value) ? value : 0);

export function includedShippingForInstances(
  instances: OfferInstance[],
  shippingByName: Record<string, number | null | undefined>,
): number {
  return includedShippingFromBoxes(
    instances.map((row) => ({
      name: row.offer_name,
      quantity: row.quantity,
      shipping_cost: shippingByName[row.offer_name.trim()] ?? null,
    })),
  );
}

export function includedShippingFromBoxes(boxes: OfferBoxCount[]): number {
  return boxes.reduce((sum, box) => {
    const ship = Number(box.shipping_cost || 0);
    const qty = Number(box.quantity || 0);
    if (!(qty > 0) || !Number.isFinite(ship) || ship === 0) return sum;
    return sum + ship * qty;
  }, 0);
}

export function quoteOfferOrder(args: {
  lines: OfferOrderLine[];
  boxes: OfferBoxCount[];
  discount?: number;
  extraCharge?: number;
  /** When set, replaces included shipping. It is not added on top of it. */
  manualShipping?: number | null;
}): OfferOrderQuote {
  let subtotal = 0;
  for (const line of args.lines) {
    if (line.is_gift) continue;
    if (
      isOfferShippingLine({
        product_id: line.product_id,
        product_name: line.product_name,
        offer_name: line.offer_name,
        quantity: line.quantity,
        unit_price: line.unit_price,
      })
    ) {
      continue;
    }
    subtotal += Number(line.quantity || 0) * Number(line.unit_price || 0);
  }
  const includedShipping = includedShippingFromBoxes(args.boxes);
  const delivery_fee =
    args.manualShipping == null ? includedShipping : finite(Number(args.manualShipping));
  const total =
    subtotal - finite(Number(args.discount || 0)) + finite(Number(args.extraCharge || 0)) + delivery_fee;
  return { subtotal, includedShipping, delivery_fee, total };
}

/** Customer payable is the stored total. Do not add delivery_fee again. */
export function customerPayable(quote: OfferOrderQuote): number {
  return quote.total;
}

export function instancesAfterAddingBox(
  existing: OfferInstance[],
  box: { offer_name: string; offer_box_id?: string | null },
  options: { priorProductLines?: boolean } = {},
): OfferInstance[] {
  const name = box.offer_name.trim();
  const found = existing.find((row) => row.offer_name.trim() === name);
  if (found) {
    return existing.map((row) =>
      row.offer_name.trim() === name
        ? {
            ...row,
            quantity: Number(row.quantity || 0) + 1,
            offer_box_id: box.offer_box_id ?? row.offer_box_id ?? null,
          }
        : row,
    );
  }
  return [
    ...existing,
    {
      offer_name: name,
      quantity: options.priorProductLines ? 2 : 1,
      offer_box_id: box.offer_box_id ?? null,
    },
  ];
}

export function instancesAfterRemovingOne(existing: OfferInstance[], offerName: string): OfferInstance[] {
  const name = offerName.trim();
  return existing.flatMap((row) => {
    if (row.offer_name.trim() !== name) return [row];
    const next = Number(row.quantity || 0) - 1;
    if (next <= 0) return [];
    return [{ ...row, quantity: next }];
  });
}

export function instancesAfterSwap(
  existing: OfferInstance[],
  oldName: string,
  nextBox: { offer_name: string; offer_box_id?: string | null },
): OfferInstance[] {
  const without = existing.filter((row) => row.offer_name.trim() !== oldName.trim());
  return instancesAfterAddingBox(without, nextBox);
}

export function liveOfferNames(
  lines: Array<{
    offer_name?: string | null;
    product_id?: string | null;
    product_name?: string;
    quantity?: number;
    unit_price?: number;
    _deleted?: boolean;
  }>,
): string[] {
  const names = new Set<string>();
  for (const line of lines) {
    if (line._deleted || !line.offer_name) continue;
    const name = line.offer_name.trim();
    if (!name) continue;
    if (
      isOfferShippingLine({
        product_id: line.product_id,
        product_name: line.product_name,
        offer_name: name,
        quantity: Number(line.quantity || 0),
        unit_price: Number(line.unit_price || 0),
      })
    ) {
      continue;
    }
    names.add(name);
  }
  return [...names];
}

/**
 * Price edits and «بدون عرض» keep the header fee.
 * A box name that disappeared is repriced from the boxes still on the order.
 * A typed shipping value replaces that fee.
 */
export function deliveryFeeForItemEdit(args: {
  shippingTouched: boolean;
  typedFee: number;
  previousFee: number;
  legacyLineShipping?: number;
  previousOfferNames: string[];
  nextOfferNames: string[];
  remainingBoxes: OfferBoxCount[];
}): number {
  if (args.shippingTouched) return finite(Number(args.typedFee));
  const prev = new Set(args.previousOfferNames.map((name) => name.trim()).filter(Boolean));
  const next = new Set(args.nextOfferNames.map((name) => name.trim()).filter(Boolean));
  const disappeared = [...prev].some((name) => !next.has(name));
  if (disappeared) return Math.max(0, includedShippingFromBoxes(args.remainingBoxes));
  return resolveOrderShipping(args.previousFee, args.legacyLineShipping ?? 0, false);
}

export function buildOfferInstanceRows(
  entries: Array<{ offerBoxId: string; offerName: string; quantity: number }>,
): Array<{ offer_box_id: string; offer_name: string; quantity: number }> {
  const grouped = new Map<string, { offer_box_id: string; offer_name: string; quantity: number }>();
  for (const entry of entries) {
    const offer_name = (entry.offerName || "عرض").trim() || "عرض";
    const quantity = Math.max(1, Number(entry.quantity || 1));
    const prev = grouped.get(offer_name);
    if (prev) {
      prev.quantity += quantity;
      continue;
    }
    grouped.set(offer_name, {
      offer_box_id: entry.offerBoxId,
      offer_name,
      quantity,
    });
  }
  return [...grouped.values()];
}

/** Same role gate as sync_order_offer_instances. RLS policies are unchanged. */
export const OFFER_INSTANCE_WRITER_ROLES = [
  "general_manager",
  "executive_manager",
  "sales_manager",
  "shipping_company",
  "sales_moderator",
] as const;

export const MARIAM_USER_ID = "ff165c36-6390-4700-a880-e3894762693b";
export const ABDELMONEM_USER_ID = "c47d1804-1423-4f33-81fa-294a34ed7a16";

export function canRecordOfferInstances(input: { userId: string | null; role: string | null }): boolean {
  if (!input.userId || !input.role) return false;
  return (OFFER_INSTANCE_WRITER_ROLES as readonly string[]).includes(input.role);
}
