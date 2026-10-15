import { toCairoDateString } from "@/lib/cairoDate";

/**
 * Read-only Agouza replenishment ledger.
 *
 * Amr's sheet subtracted every October order from the 12 Oct count, including
 * orders dated before the count (already absent from the counted stock).
 * This report starts at the last approved stocktake and lets each order land
 * in one bucket according to its current status.
 *
 * balance = baseline + inbound from MAIN + unloaded returns − delivered − in delivery
 * replenishment = max(0, min level − balance)
 */

export const AGOUZA_NAME_MARK = "العجوزة";
export const MAIN_NAME_MARK = "الرئيسي";

/** Inbound transfers that have left MAIN and are not received yet. */
export const PENDING_RECEIPT_STATUSES = new Set([
  "pending_receipt",
  "partially_received",
  "sent",
  "needs_manager_review",
]);

const KG_UNITS = new Set(["كيلو", "كجم", "كغ", "كيلوجرام", "kg"]);

export function isKgUnit(unit: string | null | undefined): boolean {
  return KG_UNITS.has((unit || "").trim().toLowerCase());
}

/** Fold Arabic spelling so Zodex names meet coceg item names. */
export function normalizeItemName(raw: string | null | undefined): string {
  let s = (raw || "").trim();
  s = s.replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه");
  s = s.replace(/نعام/g, " ");
  s = s.replace(/ارز/g, "الرز");
  s = s.replace(/\s+/g, " ").trim();
  const aliases: Record<string, string> = {
    "لحم مشفي": "لحم قطع",
    "لحم صافي": "لحم قطع",
    "دبوس بالعضم": "دبوس بالعظم",
  };
  return aliases[s] || s;
}

export function roundQty(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 1000) / 1000;
}

export interface AgouzaItem {
  id: string;
  name: string;
  unit: string;
  productId: string | null;
  barcode: string | null;
  systemStock: number;
  lowStockThreshold: number;
}

export interface StockCountLine {
  itemId: string;
  countDate: string;
  actualQty: number;
  sessionNo: string;
}

export interface AgouzaOrderLine {
  orderId: string;
  orderNumber: string;
  status: string;
  stockStatus: string | null;
  createdAt: string;
  shippingBillNo: string | null;
  productId: string | null;
  productName: string;
  quantity: number;
  /** Unresolved row in order_stock_dispatch_failures. */
  unresolvedFailure: boolean;
}

export type InboundKind = "zodex_in" | "kg_fix" | "transfer" | "sales_return";

/**
 * October receipts from MAIN are not all `store_zodex_main_to_agouza`.
 * سند 212 (2 Oct) is `store_document` / transfer_in, notes «تحويل وارد رئيسي»,
 * and the plate-to-kg correction is a later `store_document_kg_fix` out.
 * Net inbound is the receipt minus that correction. The source warehouse
 * column on these rows is Agouza itself, so the note is what marks MAIN.
 */
export function inboundKind(row: {
  referenceType: string | null;
  movementType: string | null;
  notes?: string | null;
}): InboundKind | null {
  if (row.referenceType === "store_document_kg_fix") return "kg_fix";
  if (row.movementType !== "in") return null;
  if (row.referenceType === "store_zodex_main_to_agouza") return "zodex_in";
  if (row.referenceType === "store_document" && (row.notes || "").includes("وارد رئيسي")) return "zodex_in";
  return null;
}

export interface InboundMovement {
  itemId: string | null;
  itemName: string;
  quantity: number;
  performedAt: string;
  reference: string | null;
  kind: InboundKind;
  /** Set when the movement is a received warehouse_transfers document. */
  transferStatus?: string | null;
  sourceIsMain: boolean;
  /** order id for a sales return, used to avoid counting the order twice. */
  orderId?: string | null;
}

export interface PendingTransferAlert {
  transferNo: string | null;
  status: string;
  itemName: string;
  quantity: number;
  sentAt: string | null;
  sourceName: string;
}

export interface AgouzaReportInput {
  items: AgouzaItem[];
  counts: StockCountLine[];
  orders: AgouzaOrderLine[];
  movements: InboundMovement[];
  pendingTransfers: PendingTransferAlert[];
  /** Inclusive Cairo dates. */
  fromDate: string;
  toDate: string;
  /** Per-item override. Falls back to the item's low-stock threshold. */
  minLevels?: Record<string, number>;
}

export interface AgouzaRow {
  itemId: string;
  name: string;
  unit: string;
  inKg: boolean;
  countDate: string | null;
  baseline: number;
  inbound: number;
  returned: number;
  delivered: number;
  inDelivery: number;
  balance: number;
  systemStock: number;
  minLevel: number;
  replenishment: number;
  missingBarcode: boolean;
}

