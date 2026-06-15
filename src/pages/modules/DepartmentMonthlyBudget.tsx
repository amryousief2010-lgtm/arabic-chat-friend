import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import * as XLSX from "xlsx";
import {
  Wallet, TrendingUp, TrendingDown, AlertTriangle, Printer,
  FileSpreadsheet, Loader2, Crown, Skull, ArrowUpCircle, ArrowDownCircle,
  Microscope, Lightbulb, Tag,
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

type DeptKey = "mother_farm" | "hatchery" | "brooding" | "slaughterhouse" | "feed_factory" | "meat_factory";

interface LineItem {
  date: string; label: string; source: string; amount: number;
  category?: "cash" | "internal" | "asset";
  reference?: string; treasury?: string; notes?: string;
  priceSource?: "internal_price" | "avg_cost" | "transfer_unit_price" | "production_cost" | "sale_price";
}
interface ProductMetric {
  name: string; qty: number;
  revenue: number; cost: number; profit: number; margin: number;
  dept?: string;
  costSource?: string;
  sourceDept?: string;
}
interface DeptResult {
  key: DeptKey; name: string;
  cashRevenue: number; internalValue: number; remainingInventoryValue: number;
  productionCost: number; operatingExpenses: number;
  totalComputedValue: number; cashNet: number; operationalNet: number;
  grossMargin: number;
  cashStatus: "profit" | "loss" | "even";
  pricingWarnings: string[];
  productMetrics: ProductMetric[];
  topProfitProduct?: ProductMetric;
  topLossProduct?: ProductMetric;
  topCostItem?: { name: string; amount: number };
  // aliases for legacy code
  revenue: number; expenses: number; net: number;
  expenseRatio: number; status: "profit" | "loss" | "even";
  revenueItems: LineItem[]; expenseItems: LineItem[];
  topRevenueSource?: { source: string; amount: number };
  topExpenseItem?: { source: string; amount: number };
  actualSaleValue?: number;
  opsMetrics?: Record<string, number>;
  deepAnalysis?: any;
}
interface BudgetData {
  year: number; month: number;
  departments: DeptResult[];
  totals: {
    cashRevenue: number; internalValue: number; remainingInventoryValue: number;
    totalComputedValue: number; productionCost: number; operatingExpenses: number;
    expenses: number; cashNet: number; operationalNet: number;
    revenue: number; net: number;
  };
  highlights: {
    mostProfit?: { name: string; net: number };
    mostLoss?: { name: string; net: number };
    topRevenueDept?: { name: string; revenue: number };
    topExpenseDept?: { name: string; expenses: number };
    biggestRevenueSource?: { source: string; dept: string; amount: number };
    biggestExpenseItem?: { source: string; dept: string; amount: number };
    topProfitProduct?: ProductMetric;
    topLossProduct?: ProductMetric;
  };
  topRevenueSources: { source: string; dept: string; amount: number; pctOfTotal: number; category?: string }[];
  topExpenseItems: { source: string; dept: string; amount: number; pctOfTotal: number }[];
  topProfitProducts?: ProductMetric[];
  topLossProducts?: ProductMetric[];
  comparison: {
    name: string;
    currentNet: number; previousNet: number;
    currentCashNet?: number; previousCashNet?: number;
    currentRevenue: number; previousRevenue: number;
    currentExpenses: number; previousExpenses: number;
    revenueDelta: number; expensesDelta: number; netDelta: number;
    revenuePct: number | null; expensesPct: number | null;
  }[];
  alerts: { level: "warn" | "danger" | "info"; message: string }[];
  flowMap?: { from: string; to: string; label: string; amount: number; note?: string }[];
  verification?: Record<string, any>;
  meta?: {
    note: string; treasuryMovementsCreated: number;
    usedActualProductionCost?: boolean; usedActualSalePrice?: boolean;
  };
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
      const r = res as any;
      // Backward-compat aliases so legacy UI keeps working
      for (const d of r.departments ?? []) {
        d.revenue = d.totalComputedValue ?? 0;
        d.net = d.operationalNet ?? 0;
      }
      if (r.totals) {
        r.totals.revenue = r.totals.totalComputedValue ?? 0;
        r.totals.net = r.totals.operationalNet ?? 0;
      }
      setData(r as BudgetData);
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
        القسم: d.name,
        "إيراد نقدي": d.cashRevenue,
        "قيمة تشغيلية داخلية": d.internalValue,
        "قيمة مخزون متبقٍ": d.remainingInventoryValue,
        "إجمالي القيمة": d.totalComputedValue,
        المصروفات: d.expenses,
        "صافي نقدي": d.cashNet,
        "صافي تشغيلي": d.operationalNet,
        "نسبة المصروفات %": d.expenseRatio.toFixed(1),
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
    const totalCostAll = (data.totals.productionCost ?? 0) + (data.totals.operatingExpenses ?? 0);
    const overallMargin = data.totals.totalComputedValue > 0
      ? (data.totals.operationalNet / data.totals.totalComputedValue) * 100 : 0;
    const rows = data.departments.map(d => {
      const tc = (d.productionCost ?? 0) + (d.operatingExpenses ?? 0);
      const m = d.totalComputedValue > 0 ? (d.operationalNet / d.totalComputedValue) * 100 : 0;
      return `<tr><td>${d.name}</td>
        <td class="num">${fmt(d.productionCost ?? 0)}</td>
        <td class="num">${fmt(d.operatingExpenses ?? 0)}</td>
        <td class="num"><b>${fmt(tc)}</b></td>
        <td class="num">${fmt(d.cashRevenue)}</td>
        <td class="num">${fmt(d.internalValue)}</td>
        <td class="num">${fmt(d.remainingInventoryValue)}</td>
        <td class="num"><b>${fmt(d.totalComputedValue)}</b></td>
        <td class="num"><b>${d.operationalNet >= 0 ? "+" : ""}${fmt(d.operationalNet)}</b></td>
        <td>${m.toFixed(1)}%</td>
        <td>${d.status === "profit" ? "كسبان" : d.status === "loss" ? "خسران" : "تعادل"}</td>
      </tr>`;
    }).join("");
    const topExp = data.topExpenseItems.slice(0, 10).map(r => `
      <tr><td>${r.source}</td><td>${r.dept}</td><td class="num">${fmt(r.amount)}</td><td>${r.pctOfTotal.toFixed(1)}%</td></tr>`).join("");
    const allProducts = [...(data.topProfitProducts ?? []), ...(data.topLossProducts ?? [])];
    const seen = new Set<string>();
    const uniqueProducts = allProducts.filter(p => {
      const k = `${p.dept}|${p.name}`; if (seen.has(k)) return false; seen.add(k); return true;
    }).sort((a, b) => b.profit - a.profit);
    const prodRows = uniqueProducts.map(p => `
      <tr><td>${p.name}</td><td>${p.dept ?? "—"}</td><td class="num">${fmt(p.qty)}</td>
      <td class="num">${fmt(p.cost)}</td><td class="num">${fmt(p.revenue)}</td>
      <td class="num"><b>${p.profit >= 0 ? "+" : ""}${fmt(p.profit)}</b></td>
      <td>${p.margin.toFixed(1)}%</td>
      <td>${p.profit > 0 ? "كسبان" : p.profit < 0 ? "خسران" : "تعادل"}</td></tr>`).join("");
    const body = `
      <header><div><h1>${COMPANY_AR}</h1><div class="en">Monthly P&L Report — Departments</div></div>
        <div class="meta">الشهر: ${MONTHS_AR[month - 1]} ${year}<br>تاريخ التقرير: ${new Date().toLocaleDateString("ar-EG")}</div>
      </header>
      <div class="stats">
        <div class="stat"><div class="k">إجمالي التكلفة علينا</div><div class="v">${fmt(totalCostAll)}</div></div>
        <div class="stat"><div class="k">إجمالي البيع / القيمة</div><div class="v">${fmt(data.totals.totalComputedValue)}</div></div>
        <div class="stat"><div class="k">صافي الربح / الخسارة</div><div class="v">${data.totals.operationalNet >= 0 ? "+" : ""}${fmt(data.totals.operationalNet)}</div></div>
        <div class="stat"><div class="k">هامش الربح %</div><div class="v">${overallMargin.toFixed(1)}%</div></div>
        <div class="stat"><div class="k">أكثر قسم كسبان</div><div class="v">${data.highlights.mostProfit?.name ?? "—"}</div></div>
        <div class="stat"><div class="k">أكثر قسم خسران</div><div class="v">${data.highlights.mostLoss?.name ?? "—"}</div></div>
      </div>
      <h2>ملخص الربح والخسارة الشهري</h2>
      <table><thead><tr>
        <th>القسم</th><th>تكلفة إنتاج</th><th>مصروفات أخرى</th><th>إجمالي التكلفة</th>
        <th>بيع نقدي</th><th>قيمة داخلية</th><th>مخزون متبقٍ</th><th>إجمالي القيمة</th>
        <th>صافي</th><th>هامش</th><th>الحالة</th>
      </tr></thead><tbody>${rows}</tbody></table>
      <h2>ربحية المنتجات</h2>
      <table><thead><tr>
        <th>المنتج</th><th>القسم</th><th>الكمية</th><th>تكلفة الكمية</th><th>قيمة البيع</th><th>الربح/الخسارة</th><th>هامش</th><th>الحالة</th>
      </tr></thead><tbody>${prodRows || '<tr><td colspan="8" style="text-align:center">لا توجد بيانات</td></tr>'}</tbody></table>
      <h2>أكبر بنود التكلفة</h2>
      <table><thead><tr><th>البند</th><th>القسم</th><th>المبلغ</th><th>النسبة</th></tr></thead><tbody>${topExp}</tbody></table>
      <h2>التوصيات</h2>
      <ul>
        ${data.alerts.map(a => `<li>${a.message}</li>`).join("") || "<li>لا توجد توصيات حرجة هذا الشهر</li>"}
      </ul>
      <p style="font-size:11px;color:#666;margin-top:12px">
        الأرقام مبنية على تكاليف الإنتاج الفعلية من فواتير التصنيع وأسعار البيع الفعلية من فواتير المبيعات والطلبات.
        التقرير عرض فقط ولا يُنشئ أي حركة خزنة أو يعدّل أي مخزون (حركات الخزنة: 0).
      </p>
      <div class="sig"><div>المحاسب</div><div>المدير التنفيذي</div><div>المدير العام</div></div>
    `;
    const css = `.sig{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;margin-top:40px;font-size:11px}
                 .sig div{text-align:center;border-top:1px solid #888;padding-top:6px}
                 table{font-size:10px}
                 .num{text-align:left;font-variant-numeric:tabular-nums}`;
    openPrintWindow(`تقرير الربح والخسارة ${MONTHS_AR[month - 1]} ${year}`, body, css);
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
            <Printer className="h-4 w-4 ml-1" /> طباعة تقرير الربح والخسارة
          </Button>
          <Button onClick={exportExcel} variant="outline" disabled={!data}>
            <FileSpreadsheet className="h-4 w-4 ml-1" /> Excel
          </Button>
          <Button asChild variant="outline">
            <a href="/modules/internal-prices-settings">
              <Tag className="h-4 w-4 ml-1" /> الأسعار الداخلية
            </a>
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

          {/* Internal flow map */}
          {data.flowMap && data.flowMap.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <ArrowUpCircle className="h-4 w-4 text-blue-600" />
                  خريطة التدفقات الداخلية بين الأقسام (بدون حركة خزنة)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {data.flowMap.map((f, i) => (
                    <div key={i} className="rounded-md border bg-muted/30 p-3 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-blue-800">{f.from}</span>
                        <span className="text-muted-foreground">←</span>
                        <span className="font-semibold text-purple-800">{f.to}</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">{f.label}</span>
                        <span className="tabular-nums font-bold">{fmt(f.amount)} ج.م</span>
                      </div>
                      {f.note && <div className="text-[10px] text-muted-foreground mt-1">{f.note}</div>}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Verification panel */}
          {data.verification && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Lightbulb className="h-4 w-4 text-amber-500" /> تقرير التحقق
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid sm:grid-cols-2 gap-2 text-sm">
                  {[
                    ["هل المجزر يستخدم سعر البيع الفعلي للمنتجات المباعة؟",
                      data.verification.slaughterUsesActualSalePrice,
                      data.verification.slaughterActualSaleValue
                        ? `${fmt(data.verification.slaughterActualSaleValue)} ج.م (للعرض فقط)`
                        : "لا توجد مبيعات لمنتجات المجزر هذا الشهر"],
                    ["هل المجزر يستخدم سعر داخلي للمحوّل للمخزن/مصنع اللحوم؟",
                      data.verification.slaughterUsesInternalPrice, null],
                    ["هل مصنع العلف حسب قيمة العلف المحوّل داخليًا؟",
                      data.verification.feedFactoryCountedInternal,
                      `${fmt(data.verification.feedFactoryInternalValue)} ج.م`],
                    ["هل تم إنشاء ميزانية مستقلة لحضانات التسمين؟",
                      data.verification.broodingBudgetIncluded, null],
                    ["هل تم إنشاء ميزانية مستقلة لمزرعة الأمهات؟",
                      data.verification.motherFarmBudgetIncluded,
                      `قيمة بيض للمعمل: ${fmt(data.verification.motherFarmEggValueToHatchery)} ج.م`],
                    ["هل كل قسم يظهر صافي نقدي وصافي تشغيلي؟",
                      data.verification.eachDeptHasCashAndOperationalNet, null],
                    ["هل تم إنشاء أي حركة خزنة؟",
                      data.verification.treasuryMovementsCreated === 0,
                      `${data.verification.treasuryMovementsCreated} حركة`],
                  ].map(([q, ok, note], i) => (
                    <div key={i} className={`rounded-md border p-2 ${ok ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200"}`}>
                      <div className="flex items-start gap-2">
                        <Badge className={ok ? "bg-green-600" : "bg-amber-500"}>{ok ? "نعم" : "لا"}</Badge>
                        <span>{q as string}</span>
                      </div>
                      {note ? <div className="text-xs text-muted-foreground mt-1 mr-12">{note as string}</div> : null}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* P&L Summary — explicit answer to "تكلفتنا كام / بعنا بكام / كسب أم خسارة" */}
          <Card className="border-2 border-primary/30">
            <CardHeader>
              <CardTitle className="flex items-center justify-between flex-wrap gap-2">
                <span className="flex items-center gap-2">
                  <Wallet className="h-5 w-5 text-primary" />
                  ملخص الربح والخسارة الشهري — {MONTHS_AR[month - 1]} {year}
                </span>
                <span className="text-xs font-normal text-muted-foreground">
                  للعرض فقط — لا حركة خزنة أو مخزون
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="font-bold">القسم</TableHead>
                    <TableHead title="تكلفة الإنتاج / التصنيع من فواتير المصانع">تكلفة الإنتاج</TableHead>
                    <TableHead title="مصروفات تشغيلية غير إنتاجية">مصروفات أخرى</TableHead>
                    <TableHead className="font-bold text-red-700" title="تكلفة الإنتاج + المصروفات الأخرى">إجمالي التكلفة علينا</TableHead>
                    <TableHead title="بيع فعلي تحصّل نقدًا من الفواتير والطلبات">إجمالي البيع النقدي</TableHead>
                    <TableHead title="تحويلات داخلية مسعّرة (بدون خزنة)">قيمة تشغيلية داخلية</TableHead>
                    <TableHead title="مخزون متبقٍ بقيمته كأصل">قيمة المخزون المتبقي</TableHead>
                    <TableHead className="font-bold text-green-700" title="بيع نقدي + قيمة داخلية + مخزون">إجمالي القيمة المحسوبة</TableHead>
                    <TableHead className="font-bold" title="إجمالي القيمة - إجمالي التكلفة">صافي الربح / الخسارة</TableHead>
                    <TableHead>هامش الربح</TableHead>
                    <TableHead>الحالة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.departments.map(d => {
                    const totalCost = (d.productionCost ?? 0) + (d.operatingExpenses ?? 0);
                    const margin = d.totalComputedValue > 0 ? (d.operationalNet / d.totalComputedValue) * 100 : 0;
                    return (
                      <TableRow key={d.key} className="cursor-pointer hover:bg-muted/40" onClick={() => setSelectedDept(d)}>
                        <TableCell className="font-medium">{d.name}</TableCell>
                        <TableCell className="tabular-nums text-orange-700">{fmt(d.productionCost ?? 0)}</TableCell>
                        <TableCell className="tabular-nums text-red-600">{fmt(d.operatingExpenses ?? 0)}</TableCell>
                        <TableCell className="tabular-nums font-bold text-red-700">{fmt(totalCost)}</TableCell>
                        <TableCell className="tabular-nums text-green-700">{fmt(d.cashRevenue)}</TableCell>
                        <TableCell className="tabular-nums text-blue-700">{fmt(d.internalValue)}</TableCell>
                        <TableCell className="tabular-nums text-purple-700">{fmt(d.remainingInventoryValue)}</TableCell>
                        <TableCell className="tabular-nums font-bold text-green-700">{fmt(d.totalComputedValue)}</TableCell>
                        <TableCell className={`tabular-nums font-bold ${d.operationalNet >= 0 ? "text-green-700" : "text-red-700"}`}>
                          {d.operationalNet >= 0 ? "+" : ""}{fmt(d.operationalNet)}
                        </TableCell>
                        <TableCell className={`tabular-nums ${margin >= 0 ? "text-green-700" : "text-red-700"}`}>
                          {margin.toFixed(1)}%
                        </TableCell>
                        <TableCell>{statusBadge(d.status)}</TableCell>
                      </TableRow>
                    );
                  })}
                  {/* Grand totals */}
                  {(() => {
                    const totals = data.totals;
                    const totalCost = (totals.productionCost ?? 0) + (totals.operatingExpenses ?? 0);
                    const margin = totals.totalComputedValue > 0 ? (totals.operationalNet / totals.totalComputedValue) * 100 : 0;
                    return (
                      <TableRow className="bg-primary/10 font-bold border-t-2">
                        <TableCell>الإجمالي العام للشركة</TableCell>
                        <TableCell className="tabular-nums text-orange-800">{fmt(totals.productionCost ?? 0)}</TableCell>
                        <TableCell className="tabular-nums text-red-700">{fmt(totals.operatingExpenses ?? 0)}</TableCell>
                        <TableCell className="tabular-nums text-red-800">{fmt(totalCost)}</TableCell>
                        <TableCell className="tabular-nums text-green-800">{fmt(totals.cashRevenue)}</TableCell>
                        <TableCell className="tabular-nums text-blue-800">{fmt(totals.internalValue)}</TableCell>
                        <TableCell className="tabular-nums text-purple-800">{fmt(totals.remainingInventoryValue)}</TableCell>
                        <TableCell className="tabular-nums text-green-800">{fmt(totals.totalComputedValue)}</TableCell>
                        <TableCell className={`tabular-nums ${totals.operationalNet >= 0 ? "text-green-800" : "text-red-800"}`}>
                          {totals.operationalNet >= 0 ? "+" : ""}{fmt(totals.operationalNet)}
                        </TableCell>
                        <TableCell className={`tabular-nums ${margin >= 0 ? "text-green-800" : "text-red-800"}`}>
                          {margin.toFixed(1)}%
                        </TableCell>
                        <TableCell>{totals.operationalNet > 0 ? <Badge className="bg-green-600">كسبان</Badge> : totals.operationalNet < 0 ? <Badge variant="destructive">خسران</Badge> : <Badge variant="secondary">تعادل</Badge>}</TableCell>
                      </TableRow>
                    );
                  })()}
                </TableBody>
              </Table>
              <div className="mt-3 grid sm:grid-cols-3 gap-2 text-xs">
                <div className="rounded p-2 bg-red-50 border border-red-200">
                  <b>إجمالي التكلفة علينا:</b> {fmt((data.totals.productionCost ?? 0) + (data.totals.operatingExpenses ?? 0))} ج.م
                </div>
                <div className="rounded p-2 bg-green-50 border border-green-200">
                  <b>إجمالي البيع والقيمة:</b> {fmt(data.totals.totalComputedValue)} ج.م
                </div>
                <div className={`rounded p-2 border ${data.totals.operationalNet >= 0 ? "bg-emerald-50 border-emerald-300" : "bg-rose-50 border-rose-300"}`}>
                  <b>صافي الربح / الخسارة:</b> {data.totals.operationalNet >= 0 ? "+" : ""}{fmt(data.totals.operationalNet)} ج.م
                  {" "}({data.totals.operationalNet >= 0 ? "كسبان ✅" : "خسران ⚠"})
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Comparison table */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>مقارنة الأقسام — قيمة نقدية + قيمة تشغيلية</span>
                <span className="text-xs font-normal text-muted-foreground">
                  قيمة تشغيلية = تحويلات داخلية / مخزون متبقٍ (لا تنشئ حركة خزنة)
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>القسم</TableHead>
                    <TableHead title="فلوس فعلية دخلت خزنة">إيراد نقدي</TableHead>
                    <TableHead title="تحويلات داخلية بقيمتها (بدون خزنة)">قيمة تشغيلية داخلية</TableHead>
                    <TableHead title="مخزون متبقٍ بقيمته كأصل">قيمة مخزون متبقٍ</TableHead>
                    <TableHead>إجمالي القيمة</TableHead>
                    <TableHead>مصروفات</TableHead>
                    <TableHead title="إيراد نقدي - مصروفات">صافي نقدي</TableHead>
                    <TableHead title="إجمالي القيمة - مصروفات">صافي تشغيلي</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.departments.map(d => (
                    <TableRow key={d.key} className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setSelectedDept(d)}>
                      <TableCell className="font-medium">{d.name}</TableCell>
                      <TableCell className="tabular-nums text-green-700">{fmt(d.cashRevenue)}</TableCell>
                      <TableCell className="tabular-nums text-blue-700">{fmt(d.internalValue)}</TableCell>
                      <TableCell className="tabular-nums text-purple-700">{fmt(d.remainingInventoryValue)}</TableCell>
                      <TableCell className="tabular-nums font-semibold">{fmt(d.totalComputedValue)}</TableCell>
                      <TableCell className="text-red-700 tabular-nums">{fmt(d.expenses)}</TableCell>
                      <TableCell className={`tabular-nums ${d.cashNet >= 0 ? "text-green-700" : "text-red-700"}`}>
                        {fmt(d.cashNet)}
                      </TableCell>
                      <TableCell className={`tabular-nums font-bold ${d.operationalNet >= 0 ? "text-green-700" : "text-red-700"}`}>
                        {fmt(d.operationalNet)}
                      </TableCell>
                      <TableCell>{statusBadge(d.status)}</TableCell>
                      <TableCell>
                        <div className="flex gap-1 justify-end">
                          <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setSelectedDept(d); }}>
                            تفاصيل
                          </Button>
                          <Button size="sm" variant={d.status === "loss" ? "default" : "outline"}
                            onClick={(e) => { e.stopPropagation(); setAnalysisDept(d); }}>
                            <Microscope className="h-3 w-3 ml-1" /> تحليل
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {data.departments.some(d => d.cashStatus === "loss" && d.status !== "loss") && (
                <div className="mt-3 text-xs text-blue-800 bg-blue-50 border border-blue-200 rounded p-2 flex gap-2">
                  <Lightbulb className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>بعض الأقسام لا تحقق تحصيلًا نقديًا مباشرًا لكنها تنتج قيمة تشغيلية داخلية موجبة (تظهر كسبانة بعد احتساب التحويلات والمخزون).</span>
                </div>
              )}
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

          {/* Top products across all departments */}
          {((data.topProfitProducts?.length ?? 0) + (data.topLossProducts?.length ?? 0)) > 0 && (
            <div className="grid lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader><CardTitle className="text-base flex items-center gap-2">
                  <Crown className="h-4 w-4 text-amber-500" /> أكثر المنتجات ربحًا
                </CardTitle></CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>المنتج</TableHead><TableHead>القسم</TableHead>
                      <TableHead>الكمية</TableHead><TableHead>الإيراد</TableHead>
                      <TableHead>التكلفة</TableHead><TableHead>الربح</TableHead>
                      <TableHead>الهامش</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {(data.topProfitProducts ?? []).filter(p => p.profit > 0).length === 0 && (
                        <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">
                          لا توجد منتجات مربحة هذا الشهر
                        </TableCell></TableRow>
                      )}
                      {(data.topProfitProducts ?? []).filter(p => p.profit > 0).map((p, i) => (
                        <TableRow key={i}>
                          <TableCell>{p.name}</TableCell>
                          <TableCell className="text-xs">{p.dept}</TableCell>
                          <TableCell className="tabular-nums">{fmt(p.qty)}</TableCell>
                          <TableCell className="tabular-nums">{fmt(p.revenue)}</TableCell>
                          <TableCell className="tabular-nums text-muted-foreground">{fmt(p.cost)}</TableCell>
                          <TableCell className="tabular-nums text-green-700 font-bold">{fmt(p.profit)}</TableCell>
                          <TableCell className="tabular-nums">{p.margin.toFixed(1)}%</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-base flex items-center gap-2">
                  <Skull className="h-4 w-4 text-red-500" /> أكثر المنتجات خسارة
                </CardTitle></CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>المنتج</TableHead><TableHead>القسم</TableHead>
                      <TableHead>الكمية</TableHead><TableHead>الإيراد</TableHead>
                      <TableHead>التكلفة</TableHead><TableHead>الخسارة</TableHead>
                      <TableHead>الهامش</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {(data.topLossProducts?.length ?? 0) === 0 && (
                        <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">
                          لا توجد منتجات خاسرة هذا الشهر ✅
                        </TableCell></TableRow>
                      )}
                      {(data.topLossProducts ?? []).map((p, i) => (
                        <TableRow key={i}>
                          <TableCell>{p.name}</TableCell>
                          <TableCell className="text-xs">{p.dept}</TableCell>
                          <TableCell className="tabular-nums">{fmt(p.qty)}</TableCell>
                          <TableCell className="tabular-nums">{fmt(p.revenue)}</TableCell>
                          <TableCell className="tabular-nums text-muted-foreground">{fmt(p.cost)}</TableCell>
                          <TableCell className="tabular-nums text-red-700 font-bold">{fmt(p.profit)}</TableCell>
                          <TableCell className="tabular-nums">{p.margin.toFixed(1)}%</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Unified product profitability table */}
          {(() => {
            const all = [
              ...(data.topProfitProducts ?? []),
              ...(data.topLossProducts ?? []),
            ];
            const seen = new Set<string>();
            const unique = all.filter(p => {
              const k = `${p.dept}|${p.name}`;
              if (seen.has(k)) return false; seen.add(k); return true;
            }).sort((a, b) => b.profit - a.profit);
            if (unique.length === 0) return null;
            return (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between flex-wrap gap-2">
                    <span>ربحية المنتجات — تكلفة فعلية × سعر بيع فعلي</span>
                    <span className="text-xs font-normal text-muted-foreground">مرتبة من الأعلى ربحًا للأكثر خسارة</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>المنتج</TableHead>
                        <TableHead>القسم المصدر</TableHead>
                        <TableHead>الكمية المباعة</TableHead>
                        <TableHead>تكلفة الكمية</TableHead>
                        <TableHead>قيمة البيع</TableHead>
                        <TableHead>الربح / الخسارة</TableHead>
                        <TableHead>هامش %</TableHead>
                        <TableHead>مصدر التكلفة</TableHead>
                        <TableHead>الحالة</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {unique.map((p, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-medium">{p.name}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{p.dept}</TableCell>
                          <TableCell className="tabular-nums">{fmt(p.qty)}</TableCell>
                          <TableCell className="tabular-nums text-muted-foreground">{fmt(p.cost)}</TableCell>
                          <TableCell className="tabular-nums text-green-700">{fmt(p.revenue)}</TableCell>
                          <TableCell className={`tabular-nums font-bold ${p.profit >= 0 ? "text-green-700" : "text-red-700"}`}>
                            {p.profit >= 0 ? "+" : ""}{fmt(p.profit)}
                          </TableCell>
                          <TableCell className={`tabular-nums ${p.margin >= 0 ? "text-green-700" : "text-red-700"}`}>
                            {p.margin.toFixed(1)}%
                          </TableCell>
                          <TableCell className="text-xs">
                            {p.costSource === "غير محدد"
                              ? <Badge variant="outline" className="text-amber-700 border-amber-300">غير محدد</Badge>
                              : <span className="text-muted-foreground">{p.costSource ?? "—"}</span>}
                          </TableCell>
                          <TableCell>
                            {p.profit > 0 ? <Badge className="bg-green-600">كسبان</Badge>
                              : p.profit < 0 ? <Badge variant="destructive">خسران</Badge>
                              : <Badge variant="secondary">تعادل</Badge>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            );
          })()}


          <Card>
            <CardHeader><CardTitle className="text-base">ضمانات النزاهة المالية ومصادر الأرقام</CardTitle></CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-1">
              <div>• {data.meta?.note ?? "القيم التشغيلية الداخلية والأصول المتبقية للعرض فقط."}</div>
              <div>• تكلفة الإنتاج: <b className={data.meta?.usedActualProductionCost ? "text-green-700" : "text-amber-700"}>
                {data.meta?.usedActualProductionCost ? "✅ من فواتير التصنيع الفعلية" : "تقديرية"}
              </b></div>
              <div>• سعر البيع: <b className={data.meta?.usedActualSalePrice ? "text-green-700" : "text-amber-700"}>
                {data.meta?.usedActualSalePrice ? "✅ من فواتير المبيعات الفعلية" : "تقديري"}
              </b></div>
              <div>• إجمالي تكلفة الإنتاج للأقسام: <b>{fmt(data.totals.productionCost ?? 0)}</b> ج.م</div>
              <div>• إجمالي المصروفات التشغيلية (غير الإنتاجية): <b>{fmt(data.totals.operatingExpenses ?? 0)}</b> ج.م</div>
              <div>• عدد حركات الخزنة التي أنشأها هذا التقرير: <b className="text-green-700">{data.meta?.treasuryMovementsCreated ?? 0}</b></div>
              <div>• الأسعار الداخلية: <a href="/modules/internal-prices-settings" className="text-primary underline">إعدادات الأسعار الداخلية</a></div>
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
                <KpiCard title="إيراد نقدي" value={fmt(selectedDept.cashRevenue)} accent="text-green-700" />
                <KpiCard title="قيمة تشغيلية داخلية" value={fmt(selectedDept.internalValue)} accent="text-blue-700" />
                <KpiCard title="قيمة مخزون متبقٍ" value={fmt(selectedDept.remainingInventoryValue)} accent="text-purple-700" />
                <KpiCard title="إجمالي القيمة" value={fmt(selectedDept.totalComputedValue)} accent="text-foreground" />
                <KpiCard title="المصروفات" value={fmt(selectedDept.expenses)} accent="text-red-700" />
                <KpiCard title="صافي نقدي"
                  value={fmt(selectedDept.cashNet)}
                  accent={selectedDept.cashNet >= 0 ? "text-green-700" : "text-red-700"} />
                <KpiCard title="صافي تشغيلي"
                  value={fmt(selectedDept.operationalNet)}
                  accent={selectedDept.operationalNet >= 0 ? "text-green-700" : "text-red-700"} />
                <KpiCard title="نسبة المصروفات" value={`${selectedDept.expenseRatio.toFixed(1)}%`} />
              </div>
              {/* Production cost breakdown */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <KpiCard title="تكلفة الإنتاج / التصنيع" value={fmt(selectedDept.productionCost ?? 0)} accent="text-orange-700" />
                <KpiCard title="مصروفات تشغيلية أخرى" value={fmt(selectedDept.operatingExpenses ?? 0)} accent="text-red-600" />
                <KpiCard title="هامش الربح الإجمالي"
                  value={`${(selectedDept.grossMargin ?? 0).toFixed(1)}%`}
                  accent={(selectedDept.grossMargin ?? 0) >= 0 ? "text-green-700" : "text-red-700"} />
                <KpiCard title="أعلى بند تكلفة"
                  value={selectedDept.topCostItem?.name ?? "—"}
                  sub={selectedDept.topCostItem ? fmt(selectedDept.topCostItem.amount) : ""} />
              </div>
              {selectedDept.pricingWarnings.length > 0 && (
                <div className="rounded-md p-3 bg-amber-50 border border-amber-200 text-sm">
                  {selectedDept.pricingWarnings.map((w, i) => (
                    <div key={i} className="flex gap-2"><AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" /> {w}</div>
                  ))}
                </div>
              )}
              {(selectedDept.productMetrics?.length ?? 0) > 0 && (
                <Card>
                  <CardHeader><CardTitle className="text-base">ربحية المنتجات</CardTitle></CardHeader>
                  <CardContent className="overflow-x-auto">
                    <Table>
                      <TableHeader><TableRow>
                        <TableHead>المنتج</TableHead><TableHead>الكمية</TableHead>
                        <TableHead>الإيراد</TableHead><TableHead>التكلفة</TableHead>
                        <TableHead>الربح</TableHead><TableHead>الهامش</TableHead>
                      </TableRow></TableHeader>
                      <TableBody>
                        {selectedDept.productMetrics.map((p, i) => (
                          <TableRow key={i}>
                            <TableCell>{p.name}</TableCell>
                            <TableCell className="tabular-nums">{fmt(p.qty)}</TableCell>
                            <TableCell className="tabular-nums">{fmt(p.revenue)}</TableCell>
                            <TableCell className="tabular-nums text-muted-foreground">{fmt(p.cost)}</TableCell>
                            <TableCell className={`tabular-nums font-bold ${p.profit >= 0 ? "text-green-700" : "text-red-700"}`}>
                              {fmt(p.profit)}
                            </TableCell>
                            <TableCell className="tabular-nums">{p.margin.toFixed(1)}%</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
              <Tabs defaultValue="rev">
                <TabsList>
                  <TabsTrigger value="rev">الإيرادات والقيم ({selectedDept.revenueItems.length})</TabsTrigger>
                  <TabsTrigger value="exp">المصروفات ({selectedDept.expenseItems.length})</TabsTrigger>
                </TabsList>
                <TabsContent value="rev">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>التاريخ</TableHead><TableHead>البيان</TableHead>
                      <TableHead>المصدر</TableHead><TableHead>النوع</TableHead>
                      <TableHead>المبلغ</TableHead>
                      <TableHead>المرجع</TableHead><TableHead>الجهة</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {selectedDept.revenueItems.map((i, k) => {
                        const cat = i.category ?? "cash";
                        const catLabel = cat === "cash" ? "نقدي" : cat === "internal" ? "تشغيلي داخلي" : "أصل / مخزون";
                        const catColor = cat === "cash" ? "bg-green-100 text-green-800" :
                          cat === "internal" ? "bg-blue-100 text-blue-800" : "bg-purple-100 text-purple-800";
                        return (
                          <TableRow key={k}>
                            <TableCell>{i.date?.slice(0, 10)}</TableCell>
                            <TableCell>{i.label}</TableCell>
                            <TableCell>{i.source}</TableCell>
                            <TableCell>
                              <span className={`text-[10px] px-2 py-0.5 rounded ${catColor}`}>{catLabel}</span>
                              {i.priceSource === "avg_cost" && (
                                <span className="text-[10px] mr-1 text-amber-700">(متوسط تكلفة)</span>
                              )}
                            </TableCell>
                            <TableCell className="tabular-nums text-green-700">{fmt(i.amount)}</TableCell>
                            <TableCell className="text-xs">{i.reference || ""}</TableCell>
                            <TableCell className="text-xs">{i.treasury || ""}</TableCell>
                          </TableRow>
                        );
                      })}
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

      <AnalysisDialog dept={analysisDept} onClose={() => setAnalysisDept(null)} />
    </motion.div>
  );
}

// ============ Profit / Loss root-cause analysis ============
function groupSources(items: LineItem[]) {
  const m = new Map<string, number>();
  for (const i of items) m.set(i.source, (m.get(i.source) || 0) + i.amount);
  return [...m.entries()]
    .map(([source, amount]) => ({ source, amount }))
    .sort((a, b) => b.amount - a.amount);
}

function analyzeDept(d: DeptResult) {
  const expGrouped = groupSources(d.expenseItems);
  const revGrouped = groupSources(d.revenueItems);
  const top10Exp = expGrouped.slice(0, 10).map(e => ({
    ...e, pct: d.expenses > 0 ? (e.amount / d.expenses) * 100 : 0,
  }));
  const top10Rev = revGrouped.slice(0, 10).map(e => ({
    ...e, pct: d.revenue > 0 ? (e.amount / d.revenue) * 100 : 0,
  }));

  // Outlier expense (single bucket > 50% of dept expenses)
  const outliers = top10Exp.filter(e => e.pct >= 50);

  // Missing revenue flags by department
  const missingRevenue: string[] = [];
  if (d.key === "slaughterhouse") {
    if (d.revenue === 0)
      missingRevenue.push("لم تُسجل قيمة لناتج الذبح أو التحويلات للمخزن الرئيسي / مصنع اللحوم هذا الشهر.");
    else if (d.revenue < d.expenses * 0.5)
      missingRevenue.push("قيمة ناتج الذبح المسجّلة أقل بكثير من المصروفات — يحتمل وجود تحويلات بدون أسعار بيع داخلية.");
  }
  if (d.key === "feed_factory") {
    if (d.revenue === 0)
      missingRevenue.push("لا توجد توريدات داخلية معتمدة ولا مبيعات خارجية مسجّلة هذا الشهر.");
    const internal = revGrouped.find(r => r.source.includes("داخلي"))?.amount ?? 0;
    const external = revGrouped.find(r => r.source.includes("خارجي"))?.amount ?? 0;
    if (internal === 0 && d.expenses > 0)
      missingRevenue.push("لا توجد توريدات داخلية معتمدة — الإنتاج المصروف للأقسام الأخرى قد يكون غير مسعّر.");
    if (external === 0)
      missingRevenue.push("لا توجد مبيعات علف خارجية هذا الشهر.");
    missingRevenue.push("قيمة المخزون المتبقي من الخامات والعلف الجاهز غير محسوبة كأصل (يجب احتسابها لتحديد التكلفة الحقيقية للكيلو).");
  }
  if (d.key === "hatchery" && d.revenue === 0 && d.expenses > 0) {
    missingRevenue.push("لا توجد فواتير عملاء صادرة هذا الشهر — قد تكون هناك دفعات لم تُغلق بفواتير.");
  }
  if (d.key === "brooding" && d.revenue === 0 && d.expenses > 0) {
    missingRevenue.push("لا توجد مبيعات كتاكيت مسجّلة هذا الشهر مقابل المصروفات.");
  }

  // Build recommendation text
  const top = top10Exp[0];
  const topRev = top10Rev[0];
  let summary = "";
  if (d.status === "profit") {
    summary = `${d.name} كسبان بصافي ${Math.round(d.net).toLocaleString()} ج.م. ` +
      (topRev ? `أكبر مصدر إيراد: ${topRev.source} (${topRev.pct.toFixed(0)}% من الإيرادات). ` : "") +
      (top ? `أكبر بند مصروف: ${top.source} (${top.pct.toFixed(0)}% من المصروفات).` : "");
  } else if (d.status === "loss") {
    summary = `${d.name} خسران بصافي ${Math.round(d.net).toLocaleString()} ج.م. `;
    if (top) summary += `السبب الرئيسي: بند "${top.source}" يمثّل ${top.pct.toFixed(0)}% من إجمالي مصروفات القسم. `;
    if (d.revenue === 0) summary += "لا توجد إيرادات مسجّلة هذا الشهر مقابل المصروفات. ";
    else if (d.revenue < d.expenses) summary += `الإيرادات المسجّلة (${Math.round(d.revenue).toLocaleString()}) أقل من المصروفات (${Math.round(d.expenses).toLocaleString()}). `;
    if (outliers.length) summary += `يوجد بند مصروف غير طبيعي يستحوذ على أغلب المصروفات. `;
  } else {
    summary = `${d.name} متعادل.`;
  }

  // Recommendations
  const recs: string[] = [];
  if (d.key === "slaughterhouse" && d.status === "loss") {
    recs.push("راجع تسعير ناتج الذبح المحوّل للمخزن الرئيسي ومصنع اللحوم — لو التحويل بسعر صفر سيظهر القسم خسران.");
    recs.push("افصل عمالة الذبح الثابتة عن المتغيرة لمعرفة التكلفة الحقيقية للكيلو.");
  }
  if (d.key === "feed_factory" && d.status === "loss") {
    recs.push("اعتمد التوريدات الداخلية شهريًا حتى تظهر كإيراد للمصنع.");
    recs.push("احسب قيمة المخزون المتبقي (خامات + علف جاهز) واخصمه من المصروفات الحقيقية للشهر.");
    recs.push("راجع تكلفة الكيلو الفعلية مقابل السعر الذي يدفعه القسم المستهلك.");
  }
  if (outliers.length) {
    recs.push(`بند "${outliers[0].source}" يستحوذ على ${outliers[0].pct.toFixed(0)}% من مصروفات القسم — تأكد من عدم وجود إدخال مكرر أو خطأ في المبلغ.`);
  }
  if (d.revenue === 0 && d.expenses > 0) {
    recs.push("سجّل الإيرادات أو التحويلات الداخلية بقيمتها الحقيقية حتى لا يظهر القسم خسران مزيف.");
  }
  if (recs.length === 0 && d.status === "profit") {
    recs.push("استمر في نفس النمط مع متابعة أكبر بند مصروف لتفادي الانحراف الشهر القادم.");
  }

  return { top10Exp, top10Rev, outliers, missingRevenue, summary, recs };
}

function AnalysisDialog({ dept, onClose }: { dept: DeptResult | null; onClose: () => void }) {
  if (!dept) return null;
  const a = analyzeDept(dept);
  return (
    <Dialog open={!!dept} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl max-h-[88vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Microscope className="h-5 w-5 text-primary" />
            تحليل سبب الربح / الخسارة — {dept.name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Summary card */}
          <div className={`rounded-lg p-4 border-2 ${
            dept.status === "loss" ? "bg-red-50 border-red-300" :
            dept.status === "profit" ? "bg-green-50 border-green-300" :
            "bg-muted border-border"
          }`}>
            <div className="flex items-start gap-2">
              <Lightbulb className="h-5 w-5 mt-0.5 text-amber-600 shrink-0" />
              <div>
                <div className="font-bold mb-1">الخلاصة التحليلية</div>
                <div className="text-sm leading-7">{a.summary}</div>
              </div>
            </div>
          </div>

          {/* Comparison cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard title="إجمالي الإيرادات" value={fmt(dept.revenue)} accent="text-green-700" />
            <KpiCard title="إجمالي المصروفات" value={fmt(dept.expenses)} accent="text-red-700" />
            <KpiCard title="الصافي" value={fmt(dept.net)}
              accent={dept.net >= 0 ? "text-green-700" : "text-red-700"} />
            <KpiCard title="نسبة المصروفات للإيرادات"
              value={dept.revenue > 0 ? `${dept.expenseRatio.toFixed(1)}%` : "—"} />
          </div>

          {/* Outliers */}
          {a.outliers.length > 0 && (
            <div className="rounded-md p-3 bg-amber-50 border border-amber-200 text-sm flex gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <div>
                <b>بند مصروف غير طبيعي: </b>
                {a.outliers.map(o => `${o.source} (${o.pct.toFixed(0)}%)`).join("، ")}
                {" — "}راجعه قبل إقفال الشهر.
              </div>
            </div>
          )}

          {/* Missing revenue */}
          {a.missingRevenue.length > 0 && (
            <div className="rounded-md p-3 bg-orange-50 border border-orange-200 text-sm">
              <div className="font-bold mb-1 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-orange-600" />
                إيرادات أو قيم تشغيلية محتملة غير مسجّلة
              </div>
              <ul className="list-disc pr-5 space-y-1">
                {a.missingRevenue.map((m, i) => <li key={i}>{m}</li>)}
              </ul>
            </div>
          )}

          <div className="grid lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle className="text-base">أكبر 10 بنود مصروفات</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>#</TableHead><TableHead>البند</TableHead>
                    <TableHead>المبلغ</TableHead><TableHead>% من المصروفات</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {a.top10Exp.length === 0 && (
                      <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">
                        لا توجد مصروفات
                      </TableCell></TableRow>
                    )}
                    {a.top10Exp.map((e, i) => (
                      <TableRow key={i}>
                        <TableCell>{i + 1}</TableCell>
                        <TableCell>{e.source}</TableCell>
                        <TableCell className="tabular-nums text-red-700">{fmt(e.amount)}</TableCell>
                        <TableCell className="tabular-nums">
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-2 bg-muted rounded overflow-hidden">
                              <div className="h-full bg-red-500" style={{ width: `${Math.min(e.pct, 100)}%` }} />
                            </div>
                            {e.pct.toFixed(1)}%
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">أكبر 10 مصادر إيراد / قيمة تشغيلية</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>#</TableHead><TableHead>المصدر</TableHead>
                    <TableHead>المبلغ</TableHead><TableHead>% من الإيرادات</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {a.top10Rev.length === 0 && (
                      <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">
                        لا توجد إيرادات مسجّلة
                      </TableCell></TableRow>
                    )}
                    {a.top10Rev.map((e, i) => (
                      <TableRow key={i}>
                        <TableCell>{i + 1}</TableCell>
                        <TableCell>{e.source}</TableCell>
                        <TableCell className="tabular-nums text-green-700">{fmt(e.amount)}</TableCell>
                        <TableCell className="tabular-nums">
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-2 bg-muted rounded overflow-hidden">
                              <div className="h-full bg-green-500" style={{ width: `${Math.min(e.pct, 100)}%` }} />
                            </div>
                            {e.pct.toFixed(1)}%
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>

          {/* Deep analysis (slaughterhouse / hatchery) */}
          {dept.deepAnalysis && <DeepAnalysisSection data={dept.deepAnalysis} />}



          {/* Recommendations */}
          {a.recs.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-amber-500" /> توصيات
              </CardTitle></CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  {a.recs.map((r, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-primary font-bold">•</span>
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      </DialogContent>
    </Dialog>
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

function DeepAnalysisSection({ data }: { data: any }) {
  if (!data) return null;
  if (data.type === "slaughterhouse") return <SlaughterDeepAnalysis d={data} />;
  if (data.type === "hatchery") return <HatcheryDeepAnalysis d={data} />;
  return null;
}

function SlaughterDeepAnalysis({ d }: { d: any }) {
  const cb = d.costBreakdown || {};
  const ot = d.outputTotals || {};
  const outs: any[] = d.outputs || [];
  const cats: any[] = cb.custodyByCategory || [];
  const causes: string[] = d.rootCauses || [];
  const diff = (ot.valueAtInternalPrice || 0) - (cb.grandTotal || 0);

  return (
    <div className="space-y-4 mt-2">
      <div className="rounded-lg border-2 border-primary/30 bg-primary/5 p-3">
        <div className="font-bold text-primary mb-2">تحليل تفصيلي — المجزر</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard title="تكلفة الطيور/النعام" value={fmt(cb.birds)} sub={`${fmt(cb.birdsCount || 0)} طائر · ${fmt(cb.birdsKg || 0)} كجم`} accent="text-orange-700" />
          <KpiCard title="علف المجزر" value={fmt(cb.feed)} accent="text-orange-700" />
          <KpiCard title="عهدة المجزر (إجمالي)" value={fmt(cb.custodyTotal)} accent="text-red-700" />
          <KpiCard title="تكلفة الذبح المباشرة" value={fmt(cb.productionCostTotal)} accent="text-red-700" />
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">تفصيل مصروفات العهدة</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>البند</TableHead><TableHead>المبلغ</TableHead><TableHead>%</TableHead></TableRow></TableHeader>
            <TableBody>
              {cats.length === 0 && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">لا توجد مصروفات عهدة</TableCell></TableRow>}
              {cats.map((c, i) => (
                <TableRow key={i}>
                  <TableCell>{c.label}</TableCell>
                  <TableCell className="tabular-nums text-red-700">{fmt(c.amount)}</TableCell>
                  <TableCell className="tabular-nums">{cb.custodyTotal > 0 ? ((c.amount / cb.custodyTotal) * 100).toFixed(0) : 0}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">ناتج الذبح — تفصيل لكل صنف</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>الصنف</TableHead>
              <TableHead>كجم</TableHead>
              <TableHead>تكلفة/كجم</TableHead>
              <TableHead>سعر داخلي</TableHead>
              <TableHead>قيمة بالتكلفة</TableHead>
              <TableHead>قيمة بالسعر الداخلي</TableHead>
              <TableHead>قيمة المحول</TableHead>
              <TableHead>غير مربوط</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {outs.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">لا توجد مخرجات</TableCell></TableRow>}
              {outs.map((o, i) => (
                <TableRow key={i} className={o.internalPrice <= 0 ? "bg-amber-50" : ""}>
                  <TableCell>{o.cut}</TableCell>
                  <TableCell className="tabular-nums">{fmt(o.qty)}</TableCell>
                  <TableCell className="tabular-nums">{fmt(o.avgUnitCost)}</TableCell>
                  <TableCell className="tabular-nums">{o.internalPrice > 0 ? fmt(o.internalPrice) : <Badge variant="destructive" className="text-[10px]">بدون سعر</Badge>}</TableCell>
                  <TableCell className="tabular-nums">{fmt(o.valueAtCost)}</TableCell>
                  <TableCell className="tabular-nums text-blue-700">{fmt(o.valueAtInternal)}</TableCell>
                  <TableCell className="tabular-nums text-green-700">{fmt(o.transferredValue)}</TableCell>
                  <TableCell className="tabular-nums">{o.unmappedCount > 0 ? <Badge variant="destructive" className="text-[10px]">{o.unmappedCount}</Badge> : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">جدول ربح/خسارة المجزر</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableBody>
              <TableRow><TableCell>إجمالي تكلفة المجزر</TableCell><TableCell className="tabular-nums text-red-700">{fmt(cb.grandTotal)}</TableCell></TableRow>
              <TableRow><TableCell>قيمة المخرجات بسعر التكلفة</TableCell><TableCell className="tabular-nums">{fmt(ot.valueAtCost)}</TableCell></TableRow>
              <TableRow><TableCell>قيمة المخرجات بالسعر الداخلي</TableCell><TableCell className="tabular-nums text-blue-700">{fmt(ot.valueAtInternalPrice)}</TableCell></TableRow>
              <TableRow><TableCell>قيمة التحويلات الفعلية للمخزن/مصنع اللحوم</TableCell><TableCell className="tabular-nums text-green-700">{fmt(ot.valueOfTransfers)}</TableCell></TableRow>
              <TableRow><TableCell>قيمة المبيعات الفعلية للمنتجات</TableCell><TableCell className="tabular-nums text-green-700">{fmt(ot.actualSalesValue)}</TableCell></TableRow>
              <TableRow><TableCell>قيمة المخزون المتبقي</TableCell><TableCell className="tabular-nums text-purple-700">{fmt(ot.remainingInventoryValue)}</TableCell></TableRow>
              <TableRow className="font-bold border-t-2"><TableCell>الفرق (قيمة داخلية − تكلفة)</TableCell><TableCell className={`tabular-nums ${diff >= 0 ? "text-green-700" : "text-red-700"}`}>{fmt(diff)}</TableCell></TableRow>
              <TableRow><TableCell>سعر تعادل/كجم مطلوب</TableCell><TableCell className="tabular-nums">{fmt(d.breakEvenPricePerKg)} ج/كجم</TableCell></TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {causes.length > 0 && (
        <Card className="border-red-300 bg-red-50">
          <CardHeader><CardTitle className="text-base flex items-center gap-2 text-red-800">
            <AlertTriangle className="h-4 w-4" /> أسباب الخسارة المحتملة
          </CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {causes.map((c, i) => <li key={i} className="flex gap-2"><span className="text-red-700 font-bold">•</span><span>{c}</span></li>)}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function HatcheryDeepAnalysis({ d }: { d: any }) {
  const rev = d.revenueByService || {};
  const col = d.collections || {};
  const exp = d.expenses || {};
  const causes: string[] = d.rootCauses || [];
  const byMethod: any[] = col.byMethod || [];
  const expCats: any[] = exp.byCategory || [];
  const cashNet = (col.total || 0) - (exp.total || 0);
  const opNet = (d.invoicedTotal || 0) - (d.discountsTotal || 0) - (exp.total || 0);

  return (
    <div className="space-y-4 mt-2">
      <div className="rounded-lg border-2 border-primary/30 bg-primary/5 p-3">
        <div className="font-bold text-primary mb-2">تحليل تفصيلي — معمل التفريخ</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard title="إجمالي فواتير التفريخ" value={fmt(d.invoicedTotal)} accent="text-blue-700" />
          <KpiCard title="إجمالي المحصل نقديًا" value={fmt(col.total)} accent="text-green-700" />
          <KpiCard title="متبقي على العملاء" value={fmt(d.outstandingOnCustomers)} accent="text-red-700" />
          <KpiCard title="مصروفات المعمل" value={fmt(exp.total)} accent="text-red-700" />
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">تفصيل إيرادات الفواتير حسب الخدمة</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableBody>
              <TableRow><TableCell>رسوم الكتاكيت</TableCell><TableCell className="tabular-nums text-green-700">{fmt(rev.chicks)}</TableCell></TableRow>
              <TableRow><TableCell>رسوم التحضين</TableCell><TableCell className="tabular-nums text-green-700">{fmt(rev.brooding)}</TableCell></TableRow>
              <TableRow><TableCell>رسوم اللايح (مكتمل بدون فقس)</TableCell><TableCell className="tabular-nums text-green-700">{fmt(rev.completed_unhatched)}</TableCell></TableRow>
              <TableRow><TableCell>رسوم الكشف (لقاح)</TableCell><TableCell className="tabular-nums text-green-700">{fmt(rev.infertile)}</TableCell></TableRow>
              <TableRow className="font-bold border-t-2"><TableCell>إجمالي الفواتير</TableCell><TableCell className="tabular-nums">{fmt(d.invoicedTotal)}</TableCell></TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">التحصيلات النقدية بالتفصيل</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableBody>
              <TableRow><TableCell>تحصيلات على فواتير محددة</TableCell><TableCell className="tabular-nums">{fmt(col.fromInvoicePayments)}</TableCell></TableRow>
              <TableRow><TableCell>تحصيلات على حساب العميل (دفعات)</TableCell><TableCell className="tabular-nums">{fmt(col.fromCustomerDeposits)}</TableCell></TableRow>
              <TableRow><TableCell>خزنة المعمل — معتمدة</TableCell><TableCell className="tabular-nums text-green-700">{fmt(col.fromLabTreasuryApproved)}</TableCell></TableRow>
              <TableRow><TableCell>خزنة المعمل — قيد الاعتماد (pending)</TableCell><TableCell className="tabular-nums text-amber-700">{fmt(col.labTreasuryPending)}</TableCell></TableRow>
              <TableRow className="font-bold border-t-2"><TableCell>إجمالي المحصل نقديًا (معتمد)</TableCell><TableCell className="tabular-nums text-green-700">{fmt(col.total)}</TableCell></TableRow>
            </TableBody>
          </Table>
          {byMethod.length > 0 && (
            <div className="mt-3">
              <div className="text-xs text-muted-foreground mb-2">حسب وسيلة الدفع:</div>
              <div className="flex flex-wrap gap-2">
                {byMethod.map((m, i) => (
                  <Badge key={i} variant="outline" className="text-xs">{m.label}: {fmt(m.amount)}</Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">مصروفات المعمل بالتفصيل</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>البند</TableHead><TableHead>المبلغ</TableHead><TableHead>%</TableHead></TableRow></TableHeader>
            <TableBody>
              {expCats.length === 0 && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">لا توجد مصروفات معمل معتمدة</TableCell></TableRow>}
              {expCats.map((c, i) => (
                <TableRow key={i}>
                  <TableCell>{c.label}</TableCell>
                  <TableCell className="tabular-nums text-red-700">{fmt(c.amount)}</TableCell>
                  <TableCell className="tabular-nums">{exp.total > 0 ? ((c.amount / exp.total) * 100).toFixed(0) : 0}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">جدول ربح/خسارة معمل التفريخ</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableBody>
              <TableRow><TableCell>إجمالي فواتير التفريخ</TableCell><TableCell className="tabular-nums">{fmt(d.invoicedTotal)}</TableCell></TableRow>
              <TableRow><TableCell>إجمالي المحصل نقديًا</TableCell><TableCell className="tabular-nums text-green-700">{fmt(col.total)}</TableCell></TableRow>
              <TableRow><TableCell>المسدد من رصيد سابق (لا يدخل النقدي)</TableCell><TableCell className="tabular-nums">{fmt(d.previousBalanceSettlements)}</TableCell></TableRow>
              <TableRow><TableCell>الخصومات</TableCell><TableCell className="tabular-nums text-amber-700">{fmt(d.discountsTotal)}</TableCell></TableRow>
              <TableRow><TableCell>متبقي على العملاء</TableCell><TableCell className="tabular-nums text-red-700">{fmt(d.outstandingOnCustomers)}</TableCell></TableRow>
              <TableRow><TableCell>مصروفات المعمل</TableCell><TableCell className="tabular-nums text-red-700">{fmt(exp.total)}</TableCell></TableRow>
              <TableRow className="font-bold border-t-2"><TableCell>صافي نقدي (محصل − مصروفات)</TableCell><TableCell className={`tabular-nums ${cashNet >= 0 ? "text-green-700" : "text-red-700"}`}>{fmt(cashNet)}</TableCell></TableRow>
              <TableRow className="font-bold"><TableCell>صافي تشغيلي (فواتير − خصومات − مصروفات)</TableCell><TableCell className={`tabular-nums ${opNet >= 0 ? "text-green-700" : "text-red-700"}`}>{fmt(opNet)}</TableCell></TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {causes.length > 0 && (
        <Card className="border-red-300 bg-red-50">
          <CardHeader><CardTitle className="text-base flex items-center gap-2 text-red-800">
            <AlertTriangle className="h-4 w-4" /> أسباب الخسارة المحتملة
          </CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {causes.map((c, i) => <li key={i} className="flex gap-2"><span className="text-red-700 font-bold">•</span><span>{c}</span></li>)}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
