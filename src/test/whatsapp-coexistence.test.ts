import { describe, it, expect } from "vitest";
import { handleWebhook, signBody, extractOps, contentOf, type Op, type IngestArgs } from "../../supabase/functions/whatsapp-webhook/handler";
import { messageText } from "@/components/chatManagement/ConversationThread";

// كل الأرقام وهمية.
const env = { META_APP_SECRET: "test-secret", WHATSAPP_VERIFY_TOKEN: "test-verify" };
const URL_ = "https://example.invalid/functions/v1/whatsapp-webhook";
const BIZ = "201000000099", CUST = "201000000000", PNID = "PNID-TEST-1";
const wrap = (field: string, value: any) => ({ object: "whatsapp_business_account",
  entry: [{ id: "WABA", changes: [{ field, value: { messaging_product: "whatsapp", metadata: { display_phone_number: BIZ, phone_number_id: PNID }, ...value } }] }] });
const post = async (body: unknown) => {
  const raw = JSON.stringify(body);
  return new Request(URL_, { method: "POST", body: raw, headers: { "X-Hub-Signature-256": await signBody(env.META_APP_SECRET, raw) } });
};
const run = async (body: unknown, fail?: Op["kind"]) => {
  const ops: Op[] = []; const ins: IngestArgs[] = [];
  const r = await handleWebhook(await post(body), env, async (a) => { ins.push(a); return { duplicate: false }; },
    async (op) => { if (op.kind === fail) throw new Error("x"); ops.push(op); });
  return { r, ops, ins, json: await r.json() };
};

describe("contentOf (type/body/media mapping)", () => {
  it.each([
    [{ type: "text", text: { body: "hi" } }, "text", "hi"],
    [{ type: "image", image: { id: "M1", mime_type: "image/jpeg", caption: "c" } }, "image", "c"],
    [{ type: "audio", audio: { id: "M2", mime_type: "audio/ogg", voice: true } }, "audio", null],
    [{ type: "video", video: { id: "M3" } }, "video", null],
    [{ type: "document", document: { id: "M4", filename: "a.pdf" } }, "document", "a.pdf"],
    [{ type: "sticker", sticker: { id: "M5", animated: false } }, "sticker", null],
    [{ type: "location", location: { latitude: 30, longitude: 31, name: "X" } }, "location", "X 30,31"],
    [{ type: "contacts", contacts: [{ name: { formatted_name: "A" } }] }, "contacts", "A"],
    [{ type: "reaction", reaction: { message_id: "w", emoji: "👍" } }, "reaction", "👍"],
    [{ type: "button", button: { text: "نعم", payload: "y" } }, "interactive", "نعم"],
    [{ type: "interactive", interactive: { type: "list_reply", list_reply: { title: "L" } } }, "interactive", "L"],
    [{ type: "order", order: { product_items: [{}, {}] } }, "order", "طلب: 2 منتج"],
    [{ type: "unsupported", unsupported: { type: "unknown" }, errors: [{ code: 131060 }] }, "unsupported", null],
    [{ type: "weird" }, "unknown", null],
  ])("%o", (m, type, body) => {
    const c = contentOf(m);
    expect(c.type).toBe(type);
    expect(c.body).toBe(body);
  });
  it("keeps media id", () => expect(contentOf({ type: "image", image: { id: "M1" } }).media?.id).toBe("M1"));
  it("readable placeholder in the thread", () => {
    expect(messageText({ type: "audio", body: null })).toContain("رسالة صوتية");
    expect(messageText({ type: "image", body: "c" })).toContain(": c");
    expect(messageText({ type: "text", body: "x" })).toBe("x");
  });
});

