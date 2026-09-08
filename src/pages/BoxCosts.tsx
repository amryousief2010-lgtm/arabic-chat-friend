import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Gift, AlertTriangle, TrendingUp, ChevronDown, ChevronUp, Info } from "lucide-react";

const MIN_PROFIT = 100;

type BoxRow = {
  box_id: string;
  box_name: string;
  is_active: boolean | null;
  offer_price: number | null;
  shipping_cost: number | null;
  items_count: number | null;
  total_qty: number | null;
  total_cost: number | null;
  raw_cost: number | null;
  spice_cost: number | null;
  packaging_cost: number | null;
  extra_cost: number | null;
  profit: number | null;
  profit_pct: number | null;
  items_without_cost: number | null;
};

type LineRow = {
  box_id: string;
  product_name: string | null;
  quantity: number | null;
  is_gift: boolean | null;
  actual_unit_cost: number | null;
  product_cost_price: number | null;
  raw_per_unit: number | null;
  spice_per_unit: number | null;
  packaging_per_unit: number | null;
  extra_per_unit: number | null;
  line_cost: number | null;
};

const n = (v: unknown) => Number(v ?? 0);
const money = (v: unknown) => n(v).toLocaleString("ar-EG", { maximumFractionDigits: 2 }) + " ج";

export default function BoxCosts() {
  const [search, setSearch] = useState("");
  const [onlyLow, setOnlyLow] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const { data: boxes = [], isLoading } = useQuery({
    queryKey: ["offer-box-costs"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("v_offer_box_costs")
        .select("*")
        .order("profit", { ascending: true });
      if (error) throw error;
      return (data ?? []) as BoxRow[];
    },
  });

  const { data: lines = [] } = useQuery({
    queryKey: ["offer-box-cost-lines"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("v_offer_box_cost_lines")
        .select("*");
      if (error) throw error;
      return (data ?? []) as LineRow[];
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim();
    return boxes.filter((b) => {
      if (q && !(b.box_name ?? "").includes(q)) return false;
      if (onlyLow && n(b.profit) >= MIN_PROFIT) return false;
      return true;
    });
  }, [boxes, search, onlyLow]);

  const stats = useMemo(() => {
    const low = boxes.filter((b) => n(b.profit) < MIN_PROFIT);
    return {
      total: boxes.length,
      low: low.length,
      avgProfit: boxes.length ? boxes.reduce((s, b) => s + n(b.profit), 0) / boxes.length : 0,
      missing: boxes.reduce((s, b) => s + n(b.items_without_cost), 0),
    };
  }, [boxes]);

  return (
    <DashboardLayout>
      <Header
        title="تكلفة وربح البوكسات"
        subtitle="التكلفة محسوبة من فواتير تصنيع مصنع اللحوم المعتمدة (خامات + توابل + تغليف + مصاريف)"
      />

      <Card className="glass-card mb-4 border-warning/40">
        <CardContent className="p-4 flex items-start gap-3 text-sm leading-relaxed">
          <Info className="w-5 h-5 text-warning mt-0.5 shrink-0" />
          <div>
            الحد الأدنى المقبول لربح البوكس هو <b>{MIN_PROFIT} جنيه</b>. أي بوكس ربحه أقل من ذلك يظهر
            بعلامة تحذير حمراء. تكلفة الأصناف المصنّعة تؤخذ من متوسط فواتير التصنيع المعتمدة، وباقي
            الأصناف من التكلفة المسجّلة في بطاقة المنتج.
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Card className="glass-card"><CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs"><Gift className="w-4 h-4" /> عدد البوكسات</div>
          <div className="text-2xl font-bold mt-1">{stats.total}</div>
        </CardContent></Card>
        <Card className="glass-card"><CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs"><AlertTriangle className="w-4 h-4" /> ربحها أقل من {MIN_PROFIT} ج</div>
          <div className="text-2xl font-bold mt-1 text-destructive">{stats.low}</div>
        </CardContent></Card>
        <Card className="glass-card"><CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs"><TrendingUp className="w-4 h-4" /> متوسط الربح</div>
          <div className="text-2xl font-bold mt-1 text-primary">{money(stats.avgProfit)}</div>
        </CardContent></Card>
        <Card className="glass-card"><CardContent className="p-4">
          <div className="text-muted-foreground text-xs">أصناف بدون تكلفة</div>
          <div className="text-2xl font-bold mt-1 text-warning">{stats.missing}</div>
        </CardContent></Card>
      </div>

      <Card className="glass-card">
        <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base">البوكسات ({filtered.length})</CardTitle>
          <div className="flex items-center gap-2">
            <Button variant={onlyLow ? "default" : "outline"} size="sm" onClick={() => setOnlyLow((v) => !v)}>
              <AlertTriangle className="w-4 h-4 ml-1" /> أقل من {MIN_PROFIT} ج
            </Button>
            <div className="relative w-56">
              <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="بحث باسم البوكس..." value={search} onChange={(e) => setSearch(e.target.value)} className="pr-9" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">جارٍ التحميل...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">البوكس</TableHead>
                  <TableHead className="text-right">سعر البيع</TableHead>
                  <TableHead className="text-right">خامات</TableHead>
                  <TableHead className="text-right">توابل</TableHead>
                  <TableHead className="text-right">تغليف</TableHead>
                  <TableHead className="text-right">مصاريف</TableHead>
                  <TableHead className="text-right">إجمالي التكلفة</TableHead>
                  <TableHead className="text-right">الربح</TableHead>
                  <TableHead className="text-right">%</TableHead>
                  <TableHead className="text-right">تفاصيل</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((b) => {
                  const low = n(b.profit) < MIN_PROFIT;
                  const boxLines = lines.filter((l) => l.box_id === b.box_id);
                  return (
                    <>
                      <TableRow key={b.box_id} className={low ? "bg-destructive/5" : undefined}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            {b.box_name}
                            {low && <Badge variant="destructive" className="text-xs">أقل من {MIN_PROFIT} ج</Badge>}
                            {b.is_active === false && <Badge variant="outline" className="text-xs">موقوف</Badge>}
                          </div>
                          <div className="text-xs text-muted-foreground">{n(b.items_count)} صنف · {n(b.total_qty)} وحدة</div>
                        </TableCell>
                        <TableCell className="font-semibold">{money(b.offer_price)}</TableCell>
                        <TableCell>{money(b.raw_cost)}</TableCell>
                        <TableCell>{money(b.spice_cost)}</TableCell>
                        <TableCell>{money(b.packaging_cost)}</TableCell>
                        <TableCell>{money(b.extra_cost)}</TableCell>
                        <TableCell className="font-semibold">{money(b.total_cost)}</TableCell>
                        <TableCell className={low ? "text-destructive font-bold" : "text-success font-semibold"}>
                          {money(b.profit)}
                        </TableCell>
                        <TableCell>{n(b.profit_pct).toFixed(1)}%</TableCell>
                        <TableCell>
                          <Button size="sm" variant="ghost" onClick={() => setOpen(open === b.box_id ? null : b.box_id)}>
                            {open === b.box_id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </Button>
                        </TableCell>
                      </TableRow>
                      {open === b.box_id && (
                        <TableRow key={b.box_id + "-d"}>
                          <TableCell colSpan={10} className="bg-muted/30">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="text-right">الصنف</TableHead>
                                  <TableHead className="text-right">الكمية</TableHead>
                                  <TableHead className="text-right">تكلفة الوحدة</TableHead>
                                  <TableHead className="text-right">خامات/وحدة</TableHead>
                                  <TableHead className="text-right">توابل/وحدة</TableHead>
                                  <TableHead className="text-right">تغليف/وحدة</TableHead>
                                  <TableHead className="text-right">إجمالي السطر</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {boxLines.map((l, i) => (
                                  <TableRow key={i}>
                                    <TableCell>
                                      {l.product_name ?? "-"}
                                      {l.is_gift && <Badge variant="outline" className="text-xs mr-2">هدية</Badge>}
                                      {!n(l.actual_unit_cost) && (
                                        <Badge variant="secondary" className="text-xs mr-2">تكلفة يدوية</Badge>
                                      )}
                                    </TableCell>
                                    <TableCell>{n(l.quantity)}</TableCell>
                                    <TableCell>{money(l.actual_unit_cost || l.product_cost_price)}</TableCell>
                                    <TableCell>{money(l.raw_per_unit)}</TableCell>
                                    <TableCell>{money(l.spice_per_unit)}</TableCell>
                                    <TableCell>{money(l.packaging_per_unit)}</TableCell>
                                    <TableCell className="font-semibold">{money(l.line_cost)}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </DashboardLayout>
  );
}
