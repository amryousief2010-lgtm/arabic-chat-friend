import { useCallback, useEffect, useRef, useState } from "react";
import { formatDateTime12 } from "@/lib/chatManagement/timeFormat";
import { toast } from "sonner";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { canImportCdr, canListenRecordings, canUploadRecordings, canManageHotlineUsernames } from "@/config/chatManagement";
import { CsvImportCard } from "@/components/chatManagement/CsvImportCard";
import { readCdrFiles, toCdrPayload, audioMimeFor, type CdrRow, type NestedRecording, type MatchableCall } from "@/lib/chatManagement/csvImport";
import { HotlineUsernamesCard } from "@/components/chatManagement/HotlineUsernamesCard";
import { RecordingUploadCard, uploadRecording } from "@/components/chatManagement/RecordingUploadCard";
import { CallAnalysisDialog } from "@/components/chatManagement/CallAnalysisDialog";
import { CallAnalysisStrip, type CallAnalysisKpis } from "@/components/chatManagement/KpiStrip";
import { OUTCOME_AR, ANALYSIS_STATUS_AR, type CallAnalysisRow } from "@/lib/chatManagement/callAnalysis";

const db = supabase as any;
interface Call { id: string; external_call_id: string | null; direction: string; started_at: string; duration_sec: number; status: string; phone_masked: string | null;
  has_phone: boolean; moderator_id: string | null; recording_path: string | null; followed_up_at: string | null; is_sales?: boolean; category?: string }
interface Filters { from: string; to: string; moderator: string; outcome: string; category: string }
interface Summary { calls: number; analyzed: number; avg_score: number | null; order_pct: number | null; open_followups: number }
const PAGE = 100;
const NO_FILTERS: Filters = { from: "", to: "", moderator: "", outcome: "", category: "" };
const CATEGORY_AR: Record<string, string> = { answered: "تم الرد", missed: "فائتة (مبيعات)", ivr: "انقطعت في القائمة الصوتية", non_sales: "غير المبيعات" };
const OUTCOME_FILTER_AR: Record<string, string> = { inquiry_only: "استفسار فقط", order_placed: "تم الطلب", order_promised: "وعد بالطلب",
  followup: "يحتاج متابعة", not_interested: "غير مهتم", complaint: "شكوى", other: "أخرى", followup_needed: "متابعة مطلوبة", not_analyzed: "لم تُحلَّل" };
const sel = "h-9 rounded-md border bg-background px-2 text-sm";
interface Missed { call_id: string; followup_at: string | null; followed_within_target: boolean }
const STATUS_AR: Record<string, string> = { answered: "تم الرد", missed: "فائتة", busy: "مشغول", failed: "فشل", voicemail: "بريد صوتي" };
const REASON_AR: Record<string, string> = { missing_id: "Cdr Id ناقص", duplicate_in_file: "مكرر داخل الملف", bad_direction: "اتجاه غير معروف",
  bad_started_at: "وقت غير صالح", bad_duration: "مدة غير صالحة", bad_phone: "رقم غير صالح" };
const fmt = (x: string) => formatDateTime12(x);

