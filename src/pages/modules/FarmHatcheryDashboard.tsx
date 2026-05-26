import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Egg, Truck, FlaskConical, Bird, TrendingUp, AlertTriangle, Users, Activity,
  CalendarRange, Sparkles,
} from "lucide-react";
import {
  BarChart, Bar, AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Legend, CartesianGrid, PieChart, Pie, Cell,
} from "recharts";

const MONTHS_AR = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];

const fetchAll = async (table: string, dateCol: string) => {
  let all: any[] = [];
  let from = 0;
  const size = 1000;
  while (true) {
    const { data, error } = await supabase.from(table as any).select("*").order(dateCol, { ascending: true }).range(from, from + size - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < size) break;
    from += size;
  }
  return all;
};

const fmtDate = (d: Date) => d.toISOString().slice(0, 10);
const startOfYear = (y: number) => new Date(Date.UTC(y, 0, 1));
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };

const FarmHatcheryDashboard = () => {
  // Default: from start of current report year to "today"
  const REPORT_YEAR = 2026;
  const today = new Date(Date.UTC(REPORT_YEAR, 3, 30)); // anchor near report month
  const [from, setFrom] = useState<string>(fmtDate(startOfYear(REPORT_YEAR)));
  const [to, setTo] = useState<string>(fmtDate(today));

  const { data: eggs = [] } = useQuery({ queryKey: ["all_eggs"], queryFn: () => fetchAll("farm_egg_production", "production_date") });
  const { data: transfers = [] } = useQuery({ queryKey: ["all_transfers"], queryFn: () => fetchAll("farm_transfers", "transfer_date") });
  const { data: families = [] } = useQuery({ queryKey: ["all_families"], queryFn: async () => (await supabase.from("farm_families").select("*")).data || [] });
  const { data: batches = [] } = useQuery({ queryKey: ["all_batches"], queryFn: () => fetchAll("hatch_batches", "receive_date") });
  const { data: customers = [] } = useQuery({ queryKey: ["all_customers"], queryFn: async () => (await supabase.from("hatch_customers").select("*")).data || [] });
  const { data: chicks = [] } = useQuery({ queryKey: ["all_chicks"], queryFn: () => fetchAll("chick_movements", "movement_date") });

  const totalFemale = useMemo(() => families.reduce((s: number, f: any) => s + (f.female_count || 0), 0), [families]);
  const internalIds = useMemo(() => new Set(customers.filter((c: any) => c.customer_type === "internal").map((c: any) => c.id)), [customers]);

  const inRange = (d: string) => {
    if (!d) return false;
    return d >= from && d <= to;
  };

  // Days in range for averages
  const daysInRange = useMemo(() => {
    const f = new Date(from); const t = new Date(to);
    return Math.max(1, Math.round((t.getTime() - f.getTime()) / 86400000) + 1);
  }, [from, to]);

  const k = useMemo(() => {
    const eggsIn = eggs.filter((e: any) => inRange(e.production_date));
    const transfersIn = transfers.filter((t: any) => inRange(t.transfer_date));
    const batchesRecvIn = batches.filter((b: any) => inRange(b.receive_date));
    const batchesExitIn = batches.filter((b: any) => inRange(b.exit_date));

    const totalEggs = eggsIn.reduce((s, e: any) => s + (e.egg_count || 0), 0);
    const totalTransfers = transfersIn.reduce((s, t: any) => s + (t.quantity || 0), 0);
    const totalDamaged = transfersIn.reduce((s, t: any) => s + (t.damaged || 0), 0);
    const totalReceived = batchesRecvIn.reduce((s, b: any) => s + (b.received_eggs || 0), 0);
    const totalChicks = batchesExitIn.reduce((s, b: any) => s + (b.hatched_chicks || 0), 0);
    const netEggs = batchesRecvIn.reduce((s, b: any) => s + (b.net_eggs || 0), 0);
    const fertEggs = batchesRecvIn.reduce((s, b: any) => s + (b.candle2_fertile || b.candle1_fertile || 0), 0);

    const transferRate = totalEggs > 0 ? (totalTransfers / totalEggs) * 100 : 0;
    const damageRate = totalTransfers > 0 ? (totalDamaged / totalTransfers) * 100 : 0;
    const fertilityRate = netEggs > 0 ? (fertEggs / netEggs) * 100 : 0;
    const hatchRate = netEggs > 0 ? (totalChicks / netEggs) * 100 : 0;
    const eggsPerFemale = totalFemale > 0 ? totalEggs / totalFemale : 0;
    const eggsPerDay = totalEggs / daysInRange;
    const diff = totalTransfers - totalReceived;

    return {
      totalEggs, totalTransfers, totalDamaged, totalReceived, totalChicks,
      transferRate, damageRate, fertilityRate, hatchRate,
      eggsPerFemale, eggsPerDay, diff,
    };
  }, [eggs, transfers, batches, totalFemale, from, to, daysInRange]);

  // Aggregate by month for the trend chart (within range)
  const trendData = useMemo(() => {
    const map = new Map<string, { name: string; "إنتاج البيض": number; "منقول للمعمل": number; "وارد المعمل": number }>();
    const key = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const label = (d: Date) => `${MONTHS_AR[d.getUTCMonth()].slice(0, 3)} ${String(d.getUTCFullYear()).slice(2)}`;
    // Seed months in range
    let cur = new Date(from); cur.setUTCDate(1);
    const end = new Date(to);
    while (cur <= end) {
      map.set(key(cur), { name: label(cur), "إنتاج البيض": 0, "منقول للمعمل": 0, "وارد المعمل": 0 });
      cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
    }
    eggs.forEach((e: any) => {
      if (!inRange(e.production_date)) return;
      const dt = new Date(e.production_date);
      const m = map.get(key(dt)); if (m) m["إنتاج البيض"] += e.egg_count || 0;
    });
    transfers.forEach((t: any) => {
      if (!inRange(t.transfer_date)) return;
      const dt = new Date(t.transfer_date);
      const m = map.get(key(dt)); if (m) m["منقول للمعمل"] += t.quantity || 0;
    });
    batches.forEach((b: any) => {
      if (!b.receive_date || !inRange(b.receive_date)) return;
      const dt = new Date(b.receive_date);
      const m = map.get(key(dt)); if (m) m["وارد المعمل"] += b.received_eggs || 0;
    });
    return Array.from(map.values());
  }, [eggs, transfers, batches, from, to]);

  const funnel = useMemo(() => {
    const inY = batches.filter((b: any) => inRange(b.receive_date));
    const sum = (key: string) => inY.reduce((s: number, b: any) => s + (b[key] || 0), 0);
    return [
      { stage: "وارد", value: sum("received_eggs") },
      { stage: "صافي", value: sum("net_eggs") },
      { stage: "كشف 1 مخصب", value: sum("candle1_fertile") },
      { stage: "كشف 2 مخصب", value: sum("candle2_fertile") },
      { stage: "كتاكيت", value: sum("hatched_chicks") },
      { stage: "نافق هاتشر", value: sum("hatcher_dead") },
    ];
  }, [batches, from, to]);

  const fertilityCmp = useMemo(() => {
    const mk = (filterFn: (b: any) => boolean) => {
      const arr = batches.filter(filterFn);
      const net = arr.reduce((s: number, b: any) => s + (b.net_eggs || 0), 0);
      const fert = arr.reduce((s: number, b: any) => s + (b.candle2_fertile || b.candle1_fertile || 0), 0);
      const ch = arr.reduce((s: number, b: any) => s + (b.hatched_chicks || 0), 0);
      return {
        fertility: net > 0 ? +((fert / net) * 100).toFixed(1) : 0,
        conversion: net > 0 ? +((ch / net) * 100).toFixed(1) : 0,
      };
    };
    const internal = mk((b) => internalIds.has(b.customer_id) && inRange(b.receive_date));
    const external = mk((b) => !internalIds.has(b.customer_id) && inRange(b.receive_date));
    return [
      { name: "الخصوبة", "العاصمة": internal.fertility, "العملاء": external.fertility },
      { name: "تحول الكتكوت", "العاصمة": internal.conversion, "العملاء": external.conversion },
    ];
  }, [batches, internalIds, from, to]);

  const chickPie = useMemo(() => {
    const inY = chicks.filter((c: any) => inRange(c.movement_date));
    return [
      { name: "وارد", value: inY.reduce((s: number, c: any) => s + (c.incoming || 0), 0) },
      { name: "مباع", value: inY.reduce((s: number, c: any) => s + (c.sold || 0), 0) },
      { name: "نافق", value: inY.reduce((s: number, c: any) => s + (c.dead || 0), 0) },
    ];
  }, [chicks, from, to]);

  const COLORS = ["hsl(var(--primary))", "hsl(var(--accent))", "hsl(var(--destructive))"];

  const setPreset = (preset: "ytd" | "30" | "90" | "12m" | "all" | "month") => {
    const t = new Date(to);
    if (preset === "ytd") setFrom(fmtDate(startOfYear(t.getUTCFullYear())));
    else if (preset === "month") setFrom(fmtDate(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1))));
    else if (preset === "30") setFrom(fmtDate(addDays(t, -29)));
    else if (preset === "90") setFrom(fmtDate(addDays(t, -89)));
    else if (preset === "12m") setFrom(fmtDate(addDays(t, -364)));
    else if (preset === "all") setFrom("2020-01-01");
  };

  const rangeLabel = `${from} → ${to} (${daysInRange} يوم)`;

  return (
    <DashboardLayout>
      <Header title="لوحة المزرعة والمعمل" subtitle={rangeLabel} />
      <div className="p-4 space-y-5 max-w-7xl mx-auto">

        {/* Hero / period selector */}
        <Card className="relative overflow-hidden border-0 shadow-xl">
          <div className="absolute inset-0 bg-gradient-to-br from-primary via-primary/90 to-accent opacity-95" />
          <div className="absolute -top-16 -left-16 w-64 h-64 rounded-full bg-white/10 blur-3xl" />
          <div className="absolute -bottom-16 -right-16 w-72 h-72 rounded-full bg-white/10 blur-3xl" />
          <div className="relative p-5 text-white space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center"><Sparkles className="w-5 h-5" /></div>
              <div>
                <h2 className="text-lg font-bold">نظرة عامة - المزرعة والمعمل</h2>
                <p className="text-xs opacity-85">حدد الفترة لمشاهدة المؤشرات والرسوم البيانية</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 bg-white/15 backdrop-blur rounded-xl px-3 py-2">
                <CalendarRange className="w-4 h-4" />
                <span className="text-xs opacity-80">من</span>
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                  className="h-8 w-36 bg-white/90 text-foreground border-0" />
                <span className="text-xs opacity-80">إلى</span>
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                  className="h-8 w-36 bg-white/90 text-foreground border-0" />
              </div>

              <div className="flex flex-wrap gap-1.5">
                {[
                  { k: "month", l: "الشهر" },
                  { k: "30", l: "30 يوم" },
                  { k: "90", l: "90 يوم" },
                  { k: "ytd", l: "منذ بداية العام" },
                  { k: "12m", l: "آخر 12 شهر" },
                  { k: "all", l: "الكل" },
                ].map((p) => (
                  <Button key={p.k} size="sm" variant="secondary"
                    className="h-8 bg-white/15 hover:bg-white/30 text-white border-0 backdrop-blur"
                    onClick={() => setPreset(p.k as any)}>{p.l}</Button>
                ))}
              </div>
            </div>
          </div>
        </Card>

        {/* Top KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPI icon={Egg} label="إجمالي البيض" value={k.totalEggs.toLocaleString()}
            sub={`متوسط ${Math.round(k.eggsPerDay).toLocaleString()} / يوم`} color="from-orange-500 to-amber-600" />
          <KPI icon={Truck} label="منقول للمعمل" value={k.totalTransfers.toLocaleString()}
            sub={`نسبة النقل ${k.transferRate.toFixed(1)}%`} color="from-purple-500 to-fuchsia-700" />
          <KPI icon={FlaskConical} label="وارد المعمل" value={k.totalReceived.toLocaleString()}
            sub={`فرق ${k.diff.toLocaleString()}`} color="from-cyan-500 to-blue-600" />
          <KPI icon={Bird} label="كتاكيت مفقسة" value={k.totalChicks.toLocaleString()}
            sub={`نسبة الفقس ${k.hatchRate.toFixed(1)}%`} color="from-emerald-500 to-teal-700" />
          <KPI icon={TrendingUp} label="بيضة / أنثى" value={k.eggsPerFemale.toFixed(2)}
            sub={`${totalFemale.toLocaleString()} أنثى`} color="from-pink-500 to-rose-700" />
          <KPI icon={AlertTriangle} label="هالك النقل" value={k.totalDamaged.toLocaleString()}
            sub={`نسبة ${k.damageRate.toFixed(1)}%`} color="from-red-500 to-red-700" />
          <KPI icon={Activity} label="الخصوبة" value={`${k.fertilityRate.toFixed(1)}%`}
            sub="بناءً على الكشف الثاني" color="from-indigo-500 to-violet-700" />
          <KPI icon={Users} label="أسر نشطة" value={families.filter((f: any) => f.status === "active").length}
            sub={`الإجمالي ${families.length}`} color="from-slate-600 to-slate-800" />
        </div>

        {/* Trend */}
        <Card className="p-5 border-border/60 shadow-md">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-base">منحنى الإنتاج خلال الفترة</h3>
              <p className="text-xs text-muted-foreground mt-1">{rangeLabel}</p>
            </div>
            <Badge variant="secondary" className="gap-1"><TrendingUp className="w-3 h-3" /> شهري</Badge>
          </div>
          <div className="h-80">
            <ResponsiveContainer>
              <AreaChart data={trendData}>
                <defs>
                  <linearGradient id="gEggs" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gTrans" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gRecv" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--destructive))" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="hsl(var(--destructive))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                <Legend />
                <Area type="monotone" dataKey="إنتاج البيض" stroke="hsl(var(--accent))" strokeWidth={2.5} fill="url(#gEggs)" />
                <Area type="monotone" dataKey="منقول للمعمل" stroke="hsl(var(--primary))" strokeWidth={2.5} fill="url(#gTrans)" />
                <Area type="monotone" dataKey="وارد المعمل" stroke="hsl(var(--destructive))" strokeWidth={2.5} fill="url(#gRecv)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <div className="grid md:grid-cols-2 gap-4">
          <Card className="p-5 border-border/60 shadow-md">
            <h3 className="font-bold mb-3">قمع الإنتاج - مراحل التفريخ</h3>
            <div className="h-72">
              <ResponsiveContainer>
                <BarChart data={funnel} layout="vertical" margin={{ left: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis type="number" tick={{ fontSize: 12 }} />
                  <YAxis type="category" dataKey="stage" tick={{ fontSize: 12 }} width={90} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                  <Bar dataKey="value" fill="hsl(var(--primary))" radius={[0, 8, 8, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card className="p-5 border-border/60 shadow-md">
            <h3 className="font-bold mb-3">مقارنة جودة العاصمة × العملاء</h3>
            <div className="h-72">
              <ResponsiveContainer>
                <BarChart data={fertilityCmp}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis unit="%" tick={{ fontSize: 12 }} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                  <Legend />
                  <Bar dataKey="العاصمة" fill="hsl(var(--primary))" radius={[8, 8, 0, 0]} />
                  <Bar dataKey="العملاء" fill="hsl(var(--accent))" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>

        <Card className="p-5 border-border/60 shadow-md">
          <h3 className="font-bold mb-3">حركة الكتاكيت خلال الفترة</h3>
          <div className="h-72">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={chickPie} dataKey="value" nameKey="name" outerRadius={100} innerRadius={50} paddingAngle={3} label>
                  {chickPie.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
};

const KPI = ({ icon: Icon, label, value, sub, color }: any) => (
  <Card className="relative overflow-hidden border-0 shadow-md hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300">
    <div className={`absolute inset-0 bg-gradient-to-br ${color}`} />
    <div className="absolute -top-6 -left-6 w-24 h-24 rounded-full bg-white/10 blur-2xl" />
    <div className="relative p-4 text-white">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs opacity-90 font-medium">{label}</span>
        <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center backdrop-blur">
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <p className="text-2xl font-bold tracking-tight">{value}</p>
      {sub && <p className="text-[11px] opacity-80 mt-1">{sub}</p>}
    </div>
  </Card>
);

export default FarmHatcheryDashboard;
