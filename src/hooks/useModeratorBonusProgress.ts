import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useKgPrices } from '@/hooks/useKgPrices';
import { usePayrollClosures } from '@/hooks/usePayrollClosure';
import { useModeratorCategoryQty } from '@/hooks/useModeratorCategoryQty';
import { useProcessedKgSchedules } from '@/hooks/useProcessedKgSchedules';
import { moderatorKeysForMonth, displayModeratorName, DEFAULT_BASE_SALARY, payrollDefaultForMonth, matchesModeratorGroup } from '@/constants/moderators';
import { cairoMonthStartUTC } from '@/lib/cairoDate';
import { fetchPayrollCarried } from '@/lib/fetchPayrollCarried';
import { allocateProcessedCarry, buildPayrollBaseRows, carriedMeatBoneBonus, type PayrollOverride } from '@/lib/moderatorPayrollMath';
import { scheduleForMonth, APPROVED_OCT_2026_SCHEDULE } from '@/lib/processedKgBonus';
import { combineQueryStates } from '@/lib/queryGuard';

const TIER_LABELS = ['الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع'];

export interface ModeratorBonusProgressOptions {
  /** لما المسوقة بتشوف شاشتها: نجيب أوردراتها هي بس بدل كل المسوقات. */
  onlyGirl?: string | null;
}

export const useModeratorBonusProgress = (year: number, month: number, options: ModeratorBonusProgressOptions = {}) => {
  const { onlyGirl = null } = options;
  const girls = useMemo(() => {
    const all = moderatorKeysForMonth(year, month);
    return onlyGirl ? all.filter((girl) => girl === onlyGirl) : all;
  }, [year, month, onlyGirl]);
  const qtyQuery = useModeratorCategoryQty(year, month, girls);
  const { schedules } = useProcessedKgSchedules();
  const { prices } = useKgPrices({ year, month });
  const closuresQuery = usePayrollClosures();
  const { data: closures = [], isSuccess: closuresLoaded } = closuresQuery;

  const tierQuery = useQuery({
    queryKey: ['target_bonus_settings'],
    queryFn: async () => {
      const { data, error } = await supabase.from('target_bonus_settings').select('*').order('tier');
      if (error) throw error;
      return data as Array<{ category: string; tier: number; sales_amount: number; bonus_amount: number }>;
    },
  });

  const overridesQuery = useQuery({
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
  const carriedQuery = useQuery({
    queryKey: ['payroll-carried-orders', month, year, closureKey, girls.join('|')],
    enabled: closures.length > 0,
    queryFn: () => fetchPayrollCarried(year, month, girls, closures),
  });

  const tierSettings = useMemo(() => tierQuery.data ?? [], [tierQuery.data]);
  const overrides = useMemo(() => overridesQuery.data ?? [], [overridesQuery.data]);
  // الشهر اللي ملهوش أي قفل سابق مفيهوش ترحيل أصلًا، فده صفر حقيقي مش fallback.
  const carriedEnabled = closures.length > 0;
  const carried = useMemo(() => carriedQuery.data ?? [], [carriedQuery.data]);

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

  const chickQuery = useQuery({
    queryKey: ['girls-chick-qty', month, year, girls.join('|')],
    queryFn: async () => {
      const startDate = cairoMonthStartUTC(year, month - 1).toISOString();
      const endDate = cairoMonthStartUTC(year, month).toISOString();
      const empty = girls.reduce((acc, girl) => { acc[girl] = 0; return acc; }, {} as Record<string, number>);
      const { data: chickRows, error } = await supabase
        .from('chick_orders')
        .select('chick_count, created_by')
        .gte('updated_at', startDate)
        .lt('updated_at', endDate)
        .eq('status', 'delivered');
      if (error) throw error;
      const userIds = Array.from(new Set((chickRows || []).map((row) => row.created_by).filter(Boolean))) as string[];
      let profileMap = new Map<string, string>();
      if (userIds.length > 0) {
        const { data: profiles } = await supabase.from('profile_directory').select('id, full_name').in('id', userIds);
        profileMap = new Map((profiles || []).map((profile) => [profile.id, profile.full_name]));
      }
      (chickRows || []).forEach((row) => {
        const fullName = row.created_by ? (profileMap.get(row.created_by) || '') : '';
        const girl = girls.find((key) => matchesModeratorGroup(fullName, key));
        if (girl) empty[girl] += Number(row.chick_count) || 0;
      });
      return empty;
    },
  });

  const chickQtyByGirl = useMemo(() => chickQuery.data ?? ({} as Record<string, number>), [chickQuery.data]);

  // ممنوع نبني الكروت بأصفار لو الكميات لسه بتحمّل أو فشلت (حادثة نورا 22/10/2026).
  const state = combineQueryStates([
    qtyQuery,
    chickQuery,
    tierQuery,
    overridesQuery,
    closuresQuery,
    carriedEnabled ? carriedQuery : null,
  ]);

  const chickBonusRate = useMemo(() => {
    const row = tierSettings.find((item) => item.category === 'كتاكيت' && item.tier === 1);
    return row ? Number(row.bonus_amount) : 50;
  }, [tierSettings]);

  const rows = useMemo(() => (!state.isReady || !qtyQuery.data ? [] : buildPayrollBaseRows({
    girls,
    qty: qtyQuery.data,
    prices,
    processedTiers,
    meatTiers,
    chickQtyByGirl,
    chickBonusRate,
    bonePerKg,
    baseDefault,
    overrides,
    year,
    month,
    schedules,
    carriedProcessedKg: carriedKgByGirl,
  })), [state.isReady, girls, qtyQuery.data, prices, processedTiers, meatTiers, chickQtyByGirl, chickBonusRate, bonePerKg, baseDefault, overrides, year, month, schedules, carriedKgByGirl]);

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

  const sideCarryByGirl = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((row) => {
      const items = carried.filter((item) => item.girl === row.girl);
      map.set(row.girl, carriedMeatBoneBonus(row, items));
    });
    return map;
  }, [carried, rows]);

  return {
    girls,
    rows,
    meatTiers,
    carriedByGirl,
    carriedKgByGirl,
    sideCarryByGirl,
    schedule: schedule ?? APPROVED_OCT_2026_SCHEDULE,
    marginal: !!schedule,
    isLoading: state.isPending,
    isError: state.isError,
    isReady: state.isReady,
    error: state.error,
    retry: state.retry,
    queryState: state,
    displayName: displayModeratorName,
  };
};
