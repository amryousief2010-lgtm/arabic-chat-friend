import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface PayrollClosure {
  id: string;
  year: number;
  month: number;
  approved_at: string;
  approved_by_name: string | null;
}

/**
 * كل اعتمادات القبض (تثبيت الشهور).
 * بعد اعتماد شهر، أي أوردر يتحوّل إلى "تم التوصيل" بعد لحظة الاعتماد
 * لا يدخل في أي نتيجة من نتائج ذلك الشهر (كروت/بيان/قبض/كميات).
 */
export const usePayrollClosures = () =>
  useQuery({
    queryKey: ['payroll-month-closures'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payroll_month_closures')
        .select('*')
        .order('year')
        .order('month');
      if (error) return [] as PayrollClosure[];
      return (data || []) as PayrollClosure[];
    },
  });

/**
 * تاريخ اعتماد الشهر المحدد (1-based month) أو null لو الشهر غير معتمد.
 */
export const usePayrollClosureCutoff = (year: number, month: number) => {
  const { data: closures = [], isLoading } = usePayrollClosures();
  const closure = closures.find((c) => c.year === year && c.month === month) || null;
  return { cutoff: closure?.approved_at ?? null, closure, isLoading };
};

/**
 * هل يُحتسب هذا الأوردر ضمن نتائج الشهر المعتمد؟
 * الأوردرات التي تم توصيلها بعد لحظة الاعتماد تُستبعد تماماً.
 */
export const isDeliveredWithinClosure = (
  status: string | null,
  deliveredAt: string | null | undefined,
  cutoff: string | null,
) => {
  if (status !== 'delivered') return false;
  if (!cutoff) return true;
  if (!deliveredAt) return true; // أوردرات قديمة بدون تاريخ توصيل تُعتبر ضمن الشهر
  return new Date(deliveredAt).getTime() <= new Date(cutoff).getTime();
};

/** فلتر Supabase لاستبعاد الأوردرات المُسلَّمة بعد لحظة الاعتماد. */
export const applyClosureCutoff = <T>(query: T, cutoff: string | null): T => {
  if (!cutoff) return query;
  return (query as any).or(`delivered_at.is.null,delivered_at.lte.${cutoff}`) as T;
};
