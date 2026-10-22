import QueryStateGate from '@/components/common/QueryStateGate';
import { combineQueryStates } from '@/lib/queryGuard';
import { useMemo, useState } from 'react';
import { useKgPrices } from '@/hooks/useKgPrices';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Wallet, RotateCcw, CheckCircle2, Lock } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { cairoMonthStartUTC, currentCairoYearMonth } from '@/lib/cairoDate';
import PrevMonthBonusDialog, { CarriedDetail } from './PrevMonthBonusDialog';
import { moderatorKeysForMonth, displayModeratorName, DEFAULT_BASE_SALARY, payrollDefaultForMonth, matchesModeratorGroup } from '@/constants/moderators';
import { useModeratorCategoryQty } from '@/hooks/useModeratorCategoryQty';
import { fetchPayrollCarried } from '@/lib/fetchPayrollCarried';
import { allocateProcessedCarry, buildPayrollBaseRows, type PayrollOverride } from '@/lib/moderatorPayrollMath';
import { slicesFromStored, formatKg as formatBandKg, formatEgp } from '@/lib/processedKgBonus';
import RisingPayrollTable from '@/components/sales/RisingPayrollTable';
import type { Json } from '@/integrations/supabase/types';


type Girl = string;

// Default tier ladders (used as fallback if target_bonus_settings is empty).
const TIER_LABELS = ['الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع'];
const DEFAULT_PROCESSED_TIERS: Array<{ sales: number; bonus: number; label: string }> = [
  { sales: 50000, bonus: 5, label: 'الأول' },
  { sales: 60000, bonus: 6, label: 'الثاني' },
  { sales: 80000, bonus: 8, label: 'الثالث' },
  { sales: 100000, bonus: 10, label: 'الرابع' },
  { sales: 125000, bonus: 12, label: 'الخامس' },
  { sales: 150000, bonus: 15, label: 'السادس' },
  { sales: 185000, bonus: 18, label: 'السابع' },
];
const DEFAULT_MEAT_TIERS: Array<{ sales: number; bonus: number; label: string }> = [
  { sales: 100000, bonus: 5, label: 'الأول' },
  { sales: 125000, bonus: 5, label: 'الثاني' },
  { sales: 200000, bonus: 5, label: 'الثالث' },
  { sales: 300000, bonus: 7, label: 'الرابع' },
  { sales: 400000, bonus: 7, label: 'الخامس' },
  { sales: 500000, bonus: 7, label: 'السادس' },
  { sales: 600000, bonus: 7, label: 'السابع' },
];
// الافتراضي لو مفيش صف 'لحوم بالعظم/كجم' في target_bonus_settings.
const DEFAULT_BONE_BONUS_PER_KG = 3.5;

const months = [
  { value: 1, label: 'يناير' }, { value: 2, label: 'فبراير' }, { value: 3, label: 'مارس' },
  { value: 4, label: 'أبريل' }, { value: 5, label: 'مايو' }, { value: 6, label: 'يونيو' },
  { value: 7, label: 'يوليو' }, { value: 8, label: 'أغسطس' }, { value: 9, label: 'سبتمبر' },
  { value: 10, label: 'أكتوبر' }, { value: 11, label: 'نوفمبر' }, { value: 12, label: 'ديسمبر' },
];

const _cur = currentCairoYearMonth();
const currentYear = _cur.year;
const currentMonth = _cur.monthIndex0 + 1;

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

interface Props {
  month?: number;
  year?: number;
}

