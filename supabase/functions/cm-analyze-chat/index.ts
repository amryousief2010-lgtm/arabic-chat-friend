// Edge Function: cm-analyze-chat — تحليل محادثات واتساب عبر Vercel AI Gateway (google/gemini-2.5-flash).
// - الصلاحية: JWT + cm_can_manage()، أو مفتاح service_role (يتحقق منه PostgREST) للدفعات من الخادم.
// - {conversation_id} أو {batch:true, limit<=15}. يتخطى المحادثات غير المتغيرة (input_hash) إلا مع force.
// - الخصوصية: أدوار فقط (العميل/المودريتور)، الأرقام والروابط والبريد محجوبة، لا يُرسل رقم ولا اسم.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createServiceClient, isAuthResponse, jsonAuthError, requireVerifiedUser } from "../_shared/require-user.ts";
import { buildChatTranscript, chatHash, CHAT_SYSTEM, normalizeChatAnalysis, type ChatMsg } from "../_shared/chat-analysis.ts";

const GW = "https://ai-gateway.vercel.sh";
const MODEL = Deno.env.get("CM_CHAT_ANALYSIS_MODEL") || "google/gemini-2.5-flash";
const PRICE: [number, number] = [0.0000003, 0.0000025];
const MAX_BATCH = 15, CONCURRENCY = 2;
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
async function llm(key: string, transcript: string): Promise<{ a: any; usage: any }> {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`${GW}/v1/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, temperature: 0.2, response_format: { type: "json_object" },
        messages: [{ role: "system", content: CHAT_SYSTEM }, { role: "user", content: transcript }] }) });
    if (r.status === 429 && attempt < 2) { await new Promise((ok) => setTimeout(ok, 15000 * (attempt + 1))); continue; }
    if (!r.ok) throw new Error(`LLM ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    const txt = (j.choices?.[0]?.message?.content ?? "").replace(/^```(?:json)?|```$/g, "").trim();
    return { a: JSON.parse(txt), usage: j.usage ?? {} };
  }
}

// deno-lint-ignore no-explicit-any
async function processConv(admin: any, key: string, id: string, uid: string | null, force: boolean) {
  const { data: msgs, error } = await admin.from("cm_messages").select("direction,type,body,sent_at").eq("conversation_id", id).order("sent_at").limit(400);
  if (error) return { conversation_id: id, status: "error", error: error.message };
  const list = (msgs ?? []) as ChatMsg[];
  if (!list.some((m) => m.direction === "in")) return { conversation_id: id, status: "skipped", reason: "no_inbound" };
  const hash = chatHash(list);
  const { data: ex } = await admin.from("cm_chat_analysis").select("status,attempts,input_hash").eq("conversation_id", id).maybeSingle();
  if (!force && ex?.status === "done" && ex.input_hash === hash) return { conversation_id: id, status: "skipped", reason: "unchanged" };
  await admin.from("cm_chat_analysis").upsert({ conversation_id: id, status: "pending", error: null, requested_by: uid, attempts: (ex?.attempts ?? 0) + 1, updated_at: new Date().toISOString() });
  try {
    const { a, usage } = await llm(key, buildChatTranscript(list));
    const cost = (usage.prompt_tokens ?? 0) * PRICE[0] + (usage.completion_tokens ?? 0) * PRICE[1];
    const n = normalizeChatAnalysis(a, list.filter((m) => m.direction === "out").length);
    const u = await admin.from("cm_chat_analysis").update({ ...n, status: "done", analysis_model: MODEL, analysis: a, messages_analyzed: list.length,
      input_hash: hash, cost_estimate: cost, error: null, analyzed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("conversation_id", id);
    if (u.error) throw new Error(u.error.message);
    return { conversation_id: id, status: "done", category: n.category, outcome: n.outcome, cost };
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).slice(0, 400);
    await admin.from("cm_chat_analysis").update({ status: "error", error: msg, updated_at: new Date().toISOString() }).eq("conversation_id", id);
    return { conversation_id: id, status: "error", error: msg };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const admin = createServiceClient();
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  let uid: string | null = null;
  const probe = bearer.split(".").length === 3 ? await fetch(`${Deno.env.get("SUPABASE_URL")}/rest/v1/rpc/cm_media_pending`, { method: "POST",
    headers: { apikey: bearer, Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" }, body: JSON.stringify({ _limit: 1 }) }) : null;
  if (!probe?.ok) {
    const auth = await requireVerifiedUser(req, corsHeaders, admin);
    if (isAuthResponse(auth)) return auth;
    const userDb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: `Bearer ${auth.token}` } }, auth: { persistSession: false } });
    const { data: ok } = await userDb.rpc("cm_can_manage");
    if (ok !== true) return jsonAuthError(corsHeaders, 403, "Forbidden");
    uid = auth.user.id;
  }
  const key = Deno.env.get("AI_GATEWAY_API_KEY");
  if (!key) return json({ error: "AI_GATEWAY_API_KEY غير مضبوط" }, 500);
  // deno-lint-ignore no-explicit-any
  let body: any = {}; try { body = await req.json(); } catch { /* empty */ }
  const force = body.force === true;
  let ids: string[] = [];
  if (body.conversation_id) ids = [String(body.conversation_id)];
  else if (body.batch) {
    const limit = Math.min(Math.max(Number(body.limit) || MAX_BATCH, 1), MAX_BATCH);
    // المحادثات الحقيقية (على خط) ذات رسائل واردة؛ غير المحللة/الفاشلة أولاً ثم المتغيرة.
    const { data: cs } = await admin.from("cm_conversations").select("id,last_inbound_at,cm_chat_analysis(status,analyzed_at)")
      .not("line_id", "is", null).not("first_inbound_at", "is", null).order("last_inbound_at", { ascending: false }).limit(500);
    // deno-lint-ignore no-explicit-any
    const rows = (cs ?? []).map((c: any) => { const a = Array.isArray(c.cm_chat_analysis) ? c.cm_chat_analysis[0] : c.cm_chat_analysis;
      const stale = !a || a.status !== "done" || (a.analyzed_at && c.last_inbound_at && c.last_inbound_at > a.analyzed_at);
      return { id: c.id, prio: !a || a.status !== "done" ? 0 : 1, stale: force || stale }; });
    ids = rows.filter((r: { stale: boolean }) => r.stale).sort((x: { prio: number }, y: { prio: number }) => x.prio - y.prio).map((r: { id: string }) => r.id).slice(0, limit);
  } else return json({ error: "conversation_id أو batch مطلوب" }, 400);
  // deno-lint-ignore no-explicit-any
  const results: any[] = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, async () => {
    while (i < ids.length) { const id = ids[i++]; results.push(await processConv(admin, key, id, uid, force)); }
  }));
  return json({ processed: results.length, done: results.filter((r) => r.status === "done").length,
    errors: results.filter((r) => r.status === "error").map((r) => r.error), cost: results.reduce((s, r) => s + (r.cost ?? 0), 0),
    // deno-lint-ignore no-explicit-any
    results: results.map((r: any) => ({ status: r.status, category: r.category, outcome: r.outcome, reason: r.reason })) });
});
