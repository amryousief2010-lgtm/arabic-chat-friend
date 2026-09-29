import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  type KgPrices,
  type KgPriceVersion,
  defaultKgPrices,
  BUILTIN_KG_PRICE_VERSIONS,
  CURRENT_KG_PRICE_EFFECTIVE_FROM,
  resolveKgPricesForMonth,
} from "@/lib/kgPrices";
import { currentCairoYearMonth } from "@/lib/cairoDate";

export type { KgPrices, KgPriceVersion };
export {
  defaultKgPrices,
  BUILTIN_KG_PRICE_VERSIONS,
  CURRENT_KG_PRICE_EFFECTIVE_FROM,
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

const QK = ["sales-kg-price-versions"];

/**
 * أسعار الكيلو المشتركة لصفحة التارجت فقط (لحوم / لحوم بالعظم / مصنعات).
 * المصدر الموحّد: جدول sales_kg_price_versions حسب effective_from.
 * التعديل من واجهة جدول البيان يحدّث إصدار 2026-09-01 ويُزامن الصف الواحد القديم.
 */
export function useKgPrices(period?: { year?: number; month?: number }) {
  const cur = currentCairoYearMonth();
  const year = period?.year ?? cur.year;
  const month = period?.month ?? cur.monthIndex0 + 1;
  const queryClient = useQueryClient();

  const { data: versions = BUILTIN_KG_PRICE_VERSIONS } = useQuery({
    queryKey: QK,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_kg_price_versions")
        .select("effective_from, meat_price, bone_meat_price, processed_price")
        .order("effective_from", { ascending: true });
      if (error) throw error;
      const rows = (data ?? []) as KgPriceVersion[];
      return rows.length > 0 ? rows : BUILTIN_KG_PRICE_VERSIONS;
    },
    staleTime: 60_000,
  });

  useEffect(() => {
    const channelName = `sales-kg-price-versions-realtime-${crypto.randomUUID()}`;
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sales_kg_price_versions" },
        () => queryClient.invalidateQueries({ queryKey: QK }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sales_kg_price_settings" },
        () => queryClient.invalidateQueries({ queryKey: QK }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const resolved = resolveKgPricesForMonth(versions, year, month);
  const prices = resolved.prices;
  const isHistorical = resolved.isHistorical;

  const updateMutation = useMutation({
    mutationFn: async (patch: Partial<KgPrices>) => {
      // Managers may only edit the current (Sep 2026+) version.
      const next: KgPrices = {
        meat_price: Number(patch.meat_price ?? prices.meat_price),
        bone_meat_price: Number(patch.bone_meat_price ?? prices.bone_meat_price),
        processed_price: Number(patch.processed_price ?? prices.processed_price),
      };

      const { error: verErr } = await supabase.from("sales_kg_price_versions").upsert(
        {
          effective_from: CURRENT_KG_PRICE_EFFECTIVE_FROM,
          ...next,
        },
        { onConflict: "effective_from" },
      );
      if (verErr) throw verErr;

      // Keep legacy singleton in sync so older readers stay consistent.
      const { data: singleton } = await supabase
        .from("sales_kg_price_settings")
        .select("id")
        .eq("singleton", true)
        .maybeSingle();

      if (singleton?.id) {
        const { error } = await supabase
          .from("sales_kg_price_settings")
          .update(next)
          .eq("id", singleton.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("sales_kg_price_settings")
          .insert({ singleton: true, ...next });
        if (error) throw error;
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QK }),
  });

  return {
    prices,
    isHistorical,
    canEditPrices: !isHistorical,
    effectiveFrom: resolved.effective_from,
    updatePrices: updateMutation.mutateAsync,
    isSaving: updateMutation.isPending,
  };
}

