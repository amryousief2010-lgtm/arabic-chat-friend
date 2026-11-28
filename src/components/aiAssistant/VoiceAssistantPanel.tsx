import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Mic, Square, Volume2, Send, ShieldCheck, AlertTriangle, ExternalLink } from "lucide-react";
import { BRAND } from "@/config/aiReports";
import { VOICE_SUGGESTIONS } from "@/config/voiceAssistant";
import { useVoiceAssistant, type VoiceTurn } from "@/hooks/useVoiceAssistant";

export function VoiceTurnCard({ t, play }: { t: VoiceTurn; play: (b64: string | null) => void }) {
  return (
    <div className="space-y-2">
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
  );
}

/** زر المايك: دوسة تبدأ ودوسة تبعت، أو اضغط مطوّل واتكلم وسيب. */
export default function VoiceAssistantPanel() {
  const {
    phase, seconds, turns, error, text, setText, remaining,
    onPointerDown, onPointerUp, send, play, busy, status,
  } = useVoiceAssistant();
  const ring = phase === "recording" ? BRAND.orange : BRAND.magenta;

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
          {turns.map((t) => <VoiceTurnCard key={t.id} t={t} play={play} />)}
        </div>

        <p className="flex items-center justify-center gap-1 text-center text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" /> للقراءة بس، بصلاحيات حسابك. كل سؤال بيتسجّل في سجل المراجعة.
        </p>
      </CardContent>
    </Card>
  );
}
