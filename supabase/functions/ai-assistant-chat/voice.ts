// المساعد الصوتي للمديرين (نموذج أولي — موافقة م. عمرو «نفذ» 28-11-2026، على قاعدة التجربة).
// صوت → نص (ElevenLabs scribe-v2) → نموذج لغة بأدوات قراءة ثابتة (ai_tool_* بصلاحية المستخدم) → صوت ياسمين (ElevenLabs eleven-v4).
// كل النداءات عن طريق Vercel AI Gateway من السيرفر بس؛ المفتاح عمره ما بيوصل للمتصفح.
// - مفيش SQL حر: النموذج بيختار من 11 أداة (8 + 3 أدوات محادثات)، والسيرفر بيتحقق من الدور قبل أي نداء، والقاعدة بتتحقق تاني.
// - المصدر (الصفحة والفترة) بيتحط من الكود من الأداة اللي اتنادت، مش من كلام النموذج.
// - كل رقم في الإجابة بيتراجع على نتايج الأدوات؛ أي رقم مش موجود بيتعلّم «غير متحقق».
// - سجل مراجعة كامل في ai_assistant_query_log (المدير العام بس بيقراه)، وحد يومي لكل مستخدم وسقف شهري للتكلفة.
import { extractNumbers, toLatinDigits, toSpeechText } from "../_shared/ar-speech-numbers.ts";

const GW = "https://ai-gateway.vercel.sh";

export const VOICE_ALLOWED_ROLES = ["general_manager", "executive_manager", "sales_manager"];
const MGR = VOICE_ALLOWED_ROLES;
// قرار م. عمرو 28-11-2026: التلات أدوار بيشوفوا الأدوات الـ8 كلها (والخزنة كمان). المدير المالي مالوش وصول.
const SALES_OPS = MGR;
const TREASURY = MGR;

const envNum = (k: string, d: number) => {
  const v = Number(Deno.env.get(k));
  return Number.isFinite(v) && v > 0 ? v : d;
};
export const VOICE_PER_USER_DAILY = envNum("AI_VOICE_PER_USER_DAILY", 20);
export const VOICE_GLOBAL_DAILY = envNum("AI_VOICE_GLOBAL_DAILY", 60);
export const VOICE_MONTHLY_BUDGET_USD = envNum("AI_VOICE_MONTHLY_BUDGET_USD", 8);
const LLM_MODEL = Deno.env.get("AI_VOICE_MODEL") || "google/gemini-3.5-flash-lite";
const STT_MODEL = Deno.env.get("AI_VOICE_STT_MODEL") || "elevenlabs/scribe-v2";
const TTS_MODEL = Deno.env.get("AI_VOICE_TTS_MODEL") || "elevenlabs/eleven-v4";
const TTS_VOICE = Deno.env.get("AI_VOICE_TTS_VOICE") || "L10lEremDiJfPicq5CPh"; // ياسمين (مصرية)
const MAX_AUDIO_BYTES = 1_500_000; // ~ دقيقة صوت webm/opus
const MAX_ANSWER_CHARS = 420;

type ToolDef = {
  name: string;
  rpc: string;
  roles: string[];
  source: { label: string; path: string };
  topic: string; // اسم الموضوع بالعربي، بيتقال للمدير لما سؤاله مش متاح
  description: string;
  params: Record<string, unknown>;
  required: string[];
  args: (a: Record<string, unknown>, ctx: { asOf: string | null }) => Record<string, unknown>;
};

const dateParam = (d: string) => ({ type: "string", description: d + " بصيغة YYYY-MM-DD" });
const range = (a: Record<string, unknown>) => ({ _from: String(a.date_from ?? ""), _to: String(a.date_to ?? a.date_from ?? "") });

