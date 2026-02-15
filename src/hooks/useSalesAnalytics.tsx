import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const useDashboardStats = () => {
  return useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: async () => {
      const [ordersRes, customersRes, productsRes] = await Promise.all([
        supabase.from("orders").select("total, created_at, status", { count: "exact" }),
        supabase.from("customers").select("id", { count: "exact", head: true }),
        supabase.from("products").select("id, name, stock, low_stock_threshold"),
      ]);

      const orders = ordersRes.data || [];
      const totalOrders = ordersRes.count || orders.length;
      const totalCustomers = customersRes.count || 0;
      const totalSales = orders.reduce((s, o) => s + Number(o.total), 0);
      const avgOrderValue = totalOrders > 0 ? Math.round(totalSales / totalOrders) : 0;
      const lowStockProducts = (productsRes.data || []).filter(
        (p) => p.stock <= p.low_stock_threshold
      ).length;

      return {
        totalSales,
        totalOrders,
        totalCustomers,
        avgOrderValue,
        lowStockProducts,
      };
    },
    staleTime: 5 * 60 * 1000,
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
