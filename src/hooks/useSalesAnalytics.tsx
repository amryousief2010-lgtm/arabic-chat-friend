import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cairoTodayStartUTC } from "@/lib/cairoDate";
import { MAIN_WAREHOUSE_ID } from "@/lib/warehouseItemFilters";
import { AGOUZA_WAREHOUSE_ID } from "@/lib/agouzaReservations";

export interface TodayOrdersBreakdown {
  shipping: number;
  mainWarehouse: number;
  agouza: number;
  unclassified: number;
  total: number;
}

/**
 * Splits today's orders (Cairo-day window) by fulfillment channel — display-only.
 * Classification priority (disjoint):
 *   1. shipping_company set AND != 'مندوب خاص'        → شركة الشحن
 *   2. source_warehouse_id = MAIN_WAREHOUSE_ID        → المخزن الرئيسي
 *   3. source_warehouse_id = AGOUZA_WAREHOUSE_ID      → مخزن العجوزة
 *   4. else                                            → غير مصنف
 */
export const useTodayOrdersBreakdown = () => {
  return useQuery<TodayOrdersBreakdown>({
    queryKey: ["today-orders-breakdown-v2"],
    queryFn: async () => {
      const start = cairoTodayStartUTC(new Date());
      const end = new Date(start.getTime() + 26 * 60 * 60 * 1000);
      const { data, error } = await supabase
        .from("orders")
        .select("id, shipping_company, source_warehouse_id, created_at")
        .gte("created_at", start.toISOString())
        .lt("created_at", end.toISOString());
      if (error) throw error;
      const todayStr = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Africa/Cairo",
        year: "numeric", month: "2-digit", day: "2-digit",
      }).format(new Date());
      const rows = (data || []).filter((o: any) =>
        new Intl.DateTimeFormat("en-CA", {
          timeZone: "Africa/Cairo",
          year: "numeric", month: "2-digit", day: "2-digit",
        }).format(new Date(o.created_at)) === todayStr
      );
      let shipping = 0, mainWarehouse = 0, agouza = 0, unclassified = 0;
      for (const o of rows as any[]) {
        const sc = (o.shipping_company || "").trim();
        if (sc && sc !== "مندوب خاص") shipping++;
        else if (o.source_warehouse_id === MAIN_WAREHOUSE_ID) mainWarehouse++;
        else if (o.source_warehouse_id === AGOUZA_WAREHOUSE_ID) agouza++;
        else unclassified++;
      }
      return { shipping, mainWarehouse, agouza, unclassified, total: rows.length };
    },
    staleTime: 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
  });
};

export interface TopProduct {
  product_id: string | null;
  product_name: string;
  unit: string | null;
  quantity: number;
  orders_count: number;
  total_sales: number;
}

/**
 * Top-N most requested products over the last 7 Cairo days (inclusive of today).
 * Uses the same exclusion rule as the dashboard totals: cancelled orders are excluded.
 * Grouping: by product_id when present, else by product_name.
 */
