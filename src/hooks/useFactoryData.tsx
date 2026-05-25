import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMemo, useState } from "react";
import { useTestDataFilter } from "@/hooks/useTestDataFilter";

const TEST_TAG = /(TEST-DISPATCH|LIMITED-PILOT)/i;

export function useFactoryData(from: string, to: string) {
  const { includeTest } = useTestDataFilter();

  const meatQ = useQuery({
    queryKey: ["fac-meat", from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meat_factory_batches")
        .select("*")
        .gte("created_at", from + "T00:00:00Z")
        .lte("created_at", to + "T23:59:59Z")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
  const feedQ = useQuery({
    queryKey: ["fac-feed", from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("feed_production_batches")
        .select("*")
        .gte("created_at", from + "T00:00:00Z")
        .lte("created_at", to + "T23:59:59Z")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
  const meatConsQ = useQuery({
    queryKey: ["fac-meat-cons", from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meat_factory_batch_consumption")
        .select("*, meat_factory_batches!inner(batch_number,notes,created_at,status,product_name_ar)")
        .gte("meat_factory_batches.created_at", from + "T00:00:00Z")
        .lte("meat_factory_batches.created_at", to + "T23:59:59Z");
      if (error) throw error;
      return data || [];
    },
  });
  const meatPackQ = useQuery({
    queryKey: ["fac-meat-pack", from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meat_factory_batch_packaging")
        .select("*, meat_factory_batches!inner(batch_number,notes,created_at)")
        .gte("meat_factory_batches.created_at", from + "T00:00:00Z")
        .lte("meat_factory_batches.created_at", to + "T23:59:59Z");
      if (error) throw error;
      return data || [];
    },
  });
  const feedConsQ = useQuery({
    queryKey: ["fac-feed-cons", from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("feed_batch_consumption")
        .select("*, feed_production_batches!inner(batch_number,notes,created_at,status)")
        .gte("feed_production_batches.created_at", from + "T00:00:00Z")
        .lte("feed_production_batches.created_at", to + "T23:59:59Z");
      if (error) throw error;
      return data || [];
    },
  });
  const movsQ = useQuery({
    queryKey: ["fac-movs", from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_movements")
        .select("id,movement_no,movement_type,quantity,unit_cost,total_cost,reference_type,reference_id,reference,performed_at,created_at,item_id")
        .in("reference_type", ["meat_batch", "feed_batch"])
        .gte("created_at", from + "T00:00:00Z")
        .lte("created_at", to + "T23:59:59Z")
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return data || [];
    },
  });
  const itemsQ = useQuery({
    queryKey: ["fac-items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_items")
        .select("id,name,stock,reserved_qty,blocked_qty,unit_cost,low_stock_threshold,sku,item_code,module")
        .limit(1000);
      if (error) throw error;
      return data || [];
    },
    staleTime: 5 * 60 * 1000,
  });

  const filtered = useMemo(() => {
    const keep = (n?: string | null) => includeTest || !TEST_TAG.test(n || "");
    const meat = (meatQ.data || []).filter((b: any) => keep(b.notes));
    const feed = (feedQ.data || []).filter((b: any) => keep(b.notes));
    const mIds = new Set(meat.map((b: any) => b.id));
    const fIds = new Set(feed.map((b: any) => b.id));
    const meatCons = (meatConsQ.data || []).filter((c: any) => mIds.has(c.batch_id));
    const meatPack = (meatPackQ.data || []).filter((c: any) => mIds.has(c.batch_id));
    const feedCons = (feedConsQ.data || []).filter((c: any) => fIds.has(c.batch_id));
    const movs = (movsQ.data || []).filter((m: any) => {
      if (m.reference_type === "meat_batch") return mIds.has(m.reference_id);
      if (m.reference_type === "feed_batch") return fIds.has(m.reference_id);
      return false;
    });
    return { meat, feed, meatCons, meatPack, feedCons, movs };
  }, [meatQ.data, feedQ.data, meatConsQ.data, meatPackQ.data, feedConsQ.data, movsQ.data, includeTest]);

  return {
    ...filtered,
    items: itemsQ.data || [],
    isLoading: meatQ.isLoading || feedQ.isLoading || meatConsQ.isLoading || feedConsQ.isLoading || movsQ.isLoading,
  };
}
