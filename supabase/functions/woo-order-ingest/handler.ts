/**
 * Pure logic for `woo-order-ingest` (WooCommerce → coceg website inbox).
 *
 * No Deno-only globals so the same code runs in Supabase Edge Runtime and Vitest.
 *
 * - Auth: `X-WC-Webhook-Signature` = base64(HMAC-SHA256(WOO_WEBHOOK_SECRET, raw body)),
 *   compared in constant time. The secret and the signature are never logged.
 * - Topics: order.created, order.updated, customer.created. Anything else → 200 ignored.
 * - WooCommerce "ping" on webhook save (`webhook_id=N`, form body) → 200 without writing.
 * - Draft checkouts (`checkout-draft`) are ignored until the real order arrives.
 * - Writes go through one DB function (website_inbox_upsert, service_role only), which is
 *   idempotent by woo order id / woo customer id. A failed write returns 500 so WooCommerce
 *   retries delivery.
 * - Customer source (UTM / referrer / click ids) is stored on the inbox row and later on the
 *   order itself. Nothing here touches cm_ad_attributions.
 */
import { timingSafeEqualText } from "../_shared/cron-secret.ts";

export const WOO_SIGNATURE_HEADER = "x-wc-webhook-signature";
export const WOO_TOPIC_HEADER = "x-wc-webhook-topic";
export const WOO_DELIVERY_HEADER = "x-wc-webhook-delivery-id";
export const WOO_WEBHOOK_SECRET_ENV = "WOO_WEBHOOK_SECRET";
export const SUPPORTED_TOPICS = ["order.created", "order.updated", "customer.created"] as const;
export type SupportedTopic = (typeof SUPPORTED_TOPICS)[number];

export interface WooEnv {
  WOO_WEBHOOK_SECRET?: string;
}

export interface InboxItem {
  woo_product_id: number;
  woo_variation_id: number;
  name: string;
  quantity: number;
  unit_price: number | null;
  line_total: number | null;
}

export interface InboxData {
  woo_status: string | null;
  woo_customer_id: number | null;
  customer_name: string | null;
  phone: string | null;
  phone2: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  governorate: string | null;
  items: InboxItem[];
  shipping_total: number | null;
  discount_total: number | null;
  order_total: number | null;
  payment_method_title: string | null;
  customer_note: string | null;
  attribution: Record<string, string> | null;
  site_created_at: string | null;
}

export interface InboxUpsert {
  kind: "order" | "registration";
  external_id: number;
  data: InboxData;
  topic: SupportedTopic;
  delivery_id: string | null;
}

export type RunUpsert = (op: InboxUpsert) => Promise<unknown>;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const toBase64 = (buf: ArrayBuffer): string => {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
};

/** base64(HMAC-SHA256(secret, body)) — WooCommerce webhook signature format. */
export async function signWooBody(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toBase64(await crypto.subtle.sign("HMAC", key, enc.encode(body)));
}

export async function verifyWooSignature(secret: string, body: string, header: string | null): Promise<boolean> {
  const got = (header ?? "").trim();
  if (!secret || !got) return false;
  return timingSafeEqualText(await signWooBody(secret, body), got);
}

export const isPingBody = (raw: string) => /^webhook_id=\d+$/.test(raw.trim());

const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, 1000) : null;
};
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const int = (v: unknown): number | null => {
  const n = num(v);
  return n !== null && Number.isInteger(n) && n > 0 ? n : null;
};
const joinName = (...parts: unknown[]) => str(parts.map((p) => str(p) ?? "").filter(Boolean).join(" "));

/** Accepted attribution keys (own cookie keys and WooCommerce native `_wc_order_attribution_*`). */
export const ATTRIBUTION_KEYS = [
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id",
  "referrer", "fbclid", "gclid", "landing_page", "source_type", "session_entry", "device_type",
  // First-touch copies from the site plugin (_coc_ft_* → ft_* after the _coc_ prefix is stripped).
  "ft_utm_source", "ft_utm_medium", "ft_utm_campaign", "ft_utm_term", "ft_utm_content",
  "ft_referrer", "ft_fbclid", "ft_gclid",
] as const;

export function extractAttribution(meta: unknown): Record<string, string> | null {
  if (!Array.isArray(meta)) return null;
  const out: Record<string, string> = {};
  for (const m of meta) {
    const rawKey = str((m as { key?: unknown })?.key);
    if (!rawKey) continue;
    const key = rawKey.toLowerCase().replace(/^_wc_order_attribution_/, "").replace(/^_?coc_/, "").replace(/^_/, "");
    if (!(ATTRIBUTION_KEYS as readonly string[]).includes(key)) continue;
    const value = str((m as { value?: unknown })?.value);
    if (value && !(key in out)) out[key] = value.slice(0, 500);
  }
  return Object.keys(out).length ? out : null;
}