export const TOOLS: ToolDef[] = [
  {
    name: "sales_summary", rpc: "ai_tool_sales_summary", roles: MGR,
    topic: "المبيعات",
    source: { label: "كل الطلبات", path: "/orders" },
    description: "صافي المبيعات وعدد الطلبات والملغي لفترة، ومقارنة بالفترة اللي قبلها بنفس الطول.",
    params: { date_from: dateParam("بداية الفترة"), date_to: dateParam("نهاية الفترة") }, required: ["date_from", "date_to"],
    args: range,
  },
  {
    name: "top_products", rpc: "ai_tool_top_products", roles: MGR,
    topic: "الأصناف الأكتر مبيعًا",
    source: { label: "التقارير", path: "/reports" },
    description: "أكتر الأصناف مبيعًا بالقيمة والكمية لفترة.",
    params: { date_from: dateParam("بداية الفترة"), date_to: dateParam("نهاية الفترة"), limit: { type: "integer", description: "عدد الأصناف (1 إلى 15)" } },
    required: ["date_from", "date_to"],
    args: (a) => ({ ...range(a), _limit: Math.min(15, Math.max(1, Number(a.limit) || 5)) }),
  },
  {
    name: "ads_vs_cap", rpc: "ai_tool_ads_vs_cap", roles: SALES_OPS,
    topic: "الإعلانات",
    source: { label: "الإعلانات والإنفاق", path: "/chat-management/ad-spend" },
    description: "صرف الإعلانات لفترة ونسبته من صافي المبيعات مقابل سقف 6%، وأكتر الحملات صرفًا.",
    params: { date_from: dateParam("بداية الفترة"), date_to: dateParam("نهاية الفترة") }, required: ["date_from", "date_to"],
    args: range,
  },
  {
    name: "moderator_ranking", rpc: "ai_tool_moderator_ranking", roles: SALES_OPS,
    topic: "المودريتورز",
    source: { label: "أداء المودريتورز", path: "/moderator-performance" },
    description: "ترتيب المودريتورز بصافي المبيعات وعدد الطلبات والملغي لفترة.",
    params: { date_from: dateParam("بداية الفترة"), date_to: dateParam("نهاية الفترة") }, required: ["date_from", "date_to"],
    args: range,
  },
  {
    name: "pending_orders", rpc: "ai_tool_pending_orders", roles: MGR,
    topic: "الطلبات المعلّقة",
    source: { label: "كل الطلبات (المعلّق)", path: "/orders" },
    description: "عدد الطلبات المعلّقة الأقدم من عدد ساعات معيّن (الافتراضي 72 ساعة)، وأقدمها.",
    params: { older_than_hours: { type: "integer", description: "عدد الساعات، الافتراضي 72" } }, required: [],
    args: (a, ctx) => ({ _older_than_hours: Math.max(1, Number(a.older_than_hours) || 72), _as_of: ctx.asOf }),
  },
  {
    name: "zero_stock", rpc: "ai_tool_zero_stock", roles: MGR,
    topic: "المخزون الصفري",
    source: { label: "أرصدة المخازن", path: "/warehouse-stock" },
    description: "الأصناف النشطة اللي رصيدها صفر، والطلبات المعلّقة عليها.",
    params: {}, required: [], args: () => ({}),
  },
  {
    name: "treasury_balance", rpc: "ai_tool_treasury_balance", roles: TREASURY,
    topic: "رصيد الخزنة",
    source: { label: "الخزنة الرئيسية", path: "/main-treasury" },
    description: "رصيد الخزنة الرئيسية الحالي بالحسابات والحركات المعلّقة.",
    params: {}, required: [], args: () => ({}),
  },
  {
    name: "calls_quality", rpc: "ai_tool_calls_quality", roles: SALES_OPS,
    topic: "المكالمات",
    source: { label: "سجل المكالمات", path: "/chat-management/calls" },
    description: "مكالمات الخط الساخن لفترة: المردود عليها والفايتة، ومتوسط تقييم التعامل، وأكتر اعتراضات العملاء.",
    params: { date_from: dateParam("بداية الفترة"), date_to: dateParam("نهاية الفترة") }, required: ["date_from", "date_to"],
    args: range,
  },
  {
    name: "chat_response_by_moderator", rpc: "ai_tool_chat_response_by_moderator", roles: MGR,
    source: { label: "مؤشرات المحادثات", path: "/chat-management/kpis" },
    topic: "سرعة الرد على الواتساب",
    description: "محادثات الواتساب لفترة: لكل مودريتور عدد المحادثات ومتوسط أول رد بالدقايق (بساعات الخدمة) وعدد غير المردود عليه، ومين الأبطأ (slowest_moderator_by_avg) ومين عنده أكتر محادثات من غير رد.",
    params: { date_from: dateParam("بداية الفترة"), date_to: dateParam("نهاية الفترة") }, required: ["date_from", "date_to"],
    args: range,
  },
  {
    name: "chat_summary", rpc: "ai_tool_chat_summary", roles: MGR,
    source: { label: "مؤشرات المحادثات", path: "/chat-management/kpis" },
    topic: "ملخص المحادثات",
    description: "ملخص محادثات الواتساب لفترة: العدد، المردود عليه وغير المردود عليه، متوسط ووسيط أول رد بالدقايق، نسبة الرد في 15 دقيقة، من الإعلانات مقابل الطبيعي، ومقارنة بالفترة اللي قبلها.",
    params: { date_from: dateParam("بداية الفترة"), date_to: dateParam("نهاية الفترة") }, required: ["date_from", "date_to"],
    args: range,
  },
  {
    name: "chats_waiting_now", rpc: "ai_tool_chats_waiting_now", roles: MGR,
    source: { label: "صندوق المحادثات", path: "/chat-management/inbox" },
    topic: "المحادثات المستنية رد",
    description: "عدد محادثات الواتساب المستنية رد دلوقتي لأكتر من عدد دقايق معيّن (الافتراضي 30)، وأقدمها، وتوزيعها على المودريتورز.",
    params: { older_than_minutes: { type: "integer", description: "عدد الدقايق، الافتراضي 30" } }, required: [],
    args: (a, ctx) => ({ _older_than_minutes: Math.max(1, Number(a.older_than_minutes) || 30), _as_of: ctx.asOf }),
  },
];

