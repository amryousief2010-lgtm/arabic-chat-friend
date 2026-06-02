import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { fetchRemoteVersion, CURRENT_VERSION, clearAllCachesAndSW } from "@/lib/updateChecker";

const CHECK_INTERVAL_MS = 60_000; // فحص كل 60 ثانية

/** تنبيه Toast عند اكتشاف نسخة جديدة — يطلب من المستخدم عمل Refresh قوي */
const UpdateToastNotifier = () => {
  const busy = useRef(false);
  const dismissed = useRef<string | null>(null);
  const toastId = useRef<string | number | null>(null);

  useEffect(() => {
    const doCheck = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        const result = await fetchRemoteVersion();
        if (result.upToDate || !result.remote) return;
        if (dismissed.current === result.remote) return;

        // اعرض تنبيهاً دائماً
        toastId.current = toast(
          <div className="flex flex-col gap-2 text-right" dir="rtl">
            <div className="font-semibold">تم نشر تحديث جديد</div>
            <div className="text-sm opacity-80">
              الإصدار الحالي: {CURRENT_VERSION} — النسخة الجديدة: {result.remote}
            </div>
            <button
              onClick={async () => {
                await clearAllCachesAndSW();
                window.location.reload();
              }}
              className="mt-1 inline-flex items-center justify-center gap-1 rounded-lg bg-orange-500 px-3 py-1.5 text-sm font-bold text-white hover:bg-orange-600 transition-colors"
            >
              تحديث الصفحة الآن
            </button>
          </div>,
          {
            duration: Infinity,
            position: "top-center",
            id: "app-update-prompt",
          },
        );
      } finally {
        busy.current = false;
      }
    };

    // فحص أولي بعد 5 ثوانٍ
    const initial = setTimeout(doCheck, 5_000);
    // فحص دوري
    const interval = setInterval(doCheck, CHECK_INTERVAL_MS);

    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, []);

  return null;
};

export default UpdateToastNotifier;
