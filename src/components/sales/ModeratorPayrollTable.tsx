import { useEffect, useMemo, useState } from 'react';
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


const GIRLS = ['اية', 'نورا', 'منال'] as const;
type Girl = typeof GIRLS[number];

const BASE_SALARY: Record<Girl, number> = {
  اية: 3000,
  نورا: 2500,
  منال: 2500,
};

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
const BONE_BONUS_PER_KG = 3.5;

// التصنيف المعتمد للمسوقات الأربعة (لا تُعدّل بدون طلب صريح):
// لحوم: قطع، استيك، موزة، فراشة، قطعية الدبوس، تربيانكو، اسكالوب، رول، كباب
// لحوم بالعظم: دبوس 6 كيلو، فخدة نعام، نعامة صندوق
// مصنعات: شاورما، شيش، كفتة، سجق، برجر، طرب، حواشي، مفروم، كفتة أرز، برجر بالجبنة
const MEAT_KEYWORDS = ['قطع', 'استيك', 'موزة', 'فراشة', 'قطعية', 'تربيانكو', 'اسكالوب', 'رول', 'كباب'];
const BONE_MEAT_KEYWORDS = ['دبوس بالعظم', 'دبوس 6', 'فخده', 'فخذه', 'فخدة', 'نعامه صندوق', 'نعامة صندوق'];
const PROCESSED_KEYWORDS = ['شاورما', 'شيش', 'كفته', 'كفتة', 'سجق', 'برجر', 'طرب', 'حواشي', 'حواشى', 'حواوشي', 'حواوشى', 'مفروم'];

const months = [
  { value: 1, label: 'يناير' }, { value: 2, label: 'فبراير' }, { value: 3, label: 'مارس' },
  { value: 4, label: 'أبريل' }, { value: 5, label: 'مايو' }, { value: 6, label: 'يونيو' },
  { value: 7, label: 'يوليو' }, { value: 8, label: 'أغسطس' }, { value: 9, label: 'سبتمبر' },
  { value: 10, label: 'أكتوبر' }, { value: 11, label: 'نوفمبر' }, { value: 12, label: 'ديسمبر' },
];

const _cur = currentCairoYearMonth();
const currentYear = _cur.year;
const currentMonth = _cur.monthIndex0 + 1;

