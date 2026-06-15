import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import * as XLSX from "xlsx";
import {
  Wallet, TrendingUp, TrendingDown, AlertTriangle, Printer,
  FileSpreadsheet, Loader2, Crown, Skull, ArrowUpCircle, ArrowDownCircle,
  Microscope, Lightbulb,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { openPrintWindow, COMPANY_AR } from "@/lib/printPdf";

type DeptKey = "hatchery" | "brooding" | "slaughterhouse" | "feed_factory";

interface LineItem {
  date: string; label: string; source: string; amount: number;
  reference?: string; treasury?: string; notes?: string;
}
interface DeptResult {
  key: DeptKey; name: string;
  revenue: number; expenses: number; net: number;
  expenseRatio: number; status: "profit" | "loss" | "even";
  revenueItems: LineItem[]; expenseItems: LineItem[];
  topRevenueSource?: { source: string; amount: number };
  topExpenseItem?: { source: string; amount: number };
}
interface BudgetData {
  year: number; month: number;
  departments: DeptResult[];
  totals: { revenue: number; expenses: number; net: number };
  highlights: {
    mostProfit?: { name: string; net: number };
    mostLoss?: { name: string; net: number };
    topRevenueDept?: { name: string; revenue: number };
    topExpenseDept?: { name: string; expenses: number };
    biggestRevenueSource?: { source: string; dept: string; amount: number };
    biggestExpenseItem?: { source: string; dept: string; amount: number };
  };
  topRevenueSources: { source: string; dept: string; amount: number; pctOfTotal: number }[];
  topExpenseItems: { source: string; dept: string; amount: number; pctOfTotal: number }[];
  comparison: {
    name: string;
    currentNet: number; previousNet: number;
    currentRevenue: number; previousRevenue: number;
    currentExpenses: number; previousExpenses: number;
    revenueDelta: number; expensesDelta: number; netDelta: number;
    revenuePct: number | null; expensesPct: number | null;
  }[];
  alerts: { level: "warn" | "danger" | "info"; message: string }[];
  unclassified: { count: number; note: string };
}

const MONTHS_AR = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];

const fmt = (n: number) =>
  new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 0 }).format(n || 0);

const statusBadge = (s: DeptResult["status"]) => {
  if (s === "profit")
    return <Badge className="bg-green-600 hover:bg-green-700">كسبان</Badge>;
  if (s === "loss")
    return <Badge variant="destructive">خسران</Badge>;
  return <Badge variant="secondary">تعادل</Badge>;
};

