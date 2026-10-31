// منطق webhook ماسنجر + إنستجرام (Meta Graph، ربط مباشر بدون وسيط) — بدون اعتماد على Deno لتشغيل vitest.
// خامل حتى يُضبط META_APP_SECRET و SOCIAL_WEBHOOK_VERIFY_TOKEN (أو WHATSAPP_VERIFY_TOKEN كاحتياطي): يرد 503.
// object=page: messages, message_echoes (is_echo), messaging_postbacks, messaging_referrals, message_reads
// object=instagram: messages (+ is_echo), messaging_referral(s), messaging_postbacks, message_reads
// لا يرسل أي رسالة. الكتابة كلها عبر دوال القاعدة cm_ingest_social_message / cm_social_* (service_role فقط).

export interface SocialEnv { META_APP_SECRET?: string; SOCIAL_WEBHOOK_VERIFY_TOKEN?: string; WHATSAPP_VERIFY_TOKEN?: string }
export type Channel = "messenger" | "instagram";

export interface SocialMessage {
  _channel: Channel; _account_id: string; _contact_external_id: string; _direction: "in" | "out";
  _provider_message_id: string; _sent_at: string; _type: string; _body: string | null; _raw: unknown;
  _profile_name: string | null; _handle: string | null;
  _ad_id: string | null; _ad_source_type: string | null; _ad_headline: string | null;
}
export type SocialOp =
  | { kind: "message"; args: SocialMessage }
  | { kind: "referral"; args: { _channel: Channel; _account_id: string; _contact_external_id: string; _ad_id: string; _ad_source_type: string | null; _ad_headline: string | null } }
  | { kind: "read"; args: { _channel: Channel; _account_id: string; _contact_external_id: string; _watermark: string } }
  | { kind: "log"; args: { _object: string; _field: string; _account_id: string | null; _info: unknown } };

const toHex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
export const safeEqual = (a: string, b: string) => { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; };
export const signBody = async (secret: string, body: string) => {
  const e = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", e.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return "sha256=" + toHex(await crypto.subtle.sign("HMAC", k, e.encode(body)));
};
export const verifySignature = async (secret: string, body: string, header: string | null) =>
  !!header && header.startsWith("sha256=") && safeEqual(await signBody(secret, body), header.trim().toLowerCase());

const ms = (x: any) => { const n = Number(x); return new Date(Number.isFinite(n) && n > 0 ? (n < 1e12 ? n * 1000 : n) : Date.now()).toISOString(); };

const ATT: Record<string, string> = { image: "image", video: "video", audio: "audio", file: "document", sticker: "sticker",
  location: "location", template: "template", fallback: "share", share: "share", story_mention: "story_mention", ig_reel: "share", reel: "share" };

/** نوع ونص رسالة ماسنجر/إنستجرام. */
export const contentOf = (m: any): { type: string; body: string | null } => {
  if (m?.is_deleted) return { type: "system", body: "حُذفت الرسالة" };
  if (m?.reply_to?.story) return { type: "story_reply", body: m.text ?? null };
  const att = (m?.attachments ?? [])[0];
  if (m?.text && !att) return { type: "text", body: String(m.text) };
  if (att) {
    const t = ATT[String(att.type)] ?? "unsupported";
    const body = m?.text ?? att.payload?.title ?? (t === "location" && att.payload?.coordinates
      ? `${att.payload.coordinates.lat},${att.payload.coordinates.long}` : null) ?? att.payload?.url ?? null;
    return { type: t, body: body ? String(body) : null };
  }
  if (m?.quick_reply) return { type: "interactive", body: m.text ?? m.quick_reply.payload ?? null };
  return { type: "unsupported", body: null };
};

/** إعلان النقر للمراسلة: referral.ad_id (ماسنجر) أو referral.ads_context_data (إنستجرام/ماسنجر). */
export const adOf = (ref: any): { ad_id: string | null; type: string | null; headline: string | null } => {
  if (!ref) return { ad_id: null, type: null, headline: null };
  const ad = ref.ad_id ?? ref.ads_context_data?.ad_id ?? null;
  const src = String(ref.source ?? "").toUpperCase();
  return { ad_id: ad ? String(ad) : null, type: ad || src === "ADS" ? "ad" : src ? src.toLowerCase() : null,
    headline: ref.ads_context_data?.ad_title ?? ref.ad_title ?? null };
};

