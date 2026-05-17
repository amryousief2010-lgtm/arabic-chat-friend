import { useState, useEffect } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Plus, Warehouse, Trash2, Edit, ArrowDown, ArrowUp, ArrowLeftRight, Settings2, Package, AlertTriangle, BarChart3, Upload, Beef, CheckCircle2 } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

interface WarehouseRow {
  id: string;
  name: string;
  type: string;
  location: string | null;
  description: string | null;
  is_active: boolean;
}

interface InventoryItem {
  id: string;
  warehouse_id: string;
  name: string;
  category: string | null;
  sku: string | null;
  unit: string;
  stock: number;
  low_stock_threshold: number;
  unit_cost: number;
  expiry_date: string | null;
  is_active: boolean;
  warehouse?: { name: string };
}

interface Movement {
  id: string;
  item_id: string;
  warehouse_id: string;
  movement_type: string;
  quantity: number;
  destination_warehouse_id: string | null;
  reference: string | null;
  party: string | null;
  notes: string | null;
  performed_at: string;
  item?: { name: string; unit: string };
  warehouse?: { name: string };
  destination?: { name: string };
}

const warehouseTypes: Record<string, string> = {
  raw_materials: "مواد خام",
  finished_goods: "منتج نهائي",
  feed: "أعلاف",
  medicines: "أدوية",
  packaging: "تعبئة",
  equipment: "معدات",
  general: "عام",
};

const movementTypeLabels: Record<string, { label: string; icon: typeof ArrowDown; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  in: { label: "إضافة", icon: ArrowDown, variant: "default" },
  out: { label: "صرف", icon: ArrowUp, variant: "destructive" },
  transfer: { label: "تحويل", icon: ArrowLeftRight, variant: "secondary" },
  adjustment: { label: "تسوية", icon: Settings2, variant: "outline" },
};

