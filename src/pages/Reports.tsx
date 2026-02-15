import { useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
} from "recharts";
import {
  BarChart3,
  TrendingUp,
  DollarSign,
  ShoppingCart,
  Users,
  MapPin,
  Truck,
  UserCheck,
  Package,
  Globe,
  Calendar,
} from "lucide-react";
import { useReportsData, type ReportPeriod } from "@/hooks/useReportsData";

const COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--secondary))",
  "hsl(var(--success))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "hsl(var(--destructive))",
  "hsl(var(--warning))",
];

const periodLabels: Record<ReportPeriod, string> = {
  month: "هذا الشهر",
  quarter: "آخر 3 أشهر",
  half: "آخر 6 أشهر",
  year: "هذه السنة",
  all: "كل الفترات",
};

const tooltipStyle = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "0.75rem",
  direction: "rtl" as const,
};

const Reports = () => {
  const [period, setPeriod] = useState<ReportPeriod>("all");
  const {
    totalSales,
    totalOrders,
    avgOrderValue,
    totalCustomers,
    monthlySales,
    governorateData,
    sourceData,
    shippingData,
    moderatorData,
    productData,
    isLoading,
  } = useReportsData(period);

  const formatSales = (v: number) => {
    if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
    if (v >= 1000) return `${(v / 1000).toFixed(0)}K`;
    return String(v);
  };

  return (
    <DashboardLayout>
      <Header title="التقارير والتحليلات" subtitle="تحليل شامل للمبيعات من قاعدة البيانات" />

      {/* Period Filter */}
      <div className="flex items-center justify-end gap-3 mb-6">
        <Calendar className="w-4 h-4 text-muted-foreground" />
        <Select value={period} onValueChange={(v) => setPeriod(v as ReportPeriod)}>
          <SelectTrigger className="w-48 input-modern">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(periodLabels).map(([key, label]) => (
              <SelectItem key={key} value={key}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6 mb-8">
        {[
          { label: "إجمالي الإيرادات", value: `${formatSales(totalSales)} ج.م`, icon: DollarSign, color: "bg-success", fgColor: "text-success-foreground" },
          { label: "إجمالي الطلبات", value: totalOrders.toLocaleString(), icon: ShoppingCart, color: "bg-primary", fgColor: "text-primary-foreground" },
          { label: "متوسط قيمة الطلب", value: `${avgOrderValue} ج.م`, icon: TrendingUp, color: "bg-secondary", fgColor: "text-secondary-foreground" },
          { label: "العملاء", value: totalCustomers.toLocaleString(), icon: Users, color: "bg-chart-4", fgColor: "text-primary-foreground" },
        ].map((stat) => (
          <Card key={stat.label} className="stat-card">
            <div className="flex items-center gap-4">
              <div className={`w-12 h-12 rounded-xl ${stat.color} flex items-center justify-center`}>
                <stat.icon className={`w-6 h-6 ${stat.fgColor}`} />
              </div>
              <div>
                <p className="text-muted-foreground text-sm">{stat.label}</p>
                {isLoading ? (
                  <Skeleton className="h-7 w-20" />
                ) : (
                  <p className="text-2xl font-bold">{stat.value}</p>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="glass-card">
              <CardHeader><Skeleton className="h-6 w-40" /></CardHeader>
              <CardContent><Skeleton className="h-[300px] w-full" /></CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <>
          {/* Charts Row 1: Sales Trend + Governorate */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-primary" />
                  تطور المبيعات الشهرية
                </CardTitle>
              </CardHeader>
              <CardContent>
                {monthlySales.length === 0 ? (
                  <p className="text-center text-muted-foreground py-20">لا توجد بيانات في هذه الفترة</p>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={monthlySales}>
                      <defs>
                        <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickFormatter={(v) => formatSales(v)} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v.toLocaleString()} ج.م`, "المبيعات"]} />
                      <Area type="monotone" dataKey="sales" stroke="hsl(var(--primary))" fillOpacity={1} fill="url(#colorSales)" strokeWidth={3} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-success" />
                  المبيعات حسب المحافظة (Top 10)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {governorateData.length === 0 ? (
                  <p className="text-center text-muted-foreground py-20">لا توجد بيانات</p>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={governorateData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={11} tickFormatter={(v) => formatSales(v)} />
                      <YAxis type="category" dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={11} width={70} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v.toLocaleString()} ج.م`, "المبيعات"]} />
                      <Bar dataKey="sales" fill="hsl(var(--success))" radius={[0, 8, 8, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Charts Row 2: Customer Sources + Shipping */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Globe className="w-5 h-5 text-primary" />
                  مصادر العملاء
                </CardTitle>
              </CardHeader>
              <CardContent>
                {sourceData.length === 0 ? (
                  <p className="text-center text-muted-foreground py-20">لا توجد بيانات</p>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={sourceData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={100}
                        paddingAngle={3}
                        dataKey="orders"
                        label={({ name, value }) => `${name} (${value})`}
                      >
                        {sourceData.map((_, i) => (
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
                  أداء شركات الشحن
                </CardTitle>
              </CardHeader>
              <CardContent>
                {shippingData.length === 0 ? (
                  <p className="text-center text-muted-foreground py-20">لا توجد بيانات</p>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={shippingData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: number, _: any, entry: any) => [`${v}% (${entry.payload.orders} طلب)`, "النسبة"]} />
                      <Bar dataKey="value" fill="hsl(var(--chart-4))" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Charts Row 3: Moderator + Products */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <UserCheck className="w-5 h-5 text-secondary" />
                  أداء الموديراتور
                </CardTitle>
              </CardHeader>
              <CardContent>
                {moderatorData.length === 0 ? (
                  <p className="text-center text-muted-foreground py-20">لا توجد بيانات</p>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={moderatorData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickFormatter={(v) => formatSales(v)} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: number, _: any, entry: any) => [`${v.toLocaleString()} ج.م (${entry.payload.percent}%)`, "المبيعات"]} />
                      <Bar dataKey="sales" fill="hsl(var(--secondary))" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Package className="w-5 h-5 text-primary" />
                  أفضل المنتجات مبيعاً (بالكمية)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {productData.length === 0 ? (
                  <p className="text-center text-muted-foreground py-20">لا توجد بيانات</p>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={productData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={11} tickFormatter={(v) => formatSales(v)} />
                      <YAxis type="category" dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={11} width={90} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v.toLocaleString()} وحدة`, "الكمية"]} />
                      <Bar dataKey="quantity" fill="hsl(var(--primary))" radius={[0, 8, 8, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Monthly Growth */}
          {monthlySales.length > 1 && (
            <Card className="glass-card mb-8">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-chart-4" />
                  النمو الشهري (MoM%)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={monthlySales.slice(1)}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickFormatter={(v) => `${v}%`} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v}%`, "النمو"]} />
                    <Bar dataKey="momPercent" radius={[8, 8, 0, 0]}>
                      {monthlySales.slice(1).map((entry, i) => (
                        <Cell key={i} fill={entry.momPercent >= 0 ? "hsl(var(--success))" : "hsl(var(--destructive))"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </DashboardLayout>
  );
};

export default Reports;