const DAYS = ["الأحد", "الاتنين", "التلات", "الأربع", "الخميس", "الجمعة", "السبت"];

const MONTHS_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

/** فترة للعرض بالعربي وأرقام لاتينية: «18–24 أكتوبر 2026» أو «28 سبتمبر – 4 أكتوبر 2026». */
export function formatPeriod(from: string, to: string): string {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  if (!fy || !ty) return `${from} – ${to}`;
  if (from === to) return `${td} ${MONTHS_AR[tm - 1]} ${ty}`;
  if (fy === ty && fm === tm) return `${fd}–${td} ${MONTHS_AR[tm - 1]} ${ty}`;
  if (fy === ty) return `${fd} ${MONTHS_AR[fm - 1]} – ${td} ${MONTHS_AR[tm - 1]} ${ty}`;
  return `${fd} ${MONTHS_AR[fm - 1]} ${fy} – ${td} ${MONTHS_AR[tm - 1]} ${ty}`;
}

function cairoToday(): string {
  const sim = Deno.env.get("AI_ASSISTANT_TODAY"); // للتجربة بس: قاعدة التجربة بياناتها لحد تاريخ معيّن
  if (sim && /^\d{4}-\d{2}-\d{2}$/.test(sim)) return sim;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
}

/** مواضيع الأدوات المتاحة لحساب السائل، بالعربي (للرد لما السؤال مش متاح). */
export function voiceTopics(roles: string[]): string {
  return TOOLS.filter((t) => t.roles.some((r) => roles.includes(r))).map((t) => t.topic).join("، ");
}

/** لو مفيش أي أداة اتنادت، ممنوع رد فيه «صلاحيات»: الرد الصحيح «مش متاح لسه». */
export function guardNoToolAnswer(answer: string, toolCalled: boolean, roles: string[]): string {
  if (!toolCalled && /صلاحي/.test(answer)) return `ده مش متاح في المساعد لسه. أقدر أجاوبك عن ${voiceTopics(roles)}.`;
  return answer;
}

