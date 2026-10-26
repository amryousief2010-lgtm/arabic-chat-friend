import { useCallback, useEffect, useState } from "react";
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
import { readCdrFiles, toCdrPayload, type CdrRow } from "@/lib/chatManagement/csvImport";
import { HotlineUsernamesCard } from "@/components/chatManagement/HotlineUsernamesCard";
import { RecordingUploadCard, uploadRecording } from "@/components/chatManagement/RecordingUploadCard";
import { maskPhone } from "@/lib/chatManagement/inbox";

const db = supabase as any;
interface Call { id: string; external_call_id: string | null; direction: string; started_at: string; duration_sec: number; status: string; phone_norm: string | null;
  moderator_id: string | null; recording_path: string | null; followed_up_at: string | null }
interface Missed { call_id: string; followup_at: string | null; followed_within_target: boolean }
const STATUS_AR: Record<string, string> = { answered: "تم الرد", missed: "فائتة", busy: "مشغول", failed: "فشل", voicemail: "بريد صوتي" };
const REASON_AR: Record<string, string> = { missing_id: "Cdr Id ناقص", duplicate_in_file: "مكرر داخل الملف", bad_direction: "اتجاه غير معروف",
  bad_started_at: "وقت غير صالح", bad_duration: "مدة غير صالحة", bad_phone: "رقم غير صالح" };
const fmt = (t: string) => new Date(t).toLocaleString("ar-EG", { timeZone: "Africa/Cairo", dateStyle: "short", timeStyle: "short" });

