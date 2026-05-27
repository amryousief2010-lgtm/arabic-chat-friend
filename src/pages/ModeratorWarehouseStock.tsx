import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRight, Printer, RefreshCw, Search, Warehouse } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { printWarehouseStock } from "@/lib/printUtils";
import {
  MODERATORS,
  findModeratorBySlug,
  isOrderForModerator,
} from "@/constants/moderators";

interface Product {
  id: string;
  name: string;
  unit: string;
  category?: string | null;
}

// Per-moderator warehouse stock view: shows the "available in warehouses"
// table restricted to the products that appear in the selected moderator's
// orders for the active month (defaults to May 2026 per product spec).
const ModeratorWarehouseStock = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const moderator = findModeratorBySlug(slug);
  if (!moderator) return <Navigate to="/warehouse-stock" replace />;

  const [products, setProducts] = useState<Product[]>([]);
  const [agouzaStock, setAgouzaStock] = useState<Record<string, number>>({});
  const [mainStock, setMainStock] = useState<Record<string, number>>({});
  const [moderatorProductIds, setModeratorProductIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  // Use the same UTC boundary convention as the rest of the app — May 2026.
  const range = useMemo(() => {
    const from = new Date(Date.UTC(2026, 4, 1, 0, 0, 0));
    const to = new Date(Date.UTC(2026, 5, 1, 0, 0, 0));
    return { from, to };
  }, []);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [pRes, wRes, oRes] = await Promise.all([
        supabase.from("products").select("id, name, unit, category").eq("is_active", true).order("name"),
        supabase.from("warehouses").select("id, name").eq("is_active", true),
        supabase
          .from("orders")
          .select("id, moderator, created_by")
          .gte("created_at", range.from.toISOString())
          .lt("created_at", range.to.toISOString()),
      ]);

      setProducts((pRes.data || []) as Product[]);

      // Resolve creator profile names to match historical attributions.
      const userIds = Array.from(
        new Set((oRes.data || []).map((o: any) => o.created_by).filter(Boolean)),
      ) as string[];
      let profileMap = new Map<string, string>();
      if (userIds.length) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", userIds);
        profileMap = new Map((profiles || []).map((p: any) => [p.id, p.full_name as string]));
      }
      const moderatorOrderIds = (oRes.data || [])
        .filter((o: any) =>
          isOrderForModerator(
            moderator,
            o.moderator,
            o.created_by ? profileMap.get(o.created_by) || null : null,
          ),
        )
        .map((o: any) => o.id as string);

      // Collect product IDs from her order items.
      const prodSet = new Set<string>();
      if (moderatorOrderIds.length > 0) {
        // Batch through to stay under the 1000-row Supabase default.
        for (let i = 0; i < moderatorOrderIds.length; i += 200) {
          const chunk = moderatorOrderIds.slice(i, i + 200);
          const { data: items } = await supabase
            .from("order_items")
            .select("product_id")
            .in("order_id", chunk);
          (items || []).forEach((it: any) => it.product_id && prodSet.add(it.product_id));
        }
      }
      setModeratorProductIds(prodSet);

      // Warehouse stock.
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

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moderator.slug]);

  const filtered = useMemo(() => {
    const q = search.trim();
    const onlyHers = products.filter((p) => moderatorProductIds.has(p.id));
    if (!q) return onlyHers;
    return onlyHers.filter(
      (p) => p.name?.includes(q) || p.category?.includes(q),
    );
  }, [products, moderatorProductIds, search]);

  const printRows = filtered.map((p) => ({
    name: p.name,
    unit: p.unit,
    agouza: agouzaStock[p.id] ?? 0,
    main: mainStock[p.id] ?? 0,
  }));

  return (
    <DashboardLayout>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <Header
          title={`المتاح للأخت ${moderator.displayName}`}
          subtitle={`المنتجات الموجودة في طلبات ${moderator.displayName} لشهر مايو ٢٠٢٦ مع رصيد المخزنين`}
        />
        <Button variant="outline" size="sm" onClick={() => navigate("/warehouse-stock")}>
          <ArrowRight className="w-4 h-4 ml-1" /> العودة للمخازن
        </Button>
      </div>

      {/* Quick switcher between moderators */}
      <div className="flex flex-wrap gap-2 mb-4">
        {MODERATORS.map((m) => (
          <Button
            key={m.slug}
            size="sm"
            variant={m.slug === moderator.slug ? "default" : "outline"}
            onClick={() => navigate(`/warehouse-stock/moderator/${m.slug}`)}
          >
            {m.displayName}
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <CardTitle className="flex items-center gap-2">
              <Warehouse className="w-5 h-5 text-primary" />
              منتجاتها والمتاح في المخازن
              <Badge variant="outline" className="ms-1">{filtered.length}</Badge>
            </CardTitle>
            <div className="flex gap-2 items-center flex-wrap">
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
              <button
                className="inline-flex items-center gap-1 h-8 px-3 text-xs rounded-md border bg-background hover:bg-muted transition"
                onClick={() => printWarehouseStock(printRows, { filter: search.trim() || undefined, mode: "both" })}
              >
                <Printer className="w-4 h-4" /> طباعة
              </button>
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
                      <td className="p-2"><Badge variant={a <= 0 ? "destructive" : "outline"}>{a}</Badge></td>
                      <td className="p-2"><Badge variant={m <= 0 ? "destructive" : "outline"}>{m}</Badge></td>
                      <td className="p-2 font-bold text-primary">{a + m}</td>
                    </tr>
                  );
                })}
                {!loading && filtered.length === 0 && (
                  <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">
                    لا توجد منتجات في طلبات {moderator.displayName} لشهر مايو
                  </td></tr>
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
            {!loading && filtered.length === 0 && (
              <p className="text-center text-sm text-muted-foreground py-6">
                لا توجد منتجات في طلبات {moderator.displayName} لشهر مايو
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </DashboardLayout>
  );
};

export default ModeratorWarehouseStock;
