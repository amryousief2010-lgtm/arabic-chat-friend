import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { pickRecorderMime, VOICE_MAX_SECONDS } from "@/config/voiceAssistant";

export type VoiceCitation = { tool: string; label: string; path: string; period: string | null };
export type VoiceTurn = {
  id: string;
  transcript: string;
  answer: string;
  audio: string | null;
  citations: VoiceCitation[];
  unverified: number[];
  costUsd: number | null;
  totalMs: number | null;
};
export type VoicePhase = "idle" | "recording" | "thinking" | "speaking";

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
      const ctx = (error as { context?: { json?: () => Promise<{ error?: string }>; body?: string } })?.context;
      if (ctx?.json) msg = (await ctx.json())?.error ?? null;
      else if (ctx?.body) msg = JSON.parse(ctx.body)?.error ?? null;
    } catch { /* ignore */ }
    throw new Error(msg || "تعذّر الاتصال بالمساعد.");
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

/** منطق المساعد الصوتي المشترك بين لوحة الصفحة والزر العائم. */
export function useVoiceAssistant() {
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [turns, setTurns] = useState<VoiceTurn[]>([]);
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

  const handleResult = useCallback((data: {
    transcript: string;
    answer_text: string;
    audio_base64?: string | null;
    citations?: VoiceCitation[];
    unverified_numbers?: number[];
    usage?: { cost_usd?: number; timing?: { total_ms?: number } };
    limits?: { remaining?: number };
  }) => {
    const turn: VoiceTurn = {
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
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "حصلت مشكلة. جرّب تاني.");
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
    if (phase === "recording" && Date.now() - pressAtRef.current > 900) stopRecording();
  };

  const busy = phase === "thinking";
  const status =
    phase === "recording" ? `بسمعك… ${seconds} ث — دوس تاني للإرسال`
    : phase === "thinking" ? "بجهّز الإجابة من بيانات التطبيق…"
    : phase === "speaking" ? "ياسمين بتجاوب…"
    : "دوس على المايك واسأل بصوتك";

  return {
    phase, seconds, turns, error, text, setText, remaining,
    startRecording, stopRecording, onPointerDown, onPointerUp, send, play,
    busy, status,
  };
}
