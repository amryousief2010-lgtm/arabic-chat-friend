import { useEffect, useCallback, useRef } from "react";
import {
  CHECK_INTERVAL_MS,
  CHECK_ON_FOCUS,
  checkAndReloadIfStale,
} from "@/lib/updateChecker";

const PWAUpdatePrompt = () => {
  const busy = useRef(false);
  const resumedFromBackground = useRef(false);

  const run = useCallback(
    async (reason: Parameters<typeof checkAndReloadIfStale>[0]) => {
      if (busy.current) return;
      busy.current = true;
      try {
        await checkAndReloadIfStale(reason);
      } finally {
        busy.current = false;
        resumedFromBackground.current = false;
      }
    },
    [],
  );

  useEffect(() => {
    const interval = setInterval(() => void run("interval"), CHECK_INTERVAL_MS);
    const markBackgrounded = () => {
      resumedFromBackground.current = true;
    };

    const onVisible = () => {
      if (document.visibilityState === "hidden") {
        markBackgrounded();
        return;
      }

      if (resumedFromBackground.current) {
        void run("visibility");
      }
    };
    const onFocus = () => {
      if (resumedFromBackground.current) {
        void run("focus");
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
        void run("pageshow");
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

  return null;
};

export default PWAUpdatePrompt;
