import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Wallet } from 'lucide-react';

const GIRLS = ['اية', 'نورا', 'سارة', 'منال'] as const;
type Girl = typeof GIRLS[number];

const BASE_SALARY: Record<Girl, number> = {
  اية: 3000,
  نورا: 2500,
  سارة: 2500,
  منال: 2500,
};

// Tier ladders (sales threshold -> bonus per kg)
const PROCESSED_TIERS: Array<{ sales: number; bonus: number; label: string }> = [
  { sales: 50000, bonus: 5, label: 'الأول' },
  { sales: 60000, bonus: 6, label: 'الثاني' },
  { sales: 80000, bonus: 8, label: 'الثالث' },
  { sales: 100000, bonus: 10, label: 'الرابع' },
  { sales: 125000, bonus: 12, label: 'الخامس' },
  { sales: 150000, bonus: 15, label: 'السادس' },
  { sales: 185000, bonus: 18, label: 'السابع' },
];
const MEAT_TIERS: Array<{ sales: number; bonus: number; label: string }> = [
  { sales: 100000, bonus: 5, label: 'الأول' },
  { sales: 125000, bonus: 5, label: 'الثاني' },
  { sales: 200000, bonus: 5, label: 'الثالث' },
  { sales: 300000, bonus: 7, label: 'الرابع' },
];
const BONE_BONUS_PER_KG = 3.5;

const MEAT_KEYWORDS = ['قطع', 'استيك', 'موزة', 'فراشة', 'قطعية', 'تربيانكو', 'اسكالوب', 'رول', 'كباب', 'طبق'];
const BONE_MEAT_KEYWORDS = ['دبوس 6', 'فخده', 'فخذه', 'فخدة', 'نعامه صندوق', 'نعامة صندوق'];
const PROCESSED_KEYWORDS = ['شاورما', 'شيش', 'كفته', 'كفتة', 'سجق', 'برجر', 'طرب', 'حواشي', 'حواشى', 'مفروم'];

const months = [
  { value: 1, label: 'يناير' }, { value: 2, label: 'فبراير' }, { value: 3, label: 'مارس' },
  { value: 4, label: 'أبريل' }, { value: 5, label: 'مايو' }, { value: 6, label: 'يونيو' },
  { value: 7, label: 'يوليو' }, { value: 8, label: 'أغسطس' }, { value: 9, label: 'سبتمبر' },
  { value: 10, label: 'أكتوبر' }, { value: 11, label: 'نوفمبر' }, { value: 12, label: 'ديسمبر' },
];

const currentYear = new Date().getFullYear();
const currentMonth = new Date().getMonth() + 1;

