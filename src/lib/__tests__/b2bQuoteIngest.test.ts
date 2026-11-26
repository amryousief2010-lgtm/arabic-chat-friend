import { describe, expect, it, vi } from "vitest";
import {
  MemoryRateLimiter, handleQuoteRequest, normalizeEgMobile, pickAttribution, signQuoteBody, timestampFresh,
  validateQuote, verifyQuoteSignature, type B2BEnv, type IngestFn, type QuotePayload,
} from "../../../supabase/functions/b2b-quote-ingest/handler";

const SECRET = "test-b2b-quote-secret-xyz";
const URL_ = "https://example.supabase.co/functions/v1/b2b-quote-ingest";
const NOW = 1_795_000_000_000; // ms
const TS = String(Math.floor(NOW / 1000));

const valid = {
  submission_id: "wp-7f3a9c2e-0001",
  facility_name: "فندق النيل",
  facility_type: "hotel",
  contact_name: "الشيف محمود",
  mobile: "٠١٠٠١٢٣٤٥٦٧",
  governorate: "القاهرة",
  products: ["whole_box", "drumstick", "unknown"],
  weekly_qty: "2 نعامة، 4 دبوس",
  notes: "التوريد صباحاً",
  client_ip: "203.0.113.9",
  company_website: "",
  utm: { source: "google", campaign: "horeca" },
  page_url: "https://capitalostrich.com/hotels/",
  submitted_at: "2026-11-27T09:00:00Z",
};

async function req(body: unknown, opts: { ts?: string; sig?: string; method?: string; secret?: string } = {}) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const ts = opts.ts ?? TS;
  const sig = opts.sig ?? (await signQuoteBody(opts.secret ?? SECRET, ts, raw));
  return new Request(URL_, {
    method: opts.method ?? "POST",
    headers: { "content-type": "application/json", "x-coc-timestamp": ts, "x-coc-signature": sig },
    body: opts.method === "GET" ? undefined : raw,
  });
}

const okIngest = () => vi.fn<IngestFn>(async () => ({ result: "created", id: "u1", ref_no: 1001 }));
const run = (r: Request, ingest: IngestFn, env: B2BEnv = { B2B_QUOTE_SECRET: SECRET }, limiter = new MemoryRateLimiter(10, 600_000)) =>
  handleQuoteRequest(r, env, ingest, { now: () => NOW, limiter, log: () => {} });

describe("signature + timestamp", () => {
  it("verifies the site signature and rejects tampering", async () => {
    const sig = await signQuoteBody(SECRET, TS, "{}");
    expect(await verifyQuoteSignature(SECRET, TS, "{}", sig)).toBe(true);
    expect(await verifyQuoteSignature(SECRET, TS, "{}", `sha256=${sig}`)).toBe(true);
    expect(await verifyQuoteSignature(SECRET, TS, "{ }", sig)).toBe(false);
    expect(await verifyQuoteSignature(SECRET, String(Number(TS) + 1), "{}", sig)).toBe(false);
    expect(await verifyQuoteSignature("", TS, "{}", sig)).toBe(false);
    expect(await verifyQuoteSignature(SECRET, TS, "{}", "")).toBe(false);
  });
  it("accepts ±5 minutes only", () => {
    expect(timestampFresh(TS, NOW)).toBe(true);
    expect(timestampFresh(String(Number(TS) - 299), NOW)).toBe(true);
    expect(timestampFresh(String(Number(TS) - 301), NOW)).toBe(false);
    expect(timestampFresh("abc", NOW)).toBe(false);
  });
});

