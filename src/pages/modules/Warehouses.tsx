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
import { Plus, Warehouse, Trash2, Edit, ArrowDown, ArrowUp, ArrowLeftRight, Settings2, Package, AlertTriangle, BarChart3, Upload, Beef, CheckCircle2, Printer, FileSpreadsheet, FileText, MapPin } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { formatDateTime } from "@/lib/dateFormat";
import * as XLSX from "xlsx";
import companyLogo from "@/assets/company-logo.jpg";

const qualityLabelText: Record<string, string> = {
  accepted: "مقبول",
  rejected: "مرفوض",
  quarantine: "حجر صحي",
};

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

function exportPendingBatchPDF(b: any) {
  const totalKg = b.outputs.reduce((s: number, o: any) => s + Number(o.actual_weight_kg || 0), 0);
  const totalCost = b.outputs.reduce((s: number, o: any) => s + Number(o.actual_weight_kg || 0) * Number(o.unit_cost || 0), 0);
  const rows = b.outputs.map((o: any, i: number) => `
    <tr>
      <td>${i + 1}</td>
      <td>${esc(o.cut_name_ar || "")}</td>
      <td>${Number(o.actual_weight_kg || 0).toFixed(2)}</td>
      <td>${Number(o.unit_cost || 0).toFixed(2)}</td>
      <td>${(Number(o.actual_weight_kg || 0) * Number(o.unit_cost || 0)).toFixed(2)}</td>
      <td>${esc(qualityLabelText[o.quality_status] || "—")}</td>
    </tr>`).join("");
  const html = `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"/>
    <title>دفعة ${esc(b.batch_number)}</title>
    <style>
      @page { size: A4; margin: 14mm; }
      body { font-family: "Segoe UI", Tahoma, Arial, sans-serif; color: #111; }
      .header { display:flex; align-items:center; justify-content:space-between; border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 14px; }
      .header img { height: 70px; }
      .title { text-align:center; }
      .title h1 { margin:0; font-size: 22px; }
      .title p { margin:2px 0; color:#555; font-size: 12px; }
      .meta { display:grid; grid-template-columns: repeat(3, 1fr); gap:8px; margin-bottom:12px; font-size: 13px; }
      .meta div { background:#f5f5f5; padding:8px; border-radius:6px; }
      table { width:100%; border-collapse: collapse; font-size: 13px; }
      th, td { border:1px solid #ccc; padding:6px 8px; text-align:right; }
      th { background:#f0f0f0; }
      tfoot td { font-weight:bold; background:#fafafa; }
      .sign { display:grid; grid-template-columns: repeat(3,1fr); gap:16px; margin-top:28px; font-size:12px; }
      .sign div { border-top:1px solid #333; padding-top:6px; text-align:center; }
      @media print { .no-print { display:none; } }
      .bar { text-align:center; margin-bottom:10px; }
      .bar button { padding:8px 18px; font-size:14px; cursor:pointer; }
    </style></head><body>
    <div class="bar no-print"><button onclick="window.print()">طباعة / حفظ PDF</button></div>
    <div class="header">
      <img src="${companyLogo}" />
      <div class="title">
        <h1>إيصال استلام دفعة ذبح</h1>
        <p>كابيتال أوستريش</p>
        <p>تاريخ الإصدار: ${new Date().toLocaleString("ar-EG")}</p>
      </div>
      <div style="width:70px"></div>
    </div>
    <div class="meta">
      <div><strong>رقم الدفعة:</strong> ${esc(b.batch_number)}</div>
      <div><strong>تاريخ الذبح:</strong> ${esc(b.slaughter_date || "—")}</div>
      <div><strong>الحالة:</strong> ${esc(b.status === "completed" ? "مكتملة" : b.status === "in_progress" ? "جارية" : b.status || "—")}</div>
      <div><strong>عدد الأصناف:</strong> ${b.outputs.length}</div>
      <div><strong>إجمالي الوزن:</strong> ${totalKg.toFixed(2)} كجم</div>
      <div><strong>إجمالي التكلفة:</strong> ${totalCost.toFixed(2)} ج.م</div>
    </div>

    <table>
      <thead><tr>
        <th>م</th><th>الصنف</th><th>الوزن (كجم)</th><th>التكلفة/كجم</th><th>الإجمالي</th><th>الجودة</th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr>
        <td colspan="2">الإجماليات</td>
        <td>${totalKg.toFixed(2)}</td>
        <td>—</td>
        <td>${totalCost.toFixed(2)}</td>
        <td></td>
      </tr></tfoot>
    </table>
    <div class="sign">
      <div>أمين المخزن المستلم</div>
      <div>مشرف الإنتاج</div>
      <div>المراجعة</div>
    </div>
    <script>window.addEventListener('load',()=>setTimeout(()=>window.print(),400));</script>
    </body></html>`;
  const w = window.open("", "_blank", "width=900,height=700");
  if (!w) return;
  w.document.open(); w.document.write(html); w.document.close();
}

