// Edge Function: cm-morning-report
// التقرير الصباحي المكتوب (إعلانات + مودريتورز + تقييم المكالمات) + شرح التنبيهات المفتوحة، في طلب ذكاء اصطناعي واحد في اليوم
// عبر Vercel AI Gateway فقط (نفس نمط cm-analyze-call). موافقة م. عمرو 21-11-2026 (كارت t495s2213).
// - الصلاحية: سر الكرون x-cm-ai-cron-secret (من pg_cron) أو مستخدم JWT صالح بدور general_manager / sales_manager.
// - الحقائق كلها من cm_ai_morning_facts (أرقام فقط، من غير أرقام هواتف ولا أسماء عملاء). الذكاء الاصطناعي بيكتب الصياغة بس.
// - لو الذكاء الاصطناعي فشل: التقرير بيتسجل facts_only والواجهة بتعرض الأرقام من غير نص.
// - سقف التكلفة: تقرير واحد في اليوم من الكرون + إعادة توليد يدوية بحد أقصى 2 في اليوم.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createServiceClient, isAuthResponse, jsonAuthError, requireVerifiedUser, userHasAnyRole } from "../_shared/require-user.ts";
import { matchesCronSecret } from "../_shared/cron-secret.ts";

const GW = "https://ai-gateway.vercel.sh";
const MODEL = Deno.env.get("CM_REPORT_MODEL") || "google/gemini-3.5-flash";
const FALLBACK = "google/gemini-2.5-flash";
const PRICE: Record<string, [number, number]> = { "google/gemini-3.5-flash": [0.0000015, 0.000009], "google/gemini-2.5-flash": [0.0000003, 0.0000025] };
const MAX_REGEN_PER_DAY = 2;
const CRON_HEADER = "x-cm-ai-cron-secret";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const redact = (s: string) => s.replace(/(?:\+?\d[\d\s\-٠-٩]{8,}\d)|[٠-٩]{9,}/g, "[رقم]");

export const SYSTEM = `أنت محلل عمليات لشركة «نعام العاصمة» (لحوم ومنتجات النعام) في مصر. بتكتب «التقرير الصباحي» للمدير العام م. عمرو يوسف ومديرة المبيعات م. آلاء حامد.
هيوصلك JSON فيه أرقام امبارح (المبيعات، الإعلانات، المودريتورز، تقييم المكالمات، المتابعات، والتنبيهات المفتوحة).
القواعد:
- اكتب بالعربي المصري البسيط، جمل قصيرة ومباشرة.
- استخدم الأرقام زي ما هي في الـ JSON بالظبط. ممنوع تخترع أي رقم أو تحسب رقم مش موجود، إلا النسب البسيطة من رقمين موجودين.
- سقف الإعلانات 6% من صافي المبيعات. لو صرف امبارح مش متسجل (spend_recorded=false) قول كده صراحة.
- الأسماء زي ما هي (آية، نورا، هاجر، مريم، سها، فاطمة). ممنوع أي أرقام تليفونات أو أسماء عملاء.
- ممنوع أي ادعاءات دينية أو صحية عن المنتجات.
- القرارات المقترحة لازم تكون عملية وتتنفذ بموافقة المدير العام، ومفيش حاجة بتتنفذ لوحدها.
- لو العينة صغيرة (small_sample=true أو أقل من 5 مكالمات) قول إن التقييم مبدئي.
أرجع JSON بس بالمفاتيح دي:
headline: مصفوفة من 3 جمل، أهم 3 حاجات النهارده.
sales: فقرة قصيرة عن مبيعات امبارح مقارنة بمتوسط 7 أيام.
ads: فقرة قصيرة عن الإعلانات: صرف امبارح ونسبته، ونسبة الشهر مقابل 6%، وأحسن وأسوأ حملة بتكلفة الطلب، والحملات المش متتبعة.
moderators: فقرة قصيرة عن الفريق امبارح.
moderator_notes: مصفوفة {name, note} لكل مودريتور فيها ملاحظة واحدة محددة (من أرقام امبارح وتقييم المكالمات).
calls: فقرة قصيرة عن تقييم المكالمات وأكتر اعتراضات العملاء.
followups: فقرة قصيرة عن المتابعات المفتوحة.
decisions: مصفوفة من 3 عناصر {title, why} قرارات مقترحة.
alert_notes: مصفوفة {id, note} لكل تنبيه في open_alerts: جملة واحدة تشرح ليه مهم وإيه أول خطوة.`;

