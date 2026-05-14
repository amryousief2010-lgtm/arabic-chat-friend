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

    if (CHECK_ON_FOCUS) {
      document.addEventListener("visibilitychange", onVisible);
      window.addEventListener("focus", onFocus);
    }
    return () => {
      clearInterval(interval);
      if (CHECK_ON_FOCUS) {
        document.removeEventListener("visibilitychange", onVisible);
        window.removeEventListener("focus", onFocus);
      }
    };
  }, [run]);

  return null;
};

export default PWAUpdatePrompt;
