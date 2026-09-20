import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  cairoMonthStartUTC,
  cairoYearStartUTC,
  currentCairoYearMonth,
} from "@/lib/cairoDate";
import type { ReportPeriod } from "@/hooks/useReportsData";

function getDateRange(period: ReportPeriod): { from: string; to: string } {
  const now = new Date();
  const { year, monthIndex0 } = currentCairoYearMonth(now);
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
  return { from: from.toISOString(), to: now.toISOString() };
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export type ZodexInvoiceRow = {
  id: string;
  invoice_no: string;
  total_amount: number;
  orders_count: number;
  orders_matched: number;
  orders_missing: number;
  first_seen_at: string;
};

export type ZodexMissingRow = {
  id: string;
  bill_no: string;
  customer_name: string | null;
  customer_phone: string | null;
  moderator_name: string | null;
  cod_amount: number;
  zodex_status: string | null;
  shipment_date: string | null;
  first_seen_at: string;
};

export const useZodexReportData = (period: ReportPeriod) => {
  const { from, to } = useMemo(() => getDateRange(period), [period]);
  const queryClient = useQueryClient();

  // Shipments registered internally that carry a Zodex bill number.
  const shipmentsQuery = useQuery({
    queryKey: ["zodex-report-shipments", from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("id, total, status, shipping_bill_no, shipping_company, created_at")
        .not("shipping_bill_no", "is", null)
        .gte("created_at", from)
        .lte("created_at", to)
        .limit(20000);
      if (error) throw error;
      return (data || []) as {
        id: string;
        total: number | string | null;
        status: string | null;
        shipping_bill_no: string | null;
      }[];
    },
    staleTime: 60 * 1000,
    retry: 1,
  });

  const invoicesQuery = useQuery({
    queryKey: ["zodex-report-invoices", from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("zodex_closed_invoices")
        .select("id, invoice_no, total_amount, orders_count, orders_matched, orders_missing, first_seen_at")
        .gte("first_seen_at", from)
        .lte("first_seen_at", to)
        .order("first_seen_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data || []) as ZodexInvoiceRow[];
    },
    staleTime: 60 * 1000,
    retry: 1,
  });

  const missingQuery = useQuery({
    queryKey: ["zodex-report-missing", from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("zodex_missing_orders")
        .select("id, bill_no, customer_name, customer_phone, moderator_name, cod_amount, zodex_status, shipment_date, first_seen_at")
        .eq("status", "unresolved")
        .gte("first_seen_at", from)
        .lte("first_seen_at", to)
        .order("first_seen_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data || []) as ZodexMissingRow[];
    },
    staleTime: 60 * 1000,
    retry: 1,
  });

  const lastRunQuery = useQuery({
    queryKey: ["zodex-report-last-run"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("zodex_sync_runs")
        .select("status, finished_at, started_at, total_rows, sync_mode")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as {
        status: string | null;
        finished_at: string | null;
        started_at: string | null;
        total_rows: number | null;
        sync_mode: string | null;
      } | null;
    },
    staleTime: 60 * 1000,
    retry: 1,
  });

  // Live refresh: any change on orders or the Zodex tables re-runs the report.
  useEffect(() => {
    const invalidate = () => {
      queryClient.invalidateQueries({ queryKey: ["zodex-report-shipments"] });
      queryClient.invalidateQueries({ queryKey: ["zodex-report-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["zodex-report-missing"] });
      queryClient.invalidateQueries({ queryKey: ["zodex-report-last-run"] });
      queryClient.invalidateQueries({ queryKey: ["reports-orders"] });
      queryClient.invalidateQueries({ queryKey: ["reports-items"] });
    };

    const channel = supabase.channel("zodex-reports-live");
    for (const table of [
      "orders",
      "zodex_closed_invoices",
      "zodex_closed_invoice_orders",
      "zodex_missing_orders",
      "zodex_sync_runs",
    ]) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, invalidate);
    }
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const summary = useMemo(() => {
    const shipments = shipmentsQuery.data || [];
    const invoices = invoicesQuery.data || [];
    const missing = missingQuery.data || [];

    const delivered = shipments.filter((o) => o.status === "delivered");
    const returned = shipments.filter((o) => o.status === "returned" || o.status === "cancelled");
    const inTransit = shipments.filter(
      (o) => !["delivered", "returned", "cancelled"].includes(String(o.status)),
    );
    const sum = (list: typeof shipments) => list.reduce((s, o) => s + num(o.total), 0);

    const invoicesTotal = invoices.reduce((s, i) => s + num(i.total_amount), 0);
    const invoiceOrders = invoices.reduce((s, i) => s + num(i.orders_count), 0);
    const invoiceMatched = invoices.reduce((s, i) => s + num(i.orders_matched), 0);
    const invoiceMissing = invoices.reduce((s, i) => s + num(i.orders_missing), 0);

    return {
      shipmentsCount: shipments.length,
      shipmentsValue: sum(shipments),
      deliveredCount: delivered.length,
      deliveredValue: sum(delivered),
      returnedCount: returned.length,
      returnedValue: sum(returned),
      inTransitCount: inTransit.length,
      inTransitValue: sum(inTransit),
      deliveryRate: shipments.length
        ? Math.round((delivered.length / shipments.length) * 1000) / 10
        : 0,
      invoicesCount: invoices.length,
      invoicesTotal,
      invoiceOrders,
      invoiceMatched,
      invoiceMissing,
      missingCount: missing.length,
      missingValue: missing.reduce((s, m) => s + num(m.cod_amount), 0),
    };
  }, [shipmentsQuery.data, invoicesQuery.data, missingQuery.data]);

  return {
    ...summary,
    invoices: invoicesQuery.data || [],
    missingOrders: missingQuery.data || [],
    lastRun: lastRunQuery.data || null,
    isLoading:
      shipmentsQuery.isLoading || invoicesQuery.isLoading || missingQuery.isLoading,
    isError: shipmentsQuery.isError || invoicesQuery.isError || missingQuery.isError,
    errorMessage:
      (shipmentsQuery.error as Error | null)?.message ||
      (invoicesQuery.error as Error | null)?.message ||
      (missingQuery.error as Error | null)?.message ||
      null,
  };
};
