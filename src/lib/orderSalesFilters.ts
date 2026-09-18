/**
 * Shared sales-net definition for order totals.
 *
 * Canonical rule (matches `get_dashboard_overview` SQL:
 *   `FROM orders WHERE status <> 'cancelled'`):
 * sales net / الصافي بدون الملغي = every order except status === "cancelled".
 *
 * Pending, processing, shipped, delivered, and any other non-cancelled status
 * stay in the net. Do not treat "returned" as cancelled unless the row's
 * status is actually "cancelled" (Zodex returns are stored as cancelled).
 *
 * Use this helper for KPI / "sales net" displays. Operational lists that
 * must show cancelled orders should keep them and label the surface in Arabic
 * with SALES_GROSS_INCLUDING_CANCELLED_LABEL_AR.
 */

export const CANCELLED_ORDER_STATUS = "cancelled" as const;

/** Statuses excluded from sales-net totals. Single source of truth. */
export const CANCELLED_ORDER_STATUSES: readonly string[] = [CANCELLED_ORDER_STATUS];

/** Arabic label for GM sales-net KPIs. */
export const SALES_NET_LABEL_AR = "الصافي بدون الملغي";

/** Arabic label when a surface intentionally includes cancelled orders. */
export const SALES_GROSS_INCLUDING_CANCELLED_LABEL_AR = "شامل الملغي";

/**
 * Period label for all-time / lifetime totals (get_dashboard_overview.total).
 * Use this whenever the number is not today/month/year, so it is not
 * compared with مبيعات الشهر as if they were the same window.
 */
export const SALES_NET_ALL_TIME_LABEL_AR = "منذ البداية";

export type SalesNetKpiPeriod = "today" | "month" | "year" | "all_time";

/** Arabic title for a sales-net KPI, including period + net definition. */
export function salesNetKpiTitleAr(period: SalesNetKpiPeriod): string {
  const net = SALES_NET_LABEL_AR;
  switch (period) {
    case "today":
      return `مبيعات اليوم (${net})`;
    case "month":
      return `مبيعات الشهر (${net})`;
    case "year":
      return `مبيعات السنة (${net})`;
    case "all_time":
      return `إجمالي المبيعات منذ البداية (${net})`;
  }
}

export function isCancelledOrderStatus(status: string | null | undefined): boolean {
  return (status || "").trim().toLowerCase() === CANCELLED_ORDER_STATUS;
}

export function isSalesNetOrder<T extends { status?: string | null }>(order: T): boolean {
  return !isCancelledOrderStatus(order.status);
}

export function filterSalesNetOrders<T extends { status?: string | null }>(orders: readonly T[]): T[] {
  return orders.filter(isSalesNetOrder);
}

export interface SalesNetTotals {
  orderCount: number;
  sales: number;
  cancelledCount: number;
  cancelledSales: number;
  grossOrderCount: number;
  grossSales: number;
}

export function sumSalesNet<T extends { status?: string | null; total?: number | string | null }>(
  orders: readonly T[],
): SalesNetTotals {
  let orderCount = 0;
  let sales = 0;
  let cancelledCount = 0;
  let cancelledSales = 0;
  for (const o of orders) {
    const total = Number(o.total || 0);
    if (isCancelledOrderStatus(o.status)) {
      cancelledCount += 1;
      cancelledSales += total;
    } else {
      orderCount += 1;
      sales += total;
    }
  }
  return {
    orderCount,
    sales,
    cancelledCount,
    cancelledSales,
    grossOrderCount: orderCount + cancelledCount,
    grossSales: sales + cancelledSales,
  };
}

/**
 * Apply the default sales-net filter on a Supabase/PostgREST query.
 * `statusColumn` is `status` for `orders`, or `orders.status` on inner joins.
 */
export function applySalesNetFilter<Q>(
  query: Q,
  statusColumn = "status",
): Q {
  return (query as { neq: (column: string, value: string) => Q }).neq(
    statusColumn,
    CANCELLED_ORDER_STATUS,
  );
}
