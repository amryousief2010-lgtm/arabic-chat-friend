// منطق webhook واتساب (Meta Cloud API) بدون أي اعتماد على Deno، لتشغيل اختبارات vitest عليه مباشرة.
// خامل تماماً حتى يُضبط السرّان META_APP_SECRET و WHATSAPP_VERIFY_TOKEN: يرد 503 ولا يكتب شيئاً.
// لا يرسل أي رسالة. الكتابة كلها عبر دوال قاعدة البيانات cm_ingest_whatsapp_* (service_role فقط)
// الحقول: messages (وارد + statuses)، smb_message_echoes، history، smb_app_state_sync؛ أي حقل آخر يُسجّل ويرد 200.
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

/** نوع ونص ووسائط أي رسالة واتساب (وارد/صادر/تاريخ). */
export interface Content { type: string; body: string | null; media: { id?: string; mime_type?: string; filename?: string; voice?: boolean; animated?: boolean } | null }
const MEDIA = ["image", "audio", "video", "document", "sticker"];
export const contentOf = (m: any): Content => {
  const t = String(m?.type ?? "unknown");
  const o = m?.[t] ?? {};
  if (t === "text") return { type: "text", body: o.body ?? null, media: null };
  if (MEDIA.includes(t)) {
    const media = { id: o.id, mime_type: o.mime_type, filename: o.filename, voice: o.voice, animated: o.animated };
    return { type: t, body: o.caption ?? (t === "document" ? o.filename ?? null : null), media };
  }
  if (t === "location") {
    const parts = [o.name, o.address].filter(Boolean).join(" — ");
    const ll = o.latitude != null && o.longitude != null ? `${o.latitude},${o.longitude}` : "";
    return { type: "location", body: [parts, ll].filter(Boolean).join(" ") || null, media: null };
  }
  if (t === "contacts") {
    const names = (m.contacts ?? []).map((c: any) => c?.name?.formatted_name ?? c?.name?.first_name).filter(Boolean);
    return { type: "contacts", body: names.length ? names.join("، ") : null, media: null };
  }
  if (t === "reaction") return { type: "reaction", body: o.emoji || null, media: null };
  if (t === "button") return { type: "interactive", body: o.text ?? o.payload ?? null, media: null };
  if (t === "interactive") {
    const b = o.button_reply?.title ?? o.list_reply?.title ?? o.nfm_reply?.body ?? o.nfm_reply?.name ?? null;
    return { type: "interactive", body: b, media: null };
  }
  if (t === "order") {
    const n = (o.product_items ?? []).length;
    return { type: "order", body: o.text ?? (n ? `طلب: ${n} منتج` : null), media: null };
  }
  if (t === "system") return { type: "system", body: o.body ?? null, media: null };
  if (t === "template") return { type: "template", body: o.name ?? null, media: null };
  if (t === "media_placeholder") return { type: "media_placeholder", body: null, media: null };
  if (t === "unsupported" || t === "unknown") return { type: "unsupported", body: null, media: null };
  return { type: "unknown", body: null, media: null };
};

const tsIso = (x: any) => { const n = Number(x); return new Date(Number.isFinite(n) && n > 0 ? n * 1000 : Date.now()).toISOString(); };
const digits = (x: any) => String(x ?? "").replace(/[^0-9]/g, "");

