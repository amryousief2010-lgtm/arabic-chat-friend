import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Beef, Boxes, Package as PackageIcon, AlertTriangle, Factory, Truck, ShoppingCart, Activity, Wallet } from "lucide-react";

type RawItem = { id: string; name: string; unit: string; current_stock: number; avg_cost: number; low_stock_threshold: number | null; kind: "raw"|"spice"|"packaging"; is_active: boolean; updated_at: string };
type Move = { id: string; item_kind: string; item_id: string; item_name: string; direction: "IN"|"OUT"; quantity: number; unit_cost: number | null; reason: string | null; ref_table: string | null; ref_id: string | null; stock_before: number | null; stock_after: number | null; created_by: string | null; created_at: string };

const KIND_LABEL: Record<string,string> = { raw: "خامة", spice: "بهارات", packaging: "تغليف" };
const KIND_COLOR: Record<string,string> = { raw: "bg-blue-600", spice: "bg-amber-600", packaging: "bg-emerald-600" };
const fmt = (n: any) => Number(n || 0).toLocaleString("ar-EG", { maximumFractionDigits: 2 });
const fmtDate = (s: string | null | undefined) => s ? new Date(s).toLocaleDateString("ar-EG") : "—";

function classifyMove(m: Move): "slaughter"|"purchase"|"manufacturing"|"adjustment" {
  const r = (m.ref_table || "").toLowerCase();
  const reason = (m.reason || "");
  if (r === "slaughter_batch_outputs" || reason.includes("وارد من المجزر") || reason.includes("المجزر")) return "slaughter";
  if (r === "meat_factory_purchases" || reason.includes("شراء")) return "purchase";
  if (r === "meat_manufacturing_invoices" || r === "meat_factory_manufacturing" || reason.includes("تصنيع")) return "manufacturing";
  return "adjustment";
}

const moveLabel: Record<string,{label: string; color: string}> = {
  slaughter: { label: "وارد من المجزر", color: "bg-rose-600" },
  purchase: { label: "وارد مشتريات", color: "bg-blue-600" },
  manufacturing: { label: "صرف تصنيع", color: "bg-purple-600" },
  adjustment: { label: "تسوية/افتتاحي", color: "bg-slate-500" },
};

type FilterKey = "all"|"raw"|"spice"|"packaging"|"in_slaughter"|"in_purchase"|"low"|"zero";