/** سجل مكالمات الخط الساخن: استيراد CDR يدوي (لا API لدى المزوّد)، متابعة الفائتة خلال ساعة، والاستماع المسجَّل. */
export default function ChatCalls() {
  const { roles } = useAuth() as { roles?: string[] };
  const [calls, setCalls] = useState<Call[]>([]);
  const [missed, setMissed] = useState<Record<string, Missed>>({});
  const [mods, setMods] = useState<Record<string, string>>({});
  const [audio, setAudio] = useState<{ id: string; url: string } | null>(null);

  const load = useCallback(async () => {
    const [c, m, md] = await Promise.all([
      db.from("cm_calls").select("id,external_call_id,direction,started_at,duration_sec,status,phone_norm,moderator_id,recording_path,followed_up_at").order("started_at", { ascending: false }).limit(300),
      db.from("cm_kpi_missed_calls_v").select("call_id,followup_at,followed_within_target").order("started_at", { ascending: false }).limit(300),
      db.from("cm_moderators").select("id,display_name"),
    ]);
    if (c.error) toast.error(`تعذّر التحميل: ${c.error.message}`);
    setCalls(c.data ?? []);
    setMissed(Object.fromEntries((m.data ?? []).map((x: Missed) => [x.call_id, x])));
    setMods(Object.fromEntries((md.data ?? []).map((x: { id: string; display_name: string }) => [x.id, x.display_name])));
  }, []);
  useEffect(() => { load(); }, [load]);

  const listen = async (c: Call) => {
    // كل استماع يُسجَّل أولاً في cm_recording_access_log؛ ثم رابط موقّع قصير العمر من التخزين الخاص.
    const { data, error } = await db.rpc("cm_request_recording_access", { _call_id: c.id });
    if (error) { toast.error(`غير مسموح أو لا يوجد تسجيل: ${error.message}`); return; }
    const s = await supabase.storage.from(data.bucket).createSignedUrl(data.path, data.expires_in);
    if (s.error || !s.data) { toast.error("تعذّر فتح التسجيل"); return; }
    setAudio({ id: c.id, url: s.data.signedUrl });
  };
  const markFollowed = async (c: Call) => {
    const { error } = await db.rpc("cm_mark_missed_call_followed_up", { _call_id: c.id });
    if (error) toast.error(error.message); else load();
  };
  const importRows = async (rows: CdrRow[]) => {
    const { data, error } = await db.rpc("cm_import_hotline_cdr", { _rows: rows.map(toCdrPayload) });
    if (error) { toast.error(`تعذّر الاستيراد: ${error.message}`); return null; }
    load();
    return `جديد ${data.inserted} — حُدِّث ${data.updated} — بلا تغيير ${data.unchanged} — مرفوض ${data.rejected.length}` +
      (data.rejected.length ? ` (${data.rejected.slice(0, 5).map((r: { row: number; cdr_id?: string; reason: string }) => `صف ${r.row}${r.cdr_id ? ` ${r.cdr_id}` : ""}: ${REASON_AR[r.reason] ?? r.reason}`).join("، ")})` : "") +
      (data.unknown_results?.length ? ` — نتائج غير معروفة (حُفظت كما هي): ${data.unknown_results.join("، ")}` : "") +
      (data.unmapped_usernames?.length ? ` — أسماء مستخدمين غير مربوطة بمودريتور: ${data.unmapped_usernames.join("، ")} (اربطيها بالأسفل)` : "");
  };

  return (
    <DashboardLayout>
      <div dir="rtl" className="space-y-4">
        <Header title="مكالمات الخط الساخن" subtitle="الفائتة يجب متابعتها خلال ساعة — بمكالمة أو رسالة أو تعليم يدوي" />
        {canImportCdr(roles) && (
          <CsvImportCard<CdrRow> title="استيراد سجل المكالمات (CDR)"
            description="ارفعي ملف zip كما نزل من البوابة (CDR.csv + Switched.csv) أو الملفين معاً. Cdr Id يمنع التكرار؛ إعادة الرفع تُحدِّث فقط. السجلات تختفي من البوابة بعد 5 أيام — الرفع كل يومين أو ثلاثة على الأكثر."
            columnsHint="CDR.csv: Cdr Id، A Number، B Number، Start Time (DD-MM-YYYY HH:MM:SS بتوقيت القاهرة)، Call Result، Call Duration (HH:MM:SS)، Call Direction. Switched.csv: Cdr Id، Username، Switching Status (ACCEPTED/MISSED). المكالمة فائتة إذا لم توجد محاولة ACCEPTED."
            accept=".zip,.csv,application/zip,text/csv" multiple maxBytes={20_000_000}
            loadFiles={async (files) => { const r = await readCdrFiles(files); return { ...r, notes: [
              ...(r.unknownResults.length ? [`نتائج Call Result غير معروفة (ستُحفظ كما هي): ${r.unknownResults.join("، ")}`] : []),
              ...(r.orphanSwitched ? [`${r.orphanSwitched} معرّف في Switched.csv بدون صف في CDR.csv (تم تجاهله)`] : []),
              ...(r.rows.length && !r.rows.some((x) => x.attempts.length) ? ["تنبيه: لا توجد بيانات Switched.csv — كل الواردة ستظهر فائتة"] : [])] }; }}
            previewHeaders={["Cdr Id", "الاتجاه", "البدء", "الحالة", "الرقم", "اسم المستخدم", "النتيجة"]}
            preview={(r) => [r.cdr_id, r.call_direction === "INBOUND" ? "وارد" : "صادر", r.start_time, STATUS_AR[r.preview.status], r.preview.phone ?? "—",
              r.preview.username ?? "—", (r.call_result ?? "—") + (r.preview.unknownResult ? " ⚠" : "")]}
            onImport={importRows} />)}
        {canManageHotlineUsernames(roles) && <HotlineUsernamesCard onChange={load} />}
        {canUploadRecordings(roles) && <RecordingUploadCard calls={calls} onDone={load} />}
        <Card><CardHeader><CardTitle>آخر المكالمات</CardTitle><CardDescription>{calls.length} مكالمة</CardDescription></CardHeader>
          <CardContent className="overflow-auto"><table className="w-full text-sm">
            <thead className="bg-muted"><tr>{["الوقت","الاتجاه","الحالة","الرقم","المدة","المودريتور","المتابعة",""].map((h, i) => <th key={i} className="p-2 text-right">{h}</th>)}</tr></thead>
            <tbody>{calls.map((c) => { const m = missed[c.id]; return (
              <tr key={c.id} className="border-t align-top">
                <td className="p-2 whitespace-nowrap">{fmt(c.started_at)}</td><td className="p-2">{c.direction === "inbound" ? "وارد" : "صادر"}</td>
                <td className="p-2"><Badge variant={c.status === "missed" ? "destructive" : "secondary"}>{STATUS_AR[c.status] ?? c.status}</Badge></td>
                <td className="p-2" dir="ltr">{maskPhone(c.phone_norm)}</td><td className="p-2">{Math.round(c.duration_sec / 60)} د</td>
                <td className="p-2">{c.moderator_id ? mods[c.moderator_id] ?? "—" : "—"}</td>
                <td className="p-2">{c.status !== "missed" || c.direction !== "inbound" ? "—" : m?.followed_within_target
                  ? <span className="text-green-700">خلال ساعة</span>
                  : <span className="flex items-center gap-2 text-[#F37346]">{m?.followup_at ? "متأخرة" : "لم تُتابَع"}
                      {!c.followed_up_at && <Button size="sm" variant="outline" onClick={() => markFollowed(c)}>تمت المتابعة</Button>}</span>}</td>
                <td className="p-2"><span className="flex items-center gap-1">{c.recording_path && canListenRecordings(roles) && (audio?.id === c.id
                  ? <audio controls autoPlay src={audio.url} className="h-8" />
                  : <Button size="sm" variant="outline" onClick={() => listen(c)}>استماع</Button>)}
                  {canUploadRecordings(roles) && <label className="cursor-pointer text-xs text-[#A4288A] underline">{c.recording_path ? "استبدال" : "رفع تسجيل"}
                    <input type="file" accept="audio/*" className="sr-only" aria-label="رفع تسجيل للمكالمة" onChange={async (e) => {
                      const f = e.target.files?.[0]; e.target.value = ""; if (!f) return;
                      const err = await uploadRecording(c.id, f); if (err) toast.error(err); else { toast.success("تم رفع التسجيل"); load(); } }} /></label>}</span></td>
              </tr>); })}
              {!calls.length && <tr><td colSpan={8} className="p-4 text-center text-muted-foreground">لا مكالمات بعد</td></tr>}
            </tbody></table>
            {canListenRecordings(roles) && <p className="mt-2 text-xs text-muted-foreground">كل استماع يُسجَّل باسمك ووقته، والرابط صالح لدقيقتين فقط.</p>}
          </CardContent></Card>
      </div>
    </DashboardLayout>
  );
}
