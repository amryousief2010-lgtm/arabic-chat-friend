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
