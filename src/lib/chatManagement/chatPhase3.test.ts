import { describe, it, expect, vi } from "vitest";
import { extForMime, mediaPath, fetchOne, MAX_MEDIA_BYTES } from "../../../supabase/functions/_shared/wa-media";
import { redact, buildChatTranscript, fixOutcome, normalizeChatAnalysis, chatHash } from "../../../supabase/functions/_shared/chat-analysis";
import { adSourceLabel, filterConversations, type InboxConversation } from "./inbox";
import { mediaKind, mediaStatusText } from "@/components/chatManagement/MessageMedia";
import { chatLabel, CHAT_CATEGORY_LABELS, fmtMin } from "./chatAnalysisLabels";

const res = (status: number, body: unknown, bin?: Uint8Array) => ({
  ok: status < 300, status, text: async () => JSON.stringify(body), json: async () => body,
  arrayBuffer: async () => (bin ?? new Uint8Array(0)).buffer,
}) as unknown as Response;
const pm = { id: "m1", conversation_id: "c1", media_id: "X", media_mime: "image/jpeg", type: "image", attempts: 0 };
const mkDb = (err: unknown = null) => { const upload = vi.fn(async () => ({ error: err })); return { db: { storage: { from: () => ({ upload }) } }, upload }; };

describe("wa-media", () => {
  it("ext + path", () => {
    expect(extForMime("image/jpeg")).toBe("jpg");
    expect(extForMime("audio/ogg; codecs=opus")).toBe("ogg");
    expect(mediaPath("c1", "m1", "application/pdf")).toBe("c1/m1.pdf");
  });
  it("done", async () => {
    const { db, upload } = mkDb();
    const f = vi.fn().mockResolvedValueOnce(res(200, { url: "https://x/u", mime_type: "image/jpeg", file_size: 3 }))
      .mockResolvedValueOnce(res(200, {}, new Uint8Array([1, 2, 3])));
    const o = await fetchOne(db, "T", pm, f as any);
    expect(o).toMatchObject({ status: "done", path: "c1/m1.jpg", size: 3 });
    expect(upload).toHaveBeenCalledOnce();
  });
  it("too_large without download", async () => {
    const f = vi.fn().mockResolvedValueOnce(res(200, { url: "u", mime_type: "video/mp4", file_size: MAX_MEDIA_BYTES + 1 }));
    expect((await fetchOne(mkDb().db, "T", pm, f as any)).status).toBe("too_large");
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("expired / error", async () => {
    expect((await fetchOne(mkDb().db, "T", pm, vi.fn().mockResolvedValue(res(400, { error: { code: 100 } })) as any)).status).toBe("expired");
    expect((await fetchOne(mkDb().db, "T", pm, vi.fn().mockResolvedValue(res(500, {})) as any)).status).toBe("error");
    expect((await fetchOne(mkDb().db, "T", pm, vi.fn().mockRejectedValue(new Error("net")) as any)).status).toBe("error");
  });
});

describe("chat-analysis", () => {
  it("redacts numbers, emails, links", () => {
    const r = redact("رقمي 01012345678 و ٠١٠١٢٣٤٥٦٧٨ a@b.com https://x.y/z");
    expect(r).not.toMatch(/\d{6}|[٠-٩]{6}|@|https/);
  });
  it("transcript roles + counts", () => {
    const t = buildChatTranscript([
      { direction: "out", type: "text", body: "أهلاً", sent_at: "2026-10-29T10:01:00Z" },
      { direction: "in", type: "image", body: null, sent_at: "2026-10-29T10:00:00Z" },
    ]);
    expect(t).toContain("عدد رسائل العميل: 1، عدد رسائل المودريتور: 1");
    expect(t.indexOf("العميل: [صورة]")).toBeLessThan(t.indexOf("المودريتور: أهلاً"));
  });
  it("fixOutcome + normalize", () => {
    expect(fixOutcome("order_placed", 0)).toBe("no_reply");
    expect(fixOutcome("no_reply", 3)).toBe("inquiry_only");
    const n = normalizeChatAnalysis({ category: "bad", outcome: "no_reply", quality_score: 9, summary_ar: "اتصل 01012345678" }, 2);
    expect(n).toMatchObject({ category: "other", outcome: "inquiry_only", quality_score: null });
    expect(n.summary_ar).toContain("[رقم]");
    expect(chatHash([])).toBe("0:811c9dc5");
  });
});

describe("ad source UI", () => {
  const base = { id: "a", status: "open", line_id: "l" } as unknown as InboxConversation;
  const ad = { ...base, id: "b", ad_id: "120212345520532", ad_headline: "عرض النعام", campaign_id: "k1" } as InboxConversation;
  it("label", () => {
    expect(adSourceLabel(base)).toBeNull();
    expect(adSourceLabel(ad, "حملة X")).toBe("حملة X");
    expect(adSourceLabel(ad)).toBe("عرض النعام · …520532");
  });
  it("source filter", () => {
    const now = new Date();
    expect(filterConversations([base, ad], { source: "ads" }, now).map((c) => c.id)).toEqual(["b"]);
    expect(filterConversations([base, ad], { source: "organic" }, now).map((c) => c.id)).toEqual(["a"]);
    expect(filterConversations([base, ad], { source: "k1" }, now).map((c) => c.id)).toEqual(["b"]);
  });
  it("media helpers + labels", () => {
    expect(mediaKind({ type: "audio" })).toBe("audio");
    expect(mediaKind({ type: "document", media_mime: "image/png" })).toBe("image");
    expect(mediaStatusText({ type: "image", media_status: "too_large" })).toMatch(/25/);
    expect(mediaStatusText({ type: "image", media_path: "x", media_status: "done" })).toBeNull();
    expect(chatLabel(CHAT_CATEGORY_LABELS, "price_inquiry")).toBe("استفسار سعر");
    expect(fmtMin(null)).toBe("—");
  });
});
