import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { MapPin, Warehouse as WarehouseIcon, Package, Activity, AlertTriangle, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatDateTime } from "@/lib/dateFormat";

const typeLabels: Record<string, string> = {
  raw_materials: "مواد خام",
  finished_goods: "منتج نهائي",
  feed: "أعلاف",
  medicines: "أدوية",
  packaging: "تعبئة",
  equipment: "معدات",
  general: "عام",
};

interface Row {
  id: string;
  name: string;
  type: string;
  location: string | null;
  is_active: boolean;
  itemsCount: number;
  totalValue: number;
  lowStockCount: number;
  lastMovement: string | null;
}

const slugFor = (w: Row): string => {
  // map known warehouses to their dedicated routes
  const n = w.name || "";
  if (n.includes("الرئيسي")) return "/warehouse-stock/main";
  if (n.includes("العجوزة")) return "/warehouse-stock/agouza";
  if (n.includes("هيلثي")) return "/warehouse-stock/hyper-healthy-test";
  if (n.includes("كارفور")) return "/warehouse-stock/hyper-carrefour";
  if (n.includes("تغليف") || w.type === "packaging") return "/modules/packaging";
  if (n.includes("مصنع اللحوم")) return "/meat-factory/factory-warehouses";
  return `/modules/warehouses/${w.id}`;
};

export default function WarehousesByLocation() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [locationFilter, setLocationFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [activeOnly, setActiveOnly] = useState(true);
  const [withStockOnly, setWithStockOnly] = useState(false);
  const [lowStockOnly, setLowStockOnly] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [w, i, m] = await Promise.all([
        supabase.from("warehouses").select("id,name,type,location,is_active").order("location", { nullsFirst: false }),
        supabase.from("inventory_items").select("warehouse_id, stock, low_stock_threshold, unit_cost, is_active"),
        supabase.from("inventory_movements").select("warehouse_id, performed_at").order("performed_at", { ascending: false }).limit(2000),
      ]);
      const items = (i.data || []) as any[];
      const moves = (m.data || []) as any[];
      const lastMoveMap = new Map<string, string>();
      for (const mv of moves) if (!lastMoveMap.has(mv.warehouse_id)) lastMoveMap.set(mv.warehouse_id, mv.performed_at);

      const aggregated: Row[] = ((w.data || []) as any[]).map((wh) => {
        const its = items.filter((it) => it.warehouse_id === wh.id);
        const itemsCount = its.length;
        const totalValue = its.reduce((s, it) => s + Number(it.stock || 0) * Number(it.unit_cost || 0), 0);
        const lowStockCount = its.filter((it) => Number(it.stock || 0) <= Number(it.low_stock_threshold || 0)).length;
        return {
          id: wh.id,
          name: wh.name,
          type: wh.type,
          location: wh.location,
          is_active: wh.is_active,
          itemsCount,
          totalValue,
          lowStockCount,
          lastMovement: lastMoveMap.get(wh.id) || null,
        };
      });
      setRows(aggregated);
      setLoading(false);
    })();
  }, []);

  const locations = useMemo(() => Array.from(new Set(rows.map((r) => r.location || "بدون موقع"))).sort(), [rows]);
  const types = useMemo(() => Array.from(new Set(rows.map((r) => r.type))).sort(), [rows]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (activeOnly && !r.is_active) return false;
      if (withStockOnly && r.itemsCount === 0) return false;
      if (lowStockOnly && r.lowStockCount === 0) return false;
      if (typeFilter !== "all" && r.type !== typeFilter) return false;
      const loc = r.location || "بدون موقع";
      if (locationFilter !== "all" && loc !== locationFilter) return false;
      if (search && !`${r.name} ${loc}`.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [rows, activeOnly, withStockOnly, lowStockOnly, typeFilter, locationFilter, search]);

  const grouped = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const r of filtered) {
      const k = r.location || "بدون موقع";
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  return (
    <DashboardLayout>
      <div className="space-y-6 p-4" dir="rtl">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <MapPin className="h-6 w-6 text-primary" />
              المخازن حسب الموقع الجغرافي
            </h1>
            <p className="text-sm text-muted-foreground mt-1">عرض كل المخازن مجمعة حسب الموقع مع المؤشرات الرئيسية</p>
          </div>
          <div className="flex gap-2 text-sm">
            <Badge variant="outline">المواقع: {grouped.length}</Badge>
            <Badge variant="outline">المخازن: {filtered.length}</Badge>
          </div>
        </div>

        <Card>
          <CardContent className="p-4 grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
            <div className="md:col-span-2">
              <Label>بحث</Label>
              <Input placeholder="اسم المخزن أو الموقع..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div>
              <Label>الموقع</Label>
              <Select value={locationFilter} onValueChange={setLocationFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل المواقع</SelectItem>
                  {locations.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>نوع المخزن</Label>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الأنواع</SelectItem>
                  {types.map((t) => <SelectItem key={t} value={t}>{typeLabels[t] || t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2"><Switch checked={activeOnly} onCheckedChange={setActiveOnly} /><Label>النشطة فقط</Label></div>
            <div className="flex items-center gap-2"><Switch checked={withStockOnly} onCheckedChange={setWithStockOnly} /><Label>التي بها رصيد</Label></div>
            <div className="flex items-center gap-2"><Switch checked={lowStockOnly} onCheckedChange={setLowStockOnly} /><Label>منخفضة الرصيد</Label></div>
          </CardContent>
        </Card>

        {loading ? (
          <div className="text-center py-12 text-muted-foreground">جاري التحميل...</div>
        ) : grouped.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">لا توجد مخازن مطابقة</div>
        ) : (
          grouped.map(([location, whs]) => (
            <Card key={location}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <MapPin className="h-5 w-5 text-primary" />
                  {location}
                  <Badge variant="secondary" className="mr-2">{whs.length} مخزن</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {whs.map((w) => (
                    <Card key={w.id} className="border-2 hover:border-primary transition-colors">
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <WarehouseIcon className="h-5 w-5 text-primary" />
                            <div className="font-bold">{w.name}</div>
                          </div>
                          <Badge variant={w.is_active ? "default" : "destructive"}>
                            {w.is_active ? "نشط" : "موقوف"}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground">{typeLabels[w.type] || w.type}</div>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div className="flex items-center gap-1"><Package className="h-4 w-4" /> {w.itemsCount} صنف</div>
                          <div className="flex items-center gap-1">💰 {w.totalValue.toLocaleString("ar-EG", { maximumFractionDigits: 0 })} ج.م</div>
                          <div className="flex items-center gap-1 col-span-2"><Activity className="h-4 w-4" /> آخر حركة: {w.lastMovement ? formatDateTime(w.lastMovement) : "—"}</div>
                          {w.lowStockCount > 0 && (
                            <div className="flex items-center gap-1 col-span-2 text-destructive">
                              <AlertTriangle className="h-4 w-4" /> {w.lowStockCount} صنف منخفض
                            </div>
                          )}
                        </div>
                        <div className="flex gap-2 pt-2 border-t">
                          <Button asChild size="sm" variant="default" className="flex-1">
                            <Link to={slugFor(w)}><ExternalLink className="h-4 w-4 ml-1" />فتح المخزن</Link>
                          </Button>
                          <Button asChild size="sm" variant="outline">
                            <Link to={`/modules/warehouses/${w.id}`}><Activity className="h-4 w-4 ml-1" />الحركات</Link>
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </DashboardLayout>
  );
}
