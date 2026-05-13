import { useState } from "react";
import { Button } from "@/components/ui/button";
import { exportToPDF, exportToExcel } from "@/utils/exportReports";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import StatCard from "@/components/dashboard/StatCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DollarSign,
  ShoppingCart,
  Users,
  TrendingUp,
  Package,
  MapPin,
  Award,
  BarChart3,
  Globe,
  Truck,
  UserCheck,
  ArrowUpRight,
  ArrowDownRight,
  FileDown,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  RadialBarChart,
  RadialBar,
  Legend,
} from "recharts";
import { useDashboardStats, useRecentOrders } from "@/hooks/useSalesAnalytics";
import { useReportsData } from "@/hooks/useReportsData";
import { useProductionStats } from "@/hooks/useProductionStats";
import { Egg, Bird } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

const statusColors: Record<string, string> = {
  pending: "bg-warning text-warning-foreground",
  processing: "bg-primary text-primary-foreground",
  shipped: "bg-chart-4 text-primary-foreground",
  delivered: "bg-success text-success-foreground",
  cancelled: "bg-destructive text-destructive-foreground",
};

const statusLabels: Record<string, string> = {
  pending: "قيد الانتظار",
  processing: "جاري التجهيز",
  shipped: "تم الشحن",
  delivered: "تم التوصيل",
  cancelled: "ملغي",
};

const COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--secondary))",
  "hsl(var(--success))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "hsl(var(--destructive))",
  "hsl(var(--warning))",
];

const tooltipStyle = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "0.75rem",
  direction: "rtl" as const,
};