export interface DeductionAlert {
  orderId: string;
  orderNumber: string;
  shippingBillNo: string | null;
  stockStatus: string | null;
  createdAt: string;
  reason: string;
}

export interface UnmatchedLineAlert {
  orderNumber: string;
  productName: string;
  quantity: number;
  status: string;
}

export interface AgouzaReport {
  rows: AgouzaRow[];
  baselineDate: string | null;
  /** Orders skipped because their Cairo date is before the stocktake. */
  excludedBeforeCount: number;
  /** True when the chosen start is after the stocktake, so the gap is omitted. */
  gapAfterCount: boolean;
  effectiveFrom: string | null;
  alerts: {
    deductionFailures: DeductionAlert[];
    pendingTransfers: PendingTransferAlert[];
    missingBarcodes: { itemId: string; name: string }[];
    unmatchedLines: UnmatchedLineAlert[];
  };
}

export type OrderBucket = "delivered" | "in_delivery" | "returned" | "ignore";

/** One current status, one bucket. A cancel that never left stock is ignored. */
export function classifyOrder(status: string, stockStatus: string | null): OrderBucket {
  if (status === "delivered") return "delivered";
  if (status === "cancelled") return stockStatus === "returned" ? "returned" : "ignore";
  return "in_delivery";
}

export function deductionFailureReason(status: string, stockStatus: string | null, unresolvedFailure: boolean): string | null {
  if (status !== "delivered") return null;
  if (unresolvedFailure && stockStatus !== "dispatched") return "فشل الخصم مسجّل، والرصيد لم يُخصم";
  if (unresolvedFailure) return "فشل خصم ما زال مفتوحًا";
  if (stockStatus === "skipped_period_lock") return "الخصم تُرك بسبب قفل الفترة";
  if (stockStatus !== "dispatched") return "الأوردر مُسلّم بلا حركة خصم";
  return null;
}

function latestCount(counts: StockCountLine[], itemId: string, toDate: string): StockCountLine | null {
  let best: StockCountLine | null = null;
  for (const line of counts) {
    if (line.itemId !== itemId || line.countDate > toDate) continue;
    if (!best || line.countDate > best.countDate || (line.countDate === best.countDate && line.sessionNo > best.sessionNo)) {
      best = line;
    }
  }
  return best;
}

function inWindow(iso: string, fromDate: string, toDate: string, countDate: string): boolean {
  const day = toCairoDateString(iso);
  return day >= countDate && day >= fromDate && day <= toDate;
}

function orderInWindow(iso: string, fromDate: string, toDate: string, countDate: string): "in" | "before_count" | "out" {
  const day = toCairoDateString(iso);
  if (day < countDate) return "before_count";
  if (day < fromDate || day > toDate) return "out";
  return "in";
}

