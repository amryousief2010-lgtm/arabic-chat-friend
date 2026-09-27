import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMemo } from "react";
import {
  cairoMonthStartUTC,
  cairoYearStartUTC,
  currentCairoYearMonth,
} from "@/lib/cairoDate";

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

type ReportAggregates = {
  totalSales: number;
  totalOrders: number;
  avgOrderValue: number;
  monthlySales: { month: string; sales: number; orders: number; momPercent: number }[];
  governorateData: { name: string; sales: number; orders: number }[];
  sourceData: { name: string; value: number; orders: number }[];
  shippingData: { name: string; value: number; orders: number }[];
  moderatorData: { name: string; sales: number; orders: number; percent: number }[];
  productData: { name: string; quantity: number }[];
};

const EMPTY_AGGREGATES: ReportAggregates = {
  totalSales: 0,
  totalOrders: 0,
  avgOrderValue: 0,
  monthlySales: [],
  governorateData: [],
  sourceData: [],
  shippingData: [],
  moderatorData: [],
  productData: [],
};

export const useReportsData = (period: ReportPeriod) => {
  const { from, to } = useMemo(() => getDateRange(period), [period]);

  // Same Cairo bounds as before. The RPC applies the sales-net filter,
  // the 40,000-row cap, and the groupings the page used to compute in the browser.
  const aggregatesQuery = useQuery({
    queryKey: ["reports-aggregates", "sales-net", from, to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_report_aggregates", {
        p_from: from,
        p_to: to,
      });
      if (error) throw error;
      return (data || EMPTY_AGGREGATES) as ReportAggregates;
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

  const aggregates = aggregatesQuery.data || EMPTY_AGGREGATES;

  return {
    ...aggregates,
    totalCustomers: customersQuery.data || 0,
    isLoading: aggregatesQuery.isLoading,
    isItemsLoading: aggregatesQuery.isLoading,
    isError: aggregatesQuery.isError,
    isItemsError: aggregatesQuery.isError,
    errorMessage: (aggregatesQuery.error as Error | null)?.message || null,
  };
};