export default function DepartmentMonthlyBudget() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<BudgetData | null>(null);
  const [selectedDept, setSelectedDept] = useState<DeptResult | null>(null);
  const [analysisDept, setAnalysisDept] = useState<DeptResult | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data: res, error } = await supabase.functions.invoke(
        "department-monthly-budget",
        { body: { year, month } },
      );
      if (error) throw error;
      setData(res as BudgetData);
    } catch (e: any) {
      toast.error("تعذّر تحميل الميزانية: " + (e?.message ?? e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [year, month]);

  const years = useMemo(() => {
    const arr: number[] = [];
    for (let y = now.getFullYear() + 1; y >= 2023; y--) arr.push(y);
    return arr;
  }, []);

  const exportExcel = () => {
    if (!data) return;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      data.departments.map(d => ({
        القسم: d.name, الإيرادات: d.revenue, المصروفات: d.expenses,
        الصافي: d.net, "نسبة المصروفات %": d.expenseRatio.toFixed(1),
        الحالة: d.status === "profit" ? "كسبان" : d.status === "loss" ? "خسران" : "تعادل",
      })),
    ), "ملخص الأقسام");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      data.topRevenueSources.map(r => ({
        المصدر: r.source, القسم: r.dept, الإيراد: r.amount,
        "النسبة من الإجمالي %": r.pctOfTotal.toFixed(1),
      })),
    ), "أكبر مصادر الإيراد");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      data.topExpenseItems.map(r => ({
        البند: r.source, القسم: r.dept, المصروف: r.amount,
        "النسبة من الإجمالي %": r.pctOfTotal.toFixed(1),
      })),
    ), "أكبر بنود المصروفات");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      data.comparison.map(c => ({
        القسم: c.name,
        "إيراد الشهر": c.currentRevenue, "إيراد السابق": c.previousRevenue,
        "تغيّر الإيراد %": c.revenuePct?.toFixed(1) ?? "—",
        "مصروف الشهر": c.currentExpenses, "مصروف السابق": c.previousExpenses,
        "تغيّر المصروفات %": c.expensesPct?.toFixed(1) ?? "—",
        "صافي الشهر": c.currentNet, "صافي السابق": c.previousNet,
        "فارق الصافي": c.netDelta,
      })),
    ), "مقارنة بالشهر السابق");
    for (const d of data.departments) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
        d.revenueItems.map(i => ({
          التاريخ: i.date?.slice(0, 10), البيان: i.label, المصدر: i.source,
          المبلغ: i.amount, المرجع: i.reference || "", الجهة: i.treasury || "",
        })),
      ), `إيرادات ${d.name}`.slice(0, 31));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
        d.expenseItems.map(i => ({
          التاريخ: i.date?.slice(0, 10), البيان: i.label, "نوع المصروف": i.source,
          المبلغ: i.amount, الخزنة: i.treasury || "", ملاحظات: i.notes || "",
        })),
      ), `مصروفات ${d.name}`.slice(0, 31));
    }
    XLSX.writeFile(wb, `الميزانية-الشهرية-${year}-${String(month).padStart(2, "0")}.xlsx`);
  };

  const printReport = () => {
    if (!data) return;
    const rows = data.departments.map(d => `
      <tr><td>${d.name}</td>
        <td class="num">${fmt(d.revenue)}</td>
        <td class="num">${fmt(d.expenses)}</td>
        <td class="num">${fmt(d.net)}</td>
        <td>${d.status === "profit" ? "كسبان" : d.status === "loss" ? "خسران" : "تعادل"}</td>
      </tr>`).join("");
    const topRev = data.topRevenueSources.slice(0, 10).map(r => `
      <tr><td>${r.source}</td><td>${r.dept}</td><td class="num">${fmt(r.amount)}</td><td>${r.pctOfTotal.toFixed(1)}%</td></tr>`).join("");
    const topExp = data.topExpenseItems.slice(0, 10).map(r => `
      <tr><td>${r.source}</td><td>${r.dept}</td><td class="num">${fmt(r.amount)}</td><td>${r.pctOfTotal.toFixed(1)}%</td></tr>`).join("");
    const body = `
      <header><div><h1>${COMPANY_AR}</h1><div class="en">Monthly Department Budget</div></div>
        <div class="meta">الشهر: ${MONTHS_AR[month - 1]} ${year}<br>تاريخ التقرير: ${new Date().toLocaleDateString("ar-EG")}</div>
      </header>
      <div class="stats">
        <div class="stat"><div class="k">إجمالي الإيرادات</div><div class="v">${fmt(data.totals.revenue)}</div></div>
        <div class="stat"><div class="k">إجمالي المصروفات</div><div class="v">${fmt(data.totals.expenses)}</div></div>
        <div class="stat"><div class="k">صافي الربح/الخسارة</div><div class="v">${fmt(data.totals.net)}</div></div>
        <div class="stat"><div class="k">أكثر قسم ربحًا</div><div class="v">${data.highlights.mostProfit?.name ?? "—"}</div></div>
      </div>
      <h2>مقارنة الأقسام</h2>
      <table><thead><tr><th>القسم</th><th>الإيرادات</th><th>المصروفات</th><th>الصافي</th><th>الحالة</th></tr></thead><tbody>${rows}</tbody></table>
      <h2>أكبر مصادر الإيراد</h2>
      <table><thead><tr><th>المصدر</th><th>القسم</th><th>المبلغ</th><th>النسبة</th></tr></thead><tbody>${topRev}</tbody></table>
      <h2>أكبر بنود المصروفات</h2>
      <table><thead><tr><th>البند</th><th>القسم</th><th>المبلغ</th><th>النسبة</th></tr></thead><tbody>${topExp}</tbody></table>
      <div class="sig"><div>المحاسب</div><div>المدير التنفيذي</div><div>المدير العام</div></div>
    `;
    const css = `.sig{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;margin-top:40px;font-size:11px}
                 .sig div{text-align:center;border-top:1px solid #888;padding-top:6px}`;
    openPrintWindow(`الميزانية الشهرية ${MONTHS_AR[month - 1]} ${year}`, body, css);
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="p-4 md:p-6 space-y-6" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Wallet className="h-7 w-7 text-primary" />
            الميزانية الشهرية للأقسام
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            تجميع تلقائي للإيرادات والمصروفات لكل قسم — عرض فقط، لا يعدّل أي خزنة أو مخزون.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={String(month)} onValueChange={v => setMonth(Number(v))}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MONTHS_AR.map((m, i) => (
                <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(year)} onValueChange={v => setYear(Number(v))}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              {years.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={printReport} variant="outline" disabled={!data}>
            <Printer className="h-4 w-4 ml-1" /> طباعة / PDF
          </Button>
          <Button onClick={exportExcel} variant="outline" disabled={!data}>
            <FileSpreadsheet className="h-4 w-4 ml-1" /> Excel
          </Button>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin ml-2" /> جارٍ تحميل البيانات...
        </div>
      )}

      {!loading && data && (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard title="إجمالي الإيرادات" value={fmt(data.totals.revenue)} icon={<ArrowUpCircle className="h-5 w-5 text-green-600" />} />
            <KpiCard title="إجمالي المصروفات" value={fmt(data.totals.expenses)} icon={<ArrowDownCircle className="h-5 w-5 text-red-600" />} />
            <KpiCard title="صافي الشركة"
              value={fmt(data.totals.net)}
              accent={data.totals.net >= 0 ? "text-green-600" : "text-red-600"}
              icon={data.totals.net >= 0
                ? <TrendingUp className="h-5 w-5 text-green-600" />
                : <TrendingDown className="h-5 w-5 text-red-600" />} />
            <KpiCard title="أكثر قسم ربحًا"
              value={data.highlights.mostProfit?.name ?? "—"}
              sub={fmt(data.highlights.mostProfit?.net ?? 0)}
              icon={<Crown className="h-5 w-5 text-amber-500" />} />
            <KpiCard title="أكثر قسم خسارة"
              value={data.highlights.mostLoss?.name ?? "—"}
              sub={fmt(data.highlights.mostLoss?.net ?? 0)}
              icon={<Skull className="h-5 w-5 text-red-500" />} />
            <KpiCard title="أعلى قسم في الإيرادات"
              value={data.highlights.topRevenueDept?.name ?? "—"}
              sub={fmt(data.highlights.topRevenueDept?.revenue ?? 0)}
              icon={<ArrowUpCircle className="h-5 w-5 text-primary" />} />
            <KpiCard title="أعلى قسم في المصروفات"
              value={data.highlights.topExpenseDept?.name ?? "—"}
              sub={fmt(data.highlights.topExpenseDept?.expenses ?? 0)}
              icon={<ArrowDownCircle className="h-5 w-5 text-orange-500" />} />
            <KpiCard title="أكبر بند مصروف"
              value={data.highlights.biggestExpenseItem?.source ?? "—"}
              sub={`${data.highlights.biggestExpenseItem?.dept ?? ""} — ${fmt(data.highlights.biggestExpenseItem?.amount ?? 0)}`}
              icon={<AlertTriangle className="h-5 w-5 text-orange-500" />} />
          </div>

          {/* Alerts */}
          {data.alerts.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">تنبيهات الشهر</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {data.alerts.map((a, i) => (
                  <div key={i}
                    className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm
                      ${a.level === "danger" ? "bg-red-50 text-red-800 border border-red-200" :
                        a.level === "warn" ? "bg-amber-50 text-amber-800 border border-amber-200" :
                          "bg-blue-50 text-blue-800 border border-blue-200"}`}>
                    <AlertTriangle className="h-4 w-4" /> {a.message}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Comparison table */}
          <Card>
            <CardHeader><CardTitle>مقارنة الأقسام</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>القسم</TableHead>
                    <TableHead>الإيرادات</TableHead>
                    <TableHead>المصروفات</TableHead>
                    <TableHead>الصافي</TableHead>
                    <TableHead>نسبة المصروفات</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.departments.map(d => (
                    <TableRow key={d.key} className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setSelectedDept(d)}>
                      <TableCell className="font-medium">{d.name}</TableCell>
                      <TableCell className="text-green-700 tabular-nums">{fmt(d.revenue)}</TableCell>
                      <TableCell className="text-red-700 tabular-nums">{fmt(d.expenses)}</TableCell>
                      <TableCell className={`tabular-nums font-bold ${d.net >= 0 ? "text-green-700" : "text-red-700"}`}>
                        {fmt(d.net)}
                      </TableCell>
                      <TableCell className="tabular-nums">{d.expenseRatio.toFixed(1)}%</TableCell>
                      <TableCell>{statusBadge(d.status)}</TableCell>
                      <TableCell>
                        <div className="flex gap-1 justify-end">
                          <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setSelectedDept(d); }}>
                            تفاصيل
                          </Button>
                          <Button size="sm" variant={d.status === "loss" ? "default" : "outline"}
                            onClick={(e) => { e.stopPropagation(); setAnalysisDept(d); }}>
                            <Microscope className="h-3 w-3 ml-1" /> تحليل سبب الربح/الخسارة
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="grid lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle>أكثر مصادر الربح</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>المصدر</TableHead><TableHead>القسم</TableHead>
                      <TableHead>المبلغ</TableHead><TableHead>%</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.topRevenueSources.length === 0 && (
                      <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">لا توجد إيرادات</TableCell></TableRow>
                    )}
                    {data.topRevenueSources.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell>{r.source}</TableCell>
                        <TableCell>{r.dept}</TableCell>
                        <TableCell className="tabular-nums text-green-700">{fmt(r.amount)}</TableCell>
                        <TableCell className="tabular-nums">{r.pctOfTotal.toFixed(1)}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>أكبر بنود الخسارة / المصروفات</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>البند</TableHead><TableHead>القسم</TableHead>
                      <TableHead>المبلغ</TableHead><TableHead>%</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.topExpenseItems.length === 0 && (
                      <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">لا توجد مصروفات</TableCell></TableRow>
                    )}
                    {data.topExpenseItems.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell>{r.source}</TableCell>
                        <TableCell>{r.dept}</TableCell>
                        <TableCell className="tabular-nums text-red-700">{fmt(r.amount)}</TableCell>
                        <TableCell className="tabular-nums">{r.pctOfTotal.toFixed(1)}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle>مقارنة بالشهر السابق</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>القسم</TableHead>
                    <TableHead>إيراد الشهر</TableHead>
                    <TableHead>إيراد السابق</TableHead>
                    <TableHead>تغيّر %</TableHead>
                    <TableHead>مصروف الشهر</TableHead>
                    <TableHead>مصروف السابق</TableHead>
                    <TableHead>تغيّر %</TableHead>
                    <TableHead>فارق الصافي</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.comparison.map((c, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell className="tabular-nums">{fmt(c.currentRevenue)}</TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">{fmt(c.previousRevenue)}</TableCell>
                      <TableCell className={`tabular-nums ${(c.revenuePct ?? 0) >= 0 ? "text-green-700" : "text-red-700"}`}>
                        {c.revenuePct == null ? "—" : `${c.revenuePct.toFixed(1)}%`}
                      </TableCell>
                      <TableCell className="tabular-nums">{fmt(c.currentExpenses)}</TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">{fmt(c.previousExpenses)}</TableCell>
                      <TableCell className={`tabular-nums ${(c.expensesPct ?? 0) <= 0 ? "text-green-700" : "text-red-700"}`}>
                        {c.expensesPct == null ? "—" : `${c.expensesPct.toFixed(1)}%`}
                      </TableCell>
                      <TableCell className={`tabular-nums font-bold ${c.netDelta >= 0 ? "text-green-700" : "text-red-700"}`}>
                        {c.netDelta >= 0 ? "+" : ""}{fmt(c.netDelta)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>الحركات غير المصنفة</CardTitle></CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {data.unclassified.count === 0
                ? data.unclassified.note
                : `يوجد ${data.unclassified.count} حركة تحتاج تحديد القسم`}
            </CardContent>
          </Card>
        </>
      )}

      {/* Dept detail */}
      <Dialog open={!!selectedDept} onOpenChange={o => !o && setSelectedDept(null)}>
        <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto" dir="rtl">
          <DialogHeader><DialogTitle>تفاصيل {selectedDept?.name}</DialogTitle></DialogHeader>
          {selectedDept && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <KpiCard title="الإيرادات" value={fmt(selectedDept.revenue)} accent="text-green-700" />
                <KpiCard title="المصروفات" value={fmt(selectedDept.expenses)} accent="text-red-700" />
                <KpiCard title="الصافي" value={fmt(selectedDept.net)}
                  accent={selectedDept.net >= 0 ? "text-green-700" : "text-red-700"} />
                <KpiCard title="نسبة المصروفات" value={`${selectedDept.expenseRatio.toFixed(1)}%`} />
              </div>
              <Tabs defaultValue="rev">
                <TabsList>
                  <TabsTrigger value="rev">الإيرادات ({selectedDept.revenueItems.length})</TabsTrigger>
                  <TabsTrigger value="exp">المصروفات ({selectedDept.expenseItems.length})</TabsTrigger>
                </TabsList>
                <TabsContent value="rev">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>التاريخ</TableHead><TableHead>البيان</TableHead>
                      <TableHead>المصدر</TableHead><TableHead>المبلغ</TableHead>
                      <TableHead>المرجع</TableHead><TableHead>الجهة</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {selectedDept.revenueItems.map((i, k) => (
                        <TableRow key={k}>
                          <TableCell>{i.date?.slice(0, 10)}</TableCell>
                          <TableCell>{i.label}</TableCell>
                          <TableCell>{i.source}</TableCell>
                          <TableCell className="tabular-nums text-green-700">{fmt(i.amount)}</TableCell>
                          <TableCell className="text-xs">{i.reference || ""}</TableCell>
                          <TableCell className="text-xs">{i.treasury || ""}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TabsContent>
                <TabsContent value="exp">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>التاريخ</TableHead><TableHead>البيان</TableHead>
                      <TableHead>النوع</TableHead><TableHead>المبلغ</TableHead>
                      <TableHead>الخزنة</TableHead><TableHead>ملاحظات</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {selectedDept.expenseItems.map((i, k) => (
                        <TableRow key={k}>
                          <TableCell>{i.date?.slice(0, 10)}</TableCell>
                          <TableCell>{i.label}</TableCell>
                          <TableCell>{i.source}</TableCell>
                          <TableCell className="tabular-nums text-red-700">{fmt(i.amount)}</TableCell>
                          <TableCell className="text-xs">{i.treasury || ""}</TableCell>
                          <TableCell className="text-xs">{i.notes || ""}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TabsContent>
              </Tabs>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}

function KpiCard({ title, value, sub, icon, accent }: {
  title: string; value: string | number; sub?: string;
  icon?: React.ReactNode; accent?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="text-xs text-muted-foreground">{title}</div>
          {icon}
        </div>
        <div className={`text-lg font-bold mt-1 tabular-nums ${accent ?? ""}`}>{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-1 tabular-nums">{sub}</div>}
      </CardContent>
    </Card>
  );
}
