import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import StatCard from "@/components/dashboard/StatCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DollarSign,
  ShoppingCart,
  Users,
  TrendingUp,
  Package,
  MapPin,
  Award,
  BarChart3,
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
} from "recharts";
import { useDashboardStats, useRecentOrders } from "@/hooks/useSalesAnalytics";
import { monthlySalesData, summary2025 } from "@/data/salesAnalytics2025";

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

const Index = () => {
  const { data: stats, isLoading } = useDashboardStats();
  const { data: recentOrders, isLoading: ordersLoading } = useRecentOrders(5);

  return (
    <DashboardLayout>
      <Header
        title="لوحة التحكم"
        subtitle="مرحباً بك في نظام إدارة مبيعات نعام العاصمة"
      />

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 mb-8">
        <StatCard
          title="إجمالي المبيعات"
          value={isLoading ? "..." : `${((stats?.totalSales || 0) / 1000000).toFixed(1)}M ج.م`}
          change={`أفضل شهر: ${summary2025.bestMonth}`}
          changeType="positive"
          icon={DollarSign}
          iconColor="bg-success"
        />
        <StatCard
          title="الطلبات"
          value={isLoading ? "..." : (stats?.totalOrders || 0).toLocaleString()}
          change={`متوسط: ${summary2025.avgOrderValue} ج.م`}
          changeType="positive"
          icon={ShoppingCart}
          iconColor="bg-primary"
        />
        <StatCard
          title="العملاء"
          value={isLoading ? "..." : (stats?.totalCustomers || 0).toLocaleString()}
          change="عملاء فريدين"
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

      {/* Highlights Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 mb-8">
        <Card className="glass-card p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Award className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">أفضل موديراتور</p>
              <p className="font-bold">{summary2025.bestModerator}</p>
            </div>
          </div>
        </Card>
        <Card className="glass-card p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-success/10 flex items-center justify-center">
              <MapPin className="w-5 h-5 text-success" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">أفضل محافظة</p>
              <p className="font-bold">{summary2025.bestGovernorate}</p>
            </div>
          </div>
        </Card>
        <Card className="glass-card p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-secondary/10 flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-secondary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">متوسط الطلب</p>
              <p className="font-bold">{summary2025.avgOrderValue} ج.م</p>
            </div>
          </div>
        </Card>
        <Card className="glass-card p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-chart-4/10 flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-chart-4" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">أفضل مصدر</p>
              <p className="font-bold text-sm">{summary2025.bestSource}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-primary" />
              المبيعات الشهرية 2025
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={monthlySalesData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <YAxis
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
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
                <Bar dataKey="sales" fill="hsl(var(--primary))" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShoppingCart className="w-5 h-5 text-secondary" />
              عدد الطلبات الشهرية
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={monthlySalesData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
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
                  stroke="hsl(var(--secondary))"
                  strokeWidth={3}
                  dot={{ fill: "hsl(var(--secondary))", strokeWidth: 2 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

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

export default Index;
