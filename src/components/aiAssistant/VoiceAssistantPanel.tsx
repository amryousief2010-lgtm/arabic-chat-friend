import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Mic, Square, Volume2, Send, ShieldCheck, AlertTriangle, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { BRAND } from "@/config/aiReports";
import { pickRecorderMime, VOICE_MAX_SECONDS, VOICE_SUGGESTIONS } from "@/config/voiceAssistant";

type Citation = { tool: string; label: string; path: string; period: string | null };
type Turn = {
  id: string;
  transcript: string;
  answer: string;
  audio: string | null;
  citations: Citation[];
  unverified: number[];
  costUsd: number | null;
  totalMs: number | null;
};
type Phase = "idle" | "recording" | "thinking" | "speaking";

const blobToBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]+,/, ""));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

async function invokeVoice(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("ai-assistant-chat", { body });
  if (error) {
    let msg: string | null = null;
    try {
      const ctx = (error as any)?.context;
      if (ctx?.json) msg = (await ctx.json())?.error ?? null;
      else if (ctx?.body) msg = JSON.parse(ctx.body)?.error ?? null;
    } catch { /* ignore */ }
    throw new Error(msg || "تعذّر الاتصال بالمساعد.");
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

/** زر المايك: دوسة تبدأ ودوسة تبعت، أو اضغط مطوّل واتكلم وسيب. */
export default function VoiceAssistantPanel() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [remaining, setRemaining] = useState<number | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const pressAtRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stopTracks = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
  };
  useEffect(() => () => { stopTracks(); audioRef.current?.pause(); }, []);

  const play = useCallback((b64: string | null) => {
    if (!b64) return;
    audioRef.current?.pause();
    const a = new Audio(`data:audio/mpeg;base64,${b64}`);
    audioRef.current = a;
    setPhase("speaking");
    a.onended = () => setPhase("idle");
    a.onerror = () => setPhase("idle");
    a.play().catch(() => setPhase("idle"));
  }, []);

  const handleResult = useCallback((data: any) => {
    const turn: Turn = {
      id: crypto.randomUUID(),
      transcript: data.transcript,
      answer: data.answer_text,
      audio: data.audio_base64 ?? null,
      citations: data.citations ?? [],
      unverified: data.unverified_numbers ?? [],
      costUsd: data.usage?.cost_usd ?? null,
      totalMs: data.usage?.timing?.total_ms ?? null,
    };
    setTurns((t) => [turn, ...t].slice(0, 20));
    if (typeof data.limits?.remaining === "number") setRemaining(data.limits.remaining);
    if (turn.audio) play(turn.audio);
    else setPhase("idle");
  }, [play]);

  const send = useCallback(async (body: Record<string, unknown>) => {
    setPhase("thinking");
    setError("");
    try {
      handleResult(await invokeVoice(body));
    } catch (e: any) {
      setError(e?.message || "حصلت مشكلة. جرّب تاني.");
      setPhase("idle");
    }
  }, [handleResult]);

  const stopRecording = useCallback(() => {
    const rec = recRef.current;
    if (rec && rec.state === "recording") rec.stop();
  }, []);

  const startRecording = useCallback(async () => {
    setError("");
    audioRef.current?.pause();
    const mime = pickRecorderMime();
    if (!navigator.mediaDevices?.getUserMedia || !mime) {
      setError("المتصفح ده مش بيدعم تسجيل الصوت. اكتب سؤالك تحت.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      streamRef.current = stream;
      const rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 32000 });
      recRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (ev) => ev.data.size && chunksRef.current.push(ev.data);
      rec.onstop = async () => {
        stopTracks();
        const blob = new Blob(chunksRef.current, { type: mime });
        if (blob.size < 2000) { setPhase("idle"); setError("التسجيل قصير. اضغط واتكلم."); return; }
        send({ kind: "voice", audio_base64: await blobToBase64(blob), mime });
      };
      rec.start(250);
      setSeconds(0);
      setPhase("recording");
      const startedAt = Date.now();
      timerRef.current = window.setInterval(() => {
        const s = Math.floor((Date.now() - startedAt) / 1000);
        setSeconds(s);
        if (s >= VOICE_MAX_SECONDS) stopRecording();
      }, 250);
    } catch {
      setError("مقدرتش أفتح المايك. اسمح للموقع باستخدام الميكروفون من إعدادات المتصفح.");
      setPhase("idle");
    }
  }, [send, stopRecording]);

  const onPointerDown = () => {
    pressAtRef.current = Date.now();
    if (phase === "idle" || phase === "speaking") startRecording();
    else if (phase === "recording") stopRecording();
  };
  const onPointerUp = () => {
    // ضغط مطوّل (أكتر من ثانية تقريبًا) = «اضغط واتكلم»: السيب بيبعت
    if (phase === "recording" && Date.now() - pressAtRef.current > 900) stopRecording();
  };

  const busy = phase === "thinking";
  const ring = phase === "recording" ? BRAND.orange : BRAND.magenta;
  const status =
    phase === "recording" ? `بسمعك… ${seconds} ث — دوس تاني للإرسال`
    : phase === "thinking" ? "بجهّز الإجابة من بيانات التطبيق…"
    : phase === "speaking" ? "ياسمين بتجاوب…"
    : "دوس على المايك واسأل بصوتك";

  return (
    <Card dir="rtl" className="overflow-hidden font-cairo border-0 shadow-md">
      <div className="px-5 py-4 text-white" style={{ background: `linear-gradient(135deg, ${BRAND.purple}, ${BRAND.magenta})` }}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-extrabold">مساعد نعام الصوتي</h2>
          <Badge className="border-white/40 bg-white/15 text-white hover:bg-white/15">نموذج تجريبي</Badge>
          {remaining != null && <span className="ms-auto text-xs opacity-90">باقي {remaining} سؤال النهارده</span>}
        </div>
        <p className="mt-1 text-sm opacity-90">اسأل عن المبيعات، الإعلانات، المودريتورز، الطلبات المعلّقة، المخزون أو المكالمات، وياسمين هترد عليك بصوتها.</p>
      </div>

      <CardContent className="space-y-5 p-5">
        <div className="flex flex-col items-center gap-3 py-2">
          <button
            type="button"
            aria-label={phase === "recording" ? "إيقاف وإرسال" : "ابدأ التسجيل"}
            disabled={busy}
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            className="relative grid h-28 w-28 select-none place-items-center rounded-full text-white shadow-lg transition-transform active:scale-95 disabled:opacity-70"
            style={{
              background: `linear-gradient(135deg, ${BRAND.magenta}, ${BRAND.purple})`,
              boxShadow: `0 0 0 ${phase === "recording" ? 10 : 6}px ${ring}33, 0 10px 28px ${BRAND.purple}55`,
              touchAction: "none",
            }}
            data-testid="voice-mic"
          >
            {phase === "recording" && <span className="absolute inset-0 animate-ping rounded-full" style={{ background: `${BRAND.orange}33` }} />}
            {busy ? <Loader2 className="h-11 w-11 animate-spin" /> : phase === "recording" ? <Square className="h-10 w-10" /> : phase === "speaking" ? <Volume2 className="h-11 w-11" /> : <Mic className="h-11 w-11" />}
          </button>
          <p className="text-sm font-semibold" style={{ color: phase === "recording" ? BRAND.orange : BRAND.purple }} data-testid="voice-status">{status}</p>
        </div>

        <div className="flex flex-wrap justify-center gap-2">
          {VOICE_SUGGESTIONS.map((s) => (
            <button key={s} type="button" disabled={busy || phase === "recording"} onClick={() => send({ kind: "voice_text", question: s })}
              className="rounded-full border px-3 py-1 text-xs font-semibold transition-colors hover:bg-muted disabled:opacity-50"
              style={{ borderColor: `${BRAND.purple}33`, color: BRAND.purple }}>
              {s}
            </button>
          ))}
        </div>

        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const q = text.trim(); if (q.length > 1) { send({ kind: "voice_text", question: q }); setText(""); } }}>
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="أو اكتب سؤالك هنا…" disabled={busy} maxLength={300} />
          <Button type="submit" disabled={busy || text.trim().length < 2} style={{ background: BRAND.purple }}>
            <Send className="h-4 w-4" />
          </Button>
        </form>

        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-4" data-testid="voice-turns">
          {turns.map((t) => (
            <div key={t.id} className="space-y-2">
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-2xl rounded-bl-sm px-4 py-2 text-sm font-semibold text-white" style={{ background: BRAND.purple }}>
                  {t.transcript}
                </div>
              </div>
              <div className="rounded-2xl rounded-tr-sm border bg-card p-4 shadow-sm">
                <p className="text-[15px] leading-8">{t.answer}</p>
                {t.unverified.length > 0 && (
                  <p className="mt-2 flex items-center gap-1 text-xs font-semibold" style={{ color: BRAND.orange }}>
                    <AlertTriangle className="h-3.5 w-3.5" /> رقم مش ظاهر في المصدر: {t.unverified.join("، ")}. راجع الصفحة قبل ما تعتمد عليه.
                  </p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-dashed pt-3 text-xs text-muted-foreground">
                  {t.citations.map((c, i) => (
                    <Link key={i} to={c.path} className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-semibold" style={{ background: `${BRAND.purple}14`, color: BRAND.purple }}>
                      المصدر: {c.label}{c.period ? ` · ${c.period}` : ""} <ExternalLink className="h-3 w-3" />
                    </Link>
                  ))}
                  {t.audio && (
                    <button type="button" onClick={() => play(t.audio)} className="inline-flex items-center gap-1 font-semibold" style={{ color: BRAND.magenta }}>
                      <Volume2 className="h-3.5 w-3.5" /> اسمع تاني
                    </button>
                  )}
                  {t.totalMs != null && <span className="ms-auto" dir="ltr">{(t.totalMs / 1000).toFixed(1)}s · ${t.costUsd?.toFixed(3)}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>

        <p className="flex items-center justify-center gap-1 text-center text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" /> للقراءة بس، بصلاحيات حسابك. كل سؤال بيتسجّل في سجل المراجعة.
        </p>
      </CardContent>
    </Card>
  );
}
