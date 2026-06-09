import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table, TableHeader, TableRow, TableHead, TableBody, TableCell,
} from "@/components/ui/table";
import { ArrowDown, ArrowUp, Minus, FileDown, Printer, FileSpreadsheet, TrendingUp, AlertTriangle, Lightbulb, Target } from "lucide-react";
import {
  fetchDayOrders, computeKpis, topProducts, bottomProducts, byGovernorate, byField,
  buildRecommendations, buildMonthlyPlan, sameDayPrevMonth, sameWeekdayPrevWeek, cairoToday,
  delta, type DayKpis,
} from "@/lib/dailyPerformance";
import { exportCSV } from "@/lib/csvExport";
import { openPrintWindow, escapeHtml, fmtNum, COMPANY_AR } from "@/lib/printPdf";

const fmt = (n: number, d = 0) =>
  Number(n || 0).toLocaleString("ar-EG-u-nu-latn", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });

const weekdayName = (iso: string) =>
  ["الأحد","الإثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"][
    new Date(iso + "T12:00:00").getDay()
  ];

const TrendIcon = ({ trend }: { trend: "up" | "down" | "stable" }) =>
  trend === "up" ? <ArrowUp className="inline w-4 h-4 text-emerald-600" /> :
  trend === "down" ? <ArrowDown className="inline w-4 h-4 text-rose-600" /> :
  <Minus className="inline w-4 h-4 text-muted-foreground" />;

