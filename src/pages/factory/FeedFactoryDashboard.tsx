import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Wheat, AlertTriangle, Package, CheckCircle, Clock, Banknote, Boxes, FileWarning, Warehouse, ShoppingCart, Undo2, TrendingUp, TrendingDown, Receipt, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import StatCard from "@/components/dashboard/StatCard";
import FactoryFilters, { defaultFilterState, FactoryFilterState } from "@/components/factory/FactoryFilters";
import { useFactoryData } from "@/hooks/useFactoryData";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

function FeedPeriodStats() {
  const qc = useQueryClient();
  const todayStr = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    const channel = supabase
      .channel("feed-dashboard-stats-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "feed_factory_treasury_txns" },
        () => qc.invalidateQueries({ queryKey: ["feed-period-stats"] }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "feed_sales_returns" },
        () => qc.invalidateQueries({ queryKey: ["feed-period-stats"] }),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);

  const { data, isLoading } = useQuery({
    queryKey: ["feed-period-stats", todayStr],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("feed_factory_dashboard_stats");
      if (error) throw error;

      const row = Array.isArray(data) ? data[0] : data;
      return {
        salesToday: Number(row?.sales_today || 0),
        salesMonth: Number(row?.sales_month || 0),
        salesYear: Number(row?.sales_year || 0),
        purchasesToday: Number(row?.purchases_today || 0),
        purchasesMonth: Number(row?.purchases_month || 0),
        purchasesYear: Number(row?.purchases_year || 0),
        returnsToday: Number(row?.returns_today || 0),
        returnsMonth: Number(row?.returns_month || 0),
        returnsYear: Number(row?.returns_year || 0),
        netSalesToday: Number(row?.net_sales_today || 0),
        netSalesMonth: Number(row?.net_sales_month || 0),
        netSalesYear: Number(row?.net_sales_year || 0),
      };
    },
    refetchInterval: 15_000,
  });

  const fmt = (n: number) => `${n.toLocaleString("en-US", { maximumFractionDigits: 0 })} ج.م`;
  const d = data || { salesToday: 0, salesMonth: 0, salesYear: 0, purchasesToday: 0, purchasesMonth: 0, purchasesYear: 0, returnsToday: 0, returnsMonth: 0, returnsYear: 0, netSalesToday: 0, netSalesMonth: 0, netSalesYear: 0 };

  const palette: Record<string, { border: string; title: string; bg: string; val: string }> = {
    emerald: { border: "border-emerald-300", title: "text-emerald-700", bg: "bg-emerald-50/60", val: "text-emerald-700" },
    orange: { border: "border-orange-300", title: "text-orange-700", bg: "bg-orange-50/60", val: "text-orange-700" },
    purple: { border: "border-purple-300", title: "text-purple-700", bg: "bg-purple-50/60", val: "text-purple-700" },
    blue: { border: "border-blue-300", title: "text-blue-700", bg: "bg-blue-50/60", val: "text-blue-700" },
  };
  const Block = ({ title, icon: Icon, color, items }: any) => {
    const p = palette[color];
    return (
      <Card className={p.border}>
        <CardHeader className="pb-2"><CardTitle className={`text-base flex items-center gap-2 ${p.title}`}><Icon className="h-5 w-5" />{title}</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-3 gap-2 text-center">
          {items.map((it: any) => (
            <div key={it.label} className={`rounded-md p-2 ${p.bg}`}>
              <div className="text-[11px] text-muted-foreground flex items-center justify-center gap-1"><Calendar className="h-3 w-3" />{it.label}</div>
              <div className={`font-bold ${p.val} text-sm md:text-base mt-1`}>{isLoading ? "..." : fmt(it.value)}</div>
            </div>
          ))}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3">
      <Block title="المبيعات (إجمالي)" icon={TrendingUp} color="emerald"
        items={[{ label: "اليوم", value: d.salesToday }, { label: "الشهر", value: d.salesMonth }, { label: "السنة", value: d.salesYear }]} />
      <Block title="مرتجعات المبيعات" icon={Undo2} color="orange"
        items={[{ label: "اليوم", value: d.returnsToday }, { label: "الشهر", value: d.returnsMonth }, { label: "السنة", value: d.returnsYear }]} />
      <Block title="صافي المبيعات (بعد المرتجعات)" icon={Receipt} color="purple"
        items={[{ label: "اليوم", value: d.netSalesToday }, { label: "الشهر", value: d.netSalesMonth }, { label: "السنة", value: d.netSalesYear }]} />
      <Block title="المشتريات (خامات)" icon={TrendingDown} color="blue"
        items={[{ label: "اليوم", value: d.purchasesToday }, { label: "الشهر", value: d.purchasesMonth }, { label: "السنة", value: d.purchasesYear }]} />
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  draft: "#94a3b8", planned: "#06b6d4", under_review: "#f59e0b", approved: "#10b981", closed: "#6366f1", cancelled: "#ef4444",
};
const PURPLE = "#7c3aed"; const ORANGE = "#ea580c";

export default function FeedFactoryDashboard() {
  const [f, setF] = useState<FactoryFilterState>(defaultFilterState());
  const { feed, feedCons, movs, items, isLoading } = useFactoryData(f.from, f.to);

  const stats = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const closed = feed.filter((b: any) => b.status === "closed");
    const todayProd = closed.filter((b: any) => (b.production_date || b.created_at?.slice(0, 10)) === today).reduce((s: number, b: any) => s + Number(b.actual_quantity || 0), 0);
    const monthProd = closed.reduce((s: number, b: any) => s + Number(b.actual_quantity || 0), 0);
    const totalCost = closed.reduce((s: number, b: any) => s + Number(b.total_cost || 0), 0);
    const avgCost = monthProd > 0 ? totalCost / monthProd : 0;
    const byStatus: Record<string, number> = {};
    for (const b of feed) byStatus[b.status] = (byStatus[b.status] || 0) + 1;
    const rawCons = feedCons.reduce((s: number, c: any) => s + Number(c.actual_qty ?? c.quantity ?? 0), 0);
    const finishedRcv = movs.filter((m: any) => m.reference_type === "feed_batch" && m.movement_type === "production_in").reduce((s: number, m: any) => s + Number(m.quantity || 0), 0);
    const zeroCost = items.filter((i: any) => Number(i.unit_cost) === 0 && Number(i.stock) > 0 && i.module === "feed").length;
    const pendingReview = byStatus.under_review || 0;
    return { todayProd, monthProd, totalCost, avgCost, byStatus, rawCons, finishedRcv, zeroCost, pendingReview };
  }, [feed, feedCons, movs, items]);

  const prodByType = useMemo(() => {
    const m: Record<string, { name: string; qty: number; cost: number }> = {};
    for (const b of feed.filter((x: any) => x.status === "closed")) {
      const k = b.feed_product_id?.slice(0, 8) || "—";
      if (!m[k]) m[k] = { name: k, qty: 0, cost: 0 };
      m[k].qty += Number(b.actual_quantity || 0);
      m[k].cost += Number(b.total_cost || 0);
    }
    return Object.values(m).sort((a, b) => b.qty - a.qty).slice(0, 8);
  }, [feed]);

  const costPerKg = useMemo(() => feed.filter((b: any) => b.status === "closed" && b.cost_per_kg).map((b: any) => ({ name: b.batch_number?.slice(-8), cpk: Number(b.cost_per_kg) })).slice(0, 12), [feed]);

  const rawTrend = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of feedCons) {
      const d = (c.feed_production_batches?.created_at || "").slice(0, 10); if (!d) continue;
      m[d] = (m[d] || 0) + Number(c.actual_qty ?? c.quantity ?? 0);
    }
    return Object.entries(m).sort().map(([date, qty]) => ({ date: date.slice(5), qty }));
  }, [feedCons]);

  const statusChart = useMemo(() => Object.entries(stats.byStatus).map(([name, value]) => ({ name, value, fill: STATUS_COLORS[name] || "#888" })), [stats.byStatus]);

  const topRaw = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of feedCons) {
      const k = c.material_name || c.raw_material_id?.slice(0, 8) || "—";
      m[k] = (m[k] || 0) + Number(c.actual_qty ?? c.quantity ?? 0);
    }
    return Object.entries(m).sort(([, a], [, b]) => b - a).slice(0, 10).map(([name, qty]) => ({ name: name.slice(0, 18), qty }));
  }, [feedCons]);

 return (
   <DashboardLayout>
   <div dir="rtl" className="p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Wheat className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">لوحة مصنع الأعلاف</h1>
          <p className="text-sm text-muted-foreground">مؤشرات الإنتاج والتكاليف وحالة الدفعات</p>
        </div>
      </div>

      <FactoryFilters value={f} onChange={setF} />

      <FeedPeriodStats />

      <Card className="border-primary/40 bg-primary/5">
        <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Warehouse className="h-5 w-5 text-primary" />
            <div>
              <div className="font-bold">مخازن المصنع — خامات وعلف جاهز</div>
              <div className="text-xs text-muted-foreground">قيمة المخزون، شراء الخامات، فواتير البيع والربح</div>
            </div>
          </div>
          <Link to="/feed-factory/warehouses"><Button><ShoppingCart className="h-4 w-4 ml-1" />فتح المخازن</Button></Link>
        </CardContent>
      </Card>

      <Card className="border-orange-500/40 bg-orange-500/5">
        <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Undo2 className="h-5 w-5 text-orange-600" />
            <div>
              <div className="font-bold">مرتجع مبيعات الأعلاف</div>
              <div className="text-xs text-muted-foreground">إرجاع علف من العميل — يزيد المخزون ويخصم من الخزنة تلقائيًا</div>
            </div>
          </div>
          <Link to="/feed-factory/sales-returns"><Button variant="secondary"><Undo2 className="h-4 w-4 ml-1" />فتح المرتجعات</Button></Link>
        </CardContent>
      </Card>

      <Card className="border-warning">
        <CardContent className="p-3 flex items-center gap-2 text-sm">
          <FileWarning className="h-4 w-4 text-warning" />
          الفاتورة 164 لا تزال في حالة <Badge variant="outline">needs_review</Badge> — لم يتم تفعيلها.
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard title="إنتاج اليوم" value={`${stats.todayProd.toFixed(1)} كجم`} icon={Wheat} iconColor="bg-primary" />
        <StatCard title="إجمالي إنتاج الأعلاف" value={`${stats.monthProd.toFixed(1)} كجم`} icon={Package} iconColor="bg-secondary" />
        <StatCard title="إجمالي التكلفة" value={stats.totalCost.toLocaleString("en-US", { maximumFractionDigits: 0 })} change={`متوسط ${stats.avgCost.toFixed(2)} /كجم`} icon={Banknote} iconColor="bg-accent" />
        <StatCard title="استهلاك المواد الخام" value={stats.rawCons.toFixed(1)} icon={Boxes} to="/factories/reports?tab=raw" />
        <StatCard title="علف تام مستلم" value={stats.finishedRcv.toFixed(1)} icon={CheckCircle} iconColor="bg-success" />
        <StatCard title="قيد المراجعة" value={stats.pendingReview} icon={Clock} iconColor="bg-warning" to="/feed-factory/batches" />
        <StatCard title="تكلفة صفرية" value={stats.zeroCost} icon={AlertTriangle} iconColor="bg-destructive" />
        <StatCard title="إجمالي الدفعات" value={feed.length} icon={Wheat} />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card><CardHeader><CardTitle className="text-base">إنتاج الأعلاف حسب النوع</CardTitle></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer><BarChart data={prodByType}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" tick={{ fontSize: 10 }} /><YAxis /><Tooltip /><Bar dataKey="qty" fill={PURPLE} /></BarChart></ResponsiveContainer>
          </CardContent>
        </Card>
        <Card><CardHeader><CardTitle className="text-base">تكلفة كل كجم</CardTitle></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer><BarChart data={costPerKg}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" tick={{ fontSize: 9 }} /><YAxis /><Tooltip /><Bar dataKey="cpk" fill={ORANGE} /></BarChart></ResponsiveContainer>
          </CardContent>
        </Card>
        <Card><CardHeader><CardTitle className="text-base">اتجاه استهلاك المواد</CardTitle></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer><LineChart data={rawTrend}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" /><YAxis /><Tooltip /><Line type="monotone" dataKey="qty" stroke={PURPLE} strokeWidth={2} /></LineChart></ResponsiveContainer>
          </CardContent>
        </Card>
        <Card><CardHeader><CardTitle className="text-base">توزيع حالة الدفعات</CardTitle></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer><PieChart><Pie data={statusChart} dataKey="value" nameKey="name" outerRadius={80} label>{statusChart.map((s, i) => <Cell key={i} fill={s.fill} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer>
          </CardContent>
        </Card>
        <Card className="md:col-span-2"><CardHeader><CardTitle className="text-base">أعلى المواد استهلاكاً</CardTitle></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer><BarChart data={topRaw} layout="vertical"><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" /><YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={120} /><Tooltip /><Bar dataKey="qty" fill={PURPLE} /></BarChart></ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">أحدث الدفعات</CardTitle><CardDescription>اضغط للتفاصيل والطباعة</CardDescription></CardHeader>
        <CardContent className="space-y-1">
          {feed.slice(0, 8).map((b: any) => (
            <Link key={b.id} to={`/feed-factory/batches/${b.id}`} className="flex items-center justify-between p-2 rounded hover:bg-muted text-sm">
              <span className="font-mono text-xs">{b.batch_number}</span>
              <span className="flex-1 px-2 truncate">{b.actual_quantity ?? b.target_quantity} كجم</span>
              <Badge style={{ backgroundColor: STATUS_COLORS[b.status] }} className="text-white">{b.status}</Badge>
            </Link>
          ))}
          {!feed.length && !isLoading && <div className="text-center text-muted-foreground text-sm py-4">لا توجد دفعات</div>}
        </CardContent>
      </Card>
    </div>
   </DashboardLayout>
  );
}
