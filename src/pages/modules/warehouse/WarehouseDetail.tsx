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
import { Textarea } from "@/components/ui/textarea";
import { ArrowRight, Warehouse, Package, AlertTriangle, ArrowDown, ArrowUp, ArrowLeftRight, Settings2, Truck, FileSpreadsheet, Inbox, Send, CheckCircle2, Clock, XCircle, ShieldCheck, ThumbsDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { formatDateTime } from "@/lib/dateFormat";
import { printSupplyRequest } from "@/lib/printUtils";
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
  const [transfers, setTransfers] = useState<any[]>([]);
  const [outletOrders, setOutletOrders] = useState<any[]>([]);
  const [receiveDialog, setReceiveDialog] = useState<any>(null); // transfer obj
  const [receiveLines, setReceiveLines] = useState<Record<string, { qty: number; notes: string }>>({});
  const [receiveHeaderNotes, setReceiveHeaderNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const isAgouza = useMemo(() => !!warehouse && (warehouse.name?.includes("العجوزة") || warehouse.location?.includes("العجوزة")), [warehouse]);
  const mainWarehouse = useMemo(() => allWarehouses.find(w => w.id !== id && (w.name?.includes("الرئيسي") || w.name?.includes("المقر"))) || allWarehouses.find(w => w.id !== id && w.type === "finished_goods"), [allWarehouses, id]);

  const fetchAll = async () => {
    if (!id) return;
    setLoading(true);
    // نافذة الاحتياج = آخر 24 ساعة + كل الأوردرات المعلقة (غير المسلَّمة/الملغاة) بصرف النظر عن تاريخها
    const sinceISO = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    // اجلب المخزن الحالى وقائمة المخازن أولاً لمعرفة هل هو العجوزة (وبالتالى نوسع نطاق الحركات/التحويلات)
    const [wRes, allRes] = await Promise.all([
      supabase.from("warehouses").select("*").eq("id", id).maybeSingle(),
      supabase.from("warehouses").select("*").order("name"),
    ]);
    const allWh = allRes.data || [];
    const currentIsAgouza = !!wRes.data && (wRes.data.name?.includes("العجوزة") || wRes.data.location?.includes("العجوزة"));
    const mainWh = allWh.find((w: any) => w.id !== id && (w.name?.includes("الرئيسي") || w.name?.includes("المقر"))) || allWh.find((w: any) => w.id !== id && w.type === "finished_goods");
    // عند العرض من العجوزة نعرض حركات وتحويلات كل من العجوزة والمخزن الرئيسي
    const scopeIds = currentIsAgouza && mainWh ? [id, mainWh.id] : [id];
    const mvFilter = scopeIds.flatMap(w => [`warehouse_id.eq.${w}`, `destination_warehouse_id.eq.${w}`]).join(",");
    const trFilter = scopeIds.flatMap(w => [`source_warehouse_id.eq.${w}`, `destination_warehouse_id.eq.${w}`]).join(",");
    const [it, mv, oi, tr] = await Promise.all([
      supabase.from("inventory_items").select("*").eq("warehouse_id", id).order("name"),
      supabase.from("inventory_movements")
        .select("*, item:inventory_items(name, unit), warehouse:warehouses!inventory_movements_warehouse_id_fkey(name), destination:warehouses!inventory_movements_destination_warehouse_id_fkey(name)")
        .or(mvFilter)
        .order("performed_at", { ascending: false })
        .limit(500),
      supabase.from("order_items")
        .select("product_name, quantity, orders!inner(created_at, status, customer:customers(governorate))")
        .or(`created_at.gte.${sinceISO},status.in.(pending,confirmed,processing,ready,shipped,out_for_delivery)`, { foreignTable: "orders" })
        .neq("orders.status", "cancelled")
        .limit(2000),
      supabase.from("warehouse_transfers")
        .select("*, source:warehouses!warehouse_transfers_source_warehouse_id_fkey(name), destination:warehouses!warehouse_transfers_destination_warehouse_id_fkey(name), items:warehouse_transfer_items(*)")
        .or(trFilter)
        .order("created_at", { ascending: false })
        .limit(200),
    ]);
    setWarehouse(wRes.data);
    setAllWarehouses(allWh);
    setItems(it.data || []);
    setMovements(mv.data || []);
    setOrderItems(oi.data || []);
    setTransfers(tr.data || []);
    // طلبات المنفذ (مصدرها هذا المخزن) — للعرض والتصدير لاحمد خاطر فى العجوزة وأى مخزن آخر
    const { data: ords } = await supabase
      .from("orders")
      .select("id, order_number, created_at, status, fulfillment_type, total_amount, payment_status, payment_method, customer:customers(name, phone, governorate), order_items(product_name, quantity, unit_price, total_price)")
      .eq("source_warehouse_id", id)
      .order("created_at", { ascending: false })
      .limit(2000);
    setOutletOrders(ords || []);
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

    // Resolve source item IDs by name from main warehouse
    const { data: mainItems } = await supabase
      .from("inventory_items")
      .select("id, name, stock")
      .eq("warehouse_id", mainWarehouse.id);

    const lines: Array<{ source_item_id: string; qty: number }> = [];
    const missing: string[] = [];
    const insufficient: string[] = [];
    for (const [name, qty] of requested) {
      const src = (mainItems || []).find((m: any) => m.name?.trim() === name.trim());
      if (!src) { missing.push(name); continue; }
      if (Number(src.stock) < qty) { insufficient.push(`${name} (متاح ${src.stock})`); continue; }
      lines.push({ source_item_id: src.id, qty });
    }

    if (lines.length === 0) {
      toast({ title: "لا يمكن التنفيذ", description: `مفقود: ${missing.length} • غير كافٍ: ${insufficient.length}`, variant: "destructive" });
      return;
    }

    setSubmitting(true);
    const { data, error } = await supabase.rpc("request_warehouse_transfer", {
      p_source_warehouse_id: mainWarehouse.id,
      p_destination_warehouse_id: id!,
      p_lines: lines,
      p_notes: `طلب توريد ${warehouse?.name || ""} - ${new Date().toLocaleDateString("ar-EG")}`,
    });
    setSubmitting(false);

    if (error) {
      toast({ title: "فشل تقديم الطلب", description: error.message, variant: "destructive" });
      return;
    }

    const result = data as any;
    toast({
      title: "تم تقديم الطلب للموافقة",
      description: `رقم الطلب ${result?.transfer_no} • ${result?.lines} صنف • بانتظار موافقة الإدارة / مشرف المخازن`,
    });
    // طباعة فورية للكميات المطلوبة من المخزن الرئيسي
    try {
      const printLines = requested.map(([name, qty]) => {
        const need = supplyNeeds.find(n => n.name === name);
        return { name, qty: Number(qty), unit: need?.unit || "قطعة" };
      });
      printSupplyRequest(printLines, {
        transferNo: result?.transfer_no,
        fromWarehouse: mainWarehouse?.name,
        toWarehouse: warehouse?.name,
        notes: `طلب توريد ${warehouse?.name || ""} - ${new Date().toLocaleDateString("ar-EG")}`,
      });
    } catch {}
    setSupplyDialog(false);
    fetchAll();
  };

  // Approval actions (Main warehouse manager / Hadi / GM / Executive)
  const [approveDialog, setApproveDialog] = useState<any>(null); // transfer obj
  const [approveQty, setApproveQty] = useState<Record<string, number>>({});

  const openApproveDialog = (t: any) => {
    const init: Record<string, number> = {};
    (t.items || []).forEach((li: any) => { init[li.id] = Number(li.requested_qty); });
    setApproveQty(init);
    setApproveDialog(t);
  };

  const submitApprove = async () => {
    if (!approveDialog) return;
    const approved_lines = Object.entries(approveQty).map(([line_id, qty]) => ({ line_id, approved_qty: Number(qty) }));
    setSubmitting(true);
    const { error } = await supabase.rpc("approve_warehouse_transfer", {
      p_transfer_id: approveDialog.id,
      p_approved_lines: approved_lines,
    });
    setSubmitting(false);
    if (error) {
      toast({ title: "تعذرت الموافقة", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "تمت الموافقة وتم خصم المخزون", description: "الطلب الآن بانتظار الاستلام لدى الفرع" });
    setApproveDialog(null);
    fetchAll();
  };

  const rejectTransfer = async (t: any) => {
    const reason = window.prompt(`سبب رفض طلب ${t.transfer_no}؟`);
    if (!reason || reason.trim().length < 3) return;
    setSubmitting(true);
    const { error } = await supabase.rpc("reject_warehouse_transfer", {
      p_transfer_id: t.id, p_reason: reason.trim(),
    });
    setSubmitting(false);
    if (error) {
      toast({ title: "تعذر الرفض", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "تم رفض الطلب" });
    fetchAll();
  };

  const openReceiveDialog = (t: any) => {
    const init: Record<string, { qty: number; notes: string }> = {};
    (t.items || []).forEach((li: any) => {
      init[li.id] = { qty: Number(li.sent_qty), notes: li.receive_notes || "" };
    });
    setReceiveLines(init);
    setReceiveHeaderNotes("");
    setReceiveDialog(t);
  };

  const confirmReceipt = async () => {
    if (!receiveDialog) return;
    const lines = Object.entries(receiveLines).map(([line_id, v]) => ({
      line_id, received_qty: v.qty, notes: v.notes || null,
    }));
    setSubmitting(true);
    const { data, error } = await supabase.rpc("confirm_transfer_receipt", {
      p_transfer_id: receiveDialog.id,
      p_lines: lines,
      p_notes: receiveHeaderNotes || null,
    });
    setSubmitting(false);
    if (error) {
      toast({ title: "فشل تأكيد الاستلام", description: error.message, variant: "destructive" });
      return;
    }
    const r = data as any;
    toast({
      title: r?.already_received ? "هذا التحويل تم استلامه بالفعل" : "تم تأكيد الاستلام",
      description: `الحالة: ${statusLabel(r?.status)} • مرسل ${r?.total_sent} • مستلم ${r?.total_received}`,
    });
    setReceiveDialog(null);
    fetchAll();
  };

  const statusLabel = (s?: string) => ({
    draft: "مسودة", sent: "مرسل", pending_approval: "بانتظار الموافقة",
    pending_receipt: "بانتظار الاستلام",
    partially_received: "استلام جزئي", received: "تم الاستلام",
    needs_manager_review: "يحتاج مراجعة", cancelled: "ملغي", rejected: "مرفوض",
  } as any)[s || ""] || s || "—";

  const statusBadge = (s?: string) => {
    const map: Record<string, { cls: string; Icon: any }> = {
      pending_approval: { cls: "bg-yellow-500/10 text-yellow-700 border-yellow-500/30", Icon: ShieldCheck },
      pending_receipt: { cls: "bg-amber-500/10 text-amber-600 border-amber-500/30", Icon: Clock },
      partially_received: { cls: "bg-orange-500/10 text-orange-600 border-orange-500/30", Icon: AlertTriangle },
      received: { cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30", Icon: CheckCircle2 },
      needs_manager_review: { cls: "bg-purple-500/10 text-purple-600 border-purple-500/30", Icon: AlertTriangle },
      cancelled: { cls: "bg-muted text-muted-foreground border-border", Icon: XCircle },
      rejected: { cls: "bg-destructive/10 text-destructive border-destructive/30", Icon: ThumbsDown },
      sent: { cls: "bg-blue-500/10 text-blue-600 border-blue-500/30", Icon: Send },
      draft: { cls: "bg-muted text-muted-foreground", Icon: Clock },
    };
    const cfg = map[s || ""] || map.pending_receipt;
    const Icon = cfg.Icon;
    return <Badge variant="outline" className={`gap-1 ${cfg.cls}`}><Icon className="w-3 h-3" />{statusLabel(s)}</Badge>;
  };

  const outgoingTransfers = transfers.filter(t => t.source_warehouse_id === id);
  const incomingPending = transfers.filter(t => t.destination_warehouse_id === id && ["pending_receipt", "partially_received", "needs_manager_review"].includes(t.status));
  const incomingAll = transfers.filter(t => t.destination_warehouse_id === id);
  // Requests awaiting MY approval (I am the source warehouse, status pending_approval)
  const awaitingMyApproval = transfers.filter(t => t.source_warehouse_id === id && t.status === "pending_approval");
  // My own pending requests (I am destination, awaiting approval at source)
  const myPendingRequests = transfers.filter(t => t.destination_warehouse_id === id && ["pending_approval","rejected"].includes(t.status));

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

        <Tabs defaultValue={awaitingMyApproval.length > 0 ? "approvals" : (incomingPending.length > 0 ? "incoming" : "items")}>
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="items">الأصناف</TabsTrigger>
            <TabsTrigger value="movements">الحركات</TabsTrigger>
            <TabsTrigger value="low">منخفضة {lowStock.length > 0 && <Badge variant="destructive" className="mr-2">{lowStock.length}</Badge>}</TabsTrigger>
            {awaitingMyApproval.length > 0 && (
              <TabsTrigger value="approvals" className="gap-1">
                <ShieldCheck className="w-4 h-4" />بانتظار موافقتى
                <Badge variant="destructive" className="mr-1">{awaitingMyApproval.length}</Badge>
              </TabsTrigger>
            )}
            {isAgouza && myPendingRequests.length > 0 && (
              <TabsTrigger value="mypending" className="gap-1">
                <Clock className="w-4 h-4" />طلباتى المعلقة
                <Badge variant="secondary" className="mr-1">{myPendingRequests.length}</Badge>
              </TabsTrigger>
            )}
            <TabsTrigger value="incoming" className="gap-1">
              <Inbox className="w-4 h-4" />وارد بانتظار الاستلام
              {incomingPending.length > 0 && <Badge variant="destructive" className="mr-1">{incomingPending.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="outgoing" className="gap-1">
              <Send className="w-4 h-4" />تحويلات صادرة
              {outgoingTransfers.length > 0 && <Badge variant="secondary" className="mr-1">{outgoingTransfers.length}</Badge>}
            </TabsTrigger>
            {isAgouza && (
              <TabsTrigger value="supply" className="gap-1">
                <Truck className="w-4 h-4" />احتياج التوريد
                {supplyNeeds.length > 0 && <Badge variant="destructive" className="mr-1">{supplyNeeds.length}</Badge>}
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="approvals" className="space-y-4">
            {awaitingMyApproval.length === 0 ? (
              <Card><CardContent className="py-10 text-center text-muted-foreground">لا توجد طلبات بانتظار موافقتك</CardContent></Card>
            ) : awaitingMyApproval.map(t => (
              <Card key={t.id} className="border-yellow-500/40">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <CardTitle className="text-base flex items-center gap-2">
                        <ShieldCheck className="w-5 h-5 text-yellow-600" />
                        {t.transfer_no} • طلب من {t.destination?.name}
                      </CardTitle>
                      <CardDescription>{formatDateTime(t.created_at)} • {(t.items || []).length} صنف{t.notes ? ` • ${t.notes}` : ""}</CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      {statusBadge(t.status)}
                      <Button size="sm" onClick={() => openApproveDialog(t)}>
                        <CheckCircle2 className="w-4 h-4 ml-1" />موافقة / تعديل
                      </Button>
                      <Button size="sm" variant="outline" className="text-destructive border-destructive/40 hover:bg-destructive/10" onClick={() => rejectTransfer(t)}>
                        <ThumbsDown className="w-4 h-4 ml-1" />رفض
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>الصنف</TableHead><TableHead>الكمية المطلوبة</TableHead><TableHead>الوحدة</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {(t.items || []).map((li: any) => (
                        <TableRow key={li.id}>
                          <TableCell className="font-medium">{li.item_name}</TableCell>
                          <TableCell>{li.requested_qty}</TableCell>
                          <TableCell>{li.unit}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          <TabsContent value="mypending" className="space-y-4">
            {myPendingRequests.length === 0 ? (
              <Card><CardContent className="py-10 text-center text-muted-foreground">لا توجد طلبات معلقة</CardContent></Card>
            ) : myPendingRequests.map(t => (
              <Card key={t.id} className={t.status === "rejected" ? "border-destructive/40" : "border-yellow-500/40"}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <CardTitle className="text-base flex items-center gap-2">
                        <Clock className="w-5 h-5 text-yellow-600" />
                        {t.transfer_no} • إلى {t.source?.name}
                      </CardTitle>
                      <CardDescription>
                        {formatDateTime(t.created_at)} • {(t.items || []).length} صنف
                        {t.status === "rejected" && t.rejection_reason && (
                          <span className="block text-destructive mt-1">سبب الرفض: {t.rejection_reason}</span>
                        )}
                      </CardDescription>
                    </div>
                    {statusBadge(t.status)}
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>الصنف</TableHead><TableHead>المطلوب</TableHead><TableHead>الوحدة</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {(t.items || []).map((li: any) => (
                        <TableRow key={li.id}>
                          <TableCell className="font-medium">{li.item_name}</TableCell>
                          <TableCell>{li.requested_qty}</TableCell>
                          <TableCell>{li.unit}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <div className="p-3 border-t flex justify-end">
                    <Button size="sm" variant="outline" onClick={() => printSupplyRequest(
                      (t.items || []).map((li: any) => ({ name: li.item_name, qty: Number(li.requested_qty), unit: li.unit })),
                      { transferNo: t.transfer_no, fromWarehouse: t.source?.name, toWarehouse: t.destination?.name, notes: t.notes }
                    )}>
                      طباعة الكميات المطلوبة
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </TabsContent>


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
                    const pairedTransfer = transfers.find(t =>
                      (t.items || []).some((li: any) => li.source_movement_id === m.id || li.destination_movement_id === m.id)
                    );
                    return (
                      <TableRow key={m.id}>
                        <TableCell className="text-xs">{formatDateTime(m.performed_at)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 flex-wrap">
                            <Badge variant={cfg.variant} className="gap-1"><Icon className="w-3 h-3" />{cfg.label}{isIncoming && m.movement_type === "transfer" ? " (وارد)" : ""}</Badge>
                            {pairedTransfer && statusBadge(pairedTransfer.status)}
                          </div>
                        </TableCell>
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

          <TabsContent value="incoming" className="space-y-4">
            {incomingPending.length === 0 ? (
              <Card><CardContent className="py-10 text-center text-muted-foreground">لا توجد تحويلات بانتظار الاستلام</CardContent></Card>
            ) : incomingPending.map(t => (
              <Card key={t.id} className="border-amber-500/30">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <CardTitle className="text-base flex items-center gap-2">
                        <Inbox className="w-5 h-5 text-amber-600" />
                        {t.transfer_no} • من {t.source?.name}
                      </CardTitle>
                      <CardDescription>{formatDateTime(t.sent_at || t.created_at)} • {(t.items || []).length} صنف</CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      {statusBadge(t.status)}
                      {canManageWarehouses && (
                        <Button size="sm" onClick={() => openReceiveDialog(t)}>
                          <CheckCircle2 className="w-4 h-4 ml-1" />تأكيد الاستلام
                        </Button>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>الصنف</TableHead><TableHead>الكمية المرسلة</TableHead>
                      <TableHead>المستلم</TableHead><TableHead>نقص</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {(t.items || []).map((li: any) => (
                        <TableRow key={li.id}>
                          <TableCell className="font-medium">{li.item_name}</TableCell>
                          <TableCell>{li.sent_qty} {li.unit}</TableCell>
                          <TableCell>{li.received_qty ?? "—"}</TableCell>
                          <TableCell className={li.shortage_qty > 0 ? "text-destructive" : ""}>{li.shortage_qty || 0}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          <TabsContent value="outgoing" className="space-y-4">
            {outgoingTransfers.length === 0 ? (
              <Card><CardContent className="py-10 text-center text-muted-foreground">لا توجد تحويلات صادرة</CardContent></Card>
            ) : (
              <Card><CardContent className="p-0">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>رقم التحويل</TableHead><TableHead>التاريخ</TableHead>
                    <TableHead>إلى</TableHead><TableHead>الأصناف</TableHead><TableHead>الحالة</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {outgoingTransfers.map(t => (
                      <TableRow key={t.id}>
                        <TableCell className="font-mono text-xs">{t.transfer_no}</TableCell>
                        <TableCell className="text-xs">{formatDateTime(t.sent_at || t.created_at)}</TableCell>
                        <TableCell>{t.destination?.name}</TableCell>
                        <TableCell>{(t.items || []).length}</TableCell>
                        <TableCell>{statusBadge(t.status)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent></Card>
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
                        طلبات القاهرة/الجيزة (آخر 24 ساعة + كل الأوردرات المعلقة) مقابل الرصيد الحالي بمخزن العجوزة
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

      {/* Approve Transfer Request Dialog */}
      <Dialog open={!!approveDialog} onOpenChange={(o) => !o && setApproveDialog(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>الموافقة على طلب {approveDialog?.transfer_no}</DialogTitle>
            <DialogDescription>
              من {approveDialog?.destination?.name}. يمكنك تعديل الكميات قبل الموافقة. عند الموافقة سيُخصم المخزون فوراً من {warehouse?.name} وينتقل الطلب لحالة "بانتظار الاستلام".
            </DialogDescription>
          </DialogHeader>
          <Table>
            <TableHeader><TableRow>
              <TableHead>الصنف</TableHead><TableHead>المطلوب</TableHead><TableHead>الموافق عليها</TableHead><TableHead>الوحدة</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {(approveDialog?.items || []).map((li: any) => (
                <TableRow key={li.id}>
                  <TableCell className="font-medium">{li.item_name}</TableCell>
                  <TableCell>{li.requested_qty}</TableCell>
                  <TableCell>
                    <Input type="number" min={0} max={Number(li.requested_qty)} className="w-24"
                      value={approveQty[li.id] ?? 0}
                      onChange={e => setApproveQty({ ...approveQty, [li.id]: Number(e.target.value) })} />
                  </TableCell>
                  <TableCell>{li.unit}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setApproveDialog(null)}>إلغاء</Button>
            <Button onClick={submitApprove} disabled={submitting}>
              <CheckCircle2 className="w-4 h-4 ml-1" />موافقة وصرف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Receive Confirmation Dialog — posts destination IN movement on confirm */}
      <Dialog open={!!receiveDialog} onOpenChange={(o) => !o && setReceiveDialog(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>تأكيد استلام التحويل {receiveDialog?.transfer_no}</DialogTitle>
            <DialogDescription>
              من {receiveDialog?.source?.name}. عند التأكيد، تُضاف الكمية المستلمة لمخزون {warehouse?.name}. الكميات الناقصة أو المرفوضة لا تُضاف. استخدم "رفض" للأصناف غير المطابقة لإرجاعها للمخزن المصدر.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Table>
              <TableHeader><TableRow>
                <TableHead>الصنف</TableHead><TableHead>مرسل</TableHead>
                <TableHead>مستلم</TableHead><TableHead>ملاحظات (إلزامية للجزئي)</TableHead>
                <TableHead></TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {(receiveDialog?.items || []).map((li: any) => {
                  const v = receiveLines[li.id] || { qty: Number(li.sent_qty), notes: "" };
                  const diff = v.qty !== Number(li.sent_qty);
                  const finalized = ["received", "partial", "rejected"].includes(li.line_status);
                  return (
                    <TableRow key={li.id}>
                      <TableCell className="font-medium">
                        {li.item_name}
                        {finalized && <Badge variant="outline" className="mr-2">{statusLabel(li.line_status)}</Badge>}
                      </TableCell>
                      <TableCell>{li.sent_qty} {li.unit}</TableCell>
                      <TableCell>
                        <Input type="number" min={0} max={Number(li.sent_qty)} className="w-24"
                          disabled={finalized}
                          value={v.qty}
                          onChange={e => setReceiveLines({ ...receiveLines, [li.id]: { ...v, qty: Number(e.target.value) } })} />
                      </TableCell>
                      <TableCell>
                        <Input
                          placeholder={diff ? "إلزامي" : "اختياري"}
                          disabled={finalized}
                          className={diff && !v.notes ? "border-destructive" : ""}
                          value={v.notes}
                          onChange={e => setReceiveLines({ ...receiveLines, [li.id]: { ...v, notes: e.target.value } })} />
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm" variant="ghost"
                          disabled={finalized || submitting}
                          className="text-destructive hover:text-destructive"
                          onClick={async () => {
                            const reason = window.prompt(`سبب رفض "${li.item_name}" (تلف / غير مطابق / جودة سيئة...)`);
                            if (!reason || !reason.trim()) return;
                            setSubmitting(true);
                            const { error } = await supabase.rpc("reject_transfer_line", {
                              p_line_id: li.id, p_reason: reason.trim(),
                            });
                            setSubmitting(false);
                            if (error) {
                              toast({ title: "تعذّر رفض السطر", description: error.message, variant: "destructive" });
                              return;
                            }
                            toast({ title: "تم رفض السطر وإرجاع الكمية للمخزن المصدر" });
                            setReceiveDialog(null);
                            fetchAll();
                          }}>
                          <XCircle className="w-4 h-4 ml-1" />رفض
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <Textarea placeholder="ملاحظات عامة على الاستلام (اختياري)" value={receiveHeaderNotes}
              onChange={e => setReceiveHeaderNotes(e.target.value)} />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setReceiveDialog(null)}>إلغاء</Button>
            <Button variant="secondary" disabled={submitting} onClick={() => {
              const init: Record<string, { qty: number; notes: string }> = {};
              (receiveDialog?.items || []).forEach((li: any) => {
                init[li.id] = { qty: Number(li.sent_qty), notes: "" };
              });
              setReceiveLines(init);
              setTimeout(confirmReceipt, 0);
            }}>
              <CheckCircle2 className="w-4 h-4 ml-1" />تأكيد الاستلام الكامل
            </Button>
            <Button disabled={submitting} onClick={confirmReceipt}>تأكيد كما هو</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default WarehouseDetail;
