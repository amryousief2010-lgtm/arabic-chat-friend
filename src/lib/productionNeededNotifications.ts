/**
 * Mirrors `notify_production_needed` + order-resolve mark-read.
 * SQL remains the source of truth; these helpers keep the rules testable.
 */

export const PRODUCTION_NEEDED_TYPE = "production_needed";

export function isUnreadProductionNeeded(n: { type: string; is_read: boolean }): boolean {
  return n.type === PRODUCTION_NEEDED_TYPE && !n.is_read;
}

/** Order statuses that mean the manufacturing alert is no longer actionable. */
export const PRODUCTION_ALERT_RESOLVED_STATUSES = new Set([
  "delivered",
  "cancelled",
  "returned",
]);

export function quantityExceedsStock(quantity: number, stock: number | null | undefined): boolean {
  if (stock == null || Number.isNaN(stock)) return false;
  // Postgres `NEW.quantity::int` truncates toward zero.
  return Math.trunc(quantity) > stock;
}

export function shouldInsertProductionNeeded(args: {
  productId: string | null | undefined;
  quantity: number;
  stock: number | null | undefined;
  existingUnreadForOrder: boolean;
}): boolean {
  if (!args.productId) return false;
  if (args.existingUnreadForOrder) return false;
  return quantityExceedsStock(args.quantity, args.stock);
}

export function shouldMarkProductionNeededRead(newStatus: string, oldStatus: string): boolean {
  return newStatus !== oldStatus && PRODUCTION_ALERT_RESOLVED_STATUSES.has(newStatus);
}

/** Keep the newest unread production_needed row per order; the rest are duplicates. */
export function duplicateProductionNeededIds(
  rows: { id: string; order_id: string | null; created_at: string }[],
): string[] {
  const newest = new Map<string, { id: string; created_at: string }>();
  const dupes: string[] = [];
  const sorted = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const row of sorted) {
    if (!row.order_id) continue;
    const prev = newest.get(row.order_id);
    if (!prev) {
      newest.set(row.order_id, { id: row.id, created_at: row.created_at });
      continue;
    }
    if (row.created_at >= prev.created_at) {
      dupes.push(prev.id);
      newest.set(row.order_id, { id: row.id, created_at: row.created_at });
    } else {
      dupes.push(row.id);
    }
  }
  return dupes;
}
