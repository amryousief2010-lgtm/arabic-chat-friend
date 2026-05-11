import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Egg, Truck, FlaskConical, Bird, TrendingUp, AlertTriangle, Users, Activity } from "lucide-react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
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

const FarmHatcheryDashboard = () => {
  // Default to April 2026 (the report month)
  const [year, setYear] = useState(2026);
  const [month, setMonth] = useState(4); // April

  const { data: eggs = [] } = useQuery({ queryKey: ["all_eggs"], queryFn: () => fetchAll("farm_egg_production", "production_date") });
  const { data: transfers = [] } = useQuery({ queryKey: ["all_transfers"], queryFn: () => fetchAll("farm_transfers", "transfer_date") });
  const { data: families = [] } = useQuery({ queryKey: ["all_families"], queryFn: async () => (await supabase.from("farm_families").select("*")).data || [] });
  const { data: batches = [] } = useQuery({ queryKey: ["all_batches"], queryFn: () => fetchAll("hatch_batches", "receive_date") });
  const { data: customers = [] } = useQuery({ queryKey: ["all_customers"], queryFn: async () => (await supabase.from("hatch_customers").select("*")).data || [] });
  const { data: chicks = [] } = useQuery({ queryKey: ["all_chicks"], queryFn: () => fetchAll("chick_movements", "movement_date") });

  const totalFemale = useMemo(() => families.reduce((s: number, f: any) => s + (f.female_count || 0), 0), [families]);
  const internalIds = useMemo(() => new Set(customers.filter((c: any) => c.customer_type === "internal").map((c: any) => c.id)), [customers]);

  const inMonth = (d: string) => {
    if (!d) return false;
    const dt = new Date(d);
    return dt.getFullYear() === year && dt.getMonth() + 1 === month;
  };
  const inYTD = (d: string) => {
    if (!d) return false;
    const dt = new Date(d);
    return dt.getFullYear() === year && dt.getMonth() + 1 <= month;
  };

  const k = useMemo(() => {
    const monthEggs = eggs.filter((e: any) => inMonth(e.production_date)).reduce((s: number, e: any) => s + (e.egg_count || 0), 0);
    const ytdEggs = eggs.filter((e: any) => inYTD(e.production_date)).reduce((s: number, e: any) => s + (e.egg_count || 0), 0);
    const monthTransfers = transfers.filter((t: any) => inMonth(t.transfer_date)).reduce((s: number, t: any) => s + (t.quantity || 0), 0);
    const ytdTransfers = transfers.filter((t: any) => inYTD(t.transfer_date)).reduce((s: number, t: any) => s + (t.quantity || 0), 0);
    const monthDamaged = transfers.filter((t: any) => inMonth(t.transfer_date)).reduce((s: number, t: any) => s + (t.damaged || 0), 0);
    const ytdReceived = batches.filter((b: any) => inYTD(b.receive_date)).reduce((s: number, b: any) => s + (b.received_eggs || 0), 0);
    const monthReceived = batches.filter((b: any) => inMonth(b.receive_date)).reduce((s: number, b: any) => s + (b.received_eggs || 0), 0);
    const eggsPerFemaleMonth = totalFemale > 0 ? (monthEggs / totalFemale).toFixed(2) : "0";
    const ytdChicks = batches.filter((b: any) => inYTD(b.exit_date)).reduce((s: number, b: any) => s + (b.hatched_chicks || 0), 0);
    const monthChicks = batches.filter((b: any) => inMonth(b.exit_date)).reduce((s: number, b: any) => s + (b.hatched_chicks || 0), 0);
    const monthDiff = monthTransfers - monthReceived;
    const ytdDiff = ytdTransfers - ytdReceived;
    return {
      monthEggs, ytdEggs, monthTransfers, ytdTransfers, monthDamaged,
      ytdReceived, monthReceived, eggsPerFemaleMonth, ytdChicks, monthChicks,
      monthDiff, ytdDiff,
    };
  }, [eggs, transfers, batches, totalFemale, year, month]);

  // Monthly time series (Jan..month) for the year
  const monthlyEggs = useMemo(() => {
    const arr = Array.from({ length: 12 }, (_, i) => ({ name: MONTHS_AR[i], "إنتاج البيض": 0, "منقول للمعمل": 0, "وارد المعمل": 0 }));
    eggs.forEach((e: any) => {
      const dt = new Date(e.production_date);
      if (dt.getFullYear() === year) arr[dt.getMonth()]["إنتاج البيض"] += e.egg_count || 0;
    });
    transfers.forEach((t: any) => {
      const dt = new Date(t.transfer_date);
      if (dt.getFullYear() === year) arr[dt.getMonth()]["منقول للمعمل"] += t.quantity || 0;
    });
    batches.forEach((b: any) => {
      if (!b.receive_date) return;
      const dt = new Date(b.receive_date);
      if (dt.getFullYear() === year) arr[dt.getMonth()]["وارد المعمل"] += b.received_eggs || 0;
    });
    return arr.slice(0, month);
  }, [eggs, transfers, batches, year, month]);

  // Hatch funnel (YTD)
  const funnel = useMemo(() => {
    const inY = batches.filter((b: any) => inYTD(b.receive_date));
    const sum = (k: string) => inY.reduce((s: number, b: any) => s + (b[k] || 0), 0);
    return [
      { stage: "وارد", value: sum("received_eggs") },
      { stage: "صافي", value: sum("net_eggs") },
      { stage: "كشف 1 مخصب", value: sum("candle1_fertile") },
      { stage: "كشف 2 مخصب", value: sum("candle2_fertile") },
      { stage: "كتاكيت", value: sum("hatched_chicks") },
      { stage: "نافق هاتشر", value: sum("hatcher_dead") },
    ];
  }, [batches, year, month]);

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
    const internal = mk((b) => internalIds.has(b.customer_id) && inYTD(b.receive_date));
    const external = mk((b) => !internalIds.has(b.customer_id) && inYTD(b.receive_date));
    return [
      { name: "الخصوبة", "العاصمة": internal.fertility, "العملاء": external.fertility },
      { name: "تحول الكتكوت", "العاصمة": internal.conversion, "العملاء": external.conversion },
    ];
  }, [batches, internalIds, year, month]);

  const chickPie = useMemo(() => {
    const inY = chicks.filter((c: any) => inYTD(c.movement_date));
    return [
      { name: "وارد", value: inY.reduce((s: number, c: any) => s + (c.incoming || 0), 0) },
      { name: "مباع", value: inY.reduce((s: number, c: any) => s + (c.sold || 0), 0) },
      { name: "نافق", value: inY.reduce((s: number, c: any) => s + (c.dead || 0), 0) },
    ];
  }, [chicks, year, month]);

  const COLORS = ["hsl(var(--primary))", "hsl(var(--accent))", "hsl(var(--destructive))"];

  return (
    <DashboardLayout>
      <Header title="لوحة المزرعة والمعمل" subtitle={`ملخص ${MONTHS_AR[month - 1]} ${year} و YTD`} />
      <div className="p-4 space-y-4 max-w-7xl mx-auto">

        {/* Period selector */}
        <Card className="p-3 flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold">الفترة:</span>
          <Select value={String(year)} onValueChange={(v) => setYear(+v)}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>{[2024, 2025, 2026, 2027].map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={String(month)} onValueChange={(v) => setMonth(+v)}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>{MONTHS_AR.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>)}</SelectContent>
          </Select>
        </Card>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPI icon={Egg} label={`بيض ${MONTHS_AR[month - 1]}`} value={k.monthEggs.toLocaleString()} sub={`YTD: ${k.ytdEggs.toLocaleString()}`} color="from-orange-500 to-orange-700" />
          <KPI icon={Truck} label="منقول للمعمل (شهر)" value={k.monthTransfers.toLocaleString()} sub={`YTD: ${k.ytdTransfers.toLocaleString()}`} color="from-purple-500 to-purple-700" />
          <KPI icon={TrendingUp} label="بيضة/أنثى (شهر)" value={k.eggsPerFemaleMonth} sub={`إجمالي إناث: ${totalFemale}`} color="from-pink-500 to-pink-700" />
          <KPI icon={AlertTriangle} label="هالك النقل (شهر)" value={k.monthDamaged.toLocaleString()} color="from-red-500 to-red-700" />
          <KPI icon={FlaskConical} label="وارد المعمل (شهر)" value={k.monthReceived.toLocaleString()} sub={`YTD: ${k.ytdReceived.toLocaleString()}`} color="from-cyan-500 to-cyan-700" />
          <KPI icon={Activity} label="فرق نقل/وارد (شهر)" value={k.monthDiff.toLocaleString()} sub={`YTD: ${k.ytdDiff.toLocaleString()}`} color={k.monthDiff >= 0 ? "from-emerald-500 to-emerald-700" : "from-red-500 to-red-700"} />
          <KPI icon={Bird} label={`كتاكيت ${MONTHS_AR[month - 1]}`} value={k.monthChicks.toLocaleString()} sub={`YTD: ${k.ytdChicks.toLocaleString()}`} color="from-amber-500 to-amber-700" />
          <KPI icon={Users} label="أسر نشطة" value={families.filter((f: any) => f.status === "active").length} sub={`الإجمالي: ${families.length}`} color="from-indigo-500 to-indigo-700" />
        </div>

        {/* Monthly trend */}
        <Card className="p-4">
          <h3 className="font-bold mb-3">إنتاج شهري - {year} (حتى {MONTHS_AR[month - 1]})</h3>
          <div className="h-72">
            <ResponsiveContainer>
              <LineChart data={monthlyEggs}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="إنتاج البيض" stroke="hsl(var(--accent))" strokeWidth={2} />
                <Line type="monotone" dataKey="منقول للمعمل" stroke="hsl(var(--primary))" strokeWidth={2} />
                <Line type="monotone" dataKey="وارد المعمل" stroke="hsl(var(--destructive))" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <div className="grid md:grid-cols-2 gap-4">
          <Card className="p-4">
            <h3 className="font-bold mb-3">قمع الإنتاج YTD - مراحل التفريخ</h3>
            <div className="h-72">
              <ResponsiveContainer>
                <BarChart data={funnel} layout="vertical" margin={{ left: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis type="category" dataKey="stage" />
                  <Tooltip />
                  <Bar dataKey="value" fill="hsl(var(--primary))" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card className="p-4">
            <h3 className="font-bold mb-3">مقارنة جودة العاصمة × العملاء (YTD)</h3>
            <div className="h-72">
              <ResponsiveContainer>
                <BarChart data={fertilityCmp}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis unit="%" />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="العاصمة" fill="hsl(var(--primary))" />
                  <Bar dataKey="العملاء" fill="hsl(var(--accent))" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>

        <Card className="p-4">
          <h3 className="font-bold mb-3">حركة الكتاكيت YTD</h3>
          <div className="h-64">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={chickPie} dataKey="value" nameKey="name" outerRadius={90} label>
                  {chickPie.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip />
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
  <Card className="relative overflow-hidden border-0 shadow-md">
    <div className={`absolute inset-0 bg-gradient-to-br ${color} opacity-95`} />
    <div className="relative p-4 text-white">
      <div className="flex items-center gap-2 mb-2"><Icon className="w-4 h-4" /><span className="text-xs opacity-90">{label}</span></div>
      <p className="text-2xl font-bold">{value}</p>
      {sub && <p className="text-xs opacity-80 mt-1">{sub}</p>}
    </div>
  </Card>
);

export default FarmHatcheryDashboard;
