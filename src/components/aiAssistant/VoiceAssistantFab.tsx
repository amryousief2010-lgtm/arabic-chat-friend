import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, Square, Volume2, Send, EyeOff, X, AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BRAND } from "@/config/aiReports";
import { canUseVoiceAssistant, VOICE_SUGGESTIONS } from "@/config/voiceAssistant";
import { useAuth } from "@/hooks/useAuth";
import { useCompactFloating } from "@/hooks/useCompactFloating";
import { useVoiceAssistant } from "@/hooks/useVoiceAssistant";
import { useVoiceFabPreference } from "@/hooks/useVoiceFabPreference";
import { VoiceTurnCard } from "@/components/aiAssistant/VoiceAssistantPanel";
import { cn } from "@/lib/utils";

/**
 * مسافات النسبة الذهبية: 8، 13، 21، 34، 55، 89.
 * الزر على جهة النهاية في RTL (يسار الشاشة) لأن السايدبار على اليمين.
 * الساعة العائمة 56px عند end-4؛ الزر يتزاح عنها 13px باتجاه وسط الصفحة (end: 85px)
 * إلا في الوضع المضغوط على الموبايل حيث الساعة بتتخبّى فياخذ مكانها.
 */
const FAB = 55;

export default function VoiceAssistantFab() {
  const { user, roles } = useAuth();
  const compact = useCompactFloating();
  const { hidden, setHidden } = useVoiceFabPreference(user?.id);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const voice = useVoiceAssistant();
  const allowed = canUseVoiceAssistant(roles);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  if (!allowed) return null;

  const dock = cn(
    "font-cairo fixed z-[45] bottom-24 md:bottom-6",
    compact ? "end-4" : "end-[85px]",
  );

  if (hidden) {
    return (
      <button
        type="button"
        aria-label="إظهار المساعد الصوتي"
        data-testid="voice-fab-tab"
        onClick={() => { setHidden(false); setOpen(true); }}
        className="font-cairo fixed z-[45] end-0 bottom-24 md:bottom-6 flex h-[55px] w-[34px] items-center justify-center rounded-s-[13px] text-white shadow-lg"
        style={{ background: `linear-gradient(180deg, ${BRAND.magenta}, ${BRAND.purple})` }}
        title="إظهار المساعد الصوتي"
      >
        <Mic className="h-[21px] w-[21px]" />
      </button>
    );
  }

  const ring = voice.phase === "recording" ? BRAND.orange : BRAND.magenta;

  return (
    <div
      ref={rootRef}
      dir="rtl"
      className={cn(dock, "pointer-events-none flex flex-col items-end gap-[13px]")}
      data-testid="voice-fab-root"
    >
      {open && (
        <div
          className="pointer-events-auto flex w-[min(377px,calc(100vw-26px))] max-h-[min(68vh,34rem)] flex-col overflow-hidden rounded-[21px] bg-background"
          style={{ boxShadow: `0 13px 34px ${BRAND.purple}40` }}
          data-testid="voice-fab-panel"
          role="dialog"
          aria-label="مساعد نعام الصوتي"
        >
          <div className="flex items-center gap-[13px] px-[21px] py-[13px] text-white" style={{ background: `linear-gradient(135deg, ${BRAND.purple}, ${BRAND.magenta})` }}>
            <Mic className="h-5 w-5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-extrabold leading-none">مساعد نعام الصوتي</p>
              {voice.remaining != null && <p className="mt-1 text-[11px] opacity-90">باقي {voice.remaining} سؤال النهارده</p>}
            </div>
            <button type="button" aria-label="إخفاء الزر العائم" data-testid="voice-fab-hide" title="إخفاء الزر"
              onClick={() => { setOpen(false); setHidden(true); }}
              className="grid h-[34px] w-[34px] place-items-center rounded-[13px] bg-white/15 hover:bg-white/25">
              <EyeOff className="h-4 w-4" />
            </button>
            <button type="button" aria-label="إغلاق اللوحة" data-testid="voice-fab-close"
              onClick={() => setOpen(false)}
              className="grid h-[34px] w-[34px] place-items-center rounded-[13px] bg-white/15 hover:bg-white/25">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-[13px] overflow-y-auto p-[13px]">
            <div className="flex items-center gap-[13px]">
              <button
                type="button"
                aria-label={voice.phase === "recording" ? "إيقاف وإرسال" : "ابدأ التسجيل"}
                disabled={voice.busy}
                onPointerDown={voice.onPointerDown}
                onPointerUp={voice.onPointerUp}
                data-testid="voice-fab-mic"
                className="relative grid h-[55px] w-[55px] shrink-0 select-none place-items-center rounded-full text-white transition-transform active:scale-95 disabled:opacity-70"
                style={{
                  background: `linear-gradient(135deg, ${BRAND.magenta}, ${BRAND.purple})`,
                  boxShadow: `0 0 0 ${voice.phase === "recording" ? 6 : 4}px ${ring}33`,
                  touchAction: "none",
                }}
              >
                {voice.phase === "recording" && <span className="absolute inset-0 animate-ping rounded-full" style={{ background: `${BRAND.orange}33` }} />}
                {voice.busy ? <Loader2 className="h-6 w-6 animate-spin" /> : voice.phase === "recording" ? <Square className="h-5 w-5" /> : voice.phase === "speaking" ? <Volume2 className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
              </button>
              <p className="text-xs font-semibold leading-5" style={{ color: voice.phase === "recording" ? BRAND.orange : BRAND.purple }} data-testid="voice-fab-status">
                {voice.status}
              </p>
              {voice.phase === "speaking" && <Badge className="ms-auto text-[10px]" style={{ background: BRAND.orange }}>بتتكلم</Badge>}
            </div>

            <div className="flex flex-wrap gap-[8px]">
              {VOICE_SUGGESTIONS.slice(0, 3).map((s) => (
                <button key={s} type="button" disabled={voice.busy || voice.phase === "recording"}
                  onClick={() => voice.send({ kind: "voice_text", question: s })}
                  className="rounded-full border px-[13px] py-[5px] text-[11px] font-semibold hover:bg-muted disabled:opacity-50"
                  style={{ borderColor: `${BRAND.purple}33`, color: BRAND.purple }}>
                  {s}
                </button>
              ))}
            </div>

            <form className="flex gap-[8px]" onSubmit={(e) => { e.preventDefault(); const q = voice.text.trim(); if (q.length > 1) { voice.send({ kind: "voice_text", question: q }); voice.setText(""); } }}>
              <Input value={voice.text} onChange={(e) => voice.setText(e.target.value)} placeholder="أو اكتب سؤالك…" disabled={voice.busy} maxLength={300} className="h-[34px] text-sm" />
              <Button type="submit" size="icon" className="h-[34px] w-[34px] shrink-0" disabled={voice.busy || voice.text.trim().length < 2} style={{ background: BRAND.purple }}>
                <Send className="h-4 w-4" />
              </Button>
            </form>

            {voice.error && (
              <p className="flex items-start gap-1 text-xs font-semibold text-destructive">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {voice.error}
              </p>
            )}

            <div className="space-y-[13px]" data-testid="voice-fab-turns">
              {voice.turns.map((t) => <VoiceTurnCard key={t.id} t={t} play={voice.play} />)}
            </div>
          </div>
        </div>
      )}

      {!open && (
        <div className="pointer-events-auto relative" style={{ width: FAB, height: FAB }}>
          <button
            type="button"
            aria-label="إخفاء المساعد الصوتي"
            data-testid="voice-fab-hide"
            title="إخفاء الزر"
            onClick={() => setHidden(true)}
            className="absolute z-10 grid h-[21px] w-[21px] place-items-center rounded-full bg-background text-muted-foreground shadow ring-1 ring-border hover:text-foreground"
            style={{ top: -8, insetInlineStart: -8 }}
          >
            <EyeOff className="h-3 w-3" />
          </button>
          <button
            type="button"
            aria-label="فتح المساعد الصوتي"
            data-testid="voice-fab"
            onClick={() => setOpen(true)}
            className="relative grid h-full w-full place-items-center rounded-full text-white transition-transform hover:scale-105 active:scale-95"
            style={{
              background: `linear-gradient(135deg, ${BRAND.magenta}, ${BRAND.purple})`,
              boxShadow: `0 8px 21px ${BRAND.purple}55`,
            }}
          >
            <Mic className="h-[26px] w-[26px]" />
          </button>
        </div>
      )}
    </div>
  );
}
