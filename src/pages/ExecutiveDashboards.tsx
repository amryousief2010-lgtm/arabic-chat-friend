import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import StatCard from "@/components/dashboard/StatCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import {
  TrendingUp, DollarSign, Wallet, Truck, AlertTriangle, ShoppingCart,
  Target, Users, Package, Crown, Boxes, CheckCircle, XCircle, Clock,
  Megaphone, Building2, Repeat,
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, BarChart, Bar, Legend,
} from "recharts";

interface OrderRow {
  id: string;
  customer_id: string | null;
  status: string;
  payment_method: string;
  payment_status: string;
  collection_status: string;
  total: number;
  total_at_delivery: number | null;
  subtotal: number;
  delivery_fee: number;
  discount: number;
  delivered_at: string | null;
  created_at: string;
  source: string | null;
  shipping_company: string | null;
  moderator: string | null;
}

interface OrderItemRow {
  order_id: string;
  product_id: string | null;
  product_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
}

interface ProductRow {
  id: string;
  name: string;
  price: number;
  cost_price: number;
  stock: number;
  low_stock_threshold: number;
  category: string | null;
}

interface CustomerRow {
  id: string;
  name: string;
  city: string | null;
  total_orders: number;
  total_spent: number;
}

const PAGE = 1000;

async function fetchAll<T = any>(table: string, select = "*") {
  // Get total count first, then fetch all pages in parallel for speed.
  const { count, error: cErr } = await supabase.from(table as any).select("*", { count: "exact", head: true });
  if (cErr) throw cErr;
  const total = count || 0;
  if (total === 0) return [] as T[];
  const pages = Math.ceil(total / PAGE);
  const results = await Promise.all(
    Array.from({ length: pages }, (_, i) =>
      supabase.from(table as any).select(select).range(i * PAGE, i * PAGE + PAGE - 1)
        .then(r => { if (r.error) throw r.error; return (r.data || []) as T[]; })
    )
  );
  return results.flat();
}

const fmt = (n: number) => new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 0 }).format(Math.round(n || 0));
const fmtMoney = (n: number) => `${fmt(n)} ر.س`;
const pct = (n: number, d: number) => (d > 0 ? ((n / d) * 100).toFixed(1) + "%" : "—");

const COLORS = ["hsl(var(--primary))", "hsl(var(--secondary))", "hsl(var(--success))", "hsl(var(--warning))", "hsl(var(--destructive))", "hsl(var(--muted))"];

const statusLabels: Record<string, string> = {
  pending: "قيد الانتظار", processing: "قيد التجهيز", shipped: "تم الشحن",
  delivered: "تم التسليم", cancelled: "ملغي",
};

