/**
 * Pure logic for `b2b-quote-ingest` (capitalostrich.com «للفنادق والمطاعم» form → coceg).
 *
 * No Deno-only globals so the same code runs in Supabase Edge Runtime and Vitest.
 *
 * - Called server-to-server by the WordPress site (never from the browser).
 * - Auth: `X-COC-Timestamp` (unix seconds) + `X-COC-Signature` =
 *   base64(HMAC-SHA256(B2B_QUOTE_SECRET, `${timestamp}.${rawBody}`)), constant-time compare,
 *   ±5 min clock window (replay guard). The secret and the signature are never logged.
 * - Honeypot: a non-empty `company_website` field → 200 {ok:true} with no write (bots get no hint).
 * - Validation here (shape/length/Egyptian mobile), then one DB call: b2b_quote_ingest
 *   (service_role only) which also enforces the rate limit, idempotency by submission_id,
 *   and flags a *possible* existing customer by mobile. No customer is ever merged.
 * - The visitor IP is stored only as an HMAC hash.
 */
import { timingSafeEqualText } from "../_shared/cron-secret.ts";

export const B2B_SIGNATURE_HEADER = "x-coc-signature";
export const B2B_TIMESTAMP_HEADER = "x-coc-timestamp";
export const B2B_SECRET_ENV = "B2B_QUOTE_SECRET";
export const MAX_BODY_BYTES = 16 * 1024;
export const MAX_CLOCK_SKEW_SECONDS = 300;

export const FACILITY_TYPES = ["hotel", "restaurant", "cafe", "catering"] as const;
export type FacilityType = (typeof FACILITY_TYPES)[number];
export const PRODUCT_KEYS = [
  "whole_box", "thigh", "drumstick", "steak", "farasha", "escalope", "minced", "burger", "kofta",
] as const;
export type ProductKey = (typeof PRODUCT_KEYS)[number];

/** Arabic labels the site may send instead of keys. */
const FACILITY_ALIASES: Record<string, FacilityType> = {
  "فندق": "hotel", "مطعم": "restaurant", "كافيه": "cafe", "كافية": "cafe", "تموين": "catering",
};

export interface B2BEnv {
  B2B_QUOTE_SECRET?: string;
}

export interface QuotePayload {
  submission_id: string;
  facility_name: string;
  facility_type: FacilityType;
  contact_name: string;
  mobile: string;
  governorate: string;
  products: ProductKey[];
  weekly_qty: string | null;
  notes: string | null;
  source: string;
  attribution: Record<string, string> | null;
  submitted_at: string | null;
  ip_hash: string | null;
}

export type IngestResult =
  | { result: "created" | "duplicate"; id: string; ref_no: number }
  | { result: "rate_limited" }
  | { result: "invalid"; field: string };

export type IngestFn = (data: QuotePayload) => Promise<IngestResult>;

const enc = new TextEncoder();

