import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  LineChart,
  Line,
} from "recharts";
import {
  UserCheck,
  DollarSign,
  ShoppingCart,
  TrendingUp,
  ArrowLeft,
  Users,
  Award,
  Target,
  FileDown,
  GitCompareArrows,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { moderatorPerformanceData, monthlySalesData } from "@/data/salesAnalytics2025";
import { exportModeratorPDF } from "@/utils/exportModeratorReport";
import ModeratorComparison from "@/components/moderator/ModeratorComparison";

const COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--secondary))",
  "hsl(var(--success))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "hsl(var(--destructive))",
  "hsl(var(--warning))",
];

// Monthly breakdown per moderator (proportionally distributed based on overall monthly trends)
const moderatorMonthlyData: Record<string, { month: string; sales: number; orders: number }[]> = {
  "أية": [
    { month: "يناير", sales: 454000, orders: 173 },
    { month: "فبراير", sales: 688000, orders: 363 },
    { month: "مارس", sales: 407000, orders: 214 },
    { month: "أبريل", sales: 361000, orders: 213 },
    { month: "مايو", sales: 525000, orders: 281 },
    { month: "يونيو", sales: 279000, orders: 137 },
    { month: "يوليو", sales: 537000, orders: 336 },
    { month: "أغسطس", sales: 655000, orders: 490 },
    { month: "سبتمبر", sales: 553000, orders: 384 },
    { month: "أكتوبر", sales: 449000, orders: 315 },
    { month: "نوفمبر", sales: 449000, orders: 291 },
    { month: "ديسمبر", sales: 542000, orders: 314 },
  ],
  "هبة": [
    { month: "يناير", sales: 169000, orders: 64 },
    { month: "فبراير", sales: 256000, orders: 135 },
    { month: "مارس", sales: 151000, orders: 80 },
    { month: "أبريل", sales: 134000, orders: 79 },
    { month: "مايو", sales: 195000, orders: 104 },
    { month: "يونيو", sales: 104000, orders: 51 },
    { month: "يوليو", sales: 200000, orders: 125 },
    { month: "أغسطس", sales: 243000, orders: 182 },
    { month: "سبتمبر", sales: 206000, orders: 143 },
    { month: "أكتوبر", sales: 167000, orders: 117 },
    { month: "نوفمبر", sales: 167000, orders: 108 },
    { month: "ديسمبر", sales: 201000, orders: 117 },
  ],
  "رانيا": [
    { month: "يناير", sales: 139000, orders: 53 },
    { month: "فبراير", sales: 212000, orders: 112 },
    { month: "مارس", sales: 125000, orders: 66 },
    { month: "أبريل", sales: 111000, orders: 66 },
    { month: "مايو", sales: 161000, orders: 86 },
    { month: "يونيو", sales: 86000, orders: 42 },
    { month: "يوليو", sales: 165000, orders: 103 },
    { month: "أغسطس", sales: 201000, orders: 151 },
    { month: "سبتمبر", sales: 170000, orders: 118 },
    { month: "أكتوبر", sales: 138000, orders: 97 },
    { month: "نوفمبر", sales: 138000, orders: 90 },
    { month: "ديسمبر", sales: 167000, orders: 97 },
  ],
  "سارة": [
    { month: "يناير", sales: 137000, orders: 52 },
    { month: "فبراير", sales: 207000, orders: 109 },
    { month: "مارس", sales: 123000, orders: 64 },
    { month: "أبريل", sales: 109000, orders: 64 },
    { month: "مايو", sales: 158000, orders: 84 },
    { month: "يونيو", sales: 84000, orders: 41 },
    { month: "يوليو", sales: 162000, orders: 101 },
    { month: "أغسطس", sales: 197000, orders: 147 },
    { month: "سبتمبر", sales: 167000, orders: 116 },
    { month: "أكتوبر", sales: 135000, orders: 95 },
    { month: "نوفمبر", sales: 135000, orders: 88 },
    { month: "ديسمبر", sales: 163000, orders: 95 },
  ],
  "سهيلة": [
    { month: "يناير", sales: 78000, orders: 30 },
    { month: "فبراير", sales: 118000, orders: 62 },
    { month: "مارس", sales: 70000, orders: 37 },
    { month: "أبريل", sales: 62000, orders: 37 },
    { month: "مايو", sales: 90000, orders: 48 },
    { month: "يونيو", sales: 48000, orders: 23 },
    { month: "يوليو", sales: 92000, orders: 58 },
    { month: "أغسطس", sales: 112000, orders: 84 },
    { month: "سبتمبر", sales: 95000, orders: 66 },
    { month: "أكتوبر", sales: 77000, orders: 54 },
    { month: "نوفمبر", sales: 77000, orders: 50 },
    { month: "ديسمبر", sales: 93000, orders: 54 },
  ],
  "نورا": [
    { month: "يناير", sales: 41000, orders: 16 },
    { month: "فبراير", sales: 63000, orders: 33 },
    { month: "مارس", sales: 37000, orders: 20 },
    { month: "أبريل", sales: 33000, orders: 19 },
    { month: "مايو", sales: 48000, orders: 26 },
    { month: "يونيو", sales: 26000, orders: 12 },
    { month: "يوليو", sales: 49000, orders: 31 },
    { month: "أغسطس", sales: 60000, orders: 45 },
    { month: "سبتمبر", sales: 50000, orders: 35 },
    { month: "أكتوبر", sales: 41000, orders: 29 },
    { month: "نوفمبر", sales: 41000, orders: 27 },
    { month: "ديسمبر", sales: 49000, orders: 29 },
  ],
};

