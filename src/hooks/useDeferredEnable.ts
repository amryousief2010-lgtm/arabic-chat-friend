import { useEffect, useState } from "react";

/**
 * Keep a React Query / effect gate off until the browser is idle (or
 * `deferMs` elapses). Used so shell chrome (treasury approvals, mega
 * discrepancies, …) does not compete with the page's first paint.
 */
export function useDeferredEnable(enabled: boolean, deferMs = 2000): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setReady(false);
      return;
    }
    let cancelled = false;
    const go = () => {
      if (!cancelled) setReady(true);
    };
    const ric = (window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    }).requestIdleCallback;
    if (typeof ric === "function") {
      const id = ric(go, { timeout: deferMs });
      return () => {
        cancelled = true;
        window.cancelIdleCallback?.(id);
      };
    }
    const t = window.setTimeout(go, deferMs);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [enabled, deferMs]);

  return enabled && ready;
}