async function hmacBase64(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
  let bin = "";
  for (const b of sig) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** What the site must send in X-COC-Signature (exported for tests and the WP spec). */
export function signQuoteBody(secret: string, timestamp: string, rawBody: string): Promise<string> {
  return hmacBase64(secret, `${timestamp}.${rawBody}`);
}

export async function verifyQuoteSignature(
  secret: string, timestamp: string, rawBody: string, provided: string,
): Promise<boolean> {
  const got = (provided ?? "").trim().replace(/^sha256=/i, "");
  if (!secret || !got || !timestamp) return false;
  const want = await signQuoteBody(secret, timestamp, rawBody);
  return timingSafeEqualText(got, want);
}

export function timestampFresh(ts: string, nowMs: number): boolean {
  if (!/^\d{9,11}$/.test(ts)) return false;
  return Math.abs(nowMs / 1000 - Number(ts)) <= MAX_CLOCK_SKEW_SECONDS;
}

const ARABIC_DIGITS = /[\u0660-\u0669\u06F0-\u06F9]/g;
export function toLatinDigits(s: string): string {
  return s.replace(ARABIC_DIGITS, (d) => {
    const c = d.charCodeAt(0);
    return String(c >= 0x06f0 ? c - 0x06f0 : c - 0x0660);
  });
}

/** Egyptian mobile → 01XXXXXXXXX, or null. Mirrors public.normalize_phone_eg for mobiles. */
export function normalizeEgMobile(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let s = toLatinDigits(raw).trim().replace(/[^0-9+]/g, "");
  if (s.startsWith("+20")) s = s.slice(3);
  else if (s.startsWith("0020")) s = s.slice(4);
  else if (/^20\d{10}$/.test(s)) s = s.slice(2);
  if (/^1\d{9}$/.test(s)) s = "0" + s;
  return /^01[0125]\d{8}$/.test(s) ? s : null;
}

const clean = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  // strip control chars, collapse whitespace
  // eslint-disable-next-line no-control-regex
  const t = v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > max ? null : t;
};

const ATTR_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "referrer", "page_url", "gclid", "fbclid"];

export function pickAttribution(body: Record<string, unknown>): Record<string, string> | null {
  const out: Record<string, string> = {};
  const src = { ...(typeof body.utm === "object" && body.utm ? body.utm as Record<string, unknown> : {}), ...body };
  for (const k of ATTR_KEYS) {
    const short = k.startsWith("utm_") ? k.slice(4) : k;
    const v = src[k] ?? src[short];
    const c = clean(v, 300);
    if (c) out[k] = c;
  }
  return Object.keys(out).length ? out : null;
}

export type ValidationResult = { ok: true; data: Omit<QuotePayload, "ip_hash"> } | { ok: false; fields: string[] };

export function validateQuote(body: unknown): ValidationResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, fields: ["body"] };
  const b = body as Record<string, unknown>;
  const fields: string[] = [];

  const submission_id = typeof b.submission_id === "string" ? b.submission_id.trim() : "";
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(submission_id)) fields.push("submission_id");

  const facility_name = clean(b.facility_name, 120);
  if (!facility_name || facility_name.length < 2) fields.push("facility_name");

  const rawType = typeof b.facility_type === "string" ? b.facility_type.trim() : "";
  const facility_type = (FACILITY_TYPES as readonly string[]).includes(rawType)
    ? (rawType as FacilityType) : FACILITY_ALIASES[rawType];
  if (!facility_type) fields.push("facility_type");

  const contact_name = clean(b.contact_name, 80);
  if (!contact_name || contact_name.length < 2) fields.push("contact_name");

  const mobile = normalizeEgMobile(b.mobile);
  if (!mobile) fields.push("mobile");

  const governorate = clean(b.governorate, 40);
  if (!governorate || governorate.length < 2) fields.push("governorate");

  let products: ProductKey[] = [];
  if (b.products !== undefined && b.products !== null) {
    if (!Array.isArray(b.products) || b.products.length > PRODUCT_KEYS.length * 2) fields.push("products");
    else products = Array.from(new Set(b.products.filter((p): p is ProductKey =>
      typeof p === "string" && (PRODUCT_KEYS as readonly string[]).includes(p))));
  }

  const weekly_qty = b.weekly_qty == null || b.weekly_qty === "" ? null : clean(b.weekly_qty, 200);
  if (b.weekly_qty != null && b.weekly_qty !== "" && weekly_qty === null) fields.push("weekly_qty");
  const notes = b.notes == null || b.notes === "" ? null : clean(b.notes, 1000);
  if (b.notes != null && b.notes !== "" && notes === null) fields.push("notes");

  const submitted_at = typeof b.submitted_at === "string" && !Number.isNaN(Date.parse(b.submitted_at))
    ? new Date(b.submitted_at).toISOString() : null;

  if (fields.length) return { ok: false, fields };
  return {
    ok: true,
    data: {
      submission_id, facility_name: facility_name!, facility_type: facility_type!, contact_name: contact_name!,
      mobile: mobile!, governorate: governorate!, products, weekly_qty, notes,
      source: "website_horeca", attribution: pickAttribution(b), submitted_at,
    },
  };
}

