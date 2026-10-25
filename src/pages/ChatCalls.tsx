import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { canImportCdr, canListenRecordings } from "@/config/chatManagement";
import { CsvImportCard } from "@/components/chatManagement/CsvImportCard";
import { mapCdr, type CdrRow } from "@/lib/chatManagement/csvImport";
import { maskPhone } from "@/lib/chatManagement/inbox";

const db = supabase as any;
interface Call { id: string; direction: string; started_at: string; duration_sec: number; status: string; phone_norm: string | null;
  moderator_id: string | null; recording_path: string | null; followed_up_at: string | null }
interface Missed { call_id: string; followup_at: string | null; followed_within_target: boolean }
const STATUS_AR: Record<string, string> = { answered: "تم الرد", missed: "فائتة", busy: "مشغول", failed: "فشل", voicemail: "بريد صوتي" };
const REASON_AR: Record<string, string> = { missing_id: "رقم المكالمة ناقص", bad_direction: "اتجاه غير معروف", bad_status: "حالة غير معروفة",
  bad_started_at: "وقت غير صالح", bad_duration: "مدة غير صالحة", bad_phone: "رقم غير صالح", recording_must_be_path: "التسجيل رابط وليس مساراً" };
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
      db.from("cm_calls").select("id,direction,started_at,duration_sec,status,phone_norm,moderator_id,recording_path,followed_up_at").order("started_at", { ascending: false }).limit(300),
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
    const { data, error } = await db.rpc("cm_import_hotline_cdr", { _rows: rows.map(({ phone_preview: _p, ...r }) => r) });
    if (error) { toast.error(`تعذّر الاستيراد: ${error.message}`); return null; }
    load();
    return `أضيف ${data.inserted} — مكرر (سبق استيراده) ${data.duplicates} — مرفوض ${data.rejected.length}` +
      (data.rejected.length ? ` (${data.rejected.slice(0, 5).map((r: { row: number; reason: string }) => `سطر ${r.row}: ${REASON_AR[r.reason] ?? r.reason}`).join("، ")})` : "");
  };

  return (
    <DashboardLayout>
      <div dir="rtl" className="space-y-4">
        <Header title="مكالمات الخط الساخن" subtitle="الفائتة يجب متابعتها خلال ساعة — بمكالمة أو رسالة أو تعليم يدوي" />
        {canImportCdr(roles) && (
          <CsvImportCard<CdrRow> title="استيراد سجل المكالمات (CDR)" description="نزّلي الملف من بوابة المزوّد وارفعيه هنا. إعادة رفع نفس الملف لا تكرر المكالمات."
            columnsHint="الأعمدة: call_id، direction، start، duration، status/disposition، caller، واختيارياً agent و line و recording (مسار داخل التخزين فقط، ليس رابطاً)."
            map={mapCdr} previewHeaders={["المعرّف", "الاتجاه", "الوقت", "الحالة", "الرقم", "المودريتور"]}
            preview={(r) => [r.external_call_id, r.direction === "inbound" ? "وارد" : "صادر", r.started_at, STATUS_AR[r.status] ?? r.status, r.phone_preview ?? r.phone, r.moderator ?? "—"]}
            onImport={importRows} />)}
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
                <td className="p-2">{c.recording_path && canListenRecordings(roles) && (audio?.id === c.id
                  ? <audio controls autoPlay src={audio.url} className="h-8" />
                  : <Button size="sm" variant="outline" onClick={() => listen(c)}>استماع</Button>)}</td>
              </tr>); })}
              {!calls.length && <tr><td colSpan={8} className="p-4 text-center text-muted-foreground">لا مكالمات بعد</td></tr>}
            </tbody></table>
            {canListenRecordings(roles) && <p className="mt-2 text-xs text-muted-foreground">كل استماع يُسجَّل باسمك ووقته، والرابط صالح لدقيقتين فقط.</p>}
          </CardContent></Card>
      </div>
    </DashboardLayout>
  );
}
