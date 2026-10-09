import { isOfferShippingLine } from "@/lib/orderTotals";

/**
 * Identical offer boxes are one order_offer_instances row
 * (unique per order + name) with quantity N, and order_items are merged
 * by offer name. The replace screen used to group on that name, so two
 * copies of the same box were one selectable row.
 *
 * A copy is either:
 * - virtual: inst:{instanceId}:{copyIndex} — orders that were never split;
 *   quantities are divided evenly and any remainder stays on the lower indexes;
 * - materialized: copy:{copyId} — a row in order_box_copies after a change;
 * - plain: every non-offer line, still one group;
 * - orphan: offer lines whose name has no instance row.
 *
 * The price shown is the sum of that copy's stored product lines.
 * Shipping stays on the order header.
 */

export const BOX_QTY_SCALE = 10000;

export interface BoxLine {
  id: string;
  product_id?: string | null;
  product_name: string;
  quantity: number;
  unit_price: number;
  offer_name?: string | null;
  offer_copy_id?: string | null;
  is_gift?: boolean;
}

export interface OfferInstanceRow {
  id: string;
  offer_name: string;
  quantity: number;
  offer_box_id?: string | null;
}

export interface StoredBoxCopy {
  id: string;
  offer_name: string;
  copy_index: number;
  offer_box_id?: string | null;
  active: boolean;
  legacy_instance_id?: string | null;
}

export interface ListedLine {
  id: string;
  product_id: string | null;
  product_name: string;
  quantity: number;
  unit_price: number;
  is_gift: boolean;
}

export type BoxCopyKind = "virtual" | "materialized" | "plain" | "orphan";

export interface ListedBoxCopy {
  key: string;
  kind: BoxCopyKind;
  instanceId: string | null;
  copyId: string | null;
  copyIndex: number;
  offerName: string | null;
  offerBoxId: string | null;
  recordedPrice: number;
  lines: ListedLine[];
}

export type BoxCopyOperation = "replace_box" | "replace_products" | "delete";

export interface ReplacementLine {
  product_id?: string | null;
  product_name: string;
  quantity: number;
  unit_price: number;
}

const roundMoney = (value: number) => Math.round((Number(value) || 0) * 100) / 100;

const lineTotal = (line: { quantity: number; unit_price: number }) =>
  Number(line.quantity || 0) * Number(line.unit_price || 0);

export function splitQuantity(total: number, copies: number, copyIndex: number): number {
  if (!Number.isFinite(total) || copies <= 0 || copyIndex < 1 || copyIndex > copies) return 0;
  const milli = Math.round(total * BOX_QTY_SCALE);
  const base = Math.trunc(milli / copies);
  const remainder = milli % copies;
  const extra = copyIndex <= remainder ? 1 : 0;
  return (base + extra) / BOX_QTY_SCALE;
}

const toListedLine = (line: BoxLine, quantity = Number(line.quantity || 0)): ListedLine => ({
  id: line.id,
  product_id: line.product_id ?? null,
  product_name: line.product_name,
  quantity,
  unit_price: Number(line.unit_price || 0),
  is_gift: !!line.is_gift,
});

const sumLines = (lines: Array<{ quantity: number; unit_price: number }>) =>
  roundMoney(lines.reduce((sum, line) => sum + lineTotal(line), 0));

const isRealLine = (line: BoxLine) =>
  !isOfferShippingLine({
    product_id: line.product_id,
    product_name: line.product_name,
    offer_name: line.offer_name,
    quantity: line.quantity,
    unit_price: line.unit_price,
  });

function missingIndexes(used: Set<number>, count: number): number[] {
  const found: number[] = [];
  let cursor = 1;
  while (found.length < count) {
    if (!used.has(cursor)) found.push(cursor);
    cursor += 1;
    if (cursor > 100000) break;
  }
  return found;
}

