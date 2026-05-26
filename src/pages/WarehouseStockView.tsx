import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Search, RefreshCw, Warehouse, Printer } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { printWarehouseStock } from "@/lib/printUtils";

interface Product { id: string; name: string; unit: string; category?: string | null; }

const WarehouseStockView = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [agouzaStock, setAgouzaStock] = useState<Record<string, number>>({});
  const [mainStock, setMainStock] = useState<Record<string, number>>({});
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [pRes, wRes] = await Promise.all([
        supabase.from("products").select("id, name, unit, category").eq("is_active", true).order("name"),
        supabase.from("warehouses").select("id, name").eq("is_active", true),
      ]);
      setProducts((pRes.data || []) as Product[]);
      const whs = wRes.data || [];
      const agouza = whs.find((w: any) => w.name?.includes("العجوزة"));
      const main = whs.find((w: any) => w.name?.includes("الرئيسي") || w.name?.includes("المقر"));
      const whIds = [agouza?.id, main?.id].filter(Boolean) as string[];
      if (whIds.length > 0) {
        const { data: invRows } = await supabase
          .from("inventory_items")
          .select("warehouse_id, product_id, stock, reserved_qty, blocked_qty")
          .in("warehouse_id", whIds)
          .not("product_id", "is", null);
        const ag: Record<string, number> = {};
        const mn: Record<string, number> = {};
        (invRows || []).forEach((r: any) => {
          const avail = Number(r.stock || 0) - Number(r.reserved_qty || 0) - Number(r.blocked_qty || 0);
          if (r.warehouse_id === agouza?.id) ag[r.product_id] = (ag[r.product_id] || 0) + avail;
          if (r.warehouse_id === main?.id) mn[r.product_id] = (mn[r.product_id] || 0) + avail;
        });
        setAgouzaStock(ag);
        setMainStock(mn);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim();
    if (!q) return products;
    return products.filter(p => p.name?.includes(q) || p.category?.includes(q));
  }, [products, search]);

  return (
    <DashboardLayout>
      <Header title="المتاح في المخازن" subtitle="رؤية لحظية للكميات المتاحة في مخزن العجوزة والمخزن الرئيسي" />

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <CardTitle className="flex items-center gap-2">
              <Warehouse className="w-5 h-5 text-primary" />
              المنتجات والكميات المتاحة
            </CardTitle>
            <div className="flex gap-2 items-center">
              <div className="relative flex-1 sm:w-64">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="بحث باسم المنتج..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pr-9"
                />
              </div>
              <Button size="sm" variant="outline" onClick={fetchAll} disabled={loading}>
                <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Desktop table */}
          <div className="hidden md:block border rounded-lg overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-muted/60 text-xs">
                <tr>
                  <th className="p-2 font-semibold">المنتج</th>
                  <th className="p-2 font-semibold">الوحدة</th>
                  <th className="p-2 font-semibold whitespace-nowrap">مخزن العجوزة</th>
                  <th className="p-2 font-semibold whitespace-nowrap">المخزن الرئيسي</th>
                  <th className="p-2 font-semibold whitespace-nowrap">الإجمالي المتاح</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const a = agouzaStock[p.id] ?? 0;
                  const m = mainStock[p.id] ?? 0;
                  return (
                    <tr key={p.id} className="border-t hover:bg-muted/30">
                      <td className="p-2 font-bold text-green-600 dark:text-green-400">{p.name}</td>
                      <td className="p-2 text-muted-foreground">{p.unit}</td>
                      <td className="p-2">
                        <Badge variant={a <= 0 ? "destructive" : "outline"}>{a}</Badge>
                      </td>
                      <td className="p-2">
                        <Badge variant={m <= 0 ? "destructive" : "outline"}>{m}</Badge>
                      </td>
                      <td className="p-2 font-bold text-primary">{a + m}</td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">لا توجد منتجات</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {filtered.map((p) => {
              const a = agouzaStock[p.id] ?? 0;
              const m = mainStock[p.id] ?? 0;
              return (
                <div key={p.id} className="border rounded-lg p-3 bg-card">
                  <div className="font-bold text-green-600 dark:text-green-400 mb-1">{p.name}</div>
                  <div className="text-xs text-muted-foreground mb-2">{p.unit}</div>
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div>
                      <div className="text-muted-foreground mb-1">العجوزة</div>
                      <Badge variant={a <= 0 ? "destructive" : "outline"}>{a}</Badge>
                    </div>
                    <div>
                      <div className="text-muted-foreground mb-1">الرئيسي</div>
                      <Badge variant={m <= 0 ? "destructive" : "outline"}>{m}</Badge>
                    </div>
                    <div>
                      <div className="text-muted-foreground mb-1">الإجمالي</div>
                      <Badge className="bg-primary">{a + m}</Badge>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </DashboardLayout>
  );
};

export default WarehouseStockView;