function exportPendingBatchExcel(b: any) {
  const rows = b.outputs.map((o: any, i: number) => ({
    "م": i + 1,
    "الصنف": o.cut_name_ar || "",
    "الوزن (كجم)": Number(o.actual_weight_kg || 0),
    "التكلفة/كجم": Number(o.unit_cost || 0),
    "إجمالي التكلفة": Number(o.actual_weight_kg || 0) * Number(o.unit_cost || 0),
    "الجودة": qualityLabelText[o.quality_status] || "",
  }));
  const totalKg = b.outputs.reduce((s: number, o: any) => s + Number(o.actual_weight_kg || 0), 0);
  const totalCost = b.outputs.reduce((s: number, o: any) => s + Number(o.actual_weight_kg || 0) * Number(o.unit_cost || 0), 0);
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [{ wch: 5 }, { wch: 28 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 12 }];
  const summary = XLSX.utils.json_to_sheet([
    { "البند": "رقم الدفعة", "القيمة": b.batch_number },
    { "البند": "تاريخ الذبح", "القيمة": b.slaughter_date || "—" },
    { "البند": "الحالة", "القيمة": b.status || "—" },
    { "البند": "عدد الأصناف", "القيمة": b.outputs.length },
    { "البند": "إجمالي الوزن (كجم)", "القيمة": totalKg.toFixed(2) },
    { "البند": "إجمالي التكلفة (ج.م)", "القيمة": totalCost.toFixed(2) },
    { "البند": "تاريخ الإصدار", "القيمة": new Date().toLocaleString("ar-EG") },
  ]);
  summary["!cols"] = [{ wch: 22 }, { wch: 28 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "الأصناف");
  XLSX.utils.book_append_sheet(wb, summary, "الملخص");
  XLSX.writeFile(wb, `استلام-دفعة-${b.batch_number}.xlsx`);
}

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
  const { canManageWarehouses, user, isGeneralManager } = useAuth();
  const { toast } = useToast();
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [slaughterOutputs, setSlaughterOutputs] = useState<any[]>([]);
  const [receiveBatch, setReceiveBatch] = useState<{ batch_id: string; batch_number: string; slaughter_date?: string; status?: string; outputs: any[] } | null>(null);
  const [receiveWarehouseId, setReceiveWarehouseId] = useState<string>("");
  const [verifyMap, setVerifyMap] = useState<Record<string, { received_weight_kg: number; quality_status: string; notes: string }>>({});
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

  const [recentOrders, setRecentOrders] = useState<any[]>([]);

  const fetchAll = async () => {
    setLoading(true);
    const sinceISO = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const [w, i, m, s, o] = await Promise.all([
      supabase.from("warehouses").select("*").order("name"),
      supabase.from("inventory_items").select("*, warehouse:warehouses(name)").order("name"),
      supabase.from("inventory_movements").select("*, item:inventory_items(name, unit), warehouse:warehouses!inventory_movements_warehouse_id_fkey(name), destination:warehouses!inventory_movements_destination_warehouse_id_fkey(name)").order("performed_at", { ascending: false }).limit(200),
      supabase.from("slaughter_batch_outputs")
        .select("id, batch_id, cut_name_ar, actual_weight_kg, unit_cost, quality_status, received_status, received_at, received_warehouse_id, batch:slaughter_batches(batch_number, slaughter_date, status)")
        .in("destination", ["warehouse", "branch", "meat_factory"])
        .order("created_at", { ascending: false })
        .limit(300),
      supabase.from("orders")
        .select("id, order_number, total, status, created_at, customer:customers(governorate, city, name)")
        .gte("created_at", sinceISO)
        .neq("status", "cancelled")
        .limit(1000),
    ]);
    if (w.data) setWarehouses(w.data as WarehouseRow[]);
    if (i.data) setItems(i.data as InventoryItem[]);
    if (m.data) setMovements(m.data as Movement[]);
    if (s.data) setSlaughterOutputs(s.data as any[]);
    if (o.data) setRecentOrders(o.data as any[]);
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

    // Transfers MUST go through create_and_send_transfer RPC so they appear
    // in "وارد بانتظار الاستلام" at the destination and stock only lands
    // after receipt confirmation.
    if (moveForm.movement_type === "transfer") {
      const { data, error } = await supabase.rpc("create_and_send_transfer", {
        p_source_warehouse_id: item.warehouse_id,
        p_destination_warehouse_id: moveForm.destination_warehouse_id,
        p_lines: [{ source_item_id: item.id, qty: moveForm.quantity }],
        p_notes: moveForm.notes || moveForm.reference || null,
      });
      if (error) { toast({ title: "فشل إنشاء التحويل", description: error.message, variant: "destructive" }); return; }
      const r = data as any;
      toast({
        title: "تم إرسال التحويل",
        description: `رقم ${r?.transfer_no} • بانتظار استلام الوجهة (لن يُضاف للمخزون إلا بعد التأكيد)`,
      });
      setMoveDialog(false);
      fetchAll();
      return;
    }

    // Non-transfer movements (in / out / adjustment) — direct insert as before
    const payload = {
      item_id: moveForm.item_id,
      warehouse_id: item.warehouse_id,
      movement_type: moveForm.movement_type,
      quantity: moveForm.quantity,
      destination_warehouse_id: null,
      reference: moveForm.reference || null,
      party: moveForm.party || null,
      notes: moveForm.notes || null,
      unit_cost: item.unit_cost,
      performed_by: user?.id,
    };
    const { error } = await supabase.from("inventory_movements").insert(payload);
    if (error) { toast({ title: "خطأ", description: error.message, variant: "destructive" }); return; }

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
    const map: Record<string, { received_weight_kg: number; quality_status: string; notes: string }> = {};
    batch.outputs.forEach((o: any) => {
      map[o.id] = {
        received_weight_kg: Number(o.actual_weight_kg || 0),
        quality_status: o.quality_status || 'accepted',
        notes: '',
      };
    });
    setVerifyMap(map);
  };

  const confirmReceiveBatch = async () => {
    if (!receiveBatch || !receiveWarehouseId) {
      toast({ title: "خطأ", description: "اختر المخزن", variant: "destructive" });
      return;
    }
    const items = receiveBatch.outputs.map((o: any) => ({
      id: o.id,
      received_weight_kg: verifyMap[o.id]?.received_weight_kg ?? Number(o.actual_weight_kg || 0),
      quality_status: verifyMap[o.id]?.quality_status ?? (o.quality_status || 'accepted'),
      notes: verifyMap[o.id]?.notes || null,
    }));
    const invalid = items.find(i => !isFinite(i.received_weight_kg) || i.received_weight_kg < 0);
    if (invalid) {
      toast({ title: "كمية غير صحيحة", description: "تحقق من الكميات المستلمة", variant: "destructive" });
      return;
    }
    setReceiving(true);
    const { data, error } = await supabase.rpc('receive_slaughter_batch_verified', {
      p_batch_id: receiveBatch.batch_id,
      p_warehouse_id: receiveWarehouseId,
      p_items: items as any,
    });
    setReceiving(false);
    if (error) {
      toast({ title: "خطأ", description: error.message, variant: "destructive" });
      return;
    }
    const r: any = data || {};
    toast({
      title: "تم الاستلام بعد التحقق",
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

  const exportInventorySummaryPDF = () => {
    const totalValue = items.reduce((s, i) => s + i.stock * i.unit_cost, 0);
    const activeWarehouses = warehouses.filter(w => w.is_active).length;
    const rows = (warehouseFilter === 'all' ? items : filteredItems).map((it, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${it.name}${it.sku ? ` <span style="color:#666;font-size:11px">(${it.sku})</span>` : ''}</td>
        <td>${it.warehouse?.name || '—'}</td>
        <td>${it.category || '—'}</td>
        <td>${it.stock}</td>
        <td>${it.unit}</td>
        <td>${it.unit_cost.toFixed(2)}</td>
        <td>${(it.stock * it.unit_cost).toFixed(2)}</td>
        <td style="color:${it.stock <= it.low_stock_threshold ? '#c0392b' : '#27ae60'};font-weight:bold">${it.stock <= it.low_stock_threshold ? 'منخفض' : 'جيد'}</td>
      </tr>`).join('');
    const html = `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"/>
      <title>تقرير ملخص المخزون</title>
      <style>
        @page { size: A4; margin: 12mm; }
        body { font-family: "Segoe UI", Tahoma, Arial, sans-serif; color: #111; }
        .header { display:flex; align-items:center; justify-content:space-between; border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 14px; }
        .header img { height: 70px; }
        .title { text-align:center; }
        .title h1 { margin:0; font-size: 20px; }
        .title p { margin:3px 0; color:#555; font-size: 12px; }
        .summary { display:grid; grid-template-columns: repeat(4, 1fr); gap:10px; margin-bottom:16px; }
        .summary div { background:#f8f9fa; border:1px solid #e1e4e8; padding:10px; border-radius:6px; text-align:center; }
        .summary div strong { display:block; font-size: 18px; color:#2c3e50; }
        .summary div span { font-size: 11px; color:#666; }
        table { width:100%; border-collapse: collapse; font-size: 12px; margin-top: 8px; }
        th, td { border:1px solid #ccc; padding:5px 7px; text-align:right; }
        th { background:#f0f0f0; font-weight:bold; }
        tfoot td { font-weight:bold; background:#fafafa; }
        .sign { display:grid; grid-template-columns: repeat(3,1fr); gap:16px; margin-top:24px; font-size:12px; }
        .sign div { border-top:1px solid #333; padding-top:6px; text-align:center; }
        @media print { .no-print { display:none; } }
        .bar { text-align:center; margin-bottom:10px; }
        .bar button { padding:8px 18px; font-size:14px; cursor:pointer; }
      </style></head><body>
      <div class="bar no-print"><button onclick="window.print()">طباعة / حفظ PDF</button></div>
      <div class="header">
        <img src="${companyLogo}" />
        <div class="title">
          <h1>تقرير ملخص المخزون والمنتجات</h1>
          <p>كابيتال أوستريش</p>
          <p>تاريخ الإصدار: ${new Date().toLocaleString("ar-EG")}</p>
        </div>
        <div style="width:70px"></div>
      </div>
      <div class="summary">
        <div><strong>${items.length}</strong><span>إجمالي الأصناف</span></div>
        <div><strong>${activeWarehouses}</strong><span>المخازن النشطة</span></div>
        <div><strong>${totalValue.toLocaleString()}</strong><span>قيمة المخزون (ج.م)</span></div>
        <div><strong style="color:#c0392b">${lowStockItems.length}</strong><span>أصناف منخفضة</span></div>
      </div>
      <table>
        <thead><tr>
          <th>م</th><th>الصنف</th><th>المخزن</th><th>الفئة</th><th>الرصيد</th><th>الوحدة</th><th>التكلفة</th><th>القيمة</th><th>الحالة</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr>
          <td colspan="7">الإجمالي</td>
          <td>${totalValue.toFixed(2)}</td>
          <td></td>
        </tr></tfoot>
      </table>
      <div class="sign">
        <div>أمين المخزن</div>
        <div>المسؤول المالي</div>
        <div>الإدارة</div>
      </div>
      <script>window.addEventListener('load',()=>setTimeout(()=>window.print(),400));</script>
      </body></html>`;
    const w = window.open("", "_blank", "width=1000,height=800");
    if (!w) return;
    w.document.open(); w.document.write(html); w.document.close();
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
            <Button variant="outline" size="sm" onClick={exportInventorySummaryPDF}><FileText className="w-4 h-4 ml-2 text-red-600" />تقرير PDF</Button>
            {isGeneralManager && (<Link to="/modules/warehouses/import"><Button variant="outline" size="sm"><Upload className="w-4 h-4 ml-2" />استيراد CSV</Button></Link>)}
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
            <TabsTrigger value="distribution" className="gap-1"><MapPin className="w-4 h-4" />التوزيع الجغرافي</TabsTrigger>
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
                          <div className="flex items-center gap-2 flex-wrap">
                            <Button variant="outline" size="sm" onClick={() => exportPendingBatchPDF(b)}>
                              <Printer className="w-4 h-4 ml-1" /> طباعة / PDF
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => exportPendingBatchExcel(b)}>
                              <FileSpreadsheet className="w-4 h-4 ml-1 text-emerald-600" /> Excel
                            </Button>
                            {canManageWarehouses && (
                              <Button onClick={() => openReceiveBatch(b)}>
                                <ArrowDown className="w-4 h-4 ml-1" /> استلام الدفعة
                              </Button>
                            )}
                          </div>
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
                          <TableCell className="text-xs text-muted-foreground">{o.received_at ? formatDateTime(o.received_at) : '—'}</TableCell>
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
                        <TableCell className="text-xs">{formatDateTime(m.performed_at)}</TableCell>
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
                          <Link to={`/modules/warehouses/${w.id}`} className="group">
                            <CardTitle className="text-lg flex items-center gap-2 group-hover:text-primary transition-colors cursor-pointer">
                              <Warehouse className="w-5 h-5 text-primary" />
                              <span className="underline-offset-4 group-hover:underline">{w.name}</span>
                            </CardTitle>
                          </Link>
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

          {/* GEOGRAPHIC DISTRIBUTION */}
          <TabsContent value="distribution" className="space-y-4">
            {(() => {
              const CAIRO_GIZA = ["القاهرة", "الجيزة", "قاهره", "جيزه", "Cairo", "Giza"];
              const isCairoGiza = (g?: string) => !!g && CAIRO_GIZA.some(k => g.includes(k));
              const agouza = warehouses.find(w => w.name.includes("العجوزة"));
              const main = warehouses.find(w => w.name.includes("الرئيسي") || w.name.includes("المقر")) || warehouses[0];

              const byGov = new Map<string, { count: number; total: number; orders: any[] }>();
              recentOrders.forEach(o => {
                const g = o.customer?.governorate || "غير محدد";
                if (!byGov.has(g)) byGov.set(g, { count: 0, total: 0, orders: [] });
                const e = byGov.get(g)!;
                e.count++;
                e.total += Number(o.total || 0);
                e.orders.push(o);
              });
              const sorted = Array.from(byGov.entries()).sort((a, b) => b[1].count - a[1].count);
              const agouzaOrders = recentOrders.filter(o => isCairoGiza(o.customer?.governorate));
              const mainOrders = recentOrders.filter(o => !isCairoGiza(o.customer?.governorate));
              const sum = (arr: any[]) => arr.reduce((s, o) => s + Number(o.total || 0), 0);

              return (
                <>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Card className="border-orange-500/40">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                          <MapPin className="w-5 h-5 text-orange-500" />
                          {agouza?.name || "مخزن فرع العجوزة"}
                        </CardTitle>
                        <CardDescription>يخدم عملاء القاهرة والجيزة</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        <div className="flex justify-between"><span className="text-muted-foreground">طلبات (30 يوم):</span><strong>{agouzaOrders.length}</strong></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">إجمالي القيمة:</span><strong>{sum(agouzaOrders).toLocaleString()} ج.م</strong></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">أصناف بالمخزن:</span><strong>{agouza ? items.filter(i => i.warehouse_id === agouza.id).length : 0}</strong></div>
                      </CardContent>
                    </Card>
                    <Card className="border-primary/40">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                          <Warehouse className="w-5 h-5 text-primary" />
                          {main?.name || "المخزن الرئيسي - المقر"}
                        </CardTitle>
                        <CardDescription>يخدم باقي المحافظات</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        <div className="flex justify-between"><span className="text-muted-foreground">طلبات (30 يوم):</span><strong>{mainOrders.length}</strong></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">إجمالي القيمة:</span><strong>{sum(mainOrders).toLocaleString()} ج.م</strong></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">أصناف بالمخزن:</span><strong>{main ? items.filter(i => i.warehouse_id === main.id).length : 0}</strong></div>
                      </CardContent>
                    </Card>
                  </div>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">توزيع الطلبات حسب المحافظة (آخر 30 يوم)</CardTitle>
                      <CardDescription>المخزن المختص يتم اختياره يدوياً عند إنشاء/تجهيز الطلب</CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>المحافظة</TableHead>
                            <TableHead>عدد الطلبات</TableHead>
                            <TableHead>إجمالي القيمة</TableHead>
                            <TableHead>المخزن المُقترح</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {sorted.length === 0 ? (
                            <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">لا توجد طلبات حديثة</TableCell></TableRow>
                          ) : sorted.map(([gov, e]) => (
                            <TableRow key={gov}>
                              <TableCell className="font-medium">{gov}</TableCell>
                              <TableCell><Badge variant="outline">{e.count}</Badge></TableCell>
                              <TableCell>{e.total.toLocaleString()} ج.م</TableCell>
                              <TableCell>
                                {isCairoGiza(gov) ? (
                                  <Badge className="bg-orange-500/10 text-orange-600 hover:bg-orange-500/20 border-orange-500/30">فرع العجوزة</Badge>
                                ) : gov === "غير محدد" ? (
                                  <Badge variant="secondary">غير محدد</Badge>
                                ) : (
                                  <Badge variant="outline">المخزن الرئيسي</Badge>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                </>
              );
            })()}
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
          {(() => {
            const selectedWh = warehouses.find(w => w.id === itemForm.warehouse_id);
            const whType = selectedWh?.type;
            const sameTypeWhIds = new Set(warehouses.filter(w => w.type === whType).map(w => w.id));
            const catalogMap = new Map<string, InventoryItem>();
            for (const it of items) {
              if (!sameTypeWhIds.has(it.warehouse_id)) continue;
              const key = (it.name || "").trim().toLowerCase();
              if (!key || catalogMap.has(key)) continue;
              catalogMap.set(key, it);
            }
            const catalog = Array.from(catalogMap.values()).sort((a, b) => a.name.localeCompare(b.name, "ar"));
            const listId = `catalog-${whType || "all"}`;
            return (
              <div className="space-y-3">
                <div>
                  <Label>المخزن</Label>
                  <Select value={itemForm.warehouse_id} onValueChange={v => setItemForm({ ...itemForm, warehouse_id: v })}>
                    <SelectTrigger><SelectValue placeholder="اختر مخزناً" /></SelectTrigger>
                    <SelectContent>{warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name} — {warehouseTypes[w.type] || w.type}</SelectItem>)}</SelectContent>
                  </Select>
                  {whType && (
                    <div className="text-xs text-muted-foreground mt-1">
                      نوع المخزن: <span className="font-semibold">{warehouseTypes[whType] || whType}</span> — يُعرض فقط أصناف هذا النوع ({catalog.length})
                    </div>
                  )}
                </div>
                {!editItem && itemForm.warehouse_id && (
                  <div>
                    <Label>اختر من الأصناف الموجودة (نفس نوع المخزن)</Label>
                    <Select
                      value=""
                      onValueChange={(v) => {
                        const picked = catalog.find(c => c.id === v);
                        if (!picked) return;
                        setItemForm({
                          ...itemForm,
                          name: picked.name,
                          category: picked.category || "",
                          sku: picked.sku || "",
                          unit: picked.unit,
                          unit_cost: Number(picked.unit_cost) || 0,
                        });
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={catalog.length ? `اختر من ${catalog.length} صنف...` : "لا توجد أصناف من نفس النوع — اكتب اسماً جديداً بالأسفل"} />
                      </SelectTrigger>
                      <SelectContent>
                        {catalog.map(c => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}{c.sku ? ` (${c.sku})` : ""} — {c.unit}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>الاسم</Label>
                    <Input
                      list={listId}
                      value={itemForm.name}
                      onChange={e => {
                        const name = e.target.value;
                        const match = catalog.find(c => c.name === name);
                        if (match) {
                          setItemForm({ ...itemForm, name, category: match.category || itemForm.category, sku: match.sku || itemForm.sku, unit: match.unit, unit_cost: Number(match.unit_cost) || itemForm.unit_cost });
                        } else {
                          setItemForm({ ...itemForm, name });
                        }
                      }}
                    />
                    <datalist id={listId}>
                      {catalog.map(c => <option key={c.id} value={c.name} />)}
                    </datalist>
                  </div>
                  <div><Label>SKU</Label><Input value={itemForm.sku} onChange={e => setItemForm({ ...itemForm, sku: e.target.value })} /></div>
                  <div><Label>الفئة</Label><Input value={itemForm.category} onChange={e => setItemForm({ ...itemForm, category: e.target.value })} /></div>
                  <div><Label>الوحدة</Label><Input value={itemForm.unit} onChange={e => setItemForm({ ...itemForm, unit: e.target.value })} /></div>
                  <div><Label>الرصيد الحالي</Label><Input type="number" value={itemForm.stock} onChange={e => setItemForm({ ...itemForm, stock: Number(e.target.value) })} /></div>
                  <div><Label>الحد الأدنى</Label><Input type="number" value={itemForm.low_stock_threshold} onChange={e => setItemForm({ ...itemForm, low_stock_threshold: Number(e.target.value) })} /></div>
                  <div><Label>تكلفة الوحدة</Label><Input type="number" step="0.01" value={itemForm.unit_cost} onChange={e => setItemForm({ ...itemForm, unit_cost: Number(e.target.value) })} /></div>
                  <div><Label>تاريخ الصلاحية</Label><Input type="date" value={itemForm.expiry_date} onChange={e => setItemForm({ ...itemForm, expiry_date: e.target.value })} /></div>
                </div>
              </div>
            );
          })()}
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

      {/* Batch receipt summary & confirmation dialog */}
      <Dialog open={!!receiveBatch} onOpenChange={(o) => !o && !receiving && setReceiveBatch(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Beef className="w-5 h-5 text-primary" /> تحقق واستلام من المجزر</DialogTitle>
            <DialogDescription>
              راجع وعدّل الكميات الفعلية المستلمة وحالة الجودة لكل صنف قبل التأكيد النهائي. سيتم تسجيل أي اختلاف عن تقسيمة الذبح في سجل التدقيق.
            </DialogDescription>
          </DialogHeader>
          {receiveBatch && (() => {
            const origKg = receiveBatch.outputs.reduce((s: number, o: any) => s + Number(o.actual_weight_kg || 0), 0);
            const verifiedKg = receiveBatch.outputs.reduce((s: number, o: any) => s + Number(verifyMap[o.id]?.received_weight_kg ?? o.actual_weight_kg ?? 0), 0);
            const acceptedKg = receiveBatch.outputs.reduce((s: number, o: any) => {
              const v = verifyMap[o.id]; const q = v?.quality_status ?? o.quality_status;
              return q === 'accepted' ? s + Number(v?.received_weight_kg ?? o.actual_weight_kg ?? 0) : s;
            }, 0);
            const rejectedKg = verifiedKg - acceptedKg;
            const variance = verifiedKg - origKg;
            return (
              <div className="space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
                  <div className="rounded-md border p-2"><div className="text-muted-foreground text-xs">الدفعة</div><div className="font-mono">{receiveBatch.batch_number}</div></div>
                  <div className="rounded-md border p-2"><div className="text-muted-foreground text-xs">عدد الأصناف</div><div>{receiveBatch.outputs.length}</div></div>
                  <div className="rounded-md border p-2"><div className="text-muted-foreground text-xs">وزن التقسيمة</div><div>{origKg.toFixed(2)} كجم</div></div>
                  <div className="rounded-md border p-2"><div className="text-muted-foreground text-xs">المستلم فعليًا</div><div className="font-bold">{verifiedKg.toFixed(2)} كجم</div></div>
                  <div className={`rounded-md border p-2 ${Math.abs(variance) > 0.001 ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/30' : ''}`}>
                    <div className="text-muted-foreground text-xs">الفرق</div>
                    <div className={variance < 0 ? 'text-destructive font-bold' : variance > 0 ? 'text-emerald-600 font-bold' : ''}>
                      {variance > 0 ? '+' : ''}{variance.toFixed(2)} كجم
                    </div>
                  </div>
                </div>

                <div>
                  <Label>المخزن المستلم</Label>
                  <Select value={receiveWarehouseId} onValueChange={setReceiveWarehouseId}>
                    <SelectTrigger><SelectValue placeholder="اختر مخزناً" /></SelectTrigger>
                    <SelectContent>
                      {warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name} — {warehouseTypes[w.type] || w.type}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>الصنف</TableHead>
                        <TableHead>وزن التقسيمة</TableHead>
                        <TableHead>الوزن المستلم فعليًا</TableHead>
                        <TableHead>الفرق</TableHead>
                        <TableHead>حالة الجودة</TableHead>
                        <TableHead>ملاحظات</TableHead>
                        <TableHead>للمخزون؟</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {receiveBatch.outputs.map((o: any) => {
                        const v = verifyMap[o.id] || { received_weight_kg: Number(o.actual_weight_kg || 0), quality_status: o.quality_status || 'accepted', notes: '' };
                        const diff = Number(v.received_weight_kg) - Number(o.actual_weight_kg || 0);
                        return (
                          <TableRow key={o.id}>
                            <TableCell className="font-medium whitespace-nowrap">{o.cut_name_ar}</TableCell>
                            <TableCell className="text-muted-foreground">{Number(o.actual_weight_kg).toFixed(2)}</TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                className="w-24 h-8"
                                value={v.received_weight_kg}
                                onChange={(e) => setVerifyMap(m => ({ ...m, [o.id]: { ...v, received_weight_kg: parseFloat(e.target.value) || 0 } }))}
                              />
                            </TableCell>
                            <TableCell className={`text-xs ${Math.abs(diff) > 0.001 ? (diff < 0 ? 'text-destructive' : 'text-emerald-600') + ' font-bold' : 'text-muted-foreground'}`}>
                              {diff > 0 ? '+' : ''}{diff.toFixed(2)}
                            </TableCell>
                            <TableCell>
                              <Select value={v.quality_status} onValueChange={(val) => setVerifyMap(m => ({ ...m, [o.id]: { ...v, quality_status: val } }))}>
                                <SelectTrigger className="w-32 h-8"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="accepted">مقبول</SelectItem>
                                  <SelectItem value="rejected">مرفوض</SelectItem>
                                  <SelectItem value="quarantine">حجر صحي</SelectItem>
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell>
                              <Input
                                className="w-40 h-8"
                                placeholder="سبب الفرق/الرفض..."
                                value={v.notes}
                                onChange={(e) => setVerifyMap(m => ({ ...m, [o.id]: { ...v, notes: e.target.value } }))}
                              />
                            </TableCell>
                            <TableCell className="text-xs">
                              {v.quality_status === 'accepted' && Number(v.received_weight_kg) > 0
                                ? <span className="text-emerald-600">نعم</span>
                                : <span className="text-muted-foreground">لا</span>}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                <div className="text-xs text-muted-foreground space-y-1">
                  <div>• عدّل الوزن المستلم فعليًا إذا اختلف عن تقسيمة الذبح، وسيتم توثيق الفرق في سجل التدقيق.</div>
                  <div>• غيّر حالة الجودة لأي صنف (مرفوض / حجر صحي) لاستبعاده من الإضافة للمخزون.</div>
                  <div>• الأصناف المقبولة تُضاف لرصيد الصنف الموجود بنفس الاسم، وإلا يُنشأ صنف جديد.</div>
                  <div>• الإجمالي المضاف للمخزون: <b className="text-emerald-700">{acceptedKg.toFixed(2)} كجم</b>{rejectedKg > 0 && <> — المستبعد: <b className="text-destructive">{rejectedKg.toFixed(2)} كجم</b></>}</div>
                </div>
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReceiveBatch(null)} disabled={receiving}>إلغاء</Button>
            <Button onClick={confirmReceiveBatch} disabled={receiving || !receiveWarehouseId}>
              <CheckCircle2 className="w-4 h-4 ml-1" /> {receiving ? 'جارٍ الاستلام...' : 'تأكيد نهائي للاستلام'}
            </Button>
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
