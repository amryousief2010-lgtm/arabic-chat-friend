import { useEffect, useState, useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowRight, Warehouse, Package, AlertTriangle, ArrowDown, ArrowUp, ArrowLeftRight, Settings2, Truck, FileSpreadsheet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { formatDateTime } from "@/lib/dateFormat";
import * as XLSX from "xlsx";

const warehouseTypes: Record<string, string> = {
  raw_materials: "مواد خام", finished_goods: "منتج نهائي", feed: "أعلاف",
  medicines: "أدوية", packaging: "تعبئة", equipment: "معدات", general: "عام",
};
const moveLabels: Record<string, { label: string; icon: any; variant: any }> = {
  in: { label: "إضافة", icon: ArrowDown, variant: "default" },
  out: { label: "صرف", icon: ArrowUp, variant: "destructive" },
  transfer: { label: "تحويل", icon: ArrowLeftRight, variant: "secondary" },
  adjustment: { label: "تسوية", icon: Settings2, variant: "outline" },
};
const CAIRO_GIZA = ["القاهرة", "الجيزة", "قاهره", "جيزه", "Cairo", "Giza"];
const isCairoGiza = (g?: string) => !!g && CAIRO_GIZA.some(k => g.includes(k));

const WarehouseDetail = () => {
  const { id } = useParams<{ id: string }>();
  const { canManageWarehouses, user } = useAuth();
  const { toast } = useToast();
  const [warehouse, setWarehouse] = useState<any>(null);
  const [allWarehouses, setAllWarehouses] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [movements, setMovements] = useState<any[]>([]);
  const [orderItems, setOrderItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [supplyDialog, setSupplyDialog] = useState(false);
  const [supplyQty, setSupplyQty] = useState<Record<string, number>>({});

  const isAgouza = useMemo(() => !!warehouse && (warehouse.name?.includes("العجوزة") || warehouse.location?.includes("العجوزة")), [warehouse]);
  const mainWarehouse = useMemo(() => allWarehouses.find(w => w.id !== id && (w.name?.includes("الرئيسي") || w.name?.includes("المقر"))) || allWarehouses.find(w => w.id !== id && w.type === "finished_goods"), [allWarehouses, id]);

  const fetchAll = async () => {
    if (!id) return;
    setLoading(true);
    const sinceISO = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const [w, all, it, mv, oi] = await Promise.all([
      supabase.from("warehouses").select("*").eq("id", id).maybeSingle(),
      supabase.from("warehouses").select("*").order("name"),
      supabase.from("inventory_items").select("*").eq("warehouse_id", id).order("name"),
      supabase.from("inventory_movements")
        .select("*, item:inventory_items(name, unit), warehouse:warehouses!inventory_movements_warehouse_id_fkey(name), destination:warehouses!inventory_movements_destination_warehouse_id_fkey(name)")
        .or(`warehouse_id.eq.${id},destination_warehouse_id.eq.${id}`)
        .order("performed_at", { ascending: false })
        .limit(300),
      supabase.from("order_items")
        .select("product_name, quantity, orders!inner(created_at, status, customer:customers(governorate))")
        .gte("orders.created_at", sinceISO)
        .neq("orders.status", "cancelled")
        .limit(2000),
    ]);
    setWarehouse(w.data);
    setAllWarehouses(all.data || []);
    setItems(it.data || []);
    setMovements(mv.data || []);
    setOrderItems(oi.data || []);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, [id]);

  const lowStock = items.filter(i => Number(i.stock) <= Number(i.low_stock_threshold));
  const totalValue = items.reduce((s, i) => s + Number(i.stock) * Number(i.unit_cost), 0);

  // Demand calculation for Agouza based on Cairo/Giza orders (last 30 days)
  const demandByProduct = useMemo(() => {
    if (!isAgouza) return new Map<string, number>();
    const m = new Map<string, number>();
    orderItems.forEach((oi: any) => {
      const gov = oi.orders?.customer?.governorate;
      if (!isCairoGiza(gov)) return;
      const key = (oi.product_name || "").trim();
      if (!key) return;
      m.set(key, (m.get(key) || 0) + Number(oi.quantity || 0));
    });
    return m;
  }, [orderItems, isAgouza]);

  // Suggested supply list = demand - current stock (positive only)
  const supplyNeeds = useMemo(() => {
    if (!isAgouza) return [];
    const needs: Array<{ name: string; demand: number; stock: number; suggested: number; unit: string; item?: any }> = [];
    demandByProduct.forEach((demand, name) => {
      const item = items.find(i => i.name?.trim() === name);
      const stock = item ? Number(item.stock) : 0;
      const suggested = Math.max(0, Math.ceil(demand - stock));
      if (suggested > 0) needs.push({ name, demand, stock, suggested, unit: item?.unit || "قطعة", item });
    });
    return needs.sort((a, b) => b.suggested - a.suggested);
  }, [demandByProduct, items, isAgouza]);

  const openSupplyDialog = () => {
    const init: Record<string, number> = {};
    supplyNeeds.forEach(n => { init[n.name] = n.suggested; });
    setSupplyQty(init);
    setSupplyDialog(true);
  };

  const submitSupplyRequest = async () => {
    if (!mainWarehouse) {
      toast({ title: "لا يوجد مخزن رئيسي", description: "تعذر تحديد المخزن المصدر", variant: "destructive" });
      return;
    }
    const requested = Object.entries(supplyQty).filter(([_, q]) => q > 0);
    if (requested.length === 0) {
      toast({ title: "لا يوجد أصناف", description: "أدخل كميات أكبر من صفر", variant: "destructive" });
      return;
    }

    // Fetch main warehouse items to find sources by name
    const { data: mainItems } = await supabase
      .from("inventory_items")
      .select("*")
      .eq("warehouse_id", mainWarehouse.id);

    const ref = `طلب توريد العجوزة ${new Date().toLocaleDateString("ar-EG")}`;
    let success = 0, missing: string[] = [], insufficient: string[] = [];

    for (const [name, qty] of requested) {
      const src = (mainItems || []).find((m: any) => m.name?.trim() === name.trim());
      if (!src) { missing.push(name); continue; }
      if (Number(src.stock) < qty) { insufficient.push(`${name} (متاح ${src.stock})`); continue; }

      // Out from main
      const { error: e1 } = await supabase.from("inventory_movements").insert({
        item_id: src.id, warehouse_id: mainWarehouse.id,
        movement_type: "transfer", quantity: qty,
        destination_warehouse_id: id,
        reference: ref, unit_cost: src.unit_cost, performed_by: user?.id,
        notes: `نقل إلى ${warehouse?.name}`,
      });
      if (e1) continue;

      // Ensure destination item exists
      let destItem = items.find(i => i.name?.trim() === name.trim());
      if (!destItem) {
        const { data: created } = await supabase.from("inventory_items").insert({
          warehouse_id: id, name: src.name, category: src.category, sku: src.sku,
          unit: src.unit, stock: 0, low_stock_threshold: src.low_stock_threshold, unit_cost: src.unit_cost,
        }).select().single();
        destItem = created;
      }
      if (destItem) {
        await supabase.from("inventory_movements").insert({
          item_id: destItem.id, warehouse_id: id, movement_type: "in",
          quantity: qty, reference: ref, unit_cost: src.unit_cost, performed_by: user?.id,
          notes: `استلام من ${mainWarehouse.name}`,
        });
        success++;
      }
    }

    toast({
      title: "تم تنفيذ طلب التوريد",
      description: `نُقل ${success} صنف${missing.length ? ` • مفقود: ${missing.length}` : ""}${insufficient.length ? ` • غير كافٍ: ${insufficient.length}` : ""}`,
    });
    setSupplyDialog(false);
    fetchAll();
  };

  const exportSupplyExcel = () => {
    const rows = supplyNeeds.map((n, i) => ({
      "م": i + 1, "الصنف": n.name, "الطلب (30 يوم)": n.demand,
      "الرصيد الحالي": n.stock, "الكمية المقترحة": n.suggested, "الوحدة": n.unit,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{ wch: 5 }, { wch: 30 }, { wch: 16 }, { wch: 14 }, { wch: 18 }, { wch: 10 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "احتياج التوريد");
    XLSX.writeFile(wb, `احتياج-توريد-${warehouse?.name || ""}.xlsx`);
  };

  if (loading && !warehouse) {
    return <DashboardLayout><div className="text-center py-12 text-muted-foreground">جارٍ التحميل...</div></DashboardLayout>;
  }
  if (!warehouse) {
    return <DashboardLayout><div className="text-center py-12 text-muted-foreground">لم يتم العثور على المخزن</div></DashboardLayout>;
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <Link to="/modules/warehouses"><Button variant="ghost" size="sm"><ArrowRight className="w-4 h-4 ml-1" />رجوع</Button></Link>
            <Warehouse className="w-7 h-7 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">{warehouse.name}</h1>
              <p className="text-sm text-muted-foreground">
                {warehouseTypes[warehouse.type] || warehouse.type}
                {warehouse.location && ` • ${warehouse.location}`}
              </p>
            </div>
          </div>
          {isAgouza && canManageWarehouses && (
            <Button onClick={openSupplyDialog} disabled={supplyNeeds.length === 0}>
              <Truck className="w-4 h-4 ml-2" />طلب توريد من المخزن الرئيسي
              {supplyNeeds.length > 0 && <Badge variant="destructive" className="mr-2">{supplyNeeds.length}</Badge>}
            </Button>
          )}
        </div>

        {warehouse.description && (
          <Card><CardContent className="py-3 text-sm text-muted-foreground">{warehouse.description}</CardContent></Card>
        )}

        <div className="grid gap-4 md:grid-cols-4">
          <Card><CardHeader className="pb-2"><CardDescription>عدد الأصناف</CardDescription><CardTitle className="text-3xl">{items.length}</CardTitle></CardHeader></Card>
          <Card><CardHeader className="pb-2"><CardDescription>قيمة المخزون</CardDescription><CardTitle className="text-2xl">{totalValue.toLocaleString()}</CardTitle></CardHeader></Card>
          <Card className={lowStock.length ? "border-destructive" : ""}>
            <CardHeader className="pb-2"><CardDescription>أصناف منخفضة</CardDescription><CardTitle className={`text-3xl ${lowStock.length ? "text-destructive" : ""}`}>{lowStock.length}</CardTitle></CardHeader>
          </Card>
          <Card className={isAgouza && supplyNeeds.length ? "border-orange-500" : ""}>
            <CardHeader className="pb-2">
              <CardDescription>{isAgouza ? "احتياج توريد" : "آخر الحركات"}</CardDescription>
              <CardTitle className={`text-3xl ${isAgouza && supplyNeeds.length ? "text-orange-600" : ""}`}>
                {isAgouza ? supplyNeeds.length : movements.length}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>

        <Tabs defaultValue="items">
          <TabsList>
            <TabsTrigger value="items">الأصناف</TabsTrigger>
            <TabsTrigger value="movements">الحركات</TabsTrigger>
            <TabsTrigger value="low">منخفضة {lowStock.length > 0 && <Badge variant="destructive" className="mr-2">{lowStock.length}</Badge>}</TabsTrigger>
            {isAgouza && (
              <TabsTrigger value="supply" className="gap-1">
                <Truck className="w-4 h-4" />احتياج التوريد
                {supplyNeeds.length > 0 && <Badge variant="destructive" className="mr-1">{supplyNeeds.length}</Badge>}
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="items">
            <Card><CardContent className="p-0">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>الصنف</TableHead><TableHead>الفئة</TableHead><TableHead>الرصيد</TableHead>
                  <TableHead>الوحدة</TableHead><TableHead>الحد الأدنى</TableHead><TableHead>التكلفة</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {items.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">لا توجد أصناف بهذا المخزن</TableCell></TableRow>
                  ) : items.map(it => (
                    <TableRow key={it.id} className={Number(it.stock) <= Number(it.low_stock_threshold) ? "bg-destructive/5" : ""}>
                      <TableCell className="font-medium flex items-center gap-2"><Package className="w-4 h-4 text-muted-foreground" />{it.name}{it.sku && <span className="text-xs text-muted-foreground">({it.sku})</span>}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{it.category || "—"}</TableCell>
                      <TableCell className={Number(it.stock) <= Number(it.low_stock_threshold) ? "text-destructive font-bold" : ""}>{it.stock}</TableCell>
                      <TableCell>{it.unit}</TableCell>
                      <TableCell>{it.low_stock_threshold}</TableCell>
                      <TableCell>{Number(it.unit_cost).toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="movements">
            <Card><CardContent className="p-0">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>التاريخ</TableHead><TableHead>النوع</TableHead><TableHead>الصنف</TableHead>
                  <TableHead>المخزن</TableHead><TableHead>الكمية</TableHead><TableHead>الوجهة/الجهة</TableHead><TableHead>المرجع</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {movements.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">لا توجد حركات</TableCell></TableRow>
                  ) : movements.map(m => {
                    const cfg = moveLabels[m.movement_type] || moveLabels.in;
                    const Icon = cfg.icon;
                    const isIncoming = m.destination_warehouse_id === id;
                    return (
                      <TableRow key={m.id}>
                        <TableCell className="text-xs">{formatDateTime(m.performed_at)}</TableCell>
                        <TableCell><Badge variant={cfg.variant} className="gap-1"><Icon className="w-3 h-3" />{cfg.label}{isIncoming && m.movement_type === "transfer" ? " (وارد)" : ""}</Badge></TableCell>
                        <TableCell>{m.item?.name || "—"}</TableCell>
                        <TableCell>{m.warehouse?.name || "—"}</TableCell>
                        <TableCell>{m.quantity} {m.item?.unit}</TableCell>
                        <TableCell>{m.destination?.name || m.party || "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{m.reference || "—"}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="low">
            {lowStock.length === 0 ? (
              <Card><CardContent className="py-12 text-center text-muted-foreground">لا توجد أصناف منخفضة</CardContent></Card>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {lowStock.map(it => (
                  <Card key={it.id} className="border-destructive">
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between">
                        <CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-destructive" />{it.name}</CardTitle>
                        <Badge variant="destructive">{it.stock} {it.unit}</Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="text-sm text-muted-foreground">الحد الأدنى: {it.low_stock_threshold} {it.unit}</CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {isAgouza && (
            <TabsContent value="supply" className="space-y-4">
              <Card className="border-orange-500/30">
                <CardHeader>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div>
                      <CardTitle className="text-base flex items-center gap-2"><Truck className="w-5 h-5 text-orange-500" />احتياج التوريد المحسوب</CardTitle>
                      <CardDescription>
                        بناءً على طلبات القاهرة/الجيزة (آخر 30 يوم) مقابل الرصيد الحالي بالمخزن
                      </CardDescription>
                    </div>
                    <div className="flex gap-2">
                      {supplyNeeds.length > 0 && (
                        <Button variant="outline" size="sm" onClick={exportSupplyExcel}>
                          <FileSpreadsheet className="w-4 h-4 ml-1 text-emerald-600" />Excel
                        </Button>
                      )}
                      {canManageWarehouses && supplyNeeds.length > 0 && (
                        <Button size="sm" onClick={openSupplyDialog}>
                          <Truck className="w-4 h-4 ml-1" />تقديم طلب توريد
                        </Button>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>الصنف</TableHead><TableHead>الطلب (30 يوم)</TableHead>
                      <TableHead>الرصيد الحالي</TableHead><TableHead>الكمية المقترحة</TableHead><TableHead>الحالة</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {supplyNeeds.length === 0 ? (
                        <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">لا يوجد احتياج توريد حالياً</TableCell></TableRow>
                      ) : supplyNeeds.map(n => (
                        <TableRow key={n.name}>
                          <TableCell className="font-medium">{n.name}</TableCell>
                          <TableCell>{n.demand} {n.unit}</TableCell>
                          <TableCell className={n.stock === 0 ? "text-destructive font-bold" : ""}>{n.stock} {n.unit}</TableCell>
                          <TableCell className="text-orange-600 font-bold">{n.suggested} {n.unit}</TableCell>
                          <TableCell>
                            {n.stock === 0
                              ? <Badge variant="destructive">نفد</Badge>
                              : <Badge className="bg-orange-500/10 text-orange-600 border-orange-500/30">يحتاج توريد</Badge>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>
          )}
        </Tabs>
      </div>

      {/* Supply Request Dialog */}
      <Dialog open={supplyDialog} onOpenChange={setSupplyDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>طلب توريد من {mainWarehouse?.name || "المخزن الرئيسي"}</DialogTitle>
            <DialogDescription>
              راجع وعدّل الكميات المطلوبة. سيتم تسجيل حركة نقل من المخزن الرئيسي وإضافتها لمخزن {warehouse?.name}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {supplyNeeds.length === 0 ? (
              <p className="text-center py-6 text-muted-foreground">لا يوجد احتياج توريد</p>
            ) : (
              <Table>
                <TableHeader><TableRow>
                  <TableHead>الصنف</TableHead><TableHead>متاح بالعجوزة</TableHead>
                  <TableHead>المطلوب</TableHead><TableHead>الكمية</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {supplyNeeds.map(n => (
                    <TableRow key={n.name}>
                      <TableCell className="font-medium">{n.name}</TableCell>
                      <TableCell>{n.stock} {n.unit}</TableCell>
                      <TableCell>{n.demand} {n.unit}</TableCell>
                      <TableCell>
                        <Input type="number" min={0} className="w-24"
                          value={supplyQty[n.name] ?? 0}
                          onChange={e => setSupplyQty({ ...supplyQty, [n.name]: Number(e.target.value) })} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSupplyDialog(false)}>إلغاء</Button>
            <Button onClick={submitSupplyRequest} disabled={!mainWarehouse}>تنفيذ النقل</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default WarehouseDetail;
