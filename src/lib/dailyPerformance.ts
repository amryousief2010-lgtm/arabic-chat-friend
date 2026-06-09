/**
 * Daily Sales Performance Analysis — read-only analytics helpers.
 *
 * Compares a selected Cairo-calendar day against:
 *  - same day-of-month in the previous 1/3/6 months
 *  - same weekday in the previous 4 weeks (optional)
 *
 * No writes. No mutations. No order/stock/pricing/payment logic touched.
 */

import { supabase } from "@/integrations/supabase/client";
import { cairoWallClockToUTC, toCairoDateString } from "@/lib/cairoDate";

export type DayBucket = {
  /** YYYY-MM-DD in Cairo */
  date: string;
  label: string;
  startUTC: string;
  endUTC: string;
  orders: OrderRow[];
};

export interface OrderRow {
  id: string;
  order_number: string;
  total: number;
  status: string;
  payment_method: string | null;
  payment_status: string | null;
  source: string | null;
  shipping_company: string | null;
  moderator: string | null;
  customer_id: string | null;
  created_at: string;
  fulfillment_type: string | null;
  collection_status: string | null;
  delivered_at: string | null;
  customer: {
    id: string;
    name: string | null;
    governorate: string | null;
    city: string | null;
    created_at: string;
  } | null;
  items: {
    product_name: string;
    quantity: number;
    unit_price: number;
    total_price: number;
  }[];
}

export interface DayKpis {
  date: string;
  label: string;
  sales: number;
  orders: number;
  avgOrderValue: number;
  customers: number;
  newCustomers: number;
  repeatCustomers: number;
  totalQtyKg: number;
  cancelled: number;
  pending: number;
  collectedExpected: number;
  collectedActual: number;
}

export interface ProductAgg {
  name: string;
  qty: number;
  revenue: number;
}

export interface GovAgg {
  name: string;
  sales: number;
  orders: number;
  avg: number;
}

export interface NamedAgg {
  name: string;
  sales: number;
  orders: number;
}

const startOfCairoDayUTC = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return cairoWallClockToUTC(y, m - 1, d, 0, 0, 0);
};

/** Return cairo YYYY-MM-DD for "same day-of-month N months back" from selected. */
export function sameDayPrevMonth(selected: string, monthsBack: number): string {
  const [y, m, d] = selected.split("-").map(Number);
  // Find the target month
  let ty = y;
  let tm = m - monthsBack;
  while (tm <= 0) {
    tm += 12;
    ty -= 1;
  }
  // Clamp day to last day of target month
  const lastDay = new Date(ty, tm, 0).getDate();
  const td = Math.min(d, lastDay);
  return `${ty}-${String(tm).padStart(2, "0")}-${String(td).padStart(2, "0")}`;
}