/** يستخرج الرسائل الواردة (field=messages) فقط. */
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
        const a = attributionOf(m.referral);
        const c = contentOf(m);
        out.push({
          _phone_number_id: pnid,
          _wa_id: String(m.from),
          _profile_name: names.get(String(m.from)) || null,
          _provider_message_id: String(m.id),
          _sent_at: tsIso(m.timestamp),
          _type: c.type,
          _body: c.body,
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

/** عمليات Coexistence (كلها idempotent في قاعدة البيانات). */
export type Op =
  | { kind: "echo"; args: { _phone_number_id: string | null; _to: string; _provider_message_id: string; _sent_at: string; _type: string; _body: string | null; _raw: unknown; _original_message_id: string | null } }
  | { kind: "history"; args: { _phone_number_id: string | null; _wa_id: string | null; _messages: any[] } }
  | { kind: "contacts"; args: { _phone_number_id: string | null; _contacts: any[] } }
  | { kind: "status"; args: { _provider_message_id: string; _status: string; _at: string; _error: string | null } }
  | { kind: "log"; args: { _field: string; _phone_number_id: string | null; _phase: number | null; _chunk_order: number | null; _progress: number | null; _error_code: number | null; _info: unknown } };

const num = (x: any) => (x == null || x === "" || !Number.isFinite(Number(x)) ? null : Number(x));

const histMsg = (m: any, businessNumbers: Set<string>) => {
  const c = contentOf(m);
  const out = m.to != null || businessNumbers.has(digits(m.from));
  return { id: String(m.id), direction: out ? "out" : "in", sent_at: tsIso(m.timestamp), type: c.type, body: c.body,
    status: m.history_context?.status ?? null, raw: m };
};

/** يحوّل كل الحقول غير الواردة إلى عمليات. */
export const extractOps = (payload: any): Op[] => {
  const ops: Op[] = [];
  if (payload?.object !== "whatsapp_business_account") return ops;
  for (const entry of payload.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const field = String(change?.field ?? "");
      const v = change?.value ?? {};
      const pnid = v.metadata?.phone_number_id ? String(v.metadata.phone_number_id) : null;
      const biz = new Set([digits(v.metadata?.display_phone_number)].filter(Boolean));
      if (field === "messages") {
        for (const s of v.statuses ?? []) {
          if (!s?.id || !s?.status) continue;
          const err = (s.errors ?? [])[0];
          ops.push({ kind: "status", args: { _provider_message_id: String(s.id), _status: String(s.status), _at: tsIso(s.timestamp),
            _error: err ? `${err.code ?? ""} ${err.title ?? err.message ?? ""}`.trim() : null } });
        }
      } else if (field === "smb_message_echoes") {
        for (const m of v.message_echoes ?? []) {
          if (!m?.id || !m?.to) continue;
          const t = String(m.type ?? "unknown");
          const inner = t === "edit" ? m.edit?.message : null;
          const c = t === "revoke" ? { type: "revoke", body: null } : t === "edit" ? { type: "edit", body: inner ? contentOf(inner).body : null } : contentOf(m);
          ops.push({ kind: "echo", args: { _phone_number_id: pnid, _to: String(m.to), _provider_message_id: String(m.id), _sent_at: tsIso(m.timestamp),
            _type: c.type, _body: c.body, _raw: m, _original_message_id: m.revoke?.original_message_id ?? m.edit?.original_message_id ?? null } });
        }
      } else if (field === "history") {
        // وسائط لاحقة لرسائل media_placeholder تأتي كـ value.messages داخل field=history
        if (Array.isArray(v.messages) && v.messages.length) {
          const byThread = new Map<string | null, any[]>();
          for (const m of v.messages) {
            if (!m?.id) continue;
            const hm = histMsg(m, biz);
            const wa = hm.direction === "in" ? digits(m.from) : m.to ? digits(m.to) : null;
            byThread.set(wa, [...(byThread.get(wa) ?? []), hm]);
          }
          for (const [wa, msgs] of byThread) ops.push({ kind: "history", args: { _phone_number_id: pnid, _wa_id: wa, _messages: msgs } });
        }
        for (const h of v.history ?? []) {
          const md = h?.metadata ?? {};
          const err = (h?.errors ?? [])[0];
          let count = 0;
          for (const th of h?.threads ?? []) {
            const wa = th?.id ? digits(th.id) : null;
            const msgs = (th?.messages ?? []).filter((m: any) => m?.id).map((m: any) => histMsg(m, biz));
            count += msgs.length;
            // دفعات صغيرة حتى لا تطول المعاملة
            for (let i = 0; i < msgs.length; i += 200)
              ops.push({ kind: "history", args: { _phone_number_id: pnid, _wa_id: wa, _messages: msgs.slice(i, i + 200) } });
          }
          ops.push({ kind: "log", args: { _field: "history", _phone_number_id: pnid, _phase: num(md.phase), _chunk_order: num(md.chunk_order),
            _progress: num(md.progress), _error_code: err ? num(err.code) : null,
            _info: { threads: (h?.threads ?? []).length, messages: count, error: err ? err.title ?? err.message ?? null : null } } });
        }
      } else if (field === "smb_app_state_sync") {
        const contacts = (v.state_sync ?? []).filter((s: any) => s?.type === "contact" && s?.contact?.phone_number)
          .map((s: any) => ({ phone: String(s.contact.phone_number), full_name: s.contact.full_name ?? null, first_name: s.contact.first_name ?? null,
            action: s.action ?? "add", ts: s.metadata?.timestamp ? tsIso(s.metadata.timestamp) : null }));
        if (contacts.length) ops.push({ kind: "contacts", args: { _phone_number_id: pnid, _contacts: contacts } });
      } else {
        // حقل غير مدعوم (account_update وغيره): نسجّل اسمه ومفاتيحه فقط
        ops.push({ kind: "log", args: { _field: field || "unknown", _phone_number_id: pnid, _phase: null, _chunk_order: null, _progress: null,
          _error_code: null, _info: { keys: Object.keys(v ?? {}), event: typeof v?.event === "string" ? v.event : null } } });
      }
    }
  }
  return ops;
};

export type RunOp = (op: Op) => Promise<any>;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export const handleWebhook = async (req: Request, env: WebhookEnv, ingest: Ingest, runOp?: RunOp): Promise<Response> => {
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

  let processed = 0, duplicates = 0, deferred = 0, ops = 0;
  for (const m of extractMessages(payload)) {
    try {
      const r = await ingest(m);
      if (r.duplicate) duplicates++; else { processed++; if (r.deferred) deferred++; }
    } catch (_e) {
      // 500 ← ميتا تعيد الإرسال؛ الحفظ idempotent فلا تكرار لما حُفظ قبل الخطأ.
      return json(500, { error: "ingest_failed", processed, duplicates });
    }
  }
  if (runOp) {
    for (const op of extractOps(payload)) {
      try { await runOp(op); ops++; }
      catch (e) {
        // السجل فقط لا يستحق إعادة الإرسال؛ الباقي idempotent فإعادة ميتا آمنة.
        if (op.kind === "log") { console.error("wa log failed", String(e)); continue; }
        console.error("wa op failed", op.kind, String(e));
        return json(500, { error: "op_failed", kind: op.kind, processed, duplicates, ops });
      }
    }
  }
  return json(200, { processed, duplicates, deferred, ops });
};