const normalize = (s: string) => (s || '').replace(/[إأآا]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
const matches = (name: string, target: string) => normalize(name.trim()).includes(normalize(target));

const PRICES_KEY = 'girls-sales-prices-v2';
const defaultPrices = { meat_price: 390, bone_meat_price: 350, processed_price: 160 };

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

const findTier = (sales: number, tiers: Array<{ sales: number; bonus: number; label: string }>) => {
  let achieved: { sales: number; bonus: number; label: string } | null = null;
  for (const t of tiers) {
    if (sales >= t.sales) achieved = t;
  }
  return achieved;
};

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


  const [prices, setPrices] = useState(defaultPrices);

  useEffect(() => {
    const load = () => {
      try {
        const saved = localStorage.getItem(PRICES_KEY);
        if (saved) setPrices({ ...defaultPrices, ...JSON.parse(saved) });
      } catch {}
    };
    load();
    const handler = () => load();
    window.addEventListener('storage', handler);
    const interval = setInterval(load, 3000);
    return () => { window.removeEventListener('storage', handler); clearInterval(interval); };
  }, []);

  const { data: qty = { meat: {}, bone: {}, processed: {} } as { meat: Record<string, number>; bone: Record<string, number>; processed: Record<string, number> } } = useQuery({
    queryKey: ['girls-auto-qty', selectedMonth, selectedYear],
    queryFn: async () => {
      // حدود الشهر بـ UTC لتطابق created_at المخزّن
      const startDate = cairoMonthStartUTC(selectedYear, selectedMonth - 1).toISOString();
      const endDate = cairoMonthStartUTC(selectedYear, selectedMonth).toISOString();
      const empty = () => GIRLS.reduce((acc, g) => { acc[g] = 0; return acc; }, {} as Record<string, number>);
      const result = { meat: empty(), bone: empty(), processed: empty() };

      const PAGE_ORDERS = 1000;
      const orders: Array<{ id: string; moderator: string | null; created_by: string | null }> = [];
      let offset = 0;
      while (true) {
        const { data: chunk, error } = await supabase
          .from('orders')
          .select('id, moderator, created_by')
          .eq('status', 'delivered')
          .gte('created_at', startDate)
          .lt('created_at', endDate)
          .range(offset, offset + PAGE_ORDERS - 1);
        if (error) throw error;
        if (!chunk || chunk.length === 0) break;
        orders.push(...chunk);
        if (chunk.length < PAGE_ORDERS) break;
        offset += PAGE_ORDERS;
      }
      if (orders.length === 0) return result;

      const userIds = Array.from(new Set(orders.map(o => o.created_by).filter(Boolean))) as string[];
      let profileMap = new Map<string, string>();
      if (userIds.length > 0) {
        const { data: profiles } = await supabase.from('profile_directory').select('id, full_name').in('id', userIds);
        profileMap = new Map((profiles || []).map(p => [p.id, p.full_name]));
      }

      const orderToGirl = new Map<string, Girl>();
      orders.forEach(o => {
        const modName = o.moderator || '';
        const creatorName = o.created_by ? (profileMap.get(o.created_by) || '') : '';
        const girl = GIRLS.find(g => matches(modName, g) || matches(creatorName, g));
        if (girl) orderToGirl.set(o.id, girl);
      });

      const orderIds = Array.from(orderToGirl.keys());
      if (orderIds.length === 0) return result;

      // Fetch order_items in chunks (orderIds chunk + paginated rows) to avoid 1000 row limit
      const ID_CHUNK = 200;
      const PAGE = 1000;
      const allItems: Array<{ order_id: string; product_name: string | null; quantity: number | null }> = [];
      for (let i = 0; i < orderIds.length; i += ID_CHUNK) {
        const chunk = orderIds.slice(i, i + ID_CHUNK);
        let from = 0;
        while (true) {
          const { data: items, error: itemsError } = await supabase
            .from('order_items')
            .select('order_id, product_name, quantity')
            .in('order_id', chunk)
            .range(from, from + PAGE - 1);
          if (itemsError) throw itemsError;
          if (!items || items.length === 0) break;
          allItems.push(...items);
          if (items.length < PAGE) break;
          from += PAGE;
        }
      }

      allItems.forEach(item => {
        const girl = orderToGirl.get(item.order_id);
        if (!girl) return;
        const pname = normalize(item.product_name || '');
        const q = Number(item.quantity) || 0;
        if (BONE_MEAT_KEYWORDS.some(k => pname.includes(normalize(k)))) { result.bone[girl] += q; return; }
        if (PROCESSED_KEYWORDS.some(k => pname.includes(normalize(k)))) { result.processed[girl] += q; return; }
        if (MEAT_KEYWORDS.some(k => pname.includes(normalize(k)))) { result.meat[girl] += q; }
      });
      return result;
    },
    refetchInterval: 60000,
  });

  // Chick orders count per girl
  const { data: chickQtyByGirl = {} as Record<string, number> } = useQuery({
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
        const girl = GIRLS.find(g => matches(name, g));
        if (girl) empty[girl] += Number(r.chick_count) || 0;
      });
      return empty;
    },
    refetchInterval: 60000,
  });


  useEffect(() => {
    const channel = supabase
      .channel('moderator-payroll-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        queryClient.invalidateQueries({ queryKey: ['girls-auto-qty'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, () => {
        queryClient.invalidateQueries({ queryKey: ['girls-auto-qty'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chick_orders' }, () => {
        queryClient.invalidateQueries({ queryKey: ['girls-chick-qty'] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  const { data: overrides = [] } = useQuery({
    queryKey: ['payroll-overrides', selectedMonth, selectedYear],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payroll_bonus_overrides')
        .select('*')
        .eq('month', selectedMonth)
        .eq('year', selectedYear);
      if (error) throw error;
      return data as Array<{ moderator_name: string; processed_bonus: number | null; meat_bonus: number | null; bone_bonus: number | null; processed_rate: number | null; meat_rate: number | null; bone_rate: number | null }>;
    },
  });

  // Tiers loaded from target_bonus_settings so editing the targets table reflects here automatically.
  const { data: tierSettings = [] } = useQuery({
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

  // ===== اعتماد قبض الشهر (Closures) =====
  const { data: closures = [] } = useQuery({
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
  const { data: carried = [] } = useQuery({
    queryKey: ['payroll-carried-orders', selectedMonth, selectedYear, closures.map(c => `${c.year}-${c.month}-${c.approved_at}`).join('|')],
    enabled: closures.length > 0,
    queryFn: async () => {
      const idxOf = (y: number, m: number) => y * 12 + (m - 1);
      const selIdx = idxOf(selectedYear, selectedMonth);
      const closureAtIdx = (i: number) => {
        const y = Math.floor(i / 12);
        const m = (i % 12) + 1;
        return closures.find(c => c.year === y && c.month === m) || null;
      };
      // الشهر الذي يُصرف فيه بونص الأوردر المرحّل: أول شهر تالٍ لم يكن معتمداً وقت التسليم
      const payingIdx = (originIdx: number, deliveredAt: string) => {
        for (let i = originIdx + 1; i <= selIdx; i++) {
          const cl = closureAtIdx(i);
          if (!cl || new Date(cl.approved_at).getTime() > new Date(deliveredAt).getTime()) return i;
        }
        return -1;
      };

      const out: Array<{
        orderId: string; orderNumber: string; girl: Girl; deliveredAt: string;
        originYear: number; originMonth: number; closureApprovedAt: string;
      }> = [];

      for (const cl of closures) {
        const originIdx = idxOf(cl.year, cl.month);
        if (originIdx >= selIdx) continue;
        const start = cairoMonthStartUTC(cl.year, cl.month - 1).toISOString();
        const end = cairoMonthStartUTC(cl.year, cl.month).toISOString();
        const { data: rowsO, error } = await supabase
          .from('orders')
          .select('id, order_number, moderator, created_by, delivered_at')
          .eq('status', 'delivered')
          .gte('created_at', start)
          .lt('created_at', end)
          .gt('delivered_at', cl.approved_at);
        if (error) throw error;
        const candidates = (rowsO || []).filter(o => o.delivered_at && payingIdx(originIdx, o.delivered_at) === selIdx);
        if (candidates.length === 0) continue;

        const userIds = Array.from(new Set(candidates.map(o => o.created_by).filter(Boolean))) as string[];
        let profileMap = new Map<string, string>();
        if (userIds.length > 0) {
          const { data: profiles } = await supabase.from('profile_directory').select('id, full_name').in('id', userIds);
          profileMap = new Map((profiles || []).map(p => [p.id, p.full_name]));
        }
        candidates.forEach(o => {
          const modName = o.moderator || '';
          const creatorName = o.created_by ? (profileMap.get(o.created_by) || '') : '';
          const girl = GIRLS.find(g => matches(modName, g) || matches(creatorName, g));
          if (!girl) return;
          out.push({
            orderId: o.id,
            orderNumber: o.order_number || '',
            girl,
            deliveredAt: o.delivered_at as string,
            originYear: cl.year,
            originMonth: cl.month,
            closureApprovedAt: cl.approved_at,
          });
        });
      }

      if (out.length === 0) return [] as Array<typeof out[number] & { meatKg: number; boneKg: number; procKg: number }>;

      const byId = new Map(out.map(o => [o.orderId, { ...o, meatKg: 0, boneKg: 0, procKg: 0 }]));
      const ids = Array.from(byId.keys());
      const ID_CHUNK = 200;
      for (let i = 0; i < ids.length; i += ID_CHUNK) {
        const chunk = ids.slice(i, i + ID_CHUNK);
        const { data: items, error } = await supabase
          .from('order_items')
          .select('order_id, product_name, quantity')
          .in('order_id', chunk);
        if (error) throw error;
        (items || []).forEach(it => {
          const rec = byId.get(it.order_id);
          if (!rec) return;
          const pname = normalize(it.product_name || '');
          const q = Number(it.quantity) || 0;
          if (BONE_MEAT_KEYWORDS.some(k => pname.includes(normalize(k)))) { rec.boneKg += q; return; }
          if (PROCESSED_KEYWORDS.some(k => pname.includes(normalize(k)))) { rec.procKg += q; return; }
          if (MEAT_KEYWORDS.some(k => pname.includes(normalize(k)))) { rec.meatKg += q; }
        });
      }
      return Array.from(byId.values());
    },
  });


  const overrideMutation = useMutation({
    mutationFn: async ({ girl, field, value }: { girl: Girl; field: 'processed_bonus' | 'meat_bonus' | 'bone_bonus' | 'processed_rate' | 'meat_rate' | 'bone_rate'; value: number | null }) => {
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

  const baseRows = useMemo(() => {

    return GIRLS.map(g => {
      const meatKg = qty.meat[g] || 0;
      const boneKg = qty.bone[g] || 0;
      const procKg = qty.processed[g] || 0;
      const chickCount = chickQtyByGirl[g] || 0;
      const meatSales = meatKg * prices.meat_price + boneKg * prices.bone_meat_price;
      const procSales = procKg * prices.processed_price;
      const procTier = findTier(procSales, PROCESSED_TIERS);
      const meatTier = findTier(meatSales, MEAT_TIERS);
      const ov = overrides.find(o => o.moderator_name === g);
      const tierProcRate = procTier ? procTier.bonus : 0;
      const tierMeatRate = meatTier ? meatTier.bonus : 0;
      const procRate = ov?.processed_rate != null ? Number(ov.processed_rate) : tierProcRate;
      const meatRate = ov?.meat_rate != null ? Number(ov.meat_rate) : tierMeatRate;
      const boneRate = ov?.bone_rate != null ? Number(ov.bone_rate) : (meatTier ? BONE_BONUS_PER_KG : 0);
      const procRateOverridden = ov?.processed_rate != null;
      const meatRateOverridden = ov?.meat_rate != null;
      const boneRateOverridden = ov?.bone_rate != null;
      const calcProcBonus = procRate * procKg;
      const calcMeatBonus = meatTier ? meatRate * meatKg : 0;
      const calcBoneBonus = meatTier ? boneRate * boneKg : 0;
      const procBonus = ov?.processed_bonus != null ? Number(ov.processed_bonus) : calcProcBonus;
      const meatBonus = ov?.meat_bonus != null ? Number(ov.meat_bonus) : calcMeatBonus;
      const boneBonus = ov?.bone_bonus != null ? Number(ov.bone_bonus) : calcBoneBonus;
      const chickBonus = chickCount * chickBonusRate;
      const procOverridden = ov?.processed_bonus != null;
      const meatOverridden = ov?.meat_bonus != null;
      const boneOverridden = ov?.bone_bonus != null;
      const base = BASE_SALARY[g];
      return {
        girl: g, base, meatKg, boneKg, procKg, chickCount,
        meatSales, procSales, procTier, meatTier,
        procRate, procRateOverridden,
        meatRate, meatRateOverridden,
        boneRate, boneRateOverridden,
        procBonus, meatBonus, boneBonus, chickBonus,
        procOverridden, meatOverridden, boneOverridden,
        total: base + procBonus + meatBonus + boneBonus + chickBonus,
      };
    });
  }, [qty, prices, overrides, PROCESSED_TIERS, MEAT_TIERS, chickQtyByGirl, chickBonusRate]);

  // بونص الشهر السابق (الأوردرات المرحّلة) بأسعار تارجت الشهر الحالي
  const carryByGirl = useMemo(() => {
    const map = new Map<string, { bonus: number; details: CarriedDetail[] }>();
    GIRLS.forEach(g => map.set(g, { bonus: 0, details: [] }));
    carried.forEach((c: any) => {
      const row = baseRows.find(r => r.girl === c.girl);
      if (!row) return;
      const entry = map.get(c.girl)!;
      const originLabel = `${months.find(m => m.value === c.originMonth)?.label} ${c.originYear}`;
      const push = (category: CarriedDetail['category'], quantity: number, rate: number, tierLabel: string) => {
        if (!quantity) return;
        const bonus = quantity * rate;
        entry.details.push({
          orderId: c.orderId, orderNumber: c.orderNumber, girl: c.girl, originLabel,
          closureApprovedAt: c.closureApprovedAt, deliveredAt: c.deliveredAt,
          category, quantity, tierLabel, rate, bonus,
        });
        entry.bonus += bonus;
      };
      push('مصنعات', c.procKg, row.procTier ? row.procRate : 0, row.procTier ? `التارجت ${row.procTier.label}` : 'لم يتحقق');
      push('لحوم', c.meatKg, row.meatTier ? row.meatRate : 0, row.meatTier ? `التارجت ${row.meatTier.label}` : 'لم يتحقق');
      push('لحوم بالعظم', c.boneKg, row.meatTier ? row.boneRate : 0, row.meatTier ? `التارجت ${row.meatTier.label}` : 'لم يتحقق');
    });
    return map;
  }, [carried, baseRows]);

  const liveRows = useMemo(() => baseRows.map(r => {
    const prevBonus = carryByGirl.get(r.girl)?.bonus || 0;
    return { ...r, prevBonus, total: r.total + prevBonus };
  }), [baseRows, carryByGirl]);

  // بعد الاعتماد: تُعرض النسخة المثبتة (Snapshot) بدل الحساب المباشر
  const rows = useMemo(() => {
    if (!selectedClosure || snapshots.length === 0) return liveRows;
    return liveRows.map(r => {
      const s = snapshots.find((x: any) => x.moderator_name === r.girl);
      if (!s) return r;
      return {
        ...r,
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
        processed_tier_label: r.procTier?.label ?? null,
        processed_qty: r.procKg,
        processed_rate: r.procRate,
        processed_bonus: r.procBonus,
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
    if (!canEdit) {
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
        <div id="moderator-payroll-table">
        <Table className="w-full border text-xs md:text-sm">
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="text-right font-bold border">البيان</TableHead>
              {GIRLS.map(g => (
                <TableHead key={g} className="text-center font-bold border text-primary">{g === 'منال' ? 'هاجر' : g}</TableHead>
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
            <TableRow>
              <TableCell className="font-bold border bg-muted/30">كمية المصنعات (كجم)</TableCell>
              {rows.map(r => <TableCell key={r.girl} className="text-center border">{fmt(r.procKg)}</TableCell>)}
            </TableRow>
            <TableRow>
              <TableCell className="font-bold border bg-muted/30">بونص المصنعات لكل كجم (ج)</TableCell>
              {rows.map(r => <TableCell key={r.girl} className="text-center border">{renderBonusCell(r.girl, r.procRate, 'processed_rate', r.procRateOverridden)}</TableCell>)}
            </TableRow>
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
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          * المبيعات تُحسب من الأوردرات المسلَّمة. الأسعار المستخدمة (لحوم/بالعظم/مصنعات) تتبع الأسعار في "جدول مبيعات المسوقات".<br />
          * بونص اللحوم = (بونص التارجت × كجم اللحوم) + ({BONE_BONUS_PER_KG} ج × كجم اللحوم بالعظم).
        </p>
      </CardContent>
    </Card>
  );
};

export default ModeratorPayrollTable;
