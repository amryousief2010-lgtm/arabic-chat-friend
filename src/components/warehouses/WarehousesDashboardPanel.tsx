import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Warehouse, Package, AlertTriangle, TrendingUp, TrendingDown,
  Activity, Clock, Filter, Printer, FileSpreadsheet, FileText, BarChart3, Wallet,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
  PieChart, Pie, Legend,
} from "recharts";
import * as XLSX from "xlsx";

type WhRow = { id: string; name: string; type: string; is_active: boolean };
type ItemRow = {
  id: string; warehouse_id: string; name: string; category?: string | null;
  unit: string; stock: number; low_stock_threshold: number; unit_cost: number;
  warehouse?: { name: string } | null;
};
type MovRow = {
  id: string; item_id: string; warehouse_id: string; movement_type: string;
  quantity: number; performed_at: string;
  item?: { name: string; unit: string } | null;
  warehouse?: { name: string } | null;
};

const fmt = (n: number) =>
  Number(n || 0).toLocaleString("ar-EG", { maximumFractionDigits: 2 });

const COLORS = ["hsl(var(--primary))", "#f59e0b", "#10b981", "#ef4444", "#6366f1", "#06b6d4", "#ec4899", "#8b5cf6"];

const periodLabel: Record<string, string> = {
  today: "اليوم", week: "هذا الأسبوع", month: "هذا الشهر", custom: "فترة مخصصة", all: "كل الفترات",
};

function startOfPeriod(period: string, fromDate?: string, toDate?: string): { from: Date | null; to: Date | null } {
  const now = new Date();
  if (period === "today") {
    const d = new Date(now); d.setHours(0, 0, 0, 0);
    return { from: d, to: null };
  }
  if (period === "week") {
    const d = new Date(now); d.setDate(d.getDate() - 7); d.setHours(0, 0, 0, 0);
    return { from: d, to: null };
  }
  if (period === "month") {
    const d = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: d, to: null };
  }
  if (period === "custom") {
    return {
      from: fromDate ? new Date(fromDate + "T00:00:00") : null,
      to: toDate ? new Date(toDate + "T23:59:59") : null,
    };
  }
  return { from: null, to: null };
}

