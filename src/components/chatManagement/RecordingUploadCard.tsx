import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { audioMimeFor, matchRecording, RECORDING_MAX_BYTES, type MatchableCall } from "@/lib/chatManagement/csvImport";
import { FilePickButton } from "./FilePickButton";

const db = supabase as any;

/** رفع تسجيل واحد عبر تذكرة الخادم: cm_begin_recording_upload (تحقق الدور/النوع/الحجم + تدقيق) ← رفع للمسار المحجوز في الـ bucket الخاص ← cm_complete_recording_upload. */
export async function uploadRecording(callId: string, file: Blob & { name?: string }, nameOverride?: string): Promise<string | null> {
  const name = nameOverride ?? file.name ?? "recording";
  const mime = audioMimeFor(name) ?? (file.type.startsWith("audio/") ? file.type : null);
  if (!mime) return `${name}: نوع غير مدعوم (mp3/m4a/aac/wav/ogg/opus/webm/amr/3gp)`;
  if (file.size <= 0 || file.size > RECORDING_MAX_BYTES) return `${name}: الحجم يجب أن يكون حتى 50 ميجا`;
  const t = await db.rpc("cm_begin_recording_upload", { _call_id: callId, _mime: mime, _size_bytes: file.size, _original_name: name });
  if (t.error) return `${name}: ${t.error.message}`;
  const up = await supabase.storage.from(t.data.bucket).upload(t.data.path, file, { contentType: mime, upsert: false });
  if (up.error) return `${name}: تعذّر الرفع (${up.error.message})`;
  const done = await db.rpc("cm_complete_recording_upload", { _upload_id: t.data.upload_id });
  return done.error ? `${name}: ${done.error.message}` : null;
}

interface Planned { name: string; blob: Blob; call: MatchableCall | null; reason?: string }

/** رفع جماعي (ملفات صوت أو zip) ومطابقتها بالمكالمات: Cdr Id في اسم الملف، وإلا الرقم + الوقت. SM/GM فقط. */
export function RecordingUploadCard({ calls, onDone }: { calls: MatchableCall[]; onDone: () => void }) {
  const [plan, setPlan] = useState<Planned[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const onFiles = async (list: FileList | null) => {
    setLog([]); const out: Planned[] = [];
    for (const f of Array.from(list ?? [])) {
      if (/\.zip$/i.test(f.name)) {
        const { unzipSync } = await import("fflate");
        const entries = unzipSync(new Uint8Array(await f.arrayBuffer()), { filter: (e) => !!audioMimeFor(e.name) && !(e.originalSize > RECORDING_MAX_BYTES) });
        for (const [n, d] of Object.entries(entries)) {
          const name = n.split("/").pop()!; const m = matchRecording(name, calls);
          out.push({ name, blob: new Blob([d as Uint8Array<ArrayBuffer>], { type: audioMimeFor(name)! }), call: m.call, reason: m.reason });
        }
      } else { const m = matchRecording(f.name, calls); out.push({ name: f.name, blob: f, call: m.call, reason: m.reason }); }
    }
    setPlan(out);
  };
  const ok = plan?.filter((p) => p.call) ?? [];
  return (
    <Card>
      <CardHeader><CardTitle>رفع تسجيلات المكالمات</CardTitle>
        <CardDescription>صدّري التسجيلات من البوابة بأي طريقة وارفعيها هنا (ملفات أو zip). تُحفظ في تخزين خاص، وكل رفع يُسجَّل في سجل التدقيق. للرفع لمكالمة محددة استخدمي «رفع تسجيل» في الجدول.</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs leading-relaxed text-muted-foreground">طريقة المطابقة: رقم المكالمة (<code dir="ltr" className="font-mono">Cdr Id</code>) داخل اسم الملف، مثل <code dir="ltr" className="font-mono">CDR.260901.120000.0000001.mp3</code>؛ أو رقم العميل مع وقت المكالمة بفارق دقيقتين على الأكثر، مثل <code dir="ltr" className="font-mono">01000000001_20260901_120000.mp3</code>. الحد الأقصى ٥٠ ميجا للملف.</p>
        <FilePickButton multiple accept="audio/*,.zip,application/zip" ariaLabel="ملفات التسجيلات" label="اختيار التسجيلات" onFiles={(l) => onFiles(l)} />
        {plan && (<>
          <p className="text-sm">مطابق: <b>{ok.length}</b> — غير مطابق: <b className="text-[#F37346]">{plan.length - ok.length}</b></p>
          <ul className="max-h-40 overflow-auto text-xs">{plan.slice(0, 100).map((p, i) => (
            <li key={i} className={p.call ? "" : "text-[#F37346]"}>{p.name} ← {p.call ? (p.call.external_call_id ?? p.call.id) : p.reason}</li>))}</ul>
          <Button disabled={busy || !ok.length} className="bg-[#A4288A] hover:bg-[#662D8C] text-white" onClick={async () => {
            setBusy(true); const errs: string[] = [];
            for (const p of ok) { const e = await uploadRecording(p.call!.id, p.blob, p.name); if (e) errs.push(e); }
            setBusy(false); setPlan(null); setLog([`تم رفع ${ok.length - errs.length} من ${ok.length}`, ...errs]); onDone();
          }}>رفع {ok.length} تسجيل</Button></>)}
        {log.map((l, i) => <p key={i} role="status" className={i ? "text-xs text-[#F37346]" : "text-sm"}>{l}</p>)}
      </CardContent>
    </Card>
  );
}
