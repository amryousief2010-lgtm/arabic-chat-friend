import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { checkAndReloadIfStale } from "@/lib/updateChecker";

/** يفحص الإصدار عند كل تغيير مسار — يضمن أن أي رابط جديد يفتح آخر نسخة */
const RouteVersionGuard = () => {
  const location = useLocation();
  const busy = useRef(false);

  useEffect(() => {
    if (busy.current) return;
    busy.current = true;
    void checkAndReloadIfStale("interval").finally(() => {
      busy.current = false;
    });
  }, [location.pathname]);

  return null;
};

export default RouteVersionGuard;
