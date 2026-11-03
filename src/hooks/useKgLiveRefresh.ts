import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * تحديث لحظي لعدادات الكيلو: اشتراك Realtime على orders (INSERT/UPDATE يشمل الإلغاء)
 * و order_items، مع إعادة جلب مؤجلة ~1.5 ثانية (ومرة ثانية بعد 5 ثوانٍ لالتقاط البنود
 * المسجلة بعد الأوردر). الاحتياطي: polling كل 30 ثانية + عند رجوع التركيز (في useQuery).
 */
export function useKgLiveRefresh(prefixes: string[], enabled = true) {
  const qc = useQueryClient();
  const key = prefixes.join("|");
  useEffect(() => {
    if (!enabled) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const bump = () => {
      timers.splice(0).forEach(clearTimeout);
      const run = () => prefixes.forEach((p) => qc.invalidateQueries({ queryKey: [p] }));
      timers.push(setTimeout(run, 1500), setTimeout(run, 5000));
    };
    const ch = supabase.channel(`kg-live-${key}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, bump)
      .on("postgres_changes", { event: "*", schema: "public", table: "order_items" }, bump)
      .subscribe();
    return () => { timers.forEach(clearTimeout); supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, qc]);
}
export const KG_POLL_MS = 30000;
