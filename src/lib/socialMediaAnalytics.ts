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
  return o.status === "cancelled";
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
        "id, order_number, status, total, customer_id, created_at, update_status_marker, collection_method, source, moderator, customers:customer_id(name, source, governorate, area, communication_channel)",
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
    .select("*")
    .gte("expense_date", fromDate)
    .lte("expense_date", toDate)
    .order("expense_date", { ascending: false });
  if (error) throw error;
  return (data || []).map((d: any) => ({ ...d, amount: Number(d.amount || 0) }));
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
