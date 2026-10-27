import { describe, it, expect } from "vitest";
import {
  handleWebhook, signBody, extractMessages, normalizePhone, attributionOf, type IngestArgs, type IngestResult,
} from "../../supabase/functions/whatsapp-webhook/handler";
import { clockStart } from "@/lib/chatManagement/responseClock";

// كل القيم وهمية.
const env = { META_APP_SECRET: "test-secret", WHATSAPP_VERIFY_TOKEN: "test-verify" };
const URL_ = "https://example.invalid/functions/v1/whatsapp-webhook";

/** قاعدة بيانات مزيفة تحاكي cm_ingest_whatsapp_message: تمنع التكرار بالمعرّف وتؤجل العداد خارج النافذة. */
const fakeDb = () => {
  const msgs = new Map<string, IngestArgs>();
  const ingest = async (a: IngestArgs): Promise<IngestResult> => {
    if (msgs.has(a._provider_message_id)) return { duplicate: true };
    msgs.set(a._provider_message_id, a);
    const at = new Date(a._sent_at);
    return { duplicate: false, conversation_id: "conv-" + a._wa_id, deferred: clockStart(at).getTime() > at.getTime() };
  };
  return { msgs, ingest };
};

const payload = (msgs: any[]) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "WABA", changes: [{ field: "messages", value: {
    messaging_product: "whatsapp", metadata: { phone_number_id: "PNID-TEST-1" },
    contacts: [{ wa_id: "201000000001", profile: { name: "عميل تجريبي" } }],
    messages: msgs,
  } }] }],
});
// 2026-10-27 11:30 القاهرة = 08:30Z ؛ 2026-10-28 03:00 القاهرة = 00:00Z
const ts = (iso: string) => String(Date.parse(iso) / 1000);
const msg = (id: string, iso: string, extra: any = {}) =>
  ({ from: "201000000001", id, timestamp: ts(iso), type: "text", text: { body: "سلام" }, ...extra });

const post = async (body: unknown, sign = true) => {
  const raw = JSON.stringify(body);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (sign) headers["X-Hub-Signature-256"] = await signBody(env.META_APP_SECRET, raw);
  return new Request(URL_, { method: "POST", body: raw, headers });
};

describe("whatsapp webhook", () => {
  it("is inert without secrets (503, nothing written)", async () => {
    const db = fakeDb();
    const r = await handleWebhook(await post(payload([msg("w1", "2026-10-27T08:30:00Z")])), {}, db.ingest);
    expect(r.status).toBe(503);
    expect(db.msgs.size).toBe(0);
  });

  it("GET verification echoes the challenge only with the right token", async () => {
    const db = fakeDb();
    const ok = await handleWebhook(new Request(`${URL_}?hub.mode=subscribe&hub.verify_token=test-verify&hub.challenge=123`), env, db.ingest);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("123");
    const bad = await handleWebhook(new Request(`${URL_}?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=123`), env, db.ingest);
    expect(bad.status).toBe(403);
  });

  it("rejects missing or wrong X-Hub-Signature-256", async () => {
    const db = fakeDb();
    expect((await handleWebhook(await post(payload([msg("w1", "2026-10-27T08:30:00Z")]), false), env, db.ingest)).status).toBe(401);
    const req = new Request(URL_, { method: "POST", body: JSON.stringify(payload([])), headers: { "X-Hub-Signature-256": "sha256=" + "0".repeat(64) } });
    expect((await handleWebhook(req, env, db.ingest)).status).toBe(401);
    // التوقيع على نص مختلف (تلاعب بالمحتوى)
    const raw = JSON.stringify(payload([msg("w1", "2026-10-27T08:30:00Z")]));
    const tampered = new Request(URL_, { method: "POST", body: raw.replace("سلام", "تلاعب"), headers: { "X-Hub-Signature-256": await signBody(env.META_APP_SECRET, raw) } });
    expect((await handleWebhook(tampered, env, db.ingest)).status).toBe(401);
    expect(db.msgs.size).toBe(0);
  });

  it("duplicate delivery stores the message once", async () => {
    const db = fakeDb();
    const p = payload([msg("wamid.A", "2026-10-27T08:30:00Z")]);
    const r1 = await (await handleWebhook(await post(p), env, db.ingest)).json();
    const r2 = await (await handleWebhook(await post(p), env, db.ingest)).json();
    expect(r1).toEqual({ processed: 1, duplicates: 0, deferred: 0 });
    expect(r2).toEqual({ processed: 0, duplicates: 1, deferred: 0 });
    expect(db.msgs.size).toBe(1);
  });

  it("off-hours message (03:00 Cairo) is deferred to 09:00", async () => {
    const db = fakeDb();
    const r = await (await handleWebhook(await post(payload([msg("wamid.N", "2026-10-28T00:00:00Z")])), env, db.ingest)).json();
    expect(r).toEqual({ processed: 1, duplicates: 0, deferred: 1 });
  });

  it("returns 500 on ingest failure so Meta retries", async () => {
    const r = await handleWebhook(await post(payload([msg("x", "2026-10-27T08:30:00Z")])), env, async () => { throw new Error("db down"); });
    expect(r.status).toBe(500);
  });

  it("extracts messages, ignores statuses, and attributes ads (ctwa_clid then referral)", () => {
    const p = payload([
      msg("m1", "2026-10-27T08:30:00Z", { referral: { source_id: "ad-1", source_type: "ad", ctwa_clid: "clid-1" } }),
      msg("m2", "2026-10-27T08:31:00Z", { referral: { source_id: "ad-2", source_type: "ad" } }),
    ]);
    (p.entry[0].changes[0].value as any).statuses = [{ id: "s1", status: "read" }];
    const out = extractMessages(p);
    expect(out.map((m) => m._provider_message_id)).toEqual(["m1", "m2"]);
    expect(out[0]).toMatchObject({ _phone_number_id: "PNID-TEST-1", _ctwa_clid: "clid-1", _referral_source_id: "ad-1", _profile_name: "عميل تجريبي", _body: "سلام" });
    expect(out[1]._ctwa_clid).toBeNull();
    expect(attributionOf(out[0]._raw && (out[0]._raw as any).referral).method).toBe("ctwa_clid");
    expect(attributionOf({ source_id: "ad-2" }).method).toBe("referral");
    expect(attributionOf(undefined).method).toBe("unknown");
    expect(extractMessages({ object: "page" })).toEqual([]);
  });

  it("normalizes Egyptian numbers like cm_normalize_phone", () => {
    expect(normalizePhone("201000000001")).toBe("01000000001");
    expect(normalizePhone("+20 10 0000 0001")).toBe("01000000001");
    expect(normalizePhone("00201000000001")).toBe("01000000001");
    expect(normalizePhone("٠١٠٠٠٠٠٠٠٠١")).toBe("01000000001");
    expect(normalizePhone("")).toBeNull();
  });
});
