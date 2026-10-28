// Edge Function: cm-analyze-call
// تفريغ وتحليل مكالمات المبيعات المسجَّلة عبر Vercel AI Gateway فقط (موافقة م. عمرو 28-10-2026).
// - الصلاحية: JWT صالح + cm_can_manage() (مديرة المبيعات / المدير العام، وتمر ببوابة القسم cm_gate).
// - يعالج مكالمة واحدة {call_id} أو دفعة {batch:true, limit} من مكالمات is_sales ذات تسجيل ولم تُحلَّل (أو فشلت).
// - الخصوصية: لا يُرسل رقم الهاتف ولا أي بيانات عميل؛ الأرقام الطويلة في النص تُحجب قبل التحليل. النتائج في cm_call_analysis فقط.
// - idempotent: المكالمة ذات status=done تُتخطّى إلا مع force=true.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createServiceClient, isAuthResponse, jsonAuthError, requireVerifiedUser } from "../_shared/require-user.ts";

const GW = "https://ai-gateway.vercel.sh";
const ASR_MODEL = "elevenlabs/scribe-v2";
const LLM_MODEL = Deno.env.get("CM_ANALYSIS_MODEL") || "google/gemini-3.5-flash";
const ASR_USD_PER_SEC = 0.000030556;           // تسعير البوابة لـ scribe-v2
const LLM_FALLBACK = "google/gemini-2.5-flash"; // حساب البوابة الحالي (Free tier) لا يتيح 3.5-flash
const LLM_PRICE: Record<string, [number, number]> = { "google/gemini-3.5-flash": [0.0000015, 0.000009], "google/gemini-2.5-flash": [0.0000003, 0.0000025] };
const MAX_BATCH = 8, CONCURRENCY = 2; // حد البوابة الحالي لـ scribe-v2: 5 طلبات/دقيقة
const OUTCOMES = ["order_placed", "order_promised", "inquiry_only", "not_interested", "complaint", "followup", "other"];

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const redact = (s: string) => s.replace(/(?:\+?\d[\d\s\-٠-٩]{6,}\d)|[٠-٩]{7,}/g, "[رقم]");
const b64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };

type Seg = { speaker: string; start: number; end: number; text: string };
function segmentsFrom(r: any): Seg[] {
  const words: any[] = r?.providerMetadata?.elevenlabs?.words ?? [];
  const out: Seg[] = [];
  for (const w of words) {
    if (w.type === "audio_event") continue;
    const sp = w.speaker_id ?? "speaker_0"; const last = out[out.length - 1];
    if (last && last.speaker === sp && (w.start - last.end) < 1.5) { last.text += w.text; last.end = w.end ?? last.end; }
    else if (w.type !== "spacing") out.push({ speaker: sp, start: w.start, end: w.end, text: w.text });
  }
  return out.map((s) => ({ ...s, text: s.text.trim() })).filter((s) => s.text);
}

async function transcribe(key: string, audio: Uint8Array, mime: string) {
  for (let attempt = 0; ; attempt++) {
    const r = await transcribeOnce(key, audio, mime);
    if (r.status !== 429 || attempt >= 2) { if (!r.ok) throw new Error(`ASR ${r.status}: ${(await r.text()).slice(0, 300)}`); return await r.json(); }
    const m = (await r.text()).match(/Retry after (\d+)s/); await new Promise((ok) => setTimeout(ok, (Number(m?.[1] ?? 30) + 2) * 1000));
  }
}
function transcribeOnce(key: string, audio: Uint8Array, mime: string) {
  return fetch(`${GW}/v4/ai/transcription-model`, { method: "POST",
    headers: { Authorization: `Bearer ${key}`, "ai-gateway-protocol-version": "0.0.1", "ai-transcription-model-specification-version": "4", "ai-model-id": ASR_MODEL, "Content-Type": "application/json" },
    body: JSON.stringify({ audio: b64(audio), mediaType: mime }) });
}