export const useTopProductsLast7Days = (limit = 5) => {
  return useQuery<TopProduct[]>({
    queryKey: ["top-products-7d", limit],
    queryFn: async () => {
      const todayStart = cairoTodayStartUTC(new Date());
      // last 7 days INCLUSIVE of today = start of the day 6 days ago
      const rangeStart = new Date(todayStart.getTime() - 6 * 24 * 60 * 60 * 1000);
      const rangeEnd = new Date(todayStart.getTime() + 26 * 60 * 60 * 1000);
      const { data, error } = await supabase
        .from("order_items")
        .select("product_id, product_name, quantity, total_price, is_gift, order_id, orders!inner(status, created_at)")
        .gte("orders.created_at", rangeStart.toISOString())
        .lt("orders.created_at", rangeEnd.toISOString())
        .neq("orders.status", "cancelled");
      if (error) throw error;

      // Fetch product units in one shot
      const productIds = Array.from(new Set((data || []).map((r: any) => r.product_id).filter(Boolean))) as string[];
      const unitsMap: Record<string, string> = {};
      if (productIds.length) {
        const { data: prods } = await supabase.from("products").select("id, unit").in("id", productIds);
        for (const p of prods || []) unitsMap[(p as any).id] = (p as any).unit;
      }

      const agg = new Map<string, TopProduct & { orderSet: Set<string> }>();
      for (const row of (data || []) as any[]) {
        const key = row.product_id || `name:${row.product_name}`;
        let entry = agg.get(key);
        if (!entry) {
          entry = {
            product_id: row.product_id || null,
            product_name: row.product_name,
            unit: row.product_id ? unitsMap[row.product_id] || null : null,
            quantity: 0,
            orders_count: 0,
            total_sales: 0,
            orderSet: new Set<string>(),
          };
          agg.set(key, entry);
        }
        entry.quantity += Number(row.quantity) || 0;
        entry.total_sales += Number(row.total_price) || 0;
        entry.orderSet.add(row.order_id);
      }
      const list: TopProduct[] = Array.from(agg.values()).map((e) => ({
        product_id: e.product_id,
        product_name: e.product_name,
        unit: e.unit,
        quantity: Math.round(e.quantity * 100) / 100,
        orders_count: e.orderSet.size,
        total_sales: Math.round(e.total_sales * 100) / 100,
      }));
      list.sort((a, b) =>
        b.quantity - a.quantity ||
        b.orders_count - a.orders_count ||
        b.total_sales - a.total_sales,
      );
      return list.slice(0, limit);
    },
    staleTime: 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
  });
};

export interface DashboardOverview {
  today: { sales: number; orders: number };
  month: { sales: number; orders: number };
  year: { sales: number; orders: number };
  total: { sales: number; orders: number };
  avg_order_value: number;
  customers: number;
  low_stock: number;
  monthly: Array<{ month: string; sales: number; orders: number }>;
  daily: Array<{ date: string; sales: number; orders: number }>;
}

export const useDashboardStats = () => {
  return useQuery({
    queryKey: ["dashboard-stats-v3"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_dashboard_overview");
      if (error) throw error;
      const o = data as unknown as DashboardOverview;
      return {
        totalSales: Number(o.total.sales),
        totalOrders: o.total.orders,
        totalCustomers: o.customers,
        avgOrderValue: o.avg_order_value,
        lowStockProducts: o.low_stock,
        salesToday: Number(o.today.sales),
        ordersToday: o.today.orders,
        salesMonth: Number(o.month.sales),
        ordersMonth: o.month.orders,
        salesYear: Number(o.year.sales),
        ordersYear: o.year.orders,
        monthlySeries: o.monthly || [],
        dailySeries: o.daily || [],
      };
    },
    staleTime: 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
  });
};

export const useRecentOrders = (limit = 5) => {
  return useQuery({
    queryKey: ["recent-orders", limit],
    queryFn: async () => {
      const { data } = await supabase
        .from("orders")
        .select("id, order_number, total, status, created_at, customer_id, customers(name)")
        .order("created_at", { ascending: false })
        .limit(limit);
      return data || [];
    },
    staleTime: 2 * 60 * 1000,
  });
};

export const useMonthlySalesFromDB = () => {
  return useQuery({
    queryKey: ["monthly-sales-db"],
    queryFn: async () => {
      const { data } = await supabase
        .from("orders")
        .select("total, created_at");

      if (!data) return [];

      const monthMap: Record<string, { sales: number; orders: number }> = {};
      const monthNames = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

      for (const order of data) {
        const d = new Date(order.created_at);
        const key = `${d.getFullYear()}-${d.getMonth()}`;
        if (!monthMap[key]) monthMap[key] = { sales: 0, orders: 0 };
        monthMap[key].sales += Number(order.total);
        monthMap[key].orders++;
      }

      return Object.entries(monthMap)
        .map(([key, val]) => {
          const [, monthIdx] = key.split("-");
          return {
            month: monthNames[parseInt(monthIdx)],
            sales: Math.round(val.sales),
            orders: val.orders,
            sortKey: key,
          };
        })
        .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    },
    staleTime: 5 * 60 * 1000,
  });
};
