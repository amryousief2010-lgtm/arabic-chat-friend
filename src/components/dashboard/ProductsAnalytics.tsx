import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import StatCard from "@/components/dashboard/StatCard";
import { Package, AlertTriangle, DollarSign, BarChart3, Layers } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, RadialBarChart, RadialBar,
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

interface Product {
  id: string;
  name: string;
  category: string | null;
  price: number;
  stock: number;
  is_active: boolean;
  low_stock_threshold?: number;
}

interface ProductsAnalyticsProps {
  products: Product[];
}

const ProductsAnalytics = ({ products }: ProductsAnalyticsProps) => {
  const analytics = useMemo(() => {
    const totalProducts = products.length;
    const activeProducts = products.filter(p => p.is_active).length;
    const totalStock = products.reduce((s, p) => s + p.stock, 0);
    const lowStock = products.filter(p => p.stock <= (p.low_stock_threshold || 10)).length;
    const outOfStock = products.filter(p => p.stock === 0).length;
    const avgPrice = totalProducts > 0 ? Math.round(products.reduce((s, p) => s + p.price, 0) / totalProducts) : 0;
    const totalValue = products.reduce((s, p) => s + (p.price * p.stock), 0);

    // Category distribution
    const catMap: Record<string, { count: number; stock: number; value: number }> = {};
    products.forEach(p => {
      const cat = p.category || "بدون تصنيف";
      if (!catMap[cat]) catMap[cat] = { count: 0, stock: 0, value: 0 };
      catMap[cat].count++;
      catMap[cat].stock += p.stock;
      catMap[cat].value += p.price * p.stock;
    });
    const categoryData = Object.entries(catMap).map(([name, data]) => ({ name, ...data }));

    // Price distribution
    const priceRanges = [
      { label: "0-100", min: 0, max: 100 },
      { label: "100-300", min: 100, max: 300 },
      { label: "300-500", min: 300, max: 500 },
      { label: "500+", min: 500, max: Infinity },
    ];
    const priceData = priceRanges.map(r => ({
      name: `${r.label} ج.م`,
      count: products.filter(p => p.price >= r.min && p.price < r.max).length,
    }));

    // Top products by stock value
    const topByValue = [...products]
      .map(p => ({ name: p.name, value: p.price * p.stock }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);

    // Stock health
    const stockHealth = [
      { name: "مخزون جيد", value: totalProducts - lowStock, fill: "hsl(var(--success))" },
      { name: "مخزون منخفض", value: lowStock - outOfStock, fill: "hsl(var(--warning))" },
      { name: "نفد المخزون", value: outOfStock, fill: "hsl(var(--destructive))" },
    ].filter(d => d.value > 0);

    return {
      totalProducts, activeProducts, totalStock, lowStock, outOfStock,
      avgPrice, totalValue, categoryData, priceData, topByValue, stockHealth,
    };
  }, [products]);

  const formatVal = (v: number) => {
    if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
    if (v >= 1000) return `${(v / 1000).toFixed(0)}K`;
    return String(v);
  };

  return (
    <div className="space-y-6 mb-8">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="إجمالي المنتجات" value={analytics.totalProducts} change={`${analytics.activeProducts} نشط`} changeType="positive" icon={Package} iconColor="bg-primary" />
        <StatCard title="إجمالي المخزون" value={analytics.totalStock.toLocaleString()} change={`${analytics.categoryData.length} تصنيف`} changeType="positive" icon={Layers} iconColor="bg-secondary" />
        <StatCard title="قيمة المخزون" value={`${formatVal(analytics.totalValue)} ج.م`} change={`متوسط: ${analytics.avgPrice} ج.م`} changeType="positive" icon={DollarSign} iconColor="bg-success" />
        <StatCard title="مخزون منخفض" value={analytics.lowStock} change={`${analytics.outOfStock} نفد`} changeType={analytics.lowStock > 0 ? "negative" : "positive"} icon={AlertTriangle} iconColor="bg-destructive" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Category Distribution */}
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="w-5 h-5 text-primary" />
              المنتجات حسب التصنيف
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={analytics.categoryData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number, name: string) => [name === "count" ? `${v} منتج` : `${v} وحدة`, name === "count" ? "العدد" : "المخزون"]} />
                <Bar dataKey="count" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} name="count" />
                <Bar dataKey="stock" fill="hsl(var(--success))" radius={[6, 6, 0, 0]} name="stock" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Stock Health */}
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="w-5 h-5 text-warning" />
              صحة المخزون
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={analytics.stockHealth} cx="50%" cy="50%" innerRadius={55} outerRadius={95} paddingAngle={4} dataKey="value" label={({ name, value }) => `${name} (${value})`}>
                  {analytics.stockHealth.map((entry, i) => (<Cell key={i} fill={entry.fill} />))}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v} منتج`, "العدد"]} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Price Distribution */}
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <DollarSign className="w-5 h-5 text-success" />
              توزيع الأسعار
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={analytics.priceData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v} منتج`, "العدد"]} />
                <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                  {analytics.priceData.map((_, i) => (<Cell key={i} fill={COLORS[i % COLORS.length]} />))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Top by value */}
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Package className="w-5 h-5 text-chart-4" />
              أعلى المنتجات قيمة مخزنية
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={analytics.topByValue} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={11} tickFormatter={formatVal} />
                <YAxis type="category" dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={10} width={80} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v.toLocaleString()} ج.م`, "القيمة"]} />
                <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                  {analytics.topByValue.map((_, i) => (<Cell key={i} fill={COLORS[i % COLORS.length]} />))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default ProductsAnalytics;
