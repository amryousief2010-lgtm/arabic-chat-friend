import { useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowRight, AlertTriangle, ArrowDown, ArrowUp, ArrowLeftRight, Settings2, Warehouse, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { formatDateTime } from "@/lib/dateFormat";

const warehouseTypes: Record<string, string> = {
  raw_materials: "مواد خام", finished_goods: "منتج نهائي", feed: "أعلاف",
  medicines: "أدوية", packaging: "تعبئة", equipment: "معدات", general: "عام",
};
const moveIcons: Record<string, any> = { in: ArrowDown, out: ArrowUp, transfer: ArrowLeftRight, adjustment: Settings2 };
const moveLabels: Record<string, string> = { in: "إضافة", out: "صرف", transfer: "تحويل", adjustment: "تسوية" };

const WarehouseDashboard = () => {
  const { canManageWarehouses } = useAuth();
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [movements, setMovements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const sevenAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
      const [w, i, m] = await Promise.all([
        supabase.from("warehouses").select("*"),
        supabase.from("inventory_items").select("*, warehouse:warehouses(name, type)"),
        supabase.from("inventory_movements").select("*, item:inventory_items(name, unit), warehouse:warehouses!inventory_movements_warehouse_id_fkey(name)").gte("performed_at", sevenAgo).order("performed_at", { ascending: false }),
      ]);
      setWarehouses(w.data || []);
      setItems(i.data || []);
      setMovements(m.data || []);
      setLoading(false);
    })();
  }, []);

  const lowStock = useMemo(() => items.filter(i => i.stock <= i.low_stock_threshold), [items]);
  const lowByWarehouse = useMemo(() => {
    const map = new Map<string, any[]>();
    lowStock.forEach(it => {
      const k = it.warehouse_id;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(it);
    });
    return map;
  }, [lowStock]);
  const lowByType = useMemo(() => {
    const map = new Map<string, number>();
    lowStock.forEach(it => {
      const t = it.warehouse?.type || "general";
      map.set(t, (map.get(t) || 0) + 1);
    });
    return map;
  }, [lowStock]);
  const moveStats = useMemo(() => {
    const stats: Record<string, number> = { in: 0, out: 0, transfer: 0, adjustment: 0 };
    movements.forEach(m => { stats[m.movement_type] = (stats[m.movement_type] || 0) + 1; });
    return stats;
  }, [movements]);
  const totalValue = items.reduce((s, i) => s + Number(i.stock) * Number(i.unit_cost), 0);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <Link to="/modules/warehouses"><Button variant="ghost" size="sm"><ArrowRight className="w-4 h-4 ml-1" />رجوع</Button></Link>
            <Warehouse className="w-7 h-7 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">لوحة مؤشرات المخازن</h1>
              <p className="text-sm text-muted-foreground">تنبيهات المخزون وإحصائيات الحركات (آخر 7 أيام)</p>
            </div>
          </div>
          {canManageWarehouses ? (
            <Link to="/modules/warehouses/import"><Button variant="outline"><Upload className="w-4 h-4 ml-2" />استيراد CSV</Button></Link>
          ) : (
            <Badge variant="outline">عرض فقط</Badge>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <Card><CardHeader className="pb-2"><CardDescription>المخازن</CardDescription><CardTitle className="text-3xl">{warehouses.length}</CardTitle></CardHeader></Card>
          <Card><CardHeader className="pb-2"><CardDescription>الأصناف</CardDescription><CardTitle className="text-3xl">{items.length}</CardTitle></CardHeader></Card>
          <Card><CardHeader className="pb-2"><CardDescription>قيمة المخزون</CardDescription><CardTitle className="text-2xl">{totalValue.toLocaleString()}</CardTitle></CardHeader></Card>
          <Card className={lowStock.length ? "border-destructive" : ""}>
            <CardHeader className="pb-2"><CardDescription>أصناف منخفضة</CardDescription><CardTitle className={`text-3xl ${lowStock.length ? "text-destructive" : ""}`}>{lowStock.length}</CardTitle></CardHeader>
          </Card>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          {(["in", "out", "transfer", "adjustment"] as const).map(t => {
            const Icon = moveIcons[t];
            return (
              <Card key={t}>
                <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
                  <CardDescription>{moveLabels[t]} (7 أيام)</CardDescription>
                  <Icon className="w-4 h-4 text-muted-foreground" />
                </CardHeader>
                <CardContent><div className="text-3xl font-bold">{moveStats[t] || 0}</div></CardContent>
              </Card>
            );
          })}
        </div>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-destructive" />تنبيهات حسب نوع المخزن</CardTitle></CardHeader>
          <CardContent>
            {lowByType.size === 0 ? (
              <p className="text-center text-muted-foreground py-4">لا توجد تنبيهات</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {Array.from(lowByType.entries()).map(([type, count]) => (
                  <Badge key={type} variant="destructive" className="text-sm px-3 py-1">{warehouseTypes[type] || type}: {count}</Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>تنبيهات حسب المخزن</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>المخزن</TableHead><TableHead>النوع</TableHead><TableHead>عدد الأصناف المنخفضة</TableHead><TableHead>التفاصيل</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {warehouses.filter(w => lowByWarehouse.has(w.id)).map(w => {
                  const list = lowByWarehouse.get(w.id) || [];
                  return (
                    <TableRow key={w.id}>
                      <TableCell className="font-medium">{w.name}</TableCell>
                      <TableCell>{warehouseTypes[w.type] || w.type}</TableCell>
                      <TableCell><Badge variant="destructive">{list.length}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{list.slice(0, 5).map(i => `${i.name} (${i.stock}/${i.low_stock_threshold})`).join("، ")}{list.length > 5 ? "…" : ""}</TableCell>
                    </TableRow>
                  );
                })}
                {lowByWarehouse.size === 0 && (
                  <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">جميع الأصناف في الحدود الآمنة</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>آخر الحركات</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>التاريخ</TableHead><TableHead>النوع</TableHead><TableHead>الصنف</TableHead><TableHead>المخزن</TableHead><TableHead>الكمية</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {movements.slice(0, 15).map(m => (
                  <TableRow key={m.id}>
                    <TableCell className="text-xs">{formatDateTime(m.performed_at)}</TableCell>
                    <TableCell><Badge variant="outline">{moveLabels[m.movement_type]}</Badge></TableCell>
                    <TableCell>{m.item?.name}</TableCell>
                    <TableCell>{m.warehouse?.name}</TableCell>
                    <TableCell>{m.quantity} {m.item?.unit}</TableCell>
                  </TableRow>
                ))}
                {movements.length === 0 && !loading && (
                  <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">لا توجد حركات حديثة</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default WarehouseDashboard;
