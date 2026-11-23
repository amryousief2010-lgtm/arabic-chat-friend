import { canListenRecordings, canUploadRecordings } from "@/config/chatManagement";

/** فشل القائمة ليس «لا توجد مكالمات». */
export const CALLS_LIST_ERROR_AR = "تعذّر تحميل المكالمات — حاول مرة أخرى";
export const CALLS_LIST_EMPTY_AR = "لا توجد مكالمات مطابقة";

export type SectionStatus = "idle" | "loading" | "ready" | "error";

const NETWORK_RE = /failed to fetch|networkerror|network request failed|load failed|econnreset|enotfound|fetch failed|the internet connection appears to be offline|network connection was lost/i;
const TIMEOUT_RE = /57014|statement timeout|canceling statement/i;

/** إعادة واحدة فقط: انتهاء مهلة Postgres (57014) أو خطأ شبكة. أخطاء الصلاحية لا تُعاد. */
export const isListRetryableError = (error: unknown): boolean => {
  if (error == null || error === false) return false;
  if (typeof error === "string") return TIMEOUT_RE.test(error) || NETWORK_RE.test(error);
  if (typeof error !== "object") return false;
  if (error instanceof TypeError) return true;
  const e = error as { code?: string; message?: string; name?: string; cause?: unknown };
  if (e.name === "TypeError") return true;
  const blob = `${e.code ?? ""} ${e.name ?? ""} ${e.message ?? ""}`;
  if (TIMEOUT_RE.test(blob) || NETWORK_RE.test(blob)) return true;
  if (e.cause != null && e.cause !== error) return isListRetryableError(e.cause);
  return false;
};

/**
 * يعيد طلب القائمة مرة واحدة إذا انتهت المهلة أو انقطع الشبكة.
 * المحاولة الثانية تُرجَع كما هي — نجاحاً أو فشلاً — بلا محاولة ثالثة.
 */
export async function withOneListRetry<T extends { error?: unknown }>(run: () => Promise<T>): Promise<T> {
  let first: T;
  try {
    first = await run();
  } catch (error) {
    if (!isListRetryableError(error)) throw error;
    return await run();
  }
  if (first?.error && isListRetryableError(first.error)) return await run();
  return first;
}

export interface SecondaryPlan {
  summary: true;
  missed: true;
  /** cm_calls — أرقام كاملة لمطابقة التسجيلات. لمن يرفع فقط. */
  matchable: boolean;
  /** cm_call_analysis_list */
  analysis: boolean;
  /** cm_kpi_call_objections */
  objections: boolean;
}

/**
 * ما يُطلب بعد ظهور الجدول.
 * المؤشرات والمتابعات لكل من يرى الصفحة.
 * cm_calls والتحليل والاعتراضات استعلامات ثقيلة: التحليل لمن يستمع (والمدير العام منهم)،
 * وفهرس المطابقة لمن يرفع التسجيلات. لا تُطلب لبقية الأدوار حتى لا تزاحم القائمة.
 */
export const secondaryPlan = (roles: readonly string[] | null | undefined): SecondaryPlan => {
  const listen = canListenRecordings(roles);
  return {
    summary: true,
    missed: true,
    matchable: canUploadRecordings(roles),
    analysis: listen,
    objections: listen,
  };
};
