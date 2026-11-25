/** ضغط صورة في المتصفح إلى WebP (أقصى بُعد 1200 بكسل، أقل من 2 ميجابايت) قبل الرفع. */
import { MAX_IMAGE_BYTES } from "@/lib/websiteProducts";

export async function compressImage(file: File, maxDim = 1200): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("image_decode_failed"));
      el.src = url;
    });
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas_unavailable");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    for (const q of [0.85, 0.75, 0.6, 0.45]) {
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", q));
      if (blob && blob.size <= MAX_IMAGE_BYTES) return blob;
    }
    throw new Error("image_too_large");
  } finally {
    URL.revokeObjectURL(url);
  }
}
