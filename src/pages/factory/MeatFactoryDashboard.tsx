import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts";
import { Factory, AlertTriangle, Beef, Package, Wallet, Truck, ShoppingCart, Boxes, TrendingDown, CheckCircle2, FileText } from "lucide-react";
import { cairoMonthStartUTC, cairoTodayStartUTC, currentCairoYearMonth } from "@/lib/cairoDate";

const PURPLE = "#7c3aed", ORANGE = "#ea580c", BLUE = "#2563eb", AMBER = "#d97706", GREEN = "#059669", RED = "#dc2626";
const fmt = (n: any) => Number(n || 0).toLocaleString("ar-EG", { maximumFractionDigits: 2 });

type Range = "today" | "week" | "month" | "custom";

function rangeBounds(r: Range, from?: string, to?: string): { fromDate: Date; toDate: Date; label: string } {
  const now = new Date();
  if (r === "today") return { fromDate: cairoTodayStartUTC(now), toDate: now, label: "اليوم" };
  if (r === "week") {
    const d = new Date(cairoTodayStartUTC(now));
    d.setUTCDate(d.getUTCDate() - 6);
    return { fromDate: d, toDate: now, label: "آخر 7 أيام" };
  }
  if (r === "custom" && from && to) return { fromDate: new Date(from), toDate: new Date(to + "T23:59:59"), label: `${from} → ${to}` };
  const { year, monthIndex0 } = currentCairoYearMonth(now);
  return { fromDate: cairoMonthStartUTC(year, monthIndex0), toDate: now, label: "هذا الشهر" };
}

function classify(m: any): "slaughter" | "purchase" | "manufacturing" | "adjustment" {
  const r = (m.ref_table || "").toLowerCase();
  const reason = (m.reason || "");
  if (r === "slaughter_batch_outputs" || reason.includes("المجزر")) return "slaughter";
  if (r === "meat_factory_purchases" || reason.includes("شراء")) return "purchase";
  if (r === "meat_manufacturing_invoices" || r === "meat_factory_manufacturing" || reason.includes("تصنيع")) return "manufacturing";
  return "adjustment";
}