function systemPrompt(today: string, roles: string[]) {
  const d = new Date(today + "T12:00:00Z");
  const mine = TOOLS.filter((t) => t.roles.some((r) => roles.includes(r)));
  const allowed = mine.map((t) => t.name).join("، ");
  const topics = voiceTopics(roles);
  return `إنتِ «مساعد نعام»: مساعدة صوتية للمديرين في شركة «نعام العاصمة» (لحوم ومنتجات النعام في مصر). المدير بيسألك بصوته وإنتِ بتردي بصوت.
النهارده ${DAYS[d.getUTCDay()]} ${today} (بتوقيت القاهرة). «امبارح» = اليوم اللي قبله. «الأسبوع اللي فات» = آخر 7 أيام لحد امبارح. «الشهر ده» = من أول الشهر لحد امبارح.
القواعد:
- أي رقم لازم يكون من نتيجة أداة اتنادت دلوقتي. ممنوع تخمني أو تحسبي رقم مش موجود، إلا نسبة بسيطة من رقمين موجودين.
- عبارة «المعلومة دي مش ضمن صلاحيات حسابك» ممنوعة إلا لو أداة اتنادت فعلًا ورجّعت error=forbidden. غير كده ممنوع تذكري الصلاحيات خالص.
- لو مفيش أداة مناسبة للسؤال قولي بالنص: «ده مش متاح في المساعد لسه. أقدر أجاوبك عن ${topics}.» ومتنادييش أي أداة ومتخمنيش.
- الأدوات المتاحة لحساب السائل: ${allowed}.
- «محادثات الواتساب» و«الشات» و«الردود» = أدوات المحادثات. «سرعة الرد» = أول رد بدقايق ساعات الخدمة (من 9 صباحًا لـ1 بعد منتصف الليل). «مين أكتر واحدة بتتأخر» = slowest_moderator_by_avg، واذكري كمان عدد غير المردود عليه لو موجود. «المستني رد دلوقتي» = chats_waiting_now.
- لو الأداة رجّعت أصفار أو مفيش بيانات للفترة، قولي كده بوضوح ومتخترعيش.
- الرد بالمصري، جملتين أو تلاتة قصيرين بالكتير (أقل من 300 حرف)، لأنه هيتقري بصوت. اذكري الفترة.
- الأرقام بالأرقام اللاتينية (0-9) مع فاصلة الآلاف (284,330)، الفلوس مقربة للجنيه، والنسب برقم عشري واحد.
- النسب بعلامة % (مثلًا 0.9%)، مش «في المية».
- خاطبي السائل بـ«حضرتك» ومن غير أفعال مؤنثة أو مذكرة موجهة ليه.
- ممنوع تقري أرقام الطلبات أو أرقام تليفونات أو أسماء عملاء؛ قولي العدد بس.
- المدد الطويلة بالأيام مش بالساعات (مثلًا «27 يوم» بدل 648 ساعة).
- التواريخ بالشكل «18 أكتوبر»، مش 2026-10-18.
- من غير Markdown ولا نقط ولا رموز ولا إيموجي.
- سقف الإعلانات 6% من صافي المبيعات.
- ممنوع أي ادعاءات دينية أو صحية عن المنتجات. إنتِ للقراءة بس ومتقدريش تعدّلي أي حاجة.`;
}

function rolesAllow(roles: string[], need: string[]) {
  return roles.some((r) => need.includes(r));
}

