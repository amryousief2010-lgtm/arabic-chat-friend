/**
 * Social Media / Marketing Analytics
 *
 * READ-ONLY aggregation over `orders`, `customers`, `order_items`, and
 * `social_media_expenses`. Never mutates orders/inventory/collection state.
 *
 * Conventions:
 *  - Cancelled orders are excluded from revenue KPIs (status === 'cancelled').
 *  - Gift orders (update_status_marker='gift' OR collection_method='none')
 *    are excluded from revenue KPIs but counted in a separate KPI.
 *  - Delivered = status in ('delivered','تم التسليم','completed').
 *  - Missing source/governorate/area are reported as "غير محدد".
 *  - Only APPROVED social media expenses count toward the 5% / 6% ratio.
 */

import { supabase } from "@/integrations/supabase/client";
import { toCairoDateString } from "@/lib/cairoDate";
import { isCancelledOrderStatus } from "@/lib/orderSalesFilters";

export const UNSPECIFIED = "غير محدد";

export type OrderLite = {
  id: string;
  order_number: string;
  status: string;
  total: number;
  customer_id: string | null;
  created_at: string;
  update_status_marker: string | null;
  collection_method: string | null;
  source: string | null;
  moderator: string | null;
  customer_name?: string | null;
  customer_source?: string | null;
  customer_governorate?: string | null;
  customer_area?: string | null;
  customer_channel?: string | null;
  customer_campaign?: string | null;
};

export type ExpenseRow = {
  id: string;
  expense_date: string;
  expense_type: string;
  platform: string | null;
  campaign_name: string | null;
  employee_name: string | null;
  amount: number;
  notes: string | null;
  attachment_url: string | null;
  is_approved: boolean;
  approved_by: string | null;
  approved_at: string | null;
  created_by: string | null;
  created_at: string;
};

export type OrderItemLite = {
  id: string;
  order_id: string;
  product_id: string | null;
  product_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  is_gift: boolean;
};

export type MarketingKPIs = {
  totalOrders: number;
  totalOrdersValue: number;
  deliveredOrders: number;
  deliveredValue: number;
  cancelledOrders: number;
  giftOrders: number;
  giftOriginalValue: number;
  avgOrderValue: number;
  newCustomers: number;
  repeatCustomers: number;
  topSource: { key: string; count: number; value: number } | null;
  topArea: { key: string; count: number; value: number } | null;
  approvedExpenses: number;
  pendingExpenses: number;
  totalExpensesAll: number;
  cost5pct: number;
  cost6pct: number;
  actualRatio: number | null;
  budgetStatus: "safe" | "warning" | "danger" | "no_sales";
  budgetRemaining5: number;
  budgetRemaining6: number;
};

export type MarketingDashboardSummary = {
  total_orders: number;
  total_sales: number;
  delivered_orders: number;
  delivered_sales: number;
  cancelled_orders: number;
  gift_orders: number;
  gift_original_value: number;
  avg_order_value: number;
  approved_expenses: number;
  pending_expenses: number;
  total_expenses: number;
  new_customers_count: number;
  repeat_customers_count: number;
  top_source: { key?: string; count?: number; value?: number } | null;
  top_area: { key?: string; count?: number; value?: number } | null;
  top_products_summary: Array<{ name: string; qty: number; revenue: number; ordersCount: number }>;
  date_from: string;
  date_to: string;
};

export type DateRange = { from: string; to: string }; // ISO datetime strings

// ---------- Classification helpers ----------

const SOURCE_MAP: Array<{ key: string; label: string; patterns: RegExp[] }> = [
  { key: "facebook_ads", label: "Facebook Ads", patterns: [/facebook\s*ads?/i, /fb\s*ads?/i, /إعلان.*فيس/i, /اعلان.*فيس/i] },
  { key: "facebook", label: "Facebook", patterns: [/facebook/i, /fb\b/i, /فيس ?بوك/i, /فيسبوك/i] },
  { key: "instagram", label: "Instagram", patterns: [/instagram/i, /ig\b/i, /انستج?رام/i, /إنستجرام/i] },
  { key: "tiktok", label: "TikTok", patterns: [/tik ?tok/i, /تيك ?توك/i] },
  { key: "whatsapp", label: "WhatsApp", patterns: [/whats?app/i, /واتس/i] },
  { key: "telegram", label: "Telegram", patterns: [/telegram/i, /تليج?رام/i, /تلجرام/i] },
  { key: "phone", label: "مكالمة هاتفية", patterns: [/phone/i, /call/i, /هاتف/i, /تليفون/i, /مكالمة/i] },
  { key: "website", label: "الموقع", patterns: [/website/i, /web\b/i, /site/i, /موقع/i, /coceg/i] },
  { key: "referral", label: "توصية", patterns: [/referral/i, /توصية/i, /صديق/i] },
  { key: "branch", label: "الفرع", patterns: [/branch/i, /فرع/i] },
  { key: "existing_customer", label: "عميل حالي", patterns: [/existing/i, /عميل.*حالي/i, /متكرر/i] },
  { key: "ads", label: "إعلانات", patterns: [/ads?\b/i, /اعلان/i, /إعلان/i, /دعاية/i, /marketing/i, /تسويق/i] },
];