const Warehouses = () => {
  const { canManageWarehouses, user } = useAuth();
  const { toast } = useToast();
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [slaughterOutputs, setSlaughterOutputs] = useState<any[]>([]);
  const [receiveBatch, setReceiveBatch] = useState<{ batch_id: string; batch_number: string; slaughter_date?: string; status?: string; outputs: any[] } | null>(null);
  const [receiveWarehouseId, setReceiveWarehouseId] = useState<string>("");
  const [receiving, setReceiving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [warehouseFilter, setWarehouseFilter] = useState<string>("all");

  // Dialogs
  const [whDialog, setWhDialog] = useState(false);
  const [editWh, setEditWh] = useState<WarehouseRow | null>(null);
  const [whForm, setWhForm] = useState({ name: "", type: "general", location: "", description: "" });

  const [itemDialog, setItemDialog] = useState(false);
  const [editItem, setEditItem] = useState<InventoryItem | null>(null);
  const [itemForm, setItemForm] = useState({ warehouse_id: "", name: "", category: "", sku: "", unit: "قطعة", stock: 0, low_stock_threshold: 10, unit_cost: 0, expiry_date: "" });

  const [moveDialog, setMoveDialog] = useState(false);
  const [moveForm, setMoveForm] = useState({ item_id: "", movement_type: "in", quantity: 0, destination_warehouse_id: "", reference: "", party: "", notes: "" });

  const [deleteTarget, setDeleteTarget] = useState<{ type: "warehouse" | "item"; id: string; name: string } | null>(null);

  const fetchAll = async () => {
    setLoading(true);
    const [w, i, m, s] = await Promise.all([
      supabase.from("warehouses").select("*").order("name"),
      supabase.from("inventory_items").select("*, warehouse:warehouses(name)").order("name"),
      supabase.from("inventory_movements").select("*, item:inventory_items(name, unit), warehouse:warehouses!inventory_movements_warehouse_id_fkey(name), destination:warehouses!inventory_movements_destination_warehouse_id_fkey(name)").order("performed_at", { ascending: false }).limit(200),
      supabase.from("slaughter_batch_outputs")
        .select("id, batch_id, cut_name_ar, actual_weight_kg, unit_cost, quality_status, received_status, received_at, received_warehouse_id, batch:slaughter_batches(batch_number, slaughter_date, status)")
        .eq("destination", "warehouse")
        .order("created_at", { ascending: false })
        .limit(300),
    ]);
    if (w.data) setWarehouses(w.data as WarehouseRow[]);
    if (i.data) setItems(i.data as InventoryItem[]);
    if (m.data) setMovements(m.data as Movement[]);
    if (s.data) setSlaughterOutputs(s.data as any[]);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  // ============ Warehouse CRUD ============
  const openWhDialog = (w?: WarehouseRow) => {
    if (w) {
      setEditWh(w);
      setWhForm({ name: w.name, type: w.type, location: w.location || "", description: w.description || "" });
    } else {
      setEditWh(null);
      setWhForm({ name: "", type: "general", location: "", description: "" });
    }
    setWhDialog(true);
  };

  const saveWarehouse = async () => {
    if (!whForm.name.trim()) {
      toast({ title: "خطأ", description: "أدخل اسم المخزن", variant: "destructive" });
      return;
    }
    const payload = { ...whForm, location: whForm.location || null, description: whForm.description || null };
    const res = editWh
      ? await supabase.from("warehouses").update(payload).eq("id", editWh.id)
      : await supabase.from("warehouses").insert(payload);
    if (res.error) toast({ title: "خطأ", description: res.error.message, variant: "destructive" });
    else { toast({ title: editWh ? "تم التعديل" : "تمت الإضافة" }); setWhDialog(false); fetchAll(); }
  };

  // ============ Item CRUD ============
  const openItemDialog = (it?: InventoryItem) => {
    if (it) {
      setEditItem(it);
      setItemForm({ warehouse_id: it.warehouse_id, name: it.name, category: it.category || "", sku: it.sku || "", unit: it.unit, stock: it.stock, low_stock_threshold: it.low_stock_threshold, unit_cost: it.unit_cost, expiry_date: it.expiry_date || "" });
    } else {
      setEditItem(null);
      setItemForm({ warehouse_id: warehouses[0]?.id || "", name: "", category: "", sku: "", unit: "قطعة", stock: 0, low_stock_threshold: 10, unit_cost: 0, expiry_date: "" });
    }
    setItemDialog(true);
  };

  const saveItem = async () => {
    if (!itemForm.name.trim() || !itemForm.warehouse_id) {
      toast({ title: "خطأ", description: "أدخل الاسم واختر المخزن", variant: "destructive" });
      return;
    }
    const payload = {
      ...itemForm,
      category: itemForm.category || null,
      sku: itemForm.sku || null,
      expiry_date: itemForm.expiry_date || null,
    };
    const res = editItem
      ? await supabase.from("inventory_items").update(payload).eq("id", editItem.id)
      : await supabase.from("inventory_items").insert(payload);
    if (res.error) toast({ title: "خطأ", description: res.error.message, variant: "destructive" });
    else { toast({ title: editItem ? "تم التعديل" : "تمت الإضافة" }); setItemDialog(false); fetchAll(); }
  };

  // ============ Movement ============
  const openMoveDialog = () => {
    setMoveForm({ item_id: "", movement_type: "in", quantity: 0, destination_warehouse_id: "", reference: "", party: "", notes: "" });
    setMoveDialog(true);
  };

  const saveMovement = async () => {
    if (!moveForm.item_id || moveForm.quantity <= 0) {
      toast({ title: "خطأ", description: "اختر صنفاً وأدخل كمية صحيحة", variant: "destructive" });
      return;
    }
    const item = items.find(i => i.id === moveForm.item_id);
    if (!item) return;

    if (moveForm.movement_type === "out" && item.stock < moveForm.quantity) {
      toast({ title: "مخزون غير كافٍ", description: `متاح ${item.stock} ${item.unit}`, variant: "destructive" });
      return;
    }
    if (moveForm.movement_type === "transfer" && !moveForm.destination_warehouse_id) {
      toast({ title: "خطأ", description: "اختر المخزن الوجهة", variant: "destructive" });
      return;
    }

    const payload = {
      item_id: moveForm.item_id,
      warehouse_id: item.warehouse_id,
      movement_type: moveForm.movement_type,
      quantity: moveForm.quantity,
      destination_warehouse_id: moveForm.movement_type === "transfer" ? moveForm.destination_warehouse_id : null,
      reference: moveForm.reference || null,
      party: moveForm.party || null,
      notes: moveForm.notes || null,
      unit_cost: item.unit_cost,
      performed_by: user?.id,
    };
    const { error } = await supabase.from("inventory_movements").insert(payload);
    if (error) { toast({ title: "خطأ", description: error.message, variant: "destructive" }); return; }

    // For transfer: also create a matching inbound entry in destination warehouse
    // Find/create matching item in destination by SKU or name
    if (moveForm.movement_type === "transfer") {
      let destItem = items.find(i => i.warehouse_id === moveForm.destination_warehouse_id && (i.sku === item.sku && item.sku) || (i.name === item.name && i.warehouse_id === moveForm.destination_warehouse_id));
      if (!destItem) {
        const { data: created } = await supabase.from("inventory_items").insert({
          warehouse_id: moveForm.destination_warehouse_id,
          name: item.name,
          category: item.category,
          sku: item.sku,
          unit: item.unit,
          stock: 0,
          low_stock_threshold: item.low_stock_threshold,
          unit_cost: item.unit_cost,
        }).select().single();
        destItem = created as InventoryItem;
      }
      if (destItem) {
        await supabase.from("inventory_movements").insert({
          item_id: destItem.id,
          warehouse_id: destItem.warehouse_id,
          movement_type: "in",
          quantity: moveForm.quantity,
          reference: `تحويل من ${item.warehouse?.name || ""}`,
          unit_cost: item.unit_cost,
          performed_by: user?.id,
        });
      }
    }

    toast({ title: "تم تسجيل الحركة" });
    setMoveDialog(false);
    fetchAll();
  };

  const performDelete = async () => {
    if (!deleteTarget) return;
    const table = deleteTarget.type === "warehouse" ? "warehouses" : "inventory_items";
    const { error } = await supabase.from(table).delete().eq("id", deleteTarget.id);
    if (error) toast({ title: "خطأ", description: error.message, variant: "destructive" });
    else { toast({ title: "تم الحذف" }); fetchAll(); }
    setDeleteTarget(null);
  };

  const filteredItems = warehouseFilter === "all" ? items : items.filter(i => i.warehouse_id === warehouseFilter);
  const lowStockItems = items.filter(i => i.stock <= i.low_stock_threshold);
  const pendingSlaughter = slaughterOutputs.filter(o => o.received_status !== 'received');

  // group pending outputs by batch
  const pendingBatches = Object.values(
    pendingSlaughter.reduce((acc: Record<string, any>, o: any) => {
      const key = o.batch_id;
      if (!acc[key]) acc[key] = {
        batch_id: o.batch_id,
        batch_number: o.batch?.batch_number || '—',
        slaughter_date: o.batch?.slaughter_date,
        status: o.batch?.status,
        outputs: [],
      };
      acc[key].outputs.push(o);
      return acc;
    }, {})
  ) as any[];

  const openReceiveBatch = (batch: any) => {
    setReceiveBatch(batch);
    const meatWh = warehouses.find(w => w.type === 'finished_goods') || warehouses[0];
    setReceiveWarehouseId(meatWh?.id || "");
  };

  const confirmReceiveBatch = async () => {
    if (!receiveBatch || !receiveWarehouseId) {
      toast({ title: "خطأ", description: "اختر المخزن", variant: "destructive" });
      return;
    }
    setReceiving(true);
    const { data, error } = await supabase.rpc('receive_slaughter_batch', {
      p_batch_id: receiveBatch.batch_id,
      p_warehouse_id: receiveWarehouseId,
    });
    setReceiving(false);
    if (error) {
      toast({ title: "خطأ", description: error.message, variant: "destructive" });
      return;
    }
    const r: any = data || {};
    toast({
      title: "تم الاستلام",
      description: `تم استلام ${r.received_count || 0} صنف (مضاف للمخزون: ${r.added_to_stock || 0}) بإجمالي ${Number(r.total_kg || 0).toFixed(2)} كجم`,
    });
    setReceiveBatch(null);
    fetchAll();
  };

  const qualityLabels: Record<string, { label: string; variant: any }> = {
    accepted: { label: 'مقبول', variant: 'default' },
    rejected: { label: 'مرفوض', variant: 'destructive' },
    quarantine: { label: 'حجر صحي', variant: 'secondary' },
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Warehouse className="w-7 h-7 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-foreground">المخازن</h1>
              <p className="text-muted-foreground mt-1">إدارة المخازن المتعددة وحركات المخزون</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Link to="/modules/warehouses/dashboard"><Button variant="outline" size="sm"><BarChart3 className="w-4 h-4 ml-2" />لوحة المؤشرات</Button></Link>
            {canManageWarehouses && (<Link to="/modules/warehouses/import"><Button variant="outline" size="sm"><Upload className="w-4 h-4 ml-2" />استيراد CSV</Button></Link>)}
            {!canManageWarehouses && (<Badge variant="outline">عرض فقط</Badge>)}
          </div>
        </div>

        {/* KPIs */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card><CardHeader className="pb-2"><CardDescription>المخازن النشطة</CardDescription><CardTitle className="text-3xl">{warehouses.filter(w => w.is_active).length}</CardTitle></CardHeader></Card>
          <Card><CardHeader className="pb-2"><CardDescription>إجمالي الأصناف</CardDescription><CardTitle className="text-3xl">{items.length}</CardTitle></CardHeader></Card>
          <Card><CardHeader className="pb-2"><CardDescription>قيمة المخزون</CardDescription><CardTitle className="text-2xl">{items.reduce((s, i) => s + i.stock * i.unit_cost, 0).toLocaleString()}</CardTitle></CardHeader></Card>
          <Card className={lowStockItems.length > 0 ? "border-destructive" : ""}>
            <CardHeader className="pb-2"><CardDescription>أصناف منخفضة</CardDescription><CardTitle className={`text-3xl ${lowStockItems.length > 0 ? "text-destructive" : ""}`}>{lowStockItems.length}</CardTitle></CardHeader>
          </Card>
        </div>

        <Tabs defaultValue="items">
          <TabsList>
            <TabsTrigger value="items">الأصناف</TabsTrigger>
            <TabsTrigger value="slaughter" className="gap-1">
              <Beef className="w-4 h-4" /> استلام المجزر
              {pendingSlaughter.length > 0 && <Badge variant="destructive" className="mr-1">{pendingSlaughter.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="movements">الحركات</TabsTrigger>
            <TabsTrigger value="low">منخفضة <Badge variant="destructive" className="mr-2">{lowStockItems.length}</Badge></TabsTrigger>
            <TabsTrigger value="warehouses">المخازن</TabsTrigger>
          </TabsList>

          {/* ITEMS */}
          <TabsContent value="items" className="space-y-4">
            <div className="flex justify-between gap-2 flex-wrap">
              <Select value={warehouseFilter} onValueChange={setWarehouseFilter}>
                <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل المخازن</SelectItem>
                  {warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {canManageWarehouses && (
                <div className="flex gap-2">
                  <Button variant="outline" onClick={openMoveDialog}><ArrowLeftRight className="w-4 h-4 ml-2" />حركة جديدة</Button>
                  <Button onClick={() => openItemDialog()} disabled={warehouses.length === 0}><Plus className="w-4 h-4 ml-2" />صنف جديد</Button>
                </div>
              )}
            </div>
            <Card><CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الصنف</TableHead>
                    <TableHead>المخزن</TableHead>
                    <TableHead>الفئة</TableHead>
                    <TableHead>الرصيد</TableHead>
                    <TableHead>الوحدة</TableHead>
                    <TableHead>الحد الأدنى</TableHead>
                    <TableHead>التكلفة</TableHead>
                    <TableHead>الصلاحية</TableHead>
                    <TableHead>إجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">جارٍ التحميل...</TableCell></TableRow>
                  ) : filteredItems.length === 0 ? (
                    <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">لا توجد أصناف</TableCell></TableRow>
                  ) : filteredItems.map(it => (
                    <TableRow key={it.id} className={it.stock <= it.low_stock_threshold ? "bg-destructive/5" : ""}>
                      <TableCell className="font-medium flex items-center gap-2"><Package className="w-4 h-4 text-muted-foreground" />{it.name}{it.sku && <span className="text-xs text-muted-foreground">({it.sku})</span>}</TableCell>
                      <TableCell>{it.warehouse?.name || "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{it.category || "—"}</TableCell>
                      <TableCell className={it.stock <= it.low_stock_threshold ? "text-destructive font-bold" : ""}>{it.stock}</TableCell>
                      <TableCell>{it.unit}</TableCell>
                      <TableCell>{it.low_stock_threshold}</TableCell>
                      <TableCell>{it.unit_cost.toFixed(2)}</TableCell>
                      <TableCell className="text-xs">{it.expiry_date || "—"}</TableCell>
                      <TableCell>
                        {canManageWarehouses && (
                          <div className="flex gap-1">
                            <Button size="sm" variant="ghost" onClick={() => openItemDialog(it)}><Edit className="w-4 h-4" /></Button>
                            <Button size="sm" variant="ghost" onClick={() => setDeleteTarget({ type: "item", id: it.id, name: it.name })}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent></Card>
          </TabsContent>

          {/* SLAUGHTER RECEIPTS */}
          <TabsContent value="slaughter" className="space-y-4">
            {/* Pending batches grouped */}
            {pendingBatches.length === 0 ? (
              <Card><CardContent className="py-10 text-center text-muted-foreground">لا توجد دفعات بانتظار الاستلام من المجزر</CardContent></Card>
            ) : (
              <div className="space-y-3">
                {pendingBatches.map((b: any) => {
                  const totalKg = b.outputs.reduce((s: number, o: any) => s + Number(o.actual_weight_kg || 0), 0);
                  const accepted = b.outputs.filter((o: any) => o.quality_status === 'accepted').length;
                  const rejected = b.outputs.filter((o: any) => o.quality_status === 'rejected').length;
                  return (
                    <Card key={b.batch_id} className="border-primary/30">
                      <CardHeader className="pb-3">
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div>
                            <CardTitle className="flex items-center gap-2 text-base">
                              <Beef className="w-5 h-5 text-primary" /> الدفعة {b.batch_number}
                              {b.status && <Badge variant="outline">{b.status === 'completed' ? 'مكتملة' : b.status === 'in_progress' ? 'جارية' : b.status}</Badge>}
                            </CardTitle>
                            <CardDescription>
                              تاريخ الذبح: {b.slaughter_date || '—'} • {b.outputs.length} صنف • إجمالي {totalKg.toFixed(2)} كجم
                              {accepted > 0 && <> • مقبول: {accepted}</>}
                              {rejected > 0 && <> • مرفوض: {rejected}</>}
                            </CardDescription>
                          </div>
                          {canManageWarehouses && (
                            <Button onClick={() => openReceiveBatch(b)}>
                              <ArrowDown className="w-4 h-4 ml-1" /> استلام الدفعة
                            </Button>
                          )}
                        </div>
                      </CardHeader>
                      <CardContent className="p-0">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>الصنف</TableHead>
                              <TableHead>الكمية (كجم)</TableHead>
                              <TableHead>التكلفة/كجم</TableHead>
                              <TableHead>الجودة</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {b.outputs.map((o: any) => {
                              const q = qualityLabels[o.quality_status] || qualityLabels.accepted;
                              return (
                                <TableRow key={o.id}>
                                  <TableCell className="font-medium">{o.cut_name_ar}</TableCell>
                                  <TableCell>{Number(o.actual_weight_kg).toFixed(2)}</TableCell>
                                  <TableCell>{Number(o.unit_cost || 0).toFixed(2)}</TableCell>
                                  <TableCell><Badge variant={q.variant}>{q.label}</Badge></TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}

            {/* Received history */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">سجل المستلم</CardTitle>
                <CardDescription>آخر عمليات الاستلام من المجزر</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الدفعة</TableHead>
                      <TableHead>الصنف</TableHead>
                      <TableHead>الكمية</TableHead>
                      <TableHead>الجودة</TableHead>
                      <TableHead>وقت الاستلام</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {slaughterOutputs.filter(o => o.received_status === 'received').length === 0 ? (
                      <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">لا يوجد</TableCell></TableRow>
                    ) : slaughterOutputs.filter(o => o.received_status === 'received').map((o: any) => {
                      const q = qualityLabels[o.quality_status] || qualityLabels.accepted;
                      return (
                        <TableRow key={o.id}>
                          <TableCell className="font-mono text-xs">{o.batch?.batch_number}</TableCell>
                          <TableCell>{o.cut_name_ar}</TableCell>
                          <TableCell>{Number(o.actual_weight_kg).toFixed(2)} كجم</TableCell>
                          <TableCell><Badge variant={q.variant}>{q.label}</Badge></TableCell>
                          <TableCell className="text-xs text-muted-foreground">{o.received_at ? new Date(o.received_at).toLocaleString("ar-EG") : '—'}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* MOVEMENTS */}
          <TabsContent value="movements" className="space-y-4">
            <Card><CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>التاريخ</TableHead>
                    <TableHead>النوع</TableHead>
                    <TableHead>الصنف</TableHead>
                    <TableHead>المخزن</TableHead>
                    <TableHead>الكمية</TableHead>
                    <TableHead>الوجهة/الجهة</TableHead>
                    <TableHead>المرجع</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movements.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">لا توجد حركات</TableCell></TableRow>
                  ) : movements.map(m => {
                    const cfg = movementTypeLabels[m.movement_type];
                    const Icon = cfg?.icon || ArrowDown;
                    return (
                      <TableRow key={m.id}>
                        <TableCell className="text-xs">{new Date(m.performed_at).toLocaleString("ar-EG")}</TableCell>
                        <TableCell><Badge variant={cfg?.variant || "outline"} className="gap-1"><Icon className="w-3 h-3" />{cfg?.label || m.movement_type}</Badge></TableCell>
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

          {/* LOW STOCK */}
          <TabsContent value="low" className="space-y-4">
            {lowStockItems.length === 0 ? (
              <Card><CardContent className="py-12 text-center text-muted-foreground">لا توجد أصناف منخفضة المخزون</CardContent></Card>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {lowStockItems.map(it => (
                  <Card key={it.id} className="border-destructive">
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-destructive" />{it.name}</CardTitle>
                          <CardDescription>{it.warehouse?.name}</CardDescription>
                        </div>
                        <Badge variant="destructive">{it.stock} {it.unit}</Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="text-sm text-muted-foreground">الحد الأدنى: {it.low_stock_threshold} {it.unit}</CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* WAREHOUSES */}
          <TabsContent value="warehouses" className="space-y-4">
            <div className="flex justify-end">
              {canManageWarehouses && (
                <Button onClick={() => openWhDialog()}><Plus className="w-4 h-4 ml-2" />مخزن جديد</Button>
              )}
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {warehouses.length === 0 ? (
                <Card className="md:col-span-2 lg:col-span-3"><CardContent className="py-8 text-center text-muted-foreground">لا توجد مخازن. أضف مخزناً للبدء.</CardContent></Card>
              ) : warehouses.map(w => {
                const whItems = items.filter(i => i.warehouse_id === w.id);
                return (
                  <Card key={w.id}>
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="text-lg flex items-center gap-2"><Warehouse className="w-5 h-5 text-primary" />{w.name}</CardTitle>
                          <CardDescription>{warehouseTypes[w.type] || w.type}{w.location && ` • ${w.location}`}</CardDescription>
                        </div>
                        {canManageWarehouses && (
                          <div className="flex gap-1">
                            <Button size="sm" variant="ghost" onClick={() => openWhDialog(w)}><Edit className="w-4 h-4" /></Button>
                            <Button size="sm" variant="ghost" onClick={() => setDeleteTarget({ type: "warehouse", id: w.id, name: w.name })}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                          </div>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="text-sm text-muted-foreground">{whItems.length} صنف</div>
                      {w.description && <p className="text-xs text-muted-foreground mt-2">{w.description}</p>}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Warehouse Dialog */}
      <Dialog open={whDialog} onOpenChange={setWhDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editWh ? "تعديل المخزن" : "مخزن جديد"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>الاسم</Label><Input value={whForm.name} onChange={e => setWhForm({ ...whForm, name: e.target.value })} /></div>
            <div>
              <Label>النوع</Label>
              <Select value={whForm.type} onValueChange={v => setWhForm({ ...whForm, type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(warehouseTypes).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>الموقع</Label><Input value={whForm.location} onChange={e => setWhForm({ ...whForm, location: e.target.value })} /></div>
            <div><Label>الوصف</Label><Textarea value={whForm.description} onChange={e => setWhForm({ ...whForm, description: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWhDialog(false)}>إلغاء</Button>
            <Button onClick={saveWarehouse}>حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Item Dialog */}
      <Dialog open={itemDialog} onOpenChange={setItemDialog}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editItem ? "تعديل الصنف" : "صنف جديد"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>المخزن</Label>
              <Select value={itemForm.warehouse_id} onValueChange={v => setItemForm({ ...itemForm, warehouse_id: v })}>
                <SelectTrigger><SelectValue placeholder="اختر مخزناً" /></SelectTrigger>
                <SelectContent>{warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>الاسم</Label><Input value={itemForm.name} onChange={e => setItemForm({ ...itemForm, name: e.target.value })} /></div>
              <div><Label>SKU</Label><Input value={itemForm.sku} onChange={e => setItemForm({ ...itemForm, sku: e.target.value })} /></div>
              <div><Label>الفئة</Label><Input value={itemForm.category} onChange={e => setItemForm({ ...itemForm, category: e.target.value })} /></div>
              <div><Label>الوحدة</Label><Input value={itemForm.unit} onChange={e => setItemForm({ ...itemForm, unit: e.target.value })} /></div>
              <div><Label>الرصيد الحالي</Label><Input type="number" value={itemForm.stock} onChange={e => setItemForm({ ...itemForm, stock: Number(e.target.value) })} /></div>
              <div><Label>الحد الأدنى</Label><Input type="number" value={itemForm.low_stock_threshold} onChange={e => setItemForm({ ...itemForm, low_stock_threshold: Number(e.target.value) })} /></div>
              <div><Label>تكلفة الوحدة</Label><Input type="number" step="0.01" value={itemForm.unit_cost} onChange={e => setItemForm({ ...itemForm, unit_cost: Number(e.target.value) })} /></div>
              <div><Label>تاريخ الصلاحية</Label><Input type="date" value={itemForm.expiry_date} onChange={e => setItemForm({ ...itemForm, expiry_date: e.target.value })} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setItemDialog(false)}>إلغاء</Button>
            <Button onClick={saveItem}>حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Movement Dialog */}
      <Dialog open={moveDialog} onOpenChange={setMoveDialog}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>حركة مخزون جديدة</DialogTitle>
            <DialogDescription>إضافة (in) أو صرف (out) أو تحويل بين مخازن أو تسوية</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>نوع الحركة</Label>
              <Select value={moveForm.movement_type} onValueChange={v => setMoveForm({ ...moveForm, movement_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(movementTypeLabels).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>الصنف</Label>
              <Select value={moveForm.item_id} onValueChange={v => setMoveForm({ ...moveForm, item_id: v })}>
                <SelectTrigger><SelectValue placeholder="اختر صنفاً" /></SelectTrigger>
                <SelectContent>
                  {items.map(it => <SelectItem key={it.id} value={it.id}>{it.name} — {it.warehouse?.name} (متاح: {it.stock} {it.unit})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>الكمية</Label><Input type="number" step="0.01" value={moveForm.quantity} onChange={e => setMoveForm({ ...moveForm, quantity: Number(e.target.value) })} /></div>
            {moveForm.movement_type === "transfer" && (
              <div>
                <Label>المخزن الوجهة</Label>
                <Select value={moveForm.destination_warehouse_id} onValueChange={v => setMoveForm({ ...moveForm, destination_warehouse_id: v })}>
                  <SelectTrigger><SelectValue placeholder="اختر مخزناً" /></SelectTrigger>
                  <SelectContent>{warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            {(moveForm.movement_type === "in" || moveForm.movement_type === "out") && (
              <div><Label>الجهة (المورد/المستفيد)</Label><Input value={moveForm.party} onChange={e => setMoveForm({ ...moveForm, party: e.target.value })} /></div>
            )}
            <div><Label>المرجع (رقم فاتورة/إذن...)</Label><Input value={moveForm.reference} onChange={e => setMoveForm({ ...moveForm, reference: e.target.value })} /></div>
            <div><Label>ملاحظات</Label><Textarea value={moveForm.notes} onChange={e => setMoveForm({ ...moveForm, notes: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveDialog(false)}>إلغاء</Button>
            <Button onClick={saveMovement}>تسجيل الحركة</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Receive slaughter output dialog */}
      <Dialog open={!!receiveTarget} onOpenChange={(o) => !o && setReceiveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Beef className="w-5 h-5 text-primary" /> استلام من المجزر</DialogTitle>
            <DialogDescription>
              استلام {receiveTarget?.cut_name_ar} ({Number(receiveTarget?.actual_weight_kg || 0).toFixed(2)} كجم) من الدفعة {receiveTarget?.batch?.batch_number}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>المخزن المستلم</Label>
              <Select value={receiveWarehouseId} onValueChange={setReceiveWarehouseId}>
                <SelectTrigger><SelectValue placeholder="اختر مخزناً" /></SelectTrigger>
                <SelectContent>
                  {warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name} — {warehouseTypes[w.type] || w.type}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-2">سيُضاف الصنف للمخزون تلقائيًا، وإن لم يكن موجوداً سيُنشأ صنف جديد.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReceiveTarget(null)}>إلغاء</Button>
            <Button onClick={confirmReceive}><CheckCircle2 className="w-4 h-4 ml-1" /> تأكيد الاستلام</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد الحذف</AlertDialogTitle>
            <AlertDialogDescription>هل أنت متأكد من حذف "{deleteTarget?.name}"؟</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={performDelete} className="bg-destructive text-destructive-foreground">حذف</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
};

export default Warehouses;
