import { useEffect, useState } from "react";

const KEY = "hatchery_show_test_data";
const EVT = "hatchery_show_test_data_changed";

export function useTestMode() {
  const [showTest, setShowTest] = useState<boolean>(() => {
    try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
  });

  useEffect(() => {
    const handler = () => {
      try { setShowTest(localStorage.getItem(KEY) === "1"); } catch {}
    };
    window.addEventListener(EVT, handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener(EVT, handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  const toggle = (next?: boolean) => {
    const v = typeof next === "boolean" ? next : !showTest;
    try { localStorage.setItem(KEY, v ? "1" : "0"); } catch {}
    setShowTest(v);
    window.dispatchEvent(new Event(EVT));
  };

  return { showTest, toggle };
}
