import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Fetches the latest approved stocktaking session for a warehouse, if any.
 * Used by manual supply/dispatch dialogs to display a lock banner so users
 * understand that stock has been formally certified and manual edits are
 * subject to extra scrutiny.
 */
export function useStocktakingLock(warehouseId: string | null | undefined) {
  const [lock, setLock] = useState<{ sessionNo: string; approvedAt: string } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!warehouseId) { setLock(null); return; }
      setLoading(true);
      try {
        const { data } = await (supabase as any)
          .from("stocktaking_sessions")
          .select("session_no, approved_at")
          .eq("warehouse_id", warehouseId)
          .eq("status", "approved")
          .order("approved_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!cancelled) {
          setLock(data ? { sessionNo: data.session_no, approvedAt: data.approved_at } : null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [warehouseId]);

  return { lock, loading };
}