const ExecutiveDashboards = () => {
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [items, setItems] = useState<OrderItemRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [mismatchCount, setMismatchCount] = useState(0);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        // Load lighter datasets first so the UI renders fast; items load in the background.
        const [o, p, c, n] = await Promise.all([
          fetchAll<OrderRow>("orders", "id,customer_id,status,payment_method,payment_status,collection_status,total,total_at_delivery,subtotal,delivery_fee,discount,delivered_at,created_at,source,shipping_company,moderator"),
          fetchAll<ProductRow>("products", "id,name,price,cost_price,stock,low_stock_threshold,category"),
          fetchAll<CustomerRow>("customers", "id,name,city,total_orders,total_spent"),
          supabase.from("notifications").select("id", { count: "exact", head: true }).eq("type", "collection_mismatch"),
        ]);
        setOrders(o); setProducts(p); setCustomers(c);
        setMismatchCount(n.count || 0);
        setLoading(false);
        // Load order_items in background (large table) — used for profit & product panels only.
        try {
          const it = await fetchAll<OrderItemRow>("order_items", "order_id,product_id,product_name,quantity,unit_price,total_price");
          setItems(it);
        } catch (e) {
          console.error("order_items load failed", e);
        }
      } catch (e) {
        console.error(e);
        setLoading(false);
      }
    })();
  }, []);

  const productMap = useMemo(() => Object.fromEntries(products.map(p => [p.id, p])), [products]);

  // ===== KPIs =====
  const valid = useMemo(() => orders.filter(o => o.status !== "cancelled"), [orders]);
  const totalSales = useMemo(() => valid.reduce((s, o) => s + Number(o.total || 0), 0), [valid]);
  const totalOrders = valid.length;
  const cancelled = orders.length - valid.length;
  const delivered = valid.filter(o => o.status === "delivered");
  const collectedAmount = delivered.filter(o => o.collection_status === "collected").reduce((s, o) => s + Number(o.total || 0), 0);
  const uncollectedAmount = delivered.filter(o => o.collection_status !== "collected").reduce((s, o) => s + Number(o.total || 0), 0);
  const aov = totalOrders > 0 ? totalSales / totalOrders : 0;

  const profit = useMemo(() => {
    let sum = 0;
    const validIds = new Set(valid.map(o => o.id));
    for (const it of items) {
      if (!validIds.has(it.order_id)) continue;
      const cost = it.product_id ? Number(productMap[it.product_id]?.cost_price || 0) : 0;
      sum += (Number(it.unit_price) - cost) * Number(it.quantity);
    }
    return sum;
  }, [items, valid, productMap]);

  // monthly trend (last 12 months)
  const monthly = useMemo(() => {
    const map = new Map<string, { month: string; sales: number; orders: number; profit: number }>();
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      map.set(k, { month: k, sales: 0, orders: 0, profit: 0 });
    }
    const itemsByOrder = new Map<string, OrderItemRow[]>();
    for (const it of items) {
      if (!itemsByOrder.has(it.order_id)) itemsByOrder.set(it.order_id, []);
      itemsByOrder.get(it.order_id)!.push(it);
    }
    for (const o of valid) {
      const d = new Date(o.created_at);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const row = map.get(k);
      if (!row) continue;
      row.sales += Number(o.total || 0);
      row.orders += 1;
      const its = itemsByOrder.get(o.id) || [];
      for (const it of its) {
        const cost = it.product_id ? Number(productMap[it.product_id]?.cost_price || 0) : 0;
        row.profit += (Number(it.unit_price) - cost) * Number(it.quantity);
      }
    }
    return Array.from(map.values());
  }, [valid, items, productMap]);

  // Marketing: by source
  const bySource = useMemo(() => {
    const map = new Map<string, { name: string; orders: number; sales: number }>();
    for (const o of valid) {
      const src = o.source || "غير محدد";
      const r = map.get(src) || { name: src, orders: 0, sales: 0 };
      r.orders += 1; r.sales += Number(o.total || 0);
      map.set(src, r);
    }
    return Array.from(map.values()).sort((a, b) => b.sales - a.sales);
  }, [valid]);

  // Sales: by moderator
  const byModerator = useMemo(() => {
    const map = new Map<string, { name: string; orders: number; sales: number; delivered: number; cancelled: number }>();
    for (const o of orders) {
      const m = o.moderator || "غير محدد";
      const r = map.get(m) || { name: m, orders: 0, sales: 0, delivered: 0, cancelled: 0 };
      r.orders += 1;
      if (o.status !== "cancelled") r.sales += Number(o.total || 0);
      if (o.status === "delivered") r.delivered += 1;
      if (o.status === "cancelled") r.cancelled += 1;
      map.set(m, r);
    }
    return Array.from(map.values()).sort((a, b) => b.sales - a.sales).slice(0, 10);
  }, [orders]);

  // Operations: by status
  const byStatus = useMemo(() => {
    const map = new Map<string, number>();
    for (const o of orders) map.set(o.status, (map.get(o.status) || 0) + 1);
    return Array.from(map.entries()).map(([k, v]) => ({ name: statusLabels[k] || k, value: v }));
  }, [orders]);

  const avgDeliveryDays = useMemo(() => {
    const ds = delivered.filter(o => o.delivered_at).map(o => {
      const c = new Date(o.created_at).getTime();
      const d = new Date(o.delivered_at!).getTime();
      return (d - c) / (1000 * 60 * 60 * 24);
    });
    return ds.length > 0 ? ds.reduce((a, b) => a + b, 0) / ds.length : 0;
  }, [delivered]);

  const lowStock = useMemo(() => products.filter(p => p.stock <= p.low_stock_threshold && p.stock >= 0), [products]);

  const byShipping = useMemo(() => {
    const map = new Map<string, number>();
    for (const o of orders) {
      const s = o.shipping_company || "غير محدد";
      map.set(s, (map.get(s) || 0) + 1);
    }
    return Array.from(map.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [orders]);

  // Finance: payment methods
  const byPayment = useMemo(() => {
    const map = new Map<string, { name: string; amount: number; count: number }>();
    for (const o of valid) {
      const m = o.payment_method === "cash" ? "نقداً عند الاستلام" : o.payment_method === "online" ? "أونلاين" : o.payment_method;
      const r = map.get(m) || { name: m, amount: 0, count: 0 };
      r.amount += Number(o.total || 0); r.count += 1;
      map.set(m, r);
    }
    return Array.from(map.values());
  }, [valid]);

  // Customer: repeat purchase
  const repeatRate = useMemo(() => {
    const repeat = customers.filter(c => c.total_orders > 1).length;
    return customers.length > 0 ? (repeat / customers.length) * 100 : 0;
  }, [customers]);

  const vipCustomers = useMemo(() => [...customers].sort((a, b) => b.total_spent - a.total_spent).slice(0, 10), [customers]);

  const byCity = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of customers) {
      const city = c.city || "غير محدد";
      map.set(city, (map.get(city) || 0) + 1);
    }
    return Array.from(map.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 8);
  }, [customers]);

  // Product analytics
  const productStats = useMemo(() => {
    const map = new Map<string, { id: string; name: string; qty: number; revenue: number; profit: number; stock: number }>();
    const validIds = new Set(valid.map(o => o.id));
    for (const it of items) {
      if (!validIds.has(it.order_id)) continue;
      const id = it.product_id || it.product_name;
      const p = it.product_id ? productMap[it.product_id] : undefined;
      const cost = p ? Number(p.cost_price || 0) : 0;
      const r = map.get(id) || { id, name: it.product_name, qty: 0, revenue: 0, profit: 0, stock: p?.stock || 0 };
      r.qty += Number(it.quantity);
      r.revenue += Number(it.total_price);
      r.profit += (Number(it.unit_price) - cost) * Number(it.quantity);
      map.set(id, r);
    }
    return Array.from(map.values()).sort((a, b) => b.profit - a.profit);
  }, [items, valid, productMap]);

  if (loading) {
    return (
      <DashboardLayout>
        <Header title="لوحات التحكم التنفيذية" subtitle="نظرة شاملة على أداء الشركة" />
        <div className="text-center py-12 text-muted-foreground">جاري تحميل البيانات...</div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <Header title="لوحات التحكم التنفيذية" subtitle="نظرة شاملة على أداء الشركة بحسب القسم" />

      <Tabs defaultValue="ceo" className="space-y-4">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="ceo">CEO</TabsTrigger>
          <TabsTrigger value="marketing">التسويق</TabsTrigger>
          <TabsTrigger value="sales">المبيعات</TabsTrigger>
          <TabsTrigger value="operations">العمليات</TabsTrigger>
          <TabsTrigger value="finance">المالية</TabsTrigger>
          <TabsTrigger value="customer">العملاء</TabsTrigger>
          <TabsTrigger value="product">المنتجات</TabsTrigger>
        </TabsList>

        {/* ============ CEO ============ */}
        <TabsContent value="ceo" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard title="إجمالي المبيعات" value={fmtMoney(totalSales)} icon={DollarSign} iconColor="bg-primary" />
            <StatCard title="إجمالي الربح" value={fmtMoney(profit)} icon={TrendingUp} iconColor="bg-success" />
            <StatCard title="نسبة التحصيل" value={pct(collectedAmount, collectedAmount + uncollectedAmount)} icon={Wallet} iconColor="bg-secondary" />
            <StatCard title="عدد الأوردرات" value={fmt(totalOrders)} icon={ShoppingCart} iconColor="bg-chart-4" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatCard title="تم الشحن/التسليم" value={fmt(delivered.length + orders.filter(o => o.status === "shipped").length)} icon={Truck} iconColor="bg-chart-3" />
            <StatCard title="المشاكل (ملغي + اختلاف تحصيل)" value={fmt(cancelled + mismatchCount)} icon={AlertTriangle} iconColor="bg-destructive" />
            <StatCard title="متوسط قيمة الأوردر (AOV)" value={fmtMoney(aov)} icon={Target} iconColor="bg-warning" />
          </div>
          <Card className="glass-card">
            <CardHeader><CardTitle>اتجاه المبيعات والربح (آخر 12 شهر)</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={monthly}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" />
                  <YAxis stroke="hsl(var(--muted-foreground))" />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                  <Legend />
                  <Line type="monotone" dataKey="sales" name="المبيعات" stroke="hsl(var(--primary))" strokeWidth={2} />
                  <Line type="monotone" dataKey="profit" name="الربح" stroke="hsl(var(--success))" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============ Marketing ============ */}
        <TabsContent value="marketing" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatCard title="عدد المصادر" value={fmt(bySource.length)} icon={Megaphone} iconColor="bg-primary" />
            <StatCard title="معدل التحويل (تم التسليم)" value={pct(delivered.length, totalOrders)} icon={CheckCircle} iconColor="bg-success" />
            <StatCard title="متوسط قيمة الأوردر" value={fmtMoney(aov)} icon={Target} iconColor="bg-warning" />
          </div>
          <Card className="glass-card">
            <CardHeader><CardTitle>الأوردرات والمبيعات بحسب المصدر</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={bySource}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" />
                  <YAxis stroke="hsl(var(--muted-foreground))" />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                  <Legend />
                  <Bar dataKey="orders" name="عدد الأوردرات" fill="hsl(var(--primary))" />
                  <Bar dataKey="sales" name="المبيعات" fill="hsl(var(--secondary))" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card className="glass-card">
            <CardContent className="pt-6 text-xs text-muted-foreground">
              ملاحظة: مؤشرات CAC / ROAS / CPL / CPA تتطلب إدخال تكاليف الحملات الإعلانية. يمكن إضافة جدول مصاريف تسويق لتفعيلها.
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============ Sales ============ */}
        <TabsContent value="sales" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <StatCard title="معدل الفوز (Win Rate)" value={pct(delivered.length, delivered.length + cancelled)} icon={CheckCircle} iconColor="bg-success" />
            <StatCard title="معدل التحويل" value={pct(delivered.length, totalOrders)} icon={Target} iconColor="bg-primary" />
            <StatCard title="متوسط قيمة الأوردر" value={fmtMoney(aov)} icon={DollarSign} iconColor="bg-warning" />
            <StatCard title="ملغي" value={fmt(cancelled)} icon={XCircle} iconColor="bg-destructive" />
          </div>
          <Card className="glass-card">
            <CardHeader><CardTitle>أداء المسوّقات (Top 10)</CardTitle></CardHeader>
            <CardContent className="overflow-auto">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground">
                  <tr className="border-b">
                    <th className="text-right p-2">المسوّقة</th>
                    <th className="text-right p-2">الأوردرات</th>
                    <th className="text-right p-2">المبيعات</th>
                    <th className="text-right p-2">تم التسليم</th>
                    <th className="text-right p-2">ملغي</th>
                    <th className="text-right p-2">Win Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {byModerator.map((m) => (
                    <tr key={m.name} className="border-b hover:bg-muted/30">
                      <td className="p-2 font-medium">{m.name}</td>
                      <td className="p-2">{fmt(m.orders)}</td>
                      <td className="p-2">{fmtMoney(m.sales)}</td>
                      <td className="p-2 text-success">{fmt(m.delivered)}</td>
                      <td className="p-2 text-destructive">{fmt(m.cancelled)}</td>
                      <td className="p-2">{pct(m.delivered, m.delivered + m.cancelled)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============ Operations ============ */}
        <TabsContent value="operations" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <StatCard title="قيد التجهيز" value={fmt(orders.filter(o => o.status === "processing").length)} icon={Clock} iconColor="bg-warning" />
            <StatCard title="تم الشحن" value={fmt(orders.filter(o => o.status === "shipped").length)} icon={Truck} iconColor="bg-chart-4" />
            <StatCard title="تم التسليم" value={fmt(delivered.length)} icon={CheckCircle} iconColor="bg-success" />
            <StatCard title="مخزون منخفض" value={fmt(lowStock.length)} icon={Boxes} iconColor="bg-destructive" />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="glass-card">
              <CardHeader><CardTitle>توزيع الأوردرات بحسب الحالة</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={byStatus} dataKey="value" nameKey="name" outerRadius={100} label>
                      {byStatus.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card className="glass-card">
              <CardHeader><CardTitle>الأوردرات بحسب شركة الشحن</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={byShipping}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" />
                    <YAxis stroke="hsl(var(--muted-foreground))" />
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                    <Bar dataKey="value" name="عدد الأوردرات" fill="hsl(var(--secondary))" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
          <Card className="glass-card">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">متوسط مدة التسليم (أيام)</span>
                <Badge variant="outline" className="text-base">{avgDeliveryDays.toFixed(1)} يوم</Badge>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============ Finance ============ */}
        <TabsContent value="finance" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <StatCard title="إجمالي المحصّل" value={fmtMoney(collectedAmount)} icon={Wallet} iconColor="bg-success" />
            <StatCard title="غير محصّل" value={fmtMoney(uncollectedAmount)} icon={AlertTriangle} iconColor="bg-warning" />
            <StatCard title="فروقات تحصيل" value={fmt(mismatchCount)} icon={AlertTriangle} iconColor="bg-destructive" />
            <StatCard title="إجمالي الربح" value={fmtMoney(profit)} icon={TrendingUp} iconColor="bg-primary" />
          </div>
          <Card className="glass-card">
            <CardHeader><CardTitle>توزيع المبيعات بحسب طريقة الدفع</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={byPayment} dataKey="amount" nameKey="name" outerRadius={100} label>
                    {byPayment.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} formatter={(v: any) => fmtMoney(Number(v))} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============ Customer ============ */}
        <TabsContent value="customer" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatCard title="إجمالي العملاء" value={fmt(customers.length)} icon={Users} iconColor="bg-primary" />
            <StatCard title="معدل تكرار الشراء" value={`${repeatRate.toFixed(1)}%`} icon={Repeat} iconColor="bg-secondary" />
            <StatCard title="عملاء VIP (Top 10)" value={fmt(vipCustomers.length)} icon={Crown} iconColor="bg-warning" />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="glass-card">
              <CardHeader><CardTitle><Crown className="inline w-4 h-4" /> أفضل العملاء (VIP)</CardTitle></CardHeader>
              <CardContent className="overflow-auto">
                <table className="w-full text-sm">
                  <thead className="text-muted-foreground">
                    <tr className="border-b">
                      <th className="text-right p-2">العميل</th>
                      <th className="text-right p-2">الأوردرات</th>
                      <th className="text-right p-2">إجمالي الإنفاق</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vipCustomers.map((c) => (
                      <tr key={c.id} className="border-b hover:bg-muted/30">
                        <td className="p-2 font-medium">{c.name}</td>
                        <td className="p-2">{fmt(c.total_orders)}</td>
                        <td className="p-2 text-success">{fmtMoney(c.total_spent)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
            <Card className="glass-card">
              <CardHeader><CardTitle><Building2 className="inline w-4 h-4" /> توزيع العملاء بحسب المدينة</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={byCity}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" />
                    <YAxis stroke="hsl(var(--muted-foreground))" />
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                    <Bar dataKey="value" name="عدد العملاء" fill="hsl(var(--primary))" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ============ Product ============ */}
        <TabsContent value="product" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatCard title="عدد المنتجات" value={fmt(products.length)} icon={Package} iconColor="bg-primary" />
            <StatCard title="مخزون منخفض" value={fmt(lowStock.length)} icon={AlertTriangle} iconColor="bg-destructive" />
            <StatCard title="إجمالي ربح المنتجات" value={fmtMoney(profit)} icon={TrendingUp} iconColor="bg-success" />
          </div>
          <Card className="glass-card">
            <CardHeader><CardTitle>أفضل المنتجات بحسب الربحية ودوران المخزون</CardTitle></CardHeader>
            <CardContent className="overflow-auto">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground">
                  <tr className="border-b">
                    <th className="text-right p-2">المنتج</th>
                    <th className="text-right p-2">الكمية المباعة</th>
                    <th className="text-right p-2">الإيرادات</th>
                    <th className="text-right p-2">الربح</th>
                    <th className="text-right p-2">المخزون الحالي</th>
                  </tr>
                </thead>
                <tbody>
                  {productStats.slice(0, 20).map((p) => (
                    <tr key={p.id} className="border-b hover:bg-muted/30">
                      <td className="p-2 font-medium">{p.name}</td>
                      <td className="p-2">{fmt(p.qty)}</td>
                      <td className="p-2">{fmtMoney(p.revenue)}</td>
                      <td className="p-2 text-success">{fmtMoney(p.profit)}</td>
                      <td className="p-2">
                        {p.stock <= (productMap[p.id]?.low_stock_threshold || 10)
                          ? <Badge variant="destructive">{fmt(p.stock)}</Badge>
                          : fmt(p.stock)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </DashboardLayout>
  );
};

export default ExecutiveDashboards;