const SYSTEM = `أنت محلل جودة مبيعات لشركة «نعام العاصمة» (لحوم ومنتجات النعام) في مصر. ستصلك مكالمة هاتفية مفرَّغة باللهجة المصرية بين موظفة/موظف المبيعات («المودريتور») وعميل، مقسَّمة حسب المتحدث (speaker_0, speaker_1...). التفريغ آلي وقد يحتوي أخطاء.
أعد JSON فقط بالمفاتيح:
speaker_roles: كائن يربط كل speaker بـ "moderator" أو "customer" أو "other" (المودريتور هو من يرد باسم الشركة ويعرض الأسعار).
summary_ar: ملخص من 2 إلى 4 جمل بالعربية الفصحى المبسطة.
caller_intent: نية العميل في جملة قصيرة.
is_sales_inquiry: true/false.
order_placed_or_promised: true إذا تم طلب أو وعد العميل بالطلب.
outcome: واحد من ${OUTCOMES.join(", ")}.
objections: مصفوفة اعتراضات قصيرة موحدة الصياغة (مثل "السعر مرتفع"، "مصاريف الشحن"، "منطقة خارج التغطية"، "يريد التفكير") أو [].
handling_score: عدد صحيح من 1 إلى 5 لتعامل المودريتور (الترحيب، الفهم، عرض المنتج والسعر، معالجة الاعتراض، محاولة إغلاق البيع).
handling_notes: ملاحظات محددة على أداء المودريتور (نقاط قوة وما يحتاج تحسيناً).
followup_needed: true/false. followup_reason: السبب أو null.
لا تذكر أي أرقام هواتف أو أسماء عملاء في أي حقل.`;

