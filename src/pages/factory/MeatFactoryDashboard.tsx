import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Factory, AlertTriangle, Package, Recycle, CheckCircle, Clock, Banknote, Boxes } from "lucide-react";
import StatCard from "@/components/dashboard/StatCard";
import FactoryFilters, { defaultFilterState, FactoryFilterState } from "@/components/factory/FactoryFilters";
import { useFactoryData } from "@/hooks/useFactoryData";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import DashboardLayout from "@/components/layout/DashboardLayout";

const STATUS_COLORS: Record<string, string> = {
  draft: "#94a3b8", under_review: "#f59e0b", approved: "#10b981", closed: "#6366f1", cancelled: "#ef4444", planned: "#06b6d4",
};
const PURPLE = "#7c3aed"; const ORANGE = "#ea580c";

export default function MeatFactoryDashboard() {
  const [f, setF] = useState<FactoryFilterState>(defaultFilterState());
  const { meat, meatCons, meatPack, movs, items, isLoading } = useFactoryData(f.from, f.to);

  const itemById = useMemo(() => Object.fromEntries(items.map((i: any) => [i.id, i])), [items]);

  const stats = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const todayProd = meat.filter((b: any) => (b.production_date || b.created_at?.slice(0, 10)) === today && b.status === "closed").reduce((s: number, b: any) => s + Number(b.actual_qty || 0), 0);
    const monthProd = meat.filter((b: any) => b.status === "closed").reduce((s: number, b: any) => s + Number(b.actual_qty || 0), 0);
    const totalCost = meat.filter((b: any) => b.status === "closed").reduce((s: number, b: any) => s + Number(b.total_cost || 0), 0);
    const avgCost = monthProd > 0 ? totalCost / monthProd : 0;
    const wasteQty = meat.reduce((s: number, b: any) => s + Number(b.waste_qty || 0), 0);
    const wastePct = monthProd > 0 ? (wasteQty / (monthProd + wasteQty)) * 100 : 0;
    const byStatus: Record<string, number> = {};
    for (const b of meat) byStatus[b.status] = (byStatus[b.status] || 0) + 1;
    const rawCons = meatCons.reduce((s: number, c: any) => s + Number(c.actual_qty ?? c.quantity ?? 0), 0);
    const packCons = meatPack.reduce((s: number, c: any) => s + Number(c.actual_qty ?? c.quantity ?? 0), 0);
    const finishedRcv = movs.filter((m: any) => m.reference_type === "meat_batch" && m.movement_type === "production_in").reduce((s: number, m: any) => s + Number(m.quantity || 0), 0);

    // Blockers
    const zeroCost = items.filter((i: any) => Number(i.unit_cost) === 0 && Number(i.stock) > 0 && i.module === "meat").length;
    const shortageRows = meat.filter((b: any) => b.status === "under_review").length;
    const missingBarcode = items.filter((i: any) => !i.sku && i.module === "meat").length;
    const pendingReview = (byStatus.under_review || 0);

    return { todayProd, monthProd, totalCost, avgCost, wasteQty, wastePct, byStatus, rawCons, packCons, finishedRcv, zeroCost, shortageRows, missingBarcode, pendingReview };
  }, [meat, meatCons, meatPack, movs, items]);

  const productionByProduct = useMemo(() => {
    const m: Record<string, { name: string; qty: number; cost: number }> = {};
    for (const b of meat.filter((x: any) => x.status === "closed")) {
      const k = b.product_name_ar || b.product_code || "—";
      if (!m[k]) m[k] = { name: k.slice(0, 24), qty: 0, cost: 0 };
      m[k].qty += Number(b.actual_qty || 0);
      m[k].cost += Number(b.total_cost || 0);
    }
    return Object.values(m).sort((a, b) => b.qty - a.qty).slice(0, 8);
  }, [meat]);

  const rawTrend = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of meatCons) {
      const d = (c.meat_factory_batches?.created_at || "").slice(0, 10); if (!d) continue;
      m[d] = (m[d] || 0) + Number(c.actual_qty ?? c.quantity ?? 0);
    }
    return Object.entries(m).sort().map(([date, qty]) => ({ date: date.slice(5), qty }));
  }, [meatCons]);

  const wasteTrend = useMemo(() => {
    const m: Record<string, number> = {};
    for (const b of meat) {
      if (!b.waste_qty) continue;
      const d = (b.production_date || b.created_at?.slice(0, 10)) as string;
      m[d] = (m[d] || 0) + Number(b.waste_qty);
    }
    return Object.entries(m).sort().map(([date, qty]) => ({ date: date.slice(5), qty }));
  }, [meat]);

  const statusChart = useMemo(() =>
    Object.entries(stats.byStatus).map(([name, value]) => ({ name, value, fill: STATUS_COLORS[name] || "#888" })),
    [stats.byStatus]);

  const topRaw = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of meatCons) {
      const k = c.material_name_ar || c.material_code || "—";
      m[k] = (m[k] || 0) + Number(c.actual_qty ?? c.quantity ?? 0);
    }
    return Object.entries(m).sort(([, a], [, b]) => b - a).slice(0, 10).map(([name, qty]) => ({ name: name.slice(0, 18), qty }));
  }, [meatCons]);

  return (
    <DashboardLayout>
    <div dir="rtl" className="p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Factory className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">لوحة مصنع اللحوم</h1>
          <p className="text-sm text-muted-foreground">مؤشرات الإنتاج والتكاليف وحالة الدفعات</p>
        </div>
      </div>

      <FactoryFilters value={f} onChange={setF} />

      <Card className="border-red-300 bg-red-50/40">
        <CardHeader className="pb-2"><CardTitle className="text-base text-red-700 flex items-center gap-2"><Warehouse className="h-5 w-5" />مخازن مصنع اللحوم (شامل)</CardTitle>
          <CardDescription>خامات • مشتريات • تصنيع • جاهز • مبيعات • مرتجع • خزنة • جرد • تقارير</CardDescription></CardHeader>
        <CardContent><Link to="/meat-factory/factory-warehouses" className="inline-flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-md text-sm"><Beef className="h-4 w-4" />فتح شاشة المخازن الشاملة</Link></CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard title="إنتاج اليوم" value={`${stats.todayProd.toFixed(1)} كجم`} icon={Factory} iconColor="bg-primary" />
        <StatCard title="إجمالي الإنتاج" value={`${stats.monthProd.toFixed(1)} كجم`} icon={Package} iconColor="bg-secondary" />
        <StatCard title="إجمالي التكلفة" value={stats.totalCost.toLocaleString("en-US", { maximumFractionDigits: 0 })} change={`متوسط ${stats.avgCost.toFixed(2)} /كجم`} icon={Banknote} iconColor="bg-accent" />
        <StatCard title="الفاقد" value={`${stats.wasteQty.toFixed(2)} كجم`} change={`${stats.wastePct.toFixed(1)}%`} changeType={stats.wastePct > 5 ? "negative" : "neutral"} icon={Recycle} iconColor="bg-muted" />
        <StatCard title="استهلاك المواد" value={stats.rawCons.toFixed(1)} icon={Boxes} to="/factories/reports?tab=raw" />
        <StatCard title="استهلاك التغليف" value={stats.packCons.toFixed(1)} icon={Boxes} to="/factories/reports?tab=packaging" />
        <StatCard title="إنتاج تام مستلم" value={stats.finishedRcv.toFixed(1)} icon={CheckCircle} iconColor="bg-success" />
        <StatCard title="قيد المراجعة" value={stats.pendingReview} icon={Clock} iconColor="bg-warning" to="/meat-factory/batches" />
      </div>

      {(stats.zeroCost > 0 || stats.missingBarcode > 0) && (
        <Card className="border-destructive">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-destructive" />تنبيهات التشغيل</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2 text-sm">
            {stats.zeroCost > 0 && <Badge variant="destructive">{stats.zeroCost} بنود تكلفة صفرية</Badge>}
            {stats.missingBarcode > 0 && <Badge variant="destructive">{stats.missingBarcode} بنود بدون باركود</Badge>}
            {stats.shortageRows > 0 && <Badge variant="outline">{stats.shortageRows} دفعات قيد المراجعة</Badge>}
          </CardContent>
        </Card>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <Card><CardHeader><CardTitle className="text-base">الإنتاج حسب المنتج</CardTitle></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer><BarChart data={productionByProduct}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" tick={{ fontSize: 10 }} /><YAxis /><Tooltip /><Bar dataKey="qty" fill={PURPLE} /></BarChart></ResponsiveContainer>
          </CardContent>
        </Card>
        <Card><CardHeader><CardTitle className="text-base">التكلفة حسب المنتج</CardTitle></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer><BarChart data={productionByProduct}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" tick={{ fontSize: 10 }} /><YAxis /><Tooltip /><Bar dataKey="cost" fill={ORANGE} /></BarChart></ResponsiveContainer>
          </CardContent>
        </Card>
        <Card><CardHeader><CardTitle className="text-base">اتجاه استهلاك المواد</CardTitle></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer><LineChart data={rawTrend}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" /><YAxis /><Tooltip /><Line type="monotone" dataKey="qty" stroke={PURPLE} strokeWidth={2} /></LineChart></ResponsiveContainer>
          </CardContent>
        </Card>
        <Card><CardHeader><CardTitle className="text-base">اتجاه الفاقد</CardTitle></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer><LineChart data={wasteTrend}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" /><YAxis /><Tooltip /><Line type="monotone" dataKey="qty" stroke={ORANGE} strokeWidth={2} /></LineChart></ResponsiveContainer>
          </CardContent>
        </Card>
        <Card><CardHeader><CardTitle className="text-base">توزيع حالة الدفعات</CardTitle></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer><PieChart><Pie data={statusChart} dataKey="value" nameKey="name" outerRadius={80} label>{statusChart.map((s, i) => <Cell key={i} fill={s.fill} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer>
          </CardContent>
        </Card>
        <Card><CardHeader><CardTitle className="text-base">أعلى المواد استهلاكاً</CardTitle></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer><BarChart data={topRaw} layout="vertical"><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" /><YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={100} /><Tooltip /><Bar dataKey="qty" fill={PURPLE} /></BarChart></ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">أحدث الدفعات</CardTitle><CardDescription>اضغط للوصول إلى التفاصيل والطباعة</CardDescription></CardHeader>
        <CardContent className="space-y-1">
          {meat.slice(0, 8).map((b: any) => (
            <Link key={b.id} to={`/meat-factory/batches/${b.id}`} className="flex items-center justify-between p-2 rounded hover:bg-muted text-sm">
              <span className="font-mono text-xs">{b.batch_number}</span>
              <span className="flex-1 px-2 truncate">{b.product_name_ar}</span>
              <Badge style={{ backgroundColor: STATUS_COLORS[b.status] }} className="text-white">{b.status}</Badge>
            </Link>
          ))}
          {!meat.length && !isLoading && <div className="text-center text-muted-foreground text-sm py-4">لا توجد دفعات في النطاق المحدد</div>}
        </CardContent>
      </Card>
    </div>
    </DashboardLayout>
  );
}
