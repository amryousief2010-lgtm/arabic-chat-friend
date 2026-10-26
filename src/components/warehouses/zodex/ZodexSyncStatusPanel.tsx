import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";
import { ar } from "date-fns/locale";

export interface ZodexSyncHealth {
  last_data_at: string | null; last_full_success_at: string | null; last_login_failure_at: string | null;
  failures_24h: number; hung_runs: number; last_status: string | null; last_error: string | null;
  open_auto: number; open_review: number; open_blocked: number; open_no_order: number; open_suspect: number;
}

export type SyncState = "ok" | "unmatched" | "unreachable" | "stale";

/** Pure: separates "Zodex unreachable" from "completed with N unmatched". */
export function deriveSyncState(h: ZodexSyncHealth | null, now = Date.now()): SyncState {
  if (!h || !h.last_data_at) return "unreachable";
  const ageH = (now - new Date(h.last_data_at).getTime()) / 3_600_000;
  if (h.last_login_failure_at && new Date(h.last_login_failure_at) > new Date(h.last_data_at)) return "unreachable";
  if (ageH > 2) return "stale";
  if ((h.open_review + h.open_blocked + h.open_no_order) > 0) return "unmatched";
  return "ok";
}

const STATE_UI: Record<SyncState, { label: string; color: string; hint: string }> = {
  ok: { label: "المزامنة تعمل بانتظام", color: "#2E7D32", hint: "لا توجد بوالص معلّقة." },
  unmatched: { label: "المزامنة تعمل — توجد بوالص تحتاج مراجعة", color: "#F37346", hint: "راجعي القائمة بالأسفل." },
  stale: { label: "المزامنة متأخرة", color: "#F37346", hint: "آخر بيانات وصلت منذ أكثر من ساعتين. أُبلغ الدعم الفني تلقائيًا." },
  unreachable: { label: "تعذّر الدخول إلى زودكس", color: "#A4288A", hint: "مشكلة في بيانات الدخول أو الموقع — ليست مسؤوليتك؛ الدعم الفني يتابع." },
};

export default function ZodexSyncStatusPanel({ onHealth }: { onHealth?: (h: ZodexSyncHealth | null) => void }) {
  const [h, setH] = useState<ZodexSyncHealth | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data } = await (supabase as any).from("zodex_sync_health").select("*").maybeSingle();
      if (alive) { setH(data ?? null); onHealth?.(data ?? null); }
    };
    load();
    const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [onHealth]);
  const s = deriveSyncState(h);
  const ui = STATE_UI[s];
  const ago = (d: string | null) => (d ? formatDistanceToNow(new Date(d), { addSuffix: true, locale: ar }) : "—");
  return (
    <div dir="rtl" className="rounded-xl border p-4 flex flex-wrap items-center gap-4" style={{ borderInlineStartWidth: 6, borderInlineStartColor: ui.color }}>
      <div className="flex-[1.618] min-w-[220px]">
        <div className="font-bold text-lg" style={{ color: ui.color }}>{ui.label}</div>
        <div className="text-sm text-muted-foreground">{ui.hint}</div>
      </div>
      <div className="flex-1 grid grid-cols-2 gap-x-6 gap-y-1 text-sm min-w-[220px]">
        <span>آخر بيانات وصلت:</span><b>{ago(h?.last_data_at ?? null)}</b>
        <span>آخر مزامنة كاملة:</span><b>{ago(h?.last_full_success_at ?? null)}</b>
        <span>أخطاء آخر 24 ساعة:</span><b>{h?.failures_24h ?? "—"}</b>
        <span>تشغيلات معلّقة:</span><b>{h?.hung_runs ?? "—"}</b>
      </div>
    </div>
  );
}
