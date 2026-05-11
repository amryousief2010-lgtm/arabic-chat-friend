import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

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
