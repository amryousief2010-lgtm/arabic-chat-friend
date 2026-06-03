import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Factory, Package, Boxes, Coins, Plus, Printer, FileSpreadsheet, CheckCircle2, History, Trash2, ArrowRightLeft, RotateCcw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { openPrintWindow, escapeHtml, fmtNum, fmtDate, COMPANY_AR } from "@/lib/printPdf";

type Raw = { id: string; code: string; name_ar: string; unit: string; stock: number; avg_cost: number; reorder_level: number; last_movement_at: string | null };
type Pack = { id: string; code: string; name_ar: string; product_type: string; unit: string; stock: number; avg_cost: number; reorder_level: number; last_movement_at: string | null };
type Fin = { id: string; code: string; name_ar: string; unit: string; stock: number; avg_prod_cost: number; sale_price: number; reorder_level: number; last_movement_at: string | null };
type Warehouse = { id: string; name: string };

const fmt = (n: number | null | undefined, d = 2) => (n == null ? "—" : Number(n).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: d, maximumFractionDigits: d }));

const STATUS_BADGE = (s: string) => {
  if (s === "posted") return <Badge className="bg-emerald-600">معتمدة</Badge>;
  if (s === "draft") return <Badge variant="outline">مسودة</Badge>;
  if (s === "cancelled") return <Badge variant="destructive">ملغاة</Badge>;
  return <Badge>{s}</Badge>;
};
const TEST_BADGE = (isTest: boolean) => isTest ? <Badge className="bg-amber-500 text-white mr-1">اختبار</Badge> : null;
type ViewMode = "real" | "test" | "all";
const TestToggle = ({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) => (
  <label className="flex items-center gap-2 text-sm border rounded px-2 py-1 bg-amber-50">
    <input type="checkbox" checked={value} onChange={e => onChange(e.target.checked)} />
    <span>وضع اختبار</span>
  </label>
);

const MeatFactoryOps = () => {
  const [raws, setRaws] = useState<Raw[]>([]);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [fins, setFins] = useState<Fin[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [rawPurchases, setRawPurchases] = useState<any[]>([]);
  const [packPurchases, setPackPurchases] = useState<any[]>([]);
  const [mfgInvoices, setMfgInvoices] = useState<any[]>([]);
  const [sales, setSales] = useState<any[]>([]);
  const [returns, setReturns] = useState<any[]>([]);
  const [transfers, setTransfers] = useState<any[]>([]);
  const [treasury, setTreasury] = useState<any[]>([]);
  const [log, setLog] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("real");
  const matchMode = (isTest: boolean) => viewMode === "all" ? true : viewMode === "test" ? isTest : !isTest;

  async function loadAll() {
    setLoading(true);
    const [r1, r2, r3, r4, r5, r6, r7, r8, r9, r10, r11, r12] = await Promise.all([
      supabase.from("meat_raw_inventory").select("*").order("code"),
      supabase.from("meat_packaging_inventory").select("*").order("code"),
      supabase.from("meat_finished_inventory").select("*").order("code"),
      supabase.from("warehouses").select("id,name").order("name"),
      supabase.from("mf_raw_purchases").select("*, items:mf_raw_purchase_items(*, raw:meat_raw_inventory(name_ar,unit))").order("created_at", { ascending: false }).limit(200),
      supabase.from("mf_pack_purchases").select("*, items:mf_pack_purchase_items(*, pack:meat_packaging_inventory(name_ar,unit))").order("created_at", { ascending: false }).limit(200),
      supabase.from("mf_manufacturing").select("*, raw_lines:mf_mfg_raw_lines(*, raw:meat_raw_inventory(name_ar,unit)), pack_lines:mf_mfg_pack_lines(*, pack:meat_packaging_inventory(name_ar,unit)), fin:meat_finished_inventory(name_ar,unit)").order("created_at", { ascending: false }).limit(200),
      supabase.from("mf_sales").select("*, lines:mf_sales_lines(*, fin:meat_finished_inventory(name_ar,unit))").order("created_at", { ascending: false }).limit(200),
      supabase.from("mf_returns").select("*, lines:mf_return_lines(*, fin:meat_finished_inventory(name_ar,unit))").order("created_at", { ascending: false }).limit(200),
      supabase.from("mf_transfers").select("*, lines:mf_transfer_lines(*, fin:meat_finished_inventory(name_ar,unit)), warehouse:warehouses(name)").order("created_at", { ascending: false }).limit(200),
      supabase.from("mf_treasury").select("*").order("created_at", { ascending: false }).limit(500),
      supabase.from("mf_log").select("*").order("created_at", { ascending: false }).limit(1000),
    ]);
    setRaws((r1.data as any) || []);
    setPacks((r2.data as any) || []);
    setFins((r3.data as any) || []);
    setWarehouses((r4.data as any) || []);
    setRawPurchases((r5.data as any) || []);
    setPackPurchases((r6.data as any) || []);
    setMfgInvoices((r7.data as any) || []);
    setSales((r8.data as any) || []);
    setReturns((r9.data as any) || []);
    setTransfers((r10.data as any) || []);
    setTreasury((r11.data as any) || []);
    setLog((r12.data as any) || []);
    setLoading(false);
  }
  useEffect(() => { loadAll(); }, []);

  // ===== Dashboard metrics =====
  const dashboard = useMemo(() => {
    const rawValue = raws.reduce((s, r) => s + r.stock * r.avg_cost, 0);
    const packValue = packs.reduce((s, p) => s + p.stock * p.avg_cost, 0);
    const finValue = fins.reduce((s, f) => s + f.stock * f.avg_prod_cost, 0);
    const treasuryF = treasury.filter(t => matchMode(!!t.is_test));
    const treasuryBalance = treasuryF.reduce((s, t) => s + (t.direction === "IN" ? Number(t.amount) : -Number(t.amount)), 0);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const yearStart = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
    const inDay = (d: string) => new Date(d) >= today;
    const inMonth = (d: string) => new Date(d) >= monthStart;
    const inYear = (d: string) => new Date(d) >= yearStart;

    const postedSales = sales.filter(s => s.status === "posted" && matchMode(!!s.is_test));
    const postedRP = rawPurchases.filter(p => p.status === "posted" && matchMode(!!p.is_test));
    const postedPP = packPurchases.filter(p => p.status === "posted" && matchMode(!!p.is_test));
    const postedRet = returns.filter(r => r.status === "posted" && matchMode(!!r.is_test));

    const salesDay = postedSales.filter(s => inDay(s.posted_at || s.created_at)).reduce((a, s) => a + Number(s.total_amount), 0);
    const salesMonth = postedSales.filter(s => inMonth(s.posted_at || s.created_at)).reduce((a, s) => a + Number(s.total_amount), 0);
    const salesYear = postedSales.filter(s => inYear(s.posted_at || s.created_at)).reduce((a, s) => a + Number(s.total_amount), 0);

    const purchDay = [...postedRP, ...postedPP].filter(p => inDay(p.posted_at || p.created_at)).reduce((a, s) => a + Number(s.total_amount), 0);
    const purchMonth = [...postedRP, ...postedPP].filter(p => inMonth(p.posted_at || p.created_at)).reduce((a, s) => a + Number(s.total_amount), 0);
    const purchYear = [...postedRP, ...postedPP].filter(p => inYear(p.posted_at || p.created_at)).reduce((a, s) => a + Number(s.total_amount), 0);

    const retDay = postedRet.filter(r => inDay(r.posted_at || r.created_at)).reduce((a, r) => a + Number(r.total_amount), 0);
    const retMonth = postedRet.filter(r => inMonth(r.posted_at || r.created_at)).reduce((a, r) => a + Number(r.total_amount), 0);
    const retYear = postedRet.filter(r => inYear(r.posted_at || r.created_at)).reduce((a, r) => a + Number(r.total_amount), 0);

    const totalCogs = postedSales.reduce((a, s) => a + Number(s.total_cost), 0);
    const totalProfit = postedSales.reduce((a, s) => a + Number(s.profit), 0);
    const netSales = salesYear - retYear;

    const profitByProduct: Record<string, { name: string; profit: number; qty: number }> = {};
    postedSales.forEach(s => {
      (s.lines || []).forEach((l: any) => {
        const k = l.fin?.name_ar || l.finished_id;
        if (!profitByProduct[k]) profitByProduct[k] = { name: k, profit: 0, qty: 0 };
        profitByProduct[k].profit += (Number(l.unit_price) - Number(l.cost_snapshot)) * Number(l.qty);
        profitByProduct[k].qty += Number(l.qty);
      });
    });
    const sorted = Object.values(profitByProduct).sort((a, b) => b.profit - a.profit);
    const topProduct = sorted[0];
    const worstProduct = sorted[sorted.length - 1];

    return { rawValue, packValue, finValue, treasuryBalance, salesDay, salesMonth, salesYear, purchDay, purchMonth, purchYear, retDay, retMonth, retYear, totalCogs, totalProfit, netSales, topProduct, worstProduct };
  }, [raws, packs, fins, treasury, sales, rawPurchases, packPurchases, returns, viewMode]);

  const filteredLog = useMemo(() => log.filter(l => matchMode(!!l.is_test)), [log, viewMode]);
  const filteredTreasury = useMemo(() => treasury.filter(t => matchMode(!!t.is_test)), [treasury, viewMode]);

  // ===== Post handlers =====
  async function post(rpc: string, id: string) {
    const { error } = await supabase.rpc(rpc as any, { p_id: id });
    if (error) { toast.error(error.message); return false; }
    toast.success("تم الاعتماد");
    await loadAll();
    return true;
  }

  // ===== Excel export =====
  function exportSheet(name: string, rows: any[]) {
    if (!rows.length) { toast.warning("لا توجد بيانات"); return; }
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
    XLSX.writeFile(wb, `${name}-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  // ===== Print helpers =====
  function printDoc(title: string, docType: string, docNo: string, status: string, headers: string[], rows: string[][], totals?: { label: string; value: string }[], notes?: string) {
    const body = `
      <header>
        <div><h1>${escapeHtml(COMPANY_AR)} — مصنع اللحوم</h1><div class="en">${escapeHtml(docType)}</div></div>
        <div class="meta">
          رقم المستند: <b>${escapeHtml(docNo)}</b><br/>
          التاريخ: ${escapeHtml(fmtDate(new Date().toISOString()))}<br/>
          الحالة: ${escapeHtml(status)}
        </div>
      </header>
      <h2>${escapeHtml(title)}</h2>
      <table>
        <thead><tr>${headers.map(h => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>
        <tbody>${rows.map(r => `<tr>${r.map(c => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>
      ${totals ? `<table style="width:50%;margin-right:auto"><tbody>${totals.map(t => `<tr><td><b>${escapeHtml(t.label)}</b></td><td>${escapeHtml(t.value)}</td></tr>`).join("")}</tbody></table>` : ""}
      ${notes ? `<p><b>ملاحظات:</b> ${escapeHtml(notes)}</p>` : ""}
      <div style="margin-top:40px;display:flex;justify-content:space-between;font-size:11px">
        <div>توقيع المسؤول: ________________</div>
        <div>توقيع المدير: ________________</div>
        <div>توقيع المستلم: ________________</div>
      </div>
    `;
    openPrintWindow(`${docType} - ${docNo}`, body);
  }

  return (
    <DashboardLayout>
      <div dir="rtl" className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Factory className="h-7 w-7 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">مصنع اللحوم — التشغيل الكامل</h1>
              <p className="text-sm text-muted-foreground">دورة كاملة: مخازن، فواتير، خزنة، سجل حركات</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Select value={viewMode} onValueChange={(v: any) => setViewMode(v)}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="real">حركات حقيقية فقط</SelectItem>
                <SelectItem value="test">حركات اختبار فقط</SelectItem>
                <SelectItem value="all">عرض الكل</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={loadAll} disabled={loading}><RotateCcw className="h-4 w-4 ml-2" />تحديث</Button>
          </div>
        </div>
        {viewMode !== "real" && (
          <div className="bg-amber-100 border border-amber-300 text-amber-900 rounded p-2 text-sm text-center">
            وضع العرض الحالي: {viewMode === "test" ? "حركات الاختبار فقط — لا تدخل في التقارير الحقيقية" : "كل الحركات (حقيقية + اختبار)"}
          </div>
        )}

        <Tabs defaultValue="dashboard" className="w-full">
          <TabsList className="flex flex-wrap h-auto">
            <TabsTrigger value="dashboard">لوحة التحكم</TabsTrigger>
            <TabsTrigger value="raw">مخزن الخامات</TabsTrigger>
            <TabsTrigger value="pack">مخزن التغليف</TabsTrigger>
            <TabsTrigger value="fin">المنتجات الجاهزة</TabsTrigger>
            <TabsTrigger value="rawpurchase">شراء خامات</TabsTrigger>
            <TabsTrigger value="packpurchase">شراء تغليف</TabsTrigger>
            <TabsTrigger value="mfg">فواتير تصنيع</TabsTrigger>
            <TabsTrigger value="sales">فواتير بيع</TabsTrigger>
            <TabsTrigger value="returns">مرتجع مبيعات</TabsTrigger>
            <TabsTrigger value="transfers">نقل للمخزن الرئيسي</TabsTrigger>
            <TabsTrigger value="treasury">الخزنة</TabsTrigger>
            <TabsTrigger value="log">سجل الحركات</TabsTrigger>
          </TabsList>

          {/* ===== DASHBOARD ===== */}
          <TabsContent value="dashboard" className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KPI title="قيمة مخزن الخامات" value={fmt(dashboard.rawValue)} icon={Boxes} />
              <KPI title="قيمة علب التغليف" value={fmt(dashboard.packValue)} icon={Package} />
              <KPI title="قيمة المنتجات الجاهزة" value={fmt(dashboard.finValue)} icon={Boxes} />
              <KPI title="رصيد الخزنة" value={fmt(dashboard.treasuryBalance)} icon={Coins} accent={dashboard.treasuryBalance < 0 ? "text-red-600" : "text-emerald-600"} />
              <KPI title="مبيعات اليوم" value={fmt(dashboard.salesDay)} />
              <KPI title="مبيعات الشهر" value={fmt(dashboard.salesMonth)} />
              <KPI title="مبيعات السنة" value={fmt(dashboard.salesYear)} />
              <KPI title="صافي المبيعات" value={fmt(dashboard.netSales)} />
              <KPI title="مشتريات اليوم" value={fmt(dashboard.purchDay)} />
              <KPI title="مشتريات الشهر" value={fmt(dashboard.purchMonth)} />
              <KPI title="مشتريات السنة" value={fmt(dashboard.purchYear)} />
              <KPI title="مرتجعات السنة" value={fmt(dashboard.retYear)} />
              <KPI title="تكلفة المباع" value={fmt(dashboard.totalCogs)} />
              <KPI title="إجمالي الربح" value={fmt(dashboard.totalProfit)} accent={dashboard.totalProfit < 0 ? "text-red-600" : "text-emerald-600"} />
              <KPI title="أعلى منتج ربحية" value={dashboard.topProduct ? `${dashboard.topProduct.name} (${fmt(dashboard.topProduct.profit)})` : "—"} />
              <KPI title="أقل منتج ربحية" value={dashboard.worstProduct ? `${dashboard.worstProduct.name} (${fmt(dashboard.worstProduct.profit)})` : "—"} />
            </div>
          </TabsContent>

          {/* ===== RAW INVENTORY ===== */}
          <TabsContent value="raw">
            <InventoryCard title="مخزن خامات مصنع اللحوم (غذائية)" items={raws.map(r => ({ code: r.code, name: r.name_ar, unit: r.unit, stock: r.stock, avg: r.avg_cost, total: r.stock * r.avg_cost, alert: r.reorder_level, last: r.last_movement_at }))} onExcel={() => exportSheet("خامات-اللحوم", raws)} onPrint={() => printDoc("جرد مخزن الخامات الغذائية", "تقرير مخزون", "RAW-INV", "حالي", ["الكود", "الاسم", "الوحدة", "الرصيد", "متوسط التكلفة", "الإجمالي"], raws.map(r => [r.code, r.name_ar, r.unit, fmt(r.stock), fmt(r.avg_cost), fmt(r.stock * r.avg_cost)]))} />
          </TabsContent>

          <TabsContent value="pack">
            <InventoryCard title="مخزن التغليف والتعبئة (4 أصناف)" items={packs.map(p => ({ code: p.code, name: p.name_ar, unit: p.unit, stock: p.stock, avg: p.avg_cost, total: p.stock * p.avg_cost, alert: p.reorder_level, last: p.last_movement_at }))} onExcel={() => exportSheet("تغليف-اللحوم", packs)} onPrint={() => printDoc("جرد مخزن التغليف", "تقرير مخزون", "PACK-INV", "حالي", ["الكود", "الاسم", "الوحدة", "الرصيد", "تكلفة العلبة", "الإجمالي"], packs.map(p => [p.code, p.name_ar, p.unit, fmt(p.stock), fmt(p.avg_cost), fmt(p.stock * p.avg_cost)]))} />
          </TabsContent>

          <TabsContent value="fin">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>المنتجات الجاهزة</CardTitle>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => exportSheet("منتجات-جاهزة", fins)}><FileSpreadsheet className="h-4 w-4 ml-1" />Excel</Button>
                  <Button size="sm" variant="outline" onClick={() => printDoc("جرد المنتجات الجاهزة", "تقرير مخزون", "FIN-INV", "حالي", ["الكود", "الاسم", "الرصيد", "متوسط التكلفة", "سعر البيع", "الإجمالي"], fins.map(f => [f.code, f.name_ar, fmt(f.stock), fmt(f.avg_prod_cost), fmt(f.sale_price), fmt(f.stock * f.avg_prod_cost)]))}><Printer className="h-4 w-4 ml-1" />طباعة</Button>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow><TableHead>الكود</TableHead><TableHead>الاسم</TableHead><TableHead>الرصيد</TableHead><TableHead>متوسط تكلفة الإنتاج</TableHead><TableHead>سعر البيع</TableHead><TableHead>الإجمالي</TableHead><TableHead>آخر حركة</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {fins.map(f => (
                      <TableRow key={f.id}>
                        <TableCell className="font-mono text-xs">{f.code}</TableCell>
                        <TableCell>{f.name_ar}</TableCell>
                        <TableCell>{fmt(f.stock)} {f.unit}</TableCell>
                        <TableCell>{fmt(f.avg_prod_cost)}</TableCell>
                        <TableCell>{fmt(f.sale_price)}</TableCell>
                        <TableCell>{fmt(f.stock * f.avg_prod_cost)}</TableCell>
                        <TableCell className="text-xs">{f.last_movement_at ? fmtDate(f.last_movement_at) : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ===== PURCHASES ===== */}
          <TabsContent value="rawpurchase">
            <RawPurchaseTab raws={raws} list={rawPurchases} onReload={loadAll} onPost={(id) => post("post_mf_raw_purchase", id)} onPrint={printDoc} onExcel={exportSheet} />
          </TabsContent>

          <TabsContent value="packpurchase">
            <PackPurchaseTab packs={packs} list={packPurchases} onReload={loadAll} onPost={(id) => post("post_mf_pack_purchase", id)} onPrint={printDoc} onExcel={exportSheet} />
          </TabsContent>

          {/* ===== MANUFACTURING ===== */}
          <TabsContent value="mfg">
            <ManufacturingTab raws={raws} packs={packs} fins={fins} list={mfgInvoices} onReload={loadAll} onPost={(id) => post("post_mf_manufacturing", id)} onPrint={printDoc} onExcel={exportSheet} />
          </TabsContent>

          {/* ===== SALES ===== */}
          <TabsContent value="sales">
            <SalesTab fins={fins} list={sales} onReload={loadAll} onPost={(id) => post("post_mf_sale", id)} onPrint={printDoc} onExcel={exportSheet} />
          </TabsContent>

          {/* ===== RETURNS ===== */}
          <TabsContent value="returns">
            <ReturnsTab fins={fins} sales={sales} list={returns} onReload={loadAll} onPost={(id) => post("post_mf_return", id)} onPrint={printDoc} onExcel={exportSheet} />
          </TabsContent>

          {/* ===== TRANSFERS ===== */}
          <TabsContent value="transfers">
            <TransfersTab fins={fins} warehouses={warehouses} list={transfers} onReload={loadAll} onPost={(id) => post("post_mf_transfer", id)} onPrint={printDoc} onExcel={exportSheet} />
          </TabsContent>

          {/* ===== TREASURY ===== */}
          <TabsContent value="treasury">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>خزنة مصنع اللحوم — الرصيد: <span className={dashboard.treasuryBalance < 0 ? "text-red-600" : "text-emerald-600"}>{fmt(dashboard.treasuryBalance)} ج.م</span></CardTitle>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => exportSheet("خزنة-اللحوم", filteredTreasury)}><FileSpreadsheet className="h-4 w-4 ml-1" />Excel</Button>
                  <Button size="sm" variant="outline" onClick={() => printDoc("حركات الخزنة", "تقرير خزنة", "TREASURY", "حالي", ["التاريخ", "النوع", "المبلغ", "المصدر", "المرجع", "ملاحظات"], filteredTreasury.map(t => [fmtDate(t.txn_date), t.direction === "IN" ? "داخل" : "خارج", fmt(t.amount), t.source_type, t.ref_no || "—", t.notes || "—"]))}><Printer className="h-4 w-4 ml-1" />طباعة</Button>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow><TableHead>التاريخ</TableHead><TableHead>الاتجاه</TableHead><TableHead>المبلغ</TableHead><TableHead>المصدر</TableHead><TableHead>المرجع</TableHead><TableHead>الملاحظات</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {filteredTreasury.map(t => (
                      <TableRow key={t.id} className={t.is_test ? "bg-amber-50" : ""}>
                        <TableCell className="text-xs">{fmtDate(t.txn_date)} {TEST_BADGE(!!t.is_test)}</TableCell>
                        <TableCell>{t.direction === "IN" ? <Badge className="bg-emerald-600">داخل</Badge> : <Badge className="bg-orange-600">خارج</Badge>}</TableCell>
                        <TableCell className="font-bold">{fmt(t.amount)}</TableCell>
                        <TableCell className="text-xs">{t.source_type}</TableCell>
                        <TableCell className="text-xs font-mono">{t.ref_no || "—"}</TableCell>
                        <TableCell className="text-xs">{t.notes}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ===== UNIFIED LOG ===== */}
          <TabsContent value="log">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2"><History className="h-5 w-5" />سجل الحركات الموحد ({filteredLog.length}/{log.length})</CardTitle>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => exportSheet("سجل-حركات-اللحوم", filteredLog)}><FileSpreadsheet className="h-4 w-4 ml-1" />Excel</Button>
                  <Button size="sm" variant="outline" onClick={() => printDoc("سجل حركات مصنع اللحوم", "سجل حركات", "LOG", "—", ["رقم", "التاريخ", "النوع", "اتجاه", "اختبار", "الصنف", "الكمية", "الوحدة", "القيمة", "من", "إلى", "المرجع"], filteredLog.map(l => [l.movement_no, fmtDate(l.movement_date), l.movement_type, l.direction, l.is_test ? "نعم" : "—", l.item_name || "—", fmt(l.qty), l.unit || "—", fmt(l.total_value), l.from_party || "—", l.to_party || "—", l.ref_no || "—"]))}><Printer className="h-4 w-4 ml-1" />طباعة</Button>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow><TableHead>رقم الحركة</TableHead><TableHead>التاريخ</TableHead><TableHead>النوع</TableHead><TableHead>اتجاه</TableHead><TableHead>الصنف</TableHead><TableHead>الكمية</TableHead><TableHead>القيمة</TableHead><TableHead>من</TableHead><TableHead>إلى</TableHead><TableHead>المرجع</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {filteredLog.map(l => (
                      <TableRow key={l.id} className={l.is_test ? "bg-amber-50" : l.movement_type?.startsWith("cancel_") ? "bg-red-50" : ""}>
                        <TableCell className="text-xs font-mono">{l.movement_no} {TEST_BADGE(!!l.is_test)}{l.movement_type?.startsWith("cancel_") && <Badge variant="destructive" className="mr-1">إلغاء</Badge>}</TableCell>
                        <TableCell className="text-xs">{fmtDate(l.movement_date)}</TableCell>
                        <TableCell className="text-xs">{l.movement_type}</TableCell>
                        <TableCell>{l.direction === "IN" ? <Badge className="bg-emerald-600">داخل</Badge> : l.direction === "OUT" ? <Badge className="bg-orange-600">خارج</Badge> : <Badge variant="secondary">—</Badge>}</TableCell>
                        <TableCell className="text-xs">{l.item_name || "—"}</TableCell>
                        <TableCell>{l.qty ? `${fmt(l.qty)} ${l.unit || ""}` : "—"}</TableCell>
                        <TableCell>{fmt(l.total_value)}</TableCell>
                        <TableCell className="text-xs">{l.from_party || "—"}</TableCell>
                        <TableCell className="text-xs">{l.to_party || "—"}</TableCell>
                        <TableCell className="text-xs font-mono">{l.ref_no || "—"}</TableCell>
                      </TableRow>
                    ))}
                    {!filteredLog.length && <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-6">لا توجد حركات بهذا الفلتر</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
};

// ===== Helper Components =====

const KPI = ({ title, value, icon: Icon, accent }: any) => (
  <Card>
    <CardContent className="p-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">{title}</div>
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
      </div>
      <div className={`text-lg font-bold mt-1 ${accent || ""}`}>{value}</div>
    </CardContent>
  </Card>
);

const InventoryCard = ({ title, items, onExcel, onPrint }: any) => (
  <Card>
    <CardHeader className="flex flex-row items-center justify-between">
      <CardTitle>{title}</CardTitle>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={onExcel}><FileSpreadsheet className="h-4 w-4 ml-1" />Excel</Button>
        <Button size="sm" variant="outline" onClick={onPrint}><Printer className="h-4 w-4 ml-1" />طباعة</Button>
      </div>
    </CardHeader>
    <CardContent>
      <Table>
        <TableHeader><TableRow><TableHead>الكود</TableHead><TableHead>الاسم</TableHead><TableHead>الوحدة</TableHead><TableHead>الرصيد</TableHead><TableHead>متوسط التكلفة</TableHead><TableHead>الإجمالي</TableHead><TableHead>حد التنبيه</TableHead><TableHead>آخر حركة</TableHead></TableRow></TableHeader>
        <TableBody>
          {items.map((i: any) => (
            <TableRow key={i.code} className={i.stock <= i.alert && i.alert > 0 ? "bg-red-50" : ""}>
              <TableCell className="font-mono text-xs">{i.code}</TableCell>
              <TableCell>{i.name}</TableCell>
              <TableCell>{i.unit}</TableCell>
              <TableCell className="font-bold">{fmt(i.stock)}</TableCell>
              <TableCell>{fmt(i.avg)}</TableCell>
              <TableCell>{fmt(i.total)}</TableCell>
              <TableCell className="text-xs">{i.alert}</TableCell>
              <TableCell className="text-xs">{i.last ? fmtDate(i.last) : "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </CardContent>
  </Card>
);

// ===== Raw Purchase Tab =====
const RawPurchaseTab = ({ raws, list, onReload, onPost, onPrint, onExcel }: any) => {
  const [open, setOpen] = useState(false);
  const [supplier, setSupplier] = useState("");
  const [pmethod, setPmethod] = useState<"cash" | "credit">("cash");
  const [notes, setNotes] = useState("");
  const [isTest, setIsTest] = useState(false);
  const [lines, setLines] = useState<{ raw_id: string; qty: string; unit_price: string }[]>([{ raw_id: "", qty: "", unit_price: "" }]);

  async function create() {
    if (!supplier) return toast.error("أدخل اسم المورد");
    const valid = lines.filter(l => l.raw_id && Number(l.qty) > 0 && Number(l.unit_price) >= 0);
    if (!valid.length) return toast.error("أضف صف واحد على الأقل");
    const total = valid.reduce((s, l) => s + Number(l.qty) * Number(l.unit_price), 0);
    const { data: { user } } = await supabase.auth.getUser();
    const { data: inv, error } = await supabase.from("mf_raw_purchases").insert({ supplier, payment_method: pmethod, total_amount: total, notes, is_test: isTest, created_by: user?.id }).select().single();
    if (error || !inv) return toast.error(error?.message || "خطأ");
    const itemRows = valid.map(l => ({ purchase_id: inv.id, raw_id: l.raw_id, qty: Number(l.qty), unit_price: Number(l.unit_price), total: Number(l.qty) * Number(l.unit_price) }));
    const { error: e2 } = await supabase.from("mf_raw_purchase_items").insert(itemRows);
    if (e2) return toast.error(e2.message);
    toast.success(isTest ? "تم إنشاء فاتورة اختبار" : "تم إنشاء الفاتورة كمسودة");
    setOpen(false); setSupplier(""); setNotes(""); setIsTest(false); setLines([{ raw_id: "", qty: "", unit_price: "" }]);
    onReload();
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>فواتير شراء الخامات</CardTitle>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => onExcel("شراء-خامات", list.map((p: any) => ({ invoice_no: p.invoice_no, date: p.invoice_date, supplier: p.supplier, method: p.payment_method, total: p.total_amount, status: p.status })))}><FileSpreadsheet className="h-4 w-4 ml-1" />Excel</Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 ml-1" />فاتورة جديدة</Button></DialogTrigger>
            <DialogContent dir="rtl" className="max-w-3xl">
              <DialogHeader><DialogTitle>فاتورة شراء خامات جديدة</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <div><Label>المورد</Label><Input value={supplier} onChange={e => setSupplier(e.target.value)} /></div>
                  <div><Label>طريقة الدفع</Label>
                    <Select value={pmethod} onValueChange={(v: any) => setPmethod(v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="cash">نقدي</SelectItem><SelectItem value="credit">آجل</SelectItem></SelectContent>
                    </Select>
                  </div>
                  <div><Label>ملاحظات</Label><Input value={notes} onChange={e => setNotes(e.target.value)} /></div>
                </div>
                <div>
                  <Label>الأصناف</Label>
                  {lines.map((l, i) => (
                    <div key={i} className="grid grid-cols-12 gap-2 mt-1">
                      <Select value={l.raw_id} onValueChange={v => setLines(lines.map((x, j) => j === i ? { ...x, raw_id: v } : x))}>
                        <SelectTrigger className="col-span-5"><SelectValue placeholder="اختر خامة" /></SelectTrigger>
                        <SelectContent>{raws.map((r: Raw) => <SelectItem key={r.id} value={r.id}>{r.name_ar}</SelectItem>)}</SelectContent>
                      </Select>
                      <Input className="col-span-2" type="number" placeholder="الكمية" value={l.qty} onChange={e => setLines(lines.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} />
                      <Input className="col-span-3" type="number" placeholder="سعر الوحدة" value={l.unit_price} onChange={e => setLines(lines.map((x, j) => j === i ? { ...x, unit_price: e.target.value } : x))} />
                      <div className="col-span-1 text-sm pt-2">{fmt(Number(l.qty) * Number(l.unit_price))}</div>
                      <Button className="col-span-1" size="icon" variant="ghost" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  ))}
                  <Button size="sm" variant="outline" className="mt-2" onClick={() => setLines([...lines, { raw_id: "", qty: "", unit_price: "" }])}><Plus className="h-4 w-4 ml-1" />إضافة صف</Button>
                </div>
                <div className="text-left font-bold">الإجمالي: {fmt(lines.reduce((s, l) => s + Number(l.qty) * Number(l.unit_price), 0))} ج.م</div>
              </div>
              <DialogFooter className="gap-2"><TestToggle value={isTest} onChange={setIsTest} /><Button onClick={create}>حفظ كمسودة</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow><TableHead>رقم</TableHead><TableHead>التاريخ</TableHead><TableHead>المورد</TableHead><TableHead>طريقة</TableHead><TableHead>الإجمالي</TableHead><TableHead>الحالة</TableHead><TableHead>إجراءات</TableHead></TableRow></TableHeader>
          <TableBody>
            {list.map((p: any) => (
              <TableRow key={p.id}>
                <TableCell className="font-mono text-xs">{p.invoice_no} {TEST_BADGE(!!p.is_test)}</TableCell>
                <TableCell className="text-xs">{p.invoice_date}</TableCell>
                <TableCell>{p.supplier}</TableCell>
                <TableCell>{p.payment_method === "cash" ? "نقدي" : "آجل"}</TableCell>
                <TableCell className="font-bold">{fmt(p.total_amount)}</TableCell>
                <TableCell>{STATUS_BADGE(p.status)}</TableCell>
                <TableCell className="flex gap-1">
                  {p.status === "draft" && <Button size="sm" onClick={() => onPost(p.id)}><CheckCircle2 className="h-4 w-4 ml-1" />اعتماد</Button>}
                  <Button size="icon" variant="outline" onClick={() => onPrint("فاتورة شراء خامات", "فاتورة شراء خامات", p.invoice_no, p.status, ["الصنف", "الكمية", "الوحدة", "السعر", "الإجمالي"], (p.items || []).map((it: any) => [it.raw?.name_ar, fmt(it.qty), it.raw?.unit, fmt(it.unit_price), fmt(it.total)]), [{ label: "الإجمالي", value: fmt(p.total_amount) }, { label: "طريقة الدفع", value: p.payment_method === "cash" ? "نقدي" : "آجل" }], p.notes)}><Printer className="h-4 w-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
            {!list.length && <TableRow><TableCell colSpan={7} className="text-center py-6 text-muted-foreground">لا توجد فواتير</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
};

// ===== Pack Purchase Tab =====
const PackPurchaseTab = ({ packs, list, onReload, onPost, onPrint, onExcel }: any) => {
  const [open, setOpen] = useState(false);
  const [supplier, setSupplier] = useState("");
  const [pmethod, setPmethod] = useState<"cash" | "credit">("cash");
  const [notes, setNotes] = useState("");
  const [isTest, setIsTest] = useState(false);
  const [lines, setLines] = useState<{ pack_id: string; qty: string; unit_price: string }[]>([{ pack_id: "", qty: "", unit_price: "" }]);

  async function create() {
    if (!supplier) return toast.error("أدخل المورد");
    const valid = lines.filter(l => l.pack_id && Number(l.qty) > 0 && Number(l.unit_price) >= 0);
    if (!valid.length) return toast.error("أضف صف");
    const total = valid.reduce((s, l) => s + Number(l.qty) * Number(l.unit_price), 0);
    const { data: { user } } = await supabase.auth.getUser();
    const { data: inv, error } = await supabase.from("mf_pack_purchases").insert({ supplier, payment_method: pmethod, total_amount: total, notes, created_by: user?.id }).select().single();
    if (error || !inv) return toast.error(error?.message || "خطأ");
    const itemRows = valid.map(l => ({ purchase_id: inv.id, pack_id: l.pack_id, qty: Number(l.qty), unit_price: Number(l.unit_price), total: Number(l.qty) * Number(l.unit_price) }));
    const { error: e2 } = await supabase.from("mf_pack_purchase_items").insert(itemRows);
    if (e2) return toast.error(e2.message);
    toast.success("تم الإنشاء");
    setOpen(false); setSupplier(""); setNotes(""); setLines([{ pack_id: "", qty: "", unit_price: "" }]);
    onReload();
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>فواتير شراء التغليف</CardTitle>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => onExcel("شراء-تغليف", list)}><FileSpreadsheet className="h-4 w-4 ml-1" />Excel</Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 ml-1" />فاتورة جديدة</Button></DialogTrigger>
            <DialogContent dir="rtl" className="max-w-3xl">
              <DialogHeader><DialogTitle>فاتورة شراء تغليف جديدة</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <div><Label>المورد</Label><Input value={supplier} onChange={e => setSupplier(e.target.value)} /></div>
                  <div><Label>طريقة الدفع</Label>
                    <Select value={pmethod} onValueChange={(v: any) => setPmethod(v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="cash">نقدي</SelectItem><SelectItem value="credit">آجل</SelectItem></SelectContent>
                    </Select>
                  </div>
                  <div><Label>ملاحظات</Label><Input value={notes} onChange={e => setNotes(e.target.value)} /></div>
                </div>
                <div>
                  <Label>الأصناف</Label>
                  {lines.map((l, i) => (
                    <div key={i} className="grid grid-cols-12 gap-2 mt-1">
                      <Select value={l.pack_id} onValueChange={v => setLines(lines.map((x, j) => j === i ? { ...x, pack_id: v } : x))}>
                        <SelectTrigger className="col-span-5"><SelectValue placeholder="اختر علبة" /></SelectTrigger>
                        <SelectContent>{packs.map((p: Pack) => <SelectItem key={p.id} value={p.id}>{p.name_ar}</SelectItem>)}</SelectContent>
                      </Select>
                      <Input className="col-span-2" type="number" placeholder="العدد" value={l.qty} onChange={e => setLines(lines.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} />
                      <Input className="col-span-3" type="number" placeholder="سعر العلبة" value={l.unit_price} onChange={e => setLines(lines.map((x, j) => j === i ? { ...x, unit_price: e.target.value } : x))} />
                      <div className="col-span-1 text-sm pt-2">{fmt(Number(l.qty) * Number(l.unit_price))}</div>
                      <Button className="col-span-1" size="icon" variant="ghost" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  ))}
                  <Button size="sm" variant="outline" className="mt-2" onClick={() => setLines([...lines, { pack_id: "", qty: "", unit_price: "" }])}><Plus className="h-4 w-4 ml-1" />صف</Button>
                </div>
                <div className="text-left font-bold">الإجمالي: {fmt(lines.reduce((s, l) => s + Number(l.qty) * Number(l.unit_price), 0))}</div>
              </div>
              <DialogFooter><Button onClick={create}>حفظ كمسودة</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow><TableHead>رقم</TableHead><TableHead>التاريخ</TableHead><TableHead>المورد</TableHead><TableHead>طريقة</TableHead><TableHead>الإجمالي</TableHead><TableHead>الحالة</TableHead><TableHead>إجراءات</TableHead></TableRow></TableHeader>
          <TableBody>
            {list.map((p: any) => (
              <TableRow key={p.id}>
                <TableCell className="font-mono text-xs">{p.invoice_no}</TableCell>
                <TableCell className="text-xs">{p.invoice_date}</TableCell>
                <TableCell>{p.supplier}</TableCell>
                <TableCell>{p.payment_method === "cash" ? "نقدي" : "آجل"}</TableCell>
                <TableCell className="font-bold">{fmt(p.total_amount)}</TableCell>
                <TableCell>{STATUS_BADGE(p.status)}</TableCell>
                <TableCell className="flex gap-1">
                  {p.status === "draft" && <Button size="sm" onClick={() => onPost(p.id)}><CheckCircle2 className="h-4 w-4 ml-1" />اعتماد</Button>}
                  <Button size="icon" variant="outline" onClick={() => onPrint("فاتورة شراء تغليف", "فاتورة شراء تغليف", p.invoice_no, p.status, ["العلبة", "العدد", "السعر", "الإجمالي"], (p.items || []).map((it: any) => [it.pack?.name_ar, fmt(it.qty), fmt(it.unit_price), fmt(it.total)]), [{ label: "الإجمالي", value: fmt(p.total_amount) }], p.notes)}><Printer className="h-4 w-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
};

// ===== Manufacturing Tab =====
const ManufacturingTab = ({ raws, packs, fins, list, onReload, onPost, onPrint, onExcel }: any) => {
  const [open, setOpen] = useState(false);
  const [finishedId, setFinishedId] = useState("");
  const [producedQty, setProducedQty] = useState("");
  const [extraCost, setExtraCost] = useState("");
  const [notes, setNotes] = useState("");
  const [rawLines, setRawLines] = useState<{ raw_id: string; qty: string }[]>([{ raw_id: "", qty: "" }]);
  const [packLines, setPackLines] = useState<{ pack_id: string; qty: string }[]>([{ pack_id: "", qty: "" }]);

  async function create() {
    if (!finishedId || !producedQty || Number(producedQty) <= 0) return toast.error("اختر المنتج والكمية");
    const validRaws = rawLines.filter(l => l.raw_id && Number(l.qty) > 0);
    if (!validRaws.length) return toast.error("أضف خامة واحدة على الأقل");
    const validPacks = packLines.filter(l => l.pack_id && Number(l.qty) > 0);
    const { data: { user } } = await supabase.auth.getUser();
    const { data: inv, error } = await supabase.from("mf_manufacturing").insert({ finished_id: finishedId, produced_qty: Number(producedQty), extra_cost: Number(extraCost || 0), notes, created_by: user?.id }).select().single();
    if (error || !inv) return toast.error(error?.message || "خطأ");
    if (validRaws.length) {
      const { error: e1 } = await supabase.from("mf_mfg_raw_lines").insert(validRaws.map(l => ({ mfg_id: inv.id, raw_id: l.raw_id, qty: Number(l.qty) })));
      if (e1) return toast.error(e1.message);
    }
    if (validPacks.length) {
      const { error: e2 } = await supabase.from("mf_mfg_pack_lines").insert(validPacks.map(l => ({ mfg_id: inv.id, pack_id: l.pack_id, qty: Number(l.qty) })));
      if (e2) return toast.error(e2.message);
    }
    toast.success("تم إنشاء فاتورة التصنيع");
    setOpen(false); setFinishedId(""); setProducedQty(""); setExtraCost(""); setNotes("");
    setRawLines([{ raw_id: "", qty: "" }]); setPackLines([{ pack_id: "", qty: "" }]);
    onReload();
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>فواتير التصنيع</CardTitle>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => onExcel("تصنيع-لحوم", list)}><FileSpreadsheet className="h-4 w-4 ml-1" />Excel</Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 ml-1" />فاتورة تصنيع</Button></DialogTrigger>
            <DialogContent dir="rtl" className="max-w-4xl max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>فاتورة تصنيع جديدة</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="border rounded p-3 bg-purple-50">
                  <div className="font-bold mb-2">1. المنتج النهائي</div>
                  <div className="grid grid-cols-3 gap-2">
                    <div><Label>المنتج</Label>
                      <Select value={finishedId} onValueChange={setFinishedId}>
                        <SelectTrigger><SelectValue placeholder="اختر منتج جاهز" /></SelectTrigger>
                        <SelectContent>{fins.map((f: Fin) => <SelectItem key={f.id} value={f.id}>{f.name_ar}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div><Label>الكمية المنتجة</Label><Input type="number" value={producedQty} onChange={e => setProducedQty(e.target.value)} /></div>
                    <div><Label>مصروف تصنيع إضافي</Label><Input type="number" value={extraCost} onChange={e => setExtraCost(e.target.value)} /></div>
                  </div>
                </div>

                <div className="border rounded p-3 bg-orange-50">
                  <div className="font-bold mb-2">2. خامات غذائية مستخدمة (من مخزن الخامات)</div>
                  {rawLines.map((l, i) => (
                    <div key={i} className="grid grid-cols-12 gap-2 mt-1">
                      <Select value={l.raw_id} onValueChange={v => setRawLines(rawLines.map((x, j) => j === i ? { ...x, raw_id: v } : x))}>
                        <SelectTrigger className="col-span-7"><SelectValue placeholder="اختر خامة" /></SelectTrigger>
                        <SelectContent>{raws.map((r: Raw) => <SelectItem key={r.id} value={r.id}>{r.name_ar} (متوفر: {fmt(r.stock)} {r.unit})</SelectItem>)}</SelectContent>
                      </Select>
                      <Input className="col-span-4" type="number" placeholder="الكمية" value={l.qty} onChange={e => setRawLines(rawLines.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} />
                      <Button className="col-span-1" size="icon" variant="ghost" onClick={() => setRawLines(rawLines.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  ))}
                  <Button size="sm" variant="outline" className="mt-2" onClick={() => setRawLines([...rawLines, { raw_id: "", qty: "" }])}><Plus className="h-4 w-4 ml-1" />خامة</Button>
                </div>

                <div className="border rounded p-3 bg-blue-50">
                  <div className="font-bold mb-2">3. مواد التعبئة المستخدمة (اختياري)</div>
                  {packLines.map((l, i) => (
                    <div key={i} className="grid grid-cols-12 gap-2 mt-1">
                      <Select value={l.pack_id} onValueChange={v => setPackLines(packLines.map((x, j) => j === i ? { ...x, pack_id: v } : x))}>
                        <SelectTrigger className="col-span-7"><SelectValue placeholder="اختر علبة" /></SelectTrigger>
                        <SelectContent>{packs.map((p: Pack) => <SelectItem key={p.id} value={p.id}>{p.name_ar} (متوفر: {fmt(p.stock)})</SelectItem>)}</SelectContent>
                      </Select>
                      <Input className="col-span-4" type="number" placeholder="العدد" value={l.qty} onChange={e => setPackLines(packLines.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} />
                      <Button className="col-span-1" size="icon" variant="ghost" onClick={() => setPackLines(packLines.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  ))}
                  <Button size="sm" variant="outline" className="mt-2" onClick={() => setPackLines([...packLines, { pack_id: "", qty: "" }])}><Plus className="h-4 w-4 ml-1" />علبة</Button>
                </div>

                <div><Label>ملاحظات</Label><Textarea value={notes} onChange={e => setNotes(e.target.value)} /></div>
              </div>
              <DialogFooter><Button onClick={create}>حفظ كمسودة</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow><TableHead>رقم</TableHead><TableHead>التاريخ</TableHead><TableHead>المنتج</TableHead><TableHead>الكمية</TableHead><TableHead>تكلفة كلية</TableHead><TableHead>تكلفة/وحدة</TableHead><TableHead>الحالة</TableHead><TableHead>إجراءات</TableHead></TableRow></TableHeader>
          <TableBody>
            {list.map((m: any) => (
              <TableRow key={m.id}>
                <TableCell className="font-mono text-xs">{m.invoice_no}</TableCell>
                <TableCell className="text-xs">{m.invoice_date}</TableCell>
                <TableCell>{m.fin?.name_ar}</TableCell>
                <TableCell>{fmt(m.produced_qty)}</TableCell>
                <TableCell className="font-bold">{fmt(m.total_cost)}</TableCell>
                <TableCell>{fmt(m.unit_cost)}</TableCell>
                <TableCell>{STATUS_BADGE(m.status)}</TableCell>
                <TableCell className="flex gap-1">
                  {m.status === "draft" && <Button size="sm" onClick={() => onPost(m.id)}><CheckCircle2 className="h-4 w-4 ml-1" />اعتماد</Button>}
                  <Button size="icon" variant="outline" onClick={() => {
                    const rows: string[][] = [];
                    rows.push(["المنتج النهائي", m.fin?.name_ar, fmt(m.produced_qty), "", fmt(m.total_cost)]);
                    (m.raw_lines || []).forEach((r: any) => rows.push(["خامة: " + (r.raw?.name_ar || ""), "", fmt(r.qty), fmt(r.unit_cost), fmt(r.total)]));
                    (m.pack_lines || []).forEach((p: any) => rows.push(["علبة: " + (p.pack?.name_ar || ""), "", fmt(p.qty), fmt(p.unit_cost), fmt(p.total)]));
                    onPrint("فاتورة تصنيع", "فاتورة تصنيع", m.invoice_no, m.status, ["البيان", "المنتج", "الكمية", "تكلفة/وحدة", "الإجمالي"], rows, [{ label: "تكلفة الخامات", value: fmt(m.raw_cost) }, { label: "تكلفة التغليف", value: fmt(m.pack_cost) }, { label: "مصروف إضافي", value: fmt(m.extra_cost) }, { label: "إجمالي التشغيلة", value: fmt(m.total_cost) }, { label: "تكلفة الوحدة", value: fmt(m.unit_cost) }], m.notes);
                  }}><Printer className="h-4 w-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
};

// ===== Sales Tab =====
const SalesTab = ({ fins, list, onReload, onPost, onPrint, onExcel }: any) => {
  const [open, setOpen] = useState(false);
  const [customer, setCustomer] = useState("");
  const [pmethod, setPmethod] = useState<"cash" | "credit">("cash");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<{ finished_id: string; qty: string; unit_price: string }[]>([{ finished_id: "", qty: "", unit_price: "" }]);

  async function create() {
    if (!customer) return toast.error("أدخل العميل");
    const valid = lines.filter(l => l.finished_id && Number(l.qty) > 0 && Number(l.unit_price) >= 0);
    if (!valid.length) return toast.error("أضف صف");
    const total = valid.reduce((s, l) => s + Number(l.qty) * Number(l.unit_price), 0);
    const { data: { user } } = await supabase.auth.getUser();
    const { data: inv, error } = await supabase.from("mf_sales").insert({ customer, payment_method: pmethod, total_amount: total, notes, created_by: user?.id }).select().single();
    if (error || !inv) return toast.error(error?.message || "خطأ");
    const itemRows = valid.map(l => ({ sale_id: inv.id, finished_id: l.finished_id, qty: Number(l.qty), unit_price: Number(l.unit_price), total: Number(l.qty) * Number(l.unit_price) }));
    const { error: e2 } = await supabase.from("mf_sales_lines").insert(itemRows);
    if (e2) return toast.error(e2.message);
    toast.success("تم الإنشاء"); setOpen(false); setCustomer(""); setNotes(""); setLines([{ finished_id: "", qty: "", unit_price: "" }]);
    onReload();
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>فواتير البيع</CardTitle>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => onExcel("مبيعات-لحوم", list.map((s: any) => ({ invoice_no: s.invoice_no, date: s.invoice_date, customer: s.customer, method: s.payment_method, total: s.total_amount, cost: s.total_cost, profit: s.profit, status: s.status })))}><FileSpreadsheet className="h-4 w-4 ml-1" />Excel</Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 ml-1" />فاتورة بيع</Button></DialogTrigger>
            <DialogContent dir="rtl" className="max-w-3xl">
              <DialogHeader><DialogTitle>فاتورة بيع جديدة</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <div><Label>العميل</Label><Input value={customer} onChange={e => setCustomer(e.target.value)} /></div>
                  <div><Label>طريقة الدفع</Label>
                    <Select value={pmethod} onValueChange={(v: any) => setPmethod(v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="cash">نقدي</SelectItem><SelectItem value="credit">آجل</SelectItem></SelectContent>
                    </Select>
                  </div>
                  <div><Label>ملاحظات</Label><Input value={notes} onChange={e => setNotes(e.target.value)} /></div>
                </div>
                <div>
                  <Label>الأصناف</Label>
                  {lines.map((l, i) => (
                    <div key={i} className="grid grid-cols-12 gap-2 mt-1">
                      <Select value={l.finished_id} onValueChange={v => setLines(lines.map((x, j) => j === i ? { ...x, finished_id: v } : x))}>
                        <SelectTrigger className="col-span-5"><SelectValue placeholder="منتج" /></SelectTrigger>
                        <SelectContent>{fins.map((f: Fin) => <SelectItem key={f.id} value={f.id}>{f.name_ar} (متوفر: {fmt(f.stock)})</SelectItem>)}</SelectContent>
                      </Select>
                      <Input className="col-span-2" type="number" placeholder="الكمية" value={l.qty} onChange={e => setLines(lines.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} />
                      <Input className="col-span-3" type="number" placeholder="السعر" value={l.unit_price} onChange={e => setLines(lines.map((x, j) => j === i ? { ...x, unit_price: e.target.value } : x))} />
                      <div className="col-span-1 text-sm pt-2">{fmt(Number(l.qty) * Number(l.unit_price))}</div>
                      <Button className="col-span-1" size="icon" variant="ghost" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  ))}
                  <Button size="sm" variant="outline" className="mt-2" onClick={() => setLines([...lines, { finished_id: "", qty: "", unit_price: "" }])}><Plus className="h-4 w-4 ml-1" />صف</Button>
                </div>
                <div className="text-left font-bold">الإجمالي: {fmt(lines.reduce((s, l) => s + Number(l.qty) * Number(l.unit_price), 0))}</div>
              </div>
              <DialogFooter><Button onClick={create}>حفظ كمسودة</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow><TableHead>رقم</TableHead><TableHead>التاريخ</TableHead><TableHead>العميل</TableHead><TableHead>طريقة</TableHead><TableHead>الإجمالي</TableHead><TableHead>التكلفة</TableHead><TableHead>الربح</TableHead><TableHead>الحالة</TableHead><TableHead>إجراءات</TableHead></TableRow></TableHeader>
          <TableBody>
            {list.map((s: any) => (
              <TableRow key={s.id}>
                <TableCell className="font-mono text-xs">{s.invoice_no}</TableCell>
                <TableCell className="text-xs">{s.invoice_date}</TableCell>
                <TableCell>{s.customer}</TableCell>
                <TableCell>{s.payment_method === "cash" ? "نقدي" : "آجل"}</TableCell>
                <TableCell className="font-bold">{fmt(s.total_amount)}</TableCell>
                <TableCell>{fmt(s.total_cost)}</TableCell>
                <TableCell className={Number(s.profit) >= 0 ? "text-emerald-600 font-bold" : "text-red-600 font-bold"}>{fmt(s.profit)}</TableCell>
                <TableCell>{STATUS_BADGE(s.status)}</TableCell>
                <TableCell className="flex gap-1">
                  {s.status === "draft" && <Button size="sm" onClick={() => onPost(s.id)}><CheckCircle2 className="h-4 w-4 ml-1" />اعتماد</Button>}
                  <Button size="icon" variant="outline" onClick={() => onPrint("فاتورة بيع", "فاتورة بيع", s.invoice_no, s.status, ["المنتج", "الكمية", "السعر", "الإجمالي"], (s.lines || []).map((l: any) => [l.fin?.name_ar, fmt(l.qty), fmt(l.unit_price), fmt(l.total)]), [{ label: "الإجمالي", value: fmt(s.total_amount) }, { label: "التكلفة", value: fmt(s.total_cost) }, { label: "الربح", value: fmt(s.profit) }], s.notes)}><Printer className="h-4 w-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
};

// ===== Returns Tab =====
const ReturnsTab = ({ fins, sales, list, onReload, onPost, onPrint, onExcel }: any) => {
  const [open, setOpen] = useState(false);
  const [customer, setCustomer] = useState("");
  const [originalSale, setOriginalSale] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<{ finished_id: string; qty: string; unit_price: string }[]>([{ finished_id: "", qty: "", unit_price: "" }]);

  async function create() {
    if (!customer) return toast.error("أدخل العميل");
    const valid = lines.filter(l => l.finished_id && Number(l.qty) > 0);
    if (!valid.length) return toast.error("أضف صف");
    const total = valid.reduce((s, l) => s + Number(l.qty) * Number(l.unit_price), 0);
    const { data: { user } } = await supabase.auth.getUser();
    const { data: inv, error } = await supabase.from("mf_returns").insert({ customer, original_sale_id: originalSale || null, reason, notes, total_amount: total, created_by: user?.id }).select().single();
    if (error || !inv) return toast.error(error?.message || "خطأ");
    const itemRows = valid.map(l => ({ return_id: inv.id, finished_id: l.finished_id, qty: Number(l.qty), unit_price: Number(l.unit_price), total: Number(l.qty) * Number(l.unit_price) }));
    const { error: e2 } = await supabase.from("mf_return_lines").insert(itemRows);
    if (e2) return toast.error(e2.message);
    toast.success("تم الإنشاء"); setOpen(false); setCustomer(""); setReason(""); setNotes(""); setOriginalSale(""); setLines([{ finished_id: "", qty: "", unit_price: "" }]);
    onReload();
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>مرتجع المبيعات</CardTitle>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => onExcel("مرتجعات-لحوم", list)}><FileSpreadsheet className="h-4 w-4 ml-1" />Excel</Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 ml-1" />مرتجع جديد</Button></DialogTrigger>
            <DialogContent dir="rtl" className="max-w-3xl">
              <DialogHeader><DialogTitle>مرتجع مبيعات جديد</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <div><Label>العميل</Label><Input value={customer} onChange={e => setCustomer(e.target.value)} /></div>
                  <div><Label>فاتورة البيع الأصلية</Label>
                    <Select value={originalSale} onValueChange={setOriginalSale}>
                      <SelectTrigger><SelectValue placeholder="اختياري" /></SelectTrigger>
                      <SelectContent>{sales.filter((s: any) => s.status === "posted").map((s: any) => <SelectItem key={s.id} value={s.id}>{s.invoice_no} - {s.customer}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div><Label>السبب</Label><Input value={reason} onChange={e => setReason(e.target.value)} /></div>
                </div>
                {lines.map((l, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2">
                    <Select value={l.finished_id} onValueChange={v => setLines(lines.map((x, j) => j === i ? { ...x, finished_id: v } : x))}>
                      <SelectTrigger className="col-span-5"><SelectValue placeholder="المنتج" /></SelectTrigger>
                      <SelectContent>{fins.map((f: Fin) => <SelectItem key={f.id} value={f.id}>{f.name_ar}</SelectItem>)}</SelectContent>
                    </Select>
                    <Input className="col-span-2" type="number" placeholder="الكمية" value={l.qty} onChange={e => setLines(lines.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} />
                    <Input className="col-span-3" type="number" placeholder="السعر" value={l.unit_price} onChange={e => setLines(lines.map((x, j) => j === i ? { ...x, unit_price: e.target.value } : x))} />
                    <div className="col-span-1 text-sm pt-2">{fmt(Number(l.qty) * Number(l.unit_price))}</div>
                    <Button className="col-span-1" size="icon" variant="ghost" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                ))}
                <Button size="sm" variant="outline" onClick={() => setLines([...lines, { finished_id: "", qty: "", unit_price: "" }])}><Plus className="h-4 w-4 ml-1" />صف</Button>
                <Textarea placeholder="ملاحظات" value={notes} onChange={e => setNotes(e.target.value)} />
              </div>
              <DialogFooter><Button onClick={create}>حفظ كمسودة</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow><TableHead>رقم</TableHead><TableHead>التاريخ</TableHead><TableHead>العميل</TableHead><TableHead>السبب</TableHead><TableHead>الإجمالي</TableHead><TableHead>الحالة</TableHead><TableHead>إجراءات</TableHead></TableRow></TableHeader>
          <TableBody>
            {list.map((r: any) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs">{r.return_no}</TableCell>
                <TableCell className="text-xs">{r.return_date}</TableCell>
                <TableCell>{r.customer}</TableCell>
                <TableCell className="text-xs">{r.reason || "—"}</TableCell>
                <TableCell className="font-bold">{fmt(r.total_amount)}</TableCell>
                <TableCell>{STATUS_BADGE(r.status)}</TableCell>
                <TableCell className="flex gap-1">
                  {r.status === "draft" && <Button size="sm" onClick={() => onPost(r.id)}><CheckCircle2 className="h-4 w-4 ml-1" />اعتماد</Button>}
                  <Button size="icon" variant="outline" onClick={() => onPrint("مرتجع مبيعات", "مرتجع مبيعات", r.return_no, r.status, ["المنتج", "الكمية", "السعر", "الإجمالي"], (r.lines || []).map((l: any) => [l.fin?.name_ar, fmt(l.qty), fmt(l.unit_price), fmt(l.total)]), [{ label: "الإجمالي", value: fmt(r.total_amount) }, { label: "السبب", value: r.reason || "—" }], r.notes)}><Printer className="h-4 w-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
};

// ===== Transfers Tab =====
const TransfersTab = ({ fins, warehouses, list, onReload, onPost, onPrint, onExcel }: any) => {
  const [open, setOpen] = useState(false);
  const [destId, setDestId] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<{ finished_id: string; qty: string }[]>([{ finished_id: "", qty: "" }]);

  async function create() {
    if (!destId) return toast.error("اختر المخزن الوجهة");
    const valid = lines.filter(l => l.finished_id && Number(l.qty) > 0);
    if (!valid.length) return toast.error("أضف صف");
    const { data: { user } } = await supabase.auth.getUser();
    const { data: inv, error } = await supabase.from("mf_transfers").insert({ destination_warehouse_id: destId, notes, created_by: user?.id }).select().single();
    if (error || !inv) return toast.error(error?.message || "خطأ");
    const itemRows = valid.map(l => ({ transfer_id: inv.id, finished_id: l.finished_id, qty: Number(l.qty) }));
    const { error: e2 } = await supabase.from("mf_transfer_lines").insert(itemRows);
    if (e2) return toast.error(e2.message);
    toast.success("تم الإنشاء"); setOpen(false); setNotes(""); setDestId(""); setLines([{ finished_id: "", qty: "" }]);
    onReload();
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>نقل للمخزن الرئيسي</CardTitle>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => onExcel("نقل-للرئيسي", list)}><FileSpreadsheet className="h-4 w-4 ml-1" />Excel</Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 ml-1" />أمر نقل</Button></DialogTrigger>
            <DialogContent dir="rtl" className="max-w-3xl">
              <DialogHeader><DialogTitle>أمر نقل للمخزن الرئيسي</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>المخزن الوجهة</Label>
                  <Select value={destId} onValueChange={setDestId}>
                    <SelectTrigger><SelectValue placeholder="اختر مخزن" /></SelectTrigger>
                    <SelectContent>{warehouses.map((w: Warehouse) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                {lines.map((l, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2">
                    <Select value={l.finished_id} onValueChange={v => setLines(lines.map((x, j) => j === i ? { ...x, finished_id: v } : x))}>
                      <SelectTrigger className="col-span-8"><SelectValue placeholder="المنتج" /></SelectTrigger>
                      <SelectContent>{fins.map((f: Fin) => <SelectItem key={f.id} value={f.id}>{f.name_ar} (متوفر: {fmt(f.stock)})</SelectItem>)}</SelectContent>
                    </Select>
                    <Input className="col-span-3" type="number" placeholder="الكمية" value={l.qty} onChange={e => setLines(lines.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} />
                    <Button className="col-span-1" size="icon" variant="ghost" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                ))}
                <Button size="sm" variant="outline" onClick={() => setLines([...lines, { finished_id: "", qty: "" }])}><Plus className="h-4 w-4 ml-1" />صف</Button>
                <Textarea placeholder="ملاحظات" value={notes} onChange={e => setNotes(e.target.value)} />
              </div>
              <DialogFooter><Button onClick={create}>حفظ كمسودة</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow><TableHead>رقم</TableHead><TableHead>التاريخ</TableHead><TableHead>الوجهة</TableHead><TableHead>القيمة</TableHead><TableHead>الحالة</TableHead><TableHead>إجراءات</TableHead></TableRow></TableHeader>
          <TableBody>
            {list.map((t: any) => (
              <TableRow key={t.id}>
                <TableCell className="font-mono text-xs">{t.transfer_no}</TableCell>
                <TableCell className="text-xs">{t.transfer_date}</TableCell>
                <TableCell>{t.warehouse?.name}</TableCell>
                <TableCell className="font-bold">{fmt(t.total_value)}</TableCell>
                <TableCell>{STATUS_BADGE(t.status)}</TableCell>
                <TableCell className="flex gap-1">
                  {t.status === "draft" && <Button size="sm" onClick={() => onPost(t.id)}><CheckCircle2 className="h-4 w-4 ml-1" />اعتماد</Button>}
                  <Button size="icon" variant="outline" onClick={() => onPrint("أمر نقل للمخزن الرئيسي", "أمر نقل", t.transfer_no, t.status, ["المنتج", "الكمية", "تكلفة/وحدة", "الإجمالي"], (t.lines || []).map((l: any) => [l.fin?.name_ar, fmt(l.qty), fmt(l.unit_cost), fmt(l.total)]), [{ label: "إجمالي القيمة", value: fmt(t.total_value) }, { label: "المخزن الوجهة", value: t.warehouse?.name || "—" }], t.notes)}><Printer className="h-4 w-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
};

export default MeatFactoryOps;
