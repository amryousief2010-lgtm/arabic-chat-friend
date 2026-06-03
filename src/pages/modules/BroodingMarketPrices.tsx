import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { TrendingUp, TrendingDown, DollarSign, Plus, Trash2 } from "lucide-react";

export type MarketPrice = {
  id: string;
  age_from_days: number;
  age_to_days: number | null;
  age_label: string;
  sale_method: 'per_bird' | 'live_weight';
  market_price_per_bird: number | null;
  live_weight_price_per_kg: number | null;
  active: boolean;
  sort_order: number;
};

const fmtMoney = (n: number) => new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(n || 0);
const fmt = (n: number) => new Intl.NumberFormat('ar-EG').format(Math.round(n || 0));

export const useMarketPrices = () => {
  const [prices, setPrices] = useState<MarketPrice[]>([]);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from('brooding_market_prices' as any).select('*').eq('active', true).order('sort_order');
    setPrices((data || []) as any);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);
  return { prices, loading, reload: load };
};

export const findPriceForAge = (prices: MarketPrice[], ageDays: number): MarketPrice | undefined => {
  return prices.find(p =>
    ageDays >= p.age_from_days &&
    (p.age_to_days === null || ageDays <= p.age_to_days)
  );
};

// ===== Dashboard: per-batch market profitability table =====
type BatchLite = {
  id: string;
  batch_number: string;
  current_count: number;
  total_cost: number;
  cost_per_bird: number;
  ageDays: number;
};