/** Same weekday N weeks back. */
export function sameWeekdayPrevWeek(selected: string, weeksBack: number): string {
  const [y, m, d] = selected.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  base.setUTCDate(base.getUTCDate() - 7 * weeksBack);
  return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, "0")}-${String(base.getUTCDate()).padStart(2, "0")}`;
}

export async function fetchDayOrders(cairoDate: string): Promise<OrderRow[]> {
  const startUTC = startOfCairoDayUTC(cairoDate);
  const nextDay = new Date(startUTC.getTime() + 24 * 60 * 60 * 1000);
  const { data, error } = await supabase
    .from("orders")
    .select(
      `id, order_number, total, status, payment_method, payment_status,
       source, shipping_company, moderator, customer_id, created_at,
       fulfillment_type, collection_status, delivered_at,
       customer:customers ( id, name, governorate, city, created_at ),
       items:order_items ( product_name, quantity, unit_price, total_price )`,
    )
    .gte("created_at", startUTC.toISOString())
    .lt("created_at", nextDay.toISOString())
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data as unknown as OrderRow[]) || [];
}

export function computeKpis(date: string, label: string, orders: OrderRow[]): DayKpis {
  const sales = orders.reduce((s, o) => s + Number(o.total || 0), 0);
  const cancelled = orders.filter((o) => o.status === "cancelled").length;
  const pending = orders.filter((o) =>
    ["pending", "processing"].includes(o.status),
  ).length;
  const valid = orders.filter((o) => o.status !== "cancelled");
  const validSales = valid.reduce((s, o) => s + Number(o.total || 0), 0);
  const customerIds = new Set(orders.map((o) => o.customer_id).filter(Boolean));
  const dayStart = startOfCairoDayUTC(date).getTime();
  const newCust = new Set(
    orders
      .filter((o) => {
        const c = o.customer;
        if (!c?.created_at) return false;
        return new Date(c.created_at).getTime() >= dayStart - 60_000;
      })
      .map((o) => o.customer_id)
      .filter(Boolean),
  );
  const totalQtyKg = orders
    .flatMap((o) => o.items || [])
    .reduce((s, it) => s + Number(it.quantity || 0), 0);

  // collection — only orders whose status is "delivered" or marked collected
  const collectedExpected = orders
    .filter((o) => o.status === "delivered")
    .reduce((s, o) => s + Number(o.total || 0), 0);
  const collectedActual = orders
    .filter((o) => o.collection_status === "collected" || o.payment_status === "paid")
    .reduce((s, o) => s + Number(o.total || 0), 0);

  return {
    date,
    label,
    sales: validSales,
    orders: valid.length,
    avgOrderValue: valid.length ? validSales / valid.length : 0,
    customers: customerIds.size,
    newCustomers: newCust.size,
    repeatCustomers: customerIds.size - newCust.size,
    totalQtyKg,
    cancelled,
    pending,
    collectedExpected,
    collectedActual,
  };
}

export function topProducts(orders: OrderRow[], limit = 10): ProductAgg[] {
  const map = new Map<string, ProductAgg>();
  for (const o of orders) {
    if (o.status === "cancelled") continue;
    for (const it of o.items || []) {
      const k = it.product_name || "—";
      const cur = map.get(k) || { name: k, qty: 0, revenue: 0 };
      cur.qty += Number(it.quantity || 0);
      cur.revenue += Number(it.total_price || 0);
      map.set(k, cur);
    }
  }
  return Array.from(map.values()).sort((a, b) => b.qty - a.qty).slice(0, limit);
}

export function bottomProducts(orders: OrderRow[], limit = 5): ProductAgg[] {
  const all = topProducts(orders, 9999);
  return all.filter((p) => p.qty > 0).slice(-limit).reverse();
}

export function byGovernorate(orders: OrderRow[]): GovAgg[] {
  const map = new Map<string, GovAgg>();
  for (const o of orders) {
    if (o.status === "cancelled") continue;
    const g = o.customer?.governorate || "غير محدد";
    const cur = map.get(g) || { name: g, sales: 0, orders: 0, avg: 0 };
    cur.sales += Number(o.total || 0);
    cur.orders += 1;
    map.set(g, cur);
  }
  for (const v of map.values()) v.avg = v.orders ? v.sales / v.orders : 0;
  return Array.from(map.values()).sort((a, b) => b.sales - a.sales);
}

export function byField(
  orders: OrderRow[],
  field: "moderator" | "shipping_company" | "source",
): NamedAgg[] {
  const map = new Map<string, NamedAgg>();
  for (const o of orders) {
    if (o.status === "cancelled") continue;
    const k = (o[field] as string) || "غير محدد";
    const cur = map.get(k) || { name: k, sales: 0, orders: 0 };
    cur.sales += Number(o.total || 0);
    cur.orders += 1;
    map.set(k, cur);
  }
  return Array.from(map.values()).sort((a, b) => b.sales - a.sales);
}

/** Simple delta + trend helper. */
export function delta(current: number, previous: number) {
  const diff = current - previous;
  const pct = previous > 0 ? (diff / previous) * 100 : current > 0 ? 100 : 0;
  const trend: "up" | "down" | "stable" =
    Math.abs(pct) < 5 ? "stable" : pct > 0 ? "up" : "down";
  return { diff, pct, trend };
}

export type Recommendation = {
  type: "alert" | "opportunity" | "action";
  title: string;
  body: string;
};

export function buildRecommendations(
  today: DayKpis,
  avg: DayKpis,
  topProds: ProductAgg[],
  gov: GovAgg[],
  moderators: NamedAgg[],
): Recommendation[] {
  const recs: Recommendation[] = [];
  const salesDelta = delta(today.sales, avg.sales);
  const ordersDelta = delta(today.orders, avg.orders);
  const aovDelta = delta(today.avgOrderValue, avg.avgOrderValue);

  if (salesDelta.trend === "down") {
    recs.push({
      type: "alert",
      title: "انخفاض في المبيعات اليومية",
      body: `المبيعات أقل بنسبة ${Math.abs(salesDelta.pct).toFixed(1)}% عن المتوسط. ركّز على المتابعة مع العملاء السابقين عبر واتساب وقدّم عروض نصف كيلو وباكدج اقتصادي للأسر.`,
    });
    if (ordersDelta.trend === "down") {
      recs.push({
        type: "action",
        title: "عدد الطلبات منخفض",
        body: "ادفع حملة سريعة على فيسبوك/تيك توك على المنتجات الأكثر طلباً، وكثّف اتصال الموديراتور بالعملاء المعلقين.",
      });
    }
    if (aovDelta.trend === "down") {
      recs.push({
        type: "action",
        title: "متوسط قيمة الطلب منخفض",
        body: "اقترح باندل قيمة (بدل من العروض الفاخرة)، أضف منتج مكمّل بسعر مغرٍ، وادمج المصنّعات مع الطازج لرفع متوسط الطلب دون كسر الهامش.",
      });
    }
  } else if (salesDelta.trend === "up") {
    recs.push({
      type: "opportunity",
      title: "أداء قوي اليوم",
      body: `المبيعات أعلى بنسبة ${salesDelta.pct.toFixed(1)}% عن المتوسط. كرّر نفس نوع العرض/التوقيت في الأيام القادمة وادفعه على المحافظات الأقوى.`,
    });
  }

  if (today.cancelled > Math.max(2, Math.round(avg.orders * 0.1))) {
    recs.push({
      type: "alert",
      title: "نسبة إلغاءات مرتفعة",
      body: `عدد الإلغاءات اليوم ${today.cancelled}. راجع أسباب الإلغاء (سعر/توصيل/مخزون) وفعّل اتصال استرجاع خلال ٢٤ ساعة.`,
    });
  }
  if (today.pending > Math.max(3, Math.round(avg.orders * 0.2))) {
    recs.push({
      type: "action",
      title: "طلبات معلقة كثيرة",
      body: `يوجد ${today.pending} طلب معلق/قيد التنفيذ. وزّع المتابعة على الموديراتور وأغلق الطلبات قبل نهاية اليوم لرفع التحصيل.`,
    });
  }

  if (today.newCustomers === 0 && today.orders > 0) {
    recs.push({
      type: "action",
      title: "لا يوجد عملاء جدد اليوم",
      body: "خصّص عرض ترحيبي بسيط (نصف كيلو/طلب أول) وادفعه على القنوات الرقمية لجذب عملاء جدد.",
    });
  }

  const topGov = gov[0];
  const weakGov = gov.slice(-1)[0];
  if (topGov) {
    recs.push({
      type: "opportunity",
      title: `محافظة ${topGov.name} هي الأقوى اليوم`,
      body: `ركّز حملات الواتساب وخطوط المندوب الخاص على ${topGov.name}، وادفع باندل العائلة هناك.`,
    });
  }
  if (weakGov && gov.length > 2 && weakGov.sales < (topGov?.sales || 0) * 0.2) {
    recs.push({
      type: "action",
      title: `أداء ضعيف في ${weakGov.name}`,
      body: `اعتمد شركة شحن مناسبة لها بدل المندوب الخاص، وجرّب عرض اقتصادي مستهدف للمحافظة.`,
    });
  }

  const topMod = moderators[0];
  if (topMod) {
    recs.push({
      type: "opportunity",
      title: `أفضل موديراتور اليوم: ${topMod.name}`,
      body: `راجع طريقتها في الإقناع/العروض المعروضة وعمّمها على باقي الفريق.`,
    });
  }

  if (topProds[0]) {
    recs.push({
      type: "opportunity",
      title: `المنتج الأعلى مبيعاً: ${topProds[0].name}`,
      body: `راقب المخزون منه واطلب تعزيز التجهيز، وادمجه في باندل قيمة بدل الخصم المباشر للحفاظ على الهامش.`,
    });
  }

  return recs;
}

export interface MonthlyPlan {
  dailyTarget: number;
  weeklyTarget: number;
  monthlyTarget: number;
  targetOrders: number;
  targetAOV: number;
  pushProducts: string[];
  reduceProducts: string[];
  topGovernorates: string[];
  weakGovernorates: string[];
  marketing: string[];
  moderatorActions: string[];
  deliveryActions: string[];
  risks: string[];
}

export function buildMonthlyPlan(
  today: DayKpis,
  avg: DayKpis,
  topProds: ProductAgg[],
  bottomProds: ProductAgg[],
  gov: GovAgg[],
): MonthlyPlan {
  // Conservative target: max(today, avg) * growth factor
  const baseDaily = Math.max(today.sales, avg.sales);
  const growth = 1.1; // +10% realistic monthly goal
  const dailyTarget = Math.round(baseDaily * growth);
  const weeklyTarget = dailyTarget * 7;
  const monthlyTarget = dailyTarget * 30;
  const targetOrders = Math.round(Math.max(today.orders, avg.orders) * growth) * 30;
  const targetAOV = Math.round(
    Math.max(today.avgOrderValue, avg.avgOrderValue) * 1.05,
  );

  return {
    dailyTarget,
    weeklyTarget,
    monthlyTarget,
    targetOrders,
    targetAOV,
    pushProducts: topProds.slice(0, 5).map((p) => p.name),
    reduceProducts: bottomProds.slice(0, 3).map((p) => p.name),
    topGovernorates: gov.slice(0, 5).map((g) => g.name),
    weakGovernorates: gov.slice(-3).map((g) => g.name),
    marketing: [
      "متابعة عملاء آخر 30 يوم على واتساب يومياً",
      "نشر بوست يومي بعرض اليوم على فيسبوك/تيك توك",
      "عرض نصف كيلو موجّه للأسر متوسطة الدخل",
      "باندل عائلي (طازج + مصنّع) بسعر مغرٍ بدون كسر الهامش",
      "حملة استرجاع للعملاء غير النشطين منذ 60 يوم",
    ],
    moderatorActions: [
      "متابعة الطلبات المعلقة قبل نهاية اليوم",
      "تحديد تارجت يومي لكل موديراتور",
      "اتصال يومي بأفضل 10 عملاء",
      "تحليل أسباب الإلغاء أسبوعياً",
    ],
    deliveryActions: [
      "تجميع الطلبات في نفس المحافظة على خط مندوب خاص واحد",
      "استخدام شركات الشحن للمحافظات البعيدة منخفضة الكثافة",
      "متابعة الطلبات المتأخرة يومياً",
    ],
    risks: [
      bottomProds[0] ? `طلب ضعيف على ${bottomProds[0].name} — راجع السعر/التغليف.` : "",
      today.cancelled > 2 ? `نسبة إلغاءات مرتفعة (${today.cancelled}).` : "",
      gov.slice(-1)[0] ? `أداء ضعيف في ${gov.slice(-1)[0].name}.` : "",
      today.collectedExpected - today.collectedActual > 0
        ? `فجوة تحصيل ${Math.round(today.collectedExpected - today.collectedActual)} ج.م.`
        : "",
    ].filter(Boolean),
  };
}

export function cairoToday(): string {
  return toCairoDateString(new Date());
}