async function gw(path: string, key: string, body: unknown, extra: Record<string, string> = {}) {
  const r = await fetch(`${GW}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...extra },
    body: JSON.stringify(body),
  });
  const txt = await r.text();
  let j: any = null;
  try { j = JSON.parse(txt); } catch { /* ignore */ }
  if (!r.ok) {
    const err = new Error(`gateway ${path} ${r.status}: ${txt.slice(0, 200)}`) as Error & { status?: number };
    err.status = r.status;
    throw err;
  }
  return j;
}

const num = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

async function transcribe(key: string, audioB64: string, mime: string) {
  const j = await gw("/v4/ai/transcription-model", key, {
    audio: audioB64, mediaType: mime,
    providerOptions: { elevenlabs: { languageCode: "ara", tagAudioEvents: false } },
  }, {
    "ai-gateway-protocol-version": "0.0.1",
    "ai-transcription-model-specification-version": "4",
    "ai-model-id": STT_MODEL,
  });
  return { text: String(j?.text ?? "").trim(), seconds: num(j?.durationInSeconds), cost: num(j?.providerMetadata?.gateway?.cost) };
}

async function speak(key: string, text: string) {
  const j = await gw("/v4/ai/speech-model", key, { text, voice: TTS_VOICE, outputFormat: "mp3", language: "ar" }, {
    "ai-gateway-protocol-version": "0.0.1",
    "ai-speech-model-specification-version": "4",
    "ai-model-id": TTS_MODEL,
  });
  return { audio: String(j?.audio ?? ""), cost: num(j?.providerMetadata?.gateway?.cost) };
}

function collectNumbers(v: unknown, out: Set<number>) {
  if (v == null) return;
  if (typeof v === "number") { out.add(v); return; }
  if (typeof v === "string") { for (const n of extractNumbers(v)) out.add(n); return; }
  if (Array.isArray(v)) { v.forEach((x) => collectNumbers(x, out)); return; }
  if (typeof v === "object") Object.values(v as Record<string, unknown>).forEach((x) => collectNumbers(x, out));
}

function isVerified(n: number, facts: Set<number>, extra: Set<number>) {
  if (extra.has(n)) return true;
  for (const f of facts) {
    if (Math.abs(f - n) < 1e-9) return true;
    if (Math.round(f) === n || Math.round(f * 10) / 10 === n || Math.abs(f) === n) return true;
    // «284 ألف» بدل 284,330
    if (n >= 1 && Math.round(f / 1000) === n) return true;
  }
  return false;
}

// deno-lint-ignore no-explicit-any
type SupabaseClient = any; // نفس عميل index.ts (esm.sh)

export type VoiceInput = { audio_base64?: string; mime?: string; question?: string; speak?: boolean };

export async function handleVoice(opts: {
  input: VoiceInput;
  roles: string[];
  userId: string;
  userClient: SupabaseClient;
  auditAdmin: SupabaseClient;
  aiKey: string;
  json: (b: unknown, s?: number) => Response;
}) {
  const { input, roles, userId, userClient, auditAdmin, aiKey, json } = opts;
  const t0 = Date.now();
  const timing: Record<string, number> = {};
  const cost = { stt: 0, llm: 0, tts: 0 };
  const toolLog: Array<Record<string, unknown>> = [];
  const kind = input.audio_base64 ? "voice" : "voice_text";

  // 1) الحدود: يومي لكل مستخدم، يومي للكل، وسقف الشهر (من السجل، بمفتاح الخدمة — عدّ بس)
  const today = cairoToday();
  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
  const monthStart = new Date(Date.UTC(dayStart.getUTCFullYear(), dayStart.getUTCMonth(), 1));
  const [{ count: userCount }, { count: globalCount }, { data: monthRows }] = await Promise.all([
    auditAdmin.from("ai_assistant_query_log").select("id", { count: "exact", head: true })
      .eq("user_id", userId).like("module", "voice%").gte("created_at", dayStart.toISOString()),
    auditAdmin.from("ai_assistant_query_log").select("id", { count: "exact", head: true })
      .like("module", "voice%").gte("created_at", dayStart.toISOString()),
    auditAdmin.from("ai_assistant_query_log").select("cost_usd").not("cost_usd", "is", null).gte("created_at", monthStart.toISOString()),
  ]);
  const monthSpend = (monthRows || []).reduce((s: number, r: any) => s + num(r.cost_usd), 0);
  const limits = { per_user_daily: VOICE_PER_USER_DAILY, used_today: userCount || 0, month_spend_usd: Number(monthSpend.toFixed(4)), month_budget_usd: VOICE_MONTHLY_BUDGET_USD };
  if ((userCount || 0) >= VOICE_PER_USER_DAILY) return json({ error: `وصلت للحد اليومي (${VOICE_PER_USER_DAILY} سؤال). جرّب بكرة.`, code: "user_daily_limit", limits }, 429);
  if ((globalCount || 0) >= VOICE_GLOBAL_DAILY) return json({ error: `المساعد وصل للحد اليومي العام (${VOICE_GLOBAL_DAILY} سؤال).`, code: "global_daily_limit", limits }, 429);
  if (monthSpend >= VOICE_MONTHLY_BUDGET_USD) return json({ error: `ميزانية المساعد للشهر ده خلصت ($${VOICE_MONTHLY_BUDGET_USD}).`, code: "monthly_budget", limits }, 402);

  const log = async (row: Record<string, unknown>) => {
    const { error } = await auditAdmin.from("ai_assistant_query_log").insert({
      user_id: userId, module: `voice:${row.status}`, kind, model: LLM_MODEL, tools: toolLog,
      cost_usd: Number((cost.stt + cost.llm + cost.tts).toFixed(6)), latency_ms: Date.now() - t0, ...row,
    });
    if (error) console.error("ai log insert failed", error.message);
  };

  // 2) صوت → نص
  let transcript = String(input.question ?? "").trim();
  let audioSeconds = 0;
  if (input.audio_base64) {
    const b64 = String(input.audio_base64).replace(/^data:[^,]+,/, "");
    if (b64.length * 0.75 > MAX_AUDIO_BYTES) return json({ error: "التسجيل طويل. اسأل في أقل من دقيقة." }, 413);
    const mime = String(input.mime || "audio/webm").split(";")[0];
    if (!/^audio\/(webm|ogg|mp4|mpeg|wav|x-wav|aac|m4a)$/.test(mime)) return json({ error: "نوع الصوت مش مدعوم." }, 415);
    const ts = Date.now();
    try {
      const s = await transcribe(aiKey, b64, mime);
      transcript = s.text; audioSeconds = s.seconds; cost.stt = s.cost;
    } catch (e) {
      await log({ question: "(صوت)", status: "stt_failed", answer: String((e as Error).message).slice(0, 300) });
      return json({ error: "مقدرتش أفرّغ الصوت. جرّب تاني." }, 502);
    }
    timing.stt_ms = Date.now() - ts;
  }
  transcript = toLatinDigits(transcript).slice(0, 500);
  if (transcript.length < 2) {
    await log({ question: "(صوت فاضي)", status: "empty", audio_seconds: audioSeconds });
    return json({ error: "مسمعتش سؤال واضح. اضغط على المايك واتكلم تاني.", code: "empty" }, 422);
  }

  // 3) نموذج اللغة + الأدوات
  const tl = Date.now();
  const asOf = Deno.env.get("AI_ASSISTANT_TODAY") ? `${today}T20:00:00+02:00` : null;
  const messages: any[] = [{ role: "system", content: systemPrompt(today, roles) }, { role: "user", content: transcript }];
  const tools = TOOLS.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: { type: "object", properties: t.params, required: t.required } },
  }));
  const facts = new Set<number>();
  const citations: Array<{ label: string; path: string; period: string | null; tool: string }> = [];
  let answer = "";
  try {
    for (let round = 0; round < 4; round++) {
      const j = await gw("/v1/chat/completions", aiKey, {
        model: LLM_MODEL, messages, tools, tool_choice: "auto", temperature: 0.2, max_tokens: 600,
      });
      cost.llm += num(j?.usage?.cost);
      const msg = j?.choices?.[0]?.message;
      const calls = msg?.tool_calls ?? [];
      if (!calls.length) { answer = String(msg?.content ?? "").trim(); break; }
      messages.push(msg);
      // الأدوات في نفس الدور بتتنادى بالتوازي (أسرع)، والنتايج بترجع بنفس الترتيب
      const outs = await Promise.all(calls.map(async (c: any) => {
        const def = TOOLS.find((t) => t.name === c.function?.name);
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(c.function?.arguments || "{}"); } catch { /* ignore */ }
        let result: unknown;
        if (!def) {
          result = { error: "unknown_tool" };
        } else if (!rolesAllow(roles, def.roles)) {
          result = { error: "forbidden", message: "المعلومة دي مش ضمن صلاحيات حسابك" };
          toolLog.push({ tool: def.name, args, status: "forbidden" });
        } else {
          const { data, error } = await userClient.rpc(def.rpc, def.args(args, { asOf }));
          if (error) {
            const forbidden = /forbidden|permission denied/i.test(error.message);
            result = forbidden ? { error: "forbidden", message: "المعلومة دي مش ضمن صلاحيات حسابك" } : { error: "tool_failed" };
            toolLog.push({ tool: def.name, args, status: forbidden ? "forbidden" : "error", detail: error.message.slice(0, 200) });
          } else {
            result = data;
            collectNumbers(data, facts);
            const p = (data as any)?.period;
            citations.push({ tool: def.name, label: def.source.label, path: def.source.path, period: p?.from ? formatPeriod(String(p.from), String(p.to)) : asOf ? `لحد ${formatPeriod(today, today)}` : "الوضع الحالي" });
            toolLog.push({ tool: def.name, args, status: "ok" });
          }
        }
        return { role: "tool", tool_call_id: c.id, content: JSON.stringify(result).slice(0, 6000) };
      }));
      messages.push(...outs);
    }
  } catch (e) {
    const st = (e as any)?.status;
    await log({ question: transcript, transcript, status: "llm_failed", audio_seconds: audioSeconds, answer: String((e as Error).message).slice(0, 300) });
    if (st === 402) return json({ error: "رصيد بوابة الذكاء الاصطناعي خلص." }, 402);
    return json({ error: "حصلت مشكلة في تجهيز الإجابة. جرّب تاني." }, 502);
  }
  timing.llm_ms = Date.now() - tl;
  if (!answer) answer = "معلش، مقدرتش أجهّز إجابة. جرّب تسأل بطريقة تانية.";
  const display = guardNoToolAnswer(toLatinDigits(answer).replace(/[*_#`]/g, ""), toolLog.length > 0, roles).slice(0, MAX_ANSWER_CHARS);

  // 4) التحقق من الأرقام (الأرقام اللي في السؤال والتواريخ مسموحة)
  const extra = new Set<number>([...extractNumbers(transcript), 6, 15, 30, 72]);
  const d = new Date(today + "T12:00:00Z");
  for (let i = 0; i < 400; i++) { const x = new Date(d.getTime() - i * 86400000); extra.add(x.getUTCDate()); extra.add(x.getUTCFullYear()); }
  for (let i = 1; i <= 7; i++) extra.add(i);
  const unverified = extractNumbers(display).filter((n) => !isVerified(n, facts, extra));

  // 5) نص → صوت ياسمين
  const speech = toSpeechText(display);
  let audio = "";
  if (input.speak !== false) {
    const tt = Date.now();
    try {
      const s = await speak(aiKey, speech);
      audio = s.audio; cost.tts = s.cost;
    } catch (e) {
      console.error("tts failed", (e as Error).message);
    }
    timing.tts_ms = Date.now() - tt;
  }
  timing.total_ms = Date.now() - t0;
  const status = toolLog.some((t) => t.status === "forbidden") ? "forbidden"
    : !toolLog.length ? "no_tool" // النموذج رد من غير أرقام (رفض أو سؤال خارج الأدوات)
    : unverified.length ? "ok_unverified" : "ok";
  await log({ question: transcript, transcript: input.audio_base64 ? transcript : null, answer: display, status, audio_seconds: audioSeconds });

  return json({
    ok: true,
    transcript,
    answer_text: display,
    speech_text: speech,
    audio_base64: audio || null,
    audio_mime: "audio/mpeg",
    citations,
    unverified_numbers: unverified,
    today,
    model: { llm: LLM_MODEL, stt: STT_MODEL, tts: TTS_MODEL, voice: "Yasmine" },
    usage: {
      cost_usd: Number((cost.stt + cost.llm + cost.tts).toFixed(6)),
      stt_usd: cost.stt, llm_usd: Number(cost.llm.toFixed(6)), tts_usd: cost.tts,
      timing,
    },
    limits: { ...limits, used_today: limits.used_today + 1, remaining: VOICE_PER_USER_DAILY - limits.used_today - 1 },
  });
}