async function analyze(key: string, segs: Seg[]) {
  try { return await analyzeWith(key, segs, LLM_MODEL); }
  catch (e) { if (LLM_MODEL !== LLM_FALLBACK && /LLM 403/.test(String(e))) return await analyzeWith(key, segs, LLM_FALLBACK); throw e; }
}
async function analyzeWith(key: string, segs: Seg[], model: string) {
  const body = segs.map((s) => `[${s.start.toFixed(1)}] ${s.speaker}: ${redact(s.text)}`).join("\n").slice(0, 60000);
  const r = await fetch(`${GW}/v1/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, temperature: 0.2, response_format: { type: "json_object" },
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: body || "(لا يوجد كلام مسموع)" }] }) });
  if (!r.ok) throw new Error(`LLM ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  const txt = (j.choices?.[0]?.message?.content ?? "").replace(/^```(?:json)?|```$/g, "").trim();
  return { a: JSON.parse(txt), usage: j.usage ?? {}, model };
}

async function processCall(admin: any, key: string, callId: string, uid: string, force: boolean) {
  const { data: c } = await admin.from("cm_calls").select("id,recording_path,is_sales").eq("id", callId).maybeSingle();
  if (!c) return { call_id: callId, status: "skipped", reason: "no_call" };
  if (!c.is_sales) return { call_id: callId, status: "skipped", reason: "not_sales" };
  if (!c.recording_path) return { call_id: callId, status: "skipped", reason: "no_recording" };
  const { data: ex } = await admin.from("cm_call_analysis").select("status,attempts").eq("call_id", callId).maybeSingle();
  if (ex?.status === "done" && !force) return { call_id: callId, status: "skipped", reason: "already_done" };
  await admin.from("cm_call_analysis").upsert({ call_id: callId, status: "pending", error: null, requested_by: uid, attempts: (ex?.attempts ?? 0) + 1, updated_at: new Date().toISOString() });
  let cost = 0;
  try {
    const dl = await admin.storage.from("cm-call-recordings").download(c.recording_path);
    if (dl.error || !dl.data) throw new Error(`تعذّر تنزيل التسجيل: ${dl.error?.message ?? "?"}`);
    const mime = c.recording_path.endsWith(".wav") ? "audio/wav" : "audio/mpeg";
    const t = await transcribe(key, new Uint8Array(await dl.data.arrayBuffer()), mime);
    const secs = Number(t.durationInSeconds ?? 0); cost += secs * ASR_USD_PER_SEC;
    const segs = segmentsFrom(t);
    await admin.from("cm_call_analysis").update({ asr_model: ASR_MODEL, transcript_text: t.text ?? "", transcript_segments: segs, audio_seconds: secs, cost_estimate: cost }).eq("call_id", callId);
    const { a, usage, model } = await analyze(key, segs);
    const [pin, pout] = LLM_PRICE[model] ?? [0.0000015, 0.000009];
    cost += (usage.prompt_tokens ?? 0) * pin + (usage.completion_tokens ?? 0) * pout;
    const score = Math.round(Number(a.handling_score));
    const row = {
      status: "done", analysis_model: model, analysis: a, speaker_roles: a.speaker_roles ?? null,
      summary_ar: a.summary_ar ?? null, caller_intent: a.caller_intent ?? null,
      is_sales_inquiry: typeof a.is_sales_inquiry === "boolean" ? a.is_sales_inquiry : null,
      order_placed_or_promised: typeof a.order_placed_or_promised === "boolean" ? a.order_placed_or_promised : null,
      outcome: OUTCOMES.includes(a.outcome) ? a.outcome : "other",
      objections: Array.isArray(a.objections) ? a.objections.map(String).slice(0, 10) : [],
      handling_score: score >= 1 && score <= 5 ? score : null, handling_notes: a.handling_notes ?? null,
      followup_needed: typeof a.followup_needed === "boolean" ? a.followup_needed : null, followup_reason: a.followup_reason ?? null,
      cost_estimate: cost, error: null, analyzed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    const u = await admin.from("cm_call_analysis").update(row).eq("call_id", callId);
    if (u.error) throw new Error(u.error.message);
    return { call_id: callId, status: "done", outcome: row.outcome, cost };
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).slice(0, 500);
    await admin.from("cm_call_analysis").update({ status: "error", error: msg, cost_estimate: cost, updated_at: new Date().toISOString() }).eq("call_id", callId);
    return { call_id: callId, status: "error", error: msg, cost };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const admin = createServiceClient();
  const auth = await requireVerifiedUser(req, corsHeaders, admin);
  if (isAuthResponse(auth)) return auth;
  const userDb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: `Bearer ${auth.token}` } }, auth: { persistSession: false } });
  const { data: ok } = await userDb.rpc("cm_can_manage");
  if (ok !== true) return jsonAuthError(corsHeaders, 403, "Forbidden");
  const key = Deno.env.get("AI_GATEWAY_API_KEY");
  if (!key) return json({ error: "AI_GATEWAY_API_KEY غير مضبوط" }, 500);
  let body: any = {}; try { body = await req.json(); } catch { /* empty */ }
  const force = body.force === true;
  let ids: string[] = [];
  if (body.call_id) ids = [String(body.call_id)];
  else if (body.batch) {
    const limit = Math.min(Math.max(Number(body.limit) || MAX_BATCH, 1), MAX_BATCH);
    const { data: done } = await admin.from("cm_call_analysis").select("call_id,status");
    const skip = new Set((done ?? []).filter((d: any) => force ? false : (d.status === "done" || (d.status === "pending" && !body.include_pending))).map((d: any) => d.call_id));
    const { data: cs } = await admin.from("cm_calls").select("id").eq("is_sales", true).not("recording_path", "is", null).order("started_at", { ascending: false }).limit(1000);
    ids = (cs ?? []).map((c: any) => c.id).filter((id: string) => !skip.has(id)).slice(0, limit);
  } else return json({ error: "call_id أو batch مطلوب" }, 400);
  const results: any[] = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, async () => {
    while (i < ids.length) { const id = ids[i++]; results.push(await processCall(admin, key, id, auth.user.id, force)); }
  }));
  const { count } = await admin.from("cm_calls").select("id", { count: "exact", head: true }).eq("is_sales", true).not("recording_path", "is", null);
  const { count: doneN } = await admin.from("cm_call_analysis").select("call_id", { count: "exact", head: true }).eq("status", "done");
  return json({ processed: results.length, results, remaining: Math.max((count ?? 0) - (doneN ?? 0), 0), cost: results.reduce((s, r) => s + (r.cost ?? 0), 0) });
});
