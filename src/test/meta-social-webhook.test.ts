import { describe, it, expect } from "vitest";
import { handleSocialWebhook, signBody, extractOps, contentOf, adOf, buildSendRequest, type SocialOp } from "../../supabase/functions/meta-social-webhook/handler";

// كل القيم وهمية.
const env = { META_APP_SECRET: "test-secret", SOCIAL_WEBHOOK_VERIFY_TOKEN: "test-verify" };
const URL_ = "https://example.invalid/functions/v1/meta-social-webhook";
const PAGE = "PAGE-1", IG = "IGBIZ-1", PSID = "PSID-9", IGSID = "IGSID-7";

const fakeDb = () => {
  const seen = new Set<string>(); const ops: SocialOp[] = [];
  const run = async (op: SocialOp) => {
    ops.push(op);
    if (op.kind === "message") { const k = op.args._channel + op.args._provider_message_id; if (seen.has(k)) return { duplicate: true }; seen.add(k); }
    return { duplicate: false };
  };
  return { ops, run };
};
const post = async (body: unknown, secret = env.META_APP_SECRET) => {
  const raw = JSON.stringify(body);
  return new Request(URL_, { method: "POST", body: raw, headers: { "x-hub-signature-256": await signBody(secret, raw) } });
};
const page = (messaging: any[]) => ({ object: "page", entry: [{ id: PAGE, time: 1761900000000, messaging }] });
const ig = (messaging: any[]) => ({ object: "instagram", entry: [{ id: IG, time: 1761900000000, messaging }] });
const ts = 1761900000000;

describe("meta-social-webhook", () => {
  it("503 بدون أسرار، والتحقق GET بالتوكن", async () => {
    expect((await handleSocialWebhook(new Request(URL_), {}, async () => ({}))).status).toBe(503);
    const ok = await handleSocialWebhook(new Request(`${URL_}?hub.mode=subscribe&hub.verify_token=test-verify&hub.challenge=42`), env, async () => ({}));
    expect(ok.status).toBe(200); expect(await ok.text()).toBe("42");
    const bad = await handleSocialWebhook(new Request(`${URL_}?hub.mode=subscribe&hub.verify_token=x&hub.challenge=42`), env, async () => ({}));
    expect(bad.status).toBe(403);
    const fb = await handleSocialWebhook(new Request(`${URL_}?hub.mode=subscribe&hub.verify_token=wa&hub.challenge=7`), { META_APP_SECRET: "s", WHATSAPP_VERIFY_TOKEN: "wa" }, async () => ({}));
    expect(fb.status).toBe(200);
  });
  it("يرفض توقيعاً خاطئاً", async () => {
    const r = await handleSocialWebhook(await post(page([]), "wrong"), env, async () => ({}));
    expect(r.status).toBe(401);
  });
  it("ماسنجر: نص وارد + منع التكرار", async () => {
    const db = fakeDb();
    const body = page([{ sender: { id: PSID }, recipient: { id: PAGE }, timestamp: ts, message: { mid: "m.1", text: "عايز بوكس التوفير" } }]);
    const r1 = await (await handleSocialWebhook(await post(body), env, db.run)).json();
    const r2 = await (await handleSocialWebhook(await post(body), env, db.run)).json();
    expect(r1.processed).toBe(1); expect(r2.duplicates).toBe(1);
    const m = db.ops[0] as Extract<SocialOp, { kind: "message" }>;
    expect(m.args).toMatchObject({ _channel: "messenger", _account_id: PAGE, _contact_external_id: PSID, _direction: "in", _type: "text", _body: "عايز بوكس التوفير" });
    expect(m.args._sent_at).toBe(new Date(ts).toISOString());
  });
  it("ماسنجر: مرفق صورة وملف", () => {
    expect(contentOf({ attachments: [{ type: "image", payload: { url: "https://x/y.jpg" } }] })).toEqual({ type: "image", body: "https://x/y.jpg" });
    expect(contentOf({ attachments: [{ type: "file", payload: { url: "https://x/a.pdf" } }] }).type).toBe("document");
  });
  it("ماسنجر: echo من صندوق الصفحة = صادر للعميل", () => {
    const [op] = extractOps(page([{ sender: { id: PAGE }, recipient: { id: PSID }, timestamp: ts, message: { mid: "m.2", is_echo: true, text: "أهلاً بحضرتك" } }]));
    expect(op).toMatchObject({ kind: "message", args: { _direction: "out", _contact_external_id: PSID } });
  });
  it("ماسنجر: رسالة من إعلان (referral.ad_id) + messaging_referrals + postback", () => {
    const ops = extractOps(page([
      { sender: { id: PSID }, recipient: { id: PAGE }, timestamp: ts, message: { mid: "m.3", text: "السعر؟",
        referral: { source: "ADS", type: "OPEN_THREAD", ad_id: "120200000000250504", ads_context_data: { ad_title: "بوكس التوفير" } } } },
      { sender: { id: PSID }, recipient: { id: PAGE }, timestamp: ts, referral: { source: "ADS", type: "OPEN_THREAD", ad_id: "1202" } },
      { sender: { id: PSID }, recipient: { id: PAGE }, timestamp: ts, postback: { title: "ابدأ", payload: "GET_STARTED", mid: "pb.1" } },
      { sender: { id: PSID }, recipient: { id: PAGE }, timestamp: ts, read: { watermark: ts } },
    ]));
    expect(ops[0]).toMatchObject({ kind: "message", args: { _ad_id: "120200000000250504", _ad_source_type: "ad", _ad_headline: "بوكس التوفير" } });
    expect(ops.map((o) => o.kind)).toEqual(["message", "referral", "log", "message", "read"]);
    expect((ops[3] as any).args._type).toBe("postback");
    expect(adOf(undefined).ad_id).toBeNull();
  });
  it("إنستجرام: نص وارد و echo", () => {
    const ops = extractOps(ig([
      { sender: { id: IGSID }, recipient: { id: IG }, timestamp: ts, message: { mid: "ig.1", text: "متاح توصيل؟" } },
      { sender: { id: IG }, recipient: { id: IGSID }, timestamp: ts, message: { mid: "ig.2", text: "أيوه متاح", is_echo: true } },
    ]));
    expect(ops[0]).toMatchObject({ kind: "message", args: { _channel: "instagram", _direction: "in", _contact_external_id: IGSID } });
    expect(ops[1]).toMatchObject({ kind: "message", args: { _channel: "instagram", _direction: "out", _contact_external_id: IGSID } });
  });
  it("يتجاهل واتساب وكائنات أخرى", () => {
    expect(extractOps({ object: "whatsapp_business_account", entry: [] })).toEqual([]);
  });
  it("تصميم الرد لا يكشف التوكن في الجسم", () => {
    const r = buildSendRequest(PAGE, PSID, "شكراً", "TOKEN");
    expect(r.url).toContain(`/${PAGE}/messages`); expect(r.init.body).not.toContain("TOKEN");
  });
});