async function callModel(key: string, model: string, facts: unknown) {
  const r = await fetch(`${GW}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model, temperature: 0.3, max_tokens: 3500, response_format: { type: "json_object" },
      reasoning: { effort: "low" },
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: redact(JSON.stringify(facts)) }],
    }),
  });
  if (!r.ok) throw new Error(`LLM ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  const txt = String(j.choices?.[0]?.message?.content ?? "").replace(/^```(?:json)?|```$/g, "").trim();
  return { out: JSON.parse(txt), usage: j.usage ?? {}, model };
}

// deno-lint-ignore no-explicit-any
function clean(out: any) {
  const s = (v: unknown, n = 1200) => (typeof v === "string" ? redact(v).slice(0, n) : "");
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  return {
    headline: arr(out.headline).map((x) => s(x, 300)).filter(Boolean).slice(0, 3),
    sections: { sales: s(out.sales), ads: s(out.ads), moderators: s(out.moderators), calls: s(out.calls), followups: s(out.followups) },
    // deno-lint-ignore no-explicit-any
    moderator_notes: arr(out.moderator_notes).slice(0, 8).map((x: any) => ({ name: s(x?.name, 40), note: s(x?.note, 400) })),
    // deno-lint-ignore no-explicit-any
    decisions: arr(out.decisions).slice(0, 3).map((x: any) => ({ title: s(x?.title, 200), why: s(x?.why, 500) })),
    // deno-lint-ignore no-explicit-any
    alert_notes: arr(out.alert_notes).slice(0, 20).map((x: any) => ({ id: String(x?.id ?? ""), note: s(x?.note, 400) })),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const admin = createServiceClient();

  let source = "cron";
  const cronOk = await matchesCronSecret(req.headers.get(CRON_HEADER) || "", Deno.env.get("CM_AI_CRON_SECRET") || "");
  if (!cronOk) {
    const auth = await requireVerifiedUser(req, corsHeaders, admin);
    if (isAuthResponse(auth)) return auth;
    if (!(await userHasAnyRole(admin, auth.user.id, ["general_manager", "sales_manager"]))) return jsonAuthError(corsHeaders, 403, "Forbidden");
    source = auth.user.id;
  }
  // deno-lint-ignore no-explicit-any
  let body: any = {}; try { body = await req.json(); } catch { /* empty */ }
  const date: string | null = typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : null;

  const { data: facts, error: fe } = await admin.rpc("cm_ai_morning_facts", { _d: date });
  if (fe || !facts) return json({ error: `facts: ${fe?.message ?? "empty"}` }, 500);
  const reportDate = String(facts.date);

  const { data: existing } = await admin.from("cm_morning_reports").select("status,regen_count").eq("report_date", reportDate).maybeSingle();
  if (existing && source === "cron" && existing.status === "done") return json({ ok: true, skipped: "already_done", report_date: reportDate });
  if (existing && source !== "cron" && (existing.regen_count ?? 0) >= MAX_REGEN_PER_DAY) {
    return json({ error: "وصلت للحد الأقصى لإعادة التوليد النهارده (مرتين)" }, 429);
  }
  const regen = existing ? (existing.regen_count ?? 0) + (source === "cron" ? 0 : 1) : 0;

  // الحقائق الأول (عشان التقرير يظهر بالأرقام حتى لو الذكاء الاصطناعي وقع)
  await admin.from("cm_morning_reports").upsert({ report_date: reportDate, facts, status: existing?.status === "done" ? "done" : "facts_only", generated_by: source, regen_count: regen, updated_at: new Date().toISOString() });

  const key = Deno.env.get("AI_GATEWAY_API_KEY");
  if (!key) return json({ ok: true, report_date: reportDate, status: "facts_only", reason: "AI_GATEWAY_API_KEY غير مضبوط" });
  try {
    let res;
    try { res = await callModel(key, MODEL, facts); }
    catch (e) { if (MODEL !== FALLBACK && /LLM (403|404|5\d\d)/.test(String(e))) res = await callModel(key, FALLBACK, facts); else throw e; }
    const report = clean(res.out);
    const [pin, pout] = PRICE[res.model] ?? PRICE[MODEL] ?? [0.0000015, 0.000009];
    const pt = Number(res.usage.prompt_tokens ?? 0), ct = Number(res.usage.completion_tokens ?? 0);
    const cost = pt * pin + ct * pout;
    await admin.from("cm_morning_reports").update({ report, status: "done", model: res.model, prompt_tokens: pt, completion_tokens: ct, cost_usd: cost, error: null, updated_at: new Date().toISOString() }).eq("report_date", reportDate);
    // شرح التنبيهات المفتوحة (نفس الطلب، من غير تكلفة إضافية)
    const ids = new Set(((facts.open_alerts ?? []) as { id: string }[]).map((a) => a.id));
    for (const n of report.alert_notes) if (ids.has(n.id) && n.note) await admin.from("cm_alerts").update({ ai_note: n.note }).eq("id", n.id);
    return json({ ok: true, report_date: reportDate, status: "done", model: res.model, cost });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).slice(0, 500);
    await admin.from("cm_morning_reports").update({ status: existing?.status === "done" ? "done" : "error", error: msg, updated_at: new Date().toISOString() }).eq("report_date", reportDate);
    return json({ ok: false, report_date: reportDate, error: msg }, 502);
  }
});
