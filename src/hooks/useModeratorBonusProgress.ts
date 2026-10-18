import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useKgPrices } from '@/hooks/useKgPrices';
import { usePayrollClosures } from '@/hooks/usePayrollClosure';
import { useModeratorCategoryQty } from '@/hooks/useModeratorCategoryQty';
import { useProcessedKgSchedules } from '@/hooks/useProcessedKgSchedules';
import { moderatorKeysForMonth, displayModeratorName, DEFAULT_BASE_SALARY, payrollDefaultForMonth } from '@/constants/moderators';
import { fetchPayrollCarried } from '@/lib/fetchPayrollCarried';
import { allocateProcessedCarry, buildPayrollBaseRows, type PayrollOverride } from '@/lib/moderatorPayrollMath';
import { scheduleForMonth, APPROVED_OCT_2026_SCHEDULE } from '@/lib/processedKgBonus';

const TIER_LABELS = ['الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع'];

export const useModeratorBonusProgress = (year: number, month: number) => {
  const girls = useMemo(() => moderatorKeysForMonth(year, month), [year, month]);
  const qtyQuery = useModeratorCategoryQty(year, month, girls);
  const { schedules } = useProcessedKgSchedules();
  const { prices } = useKgPrices({ year, month });
  const { data: closures = [], isSuccess: closuresLoaded } = usePayrollClosures();

  const { data: tierSettings = [] } = useQuery({
    queryKey: ['target_bonus_settings'],
    queryFn: async () => {
      const { data, error } = await supabase.from('target_bonus_settings').select('*').order('tier');
      if (error) throw error;
      return data as Array<{ category: string; tier: number; sales_amount: number; bonus_amount: number }>;
    },
  });

  const { data: overrides = [] } = useQuery({
    queryKey: ['payroll-overrides', month, year],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payroll_bonus_overrides')
        .select('*')
        .eq('month', month)
        .eq('year', year);
      if (error) throw error;
      return data as PayrollOverride[];
    },
  });

  const closureKey = closures.map((closure) => `${closure.year}-${closure.month}-${closure.approved_at}`).join('|');
  const { data: carried = [] } = useQuery({
    queryKey: ['payroll-carried-orders', month, year, closureKey, girls.join('|')],
    enabled: closures.length > 0,
    queryFn: () => fetchPayrollCarried(year, month, girls, closures),
  });

  const schedule = scheduleForMonth(schedules, year, month);
  const selectedClosure = closures.find((closure) => closure.year === year && closure.month === month) || null;
  const baseDefault = useMemo(() => {
    const row = tierSettings.find((item) => item.category === 'أساسي' && item.tier === 1);
    const current = row ? Number(row.bonus_amount) : DEFAULT_BASE_SALARY;
    return payrollDefaultForMonth(closuresLoaded, !!selectedClosure, current, DEFAULT_BASE_SALARY);
  }, [tierSettings, closuresLoaded, selectedClosure]);
  const bonePerKg = useMemo(() => {
    const row = tierSettings.find((item) => item.category === 'لحوم بالعظم/كجم' && item.tier === 1);
    const current = row ? Number(row.bonus_amount) : 3.5;
    return payrollDefaultForMonth(closuresLoaded, !!selectedClosure, current, 3.5);
  }, [tierSettings, closuresLoaded, selectedClosure]);

  const meatTiers = useMemo(() => {
    const rows = tierSettings.filter((item) => item.category === 'لحوم').sort((a, b) => a.tier - b.tier);
    if (rows.length === 0) {
      return [
        { sales: 100000, bonus: 5, label: 'الأول' },
        { sales: 125000, bonus: 5, label: 'الثاني' },
        { sales: 200000, bonus: 5, label: 'الثالث' },
      ];
    }
    return rows.map((row) => ({
      sales: Number(row.sales_amount),
      bonus: Number(row.bonus_amount),
      label: TIER_LABELS[row.tier - 1] || String(row.tier),
    }));
  }, [tierSettings]);

  const processedTiers = useMemo(() => {
    const rows = tierSettings.filter((item) => item.category === 'مصنعات').sort((a, b) => a.tier - b.tier);
    return rows.map((row) => ({
      sales: Number(row.sales_amount),
      bonus: Number(row.bonus_amount),
      label: TIER_LABELS[row.tier - 1] || String(row.tier),
    }));
  }, [tierSettings]);

  // كيلوات المصنّعات المرحّلة تدخل في كيلوات الشهر (الحد الأدنى + الشرائح).
  const carriedKgByGirl = useMemo(() => {
    const map: Record<string, number> = {};
    girls.forEach((girl) => { map[girl] = 0; });
    carried.forEach((item) => {
      if (item.girl in map) map[item.girl] += Number(item.procKg) || 0;
    });
    return map;
  }, [carried, girls]);

  const rows = useMemo(() => buildPayrollBaseRows({
    girls,
    qty: qtyQuery.data ?? { meat: {}, bone: {}, processed: {} },
    prices,
    processedTiers,
    meatTiers,
    chickQtyByGirl: {},
    chickBonusRate: 0,
    bonePerKg,
    baseDefault,
    overrides,
    year,
    month,
    schedules,
    carriedProcessedKg: carriedKgByGirl,
  }), [girls, qtyQuery.data, prices, processedTiers, meatTiers, bonePerKg, baseDefault, overrides, year, month, schedules, carriedKgByGirl]);

  const carriedByGirl = useMemo(() => {
    const map = new Map<string, number>();
    girls.forEach((girl) => map.set(girl, 0));
    rows.forEach((row) => {
      const items = carried.filter((item) => item.girl === row.girl).map((item) => ({
        orderId: item.orderId,
        procKg: item.procKg,
        deliveredAt: item.deliveredAt,
      }));
      const allocated = allocateProcessedCarry(row.procKg, row, schedule, items);
      map.set(row.girl, allocated.reduce((sum, item) => sum + item.bonus, 0));
    });
    return map;
  }, [carried, girls, rows, schedule]);

  return {
    girls,
    rows,
    carriedByGirl,
    carriedKgByGirl,
    schedule: schedule ?? APPROVED_OCT_2026_SCHEDULE,
    marginal: !!schedule,
    isLoading: qtyQuery.isLoading,
    displayName: displayModeratorName,
  };
};