export default function MeatFactoryDashboard() {
  const [range, setRange] = useState<Range>("month");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [productFilter, setProductFilter] = useState<string>("all");

  const b = rangeBounds(range, from, to);
  const fromISO = b.fromDate.toISOString();
  const toISO = b.toDate.toISOString();

  const { data: items = [] } = useQuery({
    queryKey: ["mfd-items"],
    queryFn: async () => (await supabase.from("meat_factory_raw_items" as any).select("*")).data || [],
  });
  const { data: moves = [] } = useQuery({
    queryKey: ["mfd-moves", fromISO, toISO],
    queryFn: async () => (await supabase.from("meat_factory_inventory_moves" as any).select("*").gte("created_at", fromISO).lte("created_at", toISO).order("created_at", { ascending: false })).data || [],
  });
  const { data: allMoves = [] } = useQuery({
    queryKey: ["mfd-moves-recent"],
    queryFn: async () => (await supabase.from("meat_factory_inventory_moves" as any).select("*").order("created_at", { ascending: false }).limit(50)).data || [],
  });
  const { data: invoices = [] } = useQuery({
    queryKey: ["mfd-inv", fromISO, toISO],
    queryFn: async () => (await supabase.from("meat_manufacturing_invoices" as any).select("*").gte("created_at", fromISO).lte("created_at", toISO).order("created_at", { ascending: false })).data || [],
  });
  const { data: allInvoices = [] } = useQuery({
    queryKey: ["mfd-allinv"],
    queryFn: async () => (await supabase.from("meat_manufacturing_invoices" as any).select("id,invoice_no,product_name,status,created_at").order("created_at", { ascending: false }).limit(50)).data || [],
  });
  // Approved invoices in range + line counts to exclude lineless invoices
  const { data: invoiceLines = [] } = useQuery({
    queryKey: ["mfd-invlines", fromISO, toISO],
    queryFn: async () => {
      const ids = (invoices as any[]).map(i => i.id);
      if (!ids.length) return [];
      return (await supabase.from("meat_manufacturing_invoice_lines" as any).select("*").in("invoice_id", ids)).data || [];
    },
    enabled: (invoices as any[]).length > 0,
  });

  const itemsArr = items as any[];
  const movesArr = moves as any[];
  const invoicesArr = invoices as any[];
  const linesArr = invoiceLines as any[];

  // Stock value cards
  const stockStats = useMemo(() => {
    const valBy = (k: string) => itemsArr.filter(i => i.kind === k && i.is_active !== false).reduce((s, i) => s + Number(i.current_stock) * Number(i.avg_cost || 0), 0);
    const rawVal = valBy("raw"), spiceVal = valBy("spice"), packVal = valBy("packaging");
    const lowCount = itemsArr.filter(i => Number(i.current_stock) > 0 && Number(i.current_stock) <= Number(i.low_stock_threshold || 0)).length;
    const zeroCount = itemsArr.filter(i => i.is_active !== false && Number(i.current_stock) <= 0).length;
    return { rawVal, spiceVal, packVal, totalVal: rawVal + spiceVal + packVal, lowCount, zeroCount };
  }, [itemsArr]);

  // Period moves aggregated
  const moveStats = useMemo(() => {
    const acc = { slaughterQty: 0, slaughterVal: 0, purchaseQty: 0, purchaseVal: 0, mfgQty: 0, mfgVal: 0 };
    for (const m of movesArr) {
      if (kindFilter !== "all" && m.item_kind !== kindFilter) continue;
      const k = classify(m);
      const qty = Number(m.quantity || 0);
      const val = qty * Number(m.unit_cost || 0);
      if (k === "slaughter" && m.direction === "IN") { acc.slaughterQty += qty; acc.slaughterVal += val; }
      else if (k === "purchase" && m.direction === "IN") { acc.purchaseQty += qty; acc.purchaseVal += val; }
      else if (k === "manufacturing" && m.direction === "OUT") { acc.mfgQty += qty; acc.mfgVal += val; }
    }
    return acc;
  }, [movesArr, kindFilter]);

  // Approved invoices with lines only
  const approvedWithLines = useMemo(() => {
    const lineCountByInv: Record<string, number> = {};
    for (const l of linesArr) lineCountByInv[l.invoice_id] = (lineCountByInv[l.invoice_id] || 0) + 1;
    return invoicesArr.filter(i => i.status === "approved" || i.status === "transferred").filter(i => (lineCountByInv[i.id] || 0) > 0);
  }, [invoicesArr, linesArr]);

  const invoiceStats = useMemo(() => {
    const filt = productFilter === "all" ? approvedWithLines : approvedWithLines.filter(i => i.product_name === productFilter);
    const count = filt.length;
    const totalCost = filt.reduce((s, i) => s + Number(i.total_manufacturing_cost || i.materials_total_cost || 0), 0);
    const totalQty = filt.reduce((s, i) => s + Number(i.finished_qty || 0), 0);
    return { count, totalCost, totalQty };
  }, [approvedWithLines, productFilter]);

  // Production table by product
  const productionByProduct = useMemo(() => {
    const linesByInv: Record<string, any[]> = {};
    for (const l of linesArr) (linesByInv[l.invoice_id] ||= []).push(l);
    const m: Record<string, any> = {};
    for (const inv of approvedWithLines) {
      const key = inv.product_name || "—";
      if (!m[key]) m[key] = { product: key, invoices: 0, qty: 0, raw: 0, spice: 0, pack: 0, total: 0, last: inv.created_at };
      m[key].invoices += 1;
      m[key].qty += Number(inv.finished_qty || 0);
      m[key].raw += Number(inv.raw_cost || 0);
      m[key].spice += Number(inv.spice_cost || 0);
      m[key].pack += Number(inv.packaging_cost || 0);
      m[key].total += Number(inv.total_manufacturing_cost || inv.materials_total_cost || 0);
      if (new Date(inv.created_at) > new Date(m[key].last)) m[key].last = inv.created_at;
    }
    return Object.values(m).map((r: any) => ({ ...r, avg: r.qty > 0 ? r.total / r.qty : 0 })).sort((a: any, b: any) => b.total - a.total);
  }, [approvedWithLines, linesArr]);

  // Product list for filter
  const productOptions = useMemo(() => Array.from(new Set(approvedWithLines.map(i => i.product_name).filter(Boolean))) as string[], [approvedWithLines]);

  // Charts data
  const chartProd = productionByProduct.slice(0, 10).map((r: any) => ({ name: String(r.product).slice(0, 18), qty: r.qty, total: r.total }));
  const chartMoves = [
    { name: "وارد المجزر", value: moveStats.slaughterQty, fill: RED },
    { name: "وارد مشتريات", value: moveStats.purchaseQty, fill: BLUE },
    { name: "صرف تصنيع", value: moveStats.mfgQty, fill: PURPLE },
  ];
  const chartStockPie = [
    { name: "خامات", value: stockStats.rawVal, fill: BLUE },
    { name: "بهارات", value: stockStats.spiceVal, fill: AMBER },
    { name: "تغليف", value: stockStats.packVal, fill: GREEN },
  ];

  // Latest operations
  const latestOps = useMemo(() => {
    const ops: any[] = [];
    for (const m of (allMoves as any[]).slice(0, 20)) {
      const k = classify(m);
      ops.push({
        date: m.created_at,
        type: k === "slaughter" ? "وارد من المجزر" : k === "purchase" ? "وارد مشتريات" : k === "manufacturing" ? "صرف تصنيع" : "تسوية",
        ref: m.ref_table || "—",
        item: m.item_name,
        qty: m.quantity,
        value: Number(m.quantity || 0) * Number(m.unit_cost || 0),
        status: m.direction === "IN" ? "وارد" : "صرف",
        kind: k,
      });
    }
    for (const inv of (allInvoices as any[]).slice(0, 10)) {
      ops.push({
        date: inv.status === "approved" ? (inv as any).approved_at || inv.created_at : inv.created_at,
        type: inv.status === "approved" ? "اعتماد فاتورة تصنيع" : inv.status === "draft" ? "فاتورة تصنيع جديدة" : `فاتورة ${inv.status}`,
        ref: inv.invoice_no,
        item: inv.product_name,
        qty: null, value: null,
        status: inv.status,
        kind: "invoice",
      });
    }
    return ops.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 10);
  }, [allMoves, allInvoices]);

  // Alerts
  const alerts = useMemo(() => {
    const lowItems = itemsArr.filter(i => Number(i.current_stock) > 0 && Number(i.current_stock) <= Number(i.low_stock_threshold || 0));
    const zeroItems = itemsArr.filter(i => i.is_active !== false && Number(i.current_stock) <= 0);
    const drafts = (allInvoices as any[]).filter(i => i.status === "draft");
    const lineCountByInv: Record<string, number> = {};
    for (const l of linesArr) lineCountByInv[l.invoice_id] = (lineCountByInv[l.invoice_id] || 0) + 1;
    const noLines = invoicesArr.filter(i => (lineCountByInv[i.id] || 0) === 0 && i.status !== "cancelled");
    const lowPack = lowItems.filter(i => i.kind === "packaging");
    // Items received from slaughter but not consumed in 14 days
    const cutoff = Date.now() - 14 * 86400000;
    const slaughterIn: Record<string, string> = {};
    const mfgOut: Record<string, string> = {};
    for (const m of allMoves as any[]) {
      const k = classify(m);
      if (k === "slaughter" && m.direction === "IN" && !slaughterIn[m.item_id]) slaughterIn[m.item_id] = m.created_at;
      if (k === "manufacturing" && m.direction === "OUT" && !mfgOut[m.item_id]) mfgOut[m.item_id] = m.created_at;
    }
    const idleSlaughter = Object.keys(slaughterIn).filter(id => {
      const lastIn = new Date(slaughterIn[id]).getTime();
      const lastOut = mfgOut[id] ? new Date(mfgOut[id]).getTime() : 0;
      return lastIn < cutoff && lastOut < lastIn;
    }).map(id => itemsArr.find(i => i.id === id)?.name).filter(Boolean) as string[];
    return { lowItems, zeroItems, drafts, noLines, lowPack, idleSlaughter };
  }, [itemsArr, invoicesArr, allInvoices, linesArr, allMoves]);

  return (
    <DashboardLayout>
      <div dir="rtl" className="p-4 md:p-6 space-y-4">
        <div className="flex items-center gap-3">
          <Factory className="h-7 w-7 text-purple-600" />
          <div>
            <h1 className="text-2xl font-bold">Dashboard مصنع اللحوم</h1>
            <p className="text-sm text-muted-foreground">مؤشرات المخزون والتصنيع — {b.label}</p>
          </div>
        </div>

        {/* Filters */}
        <Card><CardContent className="pt-4 flex flex-wrap gap-2 items-center">
          {([["today","اليوم"],["week","هذا الأسبوع"],["month","هذا الشهر"],["custom","من-إلى"]] as [Range,string][]).map(([k, l]) => (
            <Button key={k} size="sm" variant={range === k ? "default" : "outline"} className={range === k ? "bg-purple-600 hover:bg-purple-700" : ""} onClick={() => setRange(k)}>{l}</Button>
          ))}
          {range === "custom" && (
            <>
              <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-40" />
              <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-40" />
            </>
          )}
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">النوع:</span>
            <Select value={kindFilter} onValueChange={setKindFilter}>
              <SelectTrigger className="w-32 h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                <SelectItem value="raw">خامات</SelectItem>
                <SelectItem value="spice">بهارات</SelectItem>
                <SelectItem value="packaging">تغليف</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">المنتج:</span>
            <Select value={productFilter} onValueChange={setProductFilter}>
              <SelectTrigger className="w-44 h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل المنتجات</SelectItem>
                {productOptions.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent></Card>

        {/* Main stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat to="/meat-factory/raw-inventory" icon={Wallet} color="text-purple-700" label="إجمالي قيمة المخزون" value={`${fmt(stockStats.totalVal)} ج`} big />
          <Stat to="/meat-factory/raw-inventory?f=raw" icon={Beef} color="text-blue-600" label="قيمة الخامات" value={`${fmt(stockStats.rawVal)} ج`} />
          <Stat to="/meat-factory/raw-inventory?f=spice" icon={Beef} color="text-amber-600" label="قيمة البهارات" value={`${fmt(stockStats.spiceVal)} ج`} />
          <Stat to="/meat-factory/raw-inventory?f=packaging" icon={Package} color="text-emerald-600" label="قيمة التغليف" value={`${fmt(stockStats.packVal)} ج`} />

          <Stat to="/meat-factory/raw-inventory#moves" icon={Truck} color="text-rose-600" label={`وارد المجزر — ${b.label}`} value={`${fmt(moveStats.slaughterQty)} كجم`} hint={`${fmt(moveStats.slaughterVal)} ج`} />
          <Stat to="/meat-factory/purchase-invoices" icon={ShoppingCart} color="text-blue-600" label={`مشتريات — ${b.label}`} value={`${fmt(moveStats.purchaseQty)} وحدة`} hint={`${fmt(moveStats.purchaseVal)} ج`} />
          <Stat to="/meat-factory/raw-inventory#moves" icon={Boxes} color="text-purple-600" label={`صرف تصنيع — ${b.label}`} value={`${fmt(moveStats.mfgQty)} وحدة`} hint={`${fmt(moveStats.mfgVal)} ج`} />
          <Stat to="/meat-factory/manufacturing" icon={FileText} color="text-orange-600" label={`فواتير تصنيع — ${b.label}`} value={String(invoiceStats.count)} hint={`إجمالي ${fmt(invoiceStats.totalCost)} ج`} />

          <Stat icon={CheckCircle2} color="text-emerald-700" label={`كمية مصنعة — ${b.label}`} value={`${fmt(invoiceStats.totalQty)} كجم`} hint={invoiceStats.totalQty > 0 ? `متوسط ${fmt(invoiceStats.totalCost / invoiceStats.totalQty)} ج/كجم` : "—"} />
          <Stat to="/meat-factory/raw-inventory?f=low" icon={TrendingDown} color="text-amber-600" label="أصناف منخفضة" value={String(stockStats.lowCount)} />
          <Stat to="/meat-factory/raw-inventory?f=zero" icon={AlertTriangle} color="text-red-600" label="أصناف نفدت" value={String(stockStats.zeroCount)} />
          <Stat to="/meat-factory/recipes" icon={FileText} color="text-purple-600" label="تركيبات التصنيع" value="9 تركيبات" hint="مرجع جاهز" />
        </div>

        {/* Alerts */}
        {(alerts.lowItems.length || alerts.zeroItems.length || alerts.drafts.length || alerts.noLines.length || alerts.lowPack.length || alerts.idleSlaughter.length) > 0 && (
          <Card className="border-amber-300 bg-amber-50/40 dark:bg-amber-950/20">
            <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-600" />التنبيهات الذكية</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap gap-2 text-sm">
              {alerts.zeroItems.length > 0 && <Link to="/meat-factory/raw-inventory?f=zero"><Badge variant="destructive">{alerts.zeroItems.length} أصناف نفدت</Badge></Link>}
              {alerts.lowItems.length > 0 && <Link to="/meat-factory/raw-inventory?f=low"><Badge className="bg-amber-600">{alerts.lowItems.length} أصناف منخفضة</Badge></Link>}
              {alerts.lowPack.length > 0 && <Badge className="bg-emerald-700">{alerts.lowPack.length} خامات تغليف منخفضة</Badge>}
              {alerts.drafts.length > 0 && <Link to="/meat-factory/manufacturing"><Badge className="bg-slate-600">{alerts.drafts.length} فواتير تصنيع مسودة</Badge></Link>}
              {alerts.noLines.length > 0 && <Badge variant="destructive">{alerts.noLines.length} فواتير بدون بنود</Badge>}
              {alerts.idleSlaughter.length > 0 && <Badge className="bg-rose-700">{alerts.idleSlaughter.length} أصناف من المجزر لم تُستخدم منذ 14 يوم</Badge>}
            </CardContent>
          </Card>
        )}

        {/* Charts */}
        <div className="grid md:grid-cols-2 gap-4">
          <Card><CardHeader><CardTitle className="text-base">إنتاج الشهر حسب المنتج (كمية)</CardTitle></CardHeader>
            <CardContent className="h-64">
              <ResponsiveContainer><BarChart data={chartProd}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" tick={{ fontSize: 10 }} /><YAxis /><Tooltip /><Bar dataKey="qty" fill={PURPLE} /></BarChart></ResponsiveContainer>
            </CardContent>
          </Card>
          <Card><CardHeader><CardTitle className="text-base">تكلفة التصنيع حسب المنتج</CardTitle></CardHeader>
            <CardContent className="h-64">
              <ResponsiveContainer><BarChart data={chartProd}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" tick={{ fontSize: 10 }} /><YAxis /><Tooltip /><Bar dataKey="total" fill={ORANGE} /></BarChart></ResponsiveContainer>
            </CardContent>
          </Card>
          <Card><CardHeader><CardTitle className="text-base">حركة المخزون — {b.label}</CardTitle></CardHeader>
            <CardContent className="h-64">
              <ResponsiveContainer><BarChart data={chartMoves}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" /><YAxis /><Tooltip /><Bar dataKey="value">{chartMoves.map((c, i) => <Cell key={i} fill={c.fill} />)}</Bar></BarChart></ResponsiveContainer>
            </CardContent>
          </Card>
          <Card><CardHeader><CardTitle className="text-base">قيمة المخزون حسب النوع</CardTitle></CardHeader>
            <CardContent className="h-64">
              <ResponsiveContainer><PieChart><Pie data={chartStockPie} dataKey="value" nameKey="name" outerRadius={80} label={(p:any) => `${p.name}: ${fmt(p.value)}`}>{chartStockPie.map((c, i) => <Cell key={i} fill={c.fill} />)}</Pie><Tooltip /><Legend /></PieChart></ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* Production table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">إنتاج مصنع اللحوم — {b.label}</CardTitle>
            <CardDescription>فواتير معتمدة فقط (تستثني المسودات والملغاة وبدون بنود)</CardDescription>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>المنتج</TableHead><TableHead>عدد الفواتير</TableHead><TableHead>الكمية المصنعة</TableHead>
                <TableHead>خامات</TableHead><TableHead>بهارات</TableHead><TableHead>تغليف</TableHead>
                <TableHead>إجمالي التكلفة</TableHead><TableHead>متوسط الكيلو</TableHead><TableHead>آخر تاريخ</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {productionByProduct.length === 0 ? (
                  <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">لا توجد فواتير معتمدة في هذه الفترة</TableCell></TableRow>
                ) : productionByProduct.map((r: any) => (
                  <TableRow key={r.product} className="cursor-pointer hover:bg-muted/40" onClick={() => window.location.assign(`/meat-factory/manufacturing?product=${encodeURIComponent(r.product)}`)}>
                    <TableCell className="font-medium">{r.product}</TableCell>
                    <TableCell>{r.invoices}</TableCell>
                    <TableCell className="font-bold">{fmt(r.qty)} كجم</TableCell>
                    <TableCell>{fmt(r.raw)}</TableCell>
                    <TableCell>{fmt(r.spice)}</TableCell>
                    <TableCell>{fmt(r.pack)}</TableCell>
                    <TableCell className="font-bold text-purple-700">{fmt(r.total)}</TableCell>
                    <TableCell className="font-bold">{fmt(r.avg)} ج/كجم</TableCell>
                    <TableCell className="text-xs">{new Date(r.last).toLocaleDateString("ar-EG")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Latest operations */}
        <Card>
          <CardHeader><CardTitle className="text-base">أحدث 10 عمليات في مصنع اللحوم</CardTitle></CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>التاريخ</TableHead><TableHead>نوع العملية</TableHead><TableHead>المرجع</TableHead>
                <TableHead>الصنف/المنتج</TableHead><TableHead>الكمية</TableHead><TableHead>القيمة</TableHead><TableHead>الحالة</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {latestOps.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-6 text-muted-foreground">لا توجد عمليات</TableCell></TableRow>
                ) : latestOps.map((o, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs">{new Date(o.date).toLocaleString("ar-EG")}</TableCell>
                    <TableCell><Badge variant="outline">{o.type}</Badge></TableCell>
                    <TableCell className="font-mono text-xs">{o.ref}</TableCell>
                    <TableCell>{o.item}</TableCell>
                    <TableCell>{o.qty != null ? fmt(o.qty) : "—"}</TableCell>
                    <TableCell>{o.value != null ? fmt(o.value) : "—"}</TableCell>
                    <TableCell><Badge className={o.status === "approved" ? "bg-emerald-600" : o.status === "draft" ? "bg-slate-500" : ""}>{o.status}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

function Stat({ to, icon: Icon, color, label, value, hint, big }: { to?: string; icon: any; color: string; label: string; value: string; hint?: string; big?: boolean }) {
  const inner = (
    <Card className={to ? "cursor-pointer hover:shadow-md transition" : ""}>
      <CardContent className="pt-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className={`w-4 h-4 ${color}`} />{label}</div>
        <div className={`mt-1 font-bold ${color} ${big ? "text-2xl" : "text-lg"}`}>{value}</div>
        {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
      </CardContent>
    </Card>
  );
  return to ? <Link to={to}>{inner}</Link> : inner;
}
