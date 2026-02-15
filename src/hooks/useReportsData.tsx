import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMemo } from "react";

export type ReportPeriod = "month" | "quarter" | "half" | "year" | "all";

function getDateRange(period: ReportPeriod): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString();
  let from: Date;

  switch (period) {
    case "month":
      from = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    case "quarter":
      from = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      break;
    case "half":
      from = new Date(now.getFullYear(), now.getMonth() - 5, 1);
      break;
    case "year":
      from = new Date(now.getFullYear(), 0, 1);
      break;
    case "all":
    default:
      from = new Date(2020, 0, 1);
      break;
  }

  return { from: from.toISOString(), to };
}

const MONTH_NAMES = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];

export const useReportsData = (period: ReportPeriod) => {
  const { from, to } = useMemo(() => getDateRange(period), [period]);

  // Fetch orders with customer city
  const ordersQuery = useQuery({
    queryKey: ["reports-orders", from, to],
    queryFn: async () => {
      // Supabase has 1000 row limit, paginate
      let allOrders: any[] = [];
      let page = 0;
      const pageSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await supabase
          .from("orders")
          .select("total, created_at, source, shipping_company, moderator, customer_id, customers(city)")
          .gte("created_at", from)
          .lte("created_at", to)
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

  // Fetch order items for product analytics
  const itemsQuery = useQuery({
    queryKey: ["reports-items", from, to],
    queryFn: async () => {
      let allItems: any[] = [];
      let page = 0;
      const pageSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await supabase
          .from("order_items")
          .select("product_name, quantity, order_id, orders!inner(created_at)")
          .gte("orders.created_at", from)
          .lte("orders.created_at", to)
          .range(page * pageSize, (page + 1) * pageSize - 1);

        if (error) throw error;
        if (data) allItems = allItems.concat(data);
        hasMore = (data?.length || 0) === pageSize;
        page++;
      }

      return allItems;
    },
    staleTime: 3 * 60 * 1000,
  });

  // Customer count
  const customersQuery = useQuery({
    queryKey: ["reports-customers", from, to],
    queryFn: async () => {
      const { count } = await supabase
        .from("customers")
        .select("id", { count: "exact", head: true });
      return count || 0;
    },
    staleTime: 5 * 60 * 1000,
  });

  // Compute analytics
  const analytics = useMemo(() => {
    const orders = ordersQuery.data || [];
    const items = itemsQuery.data || [];

    const totalSales = orders.reduce((s, o) => s + Number(o.total), 0);
    const totalOrders = orders.length;
    const avgOrderValue = totalOrders > 0 ? Math.round(totalSales / totalOrders) : 0;

    // Monthly breakdown
    const monthMap: Record<string, { sales: number; orders: number }> = {};
    for (const o of orders) {
      const d = new Date(o.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, "0")}`;
      if (!monthMap[key]) monthMap[key] = { sales: 0, orders: 0 };
      monthMap[key].sales += Number(o.total);
      monthMap[key].orders++;
    }

    const monthlySales = Object.entries(monthMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val], i, arr) => {
        const monthIdx = parseInt(key.split("-")[1]);
        const prevSales = i > 0 ? arr[i - 1][1].sales : val.sales;
        const mom = i > 0 ? Math.round(((val.sales - prevSales) / prevSales) * 1000) / 10 : 0;
        return {
          month: MONTH_NAMES[monthIdx],
          sales: Math.round(val.sales),
          orders: val.orders,
          momPercent: mom,
        };
      });

    // Governorate (from customer city)
    const govMap: Record<string, { sales: number; orders: number }> = {};
    for (const o of orders) {
      const city = (o.customers as any)?.city || "غير محدد";
      if (!govMap[city]) govMap[city] = { sales: 0, orders: 0 };
      govMap[city].sales += Number(o.total);
      govMap[city].orders++;
    }
    const governorateData = Object.entries(govMap)
      .map(([name, val]) => ({ name, sales: Math.round(val.sales), orders: val.orders }))
      .sort((a, b) => b.sales - a.sales)
      .slice(0, 10);

    // Sources
    const srcMap: Record<string, number> = {};
    for (const o of orders) {
      const src = o.source || "غير محدد";
      srcMap[src] = (srcMap[src] || 0) + 1;
    }
    const sourceData = Object.entries(srcMap)
      .map(([name, count]) => ({
        name,
        value: totalOrders > 0 ? Math.round((count / totalOrders) * 1000) / 10 : 0,
        orders: count,
      }))
      .sort((a, b) => b.orders - a.orders)
      .slice(0, 6);

    // Shipping companies
    const shipMap: Record<string, number> = {};
    for (const o of orders) {
      const ship = o.shipping_company || "غير محدد";
      shipMap[ship] = (shipMap[ship] || 0) + 1;
    }
    const shippingData = Object.entries(shipMap)
      .map(([name, count]) => ({
        name,
        value: totalOrders > 0 ? Math.round((count / totalOrders) * 1000) / 10 : 0,
        orders: count,
      }))
      .sort((a, b) => b.orders - a.orders)
      .slice(0, 5);

    // Moderators
    const modMap: Record<string, { sales: number; orders: number }> = {};
    for (const o of orders) {
      const mod = o.moderator || "غير محدد";
      if (!modMap[mod]) modMap[mod] = { sales: 0, orders: 0 };
      modMap[mod].sales += Number(o.total);
      modMap[mod].orders++;
    }
    const moderatorData = Object.entries(modMap)
      .map(([name, val]) => ({
        name,
        sales: Math.round(val.sales),
        orders: val.orders,
        percent: totalSales > 0 ? Math.round((val.sales / totalSales) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.sales - a.sales)
      .slice(0, 7);

    // Top products
    const prodMap: Record<string, number> = {};
    for (const item of items) {
      const name = item.product_name || "غير محدد";
      prodMap[name] = (prodMap[name] || 0) + Number(item.quantity);
    }
    const productData = Object.entries(prodMap)
      .map(([name, quantity]) => ({ name, quantity: Math.round(quantity) }))
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 10);

    return {
      totalSales,
      totalOrders,
      avgOrderValue,
      totalCustomers: customersQuery.data || 0,
      monthlySales,
      governorateData,
      sourceData,
      shippingData,
      moderatorData,
      productData,
    };
  }, [ordersQuery.data, itemsQuery.data, customersQuery.data]);

  return {
    ...analytics,
    isLoading: ordersQuery.isLoading || itemsQuery.isLoading,
    isError: ordersQuery.isError || itemsQuery.isError,
  };
};