export default function DailyPerformanceAnalysis() {
  const [selected, setSelected] = useState<string>(cairoToday());
  const [monthsBack, setMonthsBack] = useState<1 | 3 | 6>(3);
  const [includeWeekday, setIncludeWeekday] = useState(true);

  const comparisonDates = useMemo(() => {
    const arr: { date: string; label: string; kind: "selected" | "month" | "weekday" }[] = [
      { date: selected, label: `اليوم المحدد ${selected}`, kind: "selected" },
    ];
    for (let i = 1; i <= monthsBack; i++) {
      arr.push({
        date: sameDayPrevMonth(selected, i),
        label: `نفس اليوم قبل ${i} شهر`,
        kind: "month",
      });
    }
    if (includeWeekday) {
      for (let w = 1; w <= 4; w++) {
        arr.push({
          date: sameWeekdayPrevWeek(selected, w),
          label: `${weekdayName(selected)} قبل ${w} أسبوع`,
          kind: "weekday",
        });
      }
    }
    return arr;
  }, [selected, monthsBack, includeWeekday]);

  const { data: dayData, isLoading } = useQuery({
    queryKey: ["daily-perf", selected, monthsBack, includeWeekday],
    queryFn: async () => {
      const results = await Promise.all(
        comparisonDates.map(async (d) => ({
          ...d,
          orders: await fetchDayOrders(d.date),
        })),
      );
      return results;
    },
    staleTime: 60_000,
  });

  const selectedDay = dayData?.[0];
  const monthComps = dayData?.filter((d) => d.kind === "month") || [];
  const weekdayComps = dayData?.filter((d) => d.kind === "weekday") || [];

  const todayKpis: DayKpis | null = selectedDay
    ? computeKpis(selectedDay.date, selectedDay.label, selectedDay.orders)
    : null;
  const monthKpisList = monthComps.map((d) => computeKpis(d.date, d.label, d.orders));
  const weekdayKpisList = weekdayComps.map((d) => computeKpis(d.date, d.label, d.orders));

  const avgPrev: DayKpis | null = monthKpisList.length
    ? {
        date: "—", label: "متوسط الأيام السابقة",
        sales: avgOf(monthKpisList, "sales"),
        orders: avgOf(monthKpisList, "orders"),
        avgOrderValue: avgOf(monthKpisList, "avgOrderValue"),
        customers: avgOf(monthKpisList, "customers"),
        newCustomers: avgOf(monthKpisList, "newCustomers"),
        repeatCustomers: avgOf(monthKpisList, "repeatCustomers"),
        totalQtyKg: avgOf(monthKpisList, "totalQtyKg"),
        cancelled: avgOf(monthKpisList, "cancelled"),
        pending: avgOf(monthKpisList, "pending"),
        collectedExpected: avgOf(monthKpisList, "collectedExpected"),
        collectedActual: avgOf(monthKpisList, "collectedActual"),
      }
    : null;

  const tProds = selectedDay ? topProducts(selectedDay.orders, 10) : [];
  const bProds = selectedDay ? bottomProducts(selectedDay.orders, 5) : [];
  const govs = selectedDay ? byGovernorate(selectedDay.orders) : [];
  const mods = selectedDay ? byField(selectedDay.orders, "moderator") : [];
  const shipping = selectedDay ? byField(selectedDay.orders, "shipping_company") : [];

  const recs =
    todayKpis && avgPrev
      ? buildRecommendations(todayKpis, avgPrev, tProds, govs, mods)
      : [];
  const plan =
    todayKpis && avgPrev
      ? buildMonthlyPlan(todayKpis, avgPrev, tProds, bProds, govs)
      : null;

  const handleExportCSV = () => {
    if (!dayData) return;
    exportCSV(`daily-performance-${selected}.csv`,
      dayData.map((d) => {
        const k = computeKpis(d.date, d.label, d.orders);
        return {
          "اليوم": d.date,
          "البيان": d.label,
          "المبيعات": k.sales,
          "الطلبات": k.orders,
          "متوسط الطلب": Math.round(k.avgOrderValue),
          "عملاء": k.customers,
          "عملاء جدد": k.newCustomers,
          "إلغاءات": k.cancelled,
          "معلق": k.pending,
          "كيلو": Math.round(k.totalQtyKg),
        };
      }),
    );
  };

  const handleExportPDF = () => {
    if (!todayKpis || !avgPrev || !plan) return;

    const dSales = delta(todayKpis.sales, avgPrev.sales);
    const dOrders = delta(todayKpis.orders, avgPrev.orders);
    const dAov = delta(todayKpis.avgOrderValue, avgPrev.avgOrderValue);
    const dCust = delta(todayKpis.customers, avgPrev.customers);
    const dKg = delta(todayKpis.totalQtyKg, avgPrev.totalQtyKg);

    const arrow = (pct: number, invert = false) => {
      const up = invert ? pct < 0 : pct > 0;
      const down = invert ? pct > 0 : pct < 0;
      if (Math.abs(pct) < 0.5) return `<span class="trend stable">— ${pct.toFixed(1)}%</span>`;
      if (up) return `<span class="trend up">▲ ${pct.toFixed(1)}%</span>`;
      if (down) return `<span class="trend down">▼ ${pct.toFixed(1)}%</span>`;
      return `<span class="trend stable">${pct.toFixed(1)}%</span>`;
    };

    const kpiRow = (label: string, today: string, prev: string, pct: number, invert = false) =>
      `<tr><td>${escapeHtml(label)}</td><td class="num">${today}</td><td class="num muted">${prev}</td><td class="num">${arrow(pct, invert)}</td></tr>`;

    const compRows = [todayKpis, ...monthKpisList, ...weekdayKpisList]
      .map((k, i) => `<tr class="${i === 0 ? "row-current" : ""}">
        <td>${escapeHtml(k.label)}</td>
        <td>${escapeHtml(k.date)}</td>
        <td>${escapeHtml(weekdayName(k.date))}</td>
        <td class="num">${fmtNum(k.sales)}</td>
        <td class="num">${fmtNum(k.orders)}</td>
        <td class="num">${fmtNum(Math.round(k.avgOrderValue))}</td>
        <td class="num">${fmtNum(k.customers)}</td>
        <td class="num">${fmtNum(k.cancelled)}</td>
        <td class="num">${fmtNum(k.totalQtyKg, 1)}</td>
      </tr>`).join("");

    const prodRows = tProds.map((p, i) => `<tr>
      <td class="num">${i + 1}</td>
      <td>${escapeHtml(p.name)}</td>
      <td class="num">${fmtNum(p.qty, 2)}</td>
      <td class="num">${fmtNum(Math.round(p.revenue))}</td>
    </tr>`).join("");

    const bottomRows = bProds.map((p, i) => `<tr>
      <td class="num">${i + 1}</td>
      <td>${escapeHtml(p.name)}</td>
      <td class="num">${fmtNum(p.qty, 2)}</td>
      <td class="num">${fmtNum(Math.round(p.revenue))}</td>
    </tr>`).join("");

    const govRows = govs.slice(0, 15).map((g, i) => `<tr>
      <td class="num">${i + 1}</td>
      <td>${escapeHtml(g.name)}</td>
      <td class="num">${fmtNum(g.sales)}</td>
      <td class="num">${fmtNum(g.orders)}</td>
      <td class="num">${fmtNum(Math.round(g.avg))}</td>
    </tr>`).join("");

    const recBadge = (t: string) =>
      t === "alert" ? `<span class="badge bad">تنبيه</span>` :
      t === "opportunity" ? `<span class="badge good">فرصة</span>` :
      `<span class="badge info">إجراء</span>`;

    const recCards = recs.length
      ? recs.map((r) => `
        <div class="rec rec-${escapeHtml(r.type)}">
          <div class="rec-head">${recBadge(r.type)}<b>${escapeHtml(r.title)}</b></div>
          <div class="rec-body">${escapeHtml(r.body)}</div>
        </div>`).join("")
      : `<div class="muted">لا توجد توصيات عاجلة لهذا اليوم.</div>`;

    const overallVerdict =
      dSales.pct > 5 ? "أداء أعلى من المتوسط — حافظ على الزخم" :
      dSales.pct < -5 ? "أداء أقل من المتوسط — تحرّك فوري مطلوب" :
      "أداء مستقر مقارنة بالمتوسط";

    const extraCss = `
      h2 { page-break-after: avoid; }
      .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 10px 0 14px; }
      .kpi-grid .stat { border: 1px solid #e2d6f5; border-radius: 8px; padding: 8px 10px;
                        background: linear-gradient(180deg,#faf6ff,#fff); }
      .kpi-grid .stat .k { font-size: 10px; color: #6b7280; }
      .kpi-grid .stat .v { font-size: 14px; font-weight: 700; color: #4c1d95; margin-top: 2px; }
      .kpi-grid .stat .t { font-size: 10px; margin-top: 3px; }
      .trend.up   { color: #047857; font-weight: 700; }
      .trend.down { color: #b91c1c; font-weight: 700; }
      .trend.stable { color: #6b7280; }
      .muted { color: #6b7280; }
      .row-current { background: #f5edff !important; font-weight: 700; }
      .row-current td { border-top: 2px solid #6b46c1; border-bottom: 2px solid #6b46c1; }
      .page-break { page-break-before: always; }
      .summary-box { border: 1px solid #d8b4fe; background: #faf5ff; border-radius: 8px;
                     padding: 10px 14px; margin: 8px 0 14px; }
      .summary-box h3 { margin: 0 0 6px; color: #6b21a8; font-size: 13px; }
      .summary-box ul { margin: 4px 18px 0; padding: 0; }
      .summary-box li { margin: 2px 0; font-size: 11px; }
      .rec-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      .rec { border: 1px solid #e5e7eb; border-right: 4px solid #6b46c1; border-radius: 6px;
             padding: 8px 10px; background: #fff; page-break-inside: avoid; }
      .rec-alert       { border-right-color: #b91c1c; background: #fef2f2; }
      .rec-opportunity { border-right-color: #047857; background: #ecfdf5; }
      .rec-action      { border-right-color: #1d4ed8; background: #eff6ff; }
      .rec-head { display: flex; gap: 6px; align-items: center; margin-bottom: 4px; font-size: 12px; }
      .rec-body { font-size: 11px; color: #374151; line-height: 1.5; }
      .badge { display: inline-block; padding: 1px 6px; border-radius: 999px; font-size: 9px;
               font-weight: 700; color: #fff; }
      .badge.bad  { background: #b91c1c; }
      .badge.good { background: #047857; }
      .badge.info { background: #1d4ed8; }
      .plan-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
      .plan-card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px;
                   background: #fff; page-break-inside: avoid; }
      .plan-card h4 { margin: 0 0 6px; font-size: 12px; color: #6b21a8;
                      border-bottom: 1px dashed #d8b4fe; padding-bottom: 3px; }
      .plan-card ul { margin: 4px 16px 0; padding: 0; font-size: 10.5px; }
      .plan-card li { margin: 2px 0; }
      .targets-row { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; margin-bottom: 10px; }
      .target { border: 1px solid #fcd34d; background: #fffbeb; border-radius: 6px;
                padding: 6px 8px; text-align: center; }
      .target .k { font-size: 9px; color: #92400e; }
      .target .v { font-size: 13px; font-weight: 700; color: #78350f; margin-top: 2px; }
    `;

    const body = `
      <header>
        <div>
          <h1>${COMPANY_AR}</h1>
          <div class="en">تحليل أداء المبيعات اليومي وخطة الشهر القادم</div>
        </div>
        <div class="meta">
          <div><b>اليوم:</b> ${escapeHtml(selected)} (${escapeHtml(weekdayName(selected))})</div>
          <div><b>تاريخ الإصدار:</b> ${new Date().toLocaleString("ar-EG-u-nu-latn")}</div>
          <div><b>قاعدة المقارنة:</b> متوسط ${monthKpisList.length} شهور سابقة</div>
        </div>
      </header>

      <h2>الملخّص التنفيذي</h2>
      <div class="summary-box">
        <h3>${escapeHtml(overallVerdict)}</h3>
        <ul>
          <li><b>المبيعات:</b> ${fmtNum(todayKpis.sales)} ج.م مقابل متوسط ${fmtNum(Math.round(avgPrev.sales))} ج.م — ${arrow(dSales.pct)}</li>
          <li><b>الطلبات:</b> ${fmtNum(todayKpis.orders)} طلب مقابل ${fmtNum(Math.round(avgPrev.orders))} — ${arrow(dOrders.pct)}</li>
          <li><b>متوسط الطلب:</b> ${fmtNum(Math.round(todayKpis.avgOrderValue))} ج.م — ${arrow(dAov.pct)}</li>
          <li><b>العملاء:</b> ${fmtNum(todayKpis.customers)} (${fmtNum(todayKpis.newCustomers)} جديد) — ${arrow(dCust.pct)}</li>
          <li><b>عدد التوصيات العاجلة:</b> ${fmtNum(recs.length)} — <b>تارجت شهري مقترح:</b> ${fmtNum(plan.monthlyTarget)} ج.م</li>
        </ul>
      </div>

      <h2>مؤشرات الأداء الرئيسية (KPIs)</h2>
      <div class="kpi-grid">
        <div class="stat"><div class="k">المبيعات</div><div class="v">${fmtNum(todayKpis.sales)} ج.م</div><div class="t">${arrow(dSales.pct)}</div></div>
        <div class="stat"><div class="k">الطلبات</div><div class="v">${fmtNum(todayKpis.orders)}</div><div class="t">${arrow(dOrders.pct)}</div></div>
        <div class="stat"><div class="k">متوسط الطلب</div><div class="v">${fmtNum(Math.round(todayKpis.avgOrderValue))} ج.م</div><div class="t">${arrow(dAov.pct)}</div></div>
        <div class="stat"><div class="k">العملاء</div><div class="v">${fmtNum(todayKpis.customers)}</div><div class="t">${arrow(dCust.pct)}</div></div>
        <div class="stat"><div class="k">عملاء جدد</div><div class="v">${fmtNum(todayKpis.newCustomers)}</div><div class="t">${arrow(delta(todayKpis.newCustomers, avgPrev.newCustomers).pct)}</div></div>
        <div class="stat"><div class="k">عملاء متكررون</div><div class="v">${fmtNum(todayKpis.repeatCustomers)}</div><div class="t">${arrow(delta(todayKpis.repeatCustomers, avgPrev.repeatCustomers).pct)}</div></div>
        <div class="stat"><div class="k">إجمالي الكيلو</div><div class="v">${fmtNum(todayKpis.totalQtyKg, 1)}</div><div class="t">${arrow(dKg.pct)}</div></div>
        <div class="stat"><div class="k">ملغاة / معلقة</div><div class="v">${fmtNum(todayKpis.cancelled)} / ${fmtNum(todayKpis.pending)}</div><div class="t">${arrow(delta(todayKpis.cancelled, avgPrev.cancelled).pct, true)}</div></div>
      </div>

      <h2>مقارنة اليوم بالمتوسط</h2>
      <table>
        <thead><tr><th>المؤشر</th><th>اليوم</th><th>المتوسط السابق</th><th>الفرق</th></tr></thead>
        <tbody>
          ${kpiRow("المبيعات (ج.م)", fmtNum(todayKpis.sales), fmtNum(Math.round(avgPrev.sales)), dSales.pct)}
          ${kpiRow("الطلبات", fmtNum(todayKpis.orders), fmtNum(Math.round(avgPrev.orders)), dOrders.pct)}
          ${kpiRow("متوسط قيمة الطلب", fmtNum(Math.round(todayKpis.avgOrderValue)), fmtNum(Math.round(avgPrev.avgOrderValue)), dAov.pct)}
          ${kpiRow("العملاء", fmtNum(todayKpis.customers), fmtNum(Math.round(avgPrev.customers)), dCust.pct)}
          ${kpiRow("عملاء جدد", fmtNum(todayKpis.newCustomers), fmtNum(Math.round(avgPrev.newCustomers)), delta(todayKpis.newCustomers, avgPrev.newCustomers).pct)}
          ${kpiRow("إجمالي الكيلو", fmtNum(todayKpis.totalQtyKg, 1), fmtNum(avgPrev.totalQtyKg, 1), dKg.pct)}
          ${kpiRow("الإلغاءات", fmtNum(todayKpis.cancelled), fmtNum(Math.round(avgPrev.cancelled)), delta(todayKpis.cancelled, avgPrev.cancelled).pct, true)}
        </tbody>
      </table>

      <h2>مقارنة الأيام التفصيلية</h2>
      <table>
        <thead><tr>
          <th>البيان</th><th>التاريخ</th><th>اليوم</th><th>المبيعات</th><th>الطلبات</th>
          <th>متوسط الطلب</th><th>عملاء</th><th>إلغاء</th><th>كيلو</th>
        </tr></thead>
        <tbody>${compRows}</tbody>
      </table>

      <div class="page-break"></div>
      <h2>أعلى المنتجات مبيعاً</h2>
      <table>
        <thead><tr><th>#</th><th>المنتج</th><th>الكمية</th><th>الإيراد (ج.م)</th></tr></thead>
        <tbody>${prodRows || `<tr><td colspan="4" class="muted">لا توجد بيانات</td></tr>`}</tbody>
      </table>

      <h2>أقل المنتجات مبيعاً</h2>
      <table>
        <thead><tr><th>#</th><th>المنتج</th><th>الكمية</th><th>الإيراد (ج.م)</th></tr></thead>
        <tbody>${bottomRows || `<tr><td colspan="4" class="muted">لا توجد بيانات</td></tr>`}</tbody>
      </table>

      <h2>توزيع المبيعات حسب المحافظات</h2>
      <table>
        <thead><tr><th>#</th><th>المحافظة</th><th>المبيعات</th><th>الطلبات</th><th>متوسط الطلب</th></tr></thead>
        <tbody>${govRows || `<tr><td colspan="5" class="muted">لا توجد بيانات</td></tr>`}</tbody>
      </table>

      <div class="page-break"></div>
      <h2>التوصيات العاجلة</h2>
      <div class="rec-grid">${recCards}</div>

      <div class="page-break"></div>
      <h2>خطة الشهر القادم</h2>
      <div class="targets-row">
        <div class="target"><div class="k">تارجت يومي</div><div class="v">${fmtNum(plan.dailyTarget)}</div></div>
        <div class="target"><div class="k">تارجت أسبوعي</div><div class="v">${fmtNum(plan.weeklyTarget)}</div></div>
        <div class="target"><div class="k">تارجت شهري</div><div class="v">${fmtNum(plan.monthlyTarget)}</div></div>
        <div class="target"><div class="k">عدد الطلبات</div><div class="v">${fmtNum(plan.targetOrders)}</div></div>
        <div class="target"><div class="k">متوسط الطلب</div><div class="v">${fmtNum(plan.targetAOV)}</div></div>
      </div>

      <div class="plan-grid">
        <div class="plan-card">
          <h4>منتجات للدفع</h4>
          <ul>${plan.pushProducts.map((p) => `<li>${escapeHtml(p)}</li>`).join("") || `<li class="muted">—</li>`}</ul>
        </div>
        <div class="plan-card">
          <h4>محافظات الأولوية</h4>
          <ul>${plan.topGovernorates.map((g) => `<li>${escapeHtml(g)}</li>`).join("") || `<li class="muted">—</li>`}</ul>
        </div>
        <div class="plan-card">
          <h4>خطة التسويق</h4>
          <ul>${plan.marketing.map((m) => `<li>${escapeHtml(m)}</li>`).join("") || `<li class="muted">—</li>`}</ul>
        </div>
        <div class="plan-card">
          <h4>إجراءات الموديراتور</h4>
          <ul>${plan.moderatorActions.map((m) => `<li>${escapeHtml(m)}</li>`).join("") || `<li class="muted">—</li>`}</ul>
        </div>
        <div class="plan-card">
          <h4>إجراءات التوصيل</h4>
          <ul>${plan.deliveryActions.map((d) => `<li>${escapeHtml(d)}</li>`).join("") || `<li class="muted">—</li>`}</ul>
        </div>
        <div class="plan-card">
          <h4>المخاطر المحتملة</h4>
          <ul>${plan.risks.length ? plan.risks.map((r) => `<li>${escapeHtml(r)}</li>`).join("") : `<li class="muted">لا توجد مخاطر مرصودة</li>`}</ul>
        </div>
      </div>
    `;

    openPrintWindow(`تحليل أداء المبيعات اليومي — ${selected}`, body, extraCss);
  };

  return (
    <DashboardLayout>
      <div className="container mx-auto p-4 space-y-4" dir="rtl">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-primary">
            تحليل أداء المبيعات اليومي وخطة الشهر القادم
          </h1>
          <p className="text-sm text-muted-foreground">
            تقرير تحليلي للقراءة فقط — يقارن اليوم بنفس اليوم من الشهور السابقة ويُصدر توصيات وخطة عمل.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleExportCSV}>
            <FileSpreadsheet className="ml-1 w-4 h-4" /> CSV
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportPDF}>
            <FileDown className="ml-1 w-4 h-4" /> PDF
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="ml-1 w-4 h-4" /> طباعة
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-4 flex flex-wrap items-end gap-4">
          <div className="space-y-1">
            <Label htmlFor="day">اليوم</Label>
            <Input
              id="day" type="date" value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="w-44"
            />
            <div className="text-xs text-muted-foreground">{weekdayName(selected)}</div>
          </div>
          <div className="space-y-1">
            <Label>مقارنة بـ</Label>
            <div className="flex gap-1">
              {[1, 3, 6].map((n) => (
                <Button
                  key={n}
                  size="sm"
                  variant={monthsBack === n ? "default" : "outline"}
                  onClick={() => setMonthsBack(n as 1 | 3 | 6)}
                >
                  {n} شهر
                </Button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="wd" checked={includeWeekday} onCheckedChange={setIncludeWeekday} />
            <Label htmlFor="wd">مقارنة بنفس يوم الأسبوع</Label>
          </div>
        </CardContent>
      </Card>

      {isLoading && (
        <Card><CardContent className="p-8 text-center text-muted-foreground">جارٍ التحميل...</CardContent></Card>
      )}

      {!isLoading && todayKpis && avgPrev && (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard title="إجمالي المبيعات" value={`${fmt(todayKpis.sales)} ج.م`} cmp={delta(todayKpis.sales, avgPrev.sales)} />
            <KpiCard title="عدد الطلبات" value={fmt(todayKpis.orders)} cmp={delta(todayKpis.orders, avgPrev.orders)} />
            <KpiCard title="متوسط الطلب" value={`${fmt(todayKpis.avgOrderValue)} ج.م`} cmp={delta(todayKpis.avgOrderValue, avgPrev.avgOrderValue)} />
            <KpiCard title="عدد العملاء" value={fmt(todayKpis.customers)} cmp={delta(todayKpis.customers, avgPrev.customers)} />
            <KpiCard title="عملاء جدد" value={fmt(todayKpis.newCustomers)} cmp={delta(todayKpis.newCustomers, avgPrev.newCustomers)} />
            <KpiCard title="عملاء متكررون" value={fmt(todayKpis.repeatCustomers)} cmp={delta(todayKpis.repeatCustomers, avgPrev.repeatCustomers)} />
            <KpiCard title="إجمالي الكيلو" value={fmt(todayKpis.totalQtyKg, 1)} cmp={delta(todayKpis.totalQtyKg, avgPrev.totalQtyKg)} />
            <KpiCard title="ملغاة / معلقة" value={`${fmt(todayKpis.cancelled)} / ${fmt(todayKpis.pending)}`} cmp={delta(todayKpis.cancelled, avgPrev.cancelled)} invert />
          </div>

          <Tabs defaultValue="compare">
            <TabsList className="flex-wrap">
              <TabsTrigger value="compare">المقارنات</TabsTrigger>
              <TabsTrigger value="products">المنتجات</TabsTrigger>
              <TabsTrigger value="governorates">المحافظات</TabsTrigger>
              <TabsTrigger value="moderators">الموديراتور</TabsTrigger>
              <TabsTrigger value="delivery">التوصيل</TabsTrigger>
              <TabsTrigger value="recs">التوصيات</TabsTrigger>
              <TabsTrigger value="plan">خطة الشهر</TabsTrigger>
            </TabsList>

            <TabsContent value="compare">
              <Card>
                <CardHeader><CardTitle>مقارنة الأيام</CardTitle></CardHeader>
                <CardContent className="overflow-auto">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>البيان</TableHead>
                      <TableHead>التاريخ</TableHead>
                      <TableHead>اليوم</TableHead>
                      <TableHead>المبيعات</TableHead>
                      <TableHead>الطلبات</TableHead>
                      <TableHead>متوسط الطلب</TableHead>
                      <TableHead>عملاء</TableHead>
                      <TableHead>إلغاء</TableHead>
                      <TableHead>كيلو</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {[todayKpis, ...monthKpisList, ...weekdayKpisList].map((k, i) => (
                        <TableRow key={k.date + i} className={i === 0 ? "bg-primary/5 font-semibold" : ""}>
                          <TableCell>{k.label}</TableCell>
                          <TableCell>{k.date}</TableCell>
                          <TableCell>{weekdayName(k.date)}</TableCell>
                          <TableCell>{fmt(k.sales)}</TableCell>
                          <TableCell>{fmt(k.orders)}</TableCell>
                          <TableCell>{fmt(k.avgOrderValue)}</TableCell>
                          <TableCell>{fmt(k.customers)}</TableCell>
                          <TableCell>{fmt(k.cancelled)}</TableCell>
                          <TableCell>{fmt(k.totalQtyKg, 1)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="products">
              <div className="grid md:grid-cols-2 gap-4">
                <SimpleTable
                  title="أعلى المنتجات مبيعاً"
                  headers={["المنتج", "الكمية", "الإيراد"]}
                  rows={tProds.map((p) => [p.name, fmt(p.qty, 2), fmt(p.revenue)])}
                />
                <SimpleTable
                  title="أقل المنتجات مبيعاً"
                  headers={["المنتج", "الكمية", "الإيراد"]}
                  rows={bProds.map((p) => [p.name, fmt(p.qty, 2), fmt(p.revenue)])}
                />
              </div>
            </TabsContent>

            <TabsContent value="governorates">
              <SimpleTable
                title="المحافظات"
                headers={["المحافظة", "المبيعات", "الطلبات", "متوسط الطلب"]}
                rows={govs.map((g) => [g.name, fmt(g.sales), fmt(g.orders), fmt(g.avg)])}
              />
            </TabsContent>

            <TabsContent value="moderators">
              <SimpleTable
                title="أداء الموديراتور"
                headers={["الموديراتور", "المبيعات", "الطلبات"]}
                rows={mods.map((m) => [m.name, fmt(m.sales), fmt(m.orders)])}
              />
            </TabsContent>

            <TabsContent value="delivery">
              <SimpleTable
                title="طرق التوصيل / شركات الشحن"
                headers={["الجهة", "المبيعات", "الطلبات"]}
                rows={shipping.map((s) => [s.name, fmt(s.sales), fmt(s.orders)])}
              />
            </TabsContent>

            <TabsContent value="recs">
              <div className="grid md:grid-cols-2 gap-3">
                {recs.length === 0 && (
                  <div className="text-muted-foreground text-sm p-4">لا توجد توصيات لهذا اليوم.</div>
                )}
                {recs.map((r, i) => (
                  <Card key={i} className={
                    r.type === "alert" ? "border-rose-300" :
                    r.type === "opportunity" ? "border-emerald-300" : "border-amber-300"
                  }>
                    <CardContent className="p-4 flex gap-3">
                      <div className="pt-1">
                        {r.type === "alert" ? <AlertTriangle className="w-5 h-5 text-rose-600" /> :
                         r.type === "opportunity" ? <TrendingUp className="w-5 h-5 text-emerald-600" /> :
                         <Lightbulb className="w-5 h-5 text-amber-600" />}
                      </div>
                      <div>
                        <div className="font-semibold">{r.title}</div>
                        <div className="text-sm text-muted-foreground mt-1">{r.body}</div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="plan">
              {plan && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Target className="w-5 h-5" /> خطة الشهر القادم
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                      <PlanStat label="تارجت يومي" value={`${fmt(plan.dailyTarget)} ج.م`} />
                      <PlanStat label="تارجت أسبوعي" value={`${fmt(plan.weeklyTarget)} ج.م`} />
                      <PlanStat label="تارجت شهري" value={`${fmt(plan.monthlyTarget)} ج.م`} />
                      <PlanStat label="عدد طلبات" value={fmt(plan.targetOrders)} />
                      <PlanStat label="متوسط طلب" value={`${fmt(plan.targetAOV)} ج.م`} />
                    </div>
                    <PlanList title="منتجات للدفع" items={plan.pushProducts} />
                    <PlanList title="منتجات لتقليل التركيز" items={plan.reduceProducts} />
                    <PlanList title="محافظات أولوية" items={plan.topGovernorates} />
                    <PlanList title="محافظات تحتاج حملة" items={plan.weakGovernorates} />
                    <PlanList title="توصيات تسويق" items={plan.marketing} />
                    <PlanList title="إجراءات الموديراتور" items={plan.moderatorActions} />
                    <PlanList title="إجراءات التوصيل" items={plan.deliveryActions} />
                    <PlanList title="مخاطر يجب متابعتها" items={plan.risks} />
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          </Tabs>
        </>
      )}

      {!isLoading && todayKpis && todayKpis.orders === 0 && (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">
            لا توجد طلبات في هذا اليوم.
          </CardContent>
        </Card>
      )}
    </div>
    </DashboardLayout>
  );
}

function avgOf<T>(arr: T[], key: keyof T): number {
  if (!arr.length) return 0;
  const sum = arr.reduce((s, x) => s + Number((x as any)[key] || 0), 0);
  return sum / arr.length;
}

function KpiCard({
  title, value, cmp, invert = false,
}: { title: string; value: string; cmp: ReturnType<typeof delta>; invert?: boolean }) {
  const effectiveTrend = invert
    ? cmp.trend === "up" ? "down" : cmp.trend === "down" ? "up" : "stable"
    : cmp.trend;
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-xs text-muted-foreground">{title}</div>
        <div className="text-xl font-bold mt-1">{value}</div>
        <div className="text-xs mt-1 flex items-center gap-1">
          <TrendIcon trend={effectiveTrend} />
          <span className={
            effectiveTrend === "up" ? "text-emerald-600" :
            effectiveTrend === "down" ? "text-rose-600" : "text-muted-foreground"
          }>
            {cmp.pct > 0 ? "+" : ""}{cmp.pct.toFixed(1)}% عن المتوسط
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function SimpleTable({ title, headers, rows }: { title: string; headers: string[]; rows: (string | number)[][] }) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent className="overflow-auto">
        {rows.length === 0 ? (
          <div className="text-muted-foreground text-sm">لا توجد بيانات.</div>
        ) : (
          <Table>
            <TableHeader><TableRow>
              {headers.map((h) => <TableHead key={h}>{h}</TableHead>)}
            </TableRow></TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={i}>
                  {r.map((c, j) => <TableCell key={j}>{c}</TableCell>)}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function PlanStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border rounded-lg p-3 bg-muted/30">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-bold mt-1">{value}</div>
    </div>
  );
}

function PlanList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <div className="font-semibold mb-2">{title}</div>
      <div className="flex flex-wrap gap-2">
        {items.map((it, i) => <Badge key={i} variant="secondary" className="text-sm py-1.5">{it}</Badge>)}
      </div>
    </div>
  );
}