/** Best-effort per-instance limiter (the DB limit is the real one). */
export class MemoryRateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private max: number, private windowMs: number) {}
  allow(key: string, nowMs: number): boolean {
    const arr = (this.hits.get(key) ?? []).filter((t) => nowMs - t < this.windowMs);
    if (arr.length >= this.max) { this.hits.set(key, arr); return false; }
    arr.push(nowMs);
    this.hits.set(key, arr);
    if (this.hits.size > 5000) this.hits.clear();
    return true;
  }
}

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });

export interface HandlerOptions {
  now?: () => number;
  limiter?: MemoryRateLimiter;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
}

const defaultLimiter = new MemoryRateLimiter(10, 10 * 60 * 1000);

export async function handleQuoteRequest(
  req: Request, env: B2BEnv, ingest: IngestFn, opts: HandlerOptions = {},
): Promise<Response> {
  const now = opts.now ?? Date.now;
  const log = opts.log ?? ((m, e) => console.log(`[b2b-quote-ingest] ${m}`, e ? JSON.stringify(e) : ""));
  const limiter = opts.limiter ?? defaultLimiter;

  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });
  const secret = (env.B2B_QUOTE_SECRET ?? "").trim();
  if (!secret) { log("not_configured"); return json(503, { ok: false, error: "not_configured" }); }

  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > MAX_BODY_BYTES) return json(413, { ok: false, error: "too_large" });
  const raw = await req.text();
  if (enc.encode(raw).length > MAX_BODY_BYTES) return json(413, { ok: false, error: "too_large" });

  const ts = (req.headers.get(B2B_TIMESTAMP_HEADER) ?? "").trim();
  const sig = req.headers.get(B2B_SIGNATURE_HEADER) ?? "";
  if (!timestampFresh(ts, now())) { log("stale_timestamp"); return json(401, { ok: false, error: "stale_timestamp" }); }
  if (!(await verifyQuoteSignature(secret, ts, raw, sig))) { log("bad_signature"); return json(401, { ok: false, error: "bad_signature" }); }

  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return json(400, { ok: false, error: "bad_json" }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json(400, { ok: false, error: "bad_json" });

  // Honeypot: real visitors never fill it. Answer like success, write nothing.
  const hp = body.company_website;
  if (typeof hp === "string" && hp.trim() !== "") { log("honeypot"); return json(200, { ok: true }); }

  const clientIp = typeof body.client_ip === "string" ? body.client_ip.trim().slice(0, 64) : "";
  const ip_hash = clientIp ? (await hmacHex(secret, `ip:${clientIp}`)).slice(0, 32) : null;
  if (!limiter.allow(ip_hash ?? "no-ip", now())) { log("rate_limited_memory"); return json(429, { ok: false, error: "rate_limited" }); }

  const v = validateQuote(body);
  if (v.ok === false) return json(422, { ok: false, error: "invalid", fields: v.fields });

  let res: IngestResult;
  try {
    res = await ingest({ ...v.data, ip_hash });
  } catch (e) {
    log("ingest_failed", { message: e instanceof Error ? e.message.slice(0, 200) : "unknown" });
    return json(500, { ok: false, error: "ingest_failed" });
  }
  if (res.result === "rate_limited") return json(429, { ok: false, error: "rate_limited" });
  if (res.result === "invalid") return json(422, { ok: false, error: "invalid", fields: [res.field] });
  log(res.result, { ref: `HQ-${res.ref_no}` });
  return json(200, { ok: true, ref: `HQ-${res.ref_no}`, duplicate: res.result === "duplicate" });
}
