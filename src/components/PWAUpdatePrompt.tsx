import { useEffect, useCallback, useRef, useState } from "react";
import {
  CHECK_INTERVAL_MS,
  CHECK_ON_FOCUS,
  checkAndReloadIfStale,
} from "@/lib/updateChecker";
import BootSplash from "@/components/BootSplash";

const PWAUpdatePrompt = () => {
  const busy = useRef(false);
  const resumedFromBackground = useRef(false);
  const [resumeStatus, setResumeStatus] = useState<string | null>(null);

  const run = useCallback(
    async (
      reason: Parameters<typeof checkAndReloadIfStale>[0],
      overlayMessage?: string,
    ) => {
      if (busy.current) return;
      if (overlayMessage) setResumeStatus(overlayMessage);
      busy.current = true;
      try {
        await checkAndReloadIfStale(reason);
      } finally {
        busy.current = false;
        resumedFromBackground.current = false;
        setResumeStatus(null);
      }
    },
    [],
  );

  useEffect(() => {
    const interval = setInterval(() => void run("interval"), CHECK_INTERVAL_MS);
    const markBackgrounded = () => {
      resumedFromBackground.current = true;
      setResumeStatus("جارٍ استئناف التطبيق...");
    };

    const onVisible = () => {
      if (document.visibilityState === "hidden") {
        markBackgrounded();
        return;
      }

      if (resumedFromBackground.current) {
        void run("visibility", "جارٍ التحقق من أحدث نسخة...");
      }
    };
    const onFocus = () => {
      if (resumedFromBackground.current) {
        void run("focus", "جارٍ مزامنة التطبيق...");
      }
    };
    const onPageHide = () => {
      markBackgrounded();
    };
    const onPageShow = (event: PageTransitionEvent) => {
      const navigationEntry = performance
        .getEntriesByType("navigation")
        .at(0) as PerformanceNavigationTiming | undefined;

      if (event.persisted || navigationEntry?.type === "back_forward") {
        resumedFromBackground.current = true;
        void run("pageshow", "جارٍ تحديث بيانات الجلسة...");
      }
    };

    if (CHECK_ON_FOCUS) {
      document.addEventListener("visibilitychange", onVisible);
      window.addEventListener("focus", onFocus);
      window.addEventListener("pagehide", onPageHide);
      window.addEventListener("pageshow", onPageShow);
    }
    return () => {
      clearInterval(interval);
      if (CHECK_ON_FOCUS) {
        document.removeEventListener("visibilitychange", onVisible);
        window.removeEventListener("focus", onFocus);
        window.removeEventListener("pagehide", onPageHide);
        window.removeEventListener("pageshow", onPageShow);
      }
    };
  }, [run]);

  return resumeStatus ? <BootSplash status={resumeStatus} /> : null;
};

export default PWAUpdatePrompt;
