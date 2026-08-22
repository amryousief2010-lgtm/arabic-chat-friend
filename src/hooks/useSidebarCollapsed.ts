import { useCallback, useEffect, useState } from "react";

export const SIDEBAR_COLLAPSED_KEY = "app.sidebar.collapsed";
const SIDEBAR_EVENT = "app-sidebar-collapsed-change";

export const readSidebarCollapsed = (): boolean => {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
};

/**
 * Sidebar open/closed state persisted in LocalStorage so it survives refreshes
 * and navigation between pages. All mounted consumers stay in sync.
 */
export function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState<boolean>(readSidebarCollapsed);

  useEffect(() => {
    const sync = () => setCollapsed(readSidebarCollapsed());
    window.addEventListener(SIDEBAR_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(SIDEBAR_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const setValue = useCallback((next: boolean) => {
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
    } catch {
      /* storage unavailable — keep in-memory state only */
    }
    setCollapsed(next);
    window.dispatchEvent(new Event(SIDEBAR_EVENT));
  }, []);

  const toggle = useCallback(() => setValue(!readSidebarCollapsed()), [setValue]);

  return { collapsed, setCollapsed: setValue, toggle };
}
