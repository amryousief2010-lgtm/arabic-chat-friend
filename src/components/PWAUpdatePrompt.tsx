import { useEffect, useCallback, useRef } from "react";
import {
  CHECK_INTERVAL_MS,
  CHECK_ON_FOCUS,
  checkAndReloadIfStale,
} from "@/lib/updateChecker";

const PWAUpdatePrompt = () => {
  const busy = useRef(false);

  const run = useCallback(
    async (reason: Parameters<typeof checkAndReloadIfStale>[0]) => {
      if (busy.current) return;
      busy.current = true;
      try {
        await checkAndReloadIfStale(reason);
      } finally {
        busy.current = false;
      }
    },
    [],
  );

  useEffect(() => {
    const interval = setInterval(() => void run("interval"), CHECK_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void run("visibility");
    };
    const onFocus = () => void run("focus");
    const onPageShow = (event: PageTransitionEvent) => {
      const navigationEntry = performance
        .getEntriesByType("navigation")
        .at(0) as PerformanceNavigationTiming | undefined;

      if (event.persisted || navigationEntry?.type === "back_forward") {
        void run("pageshow");
      }
    };

    if (CHECK_ON_FOCUS) {
      document.addEventListener("visibilitychange", onVisible);
      window.addEventListener("focus", onFocus);
      window.addEventListener("pageshow", onPageShow);
    }
    return () => {
      clearInterval(interval);
      if (CHECK_ON_FOCUS) {
        document.removeEventListener("visibilitychange", onVisible);
        window.removeEventListener("focus", onFocus);
        window.removeEventListener("pageshow", onPageShow);
      }
    };
  }, [run]);

  return null;
};

export default PWAUpdatePrompt;
