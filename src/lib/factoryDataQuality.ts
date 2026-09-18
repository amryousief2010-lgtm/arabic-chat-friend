// Factory "جودة بيانات" alerts.
// Count is a CURRENT inventory snapshot (meat + feed modules only).
// It does NOT follow the date filter on FactoryFilters — empty-month
// production does not clear these cards. That is expected, not a hang.

export const FACTORY_INVENTORY_MODULES = ["meat", "feed"] as const;
export type FactoryInventoryModule = (typeof FACTORY_INVENTORY_MODULES)[number];

export type FactoryDataQualityKind =
  | "zero_cost"
  | "negative_stock"
  | "missing_barcode"
  | "invoice_review";

export interface FactoryInventoryItem {
  item_code?: string | null;
  name?: string | null;
  sku?: string | null;
  stock?: number | null;
  unit_cost?: number | null;
  module?: string | null;
}

export interface FactoryDataQualityRow {
  type: FactoryDataQualityKind;
  item_code: string;
  item_name: string;
  value: string;
  /** True for live item issues. False for the preserved Invoice 164 sentinel. */
  actionable: boolean;
}

export const FACTORY_DATA_QUALITY_LABELS: Record<FactoryDataQualityKind, string> = {
  zero_cost: "تكلفة صفرية ومخزون موجود",
  negative_stock: "مخزون بالسالب",
  missing_barcode: "بدون باركود",
  invoice_review: "فاتورة 164 محفوظة للمراجعة (ليست صنف مخزون)",
};

export function isFactoryInventoryModule(module?: string | null): boolean {
  return module === "meat" || module === "feed";
}

export function isZeroCostWithStock(item: FactoryInventoryItem): boolean {
  return Number(item.unit_cost) === 0 && Number(item.stock) > 0;
}

export function factoryItemsOfModule(
  items: FactoryInventoryItem[],
  module?: FactoryInventoryModule,
): FactoryInventoryItem[] {
  return items.filter((i) => {
    if (!isFactoryInventoryModule(i.module)) return false;
    if (module && i.module !== module) return false;
    return true;
  });
}

/** KPI used on Factory Overview (32) and Feed dashboard (9). Snapshot, not period. */
export function countZeroCostWithStock(
  items: FactoryInventoryItem[],
  module?: FactoryInventoryModule,
): number {
  return factoryItemsOfModule(items, module).filter(isZeroCostWithStock).length;
}

export function zeroCostSplit(items: FactoryInventoryItem[]): { meat: number; feed: number; total: number } {
  const meat = countZeroCostWithStock(items, "meat");
  const feed = countZeroCostWithStock(items, "feed");
  return { meat, feed, total: meat + feed };
}

const INVOICE_164_SENTINEL: FactoryDataQualityRow = {
  type: "invoice_review",
  item_code: "—",
  item_name: "Invoice 164",
  value: "needs_review (preserved) — ليست عطل كود وليست صنف مخزون",
  actionable: false,
};

/**
 * Pending-review table rows. One item can appear more than once if it has
 * several issue types (zero cost AND missing barcode) — that is not double
 * counting of the overview KPI, which only uses zero-cost+stock.
 *
 * Invoice 164 is appended as a documented sentinel and is NOT part of the KPI.
 */
export function buildFactoryPendingReviewRows(
  items: FactoryInventoryItem[],
  opts?: { includeInvoice164Sentinel?: boolean },
): FactoryDataQualityRow[] {
  const list: FactoryDataQualityRow[] = [];
  for (const i of factoryItemsOfModule(items)) {
    const code = i.item_code || "—";
    const name = i.name || "—";
    if (isZeroCostWithStock(i)) {
      list.push({ type: "zero_cost", item_code: code, item_name: name, value: `stock=${i.stock}`, actionable: true });
    }
    if (Number(i.stock) < 0) {
      list.push({ type: "negative_stock", item_code: code, item_name: name, value: String(i.stock), actionable: true });
    }
    if (!i.sku) {
      list.push({ type: "missing_barcode", item_code: code, item_name: name, value: "—", actionable: true });
    }
  }
  if (opts?.includeInvoice164Sentinel !== false) list.push(INVOICE_164_SENTINEL);
  return list;
}