const normalize = (s: string) => (s || '').replace(/[إأآا]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
const matches = (name: string, target: string) => normalize(name.trim()).includes(normalize(target));

const PRICES_KEY = 'girls-sales-prices-v2';
const defaultPrices = { meat_price: 390, bone_meat_price: 350, processed_price: 160 };

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

const findTier = (sales: number, tiers: typeof PROCESSED_TIERS) => {
  let achieved: typeof tiers[number] | null = null;
  for (const t of tiers) {
    if (sales >= t.sales) achieved = t;
  }
  return achieved;
};

const ModeratorPayrollTable = () => {
  const queryClient = useQueryClient();
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [selectedYear, setSelectedYear] = useState(currentYear);

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
      const startDate = new Date(selectedYear, selectedMonth - 1, 1).toISOString();
      const endDate = new Date(selectedYear, selectedMonth, 0, 23, 59, 59).toISOString();
      const empty = () => GIRLS.reduce((acc, g) => { acc[g] = 0; return acc; }, {} as Record<string, number>);
      const result = { meat: empty(), bone: empty(), processed: empty() };

      const { data: orders, error } = await supabase
        .from('orders')
        .select('id, moderator, created_by')
        .eq('status', 'delivered')
        .gte('created_at', startDate)
        .lte('created_at', endDate);
      if (error) throw error;
      if (!orders || orders.length === 0) return result;

      const userIds = Array.from(new Set(orders.map(o => o.created_by).filter(Boolean))) as string[];
      let profileMap = new Map<string, string>();
      if (userIds.length > 0) {
        const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', userIds);
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

      const { data: items, error: itemsError } = await supabase
        .from('order_items')
        .select('order_id, product_name, quantity')
        .in('order_id', orderIds);
      if (itemsError) throw itemsError;

      (items || []).forEach(item => {
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

  useEffect(() => {
    const channel = supabase
      .channel('moderator-payroll-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        queryClient.invalidateQueries({ queryKey: ['girls-auto-qty'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, () => {
        queryClient.invalidateQueries({ queryKey: ['girls-auto-qty'] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  const rows = useMemo(() => {
    return GIRLS.map(g => {
      const meatKg = qty.meat[g] || 0;
      const boneKg = qty.bone[g] || 0;
      const procKg = qty.processed[g] || 0;
      const meatSales = meatKg * prices.meat_price + boneKg * prices.bone_meat_price;
      const procSales = procKg * prices.processed_price;
      const procTier = findTier(procSales, PROCESSED_TIERS);
      const meatTier = findTier(meatSales, MEAT_TIERS);
      const procBonus = procTier ? procTier.bonus * procKg : 0;
      const meatBonus = meatTier ? (meatTier.bonus * meatKg + BONE_BONUS_PER_KG * boneKg) : 0;
      const base = BASE_SALARY[g];
      return {
        girl: g, base, meatKg, boneKg, procKg,
        meatSales, procSales, procTier, meatTier,
        procBonus, meatBonus,
        total: base + procBonus + meatBonus,
      };
    });
  }, [qty, prices]);

  return (
    <Card className="glass-card">
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-primary" />
            جدول قبض الموديريتور - {months.find(m => m.value === selectedMonth)?.label} {selectedYear}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Select value={selectedMonth.toString()} onValueChange={(v) => setSelectedMonth(Number(v))}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                {months.map(m => <SelectItem key={m.value} value={m.value.toString()}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={selectedYear.toString()} onValueChange={(v) => setSelectedYear(Number(v))}>
              <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[currentYear - 1, currentYear, currentYear + 1].map(y => (
                  <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table className="min-w-[800px] border">
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="text-right font-bold border">البيان</TableHead>
              {GIRLS.map(g => (
                <TableHead key={g} className="text-center font-bold border text-primary">{g}</TableHead>
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
              <TableCell className="font-bold border bg-primary/10">بونص المصنعات (ج.م)</TableCell>
              {rows.map(r => <TableCell key={r.girl} className="text-center border font-bold text-primary">{fmt(r.procBonus)}</TableCell>)}
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
              <TableCell className="font-bold border bg-muted/30">كمية اللحوم (كجم) / بالعظم (كجم)</TableCell>
              {rows.map(r => <TableCell key={r.girl} className="text-center border">{fmt(r.meatKg)} / {fmt(r.boneKg)}</TableCell>)}
            </TableRow>
            <TableRow>
              <TableCell className="font-bold border bg-primary/10">بونص اللحوم (ج.م)</TableCell>
              {rows.map(r => <TableCell key={r.girl} className="text-center border font-bold text-primary">{fmt(r.meatBonus)}</TableCell>)}
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
          * المبيعات تُحسب من الأوردرات المسلَّمة. الأسعار المستخدمة (لحوم/بالعظم/مصنعات) تتبع الأسعار في "جدول مبيعات المسوقات".<br />
          * بونص اللحوم = (بونص التارجت × كجم اللحوم) + ({BONE_BONUS_PER_KG} ج × كجم اللحوم بالعظم).
        </p>
      </CardContent>
    </Card>
  );
};

export default ModeratorPayrollTable;
