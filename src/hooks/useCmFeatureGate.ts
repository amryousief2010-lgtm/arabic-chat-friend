import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CM_GATE_DEFAULT_MODE, type CmAccessMode } from "@/config/chatManagement";

/** حالة بوابة «إدارة المحادثات» تُقرأ مرة واحدة لكل جلسة (كاش على مستوى الوحدة). أي خطأ ⇒ GM فقط. */
let cached: CmAccessMode | null = null;
let inflight: Promise<CmAccessMode> | null = null;
const listeners = new Set<(m: CmAccessMode) => void>();

export const loadCmGateMode = (): Promise<CmAccessMode> => {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = (async () => {
      try {
        const { data, error } = await (supabase as any).from("cm_feature_gate").select("access_mode").maybeSingle();
        const m = !error && data?.access_mode === "roles" ? "roles" : CM_GATE_DEFAULT_MODE;
        cached = m;
        return m;
      } catch {
        cached = CM_GATE_DEFAULT_MODE;
        return CM_GATE_DEFAULT_MODE;
      } finally {
        inflight = null;
      }
    })();
  }
  return inflight;
};

/** بعد تغيير المدير العام للوضع من الإعدادات. */
export const setCmGateModeCache = (m: CmAccessMode) => {
  cached = m;
  listeners.forEach((l) => l(m));
};
/** للاختبارات / تسجيل الخروج. */
export const resetCmGateCache = () => { cached = null; inflight = null; };

export function useCmFeatureGate(enabled = true): { mode: CmAccessMode; loading: boolean } {
  const [mode, setMode] = useState<CmAccessMode | null>(cached);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    listeners.add(setMode);
    if (!cached) loadCmGateMode().then((m) => alive && setMode(m));
    return () => { alive = false; listeners.delete(setMode); };
  }, [enabled]);
  return { mode: mode ?? CM_GATE_DEFAULT_MODE, loading: enabled && mode === null };
}
