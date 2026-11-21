import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AI_ALERTS_POLL_MS, canViewAiReports } from "@/config/aiReports";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
let cached = 0;
const listeners = new Set<(n: number) => void>();
let timer: ReturnType<typeof setInterval> | null = null;

const refresh = async () => {
  const { data, error } = await db.rpc("cm_ai_alerts_unread");
  if (error) return; // الميزة لسه مش متطبقة على القاعدة أو مفيش صلاحية: الجرس يفضل صفر من غير ضوضاء
  cached = Number(data ?? 0);
  listeners.forEach((l) => l(cached));
};

/** عدد التنبيهات الذكية المفتوحة (للجرس). طلب واحد كل دقيقة مشترك بين كل المكونات. */
export function useAiAlertsUnread() {
  const { roles } = useAuth();
  const enabled = canViewAiReports(roles);
  const [count, setCount] = useState(cached);
  useEffect(() => {
    if (!enabled) return;
    listeners.add(setCount);
    if (!timer) { refresh(); timer = setInterval(() => { if (document.visibilityState === "visible") refresh(); }, AI_ALERTS_POLL_MS); }
    return () => { listeners.delete(setCount); if (!listeners.size && timer) { clearInterval(timer); timer = null; } };
  }, [enabled]);
  return { enabled, count: enabled ? count : 0, refresh };
}
