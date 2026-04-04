import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import StatCard from "@/components/dashboard/StatCard";
import {
  ShoppingCart, DollarSign, TrendingUp, Clock, CheckCircle, XCircle, Truck, CreditCard,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, AreaChart, Area,
} from "recharts";

const COLORS = [
  "hsl(var(--primary))", "hsl(var(--success))", "hsl(var(--secondary))",
  "hsl(var(--chart-4))", "hsl(var(--chart-5))", "hsl(var(--destructive))", "hsl(var(--warning))",
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

interface Order {
  id: string;
  status: string;
  payment_status: string;
  payment_method: string;
  total: number;
  created_at: string;
  items: { quantity: number }[];
}

interface OrdersAnalyticsProps {
  orders: Order[];
}

const OrdersAnalytics = ({ orders }: OrdersAnalyticsProps) => {
  const analytics = useMemo(() => {
    const totalRevenue = orders.reduce((s, o) => s + o.total, 0);
    const avgOrderValue = orders.length > 0 ? Math.round(totalRevenue / orders.length) : 0;
    const totalItems = orders.reduce((s, o) => s + o.items.reduce((si, it) => si + it.quantity, 0), 0);

    // Status distribution
    const statusCounts: Record<string, number> = {};
    orders.forEach(o => { statusCounts[o.status] = (statusCounts[o.status] || 0) + 1; });
    const statusLabels: Record<string, string> = {
      pending: "قيد الانتظار", processing: "جاري التجهيز", shipped: "تم الشحن",
      delivered: "تم التوصيل", cancelled: "ملغي",
    };
    const statusData = Object.entries(statusCounts).map(([k, v]) => ({
      name: statusLabels[k] || k, value: v, percent: Math.round((v / orders.length) * 100),
    }));

    // Payment method distribution
    const paymentCounts: Record<string, number> = {};
    orders.forEach(o => { paymentCounts[o.payment_method] = (paymentCounts[o.payment_method] || 0) + 1; });
    const paymentLabels: Record<string, string> = { cash: "نقدي", online: "إلكتروني" };
    const paymentData = Object.entries(paymentCounts).map(([k, v]) => ({
      name: paymentLabels[k] || k, value: v,
    }));

    // Payment status distribution
    const payStatusCounts: Record<string, number> = {};
    orders.forEach(o => { payStatusCounts[o.payment_status] = (payStatusCounts[o.payment_status] || 0) + 1; });
    const payStatusLabels: Record<string, string> = { pending: "قيد الانتظار", paid: "مدفوع", failed: "فشل" };
    const payStatusData = Object.entries(payStatusCounts).map(([k, v]) => ({
      name: payStatusLabels[k] || k, value: v,
    }));

    // Daily orders trend (last 30 days)
    const last30 = new Date();
    last30.setDate(last30.getDate() - 30);
    const dailyMap: Record<string, { orders: number; revenue: number }> = {};
    orders.forEach(o => {
      const d = new Date(o.created_at);
      if (d >= last30) {
        const key = d.toLocaleDateString("ar-EG", { month: "short", day: "numeric" });
        if (!dailyMap[key]) dailyMap[key] = { orders: 0, revenue: 0 };
        dailyMap[key].orders++;
        dailyMap[key].revenue += o.total;
      }
    });
    const dailyTrend = Object.entries(dailyMap).map(([day, data]) => ({ day, ...data }));

    // Monthly orders
    const monthlyMap: Record<string, { orders: number; revenue: number }> = {};
    orders.forEach(o => {
      const d = new Date(o.created_at);
      const key = d.toLocaleDateString("ar-EG", { month: "short", year: "numeric" });
      if (!monthlyMap[key]) monthlyMap[key] = { orders: 0, revenue: 0 };
      monthlyMap[key].orders++;
      monthlyMap[key].revenue += o.total;
    });
    const monthlyData = Object.entries(monthlyMap).map(([month, data]) => ({ month, ...data }));

    const delivered = statusCounts["delivered"] || 0;
    const cancelled = statusCounts["cancelled"] || 0;
    const deliveryRate = orders.length > 0 ? Math.round((delivered / orders.length) * 100) : 0;
    const cancelRate = orders.length > 0 ? Math.round((cancelled / orders.length) * 100) : 0;

    return {
      totalRevenue, avgOrderValue, totalItems, statusData, paymentData,
      payStatusData, dailyTrend, monthlyData, deliveryRate, cancelRate,
      delivered, cancelled,
    };
  }, [orders]);

  return (
    <div className="space-y-6 mb-8">
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="إجمالي الإيرادات" value={`${formatSales(analytics.totalRevenue)} ج.م`} change={`${orders.length} طلب`} changeType="positive" icon={DollarSign} iconColor="bg-success" />
        <StatCard title="متوسط قيمة الطلب" value={`${analytics.avgOrderValue.toLocaleString()} ج.م`} change={`${analytics.totalItems} منتج`} changeType="positive" icon={TrendingUp} iconColor="bg-primary" />
        <StatCard title="معدل التوصيل" value={`${analytics.deliveryRate}%`} change={`${analytics.delivered} طلب مكتمل`} changeType="positive" icon={CheckCircle} iconColor="bg-success" />
        <StatCard title="معدل الإلغاء" value={`${analytics.cancelRate}%`} change={`${analytics.cancelled} طلب ملغي`} changeType={analytics.cancelRate > 10 ? "negative" : "positive"} icon={XCircle} iconColor="bg-destructive" />
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Status Distribution */}
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShoppingCart className="w-5 h-5 text-primary" />
              توزيع حالات الطلبات
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={analytics.statusData} cx="50%" cy="50%" innerRadius={50} outerRadius={90} paddingAngle={3} dataKey="value" label={({ name, percent }) => `${name} (${percent}%)`}>
                  {analytics.statusData.map((_, i) => (<Cell key={i} fill={COLORS[i % COLORS.length]} />))}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v} طلب`, "العدد"]} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Payment Method */}
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CreditCard className="w-5 h-5 text-secondary" />
              طرق الدفع وحالاتها
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground mb-2 font-medium">طريقة الدفع</p>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={analytics.paymentData} cx="50%" cy="50%" outerRadius={70} dataKey="value" label={({ name, value }) => `${name} (${value})`}>
                      {analytics.paymentData.map((_, i) => (<Cell key={i} fill={COLORS[i % COLORS.length]} />))}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-2 font-medium">حالة الدفع</p>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={analytics.payStatusData} cx="50%" cy="50%" outerRadius={70} dataKey="value" label={({ name, value }) => `${name} (${value})`}>
                      {analytics.payStatusData.map((_, i) => (<Cell key={i} fill={COLORS[(i + 2) % COLORS.length]} />))}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Monthly Revenue */}
      {analytics.monthlyData.length > 1 && (
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="w-5 h-5 text-chart-4" />
              تطور الإيرادات والطلبات الشهرية
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={analytics.monthlyData}>
                <defs>
                  <linearGradient id="ordRevGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickFormatter={formatSales} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number, name: string) => [name === "revenue" ? `${v.toLocaleString()} ج.م` : `${v} طلب`, name === "revenue" ? "الإيرادات" : "الطلبات"]} />
                <Area type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" fill="url(#ordRevGrad)" strokeWidth={2} />
                <Line type="monotone" dataKey="orders" stroke="hsl(var(--success))" strokeWidth={2} dot={false} yAxisId={0} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default OrdersAnalytics;
