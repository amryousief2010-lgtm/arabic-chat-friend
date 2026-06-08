import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Download, RefreshCw, TrendingUp, TrendingDown, Warehouse, Factory, Drumstick, Egg } from "lucide-react";
import { openPrintWindow } from "@/lib/printPdf";
import { toast } from "sonner";

type DistRow = {
  sale_id: string;
  sale_no: string | null;
  sale_date: string;
  destination_type: string;
  destination_label: string | null;
  is_internal_transfer: boolean;
  feed_name: string | null;
  quantity: number;
  line_total: number;
  line_cost: number;
};

const fmt = (n: number) => Number(n || 0).toLocaleString("ar-EG", { maximumFractionDigits: 2 });

export default function FeedMonthlyReport() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [loading, setLoading] = useState(false);

  const [dist, setDist] = useState<DistRow[]>([]);
  const [broodingIssues, setBroodingIssues] = useState<any[]>([]);
  const [slaughterIssues, setSlaughterIssues] = useState<any[]>([]);
  const [factoryBalances, setFactoryBalances] = useState<any[]>([]);
  const [broodingBalances, setBroodingBalances] = useState<any[]>([]);
  const [slaughterBalances, setSlaughterBalances] = useState<any[]>([]);
  const [factoryTreasury, setFactoryTreasury] = useState<{ in: number; internalCount: number }>({ in: 0, internalCount: 0 });

  const range = useMemo(() => {
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1);
    return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
  }, [year, month]);

  const load = async () => {
    setLoading(true);
    try {
      const [d, bIss, sIss, fp, bInv, sInv, tx, leak] = await Promise.all([
        supabase.from("v_feed_factory_distribution" as any).select("*").gte("sale_date", range.start).lt("sale_date", range.end).order("sale_date", { ascending: false }),
        supabase.from("brooding_feed_issuance").select("issue_date, feed_name, quantity_kg, total_cost").gte("issue_date", range.start).lt("issue_date", range.end),
        supabase.from("slaughterhouse_feed_movements").select("performed_at, feed_id, quantity_kg, total_cost, movement_type, notes").eq("movement_type", "consumption").gte("performed_at", range.start).lt("performed_at", range.end),
        supabase.from("feed_products").select("name, current_stock, latest_unit_cost").is("archived_at", null).order("name"),
        supabase.from("brooding_feed_inventory").select("feed_name, current_kg, last_unit_cost").order("feed_name"),
        supabase.from("slaughterhouse_feed_inventory").select("feed_name, current_kg, last_unit_cost").order("feed_name"),
        supabase.from("feed_factory_treasury_txns").select("amount, direction, kind, ref_table, ref_id").gte("txn_date", range.start).lt("txn_date", range.end),
        supabase.from("feed_sales").select("id, destination_type").neq("destination_type", "external_customer").gte("sale_date", range.start).lt("sale_date", range.end),
      ]);

      setDist((d.data as any) || []);
      setBroodingIssues(bIss.data || []);
      setSlaughterIssues(sIss.data || []);
      setFactoryBalances(fp.data || []);
      setBroodingBalances(bInv.data || []);
      setSlaughterBalances(sInv.data || []);

      const txns = (tx.data as any[]) || [];
      const internalSaleIds = new Set(((leak.data as any[]) || []).map((s) => s.id));
      const saleIncoming = txns.filter((t) => t.direction === "in" && t.kind === "sale");
      const leakedCount = saleIncoming.filter((t) => t.ref_id && internalSaleIds.has(t.ref_id)).length;
      setFactoryTreasury({
        in: saleIncoming.reduce((s, t) => s + Number(t.amount || 0), 0),
        internalCount: leakedCount,
      });
    } catch (e: any) {
      toast.error("فشل تحميل التقرير: " + (e.message || e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month]);

  const totals = useMemo(() => {
    const external = dist.filter((r) => !r.is_internal_transfer);
    const toBrooding = dist.filter((r) => r.destination_type === "brooding_feed_store");
    const toSlaughter = dist.filter((r) => r.destination_type === "slaughterhouse_feed_store");
    return {
      externalQty: external.reduce((s, r) => s + Number(r.quantity || 0), 0),
      externalAmount: external.reduce((s, r) => s + Number(r.line_total || 0), 0),
      broodingQty: toBrooding.reduce((s, r) => s + Number(r.quantity || 0), 0),
      slaughterQty: toSlaughter.reduce((s, r) => s + Number(r.quantity || 0), 0),
      broodingIssuedQty: broodingIssues.reduce((s, r: any) => s + Number(r.quantity_kg || 0), 0),
      slaughterIssuedQty: slaughterIssues.reduce((s, r: any) => s + Number(r.quantity_kg || 0), 0),
    };
  }, [dist, broodingIssues, slaughterIssues]);

  const exportPDF = () => {
    const monthLabel = `${month}/${year}`;
    const html = `
      <h1 style="text-align:center">تقرير توزيع الأعلاف الشهري — ${monthLabel}</h1>
      <h2>الملخص</h2>
      <table border="1" cellpadding="6" style="width:100%;border-collapse:collapse">
        <tr><th>البند</th><th>الكمية (كجم)</th><th>القيمة (ج.م)</th></tr>
        <tr><td>إجمالي مبيعات خارجية</td><td>${fmt(totals.externalQty)}</td><td>${fmt(totals.externalAmount)}</td></tr>
        <tr><td>توريد لحضانات التسمين</td><td>${fmt(totals.broodingQty)}</td><td>—</td></tr>
        <tr><td>توريد لمخزن المجزر</td><td>${fmt(totals.slaughterQty)}</td><td>—</td></tr>
        <tr><td>منصرف من مخزن الحضانات</td><td>${fmt(totals.broodingIssuedQty)}</td><td>—</td></tr>
        <tr><td>منصرف من مخزن المجزر</td><td>${fmt(totals.slaughterIssuedQty)}</td><td>—</td></tr>
        <tr><td>إيراد خزنة المصنع (المبيعات الخارجية)</td><td colspan="2">${fmt(factoryTreasury.in)} ج.م</td></tr>
      </table>
      <h2>أرصدة المخازن الحالية</h2>
      <h3>مصنع العلف</h3>
      <table border="1" cellpadding="6" style="width:100%;border-collapse:collapse">
        <tr><th>الصنف</th><th>الرصيد (كجم)</th></tr>
        ${factoryBalances.map((b) => `<tr><td>${b.name}</td><td>${fmt(b.current_stock)}</td></tr>`).join("")}
      </table>
      <h3>حضانات التسمين</h3>
      <table border="1" cellpadding="6" style="width:100%;border-collapse:collapse">
        <tr><th>الصنف</th><th>الرصيد (كجم)</th></tr>
        ${broodingBalances.map((b) => `<tr><td>${b.feed_name}</td><td>${fmt(b.current_kg)}</td></tr>`).join("")}
      </table>
      <h3>مخزن علف المجزر</h3>
      <table border="1" cellpadding="6" style="width:100%;border-collapse:collapse">
        <tr><th>الصنف</th><th>الرصيد (كجم)</th></tr>
        ${slaughterBalances.map((b) => `<tr><td>${b.feed_name}</td><td>${fmt(b.current_kg)}</td></tr>`).join("")}
      </table>
    `;
    openPrintWindow(html, `تقرير-الأعلاف-${monthLabel}`);
  };

  return (
    <div className="container mx-auto p-4 space-y-4" dir="rtl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">تقرير توزيع الأعلاف الشهري</h1>
          <p className="text-sm text-muted-foreground">مبيعات خارجية، توريدات داخلية، صرف، وأرصدة المخازن</p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <Label>السنة</Label>
            <Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-24" />
          </div>
          <div>
            <Label>الشهر</Label>
            <Input type="number" min={1} max={12} value={month} onChange={(e) => setMonth(Number(e.target.value))} className="w-20" />
          </div>
          <Button onClick={load} variant="outline" size="sm"><RefreshCw className="h-4 w-4" /></Button>
          <Button onClick={exportPDF} size="sm"><Download className="h-4 w-4 ml-1" /> PDF</Button>
        </div>
      </div>

      {loading && <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KPI icon={<TrendingUp className="h-5 w-5" />} label="مبيعات خارجية" value={`${fmt(totals.externalQty)} كجم`} sub={`${fmt(totals.externalAmount)} ج.م`} color="bg-emerald-500/10 text-emerald-700" />
        <KPI icon={<Egg className="h-5 w-5" />} label="توريد للحضانات" value={`${fmt(totals.broodingQty)} كجم`} color="bg-blue-500/10 text-blue-700" />
        <KPI icon={<Drumstick className="h-5 w-5" />} label="توريد للمجزر" value={`${fmt(totals.slaughterQty)} كجم`} color="bg-orange-500/10 text-orange-700" />
        <KPI icon={<TrendingDown className="h-5 w-5" />} label="منصرف الحضانات" value={`${fmt(totals.broodingIssuedQty)} كجم`} color="bg-purple-500/10 text-purple-700" />
        <KPI icon={<TrendingDown className="h-5 w-5" />} label="منصرف المجزر" value={`${fmt(totals.slaughterIssuedQty)} كجم`} color="bg-rose-500/10 text-rose-700" />
        <KPI icon={<Factory className="h-5 w-5" />} label="إيراد خزنة المصنع" value={`${fmt(factoryTreasury.in)} ج.م`} sub={factoryTreasury.internalCount === 0 ? "✓ بدون توريدات داخلية" : `⚠ ${factoryTreasury.internalCount} حركة داخلية`} color="bg-amber-500/10 text-amber-700" />
      </div>

      <Tabs defaultValue="dist">
        <TabsList>
          <TabsTrigger value="dist">حركات التوزيع</TabsTrigger>
          <TabsTrigger value="issues">حركات الصرف</TabsTrigger>
          <TabsTrigger value="balances">الأرصدة</TabsTrigger>
        </TabsList>

        <TabsContent value="dist">
          <Card>
            <CardHeader><CardTitle>كل عمليات مصنع العلف خلال الشهر</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>التاريخ</TableHead>
                    <TableHead>رقم الفاتورة</TableHead>
                    <TableHead>الوجهة</TableHead>
                    <TableHead>النوع</TableHead>
                    <TableHead>الصنف</TableHead>
                    <TableHead>كمية (كجم)</TableHead>
                    <TableHead>القيمة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dist.map((r) => (
                    <TableRow key={r.sale_id + (r.feed_name || "")}>
                      <TableCell>{r.sale_date}</TableCell>
                      <TableCell>{r.sale_no || "—"}</TableCell>
                      <TableCell>{r.destination_label || r.destination_type}</TableCell>
                      <TableCell>
                        <span className={`text-xs px-2 py-1 rounded ${r.is_internal_transfer ? "bg-blue-500/10 text-blue-700" : "bg-emerald-500/10 text-emerald-700"}`}>
                          {r.is_internal_transfer ? "تحويل داخلي" : "بيع خارجي"}
                        </span>
                      </TableCell>
                      <TableCell>{r.feed_name}</TableCell>
                      <TableCell>{fmt(r.quantity)}</TableCell>
                      <TableCell>{r.is_internal_transfer ? "—" : fmt(r.line_total)}</TableCell>
                    </TableRow>
                  ))}
                  {dist.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">لا توجد بيانات</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="issues">
          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle>صرف من مخزن الحضانات</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow><TableHead>التاريخ</TableHead><TableHead>الصنف</TableHead><TableHead>كمية</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {broodingIssues.map((r: any, i) => (
                      <TableRow key={i}><TableCell>{r.issue_date}</TableCell><TableCell>{r.feed_name}</TableCell><TableCell>{fmt(r.quantity_kg)}</TableCell></TableRow>
                    ))}
                    {broodingIssues.length === 0 && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">لا يوجد</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>صرف من مخزن المجزر</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow><TableHead>التاريخ</TableHead><TableHead>كمية</TableHead><TableHead>ملاحظات</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {slaughterIssues.map((r: any, i) => (
                      <TableRow key={i}><TableCell>{new Date(r.performed_at).toLocaleDateString("ar-EG")}</TableCell><TableCell>{fmt(r.quantity_kg)}</TableCell><TableCell>{r.notes || "—"}</TableCell></TableRow>
                    ))}
                    {slaughterIssues.length === 0 && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">لا يوجد</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="balances">
          <div className="grid md:grid-cols-3 gap-4">
            <BalanceCard title="مصنع العلف" icon={<Factory className="h-4 w-4" />} rows={factoryBalances.map((b) => ({ name: b.name, qty: b.current_stock }))} />
            <BalanceCard title="حضانات التسمين" icon={<Egg className="h-4 w-4" />} rows={broodingBalances.map((b) => ({ name: b.feed_name, qty: b.current_kg }))} />
            <BalanceCard title="مخزن علف المجزر" icon={<Drumstick className="h-4 w-4" />} rows={slaughterBalances.map((b) => ({ name: b.feed_name, qty: b.current_kg }))} />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function KPI({ icon, label, value, sub, color }: { icon: React.ReactNode; label: string; value: string; sub?: string; color: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className={`inline-flex p-2 rounded ${color} mb-2`}>{icon}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-lg font-bold">{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function BalanceCard({ title, icon, rows }: { title: string; icon: React.ReactNode; rows: { name: string; qty: number }[] }) {
  const total = rows.reduce((s, r) => s + Number(r.qty || 0), 0);
  return (
    <Card>
      <CardHeader><CardTitle className="text-base flex items-center gap-2">{icon} {title}</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow><TableHead>الصنف</TableHead><TableHead className="text-left">كجم</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((r, i) => <TableRow key={i}><TableCell>{r.name}</TableCell><TableCell className="text-left font-medium">{fmt(r.qty)}</TableCell></TableRow>)}
            {rows.length === 0 && <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground">—</TableCell></TableRow>}
          </TableBody>
        </Table>
        <div className="border-t mt-2 pt-2 flex justify-between text-sm font-bold"><span>الإجمالي</span><span>{fmt(total)} كجم</span></div>
      </CardContent>
    </Card>
  );
}
