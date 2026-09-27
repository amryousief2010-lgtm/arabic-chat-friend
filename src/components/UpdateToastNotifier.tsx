import { useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  CURRENT_VERSION,
  reloadToLatest,
  subscribeToUpdateAvailable,
} from "@/lib/updateChecker";

/** تنبيه Toast عند اكتشاف نسخة جديدة لا يمكن تحميلها تلقائياً. */
const UpdateToastNotifier = () => {
  const dismissed = useRef<string | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeToUpdateAvailable((info) => {
      if (dismissed.current === info.remoteVersion) return;
      toast(
        <div className="flex flex-col gap-2 text-right" dir="rtl">
          <div className="font-semibold">تم نشر تحديث جديد</div>
          <div className="text-sm opacity-80">
            الإصدار الحالي: {CURRENT_VERSION} — النسخة الجديدة: {info.remoteVersion}
          </div>
          <button
            onClick={() => {
              void reloadToLatest();
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
    });
    return () => {
      unsubscribe();
    };
  }, []);

  return null;
};

export default UpdateToastNotifier;
