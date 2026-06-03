import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Egg, TrendingUp, TrendingDown, Truck, AlertTriangle, Trophy, Award,
  Calendar, Users, Printer, Download, Activity,
} from "lucide-react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from "recharts";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { format, startOfWeek, startOfMonth, startOfYear, subDays, subMonths, subYears } from "date-fns";

const fmt = (d: Date) => format(d, "yyyy-MM-dd");

type Period = "today" | "week" | "month" | "year" | "custom";

interface Props {
  families: any[];
  eggs: any[];
  transfers: any[];
}

const MotherFarmDashboard = ({ families, eggs, transfers }: Props) => {
  const [period, setPeriod] = useState<Period>("month");
  const [fromDate, setFromDate] = useState(fmt(startOfMonth(new Date())));
  const [toDate, setToDate] = useState(fmt(new Date()));
  const [penFilter, setPenFilter] = useState<string>("all");

  // Pull waste
  const { data: waste = [] } = useQuery({
    queryKey: ["farm_egg_waste_dashboard"],
    queryFn: async () => {
      const all: any[] = [];
      let from = 0;
      const size = 1000;
      while (true) {
        const { data, error } = await supabase.from("farm_egg_waste")
          .select("*").order("waste_date", { ascending: false }).range(from, from + size - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < size) break;
        from += size;
      }
      return all;
    },
    staleTime: 60_000,
  });

  // Compute period boundaries
  const periodRange = useMemo(() => {
    const now = new Date();
    if (period === "today") return { from: fmt(now), to: fmt(now) };
    if (period === "week") return { from: fmt(startOfWeek(now, { weekStartsOn: 6 })), to: fmt(now) };
    if (period === "month") return { from: fmt(startOfMonth(now)), to: fmt(now) };
    if (period === "year") return { from: fmt(startOfYear(now)), to: fmt(now) };
    return { from: fromDate, to: toDate };
  }, [period, fromDate, toDate]);

  // Helper: pen lookup from family_id
  const penByFamilyId = useMemo(() => {
    const m: Record<string, string> = {};
    families.forEach((f: any) => { m[f.id] = f.pen || "غير محدد"; });
    return m;
  }, [families]);

  const familiesByPen = useMemo(() => {
    const m: Record<string, any[]> = {};
    families.forEach((f: any) => {
      const p = f.pen || "غير محدد";
      if (!m[p]) m[p] = [];
      m[p].push(f);
    });
    return m;
  }, [families]);

  const allPens = useMemo(() => Object.keys(familiesByPen).sort(), [familiesByPen]);

  // Apply pen filter to family ids
  const filteredFamilyIds = useMemo(() => {
    if (penFilter === "all") return null;
    return new Set(familiesByPen[penFilter]?.map((f) => f.id) || []);
  }, [penFilter, familiesByPen]);

  const inRange = (date: string, from: string, to: string) =>
    date >= from && date <= to;

  // ============ KPIs ============
  const kpis = useMemo(() => {
    const todayStr = fmt(new Date());
    const weekStart = fmt(startOfWeek(new Date(), { weekStartsOn: 6 }));
    const monthStart = fmt(startOfMonth(new Date()));
    const yearStart = fmt(startOfYear(new Date()));

    const matchFam = (fid: string) => !filteredFamilyIds || filteredFamilyIds.has(fid);

    const sumEggs = (filterFn: (e: any) => boolean) =>
      eggs.filter((e) => matchFam(e.family_id) && filterFn(e)).reduce((s, e) => s + (e.egg_count || 0), 0);
    const sumTrans = (filterFn: (t: any) => boolean) =>
      transfers.filter((t) => matchFam(t.family_id) && filterFn(t)).reduce((s, t) => s + (t.quantity || 0), 0);
    const sumWaste = (filterFn: (w: any) => boolean) =>
      waste.filter((w) => matchFam(w.family_id) && filterFn(w)).reduce((s, w) => s + (w.egg_count || 0), 0);

    const today = sumEggs((e) => e.production_date === todayStr);
    const week = sumEggs((e) => e.production_date >= weekStart);
    const month = sumEggs((e) => e.production_date >= monthStart);
    const year = sumEggs((e) => e.production_date >= yearStart);
    const allTime = sumEggs(() => true);

    const transferredAll = sumTrans(() => true);
    const transferredMonth = sumTrans((t) => t.transfer_date >= monthStart);
    const wasteAll = sumWaste(() => true);
    const wasteMonth = sumWaste((w) => w.waste_date >= monthStart);

    // Average daily/weekly (based on last 30 days)
    const thirtyAgo = fmt(subDays(new Date(), 29));
    const last30Total = sumEggs((e) => e.production_date >= thirtyAgo);
    const avgDaily = Math.round(last30Total / 30);
    const avgWeekly = Math.round(last30Total / 4.3);

    const filteredFams = filteredFamilyIds
      ? families.filter((f: any) => filteredFamilyIds.has(f.id))
      : families;
    const activePens = new Set(filteredFams.filter((f: any) => f.status === "active").map((f: any) => f.pen || "غير محدد")).size;
    const activeFamilies = filteredFams.filter((f: any) => f.status === "active").length;

    const remaining = allTime - transferredAll - wasteAll;
    const wastePct = allTime > 0 ? ((wasteAll / allTime) * 100).toFixed(2) : "0";
    const transferPct = allTime > 0 ? ((transferredAll / allTime) * 100).toFixed(1) : "0";

    return {
      today, week, month, year, allTime, avgDaily, avgWeekly,
      activePens, activeFamilies, transferredAll, transferredMonth,
      wasteAll, wasteMonth, remaining, wastePct, transferPct,
    };
  }, [eggs, transfers, waste, families, filteredFamilyIds]);

  // ============ Pen analysis ============
  const penAnalysis = useMemo(() => {
    const todayStr = fmt(new Date());
    const weekStart = fmt(startOfWeek(new Date(), { weekStartsOn: 6 }));
    const monthStart = fmt(startOfMonth(new Date()));
    const yearStart = fmt(startOfYear(new Date()));

    return allPens.map((pen) => {
      const fams = familiesByPen[pen];
      const famIds = new Set(fams.map((f) => f.id));
      const female = fams.reduce((s, f) => s + (f.female_count || 0), 0);
      const male = fams.reduce((s, f) => s + (f.male_count || 0), 0);

      const eFiltered = eggs.filter((e) => famIds.has(e.family_id));
      const tFiltered = transfers.filter((t) => famIds.has(t.family_id));
      const wFiltered = waste.filter((w) => famIds.has(w.family_id));

      const tEggs = eFiltered.filter((e) => e.production_date === todayStr).reduce((s, e) => s + e.egg_count, 0);
      const wEggs = eFiltered.filter((e) => e.production_date >= weekStart).reduce((s, e) => s + e.egg_count, 0);
      const mEggs = eFiltered.filter((e) => e.production_date >= monthStart).reduce((s, e) => s + e.egg_count, 0);
      const yEggs = eFiltered.filter((e) => e.production_date >= yearStart).reduce((s, e) => s + e.egg_count, 0);
      const transferred = tFiltered.reduce((s, t) => s + (t.quantity || 0), 0);
      const wasted = wFiltered.reduce((s, w) => s + (w.egg_count || 0), 0);
      const lastDate = eFiltered.length ? eFiltered.reduce((m, e) => e.production_date > m ? e.production_date : m, "") : "-";
      const avgPerFemale = female > 0 ? +(mEggs / female).toFixed(2) : 0;

      return {
        pen, familiesCount: fams.length, female, male,
        today: tEggs, week: wEggs, month: mEggs, year: yEggs,
        transferred, wasted, lastDate, avgPerFemale,
      };
    });
  }, [allPens, familiesByPen, eggs, transfers, waste]);

  const penAnalysisRanked = useMemo(() => {
    const sorted = [...penAnalysis].sort((a, b) => a.month - b.month);
    const monthValues = penAnalysis.map((p) => p.month).filter((v) => v > 0);
    const avg = monthValues.length ? monthValues.reduce((s, v) => s + v, 0) / monthValues.length : 0;
    return sorted.map((p) => {
      let status: "جيد" | "متوسط" | "ضعيف" = "متوسط";
      if (avg > 0) {
        if (p.month >= avg * 1.1) status = "جيد";
        else if (p.month < avg * 0.7) status = "ضعيف";
      }
      return { ...p, status };
    });
  }, [penAnalysis]);

  const weakestPen = penAnalysisRanked.find((p) => p.month > 0) || penAnalysisRanked[0];
  const top5 = [...penAnalysis].sort((a, b) => b.month - a.month).slice(0, 5);
  const bottom5 = [...penAnalysisRanked].filter((p) => p.familiesCount > 0).slice(0, 5);

  // ============ Time-series ============
  const last30Days = useMemo(() => {
    const map: Record<string, number> = {};
    const start = fmt(subDays(new Date(), 29));
    eggs.forEach((e) => {
      if (e.production_date >= start) map[e.production_date] = (map[e.production_date] || 0) + (e.egg_count || 0);
    });
    return Array.from({ length: 30 }, (_, i) => {
      const d = fmt(subDays(new Date(), 29 - i));
      return { name: d.slice(5), "إنتاج": map[d] || 0 };
    });
  }, [eggs]);

  const monthly12 = useMemo(() => {
    const map: Record<string, { eggs: number; transfers: number; waste: number }> = {};
    for (let i = 11; i >= 0; i--) {
      const d = subMonths(new Date(), i);
      const key = format(d, "yyyy-MM");
      map[key] = { eggs: 0, transfers: 0, waste: 0 };
    }
    eggs.forEach((e) => {
      const k = (e.production_date || "").slice(0, 7);
      if (map[k]) map[k].eggs += e.egg_count || 0;
    });
    transfers.forEach((t) => {
      const k = (t.transfer_date || "").slice(0, 7);
      if (map[k]) map[k].transfers += t.quantity || 0;
    });
    waste.forEach((w) => {
      const k = (w.waste_date || "").slice(0, 7);
      if (map[k]) map[k].waste += w.egg_count || 0;
    });
    return Object.entries(map).map(([k, v]) => ({
      name: k.slice(2),
      "إنتاج": v.eggs, "نقل": v.transfers, "هالك": v.waste,
    }));
  }, [eggs, transfers, waste]);

  const monthVsPrev = useMemo(() => {
    const now = new Date();
    const thisM = format(now, "yyyy-MM");
    const lastM = format(subMonths(now, 1), "yyyy-MM");
    const sumFor = (k: string) => eggs.filter((e) => (e.production_date || "").startsWith(k)).reduce((s, e) => s + (e.egg_count || 0), 0);
    const a = sumFor(thisM), b = sumFor(lastM);
    const diff = b > 0 ? (((a - b) / b) * 100).toFixed(1) : "0";
    return { current: a, prev: b, diff };
  }, [eggs]);

  const yearVsPrev = useMemo(() => {
    const y = new Date().getFullYear();
    const sumFor = (yr: number) => eggs.filter((e) => (e.production_date || "").startsWith(String(yr))).reduce((s, e) => s + (e.egg_count || 0), 0);
    const a = sumFor(y), b = sumFor(y - 1);
    const diff = b > 0 ? (((a - b) / b) * 100).toFixed(1) : "0";
    return { current: a, prev: b, diff };
  }, [eggs]);

  // ============ Exports ============
  const exportPenAnalysis = () => {
    const rows = penAnalysisRanked.map((p) => ({
      "الملعب": p.pen, "عدد الأسر": p.familiesCount, "إناث": p.female, "ذكور": p.male,
      "إنتاج اليوم": p.today, "إنتاج الأسبوع": p.week, "إنتاج الشهر": p.month, "إنتاج السنة": p.year,
      "متوسط/أنثى (شهر)": p.avgPerFemale, "منقول للمعمل": p.transferred, "هالك": p.wasted,
      "آخر إنتاج": p.lastDate, "الحالة": p.status,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "تحليل الملاعب");
    XLSX.writeFile(wb, `تحليل_الملاعب_${fmt(new Date())}.xlsx`);
    toast.success("تم التصدير");
  };

  const exportFull = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{
      "إنتاج اليوم": kpis.today, "إنتاج الأسبوع": kpis.week, "إنتاج الشهر": kpis.month,
      "إنتاج السنة": kpis.year, "إجمالي تاريخي": kpis.allTime,
      "متوسط يومي": kpis.avgDaily, "متوسط أسبوعي": kpis.avgWeekly,
      "ملاعب نشطة": kpis.activePens, "أسر نشطة": kpis.activeFamilies,
      "منقول للمعمل": kpis.transferredAll, "متبقي": kpis.remaining,
      "هالك": kpis.wasteAll, "نسبة الهالك %": kpis.wastePct,
    }]), "المؤشرات");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(penAnalysisRanked.map((p) => ({
      "الملعب": p.pen, "أسر": p.familiesCount, "إناث": p.female, "ذكور": p.male,
      "اليوم": p.today, "الأسبوع": p.week, "الشهر": p.month, "السنة": p.year,
      "متوسط/أنثى": p.avgPerFemale, "منقول": p.transferred, "هالك": p.wasted,
      "الحالة": p.status,
    }))), "الملاعب");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(last30Days), "آخر 30 يوم");
    XLSX.writeFile(wb, `Dashboard_مزرعة_الأمهات_${fmt(new Date())}.xlsx`);
    toast.success("تم التصدير");
  };

  const printDashboard = () => window.print();

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card className="p-4 print:hidden">
        <div className="flex flex-wrap gap-2 items-end">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">الفترة</label>
            <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="today">اليوم</SelectItem>
                <SelectItem value="week">الأسبوع</SelectItem>
                <SelectItem value="month">الشهر</SelectItem>
                <SelectItem value="year">السنة</SelectItem>
                <SelectItem value="custom">مخصص</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {period === "custom" && (
            <>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">من</label>
                <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-40" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">إلى</label>
                <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-40" />
              </div>
            </>
          )}
          <div>
            <label className="text-xs text-muted-foreground block mb-1">الملعب</label>
            <Select value={penFilter} onValueChange={setPenFilter}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الملاعب</SelectItem>
                {allPens.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1" />
          <Button size="sm" variant="outline" onClick={printDashboard}><Printer className="w-4 h-4 ml-1" />طباعة</Button>
          <Button size="sm" variant="outline" onClick={exportFull}><Download className="w-4 h-4 ml-1" />تصدير Excel</Button>
        </div>
      </Card>

      {/* Main KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
        <KPI icon={Egg} label="إنتاج اليوم" value={kpis.today} color="from-orange-500 to-orange-700" />
        <KPI icon={Egg} label="إنتاج الأسبوع" value={kpis.week} color="from-amber-500 to-amber-700" />
        <KPI icon={Egg} label="إنتاج الشهر" value={kpis.month} color="from-yellow-500 to-yellow-700" />
        <KPI icon={Calendar} label="إنتاج السنة" value={kpis.year} color="from-lime-500 to-lime-700" />
        <KPI icon={Activity} label="إجمالي تاريخي" value={kpis.allTime} color="from-emerald-500 to-emerald-700" />
        <KPI icon={TrendingUp} label="متوسط يومي" value={kpis.avgDaily} color="from-teal-500 to-teal-700" />
        <KPI icon={TrendingUp} label="متوسط أسبوعي" value={kpis.avgWeekly} color="from-cyan-500 to-cyan-700" />
        <KPI icon={Users} label="ملاعب نشطة" value={kpis.activePens} sub={`أسر: ${kpis.activeFamilies}`} color="from-sky-500 to-sky-700" />
        <KPI icon={Truck} label="منقول للمعمل" value={kpis.transferredAll} sub={`الشهر: ${kpis.transferredMonth}`} color="from-blue-500 to-blue-700" />
        <KPI icon={Egg} label="متبقي بالمزرعة" value={kpis.remaining} color="from-indigo-500 to-indigo-700" />
        <KPI icon={AlertTriangle} label="إجمالي الهالك" value={kpis.wasteAll} sub={`الشهر: ${kpis.wasteMonth}`} color="from-rose-500 to-rose-700" />
        <KPI icon={TrendingDown} label="نسبة الهالك" value={`${kpis.wastePct}%`} color="from-red-500 to-red-700" />
        <KPI icon={Truck} label="نسبة النقل" value={`${kpis.transferPct}%`} color="from-purple-500 to-purple-700" />
        <KPI icon={TrendingUp} label="مقارنة الشهر" value={`${monthVsPrev.diff}%`} sub={`السابق: ${monthVsPrev.prev}`} color={Number(monthVsPrev.diff) >= 0 ? "from-emerald-500 to-emerald-700" : "from-red-500 to-red-700"} />
        <KPI icon={TrendingUp} label="مقارنة السنة" value={`${yearVsPrev.diff}%`} sub={`السابقة: ${yearVsPrev.prev}`} color={Number(yearVsPrev.diff) >= 0 ? "from-emerald-500 to-emerald-700" : "from-red-500 to-red-700"} />
      </div>

      {/* Weakest pen */}
      {weakestPen && weakestPen.familiesCount > 0 && (
        <Card className="p-4 border-r-4 border-r-destructive">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-5 h-5 text-destructive" />
            <h3 className="font-bold text-lg">أقل ملعب إنتاجًا هذا الشهر</h3>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 text-sm">
            <Stat label="رقم الملعب" value={weakestPen.pen} />
            <Stat label="عدد الإناث" value={weakestPen.female} />
            <Stat label="إنتاج اليوم" value={weakestPen.today} />
            <Stat label="إنتاج الأسبوع" value={weakestPen.week} />
            <Stat label="إنتاج الشهر" value={weakestPen.month} />
            <Stat label="متوسط/أنثى" value={weakestPen.avgPerFemale} />
            <Stat label="آخر إنتاج" value={weakestPen.lastDate} />
          </div>
          <p className="text-xs text-destructive mt-3">⚠ إنتاج هذا الملعب أقل من المتوسط - يحتاج مراجعة</p>
        </Card>
      )}

      {/* Top/Bottom 5 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Trophy className="w-5 h-5 text-amber-500" />
            <h3 className="font-bold">أفضل 5 ملاعب إنتاجًا (الشهر)</h3>
          </div>
          <Table>
            <TableHeader><TableRow><TableHead>الملعب</TableHead><TableHead>الشهر</TableHead><TableHead>الأسبوع</TableHead><TableHead>متوسط/أنثى</TableHead></TableRow></TableHeader>
            <TableBody>
              {top5.map((p) => (
                <TableRow key={p.pen}>
                  <TableCell className="font-bold">{p.pen}</TableCell>
                  <TableCell className="font-bold text-emerald-600">{p.month.toLocaleString()}</TableCell>
                  <TableCell>{p.week.toLocaleString()}</TableCell>
                  <TableCell>{p.avgPerFemale}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Award className="w-5 h-5 text-rose-500" />
            <h3 className="font-bold">أقل 5 ملاعب إنتاجًا (الشهر)</h3>
            <Button size="sm" variant="ghost" className="mr-auto" onClick={exportPenAnalysis}>
              <Download className="w-4 h-4" />
            </Button>
          </div>
          <Table>
            <TableHeader><TableRow><TableHead>الملعب</TableHead><TableHead>الشهر</TableHead><TableHead>الأسبوع</TableHead><TableHead>الحالة</TableHead></TableRow></TableHeader>
            <TableBody>
              {bottom5.map((p) => (
                <TableRow key={p.pen}>
                  <TableCell className="font-bold">{p.pen}</TableCell>
                  <TableCell className="font-bold text-rose-600">{p.month.toLocaleString()}</TableCell>
                  <TableCell>{p.week.toLocaleString()}</TableCell>
                  <TableCell>
                    <Badge variant={p.status === "ضعيف" ? "destructive" : p.status === "جيد" ? "default" : "secondary"}>
                      {p.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>

      {/* Charts */}
      <Card className="p-4">
        <h3 className="font-bold mb-3">إنتاج البيض - آخر 30 يوم</h3>
        <div className="h-64">
          <ResponsiveContainer>
            <LineChart data={last30Days}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" /><YAxis /><Tooltip />
              <Line type="monotone" dataKey="إنتاج" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="font-bold mb-3">إنتاج / نقل / هالك - آخر 12 شهر</h3>
        <div className="h-72">
          <ResponsiveContainer>
            <BarChart data={monthly12}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" /><YAxis /><Tooltip /><Legend />
              <Bar dataKey="إنتاج" fill="hsl(var(--primary))" />
              <Bar dataKey="نقل" fill="hsl(var(--accent))" />
              <Bar dataKey="هالك" fill="hsl(var(--destructive))" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Pen analysis table */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold">تحليل الملاعب الكامل</h3>
          <Button size="sm" variant="outline" onClick={exportPenAnalysis}>
            <Download className="w-4 h-4 ml-1" />تصدير Excel
          </Button>
        </div>
        <div className="overflow-auto max-h-[500px]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الملعب</TableHead>
                <TableHead>أسر</TableHead>
                <TableHead>إناث</TableHead>
                <TableHead>ذكور</TableHead>
                <TableHead>اليوم</TableHead>
                <TableHead>الأسبوع</TableHead>
                <TableHead>الشهر</TableHead>
                <TableHead>السنة</TableHead>
                <TableHead>متوسط/أنثى</TableHead>
                <TableHead>منقول</TableHead>
                <TableHead>هالك</TableHead>
                <TableHead>آخر إنتاج</TableHead>
                <TableHead>الحالة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {penAnalysisRanked.map((p) => (
                <TableRow key={p.pen}>
                  <TableCell className="font-bold">{p.pen}</TableCell>
                  <TableCell>{p.familiesCount}</TableCell>
                  <TableCell>{p.female}</TableCell>
                  <TableCell>{p.male}</TableCell>
                  <TableCell>{p.today.toLocaleString()}</TableCell>
                  <TableCell>{p.week.toLocaleString()}</TableCell>
                  <TableCell className="font-bold">{p.month.toLocaleString()}</TableCell>
                  <TableCell>{p.year.toLocaleString()}</TableCell>
                  <TableCell>{p.avgPerFemale}</TableCell>
                  <TableCell className="text-blue-600">{p.transferred.toLocaleString()}</TableCell>
                  <TableCell className="text-destructive">{p.wasted.toLocaleString()}</TableCell>
                  <TableCell className="text-xs">{p.lastDate}</TableCell>
                  <TableCell>
                    <Badge variant={p.status === "ضعيف" ? "destructive" : p.status === "جيد" ? "default" : "secondary"}>
                      {p.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
              {penAnalysisRanked.length === 0 && (
                <TableRow><TableCell colSpan={13} className="text-center text-muted-foreground py-6">لا توجد بيانات ملاعب</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
};

const KPI = ({ icon: Icon, label, value, sub, color }: any) => (
  <Card className="relative overflow-hidden border-0 shadow-md">
    <div className={`absolute inset-0 bg-gradient-to-br ${color} opacity-95`} />
    <div className="relative p-3 text-white">
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-4 h-4" />
        <span className="text-xs opacity-90">{label}</span>
      </div>
      <p className="text-xl font-bold">{typeof value === "number" ? value.toLocaleString() : value}</p>
      {sub && <p className="text-[10px] opacity-80 mt-1">{sub}</p>}
    </div>
  </Card>
);

const Stat = ({ label, value }: any) => (
  <div className="bg-muted/30 rounded-md p-2">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="font-bold mt-1">{typeof value === "number" ? value.toLocaleString() : value}</p>
  </div>
);

export default MotherFarmDashboard;
