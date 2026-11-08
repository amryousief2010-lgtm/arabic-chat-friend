import { currentCairoYearMonth } from "@/lib/cairoDate";

export const PHONE_REVIEW_PAGE_SIZE = 25;

export const PHONE_REVIEW_ISSUES = ["malformed", "two_numbers", "multi_customer"] as const;
export type PhoneReviewIssue = (typeof PHONE_REVIEW_ISSUES)[number];
export type PhoneField = "phone" | "phone2";

export const ISSUE_LABELS: Record<PhoneReviewIssue, string> = {
  malformed: "رقم غير صحيح",
  two_numbers: "رقمان في حقل واحد",
  multi_customer: "نفس الرقم لأكثر من عميل",
};

export const PHONE_FIELD_LABELS: Record<PhoneField, string> = {
  phone: "رقم الهاتف",
  phone2: "الرقم الإضافي",
};

export const ORDER_STATUS_LABELS: Record<string, string> = {
  pending: "قيد الانتظار",
  processing: "جاري التجهيز",
  shipped: "تم الشحن",
  delivered: "تم التوصيل",
  cancelled: "ملغي",
  canceled: "ملغي",
};

const MONTH_NAMES = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];

/** First day of the current Cairo month, YYYY-MM-01. Matches report month buckets. */
export function currentReviewMonth(now: Date = new Date()): string {
  const { year, monthIndex0 } = currentCairoYearMonth(now);
  return `${year}-${String(monthIndex0 + 1).padStart(2, "0")}-01`;
}

export function reviewMonthOptions(now: Date = new Date(), monthsBack = 18): { value: string; label: string }[] {
  const { year, monthIndex0 } = currentCairoYearMonth(now);
  const options: { value: string; label: string }[] = [{ value: "all", label: "كل الشهور" }];
  for (let i = 0; i < monthsBack; i++) {
    const date = new Date(Date.UTC(year, monthIndex0 - i, 1));
    const y = date.getUTCFullYear();
    const m = date.getUTCMonth();
    options.push({
      value: `${y}-${String(m + 1).padStart(2, "0")}-01`,
      label: `${MONTH_NAMES[m]} ${y}`,
    });
  }
  return options;
}

export function reviewLoadState(loading: boolean, error: boolean, count: number): "loading" | "error" | "empty" | "ready" {
  if (loading) return "loading";
  if (error) return "error";
  if (count === 0) return "empty";
  return "ready";
}

export function pageCount(total: number, pageSize: number): number {
  if (total <= 0) return 1;
  return Math.ceil(total / pageSize);
}

export function pageRangeLabel(page: number, pageSize: number, total: number): string {
  if (total <= 0) return "لا توجد حالات مطابقة";
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return `عرض ${from}–${to} من ${total}`;
}

/** Non-empty trimmed parts. Dropping a number is fewer kept parts than the original field had. */
export function keptPhoneParts(parts: readonly string[]): string[] {
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

export function needsDropConfirmation(originalPartCount: number, nextParts: readonly string[]): boolean {
  return originalPartCount > 1 && keptPhoneParts(nextParts).length < originalPartCount;
}

export function composePhoneValue(parts: readonly string[]): string {
  return keptPhoneParts(parts).join(" / ");
}

/** Split a stored field on the separators the review queue already treats as two numbers. */
export function visiblePhoneParts(raw: string | null | undefined): string[] {
  const text = (raw ?? "").trim();
  if (!text) return [""];
  const parts = text.split(/\s*[/,;|،]\s*|\s+و\s+/).map((part) => part.trim()).filter(Boolean);
  return parts.length > 0 ? parts : [text];
}

const SAVE_ERRORS: Record<string, string> = {
  CM_NOT_ALLOWED: "ليست لديك صلاحية تصحيح أرقام العملاء",
  CM_PHONE_INVALID: "كل رقم يجب أن يكون موبايلًا مصريًا صحيحًا",
  CM_PHONE_DROP_CONFIRM: "تأكيد مطلوب قبل حذف رقم من الحقل",
  CM_PHONE_EMPTY: "اكتب الرقم الصحيح قبل الحفظ",
  CM_PHONE_FIELD: "تعذّر تحديد الحقل المراد تصحيحه",
  CM_PHONE_CUSTOMER: "العميل غير موجود",
};

/** Arabic message only. Never returns the database text, which can contain the number. */
export function phoneSaveErrorMessage(code: string | null | undefined): string {
  if (code && SAVE_ERRORS[code]) return SAVE_ERRORS[code];
  return "تعذّر حفظ الرقم";
}

export function phoneSaveErrorCode(message: string | null | undefined): string | null {
  if (!message) return null;
  const known = Object.keys(SAVE_ERRORS).find((code) => message.includes(code));
  return known ?? null;
}