describe("coexistence fields", () => {
  it("smb_message_echoes → echo op (incl. edit/revoke)", async () => {
    const { r, ops, ins } = await run(wrap("smb_message_echoes", { message_echoes: [
      { from: BIZ, to: CUST, id: "wamid.E1", timestamp: "1761730000", type: "text", text: { body: "أهلاً" } },
      { from: BIZ, to: CUST, id: "wamid.E2", timestamp: "1761730001", type: "revoke", revoke: { original_message_id: "wamid.E1" } },
      { from: BIZ, to: CUST, id: "wamid.E3", timestamp: "1761730002", type: "edit", edit: { original_message_id: "wamid.E1", message: { type: "text", text: { body: "تعديل" } } } },
    ] }));
    expect(r.status).toBe(200);
    expect(ins).toHaveLength(0);
    expect(ops.map((o) => [o.kind, (o.args as any)._type, (o.args as any)._body])).toEqual([
      ["echo", "text", "أهلاً"], ["echo", "revoke", null], ["echo", "edit", "تعديل"]]);
    expect((ops[1].args as any)._original_message_id).toBe("wamid.E1");
    expect((ops[0].args as any)._sent_at).toBe(new Date(1761730000 * 1000).toISOString());
  });

  it("history → per-thread batches with direction + progress log; decline logged", async () => {
    const { ops } = await run(wrap("history", { history: [{ metadata: { phase: 0, chunk_order: 1, progress: 55 }, threads: [{ id: CUST, messages: [
      { from: BIZ, to: CUST, id: "wamid.H1", timestamp: "1761000000", type: "text", text: { body: "قديم" }, history_context: { status: "READ" } },
      { from: CUST, id: "wamid.H2", timestamp: "1761000100", type: "media_placeholder", history_context: { status: "READ" } },
    ] }] }] }));
    const h = ops.find((o) => o.kind === "history")!.args as any;
    expect(h._wa_id).toBe(CUST);
    expect(h._messages.map((m: any) => [m.id, m.direction, m.type])).toEqual([["wamid.H1", "out", "text"], ["wamid.H2", "in", "media_placeholder"]]);
    expect(ops.find((o) => o.kind === "log")!.args).toMatchObject({ _field: "history", _phase: 0, _chunk_order: 1, _progress: 55, _error_code: null });

    const d = await run(wrap("history", { history: [{ errors: [{ code: 2593109, title: "History sync is turned off" }] }] }));
    expect(d.r.status).toBe(200);
    expect(d.ops).toEqual([expect.objectContaining({ kind: "log", args: expect.objectContaining({ _error_code: 2593109 }) })]);
  });

  it("history media follow-up (value.messages) → history op for the same id", async () => {
    const { ops } = await run(wrap("history", { messages: [{ from: CUST, id: "wamid.H2", timestamp: "1761000100", type: "image", image: { id: "MEDIA1", mime_type: "image/jpeg" } }] }));
    expect(ops[0]).toMatchObject({ kind: "history", args: { _wa_id: CUST, _messages: [expect.objectContaining({ id: "wamid.H2", type: "image", direction: "in" })] } });
  });

  it("smb_app_state_sync → contacts op", async () => {
    const { ops } = await run(wrap("smb_app_state_sync", { state_sync: [
      { type: "contact", contact: { full_name: "عميل وهمي", first_name: "عميل", phone_number: CUST }, action: "add", metadata: { timestamp: "1761730000" } },
      { type: "contact", contact: { phone_number: "201000000001" }, action: "remove", metadata: { timestamp: "1761730001" } },
    ] }));
    expect((ops[0].args as any)._contacts.map((c: any) => [c.phone, c.full_name, c.action])).toEqual([[CUST, "عميل وهمي", "add"], ["201000000001", null, "remove"]]);
  });

  it("statuses inside messages → status ops", async () => {
    const { ops } = await run(wrap("messages", { statuses: [{ id: "wamid.E1", status: "read", timestamp: "1761730100", recipient_id: CUST }] }));
    expect(ops).toEqual([{ kind: "status", args: { _provider_message_id: "wamid.E1", _status: "read", _at: new Date(1761730100000).toISOString(), _error: null } }]);
  });

  it("unknown field → log + 200; log failure never 500; real op failure → 500", async () => {
    const u = await run(wrap("account_update", { event: "PARTNER_REMOVED" }));
    expect(u.r.status).toBe(200);
    expect(u.ops[0]).toMatchObject({ kind: "log", args: { _field: "account_update", _info: { event: "PARTNER_REMOVED" } } });
    expect((await run(wrap("account_update", {}), "log")).r.status).toBe(200);
    expect((await run(wrap("smb_app_state_sync", { state_sync: [{ type: "contact", contact: { phone_number: CUST }, action: "add" }] }), "contacts")).r.status).toBe(500);
  });

  it("extractOps ignores non-WABA objects", () => expect(extractOps({ object: "page" })).toEqual([]));
});