export default function WarehousesDashboardPanel({
  warehouses, items, movements, scopeWarehouseId, title,
}: {
  warehouses: WhRow[];
  items: ItemRow[];
  movements: MovRow[];
  scopeWarehouseId?: string;        // when set => single-warehouse mode
  title?: string;
}) {
  const [period, setPeriod] = useState<string>("month");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [whFilter, setWhFilter] = useState<string>(scopeWarehouseId || "all");
  const [itemFilter, setItemFilter] = useState<string>("all");

  const scopedWarehouses = scopeWarehouseId
    ? warehouses.filter(w => w.id === scopeWarehouseId)
    : warehouses;

  const scopedItems = useMemo(() => {
    let list = items;
    if (scopeWarehouseId) list = list.filter(i => i.warehouse_id === scopeWarehouseId);
    else if (whFilter !== "all") list = list.filter(i => i.warehouse_id === whFilter);
    if (itemFilter !== "all") list = list.filter(i => i.id === itemFilter);
    return list;
  }, [items, scopeWarehouseId, whFilter, itemFilter]);

  const { from, to } = startOfPeriod(period, fromDate, toDate);

  const scopedMovs = useMemo(() => {
    return movements.filter(m => {
      if (scopeWarehouseId && m.warehouse_id !== scopeWarehouseId) return false;
      if (!scopeWarehouseId && whFilter !== "all" && m.warehouse_id !== whFilter) return false;
      if (itemFilter !== "all" && m.item_id !== itemFilter) return false;
      const t = new Date(m.performed_at).getTime();
      if (from && t < from.getTime()) return false;
      if (to && t > to.getTime()) return false;
      return true;
    });
  }, [movements, scopeWarehouseId, whFilter, itemFilter, from, to]);

  // KPIs
  const totalValue = useMemo(
    () => scopedItems.reduce((s, i) => s + Number(i.stock || 0) * Number(i.unit_cost || 0), 0),
    [scopedItems]
  );
  const itemsCount = scopedItems.length;
  const lowItems = scopedItems.filter(i => Number(i.stock) <= Number(i.low_stock_threshold));
  const negativeItems = scopedItems.filter(i => Number(i.stock) < 0);
  const totalStock = scopedItems.reduce((s, i) => s + Number(i.stock || 0), 0);

  const inMovs = scopedMovs.filter(m => m.movement_type === "in");
  const outMovs = scopedMovs.filter(m => m.movement_type === "out");
  const trMovs = scopedMovs.filter(m => m.movement_type === "transfer");
  const adjMovs = scopedMovs.filter(m => m.movement_type === "adjustment");

  const inQty = inMovs.reduce((s, m) => s + Number(m.quantity || 0), 0);
  const outQty = outMovs.reduce((s, m) => s + Number(m.quantity || 0), 0);

  const lastMov = scopedMovs[0];

  // Top moving items
  const topItems = useMemo(() => {
    const map = new Map<string, { name: string; unit: string; qty: number; count: number }>();
    scopedMovs.forEach(m => {
      const key = m.item_id;
      const e = map.get(key) || { name: m.item?.name || "—", unit: m.item?.unit || "", qty: 0, count: 0 };
      e.qty += Number(m.quantity || 0); e.count += 1;
      map.set(key, e);
    });
    return Array.from(map.values()).sort((a, b) => b.qty - a.qty).slice(0, 8);
  }, [scopedMovs]);

  // Top moving warehouses (only in all-mode)
  const topWarehouses = useMemo(() => {
    if (scopeWarehouseId) return [];
    const map = new Map<string, { name: string; count: number; qty: number }>();
    scopedMovs.forEach(m => {
      const k = m.warehouse_id;
      const e = map.get(k) || { name: m.warehouse?.name || "—", count: 0, qty: 0 };
      e.count += 1; e.qty += Number(m.quantity || 0);
      map.set(k, e);
    });
    return Array.from(map.values()).sort((a, b) => b.count - a.count).slice(0, 8);
  }, [scopedMovs, scopeWarehouseId]);

  // Value by warehouse
  const valueByWh = useMemo(() => {
    const list = scopeWarehouseId ? [] : warehouses.map(w => {
      const v = items
        .filter(i => i.warehouse_id === w.id)
        .reduce((s, i) => s + Number(i.stock || 0) * Number(i.unit_cost || 0), 0);
      return { name: w.name, value: Math.round(v) };
    }).filter(x => x.value > 0).sort((a, b) => b.value - a.value).slice(0, 10);
    return list;
  }, [warehouses, items, scopeWarehouseId]);

  // In vs Out (chart)
  const flowSeries = useMemo(() => {
    return [
      { name: "إضافة (وارد)", in: inQty, out: 0 },
      { name: "صرف (منصرف)", in: 0, out: outQty },
      { name: "تحويل", in: trMovs.length, out: 0 },
      { name: "تسوية", in: adjMovs.length, out: 0 },
    ];
  }, [inQty, outQty, trMovs.length, adjMovs.length]);

  // ====== Actions ======
  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    const sum = [
      { البند: "نطاق", القيمة: scopeWarehouseId ? (scopedWarehouses[0]?.name || "—") : "كل المخازن" },
      { البند: "الفترة", القيمة: periodLabel[period] || period },
      { البند: "قيمة المخزون", القيمة: totalValue.toFixed(2) },
      { البند: "عدد الأصناف", القيمة: itemsCount },
      { البند: "إجمالي الفعلي", القيمة: totalStock.toFixed(2) },
      { البند: "أصناف منخفضة", القيمة: lowItems.length },
      { البند: "أصناف بالسالب", القيمة: negativeItems.length },
      { البند: "وارد (كمية)", القيمة: inQty.toFixed(2) },
      { البند: "صرف (كمية)", القيمة: outQty.toFixed(2) },
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sum), "الملخص");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      topItems.map((x, i) => ({ "#": i + 1, "الصنف": x.name, "الوحدة": x.unit, "الكمية": x.qty, "عدد الحركات": x.count }))
    ), "أكثر الأصناف حركة");
    if (!scopeWarehouseId) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
        valueByWh.map(x => ({ "المخزن": x.name, "قيمة المخزون": x.value }))
      ), "قيمة المخزون لكل مخزن");
    }
    XLSX.writeFile(wb, `داشبورد-المخازن-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const printDashboard = () => {
    const w = window.open("", "_blank", "width=1100,height=800");
    if (!w) return;
    const rowsTop = topItems.map((x, i) => `<tr><td>${i + 1}</td><td>${x.name}</td><td>${x.qty.toFixed(2)}</td><td>${x.count}</td></tr>`).join("");
    const rowsWh = valueByWh.map(x => `<tr><td>${x.name}</td><td>${x.value.toLocaleString()}</td></tr>`).join("");
    w.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${title || "داشبورد المخازن"}</title>
      <style>body{font-family:Tahoma,Arial;margin:18px;color:#111}h1{font-size:20px}table{width:100%;border-collapse:collapse;margin-top:10px;font-size:12px}td,th{border:1px solid #bbb;padding:6px;text-align:right}th{background:#f3f3f3}.kpi{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:10px 0}.kpi div{background:#f8f9fa;border:1px solid #e1e4e8;padding:8px;border-radius:6px;text-align:center}.kpi strong{display:block;font-size:18px}</style>
      </head><body>
      <h1>${title || "داشبورد المخازن"}</h1>
      <div>الفترة: ${periodLabel[period] || period} — ${new Date().toLocaleString("ar-EG")}</div>
      <div class="kpi">
        <div><strong>${fmt(totalValue)}</strong><span>قيمة المخزون</span></div>
        <div><strong>${itemsCount}</strong><span>عدد الأصناف</span></div>
        <div><strong>${lowItems.length}</strong><span>أصناف منخفضة</span></div>
        <div><strong>${negativeItems.length}</strong><span>أصناف بالسالب</span></div>
        <div><strong>${fmt(inQty)}</strong><span>وارد (كمية)</span></div>
        <div><strong>${fmt(outQty)}</strong><span>صرف (كمية)</span></div>
        <div><strong>${trMovs.length}</strong><span>تحويلات</span></div>
        <div><strong>${adjMovs.length}</strong><span>تسويات</span></div>
      </div>
      <h3>أكثر الأصناف حركة</h3>
      <table><thead><tr><th>م</th><th>الصنف</th><th>الكمية</th><th>عدد الحركات</th></tr></thead><tbody>${rowsTop || '<tr><td colspan="4">لا يوجد</td></tr>'}</tbody></table>
      ${!scopeWarehouseId ? `<h3>قيمة المخزون لكل مخزن</h3>
      <table><thead><tr><th>المخزن</th><th>القيمة</th></tr></thead><tbody>${rowsWh || '<tr><td colspan="2">لا يوجد</td></tr>'}</tbody></table>` : ""}
      <script>window.addEventListener('load',()=>setTimeout(()=>window.print(),400))</script>
      </body></html>`);
    w.document.close();
  };

  return (
    <div dir="rtl" className="space-y-4">
      {/* Header */}
      <Card className="overflow-hidden border-primary/30">
        <div className="bg-gradient-to-l from-primary/10 via-primary/5 to-transparent p-5 flex items-start justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-xl bg-primary/15 flex items-center justify-center">
              <Wallet className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-bold">{title || (scopeWarehouseId ? "داشبورد المخزن" : "داشبورد المخازن")}</h2>
              <p className="text-xs text-muted-foreground">قيمة المخزون الإجمالية</p>
              <p className="text-3xl font-extrabold tabular-nums mt-0.5 text-primary">
                {fmt(totalValue)} <span className="text-lg">ج.م</span>
              </p>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="outline" onClick={printDashboard}>
              <Printer className="h-4 w-4 ml-1" />طباعة
            </Button>
            <Button size="sm" variant="outline" onClick={exportExcel}>
              <FileSpreadsheet className="h-4 w-4 ml-1" />Excel
            </Button>
          </div>
        </div>
      </Card>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi color="primary" icon={<Package className="h-4 w-4" />} label="عدد الأصناف" value={itemsCount.toLocaleString("ar-EG")} />
        <Kpi color="success" icon={<TrendingUp className="h-4 w-4" />} label="وارد (الفترة)" value={fmt(inQty)} sub={`${inMovs.length} حركة`} />
        <Kpi color="destructive" icon={<TrendingDown className="h-4 w-4" />} label="صرف (الفترة)" value={fmt(outQty)} sub={`${outMovs.length} حركة`} />
        <Kpi color={lowItems.length ? "destructive" : "muted"} icon={<AlertTriangle className="h-4 w-4" />} label="أصناف منخفضة" value={String(lowItems.length)} />
        <Kpi color={negativeItems.length ? "destructive" : "muted"} icon={<AlertTriangle className="h-4 w-4" />} label="أصناف بالسالب" value={String(negativeItems.length)} />
        <Kpi color="muted" icon={<Clock className="h-4 w-4" />} label="آخر حركة"
             value={lastMov ? new Date(lastMov.performed_at).toLocaleDateString("ar-EG") : "—"}
             sub={lastMov ? (lastMov.item?.name || "") : undefined} />
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Filter className="h-4 w-4" />الفلاتر</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div>
            <Label className="text-xs">الفترة</Label>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="today">اليوم</SelectItem>
                <SelectItem value="week">هذا الأسبوع</SelectItem>
                <SelectItem value="month">هذا الشهر</SelectItem>
                <SelectItem value="custom">فترة مخصصة</SelectItem>
                <SelectItem value="all">كل الفترات</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {period === "custom" && (
            <>
              <div><Label className="text-xs">من</Label><Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} /></div>
              <div><Label className="text-xs">إلى</Label><Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} /></div>
            </>
          )}
          {!scopeWarehouseId && (
            <div>
              <Label className="text-xs">المخزن</Label>
              <Select value={whFilter} onValueChange={setWhFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل المخازن</SelectItem>
                  {warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="lg:col-span-2">
            <Label className="text-xs">الصنف</Label>
            <Select value={itemFilter} onValueChange={setItemFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="all">كل الأصناف</SelectItem>
                {scopedItems.slice(0, 200).map(i => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button variant="outline" size="sm" className="w-full"
                    onClick={() => { setPeriod("month"); setFromDate(""); setToDate(""); setWhFilter(scopeWarehouseId || "all"); setItemFilter("all"); }}>
              إعادة الضبط
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Charts row */}
      <div className={`grid gap-4 ${scopeWarehouseId ? "md:grid-cols-1" : "md:grid-cols-2"}`}>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><BarChart3 className="h-4 w-4 text-primary" />الوارد والصرف (كمية)</CardTitle>
            <CardDescription className="text-xs">حسب الفلاتر الحالية</CardDescription>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={flowSeries}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="in" fill="#10b981" name="وارد" />
                <Bar dataKey="out" fill="#ef4444" name="صرف" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {!scopeWarehouseId && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><Warehouse className="h-4 w-4 text-primary" />قيمة المخزون لكل مخزن</CardTitle>
              <CardDescription className="text-xs">أعلى 10 مخازن</CardDescription>
            </CardHeader>
            <CardContent className="h-64">
              {valueByWh.length === 0 ? (
                <div className="h-full grid place-items-center text-muted-foreground text-sm">لا توجد بيانات</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={valueByWh} layout="vertical" margin={{ left: 60 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={120} />
                    <Tooltip formatter={(v: any) => `${Number(v).toLocaleString()} ج.م`} />
                    <Bar dataKey="value" name="قيمة">
                      {valueByWh.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Top items + top warehouses */}
      <div className={`grid gap-4 ${scopeWarehouseId ? "md:grid-cols-1" : "md:grid-cols-2"}`}>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">أكثر الأصناف حركة</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>الصنف</TableHead><TableHead>الكمية</TableHead><TableHead>عدد الحركات</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {topItems.length === 0 ? (
                  <TableRow><TableCell colSpan={3} className="text-center py-6 text-muted-foreground">لا توجد حركات</TableCell></TableRow>
                ) : topItems.map((x, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{x.name}</TableCell>
                    <TableCell className="tabular-nums">{fmt(x.qty)} {x.unit}</TableCell>
                    <TableCell><Badge variant="outline">{x.count}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {!scopeWarehouseId && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">أكثر المخازن حركة</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>المخزن</TableHead><TableHead>عدد الحركات</TableHead><TableHead>إجمالي الكمية</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {topWarehouses.length === 0 ? (
                    <TableRow><TableCell colSpan={3} className="text-center py-6 text-muted-foreground">لا توجد حركات</TableCell></TableRow>
                  ) : topWarehouses.map((x, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{x.name}</TableCell>
                      <TableCell><Badge variant="outline">{x.count}</Badge></TableCell>
                      <TableCell className="tabular-nums">{fmt(x.qty)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Last movements */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Activity className="h-4 w-4" />آخر الحركات</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>التاريخ</TableHead>
              <TableHead>النوع</TableHead>
              <TableHead>الصنف</TableHead>
              {!scopeWarehouseId && <TableHead>المخزن</TableHead>}
              <TableHead>الكمية</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {scopedMovs.slice(0, 15).map(m => (
                <TableRow key={m.id}>
                  <TableCell className="text-xs whitespace-nowrap">{new Date(m.performed_at).toLocaleString("ar-EG")}</TableCell>
                  <TableCell>
                    <Badge variant={m.movement_type === "in" ? "default" : m.movement_type === "out" ? "destructive" : "outline"} className="text-[10px]">
                      {m.movement_type === "in" ? "وارد" : m.movement_type === "out" ? "صرف" : m.movement_type === "transfer" ? "تحويل" : "تسوية"}
                    </Badge>
                  </TableCell>
                  <TableCell>{m.item?.name || "—"}</TableCell>
                  {!scopeWarehouseId && <TableCell>{m.warehouse?.name || "—"}</TableCell>}
                  <TableCell className="tabular-nums">{fmt(Number(m.quantity || 0))} {m.item?.unit || ""}</TableCell>
                </TableRow>
              ))}
              {scopedMovs.length === 0 && (
                <TableRow><TableCell colSpan={scopeWarehouseId ? 4 : 5} className="text-center py-8 text-muted-foreground">لا توجد حركات في النطاق المحدد</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({ icon, label, value, sub, color = "primary" }: {
  icon: React.ReactNode; label: string; value: string; sub?: string;
  color?: "primary" | "success" | "destructive" | "muted";
}) {
  const cls =
    color === "success" ? "border-success/30 bg-success/5 text-success" :
    color === "destructive" ? "border-destructive/30 bg-destructive/5 text-destructive" :
    color === "muted" ? "border-border bg-muted/30 text-foreground" :
    "border-primary/30 bg-primary/5 text-primary";
  return (
    <Card className={`border ${cls}`}>
      <CardContent className="p-3">
        <div className="flex items-center gap-2 text-xs opacity-80">{icon}<span>{label}</span></div>
        <div className="text-lg md:text-xl font-bold tabular-nums mt-1">{value}</div>
        {sub && <div className="text-[10px] opacity-70 mt-0.5 truncate">{sub}</div>}
      </CardContent>
    </Card>
  );
}