describe("validation", () => {
  it("normalizes Egyptian mobiles (Arabic digits, +20, spaces)", () => {
    expect(normalizeEgMobile("٠١٠٠١٢٣٤٥٦٧")).toBe("01001234567");
    expect(normalizeEgMobile("+20 100 123 4567")).toBe("01001234567");
    expect(normalizeEgMobile("00201551234567")).toBe("01551234567");
    expect(normalizeEgMobile("0223456789")).toBeNull(); // landline
    expect(normalizeEgMobile("01312345678")).toBeNull();
    expect(normalizeEgMobile(123)).toBeNull();
  });
  it("accepts a full payload, maps Arabic type labels, drops unknown products", () => {
    const v = validateQuote({ ...valid, facility_type: "مطعم" });
    expect(v.ok).toBe(true);
    if (v.ok === false) return;
    expect(v.data.facility_type).toBe("restaurant");
    expect(v.data.mobile).toBe("01001234567");
    expect(v.data.products).toEqual(["whole_box", "drumstick"]);
    expect(v.data.attribution).toEqual({ utm_source: "google", utm_campaign: "horeca", page_url: "https://capitalostrich.com/hotels/" });
    expect(v.data.source).toBe("website_horeca");
  });
  it("lists every bad field", () => {
    const v = validateQuote({ submission_id: "x", facility_name: "", facility_type: "bar", contact_name: "a", mobile: "1", governorate: "" });
    expect(v.ok).toBe(false);
    if (v.ok === true) return;
    expect(v.fields).toEqual(["submission_id", "facility_name", "facility_type", "contact_name", "mobile", "governorate"]);
  });
  it("rejects over-long notes", () => {
    const v = validateQuote({ ...valid, notes: "x".repeat(1001) });
    expect(v.ok).toBe(false);
  });
  it("picks attribution only from known keys", () => {
    expect(pickAttribution({ utm_source: "fb", evil: "x" })).toEqual({ utm_source: "fb" });
    expect(pickAttribution({})).toBeNull();
  });
});

describe("handleQuoteRequest", () => {
  it("creates and returns the reference, with hashed IP and no raw IP", async () => {
    const ingest = okIngest();
    const res = await run(await req(valid), ingest);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ref: "HQ-1001", duplicate: false });
    const sent = ingest.mock.calls[0][0] as QuotePayload;
    expect(sent.ip_hash).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(sent)).not.toContain("203.0.113.9");
    expect(JSON.stringify(sent)).not.toContain(SECRET);
  });
  it("duplicate submission → 200 duplicate:true", async () => {
    const ingest = vi.fn<IngestFn>(async () => ({ result: "duplicate", id: "u1", ref_no: 1001 }));
    const res = await run(await req(valid), ingest);
    expect(await res.json()).toEqual({ ok: true, ref: "HQ-1001", duplicate: true });
  });
  it("503 when the secret is not configured", async () => {
    const res = await run(await req(valid), okIngest(), {});
    expect(res.status).toBe(503);
  });
  it("401 on bad signature / stale timestamp; nothing written", async () => {
    const ingest = okIngest();
    expect((await run(await req(valid, { secret: "wrong" }), ingest)).status).toBe(401);
    expect((await run(await req(valid, { ts: String(Number(TS) - 3600) }), ingest)).status).toBe(401);
    expect(ingest).not.toHaveBeenCalled();
  });
  it("405 for GET, 413 for big bodies, 400 for bad json", async () => {
    expect((await run(await req(valid, { method: "GET" }), okIngest())).status).toBe(405);
    expect((await run(await req("x".repeat(17 * 1024)), okIngest())).status).toBe(413);
    expect((await run(await req("{not json"), okIngest())).status).toBe(400);
  });
  it("honeypot → 200 ok without writing", async () => {
    const ingest = okIngest();
    const res = await run(await req({ ...valid, company_website: "http://spam" }), ingest);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(ingest).not.toHaveBeenCalled();
  });
  it("422 with field names on invalid input", async () => {
    const res = await run(await req({ ...valid, mobile: "123" }), okIngest());
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ ok: false, error: "invalid", fields: ["mobile"] });
  });
  it("429 from the DB limit and from the memory limiter", async () => {
    const dbLimited = vi.fn<IngestFn>(async () => ({ result: "rate_limited" }));
    expect((await run(await req(valid), dbLimited)).status).toBe(429);
    const limiter = new MemoryRateLimiter(1, 600_000);
    const ingest = okIngest();
    expect((await run(await req(valid), ingest, undefined, limiter)).status).toBe(200);
    expect((await run(await req(valid), ingest, undefined, limiter)).status).toBe(429);
  });
  it("500 when the DB call fails, without leaking the secret", async () => {
    const logs: string[] = [];
    const failing = vi.fn<IngestFn>(async () => { throw new Error("db down"); });
    const res = await handleQuoteRequest(await req(valid), { B2B_QUOTE_SECRET: SECRET }, failing,
      { now: () => NOW, limiter: new MemoryRateLimiter(10, 1), log: (m, e) => logs.push(m + JSON.stringify(e ?? {})) });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: "ingest_failed" });
    expect(logs.join(" ")).not.toContain(SECRET);
  });
});
