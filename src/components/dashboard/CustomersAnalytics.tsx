import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import StatCard from "@/components/dashboard/StatCard";
import { Users, MapPin, DollarSign, TrendingUp, Star, ShoppingCart } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area,
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

interface Customer {
  id: string;
  name: string;
  phone: string;
  city: string | null;
  total_orders: number;
  total_spent: number;
  created_at: string;
}

interface CustomersAnalyticsProps {
  customers: Customer[];
}

const CustomersAnalytics = ({ customers }: CustomersAnalyticsProps) => {
  const analytics = useMemo(() => {
    const totalCustomers = customers.length;
    const totalRevenue = customers.reduce((s, c) => s + c.total_spent, 0);
    const totalOrders = customers.reduce((s, c) => s + c.total_orders, 0);
    const avgSpent = totalCustomers > 0 ? Math.round(totalRevenue / totalCustomers) : 0;
    const activeCustomers = customers.filter(c => c.total_orders > 0).length;
    const vipCustomers = customers.filter(c => c.total_orders >= 5).length;

    // City distribution
    const cityMap: Record<string, { count: number; spent: number; orders: number }> = {};
    customers.forEach(c => {
      const city = c.city || "غير محدد";
      if (!cityMap[city]) cityMap[city] = { count: 0, spent: 0, orders: 0 };
      cityMap[city].count++;
      cityMap[city].spent += c.total_spent;
      cityMap[city].orders += c.total_orders;
    });
    const cityData = Object.entries(cityMap)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Top customers by spending
    const topSpenders = [...customers]
      .sort((a, b) => b.total_spent - a.total_spent)
      .slice(0, 8)
      .map(c => ({ name: c.name.length > 15 ? c.name.slice(0, 15) + "..." : c.name, spent: c.total_spent, orders: c.total_orders }));

    // Customer segments
    const segments = [
      { name: "VIP (5+ طلبات)", value: vipCustomers, fill: "hsl(var(--primary))" },
      { name: "نشط (1-4 طلبات)", value: activeCustomers - vipCustomers, fill: "hsl(var(--success))" },
      { name: "جديد (0 طلبات)", value: totalCustomers - activeCustomers, fill: "hsl(var(--muted-foreground))" },
    ].filter(d => d.value > 0);

    // Registration trend by month
    const monthMap: Record<string, number> = {};
    customers.forEach(c => {
      const d = new Date(c.created_at);
      const key = d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
      monthMap[key] = (monthMap[key] || 0) + 1;
    });
    const registrationTrend = Object.entries(monthMap).map(([month, count]) => ({ month, count }));

    // Spending distribution
    const spendRanges = [
      { label: "0-500", min: 0, max: 500 },
      { label: "500-2K", min: 500, max: 2000 },
      { label: "2K-5K", min: 2000, max: 5000 },
      { label: "5K-10K", min: 5000, max: 10000 },
      { label: "10K+", min: 10000, max: Infinity },
    ];
    const spendingDist = spendRanges.map(r => ({
      name: r.label,
      count: customers.filter(c => c.total_spent >= r.min && c.total_spent < r.max).length,
    }));

    return {
      totalCustomers, totalRevenue, totalOrders, avgSpent, activeCustomers,
      vipCustomers, cityData, topSpenders, segments, registrationTrend, spendingDist,
    };
  }, [customers]);

  const formatVal = (v: number) => {
    if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
    if (v >= 1000) return `${(v / 1000).toFixed(0)}K`;
    return String(v);
  };

  return (
    <div className="space-y-6 mb-8">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="إجمالي العملاء" value={analytics.totalCustomers.toLocaleString()} change={`${analytics.activeCustomers} نشط`} changeType="positive" icon={Users} iconColor="bg-primary" />
        <StatCard title="إجمالي الإيرادات" value={`${formatVal(analytics.totalRevenue)} ج.م`} change={`${analytics.totalOrders} طلب`} changeType="positive" icon={DollarSign} iconColor="bg-success" />
        <StatCard title="متوسط إنفاق العميل" value={`${analytics.avgSpent.toLocaleString()} ج.م`} change="لكل عميل" changeType="positive" icon={TrendingUp} iconColor="bg-secondary" />
        <StatCard title="عملاء VIP" value={analytics.vipCustomers} change={`${analytics.totalCustomers > 0 ? Math.round((analytics.vipCustomers / analytics.totalCustomers) * 100) : 0}% من الإجمالي`} changeType="positive" icon={Star} iconColor="bg-chart-4" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* City Distribution */}
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MapPin className="w-5 h-5 text-primary" />
              العملاء حسب المدينة
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={analytics.cityData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis type="category" dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={11} width={70} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v} عميل`, "العدد"]} />
                <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                  {analytics.cityData.map((_, i) => (<Cell key={i} fill={COLORS[i % COLORS.length]} />))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Customer Segments */}
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="w-5 h-5 text-success" />
              شرائح العملاء
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={analytics.segments} cx="50%" cy="50%" innerRadius={55} outerRadius={95} paddingAngle={4} dataKey="value" label={({ name, value }) => `${name} (${value})`}>
                  {analytics.segments.map((entry, i) => (<Cell key={i} fill={entry.fill} />))}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v} عميل`, "العدد"]} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Spenders */}
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Star className="w-5 h-5 text-chart-4" />
              أعلى العملاء إنفاقاً
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={analytics.topSpenders} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={11} tickFormatter={formatVal} />
                <YAxis type="category" dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={10} width={90} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number, name: string) => [name === "spent" ? `${v.toLocaleString()} ج.م` : `${v} طلب`, name === "spent" ? "الإنفاق" : "الطلبات"]} />
                <Bar dataKey="spent" radius={[0, 6, 6, 0]}>
                  {analytics.topSpenders.map((_, i) => (<Cell key={i} fill={COLORS[i % COLORS.length]} />))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Spending Distribution */}
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShoppingCart className="w-5 h-5 text-secondary" />
              توزيع مستويات الإنفاق
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={analytics.spendingDist}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v} عميل`, "العدد"]} />
                <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                  {analytics.spendingDist.map((_, i) => (<Cell key={i} fill={COLORS[i % COLORS.length]} />))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Registration trend */}
      {analytics.registrationTrend.length > 1 && (
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="w-5 h-5 text-primary" />
              تطور تسجيل العملاء الشهري
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={analytics.registrationTrend}>
                <defs>
                  <linearGradient id="custRegGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v} عميل`, "التسجيلات"]} />
                <Area type="monotone" dataKey="count" stroke="hsl(var(--primary))" fill="url(#custRegGrad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default CustomersAnalytics;