export default function MeatRawInventory() {
  const [filter, setFilter] = useState<FilterKey>("all");
  const [search, setSearch] = useState("");

  const { data: items = [] } = useQuery({
    queryKey: ["mf-raw-inv"],
    queryFn: async () => (await supabase.from("meat_factory_raw_items" as any).select("*").order("name")).data || [],
  });
  const { data: moves = [] } = useQuery({
    queryKey: ["mf-raw-moves"],
    queryFn: async () => (await supabase.from("meat_factory_inventory_moves" as any).select("*").order("created_at", { ascending: false }).limit(1000)).data || [],
  });

  const itemsArr = items as RawItem[];
  const movesArr = moves as Move[];

  // Per-item last dates
  const lastByItem = useMemo(() => {
    const map: Record<string, { slaughter?: string; purchase?: string; manufacturing?: string }> = {};
    for (const m of movesArr) {
      const k = classifyMove(m);
      if (!map[m.item_id]) map[m.item_id] = {};
      if (k === "slaughter" && !map[m.item_id].slaughter) map[m.item_id].slaughter = m.created_at;
      if (k === "purchase" && !map[m.item_id].purchase) map[m.item_id].purchase = m.created_at;
      if (k === "manufacturing" && !map[m.item_id].manufacturing) map[m.item_id].manufacturing = m.created_at;
    }
    return map;
  }, [movesArr]);

  const filtered = useMemo(() => {
    return itemsArr.filter(i => {
      if (search && !i.name?.includes(search)) return false;
      const last = lastByItem[i.id] || {};
      switch (filter) {
        case "raw": return i.kind === "raw";
        case "spice": return i.kind === "spice";
        case "packaging": return i.kind === "packaging";
        case "in_slaughter": return !!last.slaughter;
        case "in_purchase": return !!last.purchase;
        case "low": return Number(i.current_stock) > 0 && Number(i.current_stock) <= Number(i.low_stock_threshold || 0);
        case "zero": return Number(i.current_stock) <= 0;
        default: return true;
      }
    });
  }, [itemsArr, filter, search, lastByItem]);

  const stats = useMemo(() => {
    const val = (k: string) => itemsArr.filter(i => i.kind === k).reduce((s,i) => s + Number(i.current_stock) * Number(i.avg_cost || 0), 0);
    const rawVal = val("raw"), spiceVal = val("spice"), packVal = val("packaging");
    const total = rawVal + spiceVal + packVal;
    const active = itemsArr.filter(i => i.is_active).length;
    const low = itemsArr.filter(i => Number(i.current_stock) > 0 && Number(i.current_stock) <= Number(i.low_stock_threshold || 0)).length;
    return { rawVal, spiceVal, packVal, total, active, low };
  }, [itemsArr]);

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-4" dir="rtl">
        <div className="flex items-center gap-3">
          <Boxes className="w-7 h-7 text-purple-600" />
          <div>
            <h1 className="text-2xl font-bold">مخزون خامات مصنع اللحوم</h1>
            <p className="text-sm text-muted-foreground">عرض موسع لكل الخامات والبهارات والتغليف مع آخر الحركات وقيمة المخزون.</p>
          </div>
        </div>

        {/* Stats cards */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <StatCard icon={Beef} label="قيمة الخامات" value={fmt(stats.rawVal)} color="text-blue-600" />
          <StatCard icon={Beef} label="قيمة البهارات" value={fmt(stats.spiceVal)} color="text-amber-600" />
          <StatCard icon={PackageIcon} label="قيمة التغليف" value={fmt(stats.packVal)} color="text-emerald-600" />
          <StatCard icon={Wallet} label="إجمالي قيمة المخزون" value={fmt(stats.total)} color="text-purple-700" big />
          <StatCard icon={Factory} label="الأصناف النشطة" value={String(stats.active)} color="text-slate-700" />
          <StatCard icon={AlertTriangle} label="تحت حد إعادة الطلب" value={String(stats.low)} color="text-red-600" />
        </div>

        <Tabs defaultValue="items">
          <TabsList>
            <TabsTrigger value="items">الأصناف والقيمة</TabsTrigger>
            <TabsTrigger value="moves">سجل حركات مخزون مصنع اللحوم</TabsTrigger>
          </TabsList>

          <TabsContent value="items" className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Input placeholder="بحث باسم الصنف…" value={search} onChange={e => setSearch(e.target.value)} className="max-w-sm" />
              {([
                ["all","الكل"],["raw","خامات"],["spice","بهارات"],["packaging","تغليف"],
                ["in_slaughter","وارد من المجزر"],["in_purchase","وارد مشتريات"],
                ["low","منخفضة الرصيد"],["zero","صفرية الرصيد"],
              ] as [FilterKey,string][]).map(([k,l]) => (
                <Button key={k} size="sm" variant={filter===k?"default":"outline"} onClick={() => setFilter(k)} className={filter===k?"bg-purple-600 hover:bg-purple-700":""}>{l}</Button>
              ))}
              <Badge variant="outline" className="mr-auto">عدد النتائج: {filtered.length}</Badge>
            </div>

            <Card><CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>الصنف</TableHead><TableHead>النوع</TableHead><TableHead>الوحدة</TableHead>
                  <TableHead>الرصيد الحالي</TableHead><TableHead>متوسط التكلفة</TableHead><TableHead>إجمالي القيمة</TableHead>
                  <TableHead>حد إعادة الطلب</TableHead>
                  <TableHead>آخر وارد من المجزر</TableHead><TableHead>آخر وارد مشتريات</TableHead>
                  <TableHead>آخر صرف تصنيع</TableHead><TableHead>الحالة</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow><TableCell colSpan={11} className="text-center py-8 text-muted-foreground">لا توجد أصناف مطابقة</TableCell></TableRow>
                  ) : filtered.map(i => {
                    const value = Number(i.current_stock) * Number(i.avg_cost || 0);
                    const last = lastByItem[i.id] || {};
                    const isZero = Number(i.current_stock) <= 0;
                    const isLow = !isZero && Number(i.current_stock) <= Number(i.low_stock_threshold || 0);
                    return (
                      <TableRow key={i.id} className={isZero ? "bg-red-50 dark:bg-red-950/30" : isLow ? "bg-amber-50 dark:bg-amber-950/30" : ""}>
                        <TableCell className="font-medium">{i.name}</TableCell>
                        <TableCell><Badge className={KIND_COLOR[i.kind] || "bg-slate-500"}>{KIND_LABEL[i.kind] || i.kind}</Badge></TableCell>
                        <TableCell>{i.unit}</TableCell>
                        <TableCell className="font-bold">{fmt(i.current_stock)}</TableCell>
                        <TableCell>{fmt(i.avg_cost)}</TableCell>
                        <TableCell className="font-bold text-purple-700">{fmt(value)}</TableCell>
                        <TableCell className="text-xs">{fmt(i.low_stock_threshold)}</TableCell>
                        <TableCell className="text-xs">{fmtDate(last.slaughter)}</TableCell>
                        <TableCell className="text-xs">{fmtDate(last.purchase)}</TableCell>
                        <TableCell className="text-xs">{fmtDate(last.manufacturing)}</TableCell>
                        <TableCell>
                          {!i.is_active ? <Badge variant="secondary">معطّل</Badge>
                            : isZero ? <Badge variant="destructive">نفد</Badge>
                            : isLow ? <Badge className="bg-amber-600">منخفض</Badge>
                            : <Badge className="bg-emerald-600">متاح</Badge>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="moves">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">سجل حركات مخزون مصنع اللحوم</CardTitle>
                <CardDescription>أحدث 1000 حركة — تشمل وارد المجزر/المشتريات وصرف التصنيع والتسويات.</CardDescription>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>التاريخ</TableHead><TableHead>النوع</TableHead><TableHead>الصنف</TableHead>
                    <TableHead>الاتجاه</TableHead><TableHead>الكمية</TableHead>
                    <TableHead>سعر الوحدة</TableHead><TableHead>الرصيد قبل</TableHead><TableHead>الرصيد بعد</TableHead>
                    <TableHead>المرجع</TableHead><TableHead>ملاحظات</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {movesArr.length === 0 ? (
                      <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">لا توجد حركات</TableCell></TableRow>
                    ) : movesArr.map(m => {
                      const k = classifyMove(m);
                      const ml = moveLabel[k];
                      return (
                        <TableRow key={m.id}>
                          <TableCell className="text-xs">{new Date(m.created_at).toLocaleString("ar-EG")}</TableCell>
                          <TableCell><Badge className={ml.color}>{ml.label}</Badge></TableCell>
                          <TableCell className="font-medium">{m.item_name}</TableCell>
                          <TableCell>{m.direction === "IN" ? <Badge className="bg-emerald-600">وارد</Badge> : <Badge className="bg-rose-600">صرف</Badge>}</TableCell>
                          <TableCell className="font-bold">{fmt(m.quantity)}</TableCell>
                          <TableCell>{fmt(m.unit_cost)}</TableCell>
                          <TableCell className="text-xs">{fmt(m.stock_before)}</TableCell>
                          <TableCell className="text-xs font-medium">{fmt(m.stock_after)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{m.ref_table || "—"}</TableCell>
                          <TableCell className="text-xs max-w-[300px] truncate" title={m.reason || ""}>{m.reason || "—"}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

function StatCard({ icon: Icon, label, value, color, big }: { icon: any; label: string; value: string; color: string; big?: boolean }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className={`w-4 h-4 ${color}`} />{label}</div>
        <div className={`mt-1 font-bold ${color} ${big ? "text-2xl" : "text-lg"}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
