// 🔌 تسجيل Service Worker بشكل آمن (يتجاهل الـ iframe و preview)
// + استقبال رسائل SW وإظهار toast + تسجيل في سجل التحديثات
import { toast } from "sonner";
import { CURRENT_VERSION, pushLog } from "@/lib/updateChecker";

const isInIframe = (() => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
})();

const isPreviewHost =
  typeof window !== "undefined" &&
  (window.location.hostname.includes("id-preview--") ||
    window.location.hostname.includes("lovableproject.com") ||
    window.location.hostname.includes("lovable.dev"));

export const registerServiceWorker = () => {
  if (!("serviceWorker" in navigator)) return;

  // في الـ preview/iframe: ألغِ أي SW موجود ولا تُسجِّل واحداً جديداً
  if (isPreviewHost || isInIframe) {
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((r) => r.unregister());
    });
    return;
  }

  // استمع لرسائل الـ SW
  navigator.serviceWorker.addEventListener("message", (event) => {
    const data = event.data;
    if (data?.type === "SW_ACTIVATED") {
      const newVer: string = data.version || "?";
      const cleared: string[] = data.clearedCaches || [];
      const isFirstInstall = cleared.length === 0;

      pushLog({
        at: data.at || new Date().toISOString(),
        reason: "sw-activated",
        oldVersion: cleared[0] || CURRENT_VERSION,
        newVersion: newVer,
      });

      if (!isFirstInstall) {
        toast.success("تم تفعيل نسخة جديدة من التطبيق", {
          description: `تم مسح الكاش القديم (${cleared.length}) — الإصدار: ${newVer}`,
          duration: 6000,
        });
      } else {
        toast("تم تفعيل التخزين المؤقت الذكي", {
          description: "ستتحمّل الأصول الثابتة أسرع في الزيارات القادمة",
          duration: 4000,
        });
      }
    }
  });

  // سجّل بعد تحميل الصفحة لتجنّب تأخير الإقلاع
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .catch((err) => {
        console.warn("[sw] registration failed:", err);
      });
  });
};
