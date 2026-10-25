// منطق webhook واتساب (Meta Cloud API) بدون أي اعتماد على Deno، لتشغيل اختبارات vitest عليه مباشرة.
// خامل تماماً حتى يُضبط السرّان META_APP_SECRET و WHATSAPP_VERIFY_TOKEN: يرد 503 ولا يكتب شيئاً.
// لا يرسل أي رسالة. الكتابة كلها عبر دالة قاعدة البيانات cm_ingest_whatsapp_message (service_role فقط)
// وهي التي تمنع التكرار وتطبّع الرقم وتسجّل مصدر الإعلان وتوزّع المحادثة وتؤجّل العداد لـ 09:00.

export interface WebhookEnv {
  META_APP_SECRET?: string;
  WHATSAPP_VERIFY_TOKEN?: string;
}

export interface IngestArgs {
  _phone_number_id: string | null;
  _wa_id: string;
  _profile_name: string | null;
  _provider_message_id: string;
  _sent_at: string; // ISO
  _type: string;
  _body: string | null;
  _raw: unknown;
  _ctwa_clid: string | null;
  _referral_source_id: string | null;
  _referral_source_type: string | null;
  _referral_headline: string | null;
}

export interface IngestResult {
  duplicate: boolean;
  conversation_id?: string;
  deferred?: boolean;
}

export type Ingest = (args: IngestArgs) => Promise<IngestResult>;

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹";

/** نفس قاعدة cm_normalize_phone: أرقام فقط، و20/0020/+20 أمام موبايل مصري تصبح 0. */
export const normalizePhone = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  let d = [...raw].map((ch) => { const i = AR_DIGITS.indexOf(ch); return i >= 0 ? String(i % 10) : ch; }).join("")
    .replace(/[^0-9]/g, "");
  if (/^00201[0-9]{9}$/.test(d)) d = d.slice(3);
  else if (/^0201[0-9]{9}$/.test(d)) d = d.slice(2);
  else if (/^201[0-9]{9}$/.test(d)) d = "0" + d.slice(2);
  else if (/^20201[0-9]{9}$/.test(d)) d = d.slice(3);
  return d || null;
};

/** مصدر الإعلان: ctwa_clid أولاً ثم referral.source_id. */
export const attributionOf = (referral: any): { method: "ctwa_clid" | "referral" | "unknown"; ctwa_clid: string | null; source_id: string | null } => {
  const ctwa = referral?.ctwa_clid ? String(referral.ctwa_clid) : null;
  const src = referral?.source_id ? String(referral.source_id) : null;
  return { method: ctwa ? "ctwa_clid" : src ? "referral" : "unknown", ctwa_clid: ctwa, source_id: src };
};

const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

const safeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
};

export const signBody = async (secret: string, body: string): Promise<string> => {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return "sha256=" + toHex(await crypto.subtle.sign("HMAC", key, enc.encode(body)));
};

/** يتحقق من X-Hub-Signature-256 على النص الخام كما وصل (قبل أي JSON.parse). */
export const verifySignature = async (secret: string, body: string, header: string | null): Promise<boolean> => {
  if (!header || !header.startsWith("sha256=")) return false;
  return safeEqual(await signBody(secret, body), header.trim().toLowerCase());
};

/** يستخرج الرسائل الواردة فقط (يتجاهل statuses وما سواها). */
export const extractMessages = (payload: any): IngestArgs[] => {
  const out: IngestArgs[] = [];
  if (payload?.object !== "whatsapp_business_account") return out;
  for (const entry of payload.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      if (change?.field !== "messages") continue;
      const v = change.value ?? {};
      const pnid = v.metadata?.phone_number_id ? String(v.metadata.phone_number_id) : null;
      const names = new Map<string, string>();
      for (const c of v.contacts ?? []) if (c?.wa_id) names.set(String(c.wa_id), c.profile?.name ?? "");
      for (const m of v.messages ?? []) {
        if (!m?.id || !m?.from) continue;
        const ts = Number(m.timestamp);
        const a = attributionOf(m.referral);
        const body = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title
          ?? m.image?.caption ?? m.video?.caption ?? m.document?.caption ?? null;
        out.push({
          _phone_number_id: pnid,
          _wa_id: String(m.from),
          _profile_name: names.get(String(m.from)) || null,
          _provider_message_id: String(m.id),
          _sent_at: new Date(Number.isFinite(ts) && ts > 0 ? ts * 1000 : Date.now()).toISOString(),
          _type: m.type === "button" ? "interactive" : String(m.type ?? "unknown"),
          _body: body,
          _raw: m,
          _ctwa_clid: a.ctwa_clid,
          _referral_source_id: a.source_id,
          _referral_source_type: m.referral?.source_type ?? null,
          _referral_headline: m.referral?.headline ?? null,
        });
      }
    }
  }
  return out;
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export const handleWebhook = async (req: Request, env: WebhookEnv, ingest: Ingest): Promise<Response> => {
  if (!env.META_APP_SECRET || !env.WHATSAPP_VERIFY_TOKEN) return json(503, { error: "not_configured" });
  const url = new URL(req.url);

  if (req.method === "GET") {
    const ok = url.searchParams.get("hub.mode") === "subscribe"
      && safeEqual(url.searchParams.get("hub.verify_token") ?? "", env.WHATSAPP_VERIFY_TOKEN);
    if (!ok) return new Response("forbidden", { status: 403 });
    return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const raw = await req.text();
  if (!(await verifySignature(env.META_APP_SECRET, raw, req.headers.get("x-hub-signature-256")))) {
    return json(401, { error: "bad_signature" });
  }
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return json(400, { error: "bad_json" }); }

  let processed = 0, duplicates = 0, deferred = 0;
  for (const m of extractMessages(payload)) {
    try {
      const r = await ingest(m);
      if (r.duplicate) duplicates++; else { processed++; if (r.deferred) deferred++; }
    } catch (_e) {
      // 500 ← ميتا تعيد الإرسال؛ الحفظ idempotent فلا تكرار لما حُفظ قبل الخطأ.
      return json(500, { error: "ingest_failed", processed, duplicates });
    }
  }
  return json(200, { processed, duplicates, deferred });
};
