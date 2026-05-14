import { createRoot } from "react-dom/client";
import { createElement } from "react";
import App from "./App.tsx";
import BootSplash from "./components/BootSplash.tsx";
import { checkAndReloadIfStale, CURRENT_VERSION } from "./lib/updateChecker.ts";
import "./index.css";

const rootEl = document.getElementById("root")!;
const root = createRoot(rootEl);

// 1) اعرض شاشة إقلاع صغيرة مع رسالة الفحص
root.render(createElement(BootSplash, { status: "جارٍ التحقق من التحديثات..." }));

(async () => {
  console.info(`[update] boot version: ${CURRENT_VERSION}`);
  const willReload = await checkAndReloadIfStale("boot");
  if (willReload) {
    root.render(
      createElement(BootSplash, { status: "تم العثور على تحديث — جارٍ إعادة التحميل..." }),
    );
    return; // window.location.reload() سيتولى الباقي
  }

  // 2) عرض التطبيق
  root.render(createElement(App));
})();
