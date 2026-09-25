import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertTriangle, Download, Search } from "lucide-react";
import { exportCSV } from "@/lib/csvExport";

type Kind = "spice" | "raw" | "packaging" | "all";
const KIND_AR: Record<string, string> = { spice: "بهارات", raw: "خامات", packaging: "تغليف" };
const fmt = (n: number, d = 2) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: d });
const median = (a: number[]) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const isKg = (u: string) => /kg|كجم|كيلو|كغ/i.test(u || "");

interface Props { fromISO: string; toISO: string; productFilter: string; }

export default function MaterialsConsumptionSection({ fromISO, toISO, productFilter }: Props) {
  const [tab, setTab] = useState<Kind>("spice");
  const [search, setSearch] = useState("");

  // Fetch a wider created_at window, then filter precisely by coalesce(approved_at, created_at).
  const q = useQuery({
    queryKey: ["mfd-consumption", fromISO, toISO],
    queryFn: async () => {
      const invs: any[] = [];
      for (let off = 0; ; off += 1000) {
        const { data, error } = await supabase
          .from("meat_manufacturing_invoices" as any)
          .select("id,product_name,status,approved_at,created_at")
          .in("status", ["approved", "transferred"])
          .lte("created_at", toISO)
          .order("created_at", { ascending: false })
          .range(off, off + 999);
        if (error) throw error;
        invs.push(...(data || []));
        if (!data || data.length < 1000) break;
      }
      const inRange = invs.filter((i) => {
        const d = i.approved_at || i.created_at;
        return d >= fromISO && d <= toISO;
      });
      const lines: any[] = [];
      const ids = inRange.map((i) => i.id);
      for (let k = 0; k < ids.length; k += 50) {
        for (let off = 0; ; off += 1000) {
          const { data, error } = await supabase
            .from("meat_manufacturing_invoice_lines" as any)
            .select("id,invoice_id,item_name,kind,unit,quantity,unit_cost,line_total")
            .in("invoice_id", ids.slice(k, k + 50))
            .order("id")
            .range(off, off + 999);
          if (error) throw error;
          lines.push(...(data || []));
          if (!data || data.length < 1000) break;
        }
      }
      return { invoices: inRange, lines };
    },
  });

  const { invoices, lines } = useMemo(() => {
    const all = q.data || { invoices: [], lines: [] };
    const inv = productFilter === "all" ? all.invoices : all.invoices.filter((i: any) => i.product_name === productFilter);
    const ids = new Set(inv.map((i: any) => i.id));
    return { invoices: inv, lines: all.lines.filter((l: any) => ids.has(l.invoice_id)) };
  }, [q.data, productFilter]);

  const totals = useMemo(() => {
    const t = { spice: 0, raw: 0, packaging: 0 } as Record<string, number>;
    lines.forEach((l: any) => { if (l.kind in t) t[l.kind] += Number(l.line_total || 0); });
    return t;
  }, [lines]);

  const rows = useMemo(() => {
    const m = new Map<string, any>();
    lines.filter((l: any) => tab === "all" || l.kind === tab).forEach((l: any) => {
      const key = `${l.item_name}|${l.unit}`;
      if (!m.has(key)) m.set(key, { item: l.item_name, kind: l.kind, unit: l.unit, qty: 0, total: 0, costs: [] as number[], inv: new Set<string>() });
      const r = m.get(key);
      r.qty += Number(l.quantity || 0);
      r.total += Number(l.line_total || 0);
      if (l.unit_cost != null) r.costs.push(Number(l.unit_cost));
      r.inv.add(l.invoice_id);
    });
    const list = Array.from(m.values()).map((r) => {
      const min = r.costs.length ? Math.min(...r.costs) : 0;
      const max = r.costs.length ? Math.max(...r.costs) : 0;
      const med = median(r.costs);
      return { ...r, min, max, avg: r.qty ? r.total / r.qty : 0, invCount: r.inv.size,
        suspicious: (med > 0 && max > 5 * med) || (isKg(r.unit) && max >= 5000) };
    }).sort((a, b) => b.total - a.total);
    const grand = list.reduce((s, r) => s + r.total, 0);
    let cum = 0;
    return list.map((r) => {
      const before = cum;
      cum += r.total;
      const top80 = grand > 0 && before / grand < 0.8;
      const spread = r.min > 0 && r.max > r.min * 1.2;
      return { ...r, share: grand ? (r.total / grand) * 100 : 0, bulk: top80 || spread };
    });
  }, [lines, tab]);

  const visible = rows.filter((r) => !search.trim() || String(r.item).includes(search.trim()));

  const doExport = () => exportCSV(`consumption_${tab}_${fromISO.slice(0, 10)}_${toISO.slice(0, 10)}.csv`, visible.map((r) => ({
    "الصنف": r.item, "النوع": KIND_AR[r.kind] || r.kind, "الوحدة": r.unit,
    "الكمية المستهلكة": r.qty.toFixed(3), "إجمالي القيمة": r.total.toFixed(2), "متوسط سعر الوحدة": r.avg.toFixed(2),
    "أقل سعر": r.min.toFixed(2), "أعلى سعر": r.max.toFixed(2), "عدد الفواتير": r.invCount,
    "النسبة من التكلفة %": r.share.toFixed(2), "مرشح للشراء جملة": r.bulk ? "نعم" : "", "سعر غير منطقي": r.suspicious ? "نعم" : "",
  })));

  const Chip = ({ label, value }: { label: string; value: string }) => (
    <div className="rounded-lg border bg-muted/30 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-bold tabular-nums">{value}</div>
    </div>
  );

  return (
    <Card dir="rtl">
      <CardHeader>
        <CardTitle>استهلاك الخامات والبهارات</CardTitle>
        <CardDescription>من فواتير التصنيع المعتمدة/المرحّلة في الفترة المختارة — عرض فقط</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Chip label="قيمة البهارات المستهلكة" value={`${fmt(totals.spice)} ج`} />
          <Chip label="قيمة الخامات المستهلكة" value={`${fmt(totals.raw)} ج`} />
          <Chip label="قيمة التغليف المستهلك" value={`${fmt(totals.packaging)} ج`} />
          <Chip label="عدد الفواتير" value={String(invoices.length)} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Tabs value={tab} onValueChange={(v) => setTab(v as Kind)}>
            <TabsList>
              <TabsTrigger value="spice">بهارات</TabsTrigger>
              <TabsTrigger value="raw">خامات</TabsTrigger>
              <TabsTrigger value="packaging">تغليف</TabsTrigger>
              <TabsTrigger value="all">الكل</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="h-4 w-4 absolute right-2 top-3 text-muted-foreground" />
              <Input className="pr-8 w-52" placeholder="بحث عن صنف..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Button variant="outline" size="sm" onClick={doExport}><Download className="h-4 w-4 ml-1" />تصدير Excel/CSV</Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <TooltipProvider>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الصنف</TableHead><TableHead>النوع</TableHead><TableHead>الوحدة</TableHead>
                  <TableHead>الكمية المستهلكة</TableHead><TableHead>إجمالي القيمة</TableHead><TableHead>متوسط سعر الوحدة</TableHead>
                  <TableHead>أقل / أعلى سعر</TableHead><TableHead>عدد الفواتير</TableHead><TableHead>النسبة من التكلفة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {q.isLoading ? (
                  <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground">جاري التحميل...</TableCell></TableRow>
                ) : visible.length === 0 ? (
                  <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground">لا يوجد استهلاك في الفترة</TableCell></TableRow>
                ) : visible.map((r) => (
                  <TableRow key={`${r.item}|${r.unit}`}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-1 flex-wrap">
                        {r.item}
                        {r.suspicious && (
                          <Tooltip>
                            <TooltipTrigger asChild><AlertTriangle className="h-4 w-4 text-destructive" /></TooltipTrigger>
                            <TooltipContent>سعر غير منطقي — راجع الوحدة</TooltipContent>
                          </Tooltip>
                        )}
                        {r.bulk && <Badge variant="secondary" className="text-[10px]">مرشح للشراء جملة</Badge>}
                      </div>
                    </TableCell>
                    <TableCell>{KIND_AR[r.kind] || r.kind}</TableCell>
                    <TableCell>{r.unit}</TableCell>
                    <TableCell className="tabular-nums">{fmt(r.qty, 3)}</TableCell>
                    <TableCell className="tabular-nums font-semibold">{fmt(r.total)} ج</TableCell>
                    <TableCell className="tabular-nums">{fmt(r.avg)}</TableCell>
                    <TableCell className="tabular-nums">{fmt(r.min)} / {fmt(r.max)}</TableCell>
                    <TableCell className="tabular-nums">{r.invCount}</TableCell>
                    <TableCell className="tabular-nums">{fmt(r.share, 1)}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TooltipProvider>
        </div>
      </CardContent>
    </Card>
  );
}
