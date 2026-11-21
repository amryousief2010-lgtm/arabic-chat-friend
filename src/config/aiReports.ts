import type { AppRole } from "@/hooks/useAuth";

/** صفحة «التقارير والتنبيهات الذكية» (قرار م. عمرو 21-11-2026): المدير العام ومدير المبيعات بس. */
export const AI_REPORTS_PATH = "/ai-reports";
export const AI_REPORTS_ROLES: AppRole[] = ["general_manager", "sales_manager"];
export const canViewAiReports = (roles: readonly string[] | null | undefined) =>
  !!roles?.some((r) => (AI_REPORTS_ROLES as string[]).includes(r));
/** تعديل الحدود وتشغيل/إيقاف القواعد والموافقة على الطلبات: المدير العام بس (يطابق cm_ai_is_gm في القاعدة). */
export const canManageAiRules = (roles: readonly string[] | null | undefined) => !!roles?.includes("general_manager");
/** عدد التنبيهات في الجرس بيتحدث كل دقيقة (طلب خفيف بدل الاتصال اللحظي). */
export const AI_ALERTS_POLL_MS = 60_000;

export const BRAND = { magenta: "#A4288A", purple: "#662D8C", orange: "#F37346" } as const;