// deno-lint-ignore no-explicit-any
export function normalizeOrder(o: any): InboxData {
  const b = o?.billing ?? {};
  const s = o?.shipping ?? {};
  const items: InboxItem[] = (Array.isArray(o?.line_items) ? o.line_items : [])
    // deno-lint-ignore no-explicit-any
    .map((li: any) => {
      const qty = num(li?.quantity) ?? 0;
      const lineTotal = num(li?.subtotal) ?? num(li?.total);
      const unit = num(li?.price) ?? (lineTotal !== null && qty > 0 ? Math.round((lineTotal / qty) * 100) / 100 : null);
      return {
        woo_product_id: int(li?.product_id) ?? 0,
        woo_variation_id: int(li?.variation_id) ?? 0,
        name: str(li?.name) ?? "منتج بدون اسم",
        quantity: qty,
        unit_price: unit,
        line_total: lineTotal,
      };
    })
    .filter((li: InboxItem) => li.woo_product_id > 0 && li.quantity > 0);

  const billingPhone = str(b.phone);
  const shippingPhone = str(s.phone);
  return {
    woo_status: str(o?.status),
    woo_customer_id: int(o?.customer_id),
    customer_name: joinName(s.first_name || b.first_name, s.last_name || b.last_name),
    phone: billingPhone ?? shippingPhone,
    phone2: shippingPhone && shippingPhone !== billingPhone ? shippingPhone : null,
    email: str(b.email),
    address: joinName(s.address_1 || b.address_1, s.address_2 || b.address_2),
    city: str(s.city || b.city),
    governorate: str(s.state || b.state),
    items,
    shipping_total: num(o?.shipping_total),
    discount_total: num(o?.discount_total),
    order_total: num(o?.total),
    payment_method_title: str(o?.payment_method_title) ?? str(o?.payment_method),
    customer_note: str(o?.customer_note),
    attribution: extractAttribution(o?.meta_data),
    site_created_at: o?.date_created_gmt ? `${String(o.date_created_gmt).replace(/Z$/, "")}Z` : null,
  };
}

// deno-lint-ignore no-explicit-any
export function normalizeCustomer(c: any): InboxData {
  const b = c?.billing ?? {};
  return {
    woo_status: null,
    woo_customer_id: int(c?.id),
    customer_name: joinName(c?.first_name || b.first_name, c?.last_name || b.last_name) ?? str(c?.username),
    phone: str(b.phone),
    phone2: str(c?.shipping?.phone) !== str(b.phone) ? str(c?.shipping?.phone) : null,
    email: str(c?.email) ?? str(b.email),
    address: joinName(b.address_1, b.address_2),
    city: str(b.city),
    governorate: str(b.state),
    items: [],
    shipping_total: null,
    discount_total: null,
    order_total: null,
    payment_method_title: null,
    customer_note: null,
    attribution: extractAttribution(c?.meta_data),
    site_created_at: c?.date_created_gmt ? `${String(c.date_created_gmt).replace(/Z$/, "")}Z` : null,
  };
}

export async function handleWooWebhook(req: Request, env: WooEnv, runUpsert: RunUpsert): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  const secret = (env.WOO_WEBHOOK_SECRET ?? "").trim();
  if (!secret) return json(503, { error: "not_configured" });

  const raw = await req.text();
  const signature = req.headers.get(WOO_SIGNATURE_HEADER);

  // WooCommerce pings the URL when the webhook is saved. Nothing is written.
  if (!signature && isPingBody(raw)) return json(200, { ok: true, ping: true });

  if (!(await verifyWooSignature(secret, raw, signature))) return json(401, { error: "bad_signature" });

  const topic = (req.headers.get(WOO_TOPIC_HEADER) ?? "").trim().toLowerCase();
  if (!(SUPPORTED_TOPICS as readonly string[]).includes(topic)) return json(200, { ok: true, ignored: "topic" });

  // deno-lint-ignore no-explicit-any
  let payload: any;
  try { payload = JSON.parse(raw); } catch { return json(400, { error: "bad_json" }); }

  const deliveryId = str(req.headers.get(WOO_DELIVERY_HEADER));
  let op: InboxUpsert;
  if (topic === "customer.created") {
    const id = int(payload?.id);
    if (!id) return json(400, { error: "missing_id" });
    op = { kind: "registration", external_id: id, data: normalizeCustomer(payload), topic, delivery_id: deliveryId };
  } else {
    const id = int(payload?.id);
    if (!id) return json(400, { error: "missing_id" });
    const status = String(payload?.status ?? "").toLowerCase();
    if (status === "checkout-draft" || status === "auto-draft") return json(200, { ok: true, ignored: "draft" });
    op = { kind: "order", external_id: id, data: normalizeOrder(payload), topic: topic as SupportedTopic, delivery_id: deliveryId };
  }

  try {
    const result = await runUpsert(op);
    return json(200, { ok: true, result });
  } catch (e) {
    console.error("woo-order-ingest upsert failed", op.kind, op.external_id, String((e as Error)?.message ?? e).slice(0, 200));
    return json(500, { error: "upsert_failed" });
  }
}
