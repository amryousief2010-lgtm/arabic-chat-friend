import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";

export const CHAT_MEDIA_BUCKET = "cm-chat-media";
const SIGNED_TTL = 3600;

export interface MediaMsg { type: string; media_path?: string | null; media_mime?: string | null; media_status?: string | null }

/** حالة الوسيط كنص للمستخدم عند عدم توفره. */
export const mediaStatusText = (m: MediaMsg): string | null => {
  if (m.media_path) return null;
  switch (m.media_status) {
    case "pending": return "⏳ جارٍ تحميل الوسائط…";
    case "too_large": return "الملف أكبر من 25 ميجا — افتحيه من تطبيق واتساب";
    case "expired": return "انتهت صلاحية الملف على واتساب";
    case "error": return "تعذّر تحميل الملف — ستُعاد المحاولة تلقائياً";
    default: return null;
  }
};

export const mediaKind = (m: MediaMsg): "image" | "audio" | "video" | "document" | null => {
  const mime = (m.media_mime ?? "").toLowerCase();
  if (m.type === "image" || m.type === "sticker" || mime.startsWith("image/")) return "image";
  if (m.type === "audio" || mime.startsWith("audio/")) return "audio";
  if (m.type === "video" || mime.startsWith("video/")) return "video";
  if (m.type === "document" || m.media_path) return "document";
  return null;
};

/** وسيط رسالة من bucket خاص عبر رابط موقَّع (ساعة) — RLS يمنع غير المصرَّح لهم. */
export default function MessageMedia({ m }: { m: MediaMsg }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!m.media_path) return;
    let live = true;
    supabase.storage.from(CHAT_MEDIA_BUCKET).createSignedUrl(m.media_path, SIGNED_TTL)
      .then(({ data, error }) => { if (!live) return; if (error || !data?.signedUrl) setFailed(true); else setUrl(data.signedUrl); });
    return () => { live = false; };
  }, [m.media_path]);

  const status = mediaStatusText(m);
  if (status) return <div className="text-xs opacity-80" data-testid="media-status">{status}</div>;
  if (!m.media_path) return null;
  if (failed) return <div className="text-xs opacity-80" data-testid="media-status">تعذّر عرض الملف (لا صلاحية أو غير متاح)</div>;
  if (!url) return <div className="text-xs opacity-70">جارٍ التحميل…</div>;
  const kind = mediaKind(m);
  if (kind === "image") return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="block" aria-label="تكبير الصورة">
        <img src={url} alt="صورة من المحادثة" loading="lazy" className="max-h-60 max-w-full rounded-md object-contain" onError={() => setFailed(true)} data-testid="media-image" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl p-2"><DialogTitle className="sr-only">صورة</DialogTitle>
          <img src={url} alt="صورة مكبرة" className="max-h-[85vh] w-full object-contain" /></DialogContent>
      </Dialog>
    </>
  );
  if (kind === "audio") return <audio controls preload="none" src={url} className="max-w-full" data-testid="media-audio" />;
  if (kind === "video") return <video controls preload="metadata" src={url} className="max-h-72 max-w-full rounded-md" data-testid="media-video" />;
  return <a href={url} target="_blank" rel="noreferrer" className="underline text-xs" data-testid="media-doc">📄 فتح الملف</a>;
}