export function buildAgouzaStockReport(input: AgouzaReportInput): AgouzaReport {
  const minLevels = input.minLevels || {};
  const itemById = new Map(input.items.map((item) => [item.id, item]));
  const itemByProduct = new Map<string, string>();
  const itemByName = new Map<string, string>();
  for (const item of input.items) {
    if (item.productId && !itemByProduct.has(item.productId)) itemByProduct.set(item.productId, item.id);
    const key = normalizeItemName(item.name);
    if (key && !itemByName.has(key)) itemByName.set(key, item.id);
  }

  const resolveName = (itemId: string | null, itemName: string): string | null => {
    if (itemId && itemById.has(itemId)) return itemId;
    return itemByName.get(normalizeItemName(itemName)) || null;
  };

  const countDates = input.counts.map((c) => c.countDate).filter((d) => d <= input.toDate);
  const baselineDate = countDates.length ? countDates.reduce((a, b) => (a > b ? a : b)) : null;

  const totals = new Map<string, { inbound: number; returned: number; delivered: number; inDelivery: number }>();
  const ensure = (id: string) => {
    let row = totals.get(id);
    if (!row) {
      row = { inbound: 0, returned: 0, delivered: 0, inDelivery: 0 };
      totals.set(id, row);
    }
    return row;
  };

  const seenOrders = new Set<string>();
  let excludedBeforeCount = 0;
  const deductionFailures: DeductionAlert[] = [];
  const unmatchedLines: UnmatchedLineAlert[] = [];
  const returnedOrderIds = new Set<string>();

  for (const line of input.orders) {
    const itemId = (line.productId && itemByProduct.get(line.productId)) || itemByName.get(normalizeItemName(line.productName)) || null;
    const count = itemId ? latestCount(input.counts, itemId, input.toDate) : null;
    const countDate = count?.countDate || baselineDate;
    if (!countDate) continue;
    const where = orderInWindow(line.createdAt, input.fromDate, input.toDate, countDate);
    if (where === "before_count") {
      if (!seenOrders.has(line.orderId)) {
        seenOrders.add(line.orderId);
        excludedBeforeCount += 1;
      }
      continue;
    }
    if (where === "out") continue;

    const bucket = classifyOrder(line.status, line.stockStatus);
    if (bucket === "returned") returnedOrderIds.add(line.orderId);
    if (!itemId) {
      if (bucket !== "ignore" && line.quantity) {
        unmatchedLines.push({
          orderNumber: line.orderNumber,
          productName: line.productName,
          quantity: line.quantity,
          status: line.status,
        });
      }
    } else if (bucket !== "ignore") {
      const row = ensure(itemId);
      const qty = Number(line.quantity) || 0;
      if (bucket === "delivered") row.delivered += qty;
      else if (bucket === "in_delivery") row.inDelivery += qty;
      else row.returned += qty;
    }

    const reason = deductionFailureReason(line.status, line.stockStatus, line.unresolvedFailure);
    if (reason && !deductionFailures.some((alert) => alert.orderId === line.orderId)) {
      deductionFailures.push({
        orderId: line.orderId,
        orderNumber: line.orderNumber,
        shippingBillNo: line.shippingBillNo,
        stockStatus: line.stockStatus,
        createdAt: line.createdAt,
        reason,
      });
    }
  }

  const zodexRefs = new Set(
    input.movements.filter((m) => m.kind === "zodex_in" && m.reference).map((m) => m.reference as string),
  );

  for (const movement of input.movements) {
    if (movement.kind === "sales_return" && movement.orderId && returnedOrderIds.has(movement.orderId)) continue;
    if (movement.kind === "transfer" && movement.reference && zodexRefs.has(movement.reference)) continue;
    if (movement.kind === "transfer" && !movement.sourceIsMain) continue;
    if ((movement.kind === "zodex_in" || movement.kind === "transfer") && !movement.sourceIsMain) continue;
    const received = movement.kind !== "transfer" || movement.transferStatus === "received" || movement.transferStatus === "partially_received";
    if (!received) continue;

    const itemId = resolveName(movement.itemId, movement.itemName);
    if (!itemId) continue;
    const count = latestCount(input.counts, itemId, input.toDate);
    const countDate = count?.countDate || baselineDate;
    if (!countDate) continue;
    if (!inWindow(movement.performedAt, input.fromDate, input.toDate, countDate)) continue;

    const row = ensure(itemId);
    const qty = Number(movement.quantity) || 0;
    if (movement.kind === "kg_fix") row.inbound -= qty;
    else if (movement.kind === "sales_return") row.returned += qty;
    else row.inbound += qty;
  }

  const rows: AgouzaRow[] = input.items
    .map((item) => {
      const count = latestCount(input.counts, item.id, input.toDate);
      const sum = totals.get(item.id) || { inbound: 0, returned: 0, delivered: 0, inDelivery: 0 };
      const baseline = count ? Number(count.actualQty) || 0 : 0;
      const balance = baseline + sum.inbound + sum.returned - sum.delivered - sum.inDelivery;
      const configured = minLevels[item.id];
      const minLevel = Number.isFinite(configured as number) ? Number(configured) : Number(item.lowStockThreshold) || 0;
      return {
        itemId: item.id,
        name: item.name.trim(),
        unit: item.unit || "—",
        inKg: isKgUnit(item.unit),
        countDate: count?.countDate || null,
        baseline: roundQty(baseline),
        inbound: roundQty(sum.inbound),
        returned: roundQty(sum.returned),
        delivered: roundQty(sum.delivered),
        inDelivery: roundQty(sum.inDelivery),
        balance: roundQty(balance),
        systemStock: roundQty(Number(item.systemStock) || 0),
        minLevel: roundQty(minLevel),
        replenishment: roundQty(Math.max(0, minLevel - balance)),
        missingBarcode: !item.barcode || !item.barcode.trim(),
      };
    })
    .sort((a, b) => b.replenishment - a.replenishment || a.name.localeCompare(b.name, "ar"));

  const gapAfterCount = !!(baselineDate && input.fromDate > baselineDate);

  return {
    rows,
    baselineDate,
    excludedBeforeCount,
    gapAfterCount,
    effectiveFrom: baselineDate ? (input.fromDate > baselineDate ? input.fromDate : baselineDate) : input.fromDate,
    alerts: {
      deductionFailures,
      pendingTransfers: input.pendingTransfers,
      missingBarcodes: rows.filter((row) => row.missingBarcode).map((row) => ({ itemId: row.itemId, name: row.name })),
      unmatchedLines,
    },
  };
}
