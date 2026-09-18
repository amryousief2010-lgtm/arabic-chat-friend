import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMemo } from "react";
import {
  cairoMonthStartUTC,
  cairoYearStartUTC,
  currentCairoYearMonth,
  toCairoDateString,
} from "@/lib/cairoDate";
import { applySalesNetFilter } from "@/lib/orderSalesFilters";
import { chunkIds, paginateUntilDone } from "@/lib/paginateQuery";

export type ReportPeriod = "month" | "quarter" | "half" | "year" | "all";

function getDateRange(period: ReportPeriod): { from: string; to: string } {
  const now = new Date();
  const { year, monthIndex0 } = currentCairoYearMonth(now);
  const to = now.toISOString();
  let from: Date;

  switch (period) {
    case "month":
      from = cairoMonthStartUTC(year, monthIndex0);
      break;
    case "quarter":
      from = cairoMonthStartUTC(year, monthIndex0 - 2);
      break;
    case "half":
      from = cairoMonthStartUTC(year, monthIndex0 - 5);
      break;
    case "year":
      from = cairoYearStartUTC(year);
      break;
    case "all":
    default:
      from = cairoYearStartUTC(2020);
      break;
  }

  return { from: from.toISOString(), to };
}

const MONTH_NAMES = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];

const PAGE_SIZE = 1000;
const MAX_PAGES = 40;
const ITEM_CHUNK = 200;

type ReportOrderRow = {
  id: string;
  total: number | string | null;
  created_at: string;
  source: string | null;
  shipping_company: string | null;
  moderator: string | null;
  customer_id: string | null;
  customers?: { city?: string | null } | null;
};

export const useReportsData = (period: ReportPeriod) => {
  const { from, to } = useMemo(() => getDateRange(period), [period]);

  // Fetch orders with customer city — sales net (excludes cancelled)
  const ordersQuery = useQuery({
    queryKey: ["reports-orders", "sales-net", from, to],
    queryFn: async () => {
      return paginateUntilDone<ReportOrderRow>({
        pageSize: PAGE_SIZE,
        maxPages: MAX_PAGES,
        idOf: (row) => row.id,
        fetchPage: async (rangeFrom, rangeTo) => {
          const { data, error } = await applySalesNetFilter(
            supabase
              .from("orders")
              .select("id, total, created_at, source, shipping_company, moderator, customer_id, customers(city)")
              .gte("created_at", from)
              .lte("created_at", to)
              .order("created_at", { ascending: true })
              .order("id", { ascending: true }),
          ).range(rangeFrom, rangeTo);
          if (error) throw error;
          return data || [];
        },
      });
    },
    staleTime: 3 * 60 * 1000,
    retry: 1,
  });

  // Product analytics: fetch items by the order ids we already have.
  // The previous query paginated `order_items` with `orders!inner` + `.range()`
  // and no `.order()`, which can return the same 1000 rows forever so
  // `isLoading` never clears.
  const itemsQuery = useQuery({
    queryKey: ["reports-items", "sales-net", from, to, ordersQuery.dataUpdatedAt],
    enabled: !!ordersQuery.data,
    queryFn: async () => {
      const ids = (ordersQuery.data || []).map((o: { id: string }) => o.id).filter(Boolean);
      const allItems: { product_name: string; quantity: number; order_id: string }[] = [];
      for (const chunk of chunkIds(ids, ITEM_CHUNK)) {
        const { data, error } = await supabase
          .from("order_items")
          .select("product_name, quantity, order_id")
          .in("order_id", chunk);
        if (error) throw error;
        if (data) allItems.push(...data);
      }
      return allItems;
    },
    staleTime: 3 * 60 * 1000,
    retry: 1,
  });

  // Customer count
  const customersQuery = useQuery({
    queryKey: ["reports-customers", from, to],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("customers")
        .select("id", { count: "exact", head: true });
      if (error) throw error;
      return count || 0;
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  // Compute analytics
  const analytics = useMemo(() => {
    const orders = ordersQuery.data || [];
    const items = itemsQuery.data || [];

    const totalSales = orders.reduce((s, o) => s + Number(o.total), 0);
    const totalOrders = orders.length;
    const avgOrderValue = totalOrders > 0 ? Math.round(totalSales / totalOrders) : 0;

    // Monthly breakdown — group by Cairo-local month so orders after midnight
    // Cairo count under the new month (not the previous UTC month).
    const monthMap: Record<string, { sales: number; orders: number }> = {};
    for (const o of orders) {
      const key = toCairoDateString(o.created_at).slice(0, 7); // YYYY-MM
      if (!monthMap[key]) monthMap[key] = { sales: 0, orders: 0 };
      monthMap[key].sales += Number(o.total);
      monthMap[key].orders++;
    }

    const monthlySales = Object.entries(monthMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val], i, arr) => {
        const monthIdx = parseInt(key.split("-")[1]) - 1;
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
      .slice(0, 15);

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

  const ordersError = ordersQuery.error as Error | null;
  const itemsError = itemsQuery.error as Error | null;

  return {
    ...analytics,
    // KPI cards + sales charts only need orders. Waiting on items used to leave
    // the whole page on skeletons when the items query hung.
    isLoading: ordersQuery.isLoading,
    isItemsLoading: itemsQuery.isLoading || (ordersQuery.isSuccess && itemsQuery.isPending),
    isError: ordersQuery.isError,
    isItemsError: itemsQuery.isError,
    errorMessage: ordersError?.message || itemsError?.message || null,
  };
};
