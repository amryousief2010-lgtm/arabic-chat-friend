import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useModeratorPerformance, type YearFilter } from "@/hooks/useModeratorPerformance";
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

const ModeratorPerformance = () => {
  const [searchParams] = useSearchParams();
  const [selectedModerator, setSelectedModerator] = useState<string | null>(null);
  const [showComparison, setShowComparison] = useState(false);
  const [yearFilter, setYearFilter] = useState<YearFilter>("all");
  const { moderators: moderatorPerformanceData, monthlyData: moderatorMonthlyData, totalSales, totalOrders, isLoading } = useModeratorPerformance(yearFilter);

  useEffect(() => {
    if (searchParams.get("compare") === "1") {
      setShowComparison(true);
    }
  }, [searchParams]);

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
          subtitle="فريق المبيعات: آية، سارة، نورا، منال"
        />
        <div className="flex items-center gap-2 flex-wrap">
          <Tabs value={yearFilter} onValueChange={(v) => setYearFilter(v as YearFilter)}>
            <TabsList>
              <TabsTrigger value="all">الكل</TabsTrigger>
              <TabsTrigger value="2026">2026</TabsTrigger>
              <TabsTrigger value="pre2026">2025 وما قبله</TabsTrigger>
            </TabsList>
          </Tabs>
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
              {isLoading ? <Skeleton className="h-7 w-10" /> : <p className="text-2xl font-bold">{moderatorPerformanceData.length}</p>}
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
              {isLoading ? <Skeleton className="h-7 w-20" /> : <p className="text-2xl font-bold">{(totalSales / 1000000).toFixed(1)}M ج.م</p>}
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
              {isLoading ? <Skeleton className="h-7 w-16" /> : <p className="text-2xl font-bold">{totalOrders.toLocaleString()}</p>}
            </div>
          </div>
        </Card>
      </div>

      {/* Charts */}
      {isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {[1, 2].map((i) => (
            <Card key={i} className="glass-card">
              <CardHeader><Skeleton className="h-6 w-40" /></CardHeader>
              <CardContent><Skeleton className="h-[300px] w-full" /></CardContent>
            </Card>
          ))}
        </div>
      ) : (
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
      )}

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
