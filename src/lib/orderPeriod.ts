// فلتر "الفترة الزمنية" لصفحة الأوردرات — يعتمد على تاريخ تسجيل الأوردر (created_at)
// بتوقيت القاهرة.
import { cairoMonthStartUTC, cairoTodayStartUTC, currentCairoYearMonth, toCairoDateString } from "@/lib/cairoDate";

export type PeriodPreset =
  | "none"
  | "today"
  | "last7"
  | "this_month"
  | "last_month"
  | "last2m"
  | "last3m"
  | "custom";

export const PERIOD_OPTIONS: { value: PeriodPreset; label: string }[] = [
  { value: "none", label: "بدون فترة" },
  { value: "today", label: "اليوم" },
  { value: "last7", label: "آخر 7 أيام" },
  { value: "this_month", label: "الشهر الحالي" },
  { value: "last_month", label: "الشهر السابق" },
  { value: "last2m", label: "آخر شهرين" },
  { value: "last3m", label: "آخر 3 أشهر" },
  { value: "custom", label: "فترة مخصصة" },
];

const ymd = (d: Date) => toCairoDateString(d);
const addMonths = (year: number, m0: number, delta: number) => {
  const total = year * 12 + m0 + delta;
  return { year: Math.floor(total / 12), monthIndex0: ((total % 12) + 12) % 12 };
};

/**
 * إرجاع حدود الفترة كنصوص YYYY-MM-DD بتوقيت القاهرة (شاملة الطرفين)،
 * أو null إذا لم تُختر فترة.
 */
export function resolvePeriod(
  preset: PeriodPreset,
  customFrom?: string,
  customTo?: string,
  now: Date = new Date(),
): { fromYMD: string; toYMD: string } | null {
  const todayYMD = ymd(now);
  const { year, monthIndex0 } = currentCairoYearMonth(now);
  switch (preset) {
    case "today":
      return { fromYMD: todayYMD, toYMD: todayYMD };
    case "last7": {
      const start = new Date(cairoTodayStartUTC(now).getTime() - 6 * 24 * 60 * 60 * 1000);
      return { fromYMD: ymd(start), toYMD: todayYMD };
    }
    case "this_month":
      return { fromYMD: ymd(cairoMonthStartUTC(year, monthIndex0)), toYMD: todayYMD };
    case "last_month": {
      const prev = addMonths(year, monthIndex0, -1);
      const start = cairoMonthStartUTC(prev.year, prev.monthIndex0);
      const end = new Date(cairoMonthStartUTC(year, monthIndex0).getTime() - 12 * 60 * 60 * 1000);
      return { fromYMD: ymd(start), toYMD: ymd(end) };
    }
    case "last2m": {
      const prev = addMonths(year, monthIndex0, -1);
      return { fromYMD: ymd(cairoMonthStartUTC(prev.year, prev.monthIndex0)), toYMD: todayYMD };
    }
    case "last3m": {
      const prev = addMonths(year, monthIndex0, -2);
      return { fromYMD: ymd(cairoMonthStartUTC(prev.year, prev.monthIndex0)), toYMD: todayYMD };
    }
    case "custom": {
      if (!customFrom && !customTo) return null;
      const from = customFrom || customTo!;
      const to = customTo || customFrom!;
      return from <= to ? { fromYMD: from, toYMD: to } : { fromYMD: to, toYMD: from };
    }
    default:
      return null;
  }
}

/** تنسيق عربي مختصر لعرض الفترة: من 01/07/2026 إلى 10/08/2026 */
export function formatPeriodLabel(range: { fromYMD: string; toYMD: string }): string {
  const f = (s: string) => s.split("-").reverse().join("/");
  return `من ${f(range.fromYMD)} إلى ${f(range.toYMD)}`;
}
