import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { Wallet, TrendingUp, CheckCircle, AlertCircle, Calculator, ArrowLeft } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell, Legend } from "recharts";

interface OrderRow {
  id: string;
  total: number;
  payment_status: string;
  collection_status: string;
  status: string;
  created_at: string;
  delivered_at: string | null;
  payment_method: string;
}

interface ProductRow {
  id: string;
  name: string;
  price: number;
  cost_price: number | null;
}

const periods = [
  { value: "today", label: "اليوم" },
  { value: "week", label: "آخر 7 أيام" },
  { value: "month", label: "هذا الشهر" },
  { value: "quarter", label: "آخر 3 شهور" },
  { value: "year", label: "هذه السنة" },
  { value: "all", label: "كل الفترات" },
];

const getPeriodStart = (period: string): Date | null => {
  const now = new Date();
  const cairo = new Date(now.toLocaleString("en-US", { timeZone: "Africa/Cairo" }));
  switch (period) {
    case "today": {
      const d = new Date(cairo);
      d.setHours(0, 0, 0, 0);
      return d;
    }
    case "week": {
      const d = new Date(cairo);
      d.setDate(d.getDate() - 7);
      return d;
    }
    case "month":
      return new Date(Date.UTC(cairo.getFullYear(), cairo.getMonth(), 1));
    case "quarter": {
      const d = new Date(cairo);
      d.setMonth(d.getMonth() - 3);
      return d;
    }
    case "year":
      return new Date(Date.UTC(cairo.getFullYear(), 0, 1));
    default:
      return null;
  }
};

const COLORS = ["hsl(var(--success))", "hsl(var(--warning))", "hsl(var(--destructive))"];