export function listBoxCopies(input: {
  instances: OfferInstanceRow[];
  copies?: StoredBoxCopy[];
  items: BoxLine[];
}): ListedBoxCopy[] {
  const items = input.items.filter(isRealLine);
  const stored = input.copies ?? [];
  const result: ListedBoxCopy[] = [];
  const seenNames = new Set<string>();

  for (const instance of input.instances) {
    const name = instance.offer_name.trim();
    if (!name || seenNames.has(name)) continue;
    seenNames.add(name);

    const active = stored
      .filter((copy) => copy.active && copy.offer_name.trim() === name)
      .sort((a, b) => a.copy_index - b.copy_index);
    const activeIds = new Set(active.map((copy) => copy.id));
    const named = items.filter((line) => (line.offer_name || "").trim() === name);
    const unlinked = named.filter((line) => !line.offer_copy_id || !activeIds.has(line.offer_copy_id));

    for (const copy of active) {
      const lines = named
        .filter((line) => line.offer_copy_id === copy.id)
        .map((line) => toListedLine(line));
      result.push({
        key: `copy:${copy.id}`,
        kind: "materialized",
        instanceId: instance.id,
        copyId: copy.id,
        copyIndex: copy.copy_index,
        offerName: name,
        offerBoxId: copy.offer_box_id ?? instance.offer_box_id ?? null,
        recordedPrice: sumLines(lines),
        lines,
      });
    }

    const slots = Math.max(0, Number(instance.quantity || 0) - active.length);
    const used = new Set(active.map((copy) => copy.copy_index));
    const indexes = missingIndexes(used, slots);
    if (slots === 0 && unlinked.length > 0) {
      indexes.push(...missingIndexes(new Set([...used, ...indexes]), 1));
    }

    indexes.forEach((copyIndex, slot) => {
      const lines = unlinked
        .map((line) => toListedLine(line, splitQuantity(Number(line.quantity || 0), indexes.length, slot + 1)))
        .filter((line) => line.quantity > 0);
      result.push({
        key: `inst:${instance.id}:${copyIndex}`,
        kind: "virtual",
        instanceId: instance.id,
        copyId: null,
        copyIndex,
        offerName: name,
        offerBoxId: instance.offer_box_id ?? null,
        recordedPrice: sumLines(lines),
        lines,
      });
    });
  }

  const orphanNames = new Set<string>();
  for (const line of items) {
    const name = (line.offer_name || "").trim();
    if (name && !seenNames.has(name)) orphanNames.add(name);
  }
  for (const name of orphanNames) {
    const lines = items
      .filter((line) => (line.offer_name || "").trim() === name)
      .map((line) => toListedLine(line));
    result.push({
      key: `orphan:${name}`,
      kind: "orphan",
      instanceId: null,
      copyId: null,
      copyIndex: 1,
      offerName: name,
      offerBoxId: null,
      recordedPrice: sumLines(lines),
      lines,
    });
  }

  const plain = items.filter((line) => !(line.offer_name || "").trim()).map((line) => toListedLine(line));
  if (plain.length > 0) {
    result.push({
      key: "plain",
      kind: "plain",
      instanceId: null,
      copyId: null,
      copyIndex: 1,
      offerName: null,
      offerBoxId: null,
      recordedPrice: sumLines(plain),
      lines: plain,
    });
  }

  return result;
}

/** Shipping inside each box. N copies contribute N times that box's shipping, never twice. */
export function includedShippingForCopies(
  copies: Array<{ offerName: string | null }>,
  shippingByName: Record<string, number | null | undefined>,
): number {
  return copies.reduce((sum, copy) => {
    if (!copy.offerName) return sum;
    const ship = Number(shippingByName[copy.offerName.trim()] ?? 0);
    if (!Number.isFinite(ship) || ship === 0) return sum;
    return sum + ship;
  }, 0);
}

/**
 * A fee that already matches the boxes' included shipping moves with the boxes.
 * A hand-typed difference is kept on top of the new included sum.
 * Offers with no shipping add nothing. Loose products do not invent shipping.
 */
export function shippingAfterCopyChange(
  previousFee: number,
  previousIncluded: number,
  nextIncluded: number,
): number {
  const fee = Number.isFinite(Number(previousFee)) ? Number(previousFee) : 0;
  const previous = Number.isFinite(Number(previousIncluded)) ? Number(previousIncluded) : 0;
  const next = Number.isFinite(Number(nextIncluded)) ? Number(nextIncluded) : 0;
  const manual = fee - previous;
  const raw = Math.abs(manual) < 0.01 ? next : fee + (next - previous);
  return Math.max(0, roundMoney(raw));
}