export function classifySource(raw: string | null | undefined): { key: string; label: string } {
  const v = (raw || "").trim();
  if (!v) return { key: "unknown", label: UNSPECIFIED };
  for (const entry of SOURCE_MAP) {
    if (entry.patterns.some((p) => p.test(v))) return { key: entry.key, label: entry.label };
  }
  return { key: "other", label: v };
}

// ---------- Order helpers ----------

export function isGiftOrder(o: Pick<OrderLite, "update_status_marker" | "collection_method">): boolean {
  return o.update_status_marker === "gift" || o.collection_method === "none";
}

export function isCancelledOrder(o: Pick<OrderLite, "status">): boolean {
  return isCancelledOrderStatus(o.status);
}

export function isDeliveredOrder(o: Pick<OrderLite, "status">): boolean {
  const s = (o.status || "").trim();
  return s === "delivered" || s === "completed" || s === "تم التسليم";
}

// ---------- Fetchers (batched) ----------

async function fetchAllBatched<T>(
  build: (from: number, to: number) => any,
  pageSize = 1000,
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;
  // Safety upper bound: 100k rows per call
  for (let i = 0; i < 100; i++) {
    const to = from + pageSize - 1;
    const { data, error } = await build(from, to);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...(data as T[]));
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

export async function fetchOrdersInRange(range: DateRange): Promise<OrderLite[]> {
  const raw = await fetchAllBatched<any>((from, to) =>
    supabase
      .from("orders")
      .select(
        "id, order_number, status, total, customer_id, created_at, update_status_marker, collection_method, source, moderator, customers:customer_id(name, source, governorate, area, communication_channel, campaign_name)",
      )
      .gte("created_at", range.from)
      .lte("created_at", range.to)
      .order("created_at", { ascending: false })
      .range(from, to),
  );
  return raw.map((r) => ({
    id: r.id,
    order_number: r.order_number,
    status: r.status,
    total: Number(r.total || 0),
    customer_id: r.customer_id,
    created_at: r.created_at,
    update_status_marker: r.update_status_marker,
    collection_method: r.collection_method,
    source: r.source,
    moderator: r.moderator,
    customer_name: r.customers?.name ?? null,
    customer_source: r.customers?.source ?? null,
    customer_governorate: r.customers?.governorate ?? null,
    customer_area: r.customers?.area ?? null,
    customer_channel: r.customers?.communication_channel ?? null,
    customer_campaign: r.customers?.campaign_name ?? null,
  }));
}

export async function fetchOrderItemsForOrders(orderIds: string[]): Promise<OrderItemLite[]> {
  if (orderIds.length === 0) return [];
  const rows: OrderItemLite[] = [];
  const chunkSize = 400;
  for (let i = 0; i < orderIds.length; i += chunkSize) {
    const chunk = orderIds.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from("order_items")
      .select("id, order_id, product_id, product_name, quantity, unit_price, total_price, is_gift")
      .in("order_id", chunk);
    if (error) throw error;
    (data || []).forEach((d: any) =>
      rows.push({
        id: d.id,
        order_id: d.order_id,
        product_id: d.product_id,
        product_name: d.product_name,
        quantity: Number(d.quantity || 0),
        unit_price: Number(d.unit_price || 0),
        total_price: Number(d.total_price || 0),
        is_gift: !!d.is_gift,
      }),
    );
  }
  return rows;
}

export async function fetchExpensesInRange(range: DateRange): Promise<ExpenseRow[]> {
  const fromDate = range.from.slice(0, 10);
  const toDate = range.to.slice(0, 10);
  const { data, error } = await supabase
    .from("social_media_expenses")
    .select("id, expense_date, expense_type, platform, campaign_name, employee_name, amount, notes, attachment_url, is_approved, approved_by, approved_at, created_by, created_at")
    .gte("expense_date", fromDate)
    .lte("expense_date", toDate)
    .order("expense_date", { ascending: false });
  if (error) throw error;
  return (data || []).map((d: any) => ({ ...d, amount: Number(d.amount || 0) }));
}

export async function fetchMarketingDashboardSummary(
  range: DateRange,
  includeTopProducts = false,
): Promise<MarketingDashboardSummary> {
  const { data, error } = await supabase.rpc("marketing_dashboard_summary", {
    p_from: range.from,
    p_to: range.to,
    p_include_top_products: includeTopProducts,
  } as any);
  if (error) throw error;
  const row: any = Array.isArray(data) ? data[0] : data;
  return {
    total_orders: Number(row?.total_orders || 0),
    total_sales: Number(row?.total_sales || 0),
    delivered_orders: Number(row?.delivered_orders || 0),
    delivered_sales: Number(row?.delivered_sales || 0),
    cancelled_orders: Number(row?.cancelled_orders || 0),
    gift_orders: Number(row?.gift_orders || 0),
    gift_original_value: Number(row?.gift_original_value || 0),
    avg_order_value: Number(row?.avg_order_value || 0),
    approved_expenses: Number(row?.approved_expenses || 0),
    pending_expenses: Number(row?.pending_expenses || 0),
    total_expenses: Number(row?.total_expenses || 0),
    new_customers_count: Number(row?.new_customers_count || 0),
    repeat_customers_count: Number(row?.repeat_customers_count || 0),
    top_source: row?.top_source || null,
    top_area: row?.top_area || null,
    top_products_summary: Array.isArray(row?.top_products_summary) ? row.top_products_summary : [],
    date_from: row?.date_from || range.from,
    date_to: row?.date_to || range.to,
  };
}

// Detect first-order customers (must query historical orders per customer)
export async function detectNewCustomers(
  candidateCustomerIds: string[],
  range: DateRange,
): Promise<Set<string>> {
  const isNew = new Set<string>();
  if (candidateCustomerIds.length === 0) return isNew;
  const chunkSize = 300;
  for (let i = 0; i < candidateCustomerIds.length; i += chunkSize) {
    const chunk = candidateCustomerIds.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from("orders")
      .select("customer_id, created_at")
      .in("customer_id", chunk)
      .lt("created_at", range.from)
      .limit(chunk.length * 2);
    if (error) throw error;
    const seenBefore = new Set((data || []).map((r: any) => r.customer_id));
    chunk.forEach((cid) => {
      if (!seenBefore.has(cid)) isNew.add(cid);
    });
  }
  return isNew;
}

// ---------- KPI computation ----------

export function computeKPIs(
  orders: OrderLite[],
  approvedExpense: number,
  pendingExpense: number,
  newCustomerIds: Set<string>,
): MarketingKPIs {
  const nonCancelled = orders.filter((o) => !isCancelledOrder(o));
  const revenueOrders = nonCancelled.filter((o) => !isGiftOrder(o));
  const giftOrders = nonCancelled.filter(isGiftOrder);
  const delivered = revenueOrders.filter(isDeliveredOrder);

  const totalOrdersValue = revenueOrders.reduce((s, o) => s + o.total, 0);
  const deliveredValue = delivered.reduce((s, o) => s + o.total, 0);
  const avgOrderValue = revenueOrders.length > 0 ? totalOrdersValue / revenueOrders.length : 0;

  // customer breakdown
  const customerCounts = new Map<string, number>();
  revenueOrders.forEach((o) => {
    if (!o.customer_id) return;
    customerCounts.set(o.customer_id, (customerCounts.get(o.customer_id) || 0) + 1);
  });
  const repeatCustomers = Array.from(customerCounts.values()).filter((n) => n > 1).length;

  // source breakdown
  const sourceStats = new Map<string, { label: string; count: number; value: number }>();
  const areaStats = new Map<string, { count: number; value: number }>();
  for (const o of revenueOrders) {
    const s = classifySource(o.customer_source || o.source);
    const entry = sourceStats.get(s.key) || { label: s.label, count: 0, value: 0 };
    entry.count += 1;
    entry.value += o.total;
    sourceStats.set(s.key, entry);

    const area = (o.customer_governorate || "").trim() || UNSPECIFIED;
    const a = areaStats.get(area) || { count: 0, value: 0 };
    a.count += 1;
    a.value += o.total;
    areaStats.set(area, a);
  }
  const topSourceEntry = Array.from(sourceStats.entries()).sort(
    (a, b) => b[1].value - a[1].value,
  )[0];
  const topAreaEntry = Array.from(areaStats.entries()).sort((a, b) => b[1].value - a[1].value)[0];

  const cost5pct = totalOrdersValue * 0.05;
  const cost6pct = totalOrdersValue * 0.06;
  const actualRatio = totalOrdersValue > 0 ? (approvedExpense / totalOrdersValue) * 100 : null;

  let budgetStatus: MarketingKPIs["budgetStatus"];
  if (actualRatio === null) budgetStatus = "no_sales";
  else if (actualRatio <= 5) budgetStatus = "safe";
  else if (actualRatio <= 6) budgetStatus = "warning";
  else budgetStatus = "danger";

  return {
    totalOrders: orders.length,
    totalOrdersValue,
    deliveredOrders: delivered.length,
    deliveredValue,
    cancelledOrders: orders.filter(isCancelledOrder).length,
    giftOrders: giftOrders.length,
    giftOriginalValue: giftOrders.reduce((s, o) => s + o.total, 0),
    avgOrderValue,
    newCustomers: newCustomerIds.size,
    repeatCustomers,
    topSource: topSourceEntry
      ? { key: topSourceEntry[1].label, count: topSourceEntry[1].count, value: topSourceEntry[1].value }
      : null,
    topArea: topAreaEntry
      ? { key: topAreaEntry[0], count: topAreaEntry[1].count, value: topAreaEntry[1].value }
      : null,
    approvedExpenses: approvedExpense,
    pendingExpenses: pendingExpense,
    totalExpensesAll: approvedExpense + pendingExpense,
    cost5pct,
    cost6pct,
    actualRatio,
    budgetStatus,
    budgetRemaining5: cost5pct - approvedExpense,
    budgetRemaining6: cost6pct - approvedExpense,
  };
}

// ---------- Aggregations for charts / tables ----------

export function aggregateBySource(orders: OrderLite[]) {
  const map = new Map<string, { label: string; orders: number; revenue: number }>();
  for (const o of orders) {
    if (isCancelledOrder(o) || isGiftOrder(o)) continue;
    const s = classifySource(o.customer_source || o.source);
    const e = map.get(s.key) || { label: s.label, orders: 0, revenue: 0 };
    e.orders += 1;
    e.revenue += o.total;
    map.set(s.key, e);
  }
  return Array.from(map.values())
    .map((e) => ({ ...e, avg: e.orders > 0 ? e.revenue / e.orders : 0 }))
    .sort((a, b) => b.revenue - a.revenue);
}

export function aggregateByArea(orders: OrderLite[]) {
  const map = new Map<string, { area: string; orders: number; revenue: number; sourceCounts: Map<string, number> }>();
  for (const o of orders) {
    if (isCancelledOrder(o) || isGiftOrder(o)) continue;
    const area = (o.customer_governorate || "").trim() || UNSPECIFIED;
    const e = map.get(area) || { area, orders: 0, revenue: 0, sourceCounts: new Map() };
    e.orders += 1;
    e.revenue += o.total;
    const s = classifySource(o.customer_source || o.source);
    e.sourceCounts.set(s.label, (e.sourceCounts.get(s.label) || 0) + 1);
    map.set(area, e);
  }
  return Array.from(map.values())
    .map((e) => {
      const topSource = Array.from(e.sourceCounts.entries()).sort((a, b) => b[1] - a[1])[0];
      return {
        area: e.area,
        orders: e.orders,
        revenue: e.revenue,
        avg: e.orders > 0 ? e.revenue / e.orders : 0,
        topSource: topSource ? topSource[0] : UNSPECIFIED,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);
}

export function aggregateProducts(
  items: OrderItemLite[],
  ordersById: Map<string, OrderLite>,
) {
  const map = new Map<
    string,
    { name: string; qty: number; revenue: number; orders: Set<string>; sourceCounts: Map<string, number> }
  >();
  for (const it of items) {
    if (it.is_gift) continue;
    const o = ordersById.get(it.order_id);
    if (!o) continue;
    if (isCancelledOrder(o) || isGiftOrder(o)) continue;
    const key = it.product_id || it.product_name;
    const e = map.get(key) || {
      name: it.product_name,
      qty: 0,
      revenue: 0,
      orders: new Set<string>(),
      sourceCounts: new Map<string, number>(),
    };
    e.qty += it.quantity;
    e.revenue += it.total_price;
    e.orders.add(it.order_id);
    const src = classifySource(o.customer_source || o.source).label;
    e.sourceCounts.set(src, (e.sourceCounts.get(src) || 0) + 1);
    map.set(key, e);
  }
  return Array.from(map.values())
    .map((e) => {
      const topSource = Array.from(e.sourceCounts.entries()).sort((a, b) => b[1] - a[1])[0];
      return {
        name: e.name,
        qty: e.qty,
        revenue: e.revenue,
        ordersCount: e.orders.size,
        avgPrice: e.qty > 0 ? e.revenue / e.qty : 0,
        topSource: topSource ? topSource[0] : UNSPECIFIED,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);
}

export function dailySeries(orders: OrderLite[]) {
  const map = new Map<string, { date: string; orders: number; revenue: number }>();
  for (const o of orders) {
    if (isCancelledOrder(o)) continue;
    const day = o.created_at.slice(0, 10);
    const e = map.get(day) || { date: day, orders: 0, revenue: 0 };
    e.orders += 1;
    if (!isGiftOrder(o)) e.revenue += o.total;
    map.set(day, e);
  }
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}

// ---------- Date range presets ----------

export function last3MonthsRange(): DateRange {
  const now = new Date();
  const to = now.toISOString();
  const from = new Date(now.getTime() - 90 * 24 * 3600 * 1000).toISOString();
  return { from, to };
}
export function thisMonthRange(): DateRange {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  return { from, to: now.toISOString() };
}
export function thisWeekRange(): DateRange {
  const now = new Date();
  const d = now.getDay(); // 0 Sun
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - d).toISOString();
  return { from, to: now.toISOString() };
}
export function todayRange(): DateRange {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  return { from, to: now.toISOString() };
}

// ---------- Meta ads (read-only snapshots + social-source sales) ----------

/** Only this Meta ad account is in scope for the marketing ads section. */
export const META_ADS_ACCOUNT_ID = "584894453725328";

/**
 * orders.source values treated as the social/ads sales pool.
 * Match is trim + collapsed spaces/underscores, and case-insensitive for Latin.
 * Underscore forms are the source-dictionary variants of the same Arabic labels.
 */
const SOCIAL_ADS_SOURCE_KEYS = new Set([
  "إعلان",
  "اعلان",
  "حملات فيسبوك",
  "فيسبوك",
  "حملات واتساب",
  "واتساب",
  "facebook ads",
  "facebook",
  "whatsapp",
]);

export function normalizeSocialAdsSource(raw: string | null | undefined): string {
  return (raw || "")
    .trim()
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function isSocialAdsOrderSource(raw: string | null | undefined): boolean {
  const key = normalizeSocialAdsSource(raw);
  return key.length > 0 && SOCIAL_ADS_SOURCE_KEYS.has(key);
}

/** Exact ilike tokens sent to PostgREST (case-insensitive). Client filter still applies. */
export const SOCIAL_ADS_SOURCE_QUERY_VALUES = [
  "إعلان",
  "اعلان",
  "حملات فيسبوك",
  "حملات_فيسبوك",
  "فيسبوك",
  "حملات واتساب",
  "حملات_واتساب",
  "واتساب",
  "Facebook Ads",
  "Facebook",
  "WhatsApp",
] as const;

export function socialAdsSourceOrFilter(): string {
  return SOCIAL_ADS_SOURCE_QUERY_VALUES.map((value) => {
    const escaped = value.replace(/"/g, '""');
    return `source.ilike."${escaped}"`;
  }).join(",");
}

export type SocialSourceOrder = {
  id: string;
  total: number;
  source: string | null;
  status: string;
  created_at: string;
  update_status_marker: string | null;
  collection_method: string | null;
};

export type SocialAdsWeeklySnapshot = {
  id?: string;
  period_start: string;
  period_end: string;
  account_id: string;
  account_name?: string | null;
  currency?: string | null;
  spend: number | null;
  impressions: number | null;
  reach_sum_not_deduped: number | null;
  link_clicks: number | null;
  messaging_results: number | null;
  meta_purchases: number | null;
  notes?: string | null;
  exported_at?: string | null;
};

export type SocialAdsCampaignSnapshot = {
  id?: string;
  period_start: string;
  period_end: string;
  account_id: string;
  campaign_name: string | null;
  status: string | null;
  spend_egp: number | null;
  results: number | null;
  result_type: string | null;
  cost_per_result: number | null;
  impressions: number | null;
  reach: number | null;
  link_clicks: number | null;
  ctr_all_pct: number | null;
  cpc_all: number | null;
  cpm: number | null;
  purchases: number | null;
};

export type SocialAdsDailySnapshot = {
  day: string;
  account_id: string;
  account_name?: string | null;
  currency?: string | null;
  spend: number | null;
  impressions?: number | null;
  reach_sum_not_deduped?: number | null;
  link_clicks?: number | null;
  messaging_results?: number | null;
  meta_purchases?: number | null;
  ctr_pct?: number | null;
  cpc?: number | null;
  cpm?: number | null;
  notes?: string | null;
};

export type AdsSpendRollupMode = "none" | "single" | "covering" | "best_overlap" | "sum";

export type AdsSpendRollup = {
  mode: AdsSpendRollupMode;
  spend: number;
  impressions: number;
  reachSumNotDeduped: number;
  linkClicks: number;
  messagingResults: number | null;
  metaPurchases: number | null;
  currency: string;
  periodLabel: string;
  periods: Array<{ start: string; end: string }>;
};

export type SocialSourceSales = {
  netSales: number;
  orderCount: number;
  giftOrdersExcludedFromRevenue: number;
};

export type AdsDailyPoint = {
  date: string;
  ads_spend: number;
  social_net_sales: number;
};

export function rangeCalendarBounds(range: DateRange): { fromDate: string; toDate: string } {
  const fromDate = toCairoDateString(range.from);
  const toDate = toCairoDateString(range.to);
  if (fromDate <= toDate) return { fromDate, toDate };
  return { fromDate: toDate, toDate: fromDate };
}

function asNumber(value: number | string | null | undefined): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function asNullableNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function ymd(value: string): string {
  return (value || "").slice(0, 10);
}

function inclusiveDays(start: string, end: string): number {
  const [ys, ms, ds] = ymd(start).split("-").map(Number);
  const [ye, me, de] = ymd(end).split("-").map(Number);
  const msUtc = Date.UTC(ye, (me || 1) - 1, de || 1) - Date.UTC(ys, (ms || 1) - 1, ds || 1);
  return Math.round(msUtc / 86400000) + 1;
}

function addCalendarDays(start: string, days: number): string {
  const [y, m, d] = ymd(start).split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function eachCalendarDay(fromDate: string, toDate: string): string[] {
  if (!fromDate || !toDate || fromDate > toDate) return [];
  const days: string[] = [];
  // Guard against a runaway range (custom filters).
  for (let i = 0; i < 400; i++) {
    const day = addCalendarDays(fromDate, i);
    days.push(day);
    if (day >= toDate) break;
  }
  return days;
}

function periodsOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return ymd(aEnd) >= ymd(bStart) && ymd(aStart) <= ymd(bEnd);
}

function overlapDays(start: string, end: string, fromDate: string, toDate: string): number {
  const s = ymd(start) > fromDate ? ymd(start) : fromDate;
  const e = ymd(end) < toDate ? ymd(end) : toDate;
  if (e < s) return 0;
  return inclusiveDays(s, e);
}

function periodLabel(periods: Array<{ start: string; end: string }>): string {
  if (periods.length === 0) return "—";
  return periods.map((p) => `${ymd(p.start)} → ${ymd(p.end)}`).join(" + ");
}

function sumNullable(values: Array<number | null>): number | null {
  if (values.every((v) => v === null)) return null;
  return values.reduce((sum, v) => sum + (v ?? 0), 0);
}

function rollupFromRows(rows: SocialAdsWeeklySnapshot[], mode: AdsSpendRollupMode): AdsSpendRollup {
  const periods = rows.map((r) => ({ start: ymd(r.period_start), end: ymd(r.period_end) }));
  return {
    mode,
    spend: rows.reduce((sum, r) => sum + asNumber(r.spend), 0),
    impressions: rows.reduce((sum, r) => sum + asNumber(r.impressions), 0),
    reachSumNotDeduped: rows.reduce((sum, r) => sum + asNumber(r.reach_sum_not_deduped), 0),
    linkClicks: rows.reduce((sum, r) => sum + asNumber(r.link_clicks), 0),
    messagingResults: sumNullable(rows.map((r) => asNullableNumber(r.messaging_results))),
    metaPurchases: sumNullable(rows.map((r) => asNullableNumber(r.meta_purchases))),
    currency: rows.find((r) => r.currency)?.currency || "EGP",
    periodLabel: periodLabel(periods),
    periods,
  };
}

const EMPTY_ROLLUP: AdsSpendRollup = {
  mode: "none",
  spend: 0,
  impressions: 0,
  reachSumNotDeduped: 0,
  linkClicks: 0,
  messagingResults: null,
  metaPurchases: null,
  currency: "EGP",
  periodLabel: "—",
  periods: [],
};

/**
 * Overlapping weekly snapshots for the selected calendar range.
 * One row is used as-is. A row that fully covers the range wins (tightest cover).
 * Non-overlapping weeks are summed. Overlapping weeks are not summed — the row
 * with the largest overlap (then the latest period_end) is kept.
 */
export function rollupWeeklyAdSnapshots(
  rows: SocialAdsWeeklySnapshot[],
  fromDate: string,
  toDate: string,
): AdsSpendRollup {
  const overlapping = rows.filter((row) => {
    if ((row.account_id || "") !== META_ADS_ACCOUNT_ID) return false;
    return periodsOverlap(row.period_start, row.period_end, fromDate, toDate);
  });
  if (overlapping.length === 0) return { ...EMPTY_ROLLUP };
  if (overlapping.length === 1) return rollupFromRows(overlapping, "single");

  const covering = overlapping.filter(
    (row) => ymd(row.period_start) <= fromDate && ymd(row.period_end) >= toDate,
  );
  if (covering.length > 0) {
    const best = [...covering].sort((a, b) => {
      const span = inclusiveDays(a.period_start, a.period_end) - inclusiveDays(b.period_start, b.period_end);
      if (span !== 0) return span;
      return (b.exported_at || "").localeCompare(a.exported_at || "");
    })[0];
    return rollupFromRows([best], "covering");
  }

  const pairwiseOverlap = overlapping.some((a, i) =>
    overlapping.slice(i + 1).some((b) => periodsOverlap(a.period_start, a.period_end, b.period_start, b.period_end)),
  );
  if (!pairwiseOverlap) return rollupFromRows(overlapping, "sum");

  const best = [...overlapping].sort((a, b) => {
    const days = overlapDays(b.period_start, b.period_end, fromDate, toDate)
      - overlapDays(a.period_start, a.period_end, fromDate, toDate);
    if (days !== 0) return days;
    return ymd(b.period_end).localeCompare(ymd(a.period_end));
  })[0];
  return rollupFromRows([best], "best_overlap");
}

export function selectCampaignSnapshotsForRollup(
  campaigns: SocialAdsCampaignSnapshot[],
  rollup: AdsSpendRollup,
): SocialAdsCampaignSnapshot[] {
  const accountRows = campaigns.filter((row) => (row.account_id || "") === META_ADS_ACCOUNT_ID);
  const keys = new Set(rollup.periods.map((p) => `${ymd(p.start)}|${ymd(p.end)}`));
  const matched = keys.size
    ? accountRows.filter((row) => keys.has(`${ymd(row.period_start)}|${ymd(row.period_end)}`))
    : accountRows;
  const rows = matched.length > 0 || keys.size === 0 ? matched : accountRows;
  return [...rows].sort((a, b) => asNumber(b.spend_egp) - asNumber(a.spend_egp));
}

export function socialSourceSales(orders: SocialSourceOrder[]): SocialSourceSales {
  let netSales = 0;
  let orderCount = 0;
  let giftOrdersExcludedFromRevenue = 0;
  for (const order of orders) {
    if (!isSocialAdsOrderSource(order.source)) continue;
    if (isCancelledOrder(order)) continue;
    orderCount += 1;
    if (isGiftOrder(order)) {
      giftOrdersExcludedFromRevenue += 1;
      continue;
    }
    netSales += asNumber(order.total);
  }
  return { netSales, orderCount, giftOrdersExcludedFromRevenue };
}

export function approximateRoas(netSales: number, spend: number): number | null {
  if (!(spend > 0)) return null;
  return netSales / spend;
}

/**
 * Daily spend (snapshot day) vs social-source net sales.
 * Sales days use Africa/Cairo via `toCairoDateString`, same calendar as other
 * sales KPIs, so they line up with Meta's `day` column. The older `dailySeries`
 * chart in this file still buckets on the ISO date prefix and is left unchanged.
 */
export function buildAdsDailySeries(
  fromDate: string,
  toDate: string,
  snapshots: SocialAdsDailySnapshot[],
  orders: SocialSourceOrder[],
): AdsDailyPoint[] {
  const spendByDay = new Map<string, number>();
  for (const row of snapshots) {
    if ((row.account_id || "") !== META_ADS_ACCOUNT_ID) continue;
    const day = ymd(row.day);
    spendByDay.set(day, (spendByDay.get(day) || 0) + asNumber(row.spend));
  }
  const salesByDay = new Map<string, number>();
  for (const order of orders) {
    if (!isSocialAdsOrderSource(order.source)) continue;
    if (isCancelledOrder(order)) continue;
    if (isGiftOrder(order)) continue;
    const day = toCairoDateString(order.created_at);
    salesByDay.set(day, (salesByDay.get(day) || 0) + asNumber(order.total));
  }
  const axis = new Set(eachCalendarDay(fromDate, toDate));
  for (const day of spendByDay.keys()) axis.add(day);
  for (const day of salesByDay.keys()) axis.add(day);
  return Array.from(axis)
    .filter((day) => (day >= fromDate && day <= toDate) || spendByDay.has(day) || salesByDay.has(day))
    .sort((a, b) => a.localeCompare(b))
    .map((date) => ({
      date,
      ads_spend: spendByDay.get(date) || 0,
      social_net_sales: salesByDay.get(date) || 0,
    }));
}

function mapWeeklyRow(row: any): SocialAdsWeeklySnapshot {
  return {
    id: row.id,
    period_start: ymd(row.period_start),
    period_end: ymd(row.period_end),
    account_id: String(row.account_id || ""),
    account_name: row.account_name ?? null,
    currency: row.currency ?? null,
    spend: asNullableNumber(row.spend),
    impressions: asNullableNumber(row.impressions),
    reach_sum_not_deduped: asNullableNumber(row.reach_sum_not_deduped),
    link_clicks: asNullableNumber(row.link_clicks),
    messaging_results: asNullableNumber(row.messaging_results),
    meta_purchases: asNullableNumber(row.meta_purchases),
    notes: row.notes ?? null,
    exported_at: row.exported_at ?? null,
  };
}

function mapCampaignRow(row: any): SocialAdsCampaignSnapshot {
  return {
    id: row.id,
    period_start: ymd(row.period_start),
    period_end: ymd(row.period_end),
    account_id: String(row.account_id || ""),
    campaign_name: row.campaign_name ?? null,
    status: row.status ?? null,
    spend_egp: asNullableNumber(row.spend_egp),
    results: asNullableNumber(row.results),
    result_type: row.result_type ?? null,
    cost_per_result: asNullableNumber(row.cost_per_result),
    impressions: asNullableNumber(row.impressions),
    reach: asNullableNumber(row.reach),
    link_clicks: asNullableNumber(row.link_clicks),
    ctr_all_pct: asNullableNumber(row.ctr_all_pct),
    cpc_all: asNullableNumber(row.cpc_all),
    cpm: asNullableNumber(row.cpm),
    purchases: asNullableNumber(row.purchases),
  };
}

function mapDailyRow(row: any): SocialAdsDailySnapshot {
  return {
    day: ymd(row.day),
    account_id: String(row.account_id || ""),
    account_name: row.account_name ?? null,
    currency: row.currency ?? null,
    spend: asNullableNumber(row.spend),
    impressions: asNullableNumber(row.impressions),
    reach_sum_not_deduped: asNullableNumber(row.reach_sum_not_deduped),
    link_clicks: asNullableNumber(row.link_clicks),
    messaging_results: asNullableNumber(row.messaging_results),
    meta_purchases: asNullableNumber(row.meta_purchases),
    ctr_pct: asNullableNumber(row.ctr_pct),
    cpc: asNullableNumber(row.cpc),
    cpm: asNullableNumber(row.cpm),
    notes: row.notes ?? null,
  };
}

function mapSocialOrder(row: any): SocialSourceOrder {
  return {
    id: row.id,
    total: asNumber(row.total),
    source: row.source ?? null,
    status: row.status || "",
    created_at: row.created_at,
    update_status_marker: row.update_status_marker ?? null,
    collection_method: row.collection_method ?? null,
  };
}

export type MetaAdsSectionData = {
  fromDate: string;
  toDate: string;
  rollup: AdsSpendRollup;
  campaigns: SocialAdsCampaignSnapshot[];
  daily: SocialAdsDailySnapshot[];
  orders: SocialSourceOrder[];
  sales: SocialSourceSales;
  roas: number | null;
  series: AdsDailyPoint[];
  weeklyError: string | null;
  campaignError: string | null;
  dailyError: string | null;
  ordersError: string | null;
};

async function fetchWeeklyForRange(fromDate: string, toDate: string): Promise<SocialAdsWeeklySnapshot[]> {
  const { data, error } = await supabase
    .from("social_ads_weekly_snapshots")
    .select("id, period_start, period_end, account_id, account_name, currency, spend, impressions, reach_sum_not_deduped, link_clicks, messaging_results, meta_purchases, notes, exported_at")
    .eq("account_id", META_ADS_ACCOUNT_ID)
    .gte("period_end", fromDate)
    .lte("period_start", toDate);
  if (error) throw error;
  return (data || []).map(mapWeeklyRow);
}

async function fetchCampaignsForRange(fromDate: string, toDate: string): Promise<SocialAdsCampaignSnapshot[]> {
  const { data, error } = await supabase
    .from("social_ads_campaign_snapshots")
    .select("id, period_start, period_end, account_id, campaign_name, status, spend_egp, results, result_type, cost_per_result, impressions, reach, link_clicks, ctr_all_pct, cpc_all, cpm, purchases")
    .eq("account_id", META_ADS_ACCOUNT_ID)
    .gte("period_end", fromDate)
    .lte("period_start", toDate);
  if (error) throw error;
  return (data || []).map(mapCampaignRow);
}

async function fetchDailyForRange(fromDate: string, toDate: string): Promise<SocialAdsDailySnapshot[]> {
  const { data, error } = await supabase
    .from("social_ads_daily_snapshots")
    .select("day, account_id, account_name, currency, spend, impressions, reach_sum_not_deduped, link_clicks, messaging_results, meta_purchases, ctr_pct, cpc, cpm, notes")
    .eq("account_id", META_ADS_ACCOUNT_ID)
    .gte("day", fromDate)
    .lte("day", toDate)
    .order("day", { ascending: true });
  if (error) throw error;
  return (data || []).map(mapDailyRow);
}

export async function fetchSocialSourceOrdersInRange(range: DateRange): Promise<SocialSourceOrder[]> {
  const raw = await fetchAllBatched<any>((from, to) =>
    supabase
      .from("orders")
      .select("id, total, source, status, created_at, update_status_marker, collection_method")
      .gte("created_at", range.from)
      .lte("created_at", range.to)
      .or(socialAdsSourceOrFilter())
      .order("created_at", { ascending: true })
      .range(from, to),
  );
  return raw.map(mapSocialOrder).filter((order) => isSocialAdsOrderSource(order.source));
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof (error as { message: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return "تعذر تحميل البيانات";
}

/** Read-only bundle for the ads section. One failed table does not blank the others. */
export async function fetchMetaAdsSection(range: DateRange): Promise<MetaAdsSectionData> {
  const { fromDate, toDate } = rangeCalendarBounds(range);
  const [weeklyResult, campaignResult, dailyResult, ordersResult] = await Promise.allSettled([
    fetchWeeklyForRange(fromDate, toDate),
    fetchCampaignsForRange(fromDate, toDate),
    fetchDailyForRange(fromDate, toDate),
    fetchSocialSourceOrdersInRange(range),
  ]);

  const weekly = weeklyResult.status === "fulfilled" ? weeklyResult.value : [];
  const campaignRows = campaignResult.status === "fulfilled" ? campaignResult.value : [];
  const daily = dailyResult.status === "fulfilled" ? dailyResult.value : [];
  const orders = ordersResult.status === "fulfilled" ? ordersResult.value : [];
  const rollup = rollupWeeklyAdSnapshots(weekly, fromDate, toDate);
  const campaigns = selectCampaignSnapshotsForRollup(campaignRows, rollup);
  const sales = socialSourceSales(orders);
  return {
    fromDate,
    toDate,
    rollup,
    campaigns,
    daily,
    orders,
    sales,
    roas: approximateRoas(sales.netSales, rollup.spend),
    series: buildAdsDailySeries(fromDate, toDate, daily, orders),
    weeklyError: weeklyResult.status === "rejected" ? errorMessage(weeklyResult.reason) : null,
    campaignError: campaignResult.status === "rejected" ? errorMessage(campaignResult.reason) : null,
    dailyError: dailyResult.status === "rejected" ? errorMessage(dailyResult.reason) : null,
    ordersError: ordersResult.status === "rejected" ? errorMessage(ordersResult.reason) : null,
  };
}
