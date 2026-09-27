import { signedDelta, type MovementEffectFields } from "./warehouseMovementSign";

export interface LedgerMove extends MovementEffectFields {
  item_id: string;
  performed_at: string;
  movement_type: string;
  quantity: number;
  reference_type?: string | null;
}

export interface LedgerItem {
  id: string;
  name: string;
  unit: string;
  warehouse_id: string;
  stock: number;
  unit_cost: number;
}

export interface LedgerRow {
  item_id: string;
  warehouse_id: string;
  name: string;
  unit: string;
  opening: number;
  purchaseIn: number;
  transferIn: number;
  returnsIn: number;
  salesOut: number;
  transferOut: number;
  wasteOut: number;
  manualOut: number;
  adjustment: number;
  closing: number;
  value: number;
}

const PURCHASE_TYPES = new Set(["in", "purchase_receipt", "stock_in", "finished_goods_receipt", "opening_balance"]);

export function movementBucket(m: Pick<LedgerMove, "movement_type" | "reference_type">): keyof Pick<LedgerRow, "purchaseIn" | "transferIn" | "returnsIn" | "salesOut" | "transferOut" | "wasteOut" | "manualOut" | "adjustment"> | null {
  const t = m.movement_type;
  if (t === "adjustment" || t === "adjust" || t === "reconciliation") return "adjustment";
  if (t === "sales_return" || t === "return") return "returnsIn";
  if (t === "transfer") return "transferOut";
  if (t === "sales_dispatch") return "salesOut";
  if (t === "waste_loss") return "wasteOut";
  if (t === "out" || t === "stock_out" || t === "production_consumption" || t === "packaging_consumption") return "manualOut";
  if (PURCHASE_TYPES.has(t)) {
    return m.reference_type === "warehouse_transfer" ? "transferIn" : "purchaseIn";
  }
  return null;
}

/** Opening comes from the live card minus every effect on or after the period start. */
export function buildDailyLedger(items: LedgerItem[], moves: LedgerMove[], fromIso: string, toIso: string): LedgerRow[] {
  const byItem = new Map<string, LedgerMove[]>();
  moves.forEach((m) => {
    const list = byItem.get(m.item_id) || [];
    list.push(m);
    byItem.set(m.item_id, list);
  });

  return items.map((item) => {
    const list = byItem.get(item.id) || [];
    let effectsFromStart = 0;
    let inRange = 0;
    const buckets = {
      purchaseIn: 0, transferIn: 0, returnsIn: 0,
      salesOut: 0, transferOut: 0, wasteOut: 0, manualOut: 0, adjustment: 0,
    };
    list.forEach((m) => {
      if (m.performed_at < fromIso) return;
      const delta = signedDelta(m.movement_type, m.quantity, m);
      effectsFromStart += delta;
      if (m.performed_at <= toIso) {
        inRange += delta;
        const bucket = movementBucket(m);
        if (bucket === "adjustment") buckets.adjustment += delta;
        else if (bucket) buckets[bucket] += Math.abs(delta);
      }
    });
    const opening = Number(item.stock || 0) - effectsFromStart;
    const closing = opening + inRange;
    return {
      item_id: item.id,
      warehouse_id: item.warehouse_id,
      name: item.name,
      unit: item.unit,
      opening,
      ...buckets,
      closing,
      value: closing * Number(item.unit_cost || 0),
    };
  }).filter((r) =>
    r.opening !== 0 || r.closing !== 0 || r.purchaseIn || r.transferIn || r.returnsIn
    || r.salesOut || r.transferOut || r.wasteOut || r.manualOut || r.adjustment
  );
}