export interface CopyChangePreview {
  removedLines: ListedLine[];
  addedLines: ReplacementLine[];
  removedPrice: number;
  addedPrice: number;
  priceDelta: number;
  previousIncludedShipping: number;
  nextIncludedShipping: number;
  deliveryFee: number;
  newSubtotal: number;
  newTotal: number;
  siblingKeys: string[];
}

export function previewBoxCopyChange(args: {
  copies: ListedBoxCopy[];
  targetKey: string;
  operation: BoxCopyOperation;
  replacementLines?: ReplacementLine[];
  replacementOfferName?: string | null;
  shippingByName: Record<string, number | null | undefined>;
  subtotal: number;
  discount?: number;
  extraCharge?: number;
  deliveryFee: number;
}): CopyChangePreview {
  const target = args.copies.find((copy) => copy.key === args.targetKey);
  if (!target) {
    throw new Error("النسخة غير موجودة");
  }
  const addedLines =
    args.operation === "delete" ? [] : (args.replacementLines ?? []).filter((line) => Number(line.quantity) > 0);
  const removedPrice = sumLines(target.lines);
  const addedPrice = roundMoney(addedLines.reduce((sum, line) => sum + lineTotal(line), 0));
  const remaining = args.copies.filter((copy) => copy.key !== args.targetKey);
  const nextBoxes = remaining.map((copy) => ({ offerName: copy.offerName }));
  if (args.operation === "replace_box" && args.replacementOfferName?.trim()) {
    nextBoxes.push({ offerName: args.replacementOfferName.trim() });
  }
  const previousIncludedShipping = includedShippingForCopies(
    args.copies.filter((copy) => copy.kind !== "plain"),
    args.shippingByName,
  );
  const nextIncludedShipping = includedShippingForCopies(
    nextBoxes.filter((copy) => copy.offerName),
    args.shippingByName,
  );
  const deliveryFee = shippingAfterCopyChange(args.deliveryFee, previousIncludedShipping, nextIncludedShipping);
  const newSubtotal = roundMoney(Number(args.subtotal || 0) - removedPrice + addedPrice);
  const newTotal = roundMoney(
    newSubtotal - Number(args.discount || 0) + Number(args.extraCharge || 0) + deliveryFee,
  );
  return {
    removedLines: target.lines,
    addedLines,
    removedPrice,
    addedPrice,
    priceDelta: roundMoney(addedPrice - removedPrice),
    previousIncludedShipping,
    nextIncludedShipping,
    deliveryFee,
    newSubtotal,
    newTotal,
    siblingKeys: remaining.map((copy) => copy.key),
  };
}

/** Reservation change for the selected copy only. */
export function stockDelta(
  removed: Array<{ product_id?: string | null; quantity: number }>,
  added: Array<{ product_id?: string | null; quantity: number }>,
): Array<{ product_id: string; quantity: number }> {
  const totals = new Map<string, number>();
  for (const line of removed) {
    if (!line.product_id) continue;
    totals.set(line.product_id, (totals.get(line.product_id) || 0) - Number(line.quantity || 0));
  }
  for (const line of added) {
    if (!line.product_id) continue;
    totals.set(line.product_id, (totals.get(line.product_id) || 0) + Number(line.quantity || 0));
  }
  return [...totals.entries()]
    .filter(([, quantity]) => Math.abs(quantity) > 0.0000001)
    .map(([product_id, quantity]) => ({ product_id, quantity: Math.round(quantity * BOX_QTY_SCALE) / BOX_QTY_SCALE }));
}

export function orderProductSubtotal(items: BoxLine[]): number {
  return roundMoney(items.filter(isRealLine).reduce((sum, line) => sum + lineTotal(line), 0));
}

export const BOX_COPY_OPERATIONS: Array<{ id: BoxCopyOperation; label: string }> = [
  { id: "replace_box", label: "استبدال بوكس ببوكس آخر" },
  { id: "replace_products", label: "استبدال بوكس بمنتجات فردية" },
  { id: "delete", label: "حذف نهائي دون استبدال" },
];
