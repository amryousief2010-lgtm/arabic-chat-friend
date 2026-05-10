import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMemo } from "react";

const MONTH_NAMES = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];

export interface ModeratorSummary {
  name: string;
  sales: number;
  orders: number;
  percent: number;
}

export interface ModeratorMonthly {
  month: string;
  sales: number;
  orders: number;
}

export type YearFilter = "all" | "2026" | "pre2026";

export const useModeratorPerformance = (yearFilter: YearFilter = "all") => {
  const ordersQuery = useQuery({
    queryKey: ["moderator-orders"],
    queryFn: async () => {
      let allOrders: any[] = [];
      let page = 0;
      const pageSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await supabase
          .from("orders")
          .select("total, created_at, moderator")
          .range(page * pageSize, (page + 1) * pageSize - 1);

        if (error) throw error;
        if (data) allOrders = allOrders.concat(data);
        hasMore = (data?.length || 0) === pageSize;
        page++;
      }

      return allOrders;
    },
    staleTime: 3 * 60 * 1000,
  });

  const analytics = useMemo(() => {
    const all = ordersQuery.data || [];
    const orders = all.filter((o) => {
      if (yearFilter === "all") return true;
      const y = new Date(o.created_at).getFullYear();
      return yearFilter === "2026" ? y >= 2026 : y < 2026;
    });

    // Overall totals
    const totalSales = orders.reduce((s, o) => s + Number(o.total), 0);
    const totalOrders = orders.length;

    // Per-moderator aggregation
    const modMap: Record<string, { sales: number; orders: number }> = {};
    const modMonthMap: Record<string, Record<string, { sales: number; orders: number }>> = {};

    for (const o of orders) {
      const mod = o.moderator || "غير محدد";
      if (!modMap[mod]) modMap[mod] = { sales: 0, orders: 0 };
      modMap[mod].sales += Number(o.total);
      modMap[mod].orders++;

      // Monthly breakdown per moderator
      const d = new Date(o.created_at);
      const monthKey = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, "0")}`;
      if (!modMonthMap[mod]) modMonthMap[mod] = {};
      if (!modMonthMap[mod][monthKey]) modMonthMap[mod][monthKey] = { sales: 0, orders: 0 };
      modMonthMap[mod][monthKey].sales += Number(o.total);
      modMonthMap[mod][monthKey].orders++;
    }

    // Build sorted moderator list
    const moderators: ModeratorSummary[] = Object.entries(modMap)
      .map(([name, val]) => ({
        name,
        sales: Math.round(val.sales),
        orders: val.orders,
        percent: totalSales > 0 ? Math.round((val.sales / totalSales) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.sales - a.sales);

    // Build monthly data per moderator
    const monthlyData: Record<string, ModeratorMonthly[]> = {};
    for (const [mod, months] of Object.entries(modMonthMap)) {
      monthlyData[mod] = Object.entries(months)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, val]) => {
          const monthIdx = parseInt(key.split("-")[1]);
          return {
            month: MONTH_NAMES[monthIdx],
            sales: Math.round(val.sales),
            orders: val.orders,
          };
        });
    }

    return { moderators, monthlyData, totalSales, totalOrders };
  }, [ordersQuery.data]);

  return {
    ...analytics,
    isLoading: ordersQuery.isLoading,
    isError: ordersQuery.isError,
  };
};
