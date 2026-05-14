import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

const CURRENT_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";
const BOOT_RELOAD_KEY = "boot-version-reloaded";

const clearAllCachesAndSW = async () => {
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch {
    // ignore
  }
};

// 🚦 افحص الإصدار قبل عرض التطبيق — إن كان قديماً امسح الكاش وأعد التحميل فوراً
const checkVersionBeforeBoot = async (): Promise<boolean> => {
  // حماية من حلقة إعادة التحميل
  if (sessionStorage.getItem(BOOT_RELOAD_KEY) === "1") {
    sessionStorage.removeItem(BOOT_RELOAD_KEY);
    return false;
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(`/version.json?t=${Date.now()}`, {
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return false;
    const data = (await res.json()) as { version?: string };
    const remote = data?.version;
    if (!remote || remote === CURRENT_VERSION) return false;

    await clearAllCachesAndSW();
    sessionStorage.setItem(BOOT_RELOAD_KEY, "1");
    window.location.reload();
    return true; // سيتم التحميل من جديد
  } catch {
    return false;
  }
};

(async () => {
  const willReload = await checkVersionBeforeBoot();
  if (willReload) return;

  // تنظيف أي Service Worker قديم (احتياط)
  void clearAllCachesAndSW();

  createRoot(document.getElementById("root")!).render(<App />);
})();
