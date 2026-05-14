import { useEffect, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { ChefHat, ShoppingBag, Users, Package, Boxes, Truck, FileText, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const tiles = [
  { to: "/catering/orders", icon: ShoppingBag, label: "الطلبات", color: "from-primary to-primary/70" },
  { to: "/catering/kitchen", icon: ChefHat, label: "المطبخ المركزي", color: "from-accent to-accent/70" },
  { to: "/catering/customers", icon: Users, label: "العملاء", color: "from-blue-500 to-blue-400" },
  { to: "/catering/products", icon: Package, label: "المنتجات والوصفات", color: "from-emerald-500 to-emerald-400" },
  { to: "/catering/raw-materials", icon: Boxes, label: "المواد الخام", color: "from-amber-500 to-amber-400" },
  { to: "/catering/suppliers", icon: Truck, label: "الموردون", color: "from-purple-500 to-purple-400" },
  { to: "/catering/purchases", icon: FileText, label: "أوامر الشراء", color: "from-rose-500 to-rose-400" },
  { to: "/catering/invoices", icon: FileText, label: "الفواتير", color: "from-cyan-500 to-cyan-400" },
];

const CateringDashboard = () => {
  const [stats, setStats] = useState({ orders: 0, products: 0, customers: 0, lowStock: 0 });

  useEffect(() => {
    (async () => {
      const today = new Date().toISOString().slice(0, 10);
      const [o, p, c, lm] = await Promise.all([
        supabase.from("catering_orders").select("id", { count: "exact", head: true }).gte("created_at", today),
        supabase.from("catering_products").select("id", { count: "exact", head: true }).eq("is_active", true),
        supabase.from("catering_customers").select("id", { count: "exact", head: true }),
        supabase.from("catering_raw_materials").select("id, stock, low_stock_threshold").eq("is_active", true),
      ]);
      const lowStock = (lm.data ?? []).filter((r) => Number(r.stock) <= Number(r.low_stock_threshold)).length;
      setStats({
        orders: o.count ?? 0,
        products: p.count ?? 0,
        customers: c.count ?? 0,
        lowStock,
      });
    })();
  }, []);

  return (
    <DashboardLayout>
      <Header title="Sugar in Space — لوحة التحكم" subtitle="نظام إدارة الكاترينج" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {[
          { label: "طلبات اليوم", value: stats.orders, icon: ShoppingBag },
          { label: "منتجات نشطة", value: stats.products, icon: Package },
          { label: "إجمالي العملاء", value: stats.customers, icon: Users },
          { label: "مواد منخفضة", value: stats.lowStock, icon: Boxes },
        ].map((s) => (
          <Card key={s.label} className="bg-gradient-to-br from-card to-card/50">
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{s.label}</p>
                <p className="text-3xl font-bold">{s.value}</p>
              </div>
              <s.icon className="w-10 h-10 text-primary/40" />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-accent" />
            وحدات النظام
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {tiles.map((t) => (
              <Link key={t.to} to={t.to}>
                <div className={`bg-gradient-to-br ${t.color} text-white rounded-xl p-5 hover:scale-105 transition-transform shadow-md`}>
                  <t.icon className="w-8 h-8 mb-2" />
                  <p className="font-bold">{t.label}</p>
                </div>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <Button asChild className="bg-gradient-to-r from-primary to-accent">
          <Link to="/catering/orders/new">+ طلب جديد</Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/catering/products">إدارة المنتجات</Link>
        </Button>
      </div>
    </DashboardLayout>
  );
};

export default CateringDashboard;
