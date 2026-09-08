import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Info, Scale, AlertTriangle } from "lucide-react";

type Row = {
  canon_name: string;
  product_name: string;
  invoices_count: number | null;
  total_qty: number | null;
  raw_cost: number | null;
  spice_cost: number | null;
  packaging_cost: number | null;
  extra_cost: number | null;
  actual_unit_cost: number | null;
  raw_per_unit: number | null;
  spice_per_unit: number | null;
  packaging_per_unit: number | null;
  extra_per_unit: number | null;
  finished_avg_cost: number | null;
  product_cost_price: number | null;
  product_sale_price: number | null;
  variance: number | null;
  variance_pct: number | null;
  last_approved_at: string | null;
};

const n = (v: unknown) => Number(v ?? 0);
const money = (v: unknown) => n(v).toLocaleString("ar-EG", { maximumFractionDigits: 2 }) + " ج";

export default function MeatCostVariance() {
  const [search, setSearch] = useState("");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["meat-cost-variance"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("v_meat_cost_variance")
        .select("*")
        .order("product_name");
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const filtered = useMemo(
    () => rows.filter((r) => (!search.trim() ? true : (r.product_name ?? "").includes(search.trim()))),
    [rows, search]
  );

  const stats = useMemo(() => {
    const mismatched = rows.filter((r) => Math.abs(n(r.variance)) > 0.01);
    return {
      total: rows.length,
      mismatched: mismatched.length,
      qty: rows.reduce((s, r) => s + n(r.total_qty), 0),
      cost: rows.reduce((s, r) => s + n(r.raw_cost) + n(r.spice_cost) + n(r.packaging_cost) + n(r.extra_cost), 0),
    };
  }, [rows]);

  return (
    <DashboardLayout>
      <Header
        title="فروقات تكلفة الصنف التام"
        subtitle="مقارنة متوسط تكلفة المنتج التام المسجّل بالتكلفة الفعلية من فواتير التصنيع المعتمدة"
      />

      <Card className="glass-card mb-4 border-warning/40">
        <CardContent className="p-4 flex items-start gap-3 text-sm leading-relaxed">
          <Info className="w-5 h-5 text-warning mt-0.5 shrink-0" />
          <div>
            التكلفة الفعلية = مجموع (خامات + توابل + تغليف + مصاريف) لكل فواتير التصنيع المعتمدة أو
            المحوّلة، مقسومة على إجمالي الكمية المنتجة. تُحدَّث تلقائيًا عند اعتماد أو إلغاء أي فاتورة،
            فتظهر الفروقات صفرية عادةً؛ أي فرق يعني تعديلًا يدويًا على التكلفة.
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Card className="glass-card"><CardContent className="p-4">
          <div className="text-muted-foreground text-xs">أصناف تامة</div>
          <div className="text-2xl font-bold mt-1">{stats.total}</div>
        </CardContent></Card>
        <Card className="glass-card"><CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs"><AlertTriangle className="w-4 h-4" /> بها فروقات</div>
          <div className="text-2xl font-bold mt-1 text-destructive">{stats.mismatched}</div>
        </CardContent></Card>
        <Card className="glass-card"><CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs"><Scale className="w-4 h-4" /> إجمالي المنتج</div>
          <div className="text-2xl font-bold mt-1">{n(stats.qty).toLocaleString("ar-EG", { maximumFractionDigits: 2 })} كجم</div>
        </CardContent></Card>
        <Card className="glass-card"><CardContent className="p-4">
          <div className="text-muted-foreground text-xs">إجمالي تكلفة التصنيع</div>
          <div className="text-2xl font-bold mt-1 text-primary">{money(stats.cost)}</div>
        </CardContent></Card>
      </div>

      <Card className="glass-card">
        <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base">الأصناف ({filtered.length})</CardTitle>
          <div className="relative w-64">
            <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="بحث باسم الصنف..." value={search} onChange={(e) => setSearch(e.target.value)} className="pr-9" />
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">جارٍ التحميل...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">الصنف</TableHead>
                  <TableHead className="text-right">فواتير</TableHead>
                  <TableHead className="text-right">الكمية</TableHead>
                  <TableHead className="text-right">خامات/كجم</TableHead>
                  <TableHead className="text-right">توابل/كجم</TableHead>
                  <TableHead className="text-right">تغليف/كجم</TableHead>
                  <TableHead className="text-right">مصاريف/كجم</TableHead>
                  <TableHead className="text-right">التكلفة الفعلية</TableHead>
                  <TableHead className="text-right">المتوسط المسجّل</TableHead>
                  <TableHead className="text-right">الفرق</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => {
                  const diff = n(r.variance);
                  const off = Math.abs(diff) > 0.01;
                  return (
                    <TableRow key={r.canon_name} className={off ? "bg-destructive/5" : undefined}>
                      <TableCell className="font-medium">
                        {r.product_name}
                        {r.finished_avg_cost == null && (
                          <Badge variant="outline" className="text-xs mr-2">بدون بطاقة مخزون</Badge>
                        )}
                      </TableCell>
                      <TableCell>{n(r.invoices_count)}</TableCell>
                      <TableCell>{n(r.total_qty).toLocaleString("ar-EG", { maximumFractionDigits: 2 })}</TableCell>
                      <TableCell>{money(r.raw_per_unit)}</TableCell>
                      <TableCell>{money(r.spice_per_unit)}</TableCell>
                      <TableCell>{money(r.packaging_per_unit)}</TableCell>
                      <TableCell>{money(r.extra_per_unit)}</TableCell>
                      <TableCell className="font-semibold text-primary">{money(r.actual_unit_cost)}</TableCell>
                      <TableCell>{money(r.finished_avg_cost ?? r.product_cost_price)}</TableCell>
                      <TableCell className={off ? "text-destructive font-bold" : "text-success"}>
                        {money(diff)} {off && <span className="text-xs">({n(r.variance_pct).toFixed(1)}%)</span>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </CardContentWrapper>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CardContentWrapper(props: any) {
  return props.children;
}
