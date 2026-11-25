import { describe, expect, it, vi } from "vitest";
import {
  extractAttribution,
  handleWooWebhook,
  normalizeCustomer,
  normalizeOrder,
  signWooBody,
  verifyWooSignature,
  type InboxUpsert,
} from "../../../supabase/functions/woo-order-ingest/handler";

const SECRET = "test-woo-webhook-secret-123";
const URL_ = "https://example.supabase.co/functions/v1/woo-order-ingest";

const order = {
  id: 9001,
  status: "processing",
  customer_id: 77,
  total: "3620.00",
  shipping_total: "240.00",
  discount_total: "0.00",
  payment_method: "cod",
  payment_method_title: "الدفع عند الاستلام",
  customer_note: "اتصل قبل التوصيل",
  date_created_gmt: "2026-11-25T10:00:00",
  billing: { first_name: "أحمد", last_name: "علي", phone: "01001234567", email: "a@example.com", address_1: "شارع 9", city: "المعادي", state: "القاهرة" },
  shipping: { first_name: "", last_name: "", phone: "", address_1: "", city: "", state: "" },
  line_items: [
    { product_id: 11, variation_id: 0, name: "بوكس 1500", quantity: 2, price: 1500, subtotal: "3000.00", total: "3000.00" },
    { product_id: 12, variation_id: 34, name: "كفتة نعام", quantity: 1, price: 620, subtotal: "620.00", total: "620.00" },
    { product_id: 0, name: "رسوم", quantity: 1, price: 5 },
  ],
  meta_data: [
    { key: "_wc_order_attribution_utm_source", value: "facebook" },
    { key: "_wc_order_attribution_utm_campaign", value: "nov-sale" },
    { key: "_wc_order_attribution_session_entry", value: "https://capitalostrich.com/shop" },
    { key: "_billing_secret_thing", value: "x" },
    { key: "fbclid", value: "abc" },
  ],
};

async function req(body: string, headers: Record<string, string> = {}, sign = true, method = "POST") {
  const h: Record<string, string> = { "content-type": "application/json", ...headers };
  if (sign) h["x-wc-webhook-signature"] = await signWooBody(SECRET, body);
  return new Request(URL_, { method, headers: h, body: method === "GET" ? undefined : body });
}

describe("woo-order-ingest signature", () => {
  it("accepts the WooCommerce base64 HMAC and rejects anything else", async () => {
    const body = JSON.stringify(order);
    const sig = await signWooBody(SECRET, body);
    expect(sig).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(await verifyWooSignature(SECRET, body, sig)).toBe(true);
    expect(await verifyWooSignature(SECRET, body + " ", sig)).toBe(false);
    expect(await verifyWooSignature("other", body, sig)).toBe(false);
    expect(await verifyWooSignature(SECRET, body, null)).toBe(false);
    expect(await verifyWooSignature("", body, sig)).toBe(false);
  });
});

