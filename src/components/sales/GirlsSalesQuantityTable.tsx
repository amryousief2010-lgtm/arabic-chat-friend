import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ClipboardList } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';

const validateNumber = (value: number, label: string): number | null => {
  if (Number.isNaN(value)) {
    toast.error(`قيمة غير صالحة لـ ${label}`);
    return null;
  }
  if (value < 0) {
    toast.error(`لا يمكن إدخال قيمة سالبة لـ ${label}`);
    return null;
  }
  return value;
};

const GIRLS = ['اية', 'نورا', 'سارة', 'منال'];

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

const currentYear = new Date().getFullYear();
const currentMonth = new Date().getMonth() + 1;

const normalize = (s: string) => (s || '').replace(/[إأآا]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
const matches = (name: string, target: string) => normalize(name.trim()).includes(normalize(target));

interface GirlData {
  bone_meat_qty: number;
  processed_qty: number;
}

interface Prices {
  meat_price: number;
  bone_meat_price: number;
  processed_price: number;
}

const STORAGE_KEY = 'girls-sales-quantity-table-v4';
const PRICES_KEY = 'girls-sales-prices-v2';

const emptyData = (): Record<string, GirlData> =>
  GIRLS.reduce((acc, g) => {
    acc[g] = { bone_meat_qty: 0, processed_qty: 0 };
    return acc;
  }, {} as Record<string, GirlData>);

interface Props {
  month?: number;
  year?: number;
}

const GirlsSalesQuantityTable = ({ month, year }: Props = {}) => {
  const queryClient = useQueryClient();
  const [internalMonth, setInternalMonth] = useState(currentMonth);
  const [internalYear, setInternalYear] = useState(currentYear);
  const isControlled = month !== undefined && year !== undefined;
  const selectedMonth = isControlled ? (month as number) : internalMonth;
  const selectedYear = isControlled ? (year as number) : internalYear;
  const setSelectedMonth = setInternalMonth;
  const setSelectedYear = setInternalYear;

  const [data, setData] = useState<Record<string, GirlData>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        const merged = emptyData();
        GIRLS.forEach(g => { merged[g] = { ...merged[g], ...(parsed[g] || {}) }; });
        return merged;
      }
    } catch {}
    return emptyData();
  });

  const [prices, setPrices] = useState<Prices>(() => {
    try {
      const saved = localStorage.getItem(PRICES_KEY);
      if (saved) return { meat_price: 390, bone_meat_price: 350, processed_price: 160, ...JSON.parse(saved) };
    } catch {}
    return { meat_price: 390, bone_meat_price: 350, processed_price: 160 };
  });

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch {}
  }, [data]);

  useEffect(() => {
    try { localStorage.setItem(PRICES_KEY, JSON.stringify(prices)); } catch {}
  }, [prices]);

  // Fetch delivered orders + items for the selected month
  const { data: autoQtyByGirl = { meat: {}, bone: {}, processed: {} } } = useQuery({
    queryKey: ['girls-auto-qty', selectedMonth, selectedYear],
    queryFn: async () => {
      // حدود الشهر بـ UTC لتطابق created_at المخزّن
      const startDate = new Date(Date.UTC(selectedYear, selectedMonth - 1, 1, 0, 0, 0, 0)).toISOString();
      const endDate = new Date(Date.UTC(selectedYear, selectedMonth, 1, 0, 0, 0, 0)).toISOString();

      const empty = () => GIRLS.reduce((acc, g) => { acc[g] = 0; return acc; }, {} as Record<string, number>);
      const result = { meat: empty(), bone: empty(), processed: empty() };

      const PAGE = 1000;
      const orders: Array<{ id: string; moderator: string | null; created_by: string | null }> = [];
      let offset = 0;
      while (true) {
        const { data: chunk, error } = await supabase
          .from('orders')
          .select('id, moderator, created_by')
          .eq('status', 'delivered')
          .gte('created_at', startDate)
          .lt('created_at', endDate)
          .range(offset, offset + PAGE - 1);
        if (error) throw error;
        if (!chunk || chunk.length === 0) break;
        orders.push(...chunk);
        if (chunk.length < PAGE) break;
        offset += PAGE;
      }
      if (orders.length === 0) return result;

      const userIds = Array.from(new Set(orders.map(o => o.created_by).filter(Boolean))) as string[];
      let profileMap = new Map<string, string>();
      if (userIds.length > 0) {
        const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', userIds);
        profileMap = new Map((profiles || []).map(p => [p.id, p.full_name]));
      }

      const orderToGirl = new Map<string, string>();
      orders.forEach(o => {
        const modName = o.moderator || '';
        const creatorName = o.created_by ? (profileMap.get(o.created_by) || '') : '';
        const girl = GIRLS.find(g => matches(modName, g) || matches(creatorName, g));
        if (girl) orderToGirl.set(o.id, girl);
      });

      const orderIds = Array.from(orderToGirl.keys());
      if (orderIds.length === 0) return result;

      const ID_CHUNK = 200;
      const allItems: Array<{ order_id: string; product_name: string | null; quantity: number | null }> = [];
      for (let i = 0; i < orderIds.length; i += ID_CHUNK) {
        const idsChunk = orderIds.slice(i, i + ID_CHUNK);
        let from = 0;
        while (true) {
          const { data: items, error: itemsError } = await supabase
            .from('order_items')
            .select('order_id, product_name, quantity')
            .in('order_id', idsChunk)
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
        const qty = Number(item.quantity) || 0;
        const isBone = BONE_MEAT_KEYWORDS.some(k => pname.includes(normalize(k)));
        if (isBone) { result.bone[girl] += qty; return; }
        const isProcessed = PROCESSED_KEYWORDS.some(k => pname.includes(normalize(k)));
        if (isProcessed) { result.processed[girl] += qty; return; }
        const isMeat = MEAT_KEYWORDS.some(k => pname.includes(normalize(k)));
        if (isMeat) result.meat[girl] += qty;
      });
      return result;
    },
    refetchInterval: 60000,
  });

  const meatQtyByGirl = autoQtyByGirl.meat;
  const boneMeatQtyByGirl = autoQtyByGirl.bone;
  const processedQtyByGirl = autoQtyByGirl.processed;


  // Realtime: refetch on order/items changes
  useEffect(() => {
    const channel = supabase
      .channel('girls-auto-qty-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        queryClient.invalidateQueries({ queryKey: ['girls-auto-qty'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, () => {
        queryClient.invalidateQueries({ queryKey: ['girls-auto-qty'] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  const updateQty = (girl: string, field: keyof GirlData, value: number, label: string) => {
    const valid = validateNumber(value, label);
    if (valid === null) return;
    setData(prev => ({ ...prev, [girl]: { ...prev[girl], [field]: valid } }));
  };

  const updatePrice = (field: keyof Prices, value: number, label: string) => {
    const valid = validateNumber(value, label);
    if (valid === null) return;
    setPrices(p => ({ ...p, [field]: valid }));
  };

  const totals = useMemo(() => {
    return GIRLS.reduce((acc, g) => {
      const meatQty = meatQtyByGirl[g] || 0;
      const boneQty = boneMeatQtyByGirl[g] || 0;
      const procQty = processedQtyByGirl[g] || 0;
      acc[g] = {
        meat_qty: meatQty,
        meat_total: meatQty * prices.meat_price,
        bone_meat_qty: boneQty,
        bone_meat_total: boneQty * prices.bone_meat_price,
        processed_qty: procQty,
        processed_total: procQty * prices.processed_price,
      };
      return acc;
    }, {} as Record<string, { meat_qty: number; meat_total: number; bone_meat_qty: number; bone_meat_total: number; processed_qty: number; processed_total: number }>);
  }, [prices, meatQtyByGirl, boneMeatQtyByGirl, processedQtyByGirl]);

  const labelMap: Record<keyof GirlData, string> = {
    bone_meat_qty: 'كمية اللحوم بالعظم',
    processed_qty: 'كمية المصنعات',
  };

  const qtyInput = (girl: string, field: keyof GirlData) => (
    <Input
      type="number"
      min="0"
      value={data[girl][field] || ''}
      onChange={(e) => updateQty(girl, field, Number(e.target.value), `${labelMap[field]} - ${girl}`)}
      className="w-24 text-center mx-auto"
    />
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-primary" />
            جدول مبيعات المسوقات - {months.find(m => m.value === selectedMonth)?.label} {selectedYear}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Select
              value={selectedMonth.toString()}
              onValueChange={(v) => setSelectedMonth(Number(v))}
              disabled={isControlled}
            >
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                {months.map(m => <SelectItem key={m.value} value={m.value.toString()}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select
              value={selectedYear.toString()}
              onValueChange={(v) => setSelectedYear(Number(v))}
              disabled={isControlled}
            >
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
      <CardContent className="space-y-4">
        {/* Price controls */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 rounded-lg bg-muted/40 border">
          <div className="space-y-2">
            <Label>سعر كيلو اللحوم (ج.م)</Label>
            <Input
              type="number" min="0"
              value={prices.meat_price || ''}
              onChange={(e) => updatePrice('meat_price', Number(e.target.value), 'سعر كيلو اللحوم')}
            />
          </div>
          <div className="space-y-2">
            <Label>سعر كيلو اللحوم بالعظم (ج.م)</Label>
            <Input
              type="number" min="0"
              value={prices.bone_meat_price || ''}
              onChange={(e) => updatePrice('bone_meat_price', Number(e.target.value), 'سعر كيلو اللحوم بالعظم')}
            />
          </div>
          <div className="space-y-2">
            <Label>سعر كيلو المصنعات (ج.م)</Label>
            <Input
              type="number" min="0"
              value={prices.processed_price || ''}
              onChange={(e) => updatePrice('processed_price', Number(e.target.value), 'سعر كيلو المصنعات')}
            />
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          جميع الكميات تُحسب تلقائياً من الأوردرات المسلَّمة. (اللحوم: قطع، استيك، موزة، فراشة، قطعية الدبوس، تربيانكو، اسكالوب، رول، كباب، طبق — اللحوم بالعظم: دبوس 6 كيلو، فخدة نعام، نعامة صندوق — المصنعات: شاورما، شيش، كفتة، سجق، برجر، طرب، حواشي، مفروم، كفتة أرز، برجر بالجبنة).
        </p>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-[hsl(140_60%_85%)] hover:bg-[hsl(140_60%_80%)]">
                <TableHead className="text-right font-bold text-[hsl(140_70%_25%)]">البيان</TableHead>
                {GIRLS.map((g) => (
                  <TableHead key={g} className="text-center font-bold text-[hsl(140_70%_25%)]">{g}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium">كمية مبيعات اللحوم (كجم)</TableCell>
                {GIRLS.map(g => (
                  <TableCell key={g} className="text-center font-bold">
                    {totals[g].meat_qty.toLocaleString()}
                  </TableCell>
                ))}
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">سعر كيلو اللحوم</TableCell>
                {GIRLS.map(g => <TableCell key={g} className="text-center">{prices.meat_price.toLocaleString()}</TableCell>)}
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">مبلغ اللحوم (ج.م)</TableCell>
                {GIRLS.map(g => (
                  <TableCell key={g} className="text-center font-bold text-primary">
                    {totals[g].meat_total.toLocaleString()}
                  </TableCell>
                ))}
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">كمية اللحوم بالعظم (كجم)</TableCell>
                {GIRLS.map(g => (
                  <TableCell key={g} className="text-center font-bold">
                    {totals[g].bone_meat_qty.toLocaleString()}
                  </TableCell>
                ))}
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">سعر كيلو اللحوم بالعظم</TableCell>
                {GIRLS.map(g => <TableCell key={g} className="text-center">{prices.bone_meat_price.toLocaleString()}</TableCell>)}
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">مبلغ اللحوم بالعظم (ج.م)</TableCell>
                {GIRLS.map(g => (
                  <TableCell key={g} className="text-center font-bold text-primary">
                    {totals[g].bone_meat_total.toLocaleString()}
                  </TableCell>
                ))}
              </TableRow>
              <TableRow className="bg-primary/15 hover:bg-primary/20">
                <TableCell className="font-bold text-primary">مبلغ اللحوم الكلي (ج.م)</TableCell>
                {GIRLS.map(g => (
                  <TableCell key={g} className="text-center font-bold text-primary">
                    {(totals[g].meat_total + totals[g].bone_meat_total).toLocaleString()}
                  </TableCell>
                ))}
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">كمية المصنعات (كجم)</TableCell>
                {GIRLS.map(g => (
                  <TableCell key={g} className="text-center font-bold">
                    {totals[g].processed_qty.toLocaleString()}
                  </TableCell>
                ))}
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">سعر كيلو المصنعات</TableCell>
                {GIRLS.map(g => <TableCell key={g} className="text-center">{prices.processed_price.toLocaleString()}</TableCell>)}
              </TableRow>
              <TableRow className="bg-primary/15 hover:bg-primary/20">
                <TableCell className="font-bold text-primary">مبلغ المصنعات (ج.م)</TableCell>
                {GIRLS.map(g => (
                  <TableCell key={g} className="text-center font-bold text-primary">
                    {totals[g].processed_total.toLocaleString()}
                  </TableCell>
                ))}
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
};

export default GirlsSalesQuantityTable;
