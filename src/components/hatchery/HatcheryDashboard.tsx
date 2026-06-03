import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format, parseISO, differenceInDays, addDays, startOfWeek, startOfMonth, startOfYear } from "date-fns";
import { Egg, FlaskConical, Users, AlertTriangle, TrendingUp, Bird, Wallet, Printer, FileSpreadsheet, TestTube } from "lucide-react";
import { exportCSV } from "@/lib/csvExport";
import { useTestMode } from "@/hooks/useTestMode";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

const STAGE_EXIT = 42;
const HATCH_DAYS = 45;

const fmt = (n: number) => (n ?? 0).toLocaleString("ar-EG");
const isoDay = (d: Date) => format(d, "yyyy-MM-dd");

function inRange(dateStr: string | null, from: Date) {
  if (!dateStr) return false;
  return parseISO(dateStr) >= from;
}

export default function HatcheryDashboard() {
  const { data: customers = [] } = useQuery({
    queryKey: ["hatch_customers_dash"],
    queryFn: async () => (await supabase.from("hatch_customers").select("*")).data || [],
  });
  const { data: batches = [] } = useQuery({
    queryKey: ["hatch_batches_dash"],
    queryFn: async () =>
      (await supabase.from("hatch_batches").select("*").order("receive_date", { ascending: false }).limit(1000)).data || [],
  });
  const { data: treasury = [] } = useQuery({
    queryKey: ["hatch_treasury_dash"],
    queryFn: async () =>
      (await supabase.from("hatchery_treasury_txns").select("*").order("txn_date", { ascending: false }).limit(2000)).data || [],
  });

  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = startOfWeek(now, { weekStartsOn: 6 });
  const mStart = startOfMonth(now);
  const yStart = startOfYear(now);

  const custMap = useMemo(() => {
    const m = new Map<string, any>();
    customers.forEach((c: any) => m.set(c.id, c));
    return m;
  }, [customers]);

  const isOstrich = (cid: string | null) => {
    const c = cid ? custMap.get(cid) : null;
    return c?.customer_type === "ostrich" || (c?.name || "").includes("نعام");
  };

  const stats = useMemo(() => {
    let eggsToday = 0, eggsWeek = 0, eggsMonth = 0, eggsYear = 0;
    let ostrichEggs = 0, externalEggs = 0;
    let candleTotal = 0, fertile = 0, infertile = 0, dead = 0;
    let chicksMonthOstrich = 0, chicksYearOstrich = 0, chicksMonthExt = 0, chicksYearExt = 0;
    const activeCustomers = new Set<string>();

    const machineEggs: Record<string, number> = { M1: 0, M2: 0, M3: 0, HATCHER: 0 };
    const machineBatches: Record<string, any[]> = { M1: [], M2: [], M3: [], HATCHER: [] };
    let activeBatches = 0;

    for (const b of batches as any[]) {
      const eggs = b.received_eggs || 0;
      if (b.receive_date) {
        const d = parseISO(b.receive_date);
        if (d >= dayStart) eggsToday += eggs;
        if (d >= weekStart) eggsWeek += eggs;
        if (d >= mStart) eggsMonth += eggs;
        if (d >= yStart) eggsYear += eggs;
        if (d >= yStart) {
          if (isOstrich(b.customer_id)) ostrichEggs += eggs; else externalEggs += eggs;
        }
      }
      candleTotal += (b.candle1_fertile || 0) + (b.candle1_infertile || 0);
      fertile += b.candle1_fertile || 0;
      infertile += b.candle1_infertile || 0;
      dead += (b.candle2_dead || 0) + (b.hatcher_dead || 0);

      const chicks = b.hatched_chicks || 0;
      if (b.exit_date) {
        const ex = parseISO(b.exit_date);
        if (ex >= mStart) { if (isOstrich(b.customer_id)) chicksMonthOstrich += chicks; else chicksMonthExt += chicks; }
        if (ex >= yStart) { if (isOstrich(b.customer_id)) chicksYearOstrich += chicks; else chicksYearExt += chicks; }
      }

      if (b.status && b.status !== "completed") {
        activeBatches++;
        if (b.customer_id) activeCustomers.add(b.customer_id);
        const mach = b.machine || "M1";
        if (machineEggs[mach] !== undefined) {
          machineEggs[mach] += eggs;
          machineBatches[mach].push(b);
        }
      }
    }

    const fertilityRate = candleTotal > 0 ? (fertile / candleTotal) * 100 : 0;

    // Per-segment fertility (rough): split by customer type
    let ostrichCandle = 0, ostrichFertile = 0, extCandle = 0, extFertile = 0;
    for (const b of batches as any[]) {
      const ct = (b.candle1_fertile || 0) + (b.candle1_infertile || 0);
      if (isOstrich(b.customer_id)) { ostrichCandle += ct; ostrichFertile += b.candle1_fertile || 0; }
      else { extCandle += ct; extFertile += b.candle1_fertile || 0; }
    }

    return {
      eggsToday, eggsWeek, eggsMonth, eggsYear, ostrichEggs, externalEggs,
      fertile, infertile, dead, candleTotal, fertilityRate,
      ostrichFertilityRate: ostrichCandle > 0 ? (ostrichFertile / ostrichCandle) * 100 : 0,
      extFertilityRate: extCandle > 0 ? (extFertile / extCandle) * 100 : 0,
      chicksMonthOstrich, chicksYearOstrich, chicksMonthExt, chicksYearExt,
      chicksMonthTotal: chicksMonthOstrich + chicksMonthExt,
      chicksYearTotal: chicksYearOstrich + chicksYearExt,
      activeCustomers: activeCustomers.size,
      ostrichCustomers: customers.filter((c: any) => c.customer_type === "ostrich" || c.name?.includes("نعام")).length,
      externalCustomers: customers.filter((c: any) => c.customer_type !== "ostrich" && !c.name?.includes("نعام")).length,
      activeBatches, machineEggs, machineBatches,
    };
  }, [batches, customers, dayStart, weekStart, mStart, yStart]);

  // Batches near hatching (within 7 days)
  const nearHatch = useMemo(() => {
    return (batches as any[])
      .filter((b: any) => b.status && b.status !== "completed" && b.entry_date)
      .map((b: any) => {
        const expected = addDays(parseISO(b.entry_date), HATCH_DAYS);
        const remaining = differenceInDays(expected, now);
        const age = differenceInDays(now, parseISO(b.entry_date));
        return { ...b, expected, remaining, age };
      })
      .filter((b: any) => b.remaining >= 0 && b.remaining <= 14)
      .sort((a: any, b: any) => a.remaining - b.remaining);
  }, [batches, now]);

  // Treasury financials
  const fin = useMemo(() => {
    let inToday = 0, outToday = 0, inMonth = 0, outMonth = 0, inYear = 0, outYear = 0;
    let balance = 0;
    for (const t of treasury as any[]) {
      const d = parseISO(t.txn_date);
      const amt = Number(t.amount || 0);
      if (t.direction === "in") balance += amt; else balance -= amt;
      if (d >= dayStart) { if (t.direction === "in") inToday += amt; else outToday += amt; }
      if (d >= mStart) { if (t.direction === "in") inMonth += amt; else outMonth += amt; }
      if (d >= yStart) { if (t.direction === "in") inYear += amt; else outYear += amt; }
    }
    return {
      balance, inToday, outToday, inMonth, outMonth, inYear, outYear,
      netToday: inToday - outToday, netMonth: inMonth - outMonth, netYear: inYear - outYear,
    };
  }, [treasury, dayStart, mStart, yStart]);

  const exportDashboard = () => {
    exportCSV("hatchery-dashboard.csv", [
      { المؤشر: "بيض اليوم", القيمة: stats.eggsToday },
      { المؤشر: "بيض الأسبوع", القيمة: stats.eggsWeek },
      { المؤشر: "بيض الشهر", القيمة: stats.eggsMonth },
      { المؤشر: "بيض السنة", القيمة: stats.eggsYear },
      { المؤشر: "بيض نعام العاصمة (السنة)", القيمة: stats.ostrichEggs },
      { المؤشر: "بيض العملاء الخارجيين (السنة)", القيمة: stats.externalEggs },
      { المؤشر: "نسبة الإخصاب العامة", القيمة: stats.fertilityRate.toFixed(1) + "%" },
      { المؤشر: "كتاكيت الشهر", القيمة: stats.chicksMonthTotal },
      { المؤشر: "كتاكيت السنة", القيمة: stats.chicksYearTotal },
      { المؤشر: "رصيد الخزنة", القيمة: fin.balance },
      { المؤشر: "صافي ربح الشهر", القيمة: fin.netMonth },
    ]);
  };

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xl font-bold">لوحة إدارة معمل التفريخ</h2>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => window.print()}><Printer className="w-4 h-4 ml-1" />طباعة</Button>
          <Button size="sm" variant="outline" onClick={exportDashboard}><FileSpreadsheet className="w-4 h-4 ml-1" />تصدير</Button>
        </div>
      </div>

      {/* Customers + incoming eggs */}
      <section>
        <h3 className="font-semibold mb-2 flex items-center gap-2"><Users className="w-4 h-4" />العملاء والبيض الداخل</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi label="العملاء النشطون" value={stats.activeCustomers} />
          <Kpi label="عملاء نعام العاصمة" value={stats.ostrichCustomers} />
          <Kpi label="العملاء الخارجيون" value={stats.externalCustomers} />
          <Kpi label="بيض اليوم" value={stats.eggsToday} icon={<Egg className="w-4 h-4" />} />
          <Kpi label="بيض هذا الأسبوع" value={stats.eggsWeek} />
          <Kpi label="بيض هذا الشهر" value={stats.eggsMonth} />
          <Kpi label="بيض هذه السنة" value={stats.eggsYear} />
          <Kpi label="بيض نعام العاصمة (سنة)" value={stats.ostrichEggs} />
          <Kpi label="بيض العملاء الخارجيين (سنة)" value={stats.externalEggs} />
        </div>
      </section>

      {/* Batches + machines */}
      <section>
        <h3 className="font-semibold mb-2 flex items-center gap-2"><FlaskConical className="w-4 h-4" />الدفعات والماكينات</h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3">
          <Kpi label="الدفعات الحالية" value={stats.activeBatches} />
          <Kpi label="ماكينة 1" value={stats.machineEggs.M1} sub={`${stats.machineBatches.M1.length} دفعة / سعة 720`} />
          <Kpi label="ماكينة 2" value={stats.machineEggs.M2} sub={`${stats.machineBatches.M2.length} دفعة / سعة 720`} />
          <Kpi label="ماكينة 3" value={stats.machineEggs.M3} sub={`${stats.machineBatches.M3.length} دفعة / سعة 120`} />
          <Kpi label="الهاتشر" value={stats.machineEggs.HATCHER} sub={`${stats.machineBatches.HATCHER.length} دفعة / سعة 120`} />
        </div>
      </section>

      {/* Near hatching alert */}
      <section>
        <h3 className="font-semibold mb-2 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-orange-500" />
          الدفعات القريبة من الفقس
          {nearHatch.some((b: any) => b.remaining <= 7) && (
            <Badge variant="destructive">يوجد دفعات خلال 7 أيام</Badge>
          )}
        </h3>
        <Card className="p-3 overflow-x-auto">
          {nearHatch.length === 0 ? (
            <p className="text-sm text-muted-foreground p-3">لا توجد دفعات قريبة من الفقس خلال 14 يومًا.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>رقم الدفعة</TableHead>
                  <TableHead>العميل</TableHead>
                  <TableHead>عدد البيض</TableHead>
                  <TableHead>الماكينة</TableHead>
                  <TableHead>تاريخ الدخول</TableHead>
                  <TableHead>تاريخ الفقس المتوقع</TableHead>
                  <TableHead>الأيام المتبقية</TableHead>
                  <TableHead>المرحلة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {nearHatch.map((b: any) => (
                  <TableRow key={b.id} className={b.remaining <= 7 ? "bg-orange-50" : ""}>
                    <TableCell className="font-medium">{b.batch_number}</TableCell>
                    <TableCell>{custMap.get(b.customer_id)?.name || "—"}</TableCell>
                    <TableCell>{fmt(b.received_eggs)}</TableCell>
                    <TableCell>{b.machine}</TableCell>
                    <TableCell>{b.entry_date}</TableCell>
                    <TableCell>{format(b.expected, "yyyy-MM-dd")}</TableCell>
                    <TableCell><Badge variant={b.remaining <= 7 ? "destructive" : "secondary"}>{b.remaining} يوم</Badge></TableCell>
                    <TableCell>{b.status}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </section>

      {/* Fertility & hatching */}
      <section>
        <h3 className="font-semibold mb-2 flex items-center gap-2"><TrendingUp className="w-4 h-4" />الإخصاب والفقس</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi label="البيض المفحوص" value={stats.candleTotal} />
          <Kpi label="المخصب" value={stats.fertile} />
          <Kpi label="غير المخصب" value={stats.infertile} />
          <Kpi label="الفاسد / المستبعد" value={stats.dead} />
          <Kpi label="نسبة الإخصاب العامة" value={`${stats.fertilityRate.toFixed(1)}%`} />
          <Kpi label="إخصاب نعام العاصمة" value={`${stats.ostrichFertilityRate.toFixed(1)}%`} />
          <Kpi label="إخصاب العملاء الخارجيين" value={`${stats.extFertilityRate.toFixed(1)}%`} />
          <Kpi label="نسبة الفاقد" value={`${stats.candleTotal > 0 ? ((stats.dead / stats.candleTotal) * 100).toFixed(1) : 0}%`} />
        </div>
      </section>

      {/* Chicks */}
      <section>
        <h3 className="font-semibold mb-2 flex items-center gap-2"><Bird className="w-4 h-4" />الكتاكيت الناتجة</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Kpi label="كتاكيت نعام العاصمة (الشهر)" value={stats.chicksMonthOstrich} />
          <Kpi label="كتاكيت نعام العاصمة (السنة)" value={stats.chicksYearOstrich} />
          <Kpi label="كتاكيت العملاء الخارجيين (الشهر)" value={stats.chicksMonthExt} />
          <Kpi label="كتاكيت العملاء الخارجيين (السنة)" value={stats.chicksYearExt} />
          <Kpi label="إجمالي الكتاكيت (الشهر)" value={stats.chicksMonthTotal} />
          <Kpi label="إجمالي الكتاكيت (السنة)" value={stats.chicksYearTotal} />
        </div>
      </section>

      {/* Treasury / financial */}
      <section>
        <h3 className="font-semibold mb-2 flex items-center gap-2"><Wallet className="w-4 h-4" />الوضع المالي لخزنة المعمل</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi label="رصيد الخزنة" value={fin.balance.toLocaleString("ar-EG") + " ج.م"} highlight />
          <Kpi label="إيرادات اليوم" value={fin.inToday.toLocaleString("ar-EG")} />
          <Kpi label="مصروفات اليوم" value={fin.outToday.toLocaleString("ar-EG")} />
          <Kpi label="صافي اليوم" value={fin.netToday.toLocaleString("ar-EG")} positive={fin.netToday >= 0} />
          <Kpi label="إيرادات الشهر" value={fin.inMonth.toLocaleString("ar-EG")} />
          <Kpi label="مصروفات الشهر" value={fin.outMonth.toLocaleString("ar-EG")} />
          <Kpi label="صافي الشهر" value={fin.netMonth.toLocaleString("ar-EG")} positive={fin.netMonth >= 0} />
          <Kpi label="صافي السنة" value={fin.netYear.toLocaleString("ar-EG")} positive={fin.netYear >= 0} />
        </div>
      </section>
    </div>
  );
}

function Kpi({
  label, value, sub, highlight, positive, icon,
}: { label: string; value: number | string; sub?: string; highlight?: boolean; positive?: boolean; icon?: React.ReactNode }) {
  return (
    <Card className={`p-3 ${highlight ? "border-primary border-2" : ""}`}>
      <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">{icon}{label}</div>
      <div className={`text-lg font-bold ${positive === false ? "text-destructive" : positive === true ? "text-green-600" : ""}`}>
        {typeof value === "number" ? fmt(value) : value}
      </div>
      {sub && <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>}
    </Card>
  );
}