export const extractOps = (payload: any): SocialOp[] => {
  const ops: SocialOp[] = [];
  const object = String(payload?.object ?? "");
  if (object !== "page" && object !== "instagram") return ops;
  const channel: Channel = object === "page" ? "messenger" : "instagram";
  for (const entry of payload.entry ?? []) {
    const account = String(entry?.id ?? "");
    const events = [...(entry?.messaging ?? []), ...(entry?.standby ?? [])];
    // إنستجرام أحياناً يرسل changes[] (field=messages, value=event)
    for (const ch of entry?.changes ?? []) if (ch?.value && typeof ch.value === "object") events.push({ ...ch.value, __field: ch.field });
    for (const ev of events) {
      const sender = ev?.sender?.id ? String(ev.sender.id) : null;
      const recipient = ev?.recipient?.id ? String(ev.recipient.id) : null;
      if (ev?.message) {
        const m = ev.message;
        const echo = !!m.is_echo || (!!sender && sender === account);
        const contact = echo ? recipient : sender;
        if (!m.mid || !contact) { ops.push({ kind: "log", args: { _object: object, _field: "messages_bad", _account_id: account, _info: { keys: Object.keys(m) } } }); continue; }
        const c = contentOf(m);
        const a = adOf(m.referral ?? ev.referral);
        ops.push({ kind: "message", args: { _channel: channel, _account_id: account, _contact_external_id: contact,
          _direction: echo ? "out" : "in", _provider_message_id: String(m.mid), _sent_at: ms(ev.timestamp), _type: c.type, _body: c.body,
          _raw: ev, _profile_name: null, _handle: null, _ad_id: a.ad_id, _ad_source_type: a.type, _ad_headline: a.headline } });
      } else if (ev?.postback) {
        const p = ev.postback;
        const contact = sender;
        if (!contact) continue;
        const a = adOf(p.referral);
        ops.push({ kind: "message", args: { _channel: channel, _account_id: account, _contact_external_id: contact, _direction: "in",
          _provider_message_id: String(p.mid ?? `pb:${account}:${contact}:${ev.timestamp}`), _sent_at: ms(ev.timestamp), _type: "postback",
          _body: p.title ?? p.payload ?? null, _raw: ev, _profile_name: null, _handle: null, _ad_id: a.ad_id, _ad_source_type: a.type, _ad_headline: a.headline } });
      } else if (ev?.referral) {
        const a = adOf(ev.referral);
        if (sender && a.ad_id) ops.push({ kind: "referral", args: { _channel: channel, _account_id: account, _contact_external_id: sender,
          _ad_id: a.ad_id, _ad_source_type: a.type, _ad_headline: a.headline } });
        ops.push({ kind: "log", args: { _object: object, _field: "messaging_referrals", _account_id: account, _info: { ref: ev.referral } } });
      } else if (ev?.read) {
        if (sender) ops.push({ kind: "read", args: { _channel: channel, _account_id: account, _contact_external_id: sender, _watermark: ms(ev.read.watermark ?? ev.timestamp) } });
      } else {
        ops.push({ kind: "log", args: { _object: object, _field: String(ev?.__field ?? "unknown"), _account_id: account, _info: { keys: Object.keys(ev ?? {}) } } });
      }
    }
  }
  return ops;
};

export type RunOp = (op: SocialOp) => Promise<any>;
const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

export const handleSocialWebhook = async (req: Request, env: SocialEnv, runOp: RunOp): Promise<Response> => {
  const verify = env.SOCIAL_WEBHOOK_VERIFY_TOKEN || env.WHATSAPP_VERIFY_TOKEN;
  if (!env.META_APP_SECRET || !verify) return json(503, { error: "not_configured" });
  const url = new URL(req.url);
  if (req.method === "GET") {
    const ok = url.searchParams.get("hub.mode") === "subscribe" && safeEqual(url.searchParams.get("hub.verify_token") ?? "", verify);
    if (!ok) return new Response("forbidden", { status: 403 });
    return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const raw = await req.text();
  if (!(await verifySignature(env.META_APP_SECRET, raw, req.headers.get("x-hub-signature-256")))) return json(401, { error: "bad_signature" });
  let payload: any;
  try { payload = JSON.parse(raw); } catch { return json(400, { error: "bad_json" }); }
  let processed = 0, duplicates = 0, ops = 0;
  for (const op of extractOps(payload)) {
    try {
      const r = await runOp(op); ops++;
      if (op.kind === "message") { if (r?.duplicate) duplicates++; else processed++; }
    } catch (e) {
      if (op.kind === "log") { console.error("social log failed", String(e)); continue; }
      return json(500, { error: "op_failed", kind: op.kind, processed, duplicates });  // ميتا تعيد الإرسال؛ الحفظ idempotent
    }
  }
  return json(200, { processed, duplicates, ops });
};

/** تصميم الرد (غير مفعّل): Send API عبر توكن الصفحة META_PAGE_ACCESS_TOKEN.
 * ماسنجر وإنستجرام: POST https://graph.facebook.com/v21.0/{PAGE_ID}/messages
 * body: { recipient: { id: PSID|IGSID }, messaging_type: "RESPONSE", message: { text } } — داخل نافذة 24 ساعة فقط.
 * لا يوجد مسار إرسال لواتساب في النظام حالياً، لذلك لا يُستدعى هذا من أي مكان بعد. */
export const buildSendRequest = (pageId: string, recipientId: string, text: string, token: string, version = "v21.0") => ({
  url: `https://graph.facebook.com/${version}/${encodeURIComponent(pageId)}/messages`,
  init: { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ recipient: { id: recipientId }, messaging_type: "RESPONSE", message: { text } }) },
});