const formatSales = (v: number) => {
  if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(0)}K`;
  return String(v);
};

const Index = () => {
  const { role } = useAuth();
  const isModerator = role === 'sales_moderator';

  const { data: stats, isLoading } = useDashboardStats();
  const { data: recentOrders, isLoading: ordersLoading } = useRecentOrders(5);
  const reportData = useReportsData("all");
  const [prodFrom, setProdFrom] = useState<string>("");
  const [prodTo, setProdTo] = useState<string>("");
  const { data: prod, isLoading: prodLoading } = useProductionStats(prodFrom, prodTo);

  const setQuickRange = (kind: "today" | "month" | "year" | "clear") => {
    const now = new Date();
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    if (kind === "today") { const t = fmt(now); setProdFrom(t); setProdTo(t); }
    else if (kind === "month") { setProdFrom(fmt(new Date(now.getFullYear(), now.getMonth(), 1))); setProdTo(fmt(now)); }
    else if (kind === "year") { setProdFrom(`${now.getFullYear()}-01-01`); setProdTo(fmt(now)); }
    else { setProdFrom(""); setProdTo(""); }
  };

  return (
    <DashboardLayout>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <Header
          title="لوحة التحكم"
          subtitle="شركة نعام العاصمة إدارة العمليات - تحليلات 2025"
        />
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={reportData.isLoading}
            onClick={() => exportToPDF({
              totalSales: reportData.totalSales,
              totalOrders: reportData.totalOrders,
              avgOrderValue: reportData.avgOrderValue,
              totalCustomers: reportData.totalCustomers,
              monthlySales: reportData.monthlySales,
              governorateData: reportData.governorateData,
              sourceData: reportData.sourceData,
              shippingData: reportData.shippingData,
              moderatorData: reportData.moderatorData,
              productData: reportData.productData,
              periodLabel: "لوحة التحكم 2025",
            })}
          >
            <FileDown className="w-4 h-4 ml-1" />
            PDF
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={reportData.isLoading}
            onClick={() => exportToExcel({
              totalSales: reportData.totalSales,
              totalOrders: reportData.totalOrders,
              avgOrderValue: reportData.avgOrderValue,
              totalCustomers: reportData.totalCustomers,
              monthlySales: reportData.monthlySales,
              governorateData: reportData.governorateData,
              sourceData: reportData.sourceData,
              shippingData: reportData.shippingData,
              moderatorData: reportData.moderatorData,
              productData: reportData.productData,
              periodLabel: "لوحة التحكم 2025",
            })}
          >
            <FileDown className="w-4 h-4 ml-1" />
            Excel
          </Button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 mb-4">
        <StatCard
          title="إجمالي المبيعات"
          value={isLoading ? "..." : `${formatSales(stats?.totalSales || 0)} ج.م`}
          change={isLoading ? "" : `اليوم: ${formatSales(stats?.salesToday || 0)} | الشهر: ${formatSales(stats?.salesMonth || 0)}`}
          changeType="positive"
          icon={DollarSign}
          iconColor="bg-success"
        />
        <StatCard
          title="الطلبات"
          value={isLoading ? "..." : (stats?.totalOrders || 0).toLocaleString()}
          change={isLoading ? "" : `اليوم: ${stats?.ordersToday || 0} | الشهر: ${stats?.ordersMonth || 0}`}
          changeType="positive"
          icon={ShoppingCart}
          iconColor="bg-primary"
        />
        <StatCard
          title="العملاء"
          value={isLoading ? "..." : (stats?.totalCustomers || 0).toLocaleString()}
          change={`متوسط: ${stats?.avgOrderValue || 0} ج.م/طلب`}
          changeType="positive"
          icon={Users}
          iconColor="bg-secondary"
        />
        <StatCard
          title="منتجات قليلة المخزون"
          value={isLoading ? "..." : stats?.lowStockProducts || 0}
          change="يحتاج إعادة طلب"
          changeType="negative"
          icon={Package}
          iconColor="bg-destructive"
        />
      </div>

      {/* Daily / Monthly / Yearly Sales Breakdown - Hidden for sales moderators */}
      {!isModerator && (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <Card className="glass-card">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm text-muted-foreground">مبيعات اليوم</p>
              <Badge variant="outline" className="text-xs">{new Date().toLocaleDateString("ar-EG")}</Badge>
            </div>
            <p className="text-2xl font-bold text-success">{isLoading ? "..." : `${(stats?.salesToday || 0).toLocaleString()} ج.م`}</p>
            <p className="text-xs text-muted-foreground mt-1">{stats?.ordersToday || 0} طلب اليوم</p>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm text-muted-foreground">مبيعات الشهر</p>
              <Badge variant="outline" className="text-xs">{new Date().toLocaleDateString("ar-EG", { month: "long" })}</Badge>
            </div>
            <p className="text-2xl font-bold text-primary">{isLoading ? "..." : `${(stats?.salesMonth || 0).toLocaleString()} ج.م`}</p>
            <p className="text-xs text-muted-foreground mt-1">{stats?.ordersMonth || 0} طلب هذا الشهر</p>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm text-muted-foreground">مبيعات السنة</p>
              <Badge variant="outline" className="text-xs">{new Date().getFullYear()}</Badge>
            </div>
            <p className="text-2xl font-bold text-secondary">{isLoading ? "..." : `${(stats?.salesYear || 0).toLocaleString()} ج.م`}</p>
            <p className="text-xs text-muted-foreground mt-1">{stats?.ordersYear || 0} طلب هذه السنة</p>
          </CardContent>
        </Card>
      </div>
      )}

      {/* Sales Trends — Monthly (current year) & Daily (current month) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="w-5 h-5 text-primary" />
              المبيعات والطلبات الشهرية — {new Date().getFullYear()}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-[280px] w-full" /> : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={(stats?.monthlySeries || []).map((m: any) => ({
                  month: ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"][parseInt(m.month.split("-")[1]) - 1],
                  sales: Number(m.sales), orders: m.orders,
                }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <YAxis yAxisId="l" stroke="hsl(var(--muted-foreground))" fontSize={10} tickFormatter={formatSales} />
                  <YAxis yAxisId="r" orientation="right" stroke="hsl(var(--muted-foreground))" fontSize={10} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => [n === "sales" ? `${Number(v).toLocaleString()} ج.م` : `${v} طلب`, n === "sales" ? "المبيعات" : "الطلبات"]} />
                  <Legend formatter={(v) => v === "sales" ? "المبيعات (ج.م)" : "الطلبات"} />
                  <Bar yAxisId="l" dataKey="sales" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
                  <Bar yAxisId="r" dataKey="orders" fill="hsl(var(--secondary))" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="w-5 h-5 text-secondary" />
              المبيعات والطلبات اليومية — {new Date().toLocaleDateString("ar-EG", { month: "long" })}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-[280px] w-full" /> : (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={(stats?.dailySeries || []).map((d: any) => ({ ...d, day: d.date.slice(8, 10) }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <YAxis yAxisId="l" stroke="hsl(var(--muted-foreground))" fontSize={10} tickFormatter={formatSales} />
                  <YAxis yAxisId="r" orientation="right" stroke="hsl(var(--muted-foreground))" fontSize={10} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => [n === "sales" ? `${Number(v).toLocaleString()} ج.م` : `${v} طلب`, n === "sales" ? "المبيعات" : "الطلبات"]} />
                  <Legend formatter={(v) => v === "sales" ? "المبيعات (ج.م)" : "الطلبات"} />
                  <Line yAxisId="l" type="monotone" dataKey="sales" stroke="hsl(var(--primary))" strokeWidth={2.5} dot={{ r: 3 }} />
                  <Line yAxisId="r" type="monotone" dataKey="orders" stroke="hsl(var(--secondary))" strokeWidth={2.5} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Orders Table */}
      <Card className="glass-card mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShoppingCart className="w-5 h-5 text-primary" />
            آخر الطلبات المسجّلة
          </CardTitle>
        </CardHeader>
        <CardContent>
          {ordersLoading ? <Skeleton className="h-40 w-full" /> : (recentOrders?.length === 0 ? (
            <p className="text-center text-muted-foreground py-6 text-sm">لا توجد طلبات بعد</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-right py-2 px-2 font-medium">رقم الطلب</th>
                    <th className="text-right py-2 px-2 font-medium">العميل</th>
                    <th className="text-right py-2 px-2 font-medium">التاريخ</th>
                    <th className="text-right py-2 px-2 font-medium">الإجمالي</th>
                    <th className="text-right py-2 px-2 font-medium">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {recentOrders?.map((o: any) => (
                    <tr key={o.id} className="border-b hover:bg-muted/40 transition-colors">
                      <td className="py-2 px-2 font-mono text-xs">{o.order_number}</td>
                      <td className="py-2 px-2">{(o.customers as any)?.name || "-"}</td>
                      <td className="py-2 px-2 text-xs text-muted-foreground">{new Date(o.created_at).toLocaleDateString("ar-EG")}</td>
                      <td className="py-2 px-2 font-bold">{Number(o.total).toLocaleString()} ج.م</td>
                      <td className="py-2 px-2"><Badge className={statusColors[o.status] || ""}>{statusLabels[o.status] || o.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Production KPIs - Eggs & Chicks - Hidden for sales moderators */}
      {!isModerator && (
      <Card className="glass-card mb-6">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Egg className="w-5 h-5 text-secondary" />
              إنتاج البيض والكتاكيت
            </CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              <Button size="sm" variant={prodFrom && prodFrom === prodTo ? "default" : "outline"} onClick={() => setQuickRange("today")}>اليوم</Button>
              <Button size="sm" variant="outline" onClick={() => setQuickRange("month")}>الشهر</Button>
              <Button size="sm" variant="outline" onClick={() => setQuickRange("year")}>السنة</Button>
              <input type="date" value={prodFrom} onChange={(e) => setProdFrom(e.target.value)} className="h-9 px-2 text-xs border rounded-md bg-background" />
              <input type="date" value={prodTo} onChange={(e) => setProdTo(e.target.value)} className="h-9 px-2 text-xs border rounded-md bg-background" />
              {(prodFrom || prodTo) && <Button size="sm" variant="ghost" onClick={() => setQuickRange("clear")}>مسح</Button>}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {prodFrom && prodTo && (
            <div className="mb-3 p-2 rounded-lg bg-muted/40 text-xs text-muted-foreground">
              النطاق المختار: {prodFrom} → {prodTo} | بيض: <b>{(prod?.eggs.range ?? 0).toLocaleString()}</b> | كتاكيت: <b>{(prod?.chicks.range ?? 0).toLocaleString()}</b> | مبيعات: <b>{(prod?.sales.sold_range ?? 0).toLocaleString()}</b> | إيراد: <b>{formatSales(prod?.sales.revenue_range ?? 0)} ج.م</b>
            </div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <ProdCard label="بيض اليوم" value={prodLoading ? "..." : (prod?.eggs.today ?? 0).toLocaleString()} color="from-amber-500 to-orange-600" icon={Egg} />
            <ProdCard label="بيض الشهر" value={prodLoading ? "..." : (prod?.eggs.month ?? 0).toLocaleString()} color="from-orange-500 to-red-500" icon={Egg} />
            <ProdCard label="بيض السنة" value={prodLoading ? "..." : (prod?.eggs.year ?? 0).toLocaleString()} color="from-red-500 to-pink-600" icon={Egg} />
            <ProdCard label="كتاكيت اليوم" value={prodLoading ? "..." : (prod?.chicks.today ?? 0).toLocaleString()} color="from-cyan-500 to-blue-600" icon={Bird} />
            <ProdCard label="كتاكيت الشهر" value={prodLoading ? "..." : (prod?.chicks.month ?? 0).toLocaleString()} color="from-blue-500 to-indigo-600" icon={Bird} />
            <ProdCard label="كتاكيت السنة" value={prodLoading ? "..." : (prod?.chicks.year ?? 0).toLocaleString()} color="from-indigo-500 to-purple-600" icon={Bird} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 pt-3 border-t">
            <ProdCard label="مبيعات كتاكيت/اليوم" value={prodLoading ? "..." : (prod?.sales.sold_today ?? 0).toLocaleString()} color="from-emerald-500 to-green-600" icon={Bird} />
            <ProdCard label="مبيعات كتاكيت/الشهر" value={prodLoading ? "..." : (prod?.sales.sold_month ?? 0).toLocaleString()} color="from-green-500 to-teal-600" icon={Bird} />
            <ProdCard label="إيراد الشهر" value={prodLoading ? "..." : `${formatSales(prod?.sales.revenue_month ?? 0)} ج.م`} color="from-teal-500 to-cyan-600" icon={DollarSign} />
            <ProdCard label="إيراد السنة" value={prodLoading ? "..." : `${formatSales(prod?.sales.revenue_year ?? 0)} ج.م`} color="from-purple-500 to-fuchsia-600" icon={DollarSign} />
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
            <div>
              <p className="text-sm font-semibold mb-2 text-muted-foreground">إنتاج ومبيعات الكتاكيت — الشهر الحالي</p>
              {prodLoading ? <Skeleton className="h-[260px] w-full" /> : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={prod?.daily ?? []}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={10} tickFormatter={(d) => d.slice(8, 10)} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => [v.toLocaleString(), n === "chicks" ? "كتاكيت منتجة" : n === "sold" ? "مباع" : "إيراد"]} />
                    <Legend formatter={(v) => v === "chicks" ? "كتاكيت منتجة" : v === "sold" ? "مباع" : "إيراد (ج.م)"} />
                    <Bar dataKey="chicks" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="sold" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="revenue" fill="hsl(var(--secondary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
            <div>
              <p className="text-sm font-semibold mb-2 text-muted-foreground">إنتاج البيض — اليوم / الشهر / السنة</p>
              {prodLoading ? <Skeleton className="h-[260px] w-full" /> : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={[
                    { period: "اليوم", eggs: prod?.eggs.today ?? 0 },
                    { period: "الشهر", eggs: prod?.eggs.month ?? 0 },
                    { period: "السنة", eggs: prod?.eggs.year ?? 0 },
                  ]}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="period" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickFormatter={formatSales} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [v.toLocaleString() + " بيضة", "العدد"]} />
                    <Bar dataKey="eggs" radius={[8, 8, 0, 0]}>
                      <Cell fill="hsl(var(--chart-4))" />
                      <Cell fill="hsl(var(--secondary))" />
                      <Cell fill="hsl(var(--destructive))" />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
      )}

      <Tabs defaultValue="overview" className="mb-8">
        <TabsList className="grid w-full grid-cols-4 mb-6">
          <TabsTrigger value="overview">نظرة عامة</TabsTrigger>
          <TabsTrigger value="regions">المحافظات</TabsTrigger>
          <TabsTrigger value="team">الفريق</TabsTrigger>
          <TabsTrigger value="channels">القنوات</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Monthly Sales Area Chart */}
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-primary" />
                  تطور المبيعات الشهرية 2025
                </CardTitle>
              </CardHeader>
              <CardContent>
                {reportData.isLoading ? (
                  <Skeleton className="h-[300px] w-full" />
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={reportData.monthlySales}>
                      <defs>
                        <linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickFormatter={formatSales} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v.toLocaleString()} ج.م`, "المبيعات"]} />
                      <Area type="monotone" dataKey="sales" stroke="hsl(var(--primary))" fillOpacity={1} fill="url(#salesGradient)" strokeWidth={3} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* Orders Line Chart */}
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShoppingCart className="w-5 h-5 text-secondary" />
                  عدد الطلبات الشهرية
                </CardTitle>
              </CardHeader>
              <CardContent>
                {reportData.isLoading ? (
                  <Skeleton className="h-[300px] w-full" />
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={reportData.monthlySales}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v} طلب`, "الطلبات"]} />
                      <Line type="monotone" dataKey="orders" stroke="hsl(var(--secondary))" strokeWidth={3} dot={{ fill: "hsl(var(--secondary))", strokeWidth: 2, r: 5 }} activeDot={{ r: 7 }} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Monthly Growth */}
          {!reportData.isLoading && reportData.monthlySales.length > 1 && (
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-chart-4" />
                  معدل النمو الشهري (MoM%)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={reportData.monthlySales.slice(1)}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickFormatter={(v) => `${v}%`} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v}%`, "النمو"]} />
                    <Bar dataKey="momPercent" radius={[8, 8, 0, 0]}>
                      {reportData.monthlySales.slice(1).map((entry, i) => (
                        <Cell key={i} fill={entry.momPercent >= 0 ? "hsl(var(--success))" : "hsl(var(--destructive))"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Top Products */}
          {!reportData.isLoading && reportData.productData.length > 0 && (
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Package className="w-5 h-5 text-primary" />
                  أفضل 10 منتجات مبيعاً
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={350}>
                  <BarChart data={reportData.productData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={11} tickFormatter={formatSales} />
                    <YAxis type="category" dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={11} width={90} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v.toLocaleString()} وحدة`, "الكمية"]} />
                    <Bar dataKey="quantity" radius={[0, 8, 8, 0]}>
                      {reportData.productData.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Regions Tab */}
        <TabsContent value="regions" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-success" />
                  المبيعات حسب المحافظة
                </CardTitle>
              </CardHeader>
              <CardContent>
                {reportData.isLoading ? (
                  <Skeleton className="h-[350px] w-full" />
                ) : (
                  <ResponsiveContainer width="100%" height={350}>
                    <BarChart data={reportData.governorateData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={11} tickFormatter={formatSales} />
                      <YAxis type="category" dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={11} width={70} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v.toLocaleString()} ج.م`, "المبيعات"]} />
                      <Bar dataKey="sales" radius={[0, 8, 8, 0]}>
                        {reportData.governorateData.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-primary" />
                  توزيع الطلبات حسب المحافظة
                </CardTitle>
              </CardHeader>
              <CardContent>
                {reportData.isLoading ? (
                  <Skeleton className="h-[350px] w-full" />
                ) : (
                  <ResponsiveContainer width="100%" height={350}>
                    <PieChart>
                      <Pie
                        data={reportData.governorateData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={110}
                        paddingAngle={3}
                        dataKey="orders"
                        label={({ name, value }) => `${name} (${value})`}
                      >
                        {reportData.governorateData.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v} طلب`, "الطلبات"]} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Governorate Stats Table */}
          {!reportData.isLoading && reportData.governorateData.length > 0 && (
            <Card className="glass-card">
              <CardHeader>
                <CardTitle>تفاصيل المبيعات حسب المحافظة</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {reportData.governorateData.map((gov, i) => {
                    const percent = reportData.totalSales > 0 ? Math.round((gov.sales / reportData.totalSales) * 1000) / 10 : 0;
                    return (
                      <div key={gov.name} className="flex items-center justify-between p-3 rounded-xl bg-muted/30 hover:bg-muted/50 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold" style={{ backgroundColor: COLORS[i % COLORS.length], color: "white" }}>
                            {i + 1}
                          </div>
                          <div>
                            <p className="font-semibold">{gov.name}</p>
                            <p className="text-sm text-muted-foreground">{gov.orders} طلب</p>
                          </div>
                        </div>
                        <div className="text-left">
                          <p className="font-bold">{gov.sales.toLocaleString()} ج.م</p>
                          <p className="text-sm text-muted-foreground">{percent}%</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Team Tab */}
        <TabsContent value="team" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <UserCheck className="w-5 h-5 text-secondary" />
                  أداء الموديراتور - المبيعات
                </CardTitle>
              </CardHeader>
              <CardContent>
                {reportData.isLoading ? (
                  <Skeleton className="h-[300px] w-full" />
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={reportData.moderatorData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickFormatter={formatSales} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: number, _: any, entry: any) => [`${v.toLocaleString()} ج.م (${entry.payload.percent}%)`, "المبيعات"]} />
                      <Bar dataKey="sales" radius={[8, 8, 0, 0]}>
                        {reportData.moderatorData.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Award className="w-5 h-5 text-primary" />
                  نسب المبيعات - الفريق
                </CardTitle>
              </CardHeader>
              <CardContent>
                {reportData.isLoading ? (
                  <Skeleton className="h-[300px] w-full" />
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={reportData.moderatorData}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={100}
                        paddingAngle={3}
                        dataKey="sales"
                        label={({ name, percent }) => `${name} (${(percent * 100).toFixed(1)}%)`}
                      >
                        {reportData.moderatorData.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v.toLocaleString()} ج.م`, "المبيعات"]} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Moderator Cards */}
          {!reportData.isLoading && reportData.moderatorData.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {reportData.moderatorData.map((mod, i) => (
                <Card key={mod.name} className="glass-card p-4 hover:shadow-lg transition-shadow">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold" style={{ backgroundColor: COLORS[i % COLORS.length], color: "white" }}>
                      {i + 1}
                    </div>
                    <div>
                      <p className="font-bold">{mod.name}</p>
                      <p className="text-sm text-muted-foreground">{mod.orders} طلب</p>
                    </div>
                  </div>
                  <div className="flex justify-between items-end">
                    <p className="text-xl font-bold">{mod.sales.toLocaleString()} ج.م</p>
                    <Badge variant="secondary">{mod.percent}%</Badge>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Channels Tab */}
        <TabsContent value="channels" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Globe className="w-5 h-5 text-primary" />
                  مصادر العملاء
                </CardTitle>
              </CardHeader>
              <CardContent>
                {reportData.isLoading ? (
                  <Skeleton className="h-[300px] w-full" />
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={reportData.sourceData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={100}
                        paddingAngle={3}
                        dataKey="orders"
                        label={({ name, value }) => `${name} (${value})`}
                      >
                        {reportData.sourceData.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: number, _: any, entry: any) => [`${entry.payload.value}% (${v} طلب)`, "النسبة"]} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Truck className="w-5 h-5 text-chart-4" />
                  شركات الشحن
                </CardTitle>
              </CardHeader>
              <CardContent>
                {reportData.isLoading ? (
                  <Skeleton className="h-[300px] w-full" />
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={reportData.shippingData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: number, _: any, entry: any) => [`${v}% (${entry.payload.orders} طلب)`, "النسبة"]} />
                      <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                        {reportData.shippingData.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Source & Shipping Details */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {!reportData.isLoading && reportData.sourceData.length > 0 && (
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle>تفاصيل مصادر العملاء</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {reportData.sourceData.map((src, i) => (
                      <div key={src.name} className="flex items-center justify-between p-3 rounded-xl bg-muted/30">
                        <div className="flex items-center gap-3">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                          <span className="font-medium">{src.name}</span>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="text-sm text-muted-foreground">{src.orders} طلب</span>
                          <Badge variant="outline">{src.value}%</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {!reportData.isLoading && reportData.shippingData.length > 0 && (
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle>تفاصيل شركات الشحن</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {reportData.shippingData.map((ship, i) => (
                      <div key={ship.name} className="flex items-center justify-between p-3 rounded-xl bg-muted/30">
                        <div className="flex items-center gap-3">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                          <span className="font-medium">{ship.name}</span>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="text-sm text-muted-foreground">{ship.orders} طلب</span>
                          <Badge variant="outline">{ship.value}%</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Recent Orders */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle>أحدث الطلبات</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {ordersLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-xl" />
              ))
            ) : (
              (recentOrders || []).map((order: any) => (
                <div
                  key={order.id}
                  className="flex items-center justify-between p-4 rounded-xl bg-muted/30 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <ShoppingCart className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-semibold">{order.customers?.name || "عميل"}</p>
                      <p className="text-sm text-muted-foreground">
                        {order.order_number} • {new Date(order.created_at).toLocaleDateString("ar-EG")}
                      </p>
                    </div>
                  </div>
                  <div className="text-left">
                    <p className="font-bold">{Number(order.total).toLocaleString()} ج.م</p>
                    <Badge className={statusColors[order.status] || ""}>
                      {statusLabels[order.status] || order.status}
                    </Badge>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </DashboardLayout>
  );
};

const ProdCard = ({ label, value, color, icon: Icon }: any) => (
  <Card className="relative overflow-hidden border-0 shadow">
    <div className={`absolute inset-0 bg-gradient-to-br ${color} opacity-95`} />
    <div className="relative p-3 text-white">
      <div className="flex items-center gap-2 mb-1"><Icon className="w-4 h-4" /><span className="text-xs opacity-90">{label}</span></div>
      <p className="text-xl font-bold">{value}</p>
    </div>
  </Card>
);

export default Index;