describe("handleWooWebhook", () => {
  const env = { WOO_WEBHOOK_SECRET: SECRET };

  it("503 when the secret is not configured, without writing", async () => {
    const run = vi.fn();
    const res = await handleWooWebhook(await req("{}", { "x-wc-webhook-topic": "order.created" }), {}, run);
    expect(res.status).toBe(503);
    expect(run).not.toHaveBeenCalled();
  });

  it("405 for non-POST", async () => {
    const res = await handleWooWebhook(await req("", {}, false, "GET"), env, vi.fn());
    expect(res.status).toBe(405);
  });

  it("answers the WooCommerce ping with 200 and no write", async () => {
    const run = vi.fn();
    const r = new Request(URL_, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "webhook_id=15" });
    const res = await handleWooWebhook(r, env, run);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ping: true });
    expect(run).not.toHaveBeenCalled();
  });

  it("401 on a bad or missing signature", async () => {
    const run = vi.fn();
    const body = JSON.stringify(order);
    const bad = new Request(URL_, { method: "POST", headers: { "x-wc-webhook-topic": "order.created", "x-wc-webhook-signature": "AAAA" }, body });
    expect((await handleWooWebhook(bad, env, run)).status).toBe(401);
    const missing = new Request(URL_, { method: "POST", headers: { "x-wc-webhook-topic": "order.created" }, body });
    expect((await handleWooWebhook(missing, env, run)).status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it("ignores unsupported topics and draft checkouts", async () => {
    const run = vi.fn();
    const r1 = await handleWooWebhook(await req(JSON.stringify(order), { "x-wc-webhook-topic": "product.updated" }), env, run);
    expect(await r1.json()).toMatchObject({ ignored: "topic" });
    const draft = JSON.stringify({ ...order, status: "checkout-draft" });
    const r2 = await handleWooWebhook(await req(draft, { "x-wc-webhook-topic": "order.created" }), env, run);
    expect(await r2.json()).toMatchObject({ ignored: "draft" });
    expect(run).not.toHaveBeenCalled();
  });

  it("order.created → one idempotent upsert keyed by the Woo order id", async () => {
    const calls: InboxUpsert[] = [];
    const run = vi.fn(async (op: InboxUpsert) => { calls.push(op); return { inbox_id: "x", created: calls.length === 1 }; });
    const body = JSON.stringify(order);
    const headers = { "x-wc-webhook-topic": "order.created", "x-wc-webhook-delivery-id": "d-1" };
    expect((await handleWooWebhook(await req(body, headers), env, run)).status).toBe(200);
    // Retry of the same delivery: same key, same data → DB function upserts the same row.
    expect((await handleWooWebhook(await req(body, headers), env, run)).status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(calls[1]);
    expect(calls[0]).toMatchObject({ kind: "order", external_id: 9001, topic: "order.created", delivery_id: "d-1" });
    expect(calls[0].data.items).toHaveLength(2);
  });

  it("order.updated uses the same key", async () => {
    const run = vi.fn(async () => ({}));
    const body = JSON.stringify({ ...order, status: "cancelled" });
    await handleWooWebhook(await req(body, { "x-wc-webhook-topic": "order.updated" }), env, run);
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ kind: "order", external_id: 9001, topic: "order.updated" }));
    expect((run.mock.calls[0] as unknown as [InboxUpsert])[0].data.woo_status).toBe("cancelled");
  });

  it("customer.created → registration keyed by the Woo customer id", async () => {
    const run = vi.fn(async () => ({}));
    const body = JSON.stringify({ id: 77, email: "a@example.com", first_name: "أحمد", last_name: "علي", billing: { phone: "01001234567", city: "المعادي" } });
    const res = await handleWooWebhook(await req(body, { "x-wc-webhook-topic": "customer.created" }), env, run);
    expect(res.status).toBe(200);
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ kind: "registration", external_id: 77, topic: "customer.created" }));
  });

  it("400 on bad JSON or missing id", async () => {
    const run = vi.fn();
    expect((await handleWooWebhook(await req("{bad", { "x-wc-webhook-topic": "order.created" }), env, run)).status).toBe(400);
    expect((await handleWooWebhook(await req("{}", { "x-wc-webhook-topic": "order.created" }), env, run)).status).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });

  it("500 when the DB write fails so WooCommerce retries; phone is not logged", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const run = vi.fn(async () => { throw new Error("db down"); });
    const res = await handleWooWebhook(await req(JSON.stringify(order), { "x-wc-webhook-topic": "order.created" }), env, run);
    expect(res.status).toBe(500);
    const logged = JSON.stringify(err.mock.calls);
    expect(logged).not.toContain("01001234567");
    expect(logged).not.toContain(SECRET);
    err.mockRestore();
  });
});

describe("normalizers", () => {
  it("normalizeOrder maps customer, items, totals and attribution", () => {
    const d = normalizeOrder(order);
    expect(d).toMatchObject({
      woo_status: "processing", woo_customer_id: 77, customer_name: "أحمد علي", phone: "01001234567", phone2: null,
      email: "a@example.com", address: "شارع 9", city: "المعادي", governorate: "القاهرة",
      shipping_total: 240, discount_total: 0, order_total: 3620, payment_method_title: "الدفع عند الاستلام",
      customer_note: "اتصل قبل التوصيل", site_created_at: "2026-11-25T10:00:00Z",
    });
    expect(d.items).toEqual([
      { woo_product_id: 11, woo_variation_id: 0, name: "بوكس 1500", quantity: 2, unit_price: 1500, line_total: 3000 },
      { woo_product_id: 12, woo_variation_id: 34, name: "كفتة نعام", quantity: 1, unit_price: 620, line_total: 620 },
    ]);
    expect(d.attribution).toEqual({ utm_source: "facebook", utm_campaign: "nov-sale", session_entry: "https://capitalostrich.com/shop", fbclid: "abc" });
  });

  it("uses a different shipping phone as phone2", () => {
    const d = normalizeOrder({ ...order, shipping: { ...order.shipping, phone: "01111111111" } });
    expect(d.phone2).toBe("01111111111");
  });

  it("extractAttribution ignores unknown keys and returns null when empty", () => {
    expect(extractAttribution([{ key: "_billing_phone", value: "0100" }])).toBeNull();
    expect(extractAttribution(null)).toBeNull();
  });

  it("normalizeCustomer maps a registration", () => {
    const d = normalizeCustomer({ id: 5, email: "x@y.com", username: "x", billing: { phone: "01200000000", city: "طنطا", state: "الغربية" } });
    expect(d).toMatchObject({ woo_customer_id: 5, customer_name: "x", phone: "01200000000", email: "x@y.com", city: "طنطا", items: [] });
  });
});