export const MarketProfitabilityCard = ({
  batches,
  prices,
  defaultLiveWeightPricePerKg = 180,
}: {
  batches: BatchLite[];
  prices: MarketPrice[];
  defaultLiveWeightPricePerKg?: number;
}) => {
  const openBatches = batches.filter(b => b.current_count > 0);

  const rows = openBatches.map(b => {
    const price = findPriceForAge(prices, b.ageDays);
    const batchTotalCost = (b.cost_per_bird || 0) * b.current_count;
    if (!price) {
      return { batch: b, price: null, expectedValue: 0, profit: 0, profitPct: 0, method: '—' as string };
    }
    if (price.sale_method === 'per_bird') {
      const expectedValue = b.current_count * (price.market_price_per_bird || 0);
      const profit = expectedValue - batchTotalCost;
      const profitPct = batchTotalCost > 0 ? (profit / batchTotalCost) * 100 : 0;
      return {
        batch: b,
        price,
        expectedValue,
        profit,
        profitPct,
        method: `${fmtMoney(price.market_price_per_bird || 0)} / طائر`,
      };
    } else {
      // Live weight - estimate using 90kg average if no weight info yet
      const avgWeight = 90;
      const totalWeight = b.current_count * avgWeight;
      const kgPrice = price.live_weight_price_per_kg || defaultLiveWeightPricePerKg;
      const expectedValue = totalWeight * kgPrice;
      const profit = expectedValue - batchTotalCost;
      const profitPct = batchTotalCost > 0 ? (profit / batchTotalCost) * 100 : 0;
      return {
        batch: b,
        price,
        expectedValue,
        profit,
        profitPct,
        method: `${fmtMoney(kgPrice)} / كجم قائم (متوسط ${avgWeight}كجم)`,
      };
    }
  });

  const totals = rows.reduce(
    (acc, r) => {
      acc.cost += (r.batch.cost_per_bird || 0) * r.batch.current_count;
      acc.market += r.expectedValue;
      acc.profit += r.profit;
      return acc;
    },
    { cost: 0, market: 0, profit: 0 }
  );
  const best = rows.reduce((a, b) => (b.profit > (a?.profit ?? -Infinity) ? b : a), null as typeof rows[0] | null);
  const worst = rows.reduce((a, b) => (b.profit < (a?.profit ?? Infinity) ? b : a), null as typeof rows[0] | null);

  return (
    <Card className="border-emerald-200">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DollarSign className="w-5 h-5 text-emerald-600" />
          ربحية البيع السوقي الحالية
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <SummaryCard label="إجمالي التكلفة الفعلية" value={fmtMoney(totals.cost)} color="slate" />
          <SummaryCard label="إجمالي القيمة السوقية" value={fmtMoney(totals.market)} color="blue" />
          <SummaryCard
            label="إجمالي الربح/الخسارة المتوقعة"
            value={fmtMoney(totals.profit)}
            color={totals.profit >= 0 ? "emerald" : "red"}
            icon={totals.profit >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
          />
          <SummaryCard
            label="نسبة الربح"
            value={`${totals.cost > 0 ? ((totals.profit / totals.cost) * 100).toFixed(1) : '0'}%`}
            color={totals.profit >= 0 ? "emerald" : "red"}
          />
        </div>

        {(best || worst) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            {best && (
              <div className="p-3 rounded-md bg-emerald-50 border border-emerald-200 flex justify-between">
                <span>🏆 أعلى ربح متوقع: <strong>{best.batch.batch_number}</strong></span>
                <strong className="text-emerald-700">{fmtMoney(best.profit)}</strong>
              </div>
            )}
            {worst && worst !== best && (
              <div className="p-3 rounded-md bg-amber-50 border border-amber-200 flex justify-between">
                <span>⚠️ أقل ربح متوقع: <strong>{worst.batch.batch_number}</strong></span>
                <strong className="text-amber-700">{fmtMoney(worst.profit)}</strong>
              </div>
            )}
          </div>
        )}

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الدفعة</TableHead>
                <TableHead>العمر</TableHead>
                <TableHead>العدد</TableHead>
                <TableHead>تكلفة الطائر</TableHead>
                <TableHead>إجمالي التكلفة</TableHead>
                <TableHead>سعر السوق</TableHead>
                <TableHead>قيمة البيع المتوقعة</TableHead>
                <TableHead>ربح/خسارة</TableHead>
                <TableHead>%</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-6">لا توجد دفعات مفتوحة</TableCell></TableRow>
              )}
              {rows.map(r => {
                const totalCost = (r.batch.cost_per_bird || 0) * r.batch.current_count;
                return (
                  <TableRow key={r.batch.id}>
                    <TableCell className="font-medium">{r.batch.batch_number}</TableCell>
                    <TableCell>{r.batch.ageDays} يوم</TableCell>
                    <TableCell>{fmt(r.batch.current_count)}</TableCell>
                    <TableCell>{fmtMoney(r.batch.cost_per_bird)}</TableCell>
                    <TableCell>{fmtMoney(totalCost)}</TableCell>
                    <TableCell className="text-xs">{r.method}</TableCell>
                    <TableCell className="font-semibold text-blue-700">{fmtMoney(r.expectedValue)}</TableCell>
                    <TableCell className={r.profit >= 0 ? "font-bold text-emerald-700" : "font-bold text-red-700"}>
                      {fmtMoney(r.profit)}
                    </TableCell>
                    <TableCell className={r.profitPct >= 0 ? "text-emerald-700" : "text-red-700"}>
                      {r.profitPct.toFixed(1)}%
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
};

const SummaryCard = ({ label, value, color, icon }: { label: string; value: string; color: string; icon?: React.ReactNode }) => {
  const cls: Record<string, string> = {
    slate: "from-slate-600 to-slate-800",
    blue: "from-blue-600 to-blue-800",
    emerald: "from-emerald-600 to-emerald-800",
    red: "from-red-600 to-red-800",
  };
  return (
    <div className={`p-3 rounded-lg bg-gradient-to-br ${cls[color] || cls.slate} text-white`}>
      <div className="text-xs opacity-90 flex items-center gap-1">{icon}{label}</div>
      <div className="text-lg font-bold mt-1">{value}</div>
    </div>
  );
};

// ===== Settings Tab: Market Prices editor (GM/EM only) =====
export const MarketPricesTab = ({ canEdit }: { canEdit: boolean }) => {
  const { prices: _activePrices, reload } = useMarketPrices();
  const [allPrices, setAllPrices] = useState<MarketPrice[]>([]);
  const [saving, setSaving] = useState(false);

  const loadAll = async () => {
    const { data } = await supabase.from('brooding_market_prices' as any).select('*').order('sort_order');
    setAllPrices((data || []) as any);
  };
  useEffect(() => { loadAll(); }, []);

  const update = (id: string, patch: Partial<MarketPrice>) => {
    setAllPrices(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p));
  };

  const saveOne = async (p: MarketPrice) => {
    setSaving(true);
    const { error } = await supabase.from('brooding_market_prices' as any).update({
      age_from_days: p.age_from_days,
      age_to_days: p.age_to_days,
      age_label: p.age_label,
      sale_method: p.sale_method,
      market_price_per_bird: p.market_price_per_bird,
      live_weight_price_per_kg: p.live_weight_price_per_kg,
      active: p.active,
      sort_order: p.sort_order,
    }).eq('id', p.id);
    setSaving(false);
    if (error) toast.error(error.message);
    else { toast.success("تم حفظ السعر"); reload(); }
  };

  const addRow = async () => {
    const maxSort = Math.max(0, ...allPrices.map(p => p.sort_order || 0));
    const { error } = await supabase.from('brooding_market_prices' as any).insert({
      age_from_days: 0, age_to_days: 0, age_label: 'مرحلة جديدة',
      sale_method: 'per_bird', market_price_per_bird: 0, active: true,
      sort_order: maxSort + 10,
    });
    if (error) toast.error(error.message);
    else { toast.success("تم الإضافة"); loadAll(); reload(); }
  };

  const removeRow = async (id: string) => {
    if (!confirm("حذف السعر؟")) return;
    const { error } = await supabase.from('brooding_market_prices' as any).delete().eq('id', id);
    if (error) toast.error(error.message);
    else { toast.success("تم الحذف"); loadAll(); reload(); }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>أسعار السوق حسب العمر</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            {canEdit ? "✏️ يمكن للمدير العام/التنفيذي التعديل" : "👁️ عرض فقط — التعديل للمدير العام/التنفيذي"}
          </p>
        </div>
        {canEdit && (
          <Button onClick={addRow} size="sm" variant="outline">
            <Plus className="w-4 h-4 ml-1" /> إضافة مرحلة
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الوصف</TableHead>
                <TableHead>من (يوم)</TableHead>
                <TableHead>إلى (يوم)</TableHead>
                <TableHead>طريقة البيع</TableHead>
                <TableHead>سعر الطائر</TableHead>
                <TableHead>سعر الكيلو قائم</TableHead>
                <TableHead>الترتيب</TableHead>
                <TableHead>نشط</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allPrices.map(p => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Input value={p.age_label} onChange={e => update(p.id, { age_label: e.target.value })} disabled={!canEdit} className="min-w-[180px]" />
                  </TableCell>
                  <TableCell>
                    <Input type="number" value={p.age_from_days} onChange={e => update(p.id, { age_from_days: parseInt(e.target.value) || 0 })} disabled={!canEdit} className="w-20" />
                  </TableCell>
                  <TableCell>
                    <Input type="number" value={p.age_to_days ?? ''} placeholder="∞" onChange={e => update(p.id, { age_to_days: e.target.value === '' ? null : parseInt(e.target.value) })} disabled={!canEdit} className="w-20" />
                  </TableCell>
                  <TableCell>
                    <Select value={p.sale_method} onValueChange={(v: any) => update(p.id, { sale_method: v })} disabled={!canEdit}>
                      <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="per_bird">بالعدد</SelectItem>
                        <SelectItem value="live_weight">وزن قائم</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Input type="number" step="0.01" value={p.market_price_per_bird ?? ''} onChange={e => update(p.id, { market_price_per_bird: e.target.value === '' ? null : parseFloat(e.target.value) })} disabled={!canEdit || p.sale_method !== 'per_bird'} className="w-28" />
                  </TableCell>
                  <TableCell>
                    <Input type="number" step="0.01" value={p.live_weight_price_per_kg ?? ''} onChange={e => update(p.id, { live_weight_price_per_kg: e.target.value === '' ? null : parseFloat(e.target.value) })} disabled={!canEdit || p.sale_method !== 'live_weight'} className="w-28" />
                  </TableCell>
                  <TableCell>
                    <Input type="number" value={p.sort_order} onChange={e => update(p.id, { sort_order: parseInt(e.target.value) || 0 })} disabled={!canEdit} className="w-16" />
                  </TableCell>
                  <TableCell>
                    <Switch checked={p.active} onCheckedChange={(v) => update(p.id, { active: v })} disabled={!canEdit} />
                  </TableCell>
                  <TableCell>
                    {canEdit && (
                      <div className="flex gap-1">
                        <Button size="sm" onClick={() => saveOne(p)} disabled={saving}>حفظ</Button>
                        <Button size="sm" variant="ghost" onClick={() => removeRow(p.id)}>
                          <Trash2 className="w-4 h-4 text-red-600" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-md text-sm text-blue-900">
          <strong>ملاحظة:</strong> تغيير الأسعار يؤثر فورًا على حسابات Dashboard للربح المتوقع. فواتير البيع المعتمدة سابقًا تحتفظ بالسعر الذي تم الاعتماد به (Snapshot).
        </div>
      </CardContent>
    </Card>
  );
};