/** سجل مكالمات الخط الساخن: استيراد CDR يدوي (لا API لدى المزوّد)، متابعة الفائتة خلال ساعة، والاستماع المسجَّل. */
export default function ChatCalls() {
  const { roles } = useAuth() as { roles?: string[] };
  const [calls, setCalls] = useState<Call[]>([]);
  const [missed, setMissed] = useState<Record<string, Missed>>({});
  const [mods, setMods] = useState<Record<string, string>>({});
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [matchable, setMatchable] = useState<MatchableCall[]>([]);
  const [phones, setPhones] = useState<Record<string, string>>({});
  const [audio, setAudio] = useState<{ id: string; url: string } | null>(null);
  const [analysis, setAnalysis] = useState<Record<string, CallAnalysisRow>>({});
  const [objections, setObjections] = useState<{ objection: string; calls: number }[]>([]);
  const [openCall, setOpenCall] = useState<Call | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [batchMsg, setBatchMsg] = useState<string | null>(null);
  const isGM = (roles ?? []).includes("general_manager");
  const canAnalyze = canUploadRecordings(roles);

  const args = (f: Filters) => ({ _from: f.from || null, _to: f.to || null, _moderator: f.moderator || null, _outcome: f.outcome || null, _category: f.category || null });
  // تُحمَّل المكالمات حسب الفلتر من الخادم (كل مكالمات الموظفة مثلاً)، على صفحات من 100 مع «تحميل المزيد».
  const load = useCallback(async (more = false) => {
    const offset = more ? calls.length : 0;
    const [c, s, m, md] = await Promise.all([
      db.rpc("cm_calls_search", { ...args(filters), _limit: Math.max(PAGE, more ? PAGE : calls.length), _offset: offset }),
      db.rpc("cm_calls_search_summary", args(filters)),
      db.from("cm_kpi_missed_calls_v").select("call_id,followup_at,followed_within_target").order("started_at", { ascending: false }).limit(2000),
      db.from("cm_moderators").select("id,display_name"),
    ]);
    setSummary((s.data ?? [])[0] ?? null);
    // مطابقة ملفات التسجيل اليدوية بالرقم تحتاج الرقم الكامل — لمن يرفع التسجيلات فقط (مدير المبيعات/المدير العام).
    if (canUploadRecordings(roles)) {
      const mc = await db.from("cm_calls").select("id,external_call_id,phone_norm,started_at").order("started_at", { ascending: false }).limit(1000);
      setMatchable(mc.data ?? []);
    }
    const [an, ob] = await Promise.all([db.rpc("cm_call_analysis_list", {}), db.rpc("cm_kpi_call_objections", { _from: "2000-01-01", _to: "2100-01-01", _limit: 5 })]);
    setAnalysis(Object.fromEntries(((an.data ?? []) as CallAnalysisRow[]).map((x) => [x.call_id, x])));
    setObjections(ob.data ?? []);
    if (c.error) toast.error(`تعذّر التحميل: ${c.error.message}`);
    const rows = (c.data ?? []) as Call[];
    setCalls((prev) => (more ? [...prev, ...rows] : rows));
    setHasMore(rows.length >= (more ? PAGE : Math.max(PAGE, calls.length)));
    setMissed(Object.fromEntries((m.data ?? []).map((x: Missed) => [x.call_id, x])));
    setMods(Object.fromEntries((md.data ?? []).map((x: { id: string; display_name: string }) => [x.id, x.display_name])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, calls.length, roles]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [filters]);
  const setF = (k: keyof Filters, v: string) => { setCalls([]); setFilters((f) => ({ ...f, [k]: v })); };

  // إظهار الرقم الكامل: كل إظهار يُسجَّل في cm_phone_reveal_log باسمك ووقته (المدير العام/التنفيذي/مدير المبيعات).
  const reveal = async (c: Call) => {
    const { data, error } = await db.rpc("cm_reveal_call_phone", { _call_id: c.id });
    if (error) { toast.error(error.message.includes("CM_NO_PHONE") ? "لا يوجد رقم لهذه المكالمة" : "غير مسموح بإظهار الرقم"); return; }
    setPhones((p) => ({ ...p, [c.id]: data as string }));
  };
  const intl = (p: string) => (p.startsWith("0") ? "20" + p.slice(1) : p);
  const phoneCell = (c: Call) => phones[c.id]
    ? <span className="flex flex-wrap items-center gap-2"><span dir="ltr" className="font-mono">{phones[c.id]}</span>
        <a className="text-xs text-[#A4288A] underline" href={`tel:${phones[c.id]}`}>اتصال</a>
        <a className="text-xs text-green-700 underline" href={`https://wa.me/${intl(phones[c.id])}`} target="_blank" rel="noreferrer">واتساب</a>
        <button type="button" className="text-xs underline" onClick={() => navigator.clipboard?.writeText(phones[c.id]).then(() => toast.success("تم النسخ"))}>نسخ</button></span>
    : <span className="flex items-center gap-2"><span dir="ltr">{c.phone_masked ?? "—"}</span>
        {c.has_phone && canListenRecordings(roles) && <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-[#A4288A]" onClick={() => reveal(c)}>إظهار</Button>}</span>;

  const listen = async (c: Call) => {
    // كل استماع يُسجَّل أولاً في cm_recording_access_log؛ ثم رابط موقّع قصير العمر من التخزين الخاص.
    const { data, error } = await db.rpc("cm_request_recording_access", { _call_id: c.id });
    if (error) { toast.error(`غير مسموح أو لا يوجد تسجيل: ${error.message}`); return; }
    const s = await supabase.storage.from(data.bucket).createSignedUrl(data.path, data.expires_in);
    if (s.error || !s.data) { toast.error("تعذّر فتح التسجيل"); return; }
    setAudio({ id: c.id, url: s.data.signedUrl });
  };
  const analyzeOne = async (id: string, force = false) => {
    setBusy((b) => new Set(b).add(id));
    const { data, error } = await supabase.functions.invoke("cm-analyze-call", { body: { call_id: id, force } });
    setBusy((b) => { const n = new Set(b); n.delete(id); return n; });
    const r = data?.results?.[0];
    if (error || r?.status === "error") toast.error(`تعذّر التحليل: ${r?.error ?? error?.message ?? ""}`);
    else if (r?.status === "skipped") toast.info(r.reason === "already_done" ? "المكالمة محلَّلة مسبقاً" : "المكالمة غير قابلة للتحليل (ليست مبيعات أو بلا تسجيل)");
    else toast.success("تم تحليل المكالمة");
    load();
  };
  // «تحليل الكل» (المدير العام): دفعات صغيرة متتالية بسبب حد البوابة (5 تفريغات في الدقيقة).
  const analyzeAll = async () => {
    let total = 0, failed = 0;
    for (let round = 0; round < 40; round++) {
      setBatchMsg(`جارٍ التحليل… تم ${total}${failed ? `، فشل ${failed}` : ""}`);
      const { data, error } = await supabase.functions.invoke("cm-analyze-call", { body: { batch: true, limit: 4 } });
      if (error) { toast.error(`توقف التحليل: ${error.message}`); break; }
      total += (data.results ?? []).filter((x: { status: string }) => x.status === "done").length;
      failed += (data.results ?? []).filter((x: { status: string }) => x.status === "error").length;
      load();
      if (!data.processed || !data.remaining) break;
      await new Promise((ok) => setTimeout(ok, 45_000));
    }
    setBatchMsg(null); toast.success(`اكتمل التحليل: ${total} مكالمة${failed ? `، فشل ${failed}` : ""}`);
  };
  const done = Object.values(analysis).filter((a) => a.status === "done");
  const scored = done.filter((a) => a.handling_score != null);
  const kpis: CallAnalysisKpis = {
    analyzed: done.length,
    avgScore: scored.length ? scored.reduce((s, a) => s + (a.handling_score ?? 0), 0) / scored.length : null,
    orderPct: done.length ? (100 * done.filter((a) => a.order_placed_or_promised).length) / done.length : null,
    openFollowups: done.filter((a) => a.followup_needed && !calls.find((c) => c.id === a.call_id)?.followed_up_at).length,
    topObjections: objections,
  };
  const markFollowed = async (c: Call) => {
    const { error } = await db.rpc("cm_mark_missed_call_followed_up", { _call_id: c.id });
    if (error) toast.error(error.message); else load();
  };
  // تسجيلات callRecords.zip المتداخلة في zip البوابة — تُرفع بعد الاستيراد عبر نفس مسار رفع التسجيلات (SM/GM فقط).
  const nestedRecs = useRef<NestedRecording[]>([]);
  const uploadNested = async (rows: CdrRow[]): Promise<string> => {
    const ids = new Set(rows.map((r) => r.cdr_id)); const recs = nestedRecs.current.filter((r) => ids.has(r.cdrId));
    if (!recs.length || !canUploadRecordings(roles)) return "";
    const { data: cs, error } = await db.from("cm_calls").select("id,external_call_id,recording_path").in("external_call_id", recs.map((r) => r.cdrId));
    if (error) return ` — تعذّر رفع التسجيلات: ${error.message}`;
    type RecCall = { id: string; external_call_id: string; recording_path: string | null };
    const byId = new Map<string, RecCall>(((cs ?? []) as RecCall[]).map((c) => [c.external_call_id, c]));
    let up = 0, had = 0; const fails: string[] = [];
    for (const r of recs) {
      const c = byId.get(r.cdrId); if (!c) { fails.push(`${r.name}: لا مكالمة`); continue; }
      if (c.recording_path) { had++; continue; }
      const e = await uploadRecording(c.id, new Blob([r.data as Uint8Array<ArrayBuffer>], { type: audioMimeFor(r.name)! }), r.name);
      if (e) fails.push(e); else up++;
    }
    return ` — التسجيلات: رُفع ${up}، موجود مسبقاً ${had}` + (fails.length ? `، فشل ${fails.length} (${fails.slice(0, 3).join("، ")})` : "");
  };
  const importRows = async (rows: CdrRow[]) => {
    const { data, error } = await db.rpc("cm_import_hotline_cdr", { _rows: rows.map(toCdrPayload) });
    if (error) { toast.error(`تعذّر الاستيراد: ${error.message}`); return null; }
    const recMsg = await uploadNested(rows);
    load();
    return `جديد ${data.inserted} — حُدِّث ${data.updated} — بلا تغيير ${data.unchanged} — مرفوض ${data.rejected.length}` +
      (data.rejected.length ? ` (${data.rejected.slice(0, 5).map((r: { row: number; cdr_id?: string; reason: string }) => `صف ${r.row}${r.cdr_id ? ` ${r.cdr_id}` : ""}: ${REASON_AR[r.reason] ?? r.reason}`).join("، ")})` : "") +
      (data.unknown_results?.length ? ` — نتائج غير معروفة (حُفظت كما هي): ${data.unknown_results.join("، ")}` : "") +
      (data.unmapped_usernames?.length ? ` — أسماء مستخدمين غير مربوطة بمودريتور: ${data.unmapped_usernames.join("، ")} (اربطيها بالأسفل)` : "") + recMsg;
  };

  return (
    <DashboardLayout>
      <div dir="rtl" className="space-y-4">
        <Header title="مكالمات الخط الساخن" subtitle="الفائتة يجب متابعتها خلال ساعة — بمكالمة أو رسالة أو تعليم يدوي" />
        {canImportCdr(roles) && (
          <CsvImportCard<CdrRow> title="استيراد سجل المكالمات (CDR)"
            description="ارفعي ملف zip كما نزل من البوابة (CDR.csv + Switched.csv) أو الملفين معاً؛ تسجيلات callRecords.zip داخله تُرفع تلقائياً. Cdr Id يمنع التكرار؛ إعادة الرفع تُحدِّث فقط. السجلات تختفي من البوابة بعد 5 أيام — الرفع كل يومين أو ثلاثة على الأكثر."
            columnsHint={<><p>ملف السجل <code dir="ltr" className="font-mono">CDR.csv</code>: رقم المكالمة <code dir="ltr" className="font-mono">Cdr Id</code>، رقم المتصل <code dir="ltr" className="font-mono">A Number</code>، الرقم المطلوب <code dir="ltr" className="font-mono">B Number</code>، وقت البدء <code dir="ltr" className="font-mono">Start Time</code> بصيغة <code dir="ltr" className="font-mono">DD-MM-YYYY HH:MM:SS</code> بتوقيت القاهرة، النتيجة <code dir="ltr" className="font-mono">Call Result</code>، المدة <code dir="ltr" className="font-mono">Call Duration</code>، الاتجاه <code dir="ltr" className="font-mono">Call Direction</code>.</p><p>ملف التحويل <code dir="ltr" className="font-mono">Switched.csv</code>: <code dir="ltr" className="font-mono">Cdr Id</code>، اسم المستخدم <code dir="ltr" className="font-mono">Username</code>، حالة التحويل <code dir="ltr" className="font-mono">Switching Status</code> (رُدّ عليها <code dir="ltr" className="font-mono">ACCEPTED</code> أو فائتة <code dir="ltr" className="font-mono">MISSED</code>). تُعدّ المكالمة فائتة إذا لم تُقبل في أي محاولة.</p></>}
            accept=".zip,.csv,application/zip,text/csv" multiple maxBytes={200_000_000}
            loadFiles={async (files) => { const r = await readCdrFiles(files); nestedRecs.current = r.recordings; return { ...r, notes: [
              ...(r.recordings.length ? [`${r.recordings.length} تسجيل في callRecords.zip — ${canUploadRecordings(roles) ? "تُرفع تلقائياً بعد الاستيراد وتُربط بـ Cdr Id" : "لن تُرفع (الرفع لمدير المبيعات/المدير العام فقط)"}`] : []),
              ...(r.unknownResults.length ? [`نتائج Call Result غير معروفة (ستُحفظ كما هي): ${r.unknownResults.join("، ")}`] : []),
              ...(r.orphanSwitched ? [`${r.orphanSwitched} معرّف في Switched.csv بدون صف في CDR.csv (تم تجاهله)`] : []),
              ...(r.rows.length && !r.rows.some((x) => x.attempts.length) ? ["تنبيه: لا توجد بيانات Switched.csv — كل الواردة ستظهر فائتة"] : [])] }; }}
            previewHeaders={["Cdr Id", "الاتجاه", "البدء", "الحالة", "الرقم", "اسم المستخدم", "النتيجة"]}
            preview={(r) => [r.cdr_id, r.call_direction === "INBOUND" ? "وارد" : "صادر", r.start_time, STATUS_AR[r.preview.status], r.preview.phone ?? "—",
              r.preview.username ?? "—", (r.call_result ?? "—") + (r.preview.unknownResult ? " ⚠" : "")]}
            onImport={importRows} />)}
        {canManageHotlineUsernames(roles) && <HotlineUsernamesCard onChange={() => load()} />}
        {canUploadRecordings(roles) && <RecordingUploadCard calls={matchable} onDone={() => load()} />}
        {canListenRecordings(roles) && <CallAnalysisStrip k={kpis} />}
        <Card><CardContent className="space-y-3 pt-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs">الموظفة<select className={sel} value={filters.moderator} onChange={(e) => setF("moderator", e.target.value)}>
              <option value="">الكل</option>{Object.entries(mods).sort((a, b) => a[1].localeCompare(b[1], "ar")).map(([id, n]) => <option key={id} value={id}>{n}</option>)}<option value="none">غير مرتبطة بموظفة</option></select></label>
            <label className="flex flex-col gap-1 text-xs">نتيجة التحليل<select className={sel} value={filters.outcome} onChange={(e) => setF("outcome", e.target.value)}>
              <option value="">الكل</option>{Object.entries(OUTCOME_FILTER_AR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="flex flex-col gap-1 text-xs">الحالة<select className={sel} value={filters.category} onChange={(e) => setF("category", e.target.value)}>
              <option value="">الكل</option>{Object.entries(CATEGORY_AR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="flex flex-col gap-1 text-xs">من تاريخ<input type="date" className={sel} value={filters.from} onChange={(e) => setF("from", e.target.value)} /></label>
            <label className="flex flex-col gap-1 text-xs">إلى تاريخ<input type="date" className={sel} value={filters.to} onChange={(e) => setF("to", e.target.value)} /></label>
            <Button size="sm" variant="outline" onClick={() => { setCalls([]); setFilters(NO_FILTERS); }}>مسح الفلاتر</Button>
          </div>
          {summary && <div className="grid grid-cols-2 gap-2 text-center text-sm md:grid-cols-4">
            <div className="rounded-md border p-2"><div className="text-lg font-bold">{summary.calls}</div><div className="text-xs text-muted-foreground">مكالمة مطابقة (المحلَّلة {summary.analyzed})</div></div>
            <div className="rounded-md border p-2"><div className="text-lg font-bold">{summary.avg_score ?? "—"}</div><div className="text-xs text-muted-foreground">متوسط تقييم التعامل (من 5)</div></div>
            <div className="rounded-md border p-2"><div className="text-lg font-bold">{summary.order_pct != null ? `${summary.order_pct}%` : "—"}</div><div className="text-xs text-muted-foreground">وصلت لطلب أو وعد (من المحلَّلة)</div></div>
            <div className="rounded-md border p-2"><div className="text-lg font-bold">{summary.open_followups}</div><div className="text-xs text-muted-foreground">متابعات مطلوبة مفتوحة</div></div>
          </div>}
        </CardContent></Card>
        <Card><CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0"><div><CardTitle>المكالمات</CardTitle><CardDescription>معروض {calls.length} من {summary?.calls ?? calls.length} — اضغط على أي مكالمة لعرض التفريغ والتحليل</CardDescription></div>
          {isGM && <Button size="sm" disabled={!!batchMsg} onClick={analyzeAll} className="bg-[#662D8C] text-white">{batchMsg ?? "تحليل الكل"}</Button>}</CardHeader>
          <CardContent className="overflow-auto"><table className="w-full text-sm">
            <thead className="bg-muted"><tr>{["الوقت","الاتجاه","الحالة","الرقم","المدة","المودريتور","المتابعة","التحليل",""].map((h, i) => <th key={i} className="p-2 text-right">{h}</th>)}</tr></thead>
            <tbody>{calls.map((c) => { const m = missed[c.id]; return (
              <tr key={c.id} className="cursor-pointer border-t align-top hover:bg-muted/50" onClick={() => setOpenCall(c)}>
                <td className="p-2 whitespace-nowrap">{fmt(c.started_at)}</td><td className="p-2">{c.direction === "inbound" ? "وارد" : "صادر"}</td>
                <td className="p-2"><Badge variant={c.status === "missed" ? "destructive" : "secondary"}>{STATUS_AR[c.status] ?? c.status}</Badge>{c.is_sales === false && <Badge variant="outline" className="ms-1">غير المبيعات</Badge>}{c.category === "ivr" && <Badge variant="outline" className="ms-1">القائمة الصوتية</Badge>}</td>
                <td className="p-2" onClick={(e) => e.stopPropagation()}>{phoneCell(c)}</td><td className="p-2">{Math.round(c.duration_sec / 60)} د</td>
                <td className="p-2">{c.moderator_id ? mods[c.moderator_id] ?? "—" : "—"}</td>
                <td className="p-2" onClick={(e) => e.stopPropagation()}>{c.status !== "missed" || c.direction !== "inbound" || c.is_sales === false ? "—" : m?.followed_within_target
                  ? <span className="text-green-700">خلال ساعة</span>
                  : <span className="flex items-center gap-2 text-[#F37346]">{m?.followup_at ? "متأخرة" : "لم تُتابَع"}
                      {!c.followed_up_at && <Button size="sm" variant="outline" onClick={() => markFollowed(c)}>تمت المتابعة</Button>}</span>}</td>
                <td className="p-2" onClick={(e) => e.stopPropagation()}>{(() => { const a = analysis[c.id]; return (
                  <span className="flex flex-wrap items-center gap-1">
                    {a?.status === "done" && a.outcome && <Badge className="bg-[#662D8C]">{OUTCOME_AR[a.outcome] ?? a.outcome}</Badge>}
                    {a?.status === "done" && a.handling_score != null && <Badge variant="outline">{a.handling_score}/5</Badge>}
                    {a?.status === "done" && a.followup_needed && <Badge className="bg-[#F37346]">متابعة مطلوبة</Badge>}
                    {a && a.status !== "done" && <Badge variant={a.status === "error" ? "destructive" : "secondary"} title={a.error ?? undefined}>{ANALYSIS_STATUS_AR[a.status]}</Badge>}
                    {canAnalyze && c.recording_path && c.is_sales !== false && a?.status !== "done" &&
                      <Button size="sm" variant="outline" disabled={busy.has(c.id)} onClick={() => analyzeOne(c.id)}>{busy.has(c.id) ? "جارٍ…" : "تحليل"}</Button>}
                  </span>); })()}</td>
                <td className="p-2" onClick={(e) => e.stopPropagation()}><span className="flex items-center gap-1">{c.recording_path && canListenRecordings(roles) && (audio?.id === c.id
                  ? <audio controls autoPlay src={audio.url} className="h-8" />
                  : <Button size="sm" variant="outline" onClick={() => listen(c)}>استماع</Button>)}
                  {canUploadRecordings(roles) && <label className="cursor-pointer text-xs text-[#A4288A] underline">{c.recording_path ? "استبدال" : "رفع تسجيل"}
                    <input type="file" accept="audio/*" className="sr-only" aria-label="رفع تسجيل للمكالمة" onChange={async (e) => {
                      const f = e.target.files?.[0]; e.target.value = ""; if (!f) return;
                      const err = await uploadRecording(c.id, f); if (err) toast.error(err); else { toast.success("تم رفع التسجيل"); load(); } }} /></label>}</span></td>
              </tr>); })}
              {!calls.length && <tr><td colSpan={9} className="p-4 text-center text-muted-foreground">لا توجد مكالمات مطابقة</td></tr>}
            </tbody></table>
            {hasMore && <div className="mt-3 text-center"><Button size="sm" variant="outline" onClick={() => load(true)}>تحميل المزيد</Button></div>}
            {canListenRecordings(roles) && <p className="mt-2 text-xs text-muted-foreground">زر «إظهار» يعرض رقم العميل كاملاً مع روابط الاتصال والواتساب، وكل إظهار يُسجَّل باسمك ووقته.</p>}
            {canListenRecordings(roles) && <p className="mt-2 text-xs text-muted-foreground">كل استماع يُسجَّل باسمك ووقته، والرابط صالح لدقيقتين فقط.</p>}
          </CardContent></Card>
        <CallAnalysisDialog callId={openCall?.id ?? null} onClose={() => setOpenCall(null)}
          title={openCall ? `${fmt(openCall.started_at)} — ${openCall.moderator_id ? mods[openCall.moderator_id] ?? "—" : "بدون مودريتور"} — ${Math.round(openCall.duration_sec / 60)} د` : ""}
          canListen={!!openCall?.recording_path && canListenRecordings(roles)} canAnalyze={canAnalyze && !!openCall?.recording_path && openCall?.is_sales !== false}
          analyzing={!!openCall && busy.has(openCall.id)} onAnalyze={analyzeOne} />
      </div>
    </DashboardLayout>
  );
}
