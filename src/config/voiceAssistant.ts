import type { AppRole } from "@/hooks/useAuth";

/**
 * المساعد الصوتي للمديرين (نموذج أولي — موافقة م. عمرو «نفذ» 28-11-2026).
 * لازم تطابق VOICE_ALLOWED_ROLES في supabase/functions/ai-assistant-chat/voice.ts.
 * التلات أدوار بيشوفوا الأدوات الـ8 كلها بما فيها الخزنة؛ المدير المالي مالوش وصول (قرار م. عمرو 28-11-2026).
 */
export const VOICE_ASSISTANT_ROLES: AppRole[] = ["general_manager", "executive_manager", "sales_manager"];
export const canUseVoiceAssistant = (roles: readonly string[] | null | undefined) =>
  !!roles?.some((r) => (VOICE_ASSISTANT_ROLES as string[]).includes(r));

/** أقصى مدة تسجيل (ثانية) قبل الإيقاف التلقائي. */
export const VOICE_MAX_SECONDS = 45;

export const VOICE_SUGGESTIONS = [
  "مبيعات امبارح كانت كام؟",
  "الإعلانات الشهر ده مقابل سقف 6%؟",
  "مين أحسن مودريتور الأسبوع اللي فات؟",
  "فيه طلبات معلّقة أكتر من 72 ساعة؟",
  "إيه الأصناف اللي رصيدها صفر؟",
] as const;

export function pickRecorderMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) {
    if (MediaRecorder.isTypeSupported?.(m)) return m;
  }
  return "";
}
