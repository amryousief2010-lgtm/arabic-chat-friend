import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { OUTCOME_AR, ANALYSIS_STATUS_AR, speakerLabel, fmtSec, type CallAnalysisDetail } from "@/lib/chatManagement/callAnalysis";
import { BRAND } from "./brand";

const db = supabase as any;

/** نافذة تفاصيل المكالمة: التسجيل، الملخص، النية، النتيجة، الاعتراضات، تقييم التعامل، المتابعة، والتفريغ الكامل بالمتحدثين والتوقيت. */
export function CallAnalysisDialog({ callId, title, canListen, canAnalyze, onClose, onAnalyze, analyzing }: {
  callId: string | null; title: string; canListen: boolean; canAnalyze: boolean; onClose: () => void;
  onAnalyze: (id: string, force?: boolean) => Promise<void>; analyzing: boolean;
}) {
  const [d, setD] = useState<CallAnalysisDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioErr, setAudioErr] = useState<string | null>(null);

  useEffect(() => {
    setD(null); setAudioUrl(null); setAudioErr(null);
    if (!callId) return;
    let live = true; setLoading(true);
    db.rpc("cm_call_analysis_get", { _call_id: callId }).then(({ data }: { data: CallAnalysisDetail | null }) => {
      if (live) { setD(data && data.call_id ? data : null); setLoading(false); }
    });
    return () => { live = false; };
  }, [callId, analyzing]);

  const listen = async () => {
    if (!callId) return;
    const { data, error } = await db.rpc("cm_request_recording_access", { _call_id: callId });
    if (error) { setAudioErr("غير مسموح أو لا يوجد تسجيل"); return; }
    const s = await supabase.storage.from(data.bucket).createSignedUrl(data.path, data.expires_in);
    if (s.error || !s.data) { setAudioErr("تعذّر فتح التسجيل"); return; }
    setAudioUrl(s.data.signedUrl);
  };

  return (
    <Dialog open={!!callId} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent dir="rtl" className="max-h-[90vh] max-w-3xl overflow-y-auto text-right">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle>تفاصيل المكالمة</DialogTitle>
          <DialogDescription>{title}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          {canListen && (audioUrl ? <audio controls autoPlay src={audioUrl} className="h-9 w-full max-w-md" />
            : <Button size="sm" variant="outline" onClick={listen}>تشغيل التسجيل</Button>)}
          {audioErr && <span className="text-xs text-[#F37346]">{audioErr}</span>}
          {canAnalyze && callId && <Button size="sm" variant="outline" disabled={analyzing} onClick={() => onAnalyze(callId, d?.status === "done")}>
            {analyzing ? "جارٍ التحليل…" : d?.status === "done" ? "إعادة التحليل" : "تحليل"}</Button>}
        </div>

        {loading && <p className="text-sm text-muted-foreground">جارٍ التحميل…</p>}
        {!loading && !d && <p className="text-sm text-muted-foreground">لم تُحلَّل هذه المكالمة بعد.</p>}
        {d?.status === "error" && <p className="text-sm text-[#F37346]">فشل التحليل: {d.error}</p>}
        {d?.status === "pending" && <p className="text-sm text-muted-foreground">{ANALYSIS_STATUS_AR.pending}</p>}

        {d?.status === "done" && (<div className="space-y-4 text-sm">
          <div className="flex flex-wrap gap-2">
            {d.outcome && <Badge style={{ background: BRAND.purple }}>{OUTCOME_AR[d.outcome] ?? d.outcome}</Badge>}
            {d.followup_needed && <Badge style={{ background: BRAND.orange }}>متابعة مطلوبة</Badge>}
            {d.is_sales_inquiry === false && <Badge variant="outline">ليست استفسار مبيعات</Badge>}
            {d.handling_score != null && <Badge variant="outline">تقييم التعامل: {d.handling_score} من 5</Badge>}
          </div>
          <section><h4 className="mb-1 font-semibold" style={{ color: BRAND.purple }}>الملخص</h4><p>{d.summary_ar}</p></section>
          <section><h4 className="mb-1 font-semibold" style={{ color: BRAND.purple }}>نية العميل</h4><p>{d.caller_intent ?? "—"}</p></section>
          <section><h4 className="mb-1 font-semibold" style={{ color: BRAND.purple }}>الاعتراضات</h4>
            {d.objections?.length ? <ul className="list-disc pe-0 ps-5">{d.objections.map((o) => <li key={o}>{o}</li>)}</ul> : <p>لا توجد</p>}</section>
          <section><h4 className="mb-1 font-semibold" style={{ color: BRAND.purple }}>تقييم تعامل المودريتور{d.handling_score != null ? ` (${d.handling_score} من 5)` : ""}</h4>
            <p>{d.handling_notes ?? "—"}</p></section>
          {d.followup_needed && <section><h4 className="mb-1 font-semibold" style={{ color: BRAND.orange }}>سبب المتابعة</h4><p>{d.followup_reason ?? "—"}</p></section>}
          <section><h4 className="mb-1 font-semibold" style={{ color: BRAND.purple }}>التفريغ الكامل</h4>
            <div className="max-h-80 space-y-1 overflow-y-auto rounded border p-2" data-testid="call-transcript">
              {(d.transcript_segments ?? []).map((s, i) => { const lbl = speakerLabel(s.speaker, d.speaker_roles); return (
                <p key={i}><span className="font-mono text-xs text-muted-foreground" dir="ltr">{fmtSec(s.start)}</span>{" "}
                  <span className="font-semibold" style={{ color: lbl === "المودريتور" ? BRAND.magenta : BRAND.purple }}>{lbl}:</span> {s.text}</p>); })}
              {!d.transcript_segments?.length && <p className="text-muted-foreground">{d.transcript_text || "لا يوجد كلام مسموع"}</p>}
            </div></section>
          <p className="text-xs text-muted-foreground">التفريغ والتحليل آليان وقد يحتويان أخطاء؛ راجع التسجيل قبل أي قرار. النموذج: {d.asr_model} / {d.analysis_model}.</p>
        </div>)}
      </DialogContent>
    </Dialog>
  );
}