const ModeratorPerformance = () => {
  const [searchParams] = useSearchParams();
  const [selectedModerator, setSelectedModerator] = useState<string | null>(null);
  const [showComparison, setShowComparison] = useState(false);

  useEffect(() => {
    if (searchParams.get("compare") === "1") {
      setShowComparison(true);
    }
  }, [searchParams]);

  const totalSales = moderatorPerformanceData.reduce((s, m) => s + m.sales, 0);
  const totalOrders = moderatorPerformanceData.reduce((s, m) => s + m.orders, 0);

  if (selectedModerator) {
    const mod = moderatorPerformanceData.find((m) => m.name === selectedModerator);
    const monthlyData = moderatorMonthlyData[selectedModerator] || [];
    const avgOrderValue = mod ? Math.round(mod.sales / mod.orders) : 0;
    const bestMonth = monthlyData.length > 0
      ? monthlyData.reduce((best, m) => (m.sales > best.sales ? m : best), monthlyData[0])
      : null;

    return (
      <DashboardLayout>
        <Header
          title={`أداء الموديراتور: ${selectedModerator}`}
          subtitle="تفاصيل الأداء والمبيعات الشهرية"
        />

        <button
          onClick={() => setSelectedModerator(null)}
          className="flex items-center gap-2 text-primary hover:text-primary/80 mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="font-medium">العودة لقائمة الموديراتور</span>
        </button>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 mb-8">
          <Card className="stat-card">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-success flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-success-foreground" />
              </div>
              <div>
                <p className="text-muted-foreground text-xs">إجمالي المبيعات</p>
                <p className="text-xl font-bold">
                  {mod ? `${(mod.sales / 1000000).toFixed(1)}M` : "0"} ج.م
                </p>
              </div>
            </div>
          </Card>
          <Card className="stat-card">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-primary flex items-center justify-center">
                <ShoppingCart className="w-5 h-5 text-primary-foreground" />
              </div>
              <div>
                <p className="text-muted-foreground text-xs">عدد الطلبات</p>
                <p className="text-xl font-bold">{mod?.orders.toLocaleString() || 0}</p>
              </div>
            </div>
          </Card>
          <Card className="stat-card">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-secondary flex items-center justify-center">
                <Target className="w-5 h-5 text-secondary-foreground" />
              </div>
              <div>
                <p className="text-muted-foreground text-xs">متوسط الطلب</p>
                <p className="text-xl font-bold">{avgOrderValue} ج.م</p>
              </div>
            </div>
          </Card>
          <Card className="stat-card">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-chart-4 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-primary-foreground" />
              </div>
              <div>
                <p className="text-muted-foreground text-xs">النسبة من الإجمالي</p>
                <p className="text-xl font-bold">{mod?.percent || 0}%</p>
              </div>
            </div>
          </Card>
        </div>

        {/* Monthly Charts */}
        {monthlyData.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <DollarSign className="w-5 h-5 text-success" />
                  المبيعات الشهرية
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={monthlyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <YAxis
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={11}
                      tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "0.75rem",
                        direction: "rtl",
                      }}
                      formatter={(value: number) => [`${value.toLocaleString()} ج.م`, "المبيعات"]}
                    />
                    <Bar dataKey="sales" fill="hsl(var(--success))" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ShoppingCart className="w-5 h-5 text-primary" />
                  عدد الطلبات الشهرية
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={monthlyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "0.75rem",
                        direction: "rtl",
                      }}
                      formatter={(value: number) => [`${value} طلب`, "الطلبات"]}
                    />
                    <Line
                      type="monotone"
                      dataKey="orders"
                      stroke="hsl(var(--primary))"
                      strokeWidth={3}
                      dot={{ fill: "hsl(var(--primary))", strokeWidth: 2 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Best Month Highlight */}
        {bestMonth && (
          <Card className="glass-card mb-8">
            <CardContent className="pt-6">
              <div className="flex items-center justify-center gap-6 text-center">
                <Award className="w-10 h-10 text-warning" />
                <div>
                  <p className="text-muted-foreground text-sm">أفضل شهر</p>
                  <p className="text-2xl font-bold">{bestMonth.month}</p>
                  <p className="text-muted-foreground">
                    {bestMonth.sales.toLocaleString()} ج.م — {bestMonth.orders} طلب
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </DashboardLayout>
    );
  }

  // Main list view
  return (
    <DashboardLayout>
      <div className="flex items-center justify-between mb-2 flex-wrap gap-3">
        <Header
          title="أداء الموديراتور"
          subtitle="تحليل تفصيلي لأداء كل موديراتور في 2025"
        />
        <div className="flex items-center gap-2">
          <Button
            variant={showComparison ? "default" : "outline"}
            size="sm"
            onClick={() => setShowComparison(!showComparison)}
          >
            <GitCompareArrows className="w-4 h-4 ml-1" />
            مقارنة
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportModeratorPDF({
              moderators: moderatorPerformanceData,
              monthlyData: moderatorMonthlyData,
              totalSales,
              totalOrders,
            })}
          >
            <FileDown className="w-4 h-4 ml-1" />
            تصدير PDF
          </Button>
        </div>
      </div>

      {showComparison && (
        <div className="mb-8">
          <ModeratorComparison
            moderators={moderatorPerformanceData}
            monthlyData={moderatorMonthlyData}
            onClose={() => setShowComparison(false)}
            initialModA={searchParams.get("a") || undefined}
            initialModB={searchParams.get("b") || undefined}
          />
        </div>
      )}
      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6 mb-8">
        <Card className="stat-card">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-primary flex items-center justify-center">
              <Users className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <p className="text-muted-foreground text-xs">عدد الموديراتور</p>
              <p className="text-2xl font-bold">{moderatorPerformanceData.length}</p>
            </div>
          </div>
        </Card>
        <Card className="stat-card">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-success flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-success-foreground" />
            </div>
            <div>
              <p className="text-muted-foreground text-xs">إجمالي المبيعات</p>
              <p className="text-2xl font-bold">{(totalSales / 1000000).toFixed(1)}M ج.م</p>
            </div>
          </div>
        </Card>
        <Card className="stat-card col-span-2 lg:col-span-1">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-secondary flex items-center justify-center">
              <ShoppingCart className="w-5 h-5 text-secondary-foreground" />
            </div>
            <div>
              <p className="text-muted-foreground text-xs">إجمالي الطلبات</p>
              <p className="text-2xl font-bold">{totalOrders.toLocaleString()}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <UserCheck className="w-5 h-5 text-secondary" />
              مبيعات الموديراتور
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={moderatorPerformanceData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <YAxis
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={11}
                  tickFormatter={(v) => `${(v / 1000000).toFixed(1)}M`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "0.75rem",
                    direction: "rtl",
                  }}
                  formatter={(value: number) => [`${value.toLocaleString()} ج.م`, "المبيعات"]}
                />
                <Bar dataKey="sales" radius={[8, 8, 0, 0]}>
                  {moderatorPerformanceData.map((_, index) => (
                    <Cell key={index} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="w-5 h-5 text-primary" />
              توزيع الحصص
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={moderatorPerformanceData}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={95}
                  paddingAngle={3}
                  dataKey="sales"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                >
                  {moderatorPerformanceData.map((_, index) => (
                    <Cell key={index} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "0.75rem",
                    direction: "rtl",
                  }}
                  formatter={(value: number) => [`${value.toLocaleString()} ج.م`, "المبيعات"]}
                />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Moderator Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {moderatorPerformanceData.map((mod, index) => {
          const avgOrder = Math.round(mod.sales / mod.orders);
          const hasDetail = moderatorMonthlyData[mod.name] !== undefined;
          return (
            <Card
              key={mod.name}
              className={`glass-card transition-all ${hasDetail ? "cursor-pointer hover:shadow-lg hover:scale-[1.02]" : ""}`}
              onClick={() => hasDetail && setSelectedModerator(mod.name)}
            >
              <CardContent className="pt-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-12 h-12 rounded-xl flex items-center justify-center text-primary-foreground font-bold text-lg"
                      style={{ backgroundColor: COLORS[index % COLORS.length] }}
                    >
                      {mod.name.charAt(0)}
                    </div>
                    <div>
                      <h3 className="font-bold text-lg">{mod.name}</h3>
                      <p className="text-xs text-muted-foreground">
                        {mod.percent}% من الإجمالي
                      </p>
                    </div>
                  </div>
                  {index === 0 && (
                    <Badge className="bg-warning text-warning-foreground">
                      <Award className="w-3 h-3 ml-1" />
                      الأفضل
                    </Badge>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="bg-muted/30 rounded-lg p-2">
                    <p className="text-sm font-bold">{(mod.sales / 1000000).toFixed(1)}M</p>
                    <p className="text-[10px] text-muted-foreground">مبيعات</p>
                  </div>
                  <div className="bg-muted/30 rounded-lg p-2">
                    <p className="text-sm font-bold">{mod.orders.toLocaleString()}</p>
                    <p className="text-[10px] text-muted-foreground">طلبات</p>
                  </div>
                  <div className="bg-muted/30 rounded-lg p-2">
                    <p className="text-sm font-bold">{avgOrder}</p>
                    <p className="text-[10px] text-muted-foreground">متوسط</p>
                  </div>
                </div>

                {hasDetail && (
                  <p className="text-xs text-primary mt-3 text-center">اضغط لعرض التفاصيل ←</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </DashboardLayout>
  );
};

export default ModeratorPerformance;
