/**
 * Dashboard sales KPIs from `get_dashboard_overview`.
 *
 * All four sales numbers use the same net rule as orderSalesFilters:
 *   SUM(orders.total) WHERE status <> 'cancelled'
 * Dates are Cairo calendar (`created_at AT TIME ZONE 'Africa/Cairo'`).
 *
 * | RPC field | Period                         | UI meaning                          |
 * |-----------|--------------------------------|-------------------------------------|
 * | today     | Cairo today                    | مبيعات اليوم                        |
 * | month     | Cairo month-to-date            | مبيعات الشهر                        |
 * | year      | Cairo year-to-date             | مبيعات السنة                        |
 * | total     | all-time (no date filter)      | إجمالي المبيعات منذ البداية         |
 *
 * `total` is therefore expected to be much larger than month/year. It is not
 * a second copy of the month card, not gross-including-cancelled, and not a
 * different currency — it is lifetime net.
 */

import {
  SALES_NET_ALL_TIME_LABEL_AR,
  SALES_NET_LABEL_AR,
  salesNetKpiTitleAr,
} from "@/lib/orderSalesFilters";

export {
  SALES_NET_ALL_TIME_LABEL_AR,
  SALES_NET_LABEL_AR,
  salesNetKpiTitleAr,
};

export interface DashboardOverviewBucket {
  sales: number;
  orders: number;
}

export interface DashboardOverview {
  today: DashboardOverviewBucket;
  month: DashboardOverviewBucket;
  year: DashboardOverviewBucket;
  total: DashboardOverviewBucket;
  avg_order_value: number;
  customers: number;
  low_stock: number;
  monthly?: Array<{ month: string; sales: number; orders: number }>;
  daily?: Array<{ date: string; sales: number; orders: number }>;
}

export interface DashboardSalesStats {
  /** All-time net (منذ البداية) — RPC `total.sales`. */
  totalSales: number;
  totalOrders: number;
  totalCustomers: number;
  /** All-time net AOV (total.sales / total.orders). */
  avgOrderValue: number;
  lowStockProducts: number;
  salesToday: number;
  ordersToday: number;
  salesMonth: number;
  ordersMonth: number;
  salesYear: number;
  ordersYear: number;
  monthlySeries: Array<{ month: string; sales: number; orders: number }>;
  dailySeries: Array<{ date: string; sales: number; orders: number }>;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Map the RPC JSON to dashboard cards. `totalSales` MUST come from
 * `overview.total`, never from month/year — that mix-up is what made
 * «إجمالي المبيعات» look like a 40M vs 838K bug.
 */
export function mapDashboardOverview(overview: DashboardOverview): DashboardSalesStats {
  return {
    totalSales: num(overview.total?.sales),
    totalOrders: num(overview.total?.orders),
    totalCustomers: num(overview.customers),
    avgOrderValue: num(overview.avg_order_value),
    lowStockProducts: num(overview.low_stock),
    salesToday: num(overview.today?.sales),
    ordersToday: num(overview.today?.orders),
    salesMonth: num(overview.month?.sales),
    ordersMonth: num(overview.month?.orders),
    salesYear: num(overview.year?.sales),
    ordersYear: num(overview.year?.orders),
    monthlySeries: overview.monthly || [],
    dailySeries: overview.daily || [],
  };
}

/** Full EGP amount for KPI cards so 40M is not compacted next to 838,335. */
export function formatSalesExact(value: number): string {
  return Math.round(num(value)).toLocaleString();
}

/** Compact axis/subtitle formatter (1.2M / 838K). Do not use on the lifetime card. */
export function formatSalesCompact(value: number): string {
  const v = num(value);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(0)}K`;
  return String(Math.round(v));
}

/** Subtitle under the lifetime sales card: year + month net, same definition. */
export function lifetimeSalesCardChange(stats: Pick<DashboardSalesStats, "salesYear" | "salesMonth" | "salesToday">): string {
  return `${SALES_NET_LABEL_AR} · السنة: ${formatSalesCompact(stats.salesYear)} | الشهر: ${formatSalesCompact(stats.salesMonth)} | اليوم: ${formatSalesCompact(stats.salesToday)}`;
}

export function lifetimeOrdersCardChange(stats: Pick<DashboardSalesStats, "ordersYear" | "ordersMonth" | "ordersToday">): string {
  return `منذ البداية · السنة: ${stats.ordersYear.toLocaleString()} | الشهر: ${stats.ordersMonth.toLocaleString()} | اليوم: ${stats.ordersToday.toLocaleString()}`;
}
