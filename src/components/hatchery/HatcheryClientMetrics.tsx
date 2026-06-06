import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Users, Crown, TrendingUp, Wallet, Calendar, AlertTriangle, Bird, Egg } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import reconciliation from "@/data/labCustomerReconciliation.json";

type ReconRow = {
  customer: string;
  type: string;
  receive_date: string | null;
  received_eggs: number;
  net_eggs: number;
  chicks: number;
  charge_total: number;
};

const recon = reconciliation as ReconRow[];
const isInternal = (t: string) => t === "داخلي" || /عاصمة|داخل/.test(t);
const fmt = (n: number) => Math.round(n || 0).toLocaleString("ar-EG");
const fmtEGP = (n: number) => `${fmt(n)} ج.م`;

const Stat = ({ label, value, sub, icon: Icon, color = "from-primary to-accent" }: any) => (
  <Card className="relative overflow-hidden border-0 shadow-md">
    <div className={`absolute inset-0 bg-gradient-to-br ${color}`} />
    <div className="relative p-4 text-white">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs opacity-90">{label}</span>
        {Icon && <Icon className="w-4 h-4 opacity-80" />}
      </div>
      <p className="text-2xl font-bold">{value}</p>
      {sub && <p className="text-[11px] opacity-80 mt-1 whitespace-pre-line">{sub}</p>}
    </div>
  </Card>
);

