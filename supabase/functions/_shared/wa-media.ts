// تنزيل وسائط واتساب من Graph إلى bucket خاص cm-chat-media. بلا imports خارجية (قابل للاختبار في vitest).
// لا يطبع التوكن ولا أرقام العملاء أبداً.
export const MEDIA_BUCKET = "cm-chat-media";
export const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
export const GRAPH = "https://graph.facebook.com/v24.0";

const EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
  "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/aac": "aac", "audio/amr": "amr",
  "video/mp4": "mp4", "video/3gpp": "3gp", "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/msword": "doc", "application/vnd.ms-excel": "xls", "text/plain": "txt",
};
export const extForMime = (mime: string | null | undefined): string => {
  const base = (mime ?? "").split(";")[0].trim().toLowerCase();
  return EXT[base] ?? (base.split("/")[1]?.replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin");
};
export const mediaPath = (conversationId: string, messageId: string, mime: string | null | undefined) =>
  `${conversationId}/${messageId}.${extForMime(mime)}`;

export interface PendingMedia { id: string; conversation_id: string; media_id: string; media_mime: string | null; type: string; attempts: number }
export type MediaOutcome = { status: "done" | "error" | "too_large" | "expired"; path?: string; mime?: string; size?: number; error?: string };

// deno-lint-ignore no-explicit-any
type Db = any;
type Fetch = typeof fetch;

/** ينزّل وسيطاً واحداً ويرفعه. يرجع النتيجة دون رمي استثناء. */
export async function fetchOne(db: Db, token: string, m: PendingMedia, f: Fetch = fetch): Promise<MediaOutcome> {
  try {
    const meta = await f(`${GRAPH}/${encodeURIComponent(m.media_id)}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!meta.ok) {
      const body = await meta.text().catch(() => "");
      const code = /"code":\s*(\d+)/.exec(body)?.[1];
      // 100 = media غير موجود/منتهٍ (صلاحية media_id ~30 يوماً)
      return { status: meta.status === 404 || (meta.status === 400 && code === "100") ? "expired" : "error", error: `graph_meta_${meta.status}${code ? "_" + code : ""}` };
    }
    const info = await meta.json() as { url?: string; mime_type?: string; file_size?: number };
    const mime = info.mime_type ?? m.media_mime ?? "application/octet-stream";
    if (info.file_size && info.file_size > MAX_MEDIA_BYTES) return { status: "too_large", mime, size: info.file_size, error: "over_25mb" };
    if (!info.url) return { status: "error", error: "graph_no_url" };
    const bin = await f(info.url, { headers: { Authorization: `Bearer ${token}` } });
    if (!bin.ok) return { status: "error", error: `graph_download_${bin.status}` };
    const buf = new Uint8Array(await bin.arrayBuffer());
    if (buf.byteLength > MAX_MEDIA_BYTES) return { status: "too_large", mime, size: buf.byteLength, error: "over_25mb" };
    const path = mediaPath(m.conversation_id, m.id, mime);
    const up = await db.storage.from(MEDIA_BUCKET).upload(path, buf, { contentType: mime.split(";")[0], upsert: true });
    if (up.error) return { status: "error", error: `upload_${String(up.error.message).slice(0, 80)}` };
    return { status: "done", path, mime, size: buf.byteLength };
  } catch (e) {
    return { status: "error", error: `exception_${String((e as Error)?.message ?? e).slice(0, 80)}` };
  }
}

/** يعالج الطابور (pending/error < 5 محاولات) بتوازي محدود. */
export async function processPendingMedia(db: Db, token: string | undefined, limit = 10, f: Fetch = fetch) {
  const summary = { picked: 0, done: 0, error: 0, too_large: 0, expired: 0, skipped: "" as string };
  if (!token) { summary.skipped = "no_token"; return summary; }
  const { data, error } = await db.rpc("cm_media_pending", { _limit: limit });
  if (error) { summary.skipped = "rpc_error"; return summary; }
  const items = (data ?? []) as PendingMedia[];
  summary.picked = items.length;
  const queue = [...items];
  const worker = async () => {
    for (let m = queue.shift(); m; m = queue.shift()) {
      const r = await fetchOne(db, token, m, f);
      summary[r.status]++;
      await db.rpc("cm_set_media_result", { _message_id: m.id, _status: r.status, _path: r.path ?? null,
        _mime: r.mime ?? null, _error: r.error ?? null, _size: r.size ?? null });
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return summary;
}
