import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface KgPrices {
  meat_price: number;
  bone_meat_price: number;
  processed_price: number;
}

export const defaultKgPrices: KgPrices = {
  meat_price: 390,
  bone_meat_price: 350,
  processed_price: 140,
};

const QK = ["sales-kg-prices"];

/**
 * أسعار الكيلو المشتركة (لحوم / لحوم بالعظم / مصنعات).
 * محفوظة في قاعدة البيانات، فأي تعديل ينعكس فورًا على كل جداول صفحة التارجت
 * ولكل المستخدمين، للشهر الحالي والشهور القادمة.
 */
export function useKgPrices() {
  const queryClient = useQueryClient();

  const { data: row } = useQuery({
    queryKey: QK,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_kg_price_settings")
        .select("id, meat_price, bone_meat_price, processed_price")
        .eq("singleton", true)
        .maybeSingle();
      if (error) throw error;
      return data as ({ id: string } & KgPrices) | null;
    },
    staleTime: 60_000,
  });

  useEffect(() => {
    // This hook is rendered by more than one table, and React development mode
    // also replays effects. A fresh topic per effect run prevents either case
    // from reusing an already-subscribed channel.
    const channelName = `sales-kg-prices-realtime-${crypto.randomUUID()}`;
    const channel = supabase
      .channel(channelName)
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

  const prices: KgPrices = {
    meat_price: Number(row?.meat_price ?? defaultKgPrices.meat_price),
    bone_meat_price: Number(row?.bone_meat_price ?? defaultKgPrices.bone_meat_price),
    processed_price: Number(row?.processed_price ?? defaultKgPrices.processed_price),
  };

  const updateMutation = useMutation({
    mutationFn: async (patch: Partial<KgPrices>) => {
      if (row?.id) {
        const { error } = await supabase
          .from("sales_kg_price_settings")
          .update(patch)
          .eq("id", row.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("sales_kg_price_settings")
          .insert({ singleton: true, ...prices, ...patch });
        if (error) throw error;
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QK }),
  });

  return { prices, updatePrices: updateMutation.mutateAsync, isSaving: updateMutation.isPending };
}
