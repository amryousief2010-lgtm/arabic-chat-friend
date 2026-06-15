import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import * as XLSX from "xlsx";
import {
  UsersRound, Wallet, Printer, FileSpreadsheet, Loader2,
  Crown, AlertTriangle, TrendingUp, MapPinOff, Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { openPrintWindow, COMPANY_AR } from "@/lib/printPdf";
import { cairoMonthStartUTC, currentCairoYearMonth } from "@/lib/cairoDate";

const MONTHS_AR = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];

const fmt = (n: number) =>
  new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 0 }).format(n || 0);

interface SectorRow {
  sector: string;
  employees: number;
  totalSalary: number;
  avgSalary: number;
  pctEmployees: number;
  pctSalary: number;
  deductions: number;
  advances: number;
  netSalary: number;
  productivity?: string;
  notes: string[];
  recommendation: string;
  recommendationVariant: "danger" | "warn" | "ok" | "info";
}

const recBadge = (v: SectorRow["recommendationVariant"]) => {
  switch (v) {
    case "danger": return <Badge variant="destructive">يحتاج ترشيد</Badge>;
    case "warn": return <Badge className="bg-amber-500 hover:bg-amber-600">يحتاج مراجعة</Badge>;
    case "info": return <Badge className="bg-blue-500 hover:bg-blue-600">يحتاج دعم</Badge>;
    case "ok": return <Badge className="bg-green-600 hover:bg-green-700">مناسب حاليًا</Badge>;
  }
};