const ModeratorPayrollTable = ({ month, year }: Props = {}) => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { isGeneralManager, isExecutiveManager, isSalesManager, role, user, profile } = useAuth();
  const canEdit = isGeneralManager || isExecutiveManager || isSalesManager || role === 'marketing_sales_manager';
  const canApprove = canEdit;

  const [internalMonth, setInternalMonth] = useState(currentMonth);
  const [internalYear, setInternalYear] = useState(currentYear);
  const isControlled = month !== undefined && year !== undefined;
  const selectedMonth = isControlled ? (month as number) : internalMonth;
  const selectedYear = isControlled ? (year as number) : internalYear;
  const setSelectedMonth = setInternalMonth;
  const setSelectedYear = setInternalYear;

  // قائمة المسوقات الفعّالة في الشهر المختار (تستبعد من لم تبدأ العمل بعد).
  const GIRLS = useMemo(
    () => moderatorKeysForMonth(selectedYear, selectedMonth),
    [selectedYear, selectedMonth],
  );


  const { prices } = useKgPrices({ year: selectedYear, month: selectedMonth });

  const { data: qty = { meat: {}, bone: {}, processed: {} }, ...qtyQ } = useModeratorCategoryQty(selectedYear, selectedMonth, GIRLS);

    // Chick orders count per girl
  const { data: chickQtyByGirl = {} as Record<string, number>, ...chickQ } = useQuery({
    queryKey: ['girls-chick-qty', selectedMonth, selectedYear],
    queryFn: async () => {
      const startDate = cairoMonthStartUTC(selectedYear, selectedMonth - 1).toISOString();
      const endDate = cairoMonthStartUTC(selectedYear, selectedMonth).toISOString();
      const empty = GIRLS.reduce((acc, g) => { acc[g] = 0; return acc; }, {} as Record<string, number>);
      // الكتاكيت تُحسب حسب تاريخ التسليم (updated_at) وليس تاريخ التسجيل.
      const { data: rows, error } = await supabase
        .from('chick_orders')
        .select('chick_count, created_by')
        .gte('updated_at', startDate)
        .lt('updated_at', endDate)
        .eq('status', 'delivered');
      if (error) throw error;
      const userIds = Array.from(new Set((rows || []).map(r => r.created_by).filter(Boolean))) as string[];
      let profileMap = new Map<string, string>();
      if (userIds.length > 0) {
          const { data: profiles } = await supabase.from('profile_directory').select('id, full_name').in('id', userIds);
        profileMap = new Map((profiles || []).map(p => [p.id, p.full_name]));
      }
      (rows || []).forEach(r => {
        const name = r.created_by ? (profileMap.get(r.created_by) || '') : '';
        const girl = GIRLS.find(g => matchesModeratorGroup(name, g));
        if (girl) empty[girl] += Number(r.chick_count) || 0;
      });
      return empty;
    },
    refetchInterval: 60000,
  });


  const { data: overrides = [], ...overridesQ } = useQuery({
    queryKey: ['payroll-overrides', selectedMonth, selectedYear],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payroll_bonus_overrides')
        .select('*')
        .eq('month', selectedMonth)
        .eq('year', selectedYear);
      if (error) throw error;
      return data as Array<{ moderator_name: string; processed_bonus: number | null; meat_bonus: number | null; bone_bonus: number | null; processed_rate: number | null; meat_rate: number | null; bone_rate: number | null; deduction: number | null }>;
    },
  });

  // Tiers loaded from target_bonus_settings so editing the targets table reflects here automatically.
  const { data: tierSettings = [], ...tierQ } = useQuery({
    queryKey: ['target_bonus_settings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('target_bonus_settings')
        .select('*')
        .order('tier');
      if (error) throw error;
      return data as Array<{ category: string; tier: number; sales_amount: number; bonus_amount: number }>;
    },
    refetchInterval: 30000,
  });

  const PROCESSED_TIERS = useMemo(() => {
    const r = tierSettings.filter(t => t.category === 'مصنعات').sort((a, b) => a.tier - b.tier);
    if (r.length === 0) return DEFAULT_PROCESSED_TIERS;
    return r.map(x => ({ sales: Number(x.sales_amount), bonus: Number(x.bonus_amount), label: TIER_LABELS[x.tier - 1] || String(x.tier) }));
  }, [tierSettings]);

  const MEAT_TIERS = useMemo(() => {
    const r = tierSettings.filter(t => t.category === 'لحوم').sort((a, b) => a.tier - b.tier);
    if (r.length === 0) return DEFAULT_MEAT_TIERS;
    return r.map(x => ({ sales: Number(x.sales_amount), bonus: Number(x.bonus_amount), label: TIER_LABELS[x.tier - 1] || String(x.tier) }));
  }, [tierSettings]);

  const chickBonusRate = useMemo(() => {
    const r = tierSettings.find(t => t.category === 'كتاكيت' && t.tier === 1);
    return r ? Number(r.bonus_amount) : 50;
  }, [tierSettings]);

  // بونص اللحوم بالعظم لكل كجم + المرتب الأساسي العام — قابلين للتعديل من جدول التارجت الشهري.
  const BONE_BONUS_PER_KG = useMemo(() => {
    const r = tierSettings.find(t => t.category === 'لحوم بالعظم/كجم' && t.tier === 1);
    return r ? Number(r.bonus_amount) : DEFAULT_BONE_BONUS_PER_KG;
  }, [tierSettings]);

  const defaultBaseSalary = useMemo(() => {
    const r = tierSettings.find(t => t.category === 'أساسي' && t.tier === 1);
    return r ? Number(r.bonus_amount) : DEFAULT_BASE_SALARY;
  }, [tierSettings]);

  // ===== اعتماد قبض الشهر (Closures) =====
  const { data: closures = [], isSuccess: closuresLoaded, ...closuresQ } = useQuery({
    queryKey: ['payroll-month-closures'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payroll_month_closures')
        .select('*')
        .order('year')
        .order('month');
      if (error) throw error;
      return data as Array<{ id: string; year: number; month: number; approved_at: string; approved_by_name: string | null }>;
    },
  });

  const selectedClosure = useMemo(
    () => closures.find(c => c.year === selectedYear && c.month === selectedMonth) || null,
    [closures, selectedYear, selectedMonth],
  );

  const { data: snapshots = [] } = useQuery({
    queryKey: ['payroll-month-snapshots', selectedMonth, selectedYear, selectedClosure?.id],
    enabled: !!selectedClosure,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payroll_month_snapshots')
        .select('*')
        .eq('year', selectedYear)
        .eq('month', selectedMonth);
      if (error) throw error;
      return data as any[];
    },
  });

  // الأوردرات المرحّلة من شهور معتمدة إلى قبض الشهر المحدد
  const closureKey = closures.map(c => `${c.year}-${c.month}-${c.approved_at}`).join('|');
  const { data: carried = [], ...carriedQ } = useQuery({
    queryKey: ['payroll-carried-orders', selectedMonth, selectedYear, closureKey, GIRLS.join('|')],
    enabled: closures.length > 0,
    queryFn: () => fetchPayrollCarried(selectedYear, selectedMonth, GIRLS, closures),
  });


  const overrideMutation = useMutation({
    mutationFn: async ({ girl, field, value }: { girl: Girl; field: 'processed_bonus' | 'meat_bonus' | 'bone_bonus' | 'processed_rate' | 'meat_rate' | 'bone_rate' | 'deduction'; value: number | null }) => {
      const payload: any = {
        moderator_name: girl,
        month: selectedMonth,
        year: selectedYear,
        [field]: value,
      };
      const { error } = await supabase
        .from('payroll_bonus_overrides')
        .upsert(payload, { onConflict: 'moderator_name,month,year' });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll-overrides', selectedMonth, selectedYear] });
    },
    onError: (e: any) => toast({ title: 'تعذر الحفظ', description: e.message, variant: 'destructive' }),
  });

  // شهر معتمد (أو لسه مش عارفين): الأساسي وبونص العظم يفضلوا على 2,500 / 3.5.
  // الشهر المفتوح بس هو اللي ياخد القيم المعدّلة من target_bonus_settings.
  // لقطة القبض، لو اتحملت، بتستبدل الأرقام دي بالكامل في `rows`.
  const baseForLive = payrollDefaultForMonth(closuresLoaded, !!selectedClosure, defaultBaseSalary, DEFAULT_BASE_SALARY);
  const boneForLive = payrollDefaultForMonth(closuresLoaded, !!selectedClosure, BONE_BONUS_PER_KG, DEFAULT_BONE_BONUS_PER_KG);
  const schedules: never[] = [];

  // قرار 19 أكتوبر 2026: مصنّعات الأوردرات المرحّلة تُحسب ضمن كيلوات الشهر للحد الأدنى والشرائح.
  const carriedProcessedKg = useMemo(() => {
    const map: Record<string, number> = {};
    (carried as any[]).forEach((item) => {
      map[item.girl] = (map[item.girl] || 0) + (Number(item.procKg) || 0);
    });
    return map;
  }, [carried]);

  const baseRows = useMemo(() => buildPayrollBaseRows({
    girls: GIRLS,
    qty,
    prices,
    processedTiers: PROCESSED_TIERS,
    meatTiers: MEAT_TIERS,
    chickQtyByGirl,
    chickBonusRate,
    bonePerKg: boneForLive,
    baseDefault: baseForLive,
    overrides: overrides as PayrollOverride[],
    year: selectedYear,
    month: selectedMonth,
    schedules,
    carriedProcessedKg,
  }), [qty, prices, overrides, PROCESSED_TIERS, MEAT_TIERS, chickQtyByGirl, chickBonusRate, boneForLive, baseForLive, GIRLS, selectedYear, selectedMonth, schedules, carriedProcessedKg]);

  // بونص الشهر السابق (الأوردرات المرحّلة) بأسعار تارجت الشهر الحالي
  const carryByGirl = useMemo(() => {
    const map = new Map<string, { bonus: number; details: CarriedDetail[] }>();
    const processedByOrder = new Map<string, { bonus: number; rate: number; tierLabel: string }>();
    GIRLS.forEach(g => map.set(g, { bonus: 0, details: [] }));
    baseRows.forEach((row) => {
      const items = carried
        .filter((item: any) => item.girl === row.girl)
        .map((item: any) => ({ orderId: item.orderId, procKg: item.procKg, deliveredAt: item.deliveredAt }));
      allocateProcessedCarry(row.procKg, row, null, items).forEach((item) => {
        processedByOrder.set(`${row.girl}:${item.orderId}`, item);
      });
    });
    carried.forEach((c: any) => {
      const row = baseRows.find(r => r.girl === c.girl);
      if (!row) return;
      const entry = map.get(c.girl)!;
      const originLabel = `${months.find(m => m.value === c.originMonth)?.label} ${c.originYear}`;
      const push = (category: CarriedDetail['category'], quantity: number, rate: number, tierLabel: string, exactBonus?: number) => {
        if (!quantity) return;
        const bonus = exactBonus ?? quantity * rate;
        entry.details.push({
          orderId: c.orderId, orderNumber: c.orderNumber, girl: c.girl, originLabel,
          closureApprovedAt: c.closureApprovedAt, deliveredAt: c.deliveredAt,
          category, quantity, tierLabel, rate, bonus,
        });
        entry.bonus += bonus;
      };
      const processedAlloc = processedByOrder.get(`${c.girl}:${c.orderId}`);
      push('مصنعات', c.procKg, processedAlloc?.rate ?? 0, processedAlloc?.tierLabel ?? 'بونص الكيلو', processedAlloc?.bonus);
      push('لحوم', c.meatKg, row.meatTier ? row.meatRate : 0, row.meatTier ? `التارجت ${row.meatTier.label}` : 'لم يتحقق');
      push('لحوم بالعظم', c.boneKg, row.meatTier ? row.boneRate : 0, row.meatTier ? `التارجت ${row.meatTier.label}` : 'لم يتحقق');
    });
    return map;
  }, [carried, baseRows]);

  const liveRows = useMemo(() => baseRows.map(r => {
    const prevBonus = carryByGirl.get(r.girl)?.bonus || 0;
    return { ...r, prevBonus, total: r.total + prevBonus };
  }), [baseRows, carryByGirl]);

  // بعد الاعتماد: تُعرض النسخة المثبتة (Snapshot) بدل الحساب المباشر.
  // الأساسي وبونص العظم هنا من اللقطة المحفوظة، مش من الإعداد الحالي.
  const rows = useMemo(() => {
    if (!selectedClosure || snapshots.length === 0) return liveRows;
    return liveRows.map(r => {
      const s = snapshots.find((x: any) => x.moderator_name === r.girl);
      if (!s) return r;
      const storedMetaEarly = s.processed_band_breakdown as { scheme?: string; qualified?: boolean; carried_kg?: number; counted_kg?: number } | null;
      if (storedMetaEarly?.scheme === 'rising') {
        return {
          ...r,
          scheme: 'rising' as const,
          bandBreakdown: [],
          storedBreakdown: s.processed_band_breakdown,
          minimumKg: 400,
          qualified: !!storedMetaEarly.qualified,
          carriedProcKg: Number(storedMetaEarly.carried_kg) || 0,
          countedProcKg: Number(storedMetaEarly.counted_kg) || Number(s.processed_qty),
          base: Number(s.base_salary),
          procSales: Number(s.processed_sales),
          procKg: Number(s.processed_qty),
          procRate: 0,
          procBonus: Number(s.processed_bonus),
          procTier: null,
          meatSales: Number(s.meat_sales),
          meatKg: Number(s.meat_qty),
          meatRate: Number(s.meat_rate),
          meatBonus: Number(s.meat_bonus),
          meatTier: s.meat_tier_label ? { sales: 0, bonus: Number(s.meat_rate), label: s.meat_tier_label } : null,
          boneKg: Number(s.bone_qty),
          boneRate: Number(s.bone_rate),
          boneBonus: Number(s.bone_bonus),
          chickCount: Number(s.chick_count),
          chickBonus: Number(s.chick_bonus),
          prevBonus: Number(s.prev_month_bonus),
          deductions: Number((s as any).deductions ?? 0),
          total: Number(s.grand_total),
          procOverridden: false,
        };
      }
      const storedSlices = slicesFromStored(s.processed_band_breakdown);
      const storedMeta = s.processed_band_breakdown as { minimum_kg?: number; qualified?: boolean; carried_kg?: number } | null;
      const storedMinimum = Number(storedMeta?.minimum_kg);
      return {
        ...r,
        scheme: storedSlices ? 'marginal' as const : 'flat' as const,
        bandBreakdown: storedSlices ?? [],
        storedBreakdown: storedSlices ? s.processed_band_breakdown : null,
        minimumKg: Number.isFinite(storedMinimum) ? storedMinimum : r.minimumKg,
        qualified: storedSlices
          ? (typeof storedMeta?.qualified === 'boolean'
            ? storedMeta.qualified
            : Number(s.processed_qty) >= (Number.isFinite(storedMinimum) ? storedMinimum : 0))
          : !!s.processed_tier_label,
        carriedProcKg: Number(storedMeta?.carried_kg) || 0,
        countedProcKg: Number(s.processed_qty) + (Number(storedMeta?.carried_kg) || 0),
        base: Number(s.base_salary),
        procSales: Number(s.processed_sales),
        procKg: Number(s.processed_qty),
        procRate: Number(s.processed_rate),
        procBonus: Number(s.processed_bonus),
        procTier: s.processed_tier_label ? { sales: 0, bonus: Number(s.processed_rate), label: s.processed_tier_label } : null,
        meatSales: Number(s.meat_sales),
        meatKg: Number(s.meat_qty),
        meatRate: Number(s.meat_rate),
        meatBonus: Number(s.meat_bonus),
        meatTier: s.meat_tier_label ? { sales: 0, bonus: Number(s.meat_rate), label: s.meat_tier_label } : null,
        boneKg: Number(s.bone_qty),
        boneRate: Number(s.bone_rate),
        boneBonus: Number(s.bone_bonus),
        chickCount: Number(s.chick_count),
        chickBonus: Number(s.chick_bonus),
        prevBonus: Number(s.prev_month_bonus),
        deductions: Number((s as any).deductions ?? 0),
        total: Number(s.grand_total),
      };
    });
  }, [liveRows, snapshots, selectedClosure]);

  const [prevDialogGirl, setPrevDialogGirl] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const approveMutation = useMutation({
    mutationFn: async () => {
      if (selectedClosure) throw new Error('تم اعتماد قبض هذا الشهر بالفعل');
      const { data: closure, error } = await supabase
        .from('payroll_month_closures')
        .insert({
          year: selectedYear,
          month: selectedMonth,
          approved_by: user?.id ?? null,
          approved_by_name: profile?.full_name ?? null,
        })
        .select()
        .single();
      if (error) throw error;

      const snapPayload = liveRows.map(r => ({
        closure_id: closure.id,
        year: selectedYear,
        month: selectedMonth,
        moderator_name: r.girl,
        base_salary: r.base,
        processed_sales: r.procSales,
        processed_tier_label: null,
        processed_qty: r.procKg,
        processed_rate: 0,
        processed_bonus: r.procBonus,
        processed_band_breakdown: (r.storedBreakdown as unknown as Json) ?? null,
        meat_sales: r.meatSales,
        meat_tier_label: r.meatTier?.label ?? null,
        meat_qty: r.meatKg,
        meat_rate: r.meatRate,
        meat_bonus: r.meatBonus,
        bone_qty: r.boneKg,
        bone_rate: r.boneRate,
        bone_bonus: r.boneBonus,
        chick_count: r.chickCount,
        chick_bonus: r.chickBonus,
        total_bonus: r.procBonus + r.meatBonus + r.boneBonus + r.chickBonus,
        prev_month_bonus: r.prevBonus,
        deductions: r.deductions,
        grand_total: r.total,
      }));
      const { error: snapErr } = await supabase.from('payroll_month_snapshots').insert(snapPayload);
      if (snapErr) throw snapErr;

      const carriedPayload: any[] = [];
      liveRows.forEach(r => {
        (carryByGirl.get(r.girl)?.details || []).forEach(d => {
          const src: any = carried.find((c: any) => c.orderId === d.orderId);
          carriedPayload.push({
            order_id: d.orderId,
            order_number: d.orderNumber,
            moderator_name: d.girl,
            category: d.category,
            origin_year: src?.originYear ?? selectedYear,
            origin_month: src?.originMonth ?? selectedMonth,
            paid_year: selectedYear,
            paid_month: selectedMonth,
            quantity: d.quantity,
            rate: d.rate,
            bonus_amount: d.bonus,
            delivered_at: d.deliveredAt,
            origin_closure_approved_at: d.closureApprovedAt,
          });
        });
      });
      if (carriedPayload.length > 0) {
        const { error: carErr } = await supabase
          .from('payroll_carried_orders')
          .upsert(carriedPayload, { onConflict: 'order_id,category', ignoreDuplicates: true });
        if (carErr) throw carErr;
      }
    },
    onSuccess: () => {
      setConfirmOpen(false);
      queryClient.invalidateQueries({ queryKey: ['payroll-month-closures'] });
      queryClient.invalidateQueries({ queryKey: ['payroll-month-snapshots'] });
      toast({ title: 'تم اعتماد القبض', description: 'تم تثبيت نتائج الشهر بنجاح' });
    },
    onError: (e: any) => toast({ title: 'تعذر الاعتماد', description: e.message, variant: 'destructive' }),
  });



  const renderBonusCell = (girl: Girl, value: number, field: 'processed_bonus' | 'meat_bonus' | 'bone_bonus' | 'processed_rate' | 'meat_rate' | 'bone_rate', overridden: boolean) => {
    if (!canEdit || selectedClosure) {
      return <span className="font-bold text-primary">{fmt(value)}</span>;
    }
    return (
      <div className="flex items-center justify-center gap-1">
        <Input
          type="number"
          defaultValue={Math.round(value)}
          key={`${girl}-${field}-${selectedMonth}-${selectedYear}-${value}`}
          className="h-8 text-center w-24"
          onBlur={(e) => {
            const v = Number(e.target.value);
            if (v !== Math.round(value)) {
              overrideMutation.mutate({ girl, field, value: v });
            }
          }}
        />
        {overridden && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title="إعادة للقيمة المحسوبة تلقائياً"
            onClick={() => overrideMutation.mutate({ girl, field, value: null })}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    );
  };


  const showingHistory = !!selectedClosure && snapshots.length > 0 && rows.some((row) => row.scheme !== 'rising');
  const showMarginal = rows.some((row) => row.scheme === 'marginal');
  const bandTemplate = (rows.find((row) => row.bandBreakdown.length)?.bandBreakdown
    ?? []);
  const risingRows = rows.map((row) => ({
    girl: row.girl,
    name: displayModeratorName(row.girl),
    base: row.base,
    ownKg: row.procKg,
    carriedKg: row.carriedProcKg,
    countedKg: row.countedProcKg,
    ownBonus: row.procBonus,
    carriedBonus: row.prevBonus,
    meatKg: row.meatKg,
    meatBonus: row.meatBonus,
    meatRate: row.meatRate,
    meatRateOverridden: row.meatRateOverridden,
    meatTierLabel: row.meatTier?.label ?? null,
    meatOverridden: row.meatOverridden,
    boneKg: row.boneKg,
    boneBonus: row.boneBonus,
    boneRate: row.boneRate,
    boneRateOverridden: row.boneRateOverridden,
    boneOverridden: row.boneOverridden,
    chickCount: row.chickCount,
    chickBonus: row.chickBonus,
    deductions: row.deductions,
    total: row.total,
    overridden: row.procOverridden,
    qualified: row.qualified,
  }));

  // ممنوع عرض أصفار وكميات الشهر لسه بتحمّل أو فشلت.
  const dataState = combineQueryStates([qtyQ, chickQ, tierQ, overridesQ, { ...closuresQ, isSuccess: closuresLoaded }, closures.length > 0 ? carriedQ : null]);
  if (!dataState.isReady) return <QueryStateGate state={dataState}>{null}</QueryStateGate>;

  return (
    <Card className="glass-card">
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-primary" />
            جدول قبض الموديريتور - {months.find(m => m.value === selectedMonth)?.label} {selectedYear}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Select value={selectedMonth.toString()} onValueChange={(v) => setSelectedMonth(Number(v))} disabled={isControlled}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                {months.map(m => <SelectItem key={m.value} value={m.value.toString()}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={selectedYear.toString()} onValueChange={(v) => setSelectedYear(Number(v))} disabled={isControlled}>
              <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[currentYear - 1, currentYear, currentYear + 1].map(y => (
                  <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {selectedClosure ? (
              <div className="flex items-center gap-2 text-xs md:text-sm text-green-700 dark:text-green-400 font-semibold">
                <Button type="button" variant="outline" size="sm" disabled className="gap-1">
                  <Lock className="h-4 w-4" /> تم اعتماد القبض
                </Button>
                <span>
                  {new Date(selectedClosure.approved_at).toLocaleString('ar-EG', { timeZone: 'Africa/Cairo', dateStyle: 'short', timeStyle: 'short' })}
                  {selectedClosure.approved_by_name ? ` — ${selectedClosure.approved_by_name}` : ''}
                </span>
              </div>
            ) : canApprove ? (
              <Button type="button" size="sm" className="gap-1" onClick={() => setConfirmOpen(true)}>
                <CheckCircle2 className="h-4 w-4" /> تم اعتماد القبض
              </Button>
            ) : null}
          </div>

        </div>
      </CardHeader>
      <CardContent className="p-2 md:p-4">
        {showingHistory && (
          <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-6 text-amber-900">
            لقطة معتمدة بالنظام السابق. الأرقام محفوظة زي ما اتسجّلت وقت الاعتماد، ومش بتتعاد حسابها.
          </p>
        )}
        {!showingHistory ? (
          <div id="moderator-payroll-table">
            <RisingPayrollTable
              rows={risingRows}
              canEdit={canEdit}
              locked={!!selectedClosure}
              onBonusCommit={(girl, value) => overrideMutation.mutate({ girl, field: 'processed_bonus', value })}
              onMeatBonusCommit={(girl, value) => overrideMutation.mutate({ girl, field: 'meat_bonus', value })}
              onMeatRateCommit={(girl, value) => overrideMutation.mutate({ girl, field: 'meat_rate', value })}
              onBoneBonusCommit={(girl, value) => overrideMutation.mutate({ girl, field: 'bone_bonus', value })}
              onBoneRateCommit={(girl, value) => overrideMutation.mutate({ girl, field: 'bone_rate', value })}
              onDeductionCommit={(girl, value) => overrideMutation.mutate({ girl, field: 'deduction', value })}
              onOpenCarry={setPrevDialogGirl}
              carryEnabled={(girl) => !!(carryByGirl.get(girl)?.details.length)}
            />
          </div>
        ) : (
        <div id="moderator-payroll-table">
        <Table className="w-full border text-xs md:text-sm">
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="text-right font-bold border">البيان</TableHead>
              {GIRLS.map(g => (
                <TableHead key={g} className="text-center font-bold border text-primary">{displayModeratorName(g)}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="font-bold border bg-muted/30">الراتب الأساسي (ج.م)</TableCell>
              {rows.map(r => <TableCell key={r.girl} className="text-center border font-semibold">{fmt(r.base)}</TableCell>)}
            </TableRow>

            <TableRow>
              <TableCell className="font-bold border bg-muted/30">مبيعات المصنعات (ج.م)</TableCell>
              {rows.map(r => <TableCell key={r.girl} className="text-center border">{fmt(r.procSales)}</TableCell>)}
            </TableRow>
            {showMarginal ? (
              <TableRow>
                <TableCell className="font-bold border bg-muted/30">الحد الأدنى لحافز المصنعات</TableCell>
                {rows.map(r => (
                  <TableCell key={r.girl} className="text-center border">
                    {r.qualified ? (
                      <span className="text-primary font-semibold">تحقق ({formatBandKg(r.minimumKg || 0, true)} كجم)</span>
                    ) : (
                      <span className="text-muted-foreground">لم يتحقق ({formatBandKg(r.minimumKg || 0, true)} كجم)</span>
                    )}
                  </TableCell>
                ))}
              </TableRow>
            ) : (
              <TableRow>
                <TableCell className="font-bold border bg-muted/30">التارجت المحقق (مصنعات)</TableCell>
                {rows.map(r => (
                  <TableCell key={r.girl} className="text-center border">
                    {r.procTier ? (
                      <span className="text-primary font-semibold">التارجت {r.procTier.label} ({r.procTier.bonus} ج/كجم)</span>
                    ) : (
                      <span className="text-muted-foreground">لم يتحقق</span>
                    )}
                  </TableCell>
                ))}
              </TableRow>
            )}
            <TableRow>
              <TableCell className="font-bold border bg-muted/30">كمية المصنعات (كجم)</TableCell>
              {rows.map(r => <TableCell key={r.girl} className="text-center border">{fmt(r.procKg)}</TableCell>)}
            </TableRow>
            {showMarginal && rows.some(r => r.carriedProcKg > 0) && (
              <TableRow>
                <TableCell className="font-bold border bg-muted/30">+ مرحّل من الشهر السابق (كجم)</TableCell>
                {rows.map(r => (
                  <TableCell key={r.girl} className="text-center border">
                    {r.carriedProcKg > 0 ? `${formatBandKg(r.carriedProcKg)} · الإجمالي ${formatBandKg(r.countedProcKg)}` : "—"}
                  </TableCell>
                ))}
              </TableRow>
            )}
            {showMarginal ? bandTemplate.map((band) => (
              <TableRow key={`band-${band.fromKg}-${band.rate}`}>
                <TableCell className="font-bold border bg-muted/20 text-xs">
                  {band.toKg == null
                    ? `أكثر من ${formatBandKg(band.fromKg, true)} كجم × ${formatBandKg(band.rate)} ج`
                    : `${formatBandKg(band.fromKg, true)}–${formatBandKg(band.toKg, true)} كجم × ${formatBandKg(band.rate)} ج`}
                </TableCell>
                {rows.map((row) => {
                  const slice = row.bandBreakdown.find((item) => item.fromKg === band.fromKg && item.rate === band.rate);
                  return (
                    <TableCell key={row.girl} className="text-center border text-xs">
                      {slice && slice.kg > 0 ? `${formatBandKg(slice.kg)} × ${formatBandKg(slice.rate)} = ${formatEgp(slice.amount)}` : '—'}
                    </TableCell>
                  );
                })}
              </TableRow>
            )) : (
              <TableRow>
                <TableCell className="font-bold border bg-muted/30">بونص المصنعات لكل كجم (ج)</TableCell>
                {rows.map(r => <TableCell key={r.girl} className="text-center border">{renderBonusCell(r.girl, r.procRate, 'processed_rate', r.procRateOverridden)}</TableCell>)}
              </TableRow>
            )}
            <TableRow className="bg-yellow-100 dark:bg-yellow-900/30">
              <TableCell className="font-bold border">بونص المصنعات (ج.م)</TableCell>
              {rows.map(r => <TableCell key={r.girl} className="text-center border">{renderBonusCell(r.girl, r.procBonus, 'processed_bonus', r.procOverridden)}</TableCell>)}
            </TableRow>

            <TableRow>
              <TableCell className="font-bold border bg-muted/30">مبيعات اللحوم (ج.م)</TableCell>
              {rows.map(r => <TableCell key={r.girl} className="text-center border">{fmt(r.meatSales)}</TableCell>)}
            </TableRow>
            <TableRow>
              <TableCell className="font-bold border bg-muted/30">التارجت المحقق (لحوم)</TableCell>
              {rows.map(r => (
                <TableCell key={r.girl} className="text-center border">
                  {r.meatTier ? (
                    <span className="text-primary font-semibold">التارجت {r.meatTier.label} ({r.meatTier.bonus} ج/كجم)</span>
                  ) : (
                    <span className="text-muted-foreground">لم يتحقق</span>
                  )}
                </TableCell>
              ))}
            </TableRow>
            <TableRow>
              <TableCell className="font-bold border bg-muted/30">كمية اللحوم (كجم)</TableCell>
              {rows.map(r => <TableCell key={r.girl} className="text-center border">{fmt(r.meatKg)}</TableCell>)}
            </TableRow>
            <TableRow>
              <TableCell className="font-bold border bg-muted/30">بونص اللحوم لكل كجم (ج)</TableCell>
              {rows.map(r => <TableCell key={r.girl} className="text-center border">{renderBonusCell(r.girl, r.meatRate, 'meat_rate', r.meatRateOverridden)}</TableCell>)}
            </TableRow>
            <TableRow className="bg-yellow-100 dark:bg-yellow-900/30">
              <TableCell className="font-bold border">بونص اللحوم (ج.م)</TableCell>
              {rows.map(r => <TableCell key={r.girl} className="text-center border">{renderBonusCell(r.girl, r.meatBonus, 'meat_bonus', r.meatOverridden)}</TableCell>)}
            </TableRow>
            <TableRow>
              <TableCell className="font-bold border bg-muted/30">كمية اللحوم بالعظم (كجم)</TableCell>
              {rows.map(r => <TableCell key={r.girl} className="text-center border">{fmt(r.boneKg)}</TableCell>)}
            </TableRow>
            <TableRow>
              <TableCell className="font-bold border bg-muted/30">بونص اللحوم بالعظم لكل كجم (ج)</TableCell>
              {rows.map(r => <TableCell key={r.girl} className="text-center border">{renderBonusCell(r.girl, r.boneRate, 'bone_rate', r.boneRateOverridden)}</TableCell>)}
            </TableRow>
            <TableRow className="bg-yellow-100 dark:bg-yellow-900/30">
              <TableCell className="font-bold border">بونص اللحوم بالعظم (ج.م)</TableCell>
              {rows.map(r => <TableCell key={r.girl} className="text-center border">{renderBonusCell(r.girl, r.boneBonus, 'bone_bonus', r.boneOverridden)}</TableCell>)}
            </TableRow>
            <TableRow className="bg-yellow-100 dark:bg-yellow-900/30">
              <TableCell className="font-bold border">
                بونص الكتاكيت (ج.م)
                <span className="block text-xs font-normal text-muted-foreground">
                  {`${fmt(chickBonusRate)} ج × عدد الكتاكيت`}
                </span>
              </TableCell>
              {rows.map(r => (
                <TableCell key={r.girl} className="text-center border font-bold text-primary">
                  {fmt(r.chickBonus)}
                  <span className="block text-xs font-normal text-muted-foreground">
                    ({fmt(r.chickCount)} كتكوت)
                  </span>
                </TableCell>
              ))}
            </TableRow>

            <TableRow className="bg-accent/20">
              <TableCell className="font-bold border text-accent-foreground">إجمالي البونص (ج.م)</TableCell>
              {rows.map(r => (
                <TableCell key={r.girl} className="text-center border font-bold text-primary">
                  {fmt(r.procBonus + r.meatBonus + r.boneBonus + r.chickBonus)}
                </TableCell>
              ))}
            </TableRow>

            <TableRow className="bg-blue-50 dark:bg-blue-900/20">
              <TableCell className="font-bold border">بونص الشهر السابق (ج.م)</TableCell>
              {rows.map(r => (
                <TableCell key={r.girl} className="text-center border">
                  <button
                    type="button"
                    className="font-bold text-primary underline underline-offset-2 disabled:no-underline disabled:text-muted-foreground"
                    disabled={!(carryByGirl.get(r.girl)?.details.length)}
                    onClick={() => setPrevDialogGirl(r.girl)}
                  >
                    {fmt(r.prevBonus)}
                  </button>
                </TableCell>
              ))}
            </TableRow>

            <TableRow className="bg-destructive/10">
              <TableCell className="font-bold border text-destructive">الخصومات (ج.م)</TableCell>
              {rows.map(r => (
                <TableCell key={r.girl} className="text-center border">
                  {canEdit && !selectedClosure ? (
                    <Input
                      type="number"
                      min={0}
                      defaultValue={r.deductions ? Math.round(r.deductions) : ''}
                      placeholder="0"
                      key={`${r.girl}-deduction-${selectedMonth}-${selectedYear}-${r.deductions}`}
                      className="h-8 text-center w-24 mx-auto"
                      onBlur={(e) => {
                        const raw = e.target.value.trim();
                        const v = raw === '' ? null : Number(raw);
                        if ((v ?? 0) !== Math.round(r.deductions || 0)) {
                          overrideMutation.mutate({ girl: r.girl, field: 'deduction', value: v });
                        }
                      }}
                    />
                  ) : (
                    <span className="font-bold text-destructive">{r.deductions ? `- ${fmt(r.deductions)}` : '0'}</span>
                  )}
                </TableCell>
              ))}
            </TableRow>


            <TableRow className="bg-primary/15">
              <TableCell className="font-bold border text-primary">إجمالي القبض (ج.م)</TableCell>
              {rows.map(r => (
                <TableCell key={r.girl} className="text-center border font-bold text-primary text-lg">
                  {fmt(r.total)}
                </TableCell>
              ))}
            </TableRow>
          </TableBody>
        </Table>
        <p className="text-xs text-muted-foreground mt-3">
          * أرقام اللقطة دي من النظام السابق ومحفوظة للإدارة. مش ظاهرة للمسوقات، ومش بتتعدل.
        </p>
        </div>
        )}

        <PrevMonthBonusDialog
          open={!!prevDialogGirl}
          onOpenChange={(v) => !v && setPrevDialogGirl(null)}
          girl={prevDialogGirl || ''}
          details={prevDialogGirl ? (carryByGirl.get(prevDialogGirl)?.details || []) : []}
        />

        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent dir="rtl">
            <AlertDialogHeader>
              <AlertDialogTitle>اعتماد القبض</AlertDialogTitle>
              <AlertDialogDescription>
                {`هل أنت متأكد من اعتماد قبض شهر ${months.find(m => m.value === selectedMonth)?.label}؟ بعد الاعتماد هتتثبت أرقام البونص الجديد، وأي أوردر من الشهر ده يتسلّم بعد الاعتماد هيتضاف كيلو بتاعه على قبض الشهر الجاي.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>إلغاء</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => { e.preventDefault(); approveMutation.mutate(); }}
                disabled={approveMutation.isPending}
              >
                تأكيد الاعتماد
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>

  );
};

export default ModeratorPayrollTable;
