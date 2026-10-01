import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  type KgPrices,
  type KgPriceVersion,
  type KgPriceKind,
  defaultKgPrices,
  BUILTIN_KG_PRICE_VERSIONS,
  monthStartIso,
  resolveKgPricesForMonth,
} from "@/lib/kgPrices";
import { currentCairoYearMonth } from "@/lib/cairoDate";

export type { KgPrices, KgPriceVersion, KgPriceKind };
export {
  defaultKgPrices,
  BUILTIN_KG_PRICE_VERSIONS,
  monthStartIso,
  resolveKgPricesForMonth,
} from "@/lib/kgPrices";

/** @deprecated Prefer resolveKgPricesForMonth — kept for any stray imports. */
export const KG_PRICES_EFFECTIVE_FROM = { year: 2026, month: 9 };

/** @deprecated Prefer versioned rows — historical processed was 160 before Sep 2026. */
export const legacyKgPrices: KgPrices = {
  meat_price: 390,
  bone_meat_price: 350,
  processed_price: 160,
};

export function isHistoricalKgMonth(year?: number, month?: number) {
  if (!year || !month) return false;
  return resolveKgPricesForMonth(BUILTIN_KG_PRICE_VERSIONS, year, month).isHistorical;
}

const MONTH_QK = ["sales-kg-prices-for-month"] as const;
const VERSIONS_QK = ["sales-kg-price-versions"] as const;

function isPriceManagerRole(role: string | null | undefined) {
  return (
    role === "general_manager" ||
    role === "executive_manager" ||
    role === "sales_manager" ||
    role === "marketing_sales_manager"
  );
}

/**
 * أسعار الكيلو المشتركة لصفحة التارجت فقط (لحوم / لحوم بالعظم / مصنعات).
 * الحساب عبر RPC get_sales_kg_prices_for_month حسب الشهر المعروض.
 * التعديل عبر لوحة الإعدادات + upsert_sales_kg_price_version بتاريخ سريان صريح.
 */
export function useKgPrices(period?: { year?: number; month?: number }) {
  const cur = currentCairoYearMonth();
  const year = period?.year ?? cur.year;
  const month = period?.month ?? cur.monthIndex0 + 1;
  const queryClient = useQueryClient();
  const { role } = useAuth();
  const canManagePrices = isPriceManagerRole(role);

  const { data: monthRow, isLoading: monthLoading } = useQuery({
    queryKey: [...MONTH_QK, year, month],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_sales_kg_prices_for_month", {
        p_year: year,
        p_month: month,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) {
        return resolveKgPricesForMonth(BUILTIN_KG_PRICE_VERSIONS, year, month);
      }
      return {
        prices: {
          meat_price: Number(row.meat_price),
          bone_meat_price: Number(row.bone_meat_price),
          processed_price: Number(row.processed_price),
        },
        effective_from: String(row.effective_from),
        isHistorical: String(row.effective_from) < "2026-09-01",
      };
    },
    staleTime: 30_000,
  });

  const { data: versions = [] } = useQuery({
    queryKey: VERSIONS_QK,
    enabled: canManagePrices,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_kg_price_versions")
        .select(
          "effective_from, meat_price, bone_meat_price, processed_price, effective_to, created_by, updated_by, created_at, updated_at",
        )
        .order("effective_from", { ascending: false });
      if (error) throw error;
      return (data ?? []) as KgPriceVersion[];
    },
    staleTime: 30_000,
  });

  useEffect(() => {
    const channelName = `sales-kg-price-versions-realtime-${crypto.randomUUID()}`;
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sales_kg_price_versions" },
        () => {
          queryClient.invalidateQueries({ queryKey: MONTH_QK });
          queryClient.invalidateQueries({ queryKey: VERSIONS_QK });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const resolved =
    monthRow ?? resolveKgPricesForMonth(BUILTIN_KG_PRICE_VERSIONS, year, month);
  const prices = resolved.prices;
  const isHistorical = resolved.isHistorical;

  const saveMutation = useMutation({
    mutationFn: async (input: {
      kind: KgPriceKind;
      price: number;
      effectiveFrom: string; // YYYY-MM-DD (month start)
      replaceSameDate?: boolean;
    }) => {
      if (!canManagePrices) throw new Error("غير مصرح بتعديل أسعار التارجت");
      const { data, error } = await supabase.rpc("upsert_sales_kg_price_version", {
        p_effective_from: input.effectiveFrom,
        p_price_kind: input.kind,
        p_new_price: input.price,
        p_replace_same_date: !!input.replaceSameDate,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: MONTH_QK }),
        queryClient.invalidateQueries({ queryKey: VERSIONS_QK }),
      ]);
    },
  });

  /** @deprecated Prefer savePriceVersion from the settings panel. */
  const updateMutation = useMutation({
    mutationFn: async (_patch: Partial<KgPrices>) => {
      throw new Error("تعديل الأسعار يتم فقط من لوحة إعدادات أسعار التارجت مع تاريخ سريان");
    },
  });

  return {
    prices,
    isHistorical,
    canEditPrices: false, // edits only via TargetKgPriceSettingsPanel
    canManagePrices,
    effectiveFrom: resolved.effective_from,
    versions,
    isLoading: monthLoading,
    savePriceVersion: saveMutation.mutateAsync,
    isSaving: saveMutation.isPending,
    updatePrices: updateMutation.mutateAsync,
  };
}