export default function HRWorkforceAnalysis() {
  const { isGeneralManager, isExecutiveManager, roles } = useAuth();
  const canView = isGeneralManager || isExecutiveManager ||
    roles.includes("hr_manager") || roles.includes("accountant") || roles.includes("financial_manager");
  const init = currentCairoYearMonth();
  const [year, setYear] = useState(init.year);
  const [month, setMonth] = useState(init.month);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<SectorRow[]>([]);
  const [unassignedNames, setUnassignedNames] = useState<string[]>([]);
  const [totals, setTotals] = useState({
    employees: 0, totalSalary: 0, avgSalary: 0,
    deductions: 0, advances: 0, netSalary: 0,
  });

  const load = async () => {
    if (!canView) return;
    setLoading(true);
    try {
      const monthStart = cairoMonthStartUTC(year, month);
      const monthEnd = cairoMonthStartUTC(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1);
      const dStart = `${year}-${String(month).padStart(2, "0")}-01`;
      const ny = month === 12 ? year + 1 : year;
      const nm = month === 12 ? 1 : month + 1;
      const dEnd = `${ny}-${String(nm).padStart(2, "0")}-01`;

      const [emps, locs, ded, slBatches, hatchBatches, broodSales, mfMfg, ordersM] =
        await Promise.all([
          supabase.from("hr_employees")
            .select("id,full_name,department,current_location_id,base_salary,status,start_date")
            .eq("status", "active"),
          supabase.from("hr_work_locations").select("id,name,department"),
          supabase.from("hr_deductions")
            .select("employee_id,deduction_type,amount,month,year,status")
            .eq("year", year).eq("month", month),
          supabase.from("slaughter_batches")
            .select("birds_slaughtered,total_meat_kg")
            .gte("slaughter_date", dStart).lt("slaughter_date", dEnd),
          supabase.from("hatch_batches")
            .select("id,received_eggs,hatched_chicks")
            .gte("receive_date", dStart).lt("receive_date", dEnd),
          supabase.from("brooding_chick_sales")
            .select("count,total_amount")
            .gte("sale_date", dStart).lt("sale_date", dEnd),
          supabase.from("mf_manufacturing")
            .select("produced_qty,status")
            .gte("invoice_date", dStart).lt("invoice_date", dEnd),
          supabase.from("orders")
            .select("id,total")
            .gte("created_at", monthStart).lt("created_at", monthEnd)
            .neq("status", "cancelled"),
        ]);

      if (emps.error) throw emps.error;

      const locById = new Map((locs.data ?? []).map((l: any) => [l.id, l]));
      // Group employees by sector (location name → fallback to department → "بدون مكان عمل")
      const bySector = new Map<string, { employees: any[]; totalSalary: number }>();
      const unassigned: string[] = [];
      for (const e of emps.data ?? []) {
        const loc = e.current_location_id ? locById.get(e.current_location_id) : null;
        const sector = (loc as any)?.name || e.department || "بدون مكان عمل";
        if (!loc && !e.department) unassigned.push(e.full_name);
        const cur = bySector.get(sector) || { employees: [], totalSalary: 0 };
        cur.employees.push(e);
        cur.totalSalary += Number(e.base_salary || 0);
        bySector.set(sector, cur);
      }

      // Deductions by employee_id (only approved/pending non-rejected)
      const dedByEmp = new Map<string, { deductions: number; advances: number }>();
      for (const d of ded.data ?? []) {
        if (d.status === "rejected") continue;
        const cur = dedByEmp.get(d.employee_id) || { deductions: 0, advances: 0 };
        const amt = Number(d.amount || 0);
        if (d.deduction_type === "advance" || d.deduction_type === "loan") cur.advances += amt;
        else cur.deductions += amt;
        dedByEmp.set(d.employee_id, cur);
      }

      const totalEmps = (emps.data ?? []).length;
      const totalSalary = [...bySector.values()].reduce((a, s) => a + s.totalSalary, 0);

      // Productivity metrics
      const birds = (slBatches.data ?? []).reduce((a: number, b: any) => a + Number(b.birds_slaughtered || 0), 0);
      const meatKg = (slBatches.data ?? []).reduce((a: number, b: any) => a + Number(b.total_meat_kg || 0), 0);
      const hatchCount = (hatchBatches.data ?? []).length;
      const chicksHatched = (hatchBatches.data ?? []).reduce((a: number, b: any) => a + Number(b.hatched_chicks || 0), 0);
      const chicksSold = (broodSales.data ?? []).reduce((a: number, b: any) => a + Number(b.count || 0), 0);
      const meatProducedQty = (mfMfg.data ?? []).filter((m: any) => m.status === "posted")
        .reduce((a: number, m: any) => a + Number(m.produced_qty || 0), 0);
      const ordersCount = (ordersM.data ?? []).length;
      const ordersValue = (ordersM.data ?? []).reduce((a: number, o: any) => a + Number(o.total || 0), 0);

      const out: SectorRow[] = [];
      let totalDed = 0, totalAdv = 0;
      for (const [sector, info] of bySector.entries()) {
        const empCount = info.employees.length;
        let sectorDed = 0, sectorAdv = 0;
        for (const e of info.employees) {
          const d = dedByEmp.get(e.id);
          if (d) { sectorDed += d.deductions; sectorAdv += d.advances; }
        }
        totalDed += sectorDed; totalAdv += sectorAdv;
        const pctE = totalEmps > 0 ? (empCount / totalEmps) * 100 : 0;
        const pctS = totalSalary > 0 ? (info.totalSalary / totalSalary) * 100 : 0;
        const notes: string[] = [];
        let variant: SectorRow["recommendationVariant"] = "ok";
        let recommendation = "مناسب حاليًا";

        if (sector === "بدون مكان عمل") {
          notes.push("يوجد موظفون بدون مكان عمل محدد، يجب تصحيح بياناتهم قبل اعتماد الرواتب.");
          variant = "warn"; recommendation = "يحتاج تصحيح بيانات";
        }
        if (pctE > 25) {
          notes.push("هذا القطاع يمثل نسبة كبيرة من عدد الموظفين ويحتاج مراجعة توزيع المهام.");
          variant = "danger"; recommendation = "يحتاج ترشيد";
        }
        if (pctS > 30) {
          notes.push("هذا القطاع يمثل نسبة عالية من تكلفة الرواتب ويحتاج مراجعة إنتاجية مقابل التكلفة.");
          if (variant !== "danger") { variant = "danger"; recommendation = "يحتاج مراجعة إنتاجية"; }
        }
        if (empCount === 1) {
          notes.push("قطاع محدود العمالة — راجع هل يحتاج دعم أو دمج مهام.");
          if (variant === "ok") { variant = "info"; recommendation = "يحتاج دعم عمالة"; }
        }

        // Productivity (sector-specific)
        let prod: string | undefined;
        const norm = sector.replace(/\s+/g, "");
        if (norm.includes("المجزر")) {
          prod = birds > 0
            ? `${fmt(birds)} نعامة مذبوحة • ${fmt(meatKg)} كجم لحوم • ${fmt(birds / Math.max(1, empCount))} نعامة/موظف`
            : "لا توجد دفعات دبح هذا الشهر";
        } else if (norm.includes("معملالتفريخ")) {
          prod = hatchCount > 0
            ? `${fmt(hatchCount)} دفعة • ${fmt(chicksHatched)} كتكوت ناتج`
            : "لا توجد دفعات تفريخ";
        } else if (norm.includes("حضانات") || norm.includes("التسمين")) {
          prod = chicksSold > 0 ? `${fmt(chicksSold)} كتكوت مباع` : "لا توجد مبيعات كتاكيت";
        } else if (norm.includes("مصنعاللحوم")) {
          prod = meatProducedQty > 0 ? `${fmt(meatProducedQty)} وحدة مصنعة` : "لا يوجد إنتاج معتمد";
        } else if (norm.includes("المبيعات") || norm.includes("التسويق") || norm.includes("شركةالشحن")) {
          prod = `${fmt(ordersCount)} طلب • ${fmt(ordersValue)} ج.م مبيعات`;
        }

        out.push({
          sector,
          employees: empCount,
          totalSalary: info.totalSalary,
          avgSalary: empCount > 0 ? info.totalSalary / empCount : 0,
          pctEmployees: pctE,
          pctSalary: pctS,
          deductions: sectorDed,
          advances: sectorAdv,
          netSalary: info.totalSalary - sectorDed - sectorAdv,
          productivity: prod,
          notes,
          recommendation,
          recommendationVariant: variant,
        });
      }
      out.sort((a, b) => b.employees - a.employees);
      setRows(out);
      setUnassignedNames(unassigned);
      setTotals({
        employees: totalEmps,
        totalSalary,
        avgSalary: totalEmps > 0 ? totalSalary / totalEmps : 0,
        deductions: totalDed,
        advances: totalAdv,
        netSalary: totalSalary - totalDed - totalAdv,
      });
    } catch (e: any) {
      toast.error("تعذّر التحميل: " + (e?.message ?? e));
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [year, month, canView]);

  const years = useMemo(() => {
    const arr: number[] = [];
    for (let y = new Date().getFullYear() + 1; y >= 2023; y--) arr.push(y);
    return arr;
  }, []);

  const highlights = useMemo(() => {
    if (!rows.length) return null;
    const byEmps = [...rows].sort((a, b) => b.employees - a.employees)[0];
    const bySalary = [...rows].sort((a, b) => b.totalSalary - a.totalSalary)[0];
    const byAvg = [...rows].sort((a, b) => b.avgSalary - a.avgSalary)[0];
    const needReview = rows.filter(r => r.recommendationVariant === "danger" || r.recommendationVariant === "warn");
    const single = rows.filter(r => r.employees === 1);
    return { byEmps, bySalary, byAvg, needReview, single };
  }, [rows]);

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.map(r => ({
      القطاع: r.sector,
      "عدد الموظفين": r.employees,
      "إجمالي الرواتب": Math.round(r.totalSalary),
      "متوسط الراتب": Math.round(r.avgSalary),
      "% من الموظفين": r.pctEmployees.toFixed(1) + "%",
      "% من الرواتب": r.pctSalary.toFixed(1) + "%",
      الخصومات: Math.round(r.deductions),
      السلف: Math.round(r.advances),
      "صافي الرواتب": Math.round(r.netSalary),
      الإنتاجية: r.productivity || "—",
      "توصية النظام": r.recommendation,
      "ملاحظات النظام": r.notes.join(" | ") || "—",
    }))), "تحليل القطاعات");
    if (unassignedNames.length) {
      XLSX.utils.book_append_sheet(wb,
        XLSX.utils.json_to_sheet(unassignedNames.map(n => ({ "الموظف بدون مكان عمل": n }))),
        "بدون مكان عمل");
    }
    XLSX.writeFile(wb, `تحليل-العمالة-${year}-${String(month).padStart(2, "0")}.xlsx`);
  };

  const printReport = () => {
    if (!highlights) return;
    const tr = rows.map(r => `<tr>
      <td>${r.sector}</td>
      <td class="num">${fmt(r.employees)}</td>
      <td class="num">${fmt(r.totalSalary)}</td>
      <td class="num">${fmt(r.avgSalary)}</td>
      <td class="num">${r.pctEmployees.toFixed(1)}%</td>
      <td class="num">${r.pctSalary.toFixed(1)}%</td>
      <td class="num">${fmt(r.netSalary)}</td>
      <td>${r.recommendation}</td>
    </tr>`).join("");
    const needRev = highlights.needReview.map(r => `<li>${r.sector} — ${r.recommendation}</li>`).join("") || "<li>لا يوجد</li>";
    const body = `
      <header><div><h1>${COMPANY_AR}</h1><div class="en">Workforce Distribution Analysis</div></div>
        <div class="meta">تحليل توزيع العمالة والترشيد<br>الشهر: ${MONTHS_AR[month - 1]} ${year}<br>التاريخ: ${new Date().toLocaleDateString("ar-EG")}</div>
      </header>
      <div class="stats">
        <div class="stat"><div class="k">إجمالي الموظفين</div><div class="v">${fmt(totals.employees)}</div></div>
        <div class="stat"><div class="k">إجمالي الرواتب</div><div class="v">${fmt(totals.totalSalary)}</div></div>
        <div class="stat"><div class="k">أكثر قطاع عددًا</div><div class="v">${highlights.byEmps.sector} (${highlights.byEmps.employees})</div></div>
        <div class="stat"><div class="k">أعلى قطاع رواتب</div><div class="v">${highlights.bySalary.sector}</div></div>
      </div>
      <h2>توزيع القطاعات</h2>
      <table><thead><tr>
        <th>القطاع</th><th>الموظفون</th><th>الرواتب</th><th>المتوسط</th>
        <th>% موظفين</th><th>% رواتب</th><th>صافي</th><th>التوصية</th>
      </tr></thead><tbody>${tr}</tbody></table>
      <h2>قطاعات يقترح النظام مراجعتها</h2>
      <ul>${needRev}</ul>
      ${unassignedNames.length ? `<h2>موظفون بدون مكان عمل</h2><ul>${unassignedNames.map(n => `<li>${n}</li>`).join("")}</ul>` : ""}
      <div class="sig"><div>الحسابات</div><div>المدير التنفيذي</div><div>المدير العام</div></div>
    `;
    const css = `.sig{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;margin-top:40px;font-size:11px}
                 .sig div{text-align:center;border-top:1px solid #888;padding-top:6px}
                 ul{padding-right:20px}`;
    openPrintWindow(`تحليل العمالة ${MONTHS_AR[month - 1]} ${year}`, body, css);
  };

  if (!canView) {
    return (
      <DashboardLayout>
        <Card><CardHeader><CardTitle>غير مصرح</CardTitle></CardHeader>
          <CardContent>هذه الصفحة متاحة للإدارة العليا والموارد البشرية والحسابات.</CardContent>
        </Card>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        className="space-y-5" dir="rtl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Users className="h-7 w-7 text-primary" /> تحليل توزيع العمالة والترشيد
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              تحليل استرشادي للإدارة — لا يحذف موظفين ولا يعدّل رواتب ولا يوقف أي حساب.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={String(month)} onValueChange={v => setMonth(Number(v))}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MONTHS_AR.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={String(year)} onValueChange={v => setYear(Number(v))}>
              <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                {years.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button onClick={printReport} variant="outline" disabled={!rows.length}>
              <Printer className="h-4 w-4 ml-1" /> طباعة / PDF
            </Button>
            <Button onClick={exportExcel} variant="outline" disabled={!rows.length}>
              <FileSpreadsheet className="h-4 w-4 ml-1" /> Excel
            </Button>
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin ml-2" /> جارٍ التحليل...
          </div>
        )}

        {!loading && highlights && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Kpi icon={<UsersRound className="h-5 w-5 text-primary" />} title="إجمالي الموظفين" value={fmt(totals.employees)} />
              <Kpi icon={<Wallet className="h-5 w-5 text-amber-600" />} title="إجمالي الرواتب" value={fmt(totals.totalSalary) + " ج"} />
              <Kpi icon={<Crown className="h-5 w-5 text-amber-500" />} title="أكثر قطاع عددًا" value={highlights.byEmps.sector} sub={`${highlights.byEmps.employees} موظف`} />
              <Kpi icon={<TrendingUp className="h-5 w-5 text-orange-600" />} title="أعلى قطاع رواتب" value={highlights.bySalary.sector} sub={fmt(highlights.bySalary.totalSalary) + " ج"} />
              <Kpi icon={<Wallet className="h-5 w-5 text-purple-600" />} title="أعلى متوسط راتب" value={highlights.byAvg.sector} sub={fmt(highlights.byAvg.avgSalary) + " ج"} />
              <Kpi icon={<AlertTriangle className="h-5 w-5 text-red-500" />} title="قطاعات تحتاج مراجعة" value={String(highlights.needReview.length)} />
              <Kpi icon={<Users className="h-5 w-5 text-blue-500" />} title="قطاعات بموظف واحد" value={String(highlights.single.length)} />
              <Kpi icon={<MapPinOff className="h-5 w-5 text-red-600" />} title="بدون مكان عمل" value={String(unassignedNames.length)} />
            </div>

            {(highlights.needReview.length > 0 || unassignedNames.length > 0) && (
              <Card>
                <CardHeader><CardTitle className="text-base">تنبيهات النظام</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {highlights.needReview.map((r, i) => (
                    <div key={i} className="text-sm rounded-md px-3 py-2 bg-amber-50 border border-amber-200 text-amber-900">
                      <strong>{r.sector}:</strong> {r.notes.join(" • ")}
                    </div>
                  ))}
                  {unassignedNames.length > 0 && (
                    <div className="text-sm rounded-md px-3 py-2 bg-red-50 border border-red-200 text-red-900">
                      <strong>موظفون بدون مكان عمل ({unassignedNames.length}):</strong> {unassignedNames.join("، ")}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>توزيع العمالة حسب القطاع</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    صافي = الرواتب − الخصومات − السلف
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>القطاع</TableHead>
                      <TableHead>الموظفون</TableHead>
                      <TableHead>إجمالي الرواتب</TableHead>
                      <TableHead>متوسط الراتب</TableHead>
                      <TableHead>% موظفين</TableHead>
                      <TableHead>% رواتب</TableHead>
                      <TableHead>الخصومات</TableHead>
                      <TableHead>السلف</TableHead>
                      <TableHead>الصافي</TableHead>
                      <TableHead>الإنتاجية</TableHead>
                      <TableHead>توصية النظام</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.sector}>
                        <TableCell className="font-medium">{r.sector}</TableCell>
                        <TableCell className="tabular-nums">{fmt(r.employees)}</TableCell>
                        <TableCell className="tabular-nums">{fmt(r.totalSalary)}</TableCell>
                        <TableCell className="tabular-nums">{fmt(r.avgSalary)}</TableCell>
                        <TableCell className="tabular-nums">{r.pctEmployees.toFixed(1)}%</TableCell>
                        <TableCell className="tabular-nums">{r.pctSalary.toFixed(1)}%</TableCell>
                        <TableCell className="tabular-nums text-red-700">{fmt(r.deductions)}</TableCell>
                        <TableCell className="tabular-nums text-orange-700">{fmt(r.advances)}</TableCell>
                        <TableCell className="tabular-nums font-semibold">{fmt(r.netSalary)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[200px]">
                          {r.productivity || <span className="text-muted-foreground/60">—</span>}
                        </TableCell>
                        <TableCell>{recBadge(r.recommendationVariant)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-muted/40 font-bold">
                      <TableCell>الإجمالي</TableCell>
                      <TableCell className="tabular-nums">{fmt(totals.employees)}</TableCell>
                      <TableCell className="tabular-nums">{fmt(totals.totalSalary)}</TableCell>
                      <TableCell className="tabular-nums">{fmt(totals.avgSalary)}</TableCell>
                      <TableCell>100%</TableCell>
                      <TableCell>100%</TableCell>
                      <TableCell className="tabular-nums text-red-700">{fmt(totals.deductions)}</TableCell>
                      <TableCell className="tabular-nums text-orange-700">{fmt(totals.advances)}</TableCell>
                      <TableCell className="tabular-nums">{fmt(totals.netSalary)}</TableCell>
                      <TableCell colSpan={2}></TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}
      </motion.div>
    </DashboardLayout>
  );
}

function Kpi({ icon, title, value, sub }: { icon: React.ReactNode; title: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center shrink-0">{icon}</div>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-muted-foreground">{title}</div>
            <div className="text-lg font-bold mt-0.5 truncate">{value}</div>
            {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