export default function HatcheryClientMetrics() {
  // Customers
  const { data: customers = [] } = useQuery<any[]>({
    queryKey: ["hc_metrics_customers"],
    queryFn: async () => {
      const { data } = await supabase
        .from("hatch_customers")
        .select("id,name,customer_type,is_active");
      return (data as any) || [];
    },
  });

  // Actual collected from approved lab treasury movements (income only)
  const { data: collected = 0 } = useQuery<number>({
    queryKey: ["hc_metrics_collected"],
    queryFn: async () => {
      const { data } = await supabase
        .from("lab_treasury_movements")
        .select("amount")
        .eq("movement_type" as any, "income")
        .eq("status" as any, "approved");
      return ((data as any[]) || []).reduce((s, r) => s + Number(r.amount || 0), 0);
    },
  });

  // Active customers since start of year (have a batch in current year)
  const { data: activeThisYearIds = [] } = useQuery<string[]>({
    queryKey: ["hc_metrics_active_year"],
    queryFn: async () => {
      const yearStart = `${new Date().getFullYear()}-01-01`;
      const { data } = await supabase
        .from("hatch_batches")
        .select("customer_id")
        .gte("receive_date", yearStart)
        .limit(2000);
      const ids = new Set<string>();
      (data as any[] || []).forEach((r) => r.customer_id && ids.add(r.customer_id));
      return [...ids];
    },
  });

  const customerCounts = useMemo(() => {
    const all = customers.length;
    const internal = customers.filter((c) => c.customer_type === "internal" || /عاصمة|داخل/.test(c.name || "")).length;
    const external = all - internal;
    return { all, internal, external, activeYear: activeThisYearIds.length };
  }, [customers, activeThisYearIds]);

  // Aggregate per customer from reconciliation JSON
  const perCustomer = useMemo(() => {
    const map = new Map<string, { customer: string; type: string; batches: number; eggs: number; chicks: number; charge: number }>();
    for (const r of recon) {
      const key = `${r.customer}__${r.type}`;
      if (!map.has(key)) map.set(key, { customer: r.customer, type: r.type, batches: 0, eggs: 0, chicks: 0, charge: 0 });
      const o = map.get(key)!;
      o.batches += 1;
      o.eggs += r.received_eggs;
      o.chicks += r.chicks;
      o.charge += r.charge_total;
    }
    return [...map.values()];
  }, []);

  const externalCustomers = perCustomer.filter((c) => !isInternal(c.type));
  const internalAgg = perCustomer.filter((c) => isInternal(c.type)).reduce(
    (a, c) => ({ batches: a.batches + c.batches, eggs: a.eggs + c.eggs, chicks: a.chicks + c.chicks, charge: a.charge + c.charge }),
    { batches: 0, eggs: 0, chicks: 0, charge: 0 }
  );
  const externalAgg = externalCustomers.reduce(
    (a, c) => ({ batches: a.batches + c.batches, eggs: a.eggs + c.eggs, chicks: a.chicks + c.chicks, charge: a.charge + c.charge }),
    { batches: 0, eggs: 0, chicks: 0, charge: 0 }
  );

  // Year-to-date external estimated revenue
  const currentYear = new Date().getFullYear();
  const yearStartMs = new Date(currentYear, 0, 1).getTime();
  const nowMs = Date.now();
  const monthsElapsed = Math.max(1, Math.min(12, Math.ceil((nowMs - yearStartMs) / (30 * 24 * 3600 * 1000))));

  const ytdExternalCharge = useMemo(() => {
    let total = 0;
    for (const r of recon) {
      if (isInternal(r.type)) continue;
      if (!r.receive_date) continue;
      const d = new Date(r.receive_date);
      if (d.getFullYear() === currentYear) total += r.charge_total;
    }
    return total;
  }, []);

  const projectedEoY = monthsElapsed > 0 ? Math.round((ytdExternalCharge / monthsElapsed) * 12) : 0;

  // Top customer by charge (external only)
  const top = [...externalCustomers].sort((a, b) => b.charge - a.charge);
  const bestClient = top[0];
  const bestHatchRate = bestClient && bestClient.eggs > 0 ? (bestClient.chicks / bestClient.eggs) * 100 : 0;
  const bestAvgBatch = bestClient && bestClient.batches > 0 ? bestClient.charge / bestClient.batches : 0;

  const top10 = top.slice(0, 10);
  const chartData = top10.map((c) => ({ name: c.customer.slice(0, 12), charge: c.charge, eggs: c.eggs, chicks: c.chicks }));

  return (
    <div className="space-y-4">
      <Alert className="border-orange-300 bg-orange-50 dark:bg-orange-950/20">
        <AlertTriangle className="w-4 h-4 text-orange-600" />
        <AlertDescription className="text-xs">
          الإيرادات التقديرية تاريخية مبنية على دفعات الشيت المستوردة — لا تُعدّ تحصيلًا فعليًا ولا تؤثر على خزنة المعمل. "تم تحصيله فعليًا" يحسب من حركات خزنة المعمل المعتمدة فقط.
        </AlertDescription>
      </Alert>

      <div>
        <h3 className="text-sm font-bold mb-2 text-muted-foreground">عملاء المعمل</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="إجمالي العملاء" value={fmt(customerCounts.all)} icon={Users} color="from-cyan-500 to-blue-600" />
          <Stat label="عملاء خارجيون" value={fmt(customerCounts.external)} icon={Users} color="from-indigo-500 to-purple-600" />
          <Stat label="نعام العاصمة (داخلي)" value={fmt(customerCounts.internal)} icon={Users} color="from-purple-600 to-fuchsia-600" />
          <Stat label={`نشطون منذ ${currentYear}`} value={fmt(customerCounts.activeYear)} icon={Calendar} color="from-emerald-500 to-teal-600" />
        </div>
      </div>

      <div>
        <h3 className="text-sm font-bold mb-2 text-muted-foreground">الإيرادات</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat
            label={`إيراد تقديري تاريخي ${currentYear}`}
            value={fmtEGP(ytdExternalCharge)}
            sub="خارجي فقط — ليس تحصيلًا"
            icon={TrendingUp}
            color="from-amber-500 to-orange-600"
          />
          <Stat
            label="تم تحصيله فعليًا من الخزنة"
            value={fmtEGP(collected)}
            sub="حركات معتمدة فقط"
            icon={Wallet}
            color="from-emerald-600 to-green-700"
          />
          <Stat
            label="واجب التحصيل (دفعات حالية)"
            value={fmtEGP(0)}
            sub="يبدأ عند فقس الدفعات الجديدة"
            icon={Wallet}
            color="from-slate-500 to-slate-700"
          />
          <Stat
            label={`متوقع نهاية ${currentYear}`}
            value={fmtEGP(projectedEoY)}
            sub={`بناءً على ${monthsElapsed} شهر منقضي\nتوقع وليس تحصيلًا`}
            icon={TrendingUp}
            color="from-violet-600 to-purple-700"
          />
        </div>
      </div>

      {bestClient && (
        <div>
          <h3 className="text-sm font-bold mb-2 text-muted-foreground flex items-center gap-2">
            <Crown className="w-4 h-4 text-amber-500" /> أفضل عميل للمعمل (مالي)
            <Badge variant="outline" className="text-[10px]">خارجي فقط — العاصمة مستبعدة</Badge>
          </h3>
          <Card className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-2xl font-bold">{bestClient.customer}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {fmt(bestClient.batches)} دفعة · {fmt(bestClient.eggs)} بيضة · {fmt(bestClient.chicks)} كتكوت
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">الحساب التقديري</div>
                  <div className="font-bold text-amber-600">{fmtEGP(bestClient.charge)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">متوسط الدفعة</div>
                  <div className="font-bold">{fmtEGP(bestAvgBatch)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">نسبة الفقس</div>
                  <div className="font-bold text-emerald-600">{bestHatchRate.toFixed(1)}%</div>
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}

      <div>
        <h3 className="text-sm font-bold mb-2 text-muted-foreground">نعام العاصمة (داخلي) × العملاء الخارجيون</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Card className="p-4 border-purple-300 bg-purple-50/40 dark:bg-purple-950/10">
            <div className="flex items-center gap-2 mb-2">
              <Egg className="w-4 h-4 text-purple-600" />
              <span className="font-semibold">نعام العاصمة (تكلفة داخلية تقديرية)</span>
            </div>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div><div className="text-xs text-muted-foreground">البيض</div><div className="font-bold">{fmt(internalAgg.eggs)}</div></div>
              <div><div className="text-xs text-muted-foreground">الكتاكيت</div><div className="font-bold">{fmt(internalAgg.chicks)}</div></div>
              <div><div className="text-xs text-muted-foreground">القيمة الداخلية</div><div className="font-bold text-purple-700">{fmtEGP(internalAgg.charge)}</div></div>
            </div>
            <div className="text-[11px] text-muted-foreground mt-2">لا تُحتسب مديونية ولا تحصيل.</div>
          </Card>
          <Card className="p-4 border-cyan-300 bg-cyan-50/40 dark:bg-cyan-950/10">
            <div className="flex items-center gap-2 mb-2">
              <Bird className="w-4 h-4 text-cyan-600" />
              <span className="font-semibold">العملاء الخارجيون (إيراد تقديري)</span>
            </div>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div><div className="text-xs text-muted-foreground">البيض</div><div className="font-bold">{fmt(externalAgg.eggs)}</div></div>
              <div><div className="text-xs text-muted-foreground">الكتاكيت</div><div className="font-bold">{fmt(externalAgg.chicks)}</div></div>
              <div><div className="text-xs text-muted-foreground">الإيراد التقديري</div><div className="font-bold text-cyan-700">{fmtEGP(externalAgg.charge)}</div></div>
            </div>
            <div className="text-[11px] text-muted-foreground mt-2">إيراد تاريخي تقديري — يبدأ التحصيل من الدفعات الجديدة.</div>
          </Card>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-bold mb-2 text-muted-foreground">Top 10 عملاء (حسب الإيراد التقديري)</h3>
        <Card className="p-4">
          {chartData.length > 0 && (
            <div className="h-64 mb-3" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="charge" fill="hsl(var(--primary))" name="الحساب" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="p-2 text-right">#</th>
                  <th className="p-2 text-right">العميل</th>
                  <th className="p-2">دفعات</th>
                  <th className="p-2">بيض</th>
                  <th className="p-2">كتاكيت</th>
                  <th className="p-2">نسبة الفقس</th>
                  <th className="p-2">الحساب التقديري</th>
                </tr>
              </thead>
              <tbody>
                {top10.map((c, i) => (
                  <tr key={i} className="border-t">
                    <td className="p-2">{i + 1}</td>
                    <td className="p-2 font-medium">{c.customer}</td>
                    <td className="p-2 text-center">{fmt(c.batches)}</td>
                    <td className="p-2 text-center">{fmt(c.eggs)}</td>
                    <td className="p-2 text-center">{fmt(c.chicks)}</td>
                    <td className="p-2 text-center">{c.eggs > 0 ? ((c.chicks / c.eggs) * 100).toFixed(1) + "%" : "—"}</td>
                    <td className="p-2 text-center font-bold text-amber-600">{fmtEGP(c.charge)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
