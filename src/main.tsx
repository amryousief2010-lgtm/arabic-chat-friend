import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// 🔍 Vercel Env Variables Check (يمكن حذفه بعد التأكد)
console.log("🔍 [ENV CHECK] Environment Variables Status:", {
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL ? "✅ Loaded" : "❌ MISSING",
  VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ? "✅ Loaded" : "❌ MISSING",
  VITE_SUPABASE_PROJECT_ID: import.meta.env.VITE_SUPABASE_PROJECT_ID ? "✅ Loaded" : "❌ MISSING",
  MODE: import.meta.env.MODE,
  PROD: import.meta.env.PROD,
  // إظهار جزء صغير من القيمة فقط للتأكد (آمن لأن المفتاح publishable)
  URL_preview: import.meta.env.VITE_SUPABASE_URL?.substring(0, 30) + "...",
  PROJECT_ID: import.meta.env.VITE_SUPABASE_PROJECT_ID,
});

createRoot(document.getElementById("root")!).render(<App />);

const LEGACY_SW_RELOAD_KEY = "legacy-sw-cleanup-reloaded";

const cleanupLegacyServiceWorkers = async () => {
  if (!("serviceWorker" in navigator)) return;

  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    if (!registrations.length) {
      sessionStorage.removeItem(LEGACY_SW_RELOAD_KEY);
      return;
    }

    if ("caches" in window) {
      const cacheKeys = await caches.keys();
      await Promise.all(cacheKeys.map((key) => caches.delete(key)));
    }

    await Promise.all(registrations.map((registration) => registration.unregister()));

    if (
      navigator.serviceWorker.controller &&
      sessionStorage.getItem(LEGACY_SW_RELOAD_KEY) !== "1"
    ) {
      sessionStorage.setItem(LEGACY_SW_RELOAD_KEY, "1");
      window.location.reload();
    }
  } catch (error) {
    console.warn("[SW cleanup] Failed to remove legacy service workers", error);
  }
};

void cleanupLegacyServiceWorkers();