const FinancialReports = () => {
  const [period, setPeriod] = useState("month");

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["financial-orders", period],
    queryFn: async () => {
      const start = getPeriodStart(period);
      let q = supabase
        .from("orders")
        .select("id,total,payment_status,collection_status,status,created_at,delivered_at,payment_method")
        .neq("status", "cancelled")
        .order("created_at", { ascending: false })
        .limit(5000);
      if (start) q = q.gte("created_at", start.toISOString());
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as OrderRow[];
    },
  });

  const { data: products = [] } = useQuery({
    queryKey: ["financial-products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name, price, cost_price")
        .eq("is_active", true);
      if (error) throw error;
      return (data || []) as ProductRow[];
    },
  });

  const stats = useMemo(() => {
    const totalRevenue = orders.reduce((s, o) => s + Number(o.total), 0);
    const collected = orders.filter((o) => o.collection_status === "collected");
    const notCollected = orders.filter((o) => o.collection_status !== "collected");
    const paid = orders.filter((o) => o.payment_status === "paid");
    const pending = orders.filter((o) => o.payment_status === "pending");
    const failed = orders.filter((o) => o.payment_status === "failed");
    const delivered = orders.filter((o) => o.status === "delivered");

    return {
      totalRevenue,
      ordersCount: orders.length,
      deliveredCount: delivered.length,
      collectedAmount: collected.reduce((s, o) => s + Number(o.total), 0),
      collectedCount: collected.length,
      notCollectedAmount: notCollected.reduce((s, o) => s + Number(o.total), 0),
      notCollectedCount: notCollected.length,
      paidAmount: paid.reduce((s, o) => s + Number(o.total), 0),
      pendingAmount: pending.reduce((s, o) => s + Number(o.total), 0),
      failedAmount: failed.reduce((s, o) => s + Number(o.total), 0),
      paidCount: paid.length,
      pendingCount: pending.length,
      failedCount: failed.length,
    };
  }, [orders]);

  const dailyData = useMemo(() => {
    const map = new Map<string, { date: string; collected: number; pending: number }>();
    orders.forEach((o) => {
      const d = new Date(o.created_at).toISOString().slice(0, 10);
      if (!map.has(d)) map.set(d, { date: d, collected: 0, pending: 0 });
      const row = map.get(d)!;
      if (o.collection_status === "collected") row.collected += Number(o.total);
      else row.pending += Number(o.total);
    });
    return Array.from(map.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-30);
  }, [orders]);

  const paymentPieData = [
    { name: "مدفوع", value: stats.paidAmount },
    { name: "قيد الانتظار", value: stats.pendingAmount },
    { name: "فشل", value: stats.failedAmount },
  ].filter((d) => d.value > 0);

  // Cost / profit derivation from products
  const costStats = useMemo(() => {
    const withCost = products.filter((p) => (p.cost_price ?? 0) > 0);
    const avgMargin =
      withCost.length > 0
        ? withCost.reduce((s, p) => s + ((p.price - (p.cost_price || 0)) / (p.cost_price || 1)) * 100, 0) /
          withCost.length
        : 0;
    return {
      total: products.length,
      priced: withCost.length,
      avgMargin,
    };
  }, [products]);

  const collectionRate = stats.ordersCount > 0 ? (stats.collectedCount / stats.ordersCount) * 100 : 0;

  return (
    <DashboardLayout>
      <Header
        title="التقارير المالية"
        subtitle="إجمالي التحصيل حسب الفترة وحالة الدفع"
      />

      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {periods.map((p) => (
              <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button asChild variant="outline" className="gap-2">
          <Link to="/product-costs">
            <Calculator className="w-4 h-4" />
            صفحة تكاليف المنتجات وهامش الربح
            <ArrowLeft className="w-4 h-4" />
          </Link>
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Card className="glass-card">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs"><Wallet className="w-4 h-4" /> إجمالي قيمة الطلبات</div>
            <div className="text-2xl font-bold mt-1">{stats.totalRevenue.toLocaleString()} ج</div>
            <div className="text-xs text-muted-foreground mt-1">{stats.ordersCount} طلب</div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-success text-xs"><CheckCircle className="w-4 h-4" /> تم التحصيل</div>
            <div className="text-2xl font-bold mt-1 text-success">{stats.collectedAmount.toLocaleString()} ج</div>
            <div className="text-xs text-muted-foreground mt-1">{stats.collectedCount} طلب • {collectionRate.toFixed(1)}%</div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-warning text-xs"><AlertCircle className="w-4 h-4" /> لم يتم التحصيل</div>
            <div className="text-2xl font-bold mt-1 text-warning">{stats.notCollectedAmount.toLocaleString()} ج</div>
            <div className="text-xs text-muted-foreground mt-1">{stats.notCollectedCount} طلب</div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-primary text-xs"><TrendingUp className="w-4 h-4" /> متوسط هامش الربح</div>
            <div className="text-2xl font-bold mt-1 text-primary">{costStats.avgMargin.toFixed(1)}%</div>
            <div className="text-xs text-muted-foreground mt-1">{costStats.priced}/{costStats.total} منتج مُسعَّر</div>
          </CardContent>
        </Card>
      </div>

      {/* Payment status breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-base">التحصيل اليومي (آخر 30 يوم)</CardTitle>
          </CardHeader>
          <CardContent className="h-80">
            {isLoading ? (
              <div className="text-center text-muted-foreground py-10">جارٍ التحميل...</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailyData}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="collected" stackId="a" fill="hsl(var(--success))" name="تم التحصيل" />
                  <Bar dataKey="pending" stackId="a" fill="hsl(var(--warning))" name="لم يتم التحصيل" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-base">توزيع حالات الدفع</CardTitle>
          </CardHeader>
          <CardContent className="h-80">
            {paymentPieData.length === 0 ? (
              <div className="text-center text-muted-foreground py-10">لا توجد بيانات</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={paymentPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label>
                    {paymentPieData.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => `${v.toLocaleString()} ج`} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Detailed payment table */}
      <Card className="glass-card mb-4">
        <CardHeader>
          <CardTitle className="text-base">تفصيل حسب حالة الدفع</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded-lg border p-4">
            <Badge className="bg-success text-success-foreground mb-2">مدفوع</Badge>
            <div className="text-2xl font-bold">{stats.paidAmount.toLocaleString()} ج</div>
            <div className="text-sm text-muted-foreground">{stats.paidCount} طلب</div>
          </div>
          <div className="rounded-lg border p-4">
            <Badge className="bg-warning text-warning-foreground mb-2">قيد الانتظار</Badge>
            <div className="text-2xl font-bold">{stats.pendingAmount.toLocaleString()} ج</div>
            <div className="text-sm text-muted-foreground">{stats.pendingCount} طلب</div>
          </div>
          <div className="rounded-lg border p-4">
            <Badge className="bg-destructive text-destructive-foreground mb-2">فشل</Badge>
            <div className="text-2xl font-bold">{stats.failedAmount.toLocaleString()} ج</div>
            <div className="text-sm text-muted-foreground">{stats.failedCount} طلب</div>
          </div>
        </CardContent>
      </Card>
    </DashboardLayout>
  );
};

export default FinancialReports;
