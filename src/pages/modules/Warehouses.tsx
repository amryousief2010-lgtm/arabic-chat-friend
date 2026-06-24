import { useState, useEffect, useMemo } from "react";
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
import { Plus, Warehouse, Trash2, Edit, ArrowDown, ArrowUp, ArrowLeftRight, Settings2, Package, AlertTriangle, BarChart3, Upload, Beef, CheckCircle2, Printer, FileSpreadsheet, FileText, MapPin, Menu, BookOpen, Calendar, Scale, UtensilsCrossed, Inbox, ClipboardCheck, Eye } from "lucide-react";
import { printWarehouseSlip, SlipItemRow } from "@/lib/printWarehouseSlip";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { formatDateTime } from "@/lib/dateFormat";
import * as XLSX from "xlsx";
import companyLogo from "@/assets/company-logo.jpg";
import WarehouseKpisBlock from "@/components/warehouses/WarehouseKpisBlock";
import RestaurantMenuTab from "@/components/warehouses/RestaurantMenuTab";
import WarehouseStockView from "@/pages/WarehouseStockView";
import WarehouseReceiptsTab from "@/components/warehouses/WarehouseReceiptsTab";
import { isMainWarehouseExcludedCategory, isMainWarehouseName } from "@/constants/warehouseCategoryFilters";
import MainWarehouseActivity from "@/pages/MainWarehouseActivity";
import WarehouseReports from "@/pages/modules/WarehouseReports";
import MainWarehouseGuide from "@/pages/MainWarehouseGuide";
import WarehouseOpeningBalance from "@/pages/modules/WarehouseOpeningBalance";
import WarehouseOperationalDates from "@/pages/modules/WarehouseOperationalDates";
import WarehouseDashboard from "@/pages/modules/warehouse/WarehouseDashboard";
import WarehousesDashboardPanel from "@/components/warehouses/WarehousesDashboardPanel";


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
  reference_type?: string | null;
  party: string | null;
  notes: string | null;
  performed_at: string;
  package_count?: number | null;
  package_weight_kg?: number | null;
  performed_by?: string | null;
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
  const { canManageWarehouses, user, isGeneralManager, isExecutiveManager } = useAuth();
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
  const [activeTab, setActiveTab] = useState("items");
  const [menuSubview, setMenuSubview] = useState<string | null>(null);

  // Grouped manual supply/issuance dialog
  const [manualGroupRef, setManualGroupRef] = useState<string | null>(null);
  const [manualBusy, setManualBusy] = useState(false);
  const canManageManual = isGeneralManager || isExecutiveManager;

  // Group movements by reference for MAN-IN / MAN-OUT (one row per supply batch)
  type GroupedRow =
    | { kind: "single"; mov: Movement }
    | { kind: "manual"; reference: string; direction: "in" | "out"; date: string; movs: Movement[]; totalQty: number; partyLabel: string };

  const groupedMovements = useMemo<GroupedRow[]>(() => {
    const manualMap = new Map<string, Movement[]>();
    const others: Movement[] = [];
    movements.forEach((m) => {
      const ref = m.reference || "";
      const isManualIn = /^MAN-IN-\d{8}-\d{4}$/.test(ref) && m.reference_type === "manual_addition";
      const isManualOut = /^MAN-OUT-\d{8}-\d{4}$/.test(ref) && m.reference_type === "manual_out";
      if (isManualIn || isManualOut) {
        if (!manualMap.has(ref)) manualMap.set(ref, []);
        manualMap.get(ref)!.push(m);
      } else {
        others.push(m);
      }
    });
    const parseField = (notes: string | null | undefined, label: string): string => {
      if (!notes) return "";
      const re = new RegExp(`${label}:\\s*([^•]+?)(?=\\s*•|$)`);
      const x = notes.match(re);
      return x ? x[1].trim() : "";
    };
    const rows: GroupedRow[] = others.map((m) => ({ kind: "single", mov: m }));
    manualMap.forEach((movs, ref) => {
      const direction: "in" | "out" = ref.startsWith("MAN-IN") ? "in" : "out";
      const sample = movs[0] || ({} as Movement);
      const partyKey = direction === "in" ? "جهة التوريد" : "جهة الصرف";
      const partyLabel = parseField(sample.notes, partyKey) || sample.party || "—";
      rows.push({
        kind: "manual",
        reference: ref,
        direction,
        date: sample.performed_at,
        movs,
        totalQty: movs.reduce((s, x) => s + Number(x.quantity || 0), 0),
        partyLabel,
      });
    });
    rows.sort((a, b) => {
      const da = a.kind === "single" ? a.mov.performed_at : a.date;
      const db = b.kind === "single" ? b.mov.performed_at : b.date;
      return new Date(db).getTime() - new Date(da).getTime();
    });
    return rows;
  }, [movements]);

  const manualGroup = useMemo(
    () => groupedMovements.find((r) => r.kind === "manual" && r.reference === manualGroupRef) as
      | (Extract<GroupedRow, { kind: "manual" }>)
      | undefined,
    [groupedMovements, manualGroupRef]
  );

  const parseNoteField = (notes: string | null | undefined, label: string): string => {
    if (!notes) return "";
    const re = new RegExp(`${label}:\\s*([^•]+?)(?=\\s*•|$)`);
    const m = notes.match(re);
    return m ? m[1].trim() : "";
  };

  const printManualGroup = () => {
    if (!manualGroup) return;
    const first = manualGroup.movs[0];
    const supplier = parseNoteField(first.notes, "القائم بالتوريد");
    const deliveryDate = parseNoteField(first.notes, "تاريخ التوريد");
    const extraNotes = parseNoteField(first.notes, "ملاحظات");
    const slipRows: SlipItemRow[] = manualGroup.movs.map((r) => ({
      name: r.item?.name || r.item_id,
      unit: r.item?.unit || "كجم",
      packageCount: r.package_count ?? null,
      packageWeightKg: r.package_weight_kg ?? null,
      quantity: Number(r.quantity || 0),
      stockBefore: Number(parseNoteField(r.notes, "قبل").replace(/[^\d.\-]/g, "")) || null,
      stockAfter: Number(parseNoteField(r.notes, "بعد").replace(/[^\d.\-]/g, "")) || null,
    }));
    printWarehouseSlip({
      kind: manualGroup.direction,
      opNo: manualGroup.reference,
      warehouseName: first.warehouse?.name || "—",
      partyLabel: manualGroup.partyLabel,
      supplier,
      deliveryDate,
      performedByName: "",
      performedAt: first.performed_at,
      notes: extraNotes,
      rows: slipRows,
    });
  };

  const cancelManualGroup = async () => {
    if (!manualGroup || !canManageManual) return;
    const reason = window.prompt("سبب الإلغاء (مطلوب):", "");
    if (!reason || !reason.trim()) {
      toast({ title: "السبب مطلوب لإلغاء التوريدة", variant: "destructive" });
      return;
    }
    if (!window.confirm(`سيتم إلغاء التوريدة ${manualGroup.reference} وعكس أثرها على المخزون. متابعة؟`)) return;
    setManualBusy(true);
    try {
      // Reverse stock for each line, then delete the original movements.
      for (const m of manualGroup.movs) {
        const delta = (m.movement_type === "in" ? -1 : 1) * Number(m.quantity || 0);
        const { data: it } = await supabase.from("inventory_items").select("stock").eq("id", m.item_id).maybeSingle();
        const newStock = Number((it as any)?.stock || 0) + delta;
        await supabase.from("inventory_items").update({ stock: newStock }).eq("id", m.item_id);
      }
      const ids = manualGroup.movs.map((m) => m.id);
      const { error } = await supabase.from("inventory_movements").delete().in("id", ids);
      if (error) throw error;
      toast({ title: "تم إلغاء التوريدة", description: `${manualGroup.reference} — ${reason}` });
      setManualGroupRef(null);
      await fetchAll();
    } catch (e: any) {
      toast({ title: "تعذّر الإلغاء", description: e?.message || "حدث خطأ", variant: "destructive" });
    } finally {
      setManualBusy(false);
    }
  };


  const fetchAll = async () => {
    setLoading(true);
    const sinceISO = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const [w, i, m, s, o] = await Promise.all([
      supabase.from("warehouses").select("*").order("name"),
      supabase.from("inventory_items").select("*, warehouse:warehouses(name)").order("name"),
      supabase.from("inventory_movements").select("*, item:inventory_items(name, unit), warehouse:warehouses!inventory_movements_warehouse_id_fkey(name), destination:warehouses!inventory_movements_destination_warehouse_id_fkey(name)").order("performed_at", { ascending: false }).limit(200),
      supabase.from("slaughter_batch_outputs")
        .select("id, batch_id, cut_name_ar, actual_weight_kg, unit_cost, quality_status, received_status, received_at, received_warehouse_id, batch:slaughter_batches(batch_number, slaughter_date, status)")
        .in("destination", ["warehouse", "branch"]) // مسؤول المخزن الرئيسي يرى فقط ما هو موجه إليه — أوارد مصنع اللحوم تظهر داخل صفحة مصنع اللحوم
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

  // Items tab filter: when filtering by Main Warehouse, also hide categories
  // that belong to other warehouses (meat factory raw, feed raw, packaging)
  // even if mis-assigned in DB. "All warehouses" stays unfiltered.
  const mainWh = warehouses.find((w) => isMainWarehouseName(w.name));
  const filteredItems = (() => {
    if (warehouseFilter === "all") return items;
    const base = items.filter((i) => i.warehouse_id === warehouseFilter);
    if (mainWh && warehouseFilter === mainWh.id) {
      return base.filter((i) => !isMainWarehouseExcludedCategory((i as any).category));
    }
    return base;
  })();
  const lowStockItems = items.filter(i => i.stock <= i.low_stock_threshold);
  const pendingSlaughter = slaughterOutputs.filter(o => o.received_status !== 'received');

  // ============ KPI Scope (top cards) ============
  // الكروت العلوية تتحدث حسب التبويب المختار أو تعود للإجمالي.
  const [forceAllKpi, setForceAllKpi] = useState(false);
  const tabWarehouseMap = useMemo(() => {
    const f = (pats: RegExp[]) => warehouses.find((w) => pats.some((p) => p.test(w.name)));
    return {
      "wh-main": f([/رئيسي/, /main/i]),
      "wh-agouza": f([/عجوزة/, /agouza/i]),
      "wh-hht": f([/هيلثي/, /healthy/i]),
      "wh-carrefour": f([/كارفور/, /carrefour/i]),
      "wh-packaging": f([/تغليف/, /تعبئة/, /packaging/i]) || warehouses.find((w) => w.type === "packaging"),
      "wh-activity": f([/رئيسي/, /main/i]),
    } as Record<string, any>;
  }, [warehouses]);
  const kpiWh = !forceAllKpi ? tabWarehouseMap[activeTab] : undefined;
  const kpiScopeLabel = kpiWh ? `إحصائيات ${kpiWh.name}` : "إجمالي كل المخازن";
  const kpiItems = useMemo(() => {
    if (!kpiWh) return items;
    let base = items.filter((i) => i.warehouse_id === kpiWh.id);
    if (isMainWarehouseName(kpiWh.name)) {
      base = base.filter((i) => !isMainWarehouseExcludedCategory((i as any).category));
    }
    return base;
  }, [items, kpiWh]);
  const kpiLowStock = useMemo(
    () => kpiItems.filter((i) => i.stock <= i.low_stock_threshold),
    [kpiItems]
  );
  const kpiTotalValue = useMemo(
    () => kpiItems.reduce((s, i) => s + i.stock * i.unit_cost, 0),
    [kpiItems]
  );
  const kpiActiveWh = kpiWh ? 1 : warehouses.filter((w) => w.is_active).length;
  const kpiFirstCardLabel = kpiWh ? "حالة المخزن" : "المخازن النشطة";
  const kpiFirstCardValue = kpiWh ? (kpiWh.is_active ? "نشط" : "متوقف") : String(kpiActiveWh);


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
    const scopedItems = kpiItems;
    const totalValue = scopedItems.reduce((s, i) => s + i.stock * i.unit_cost, 0);
    const activeWarehouses = kpiWh ? 1 : warehouses.filter(w => w.is_active).length;
    const lowCount = scopedItems.filter(i => i.stock <= i.low_stock_threshold).length;
    const reportTitle = kpiWh ? `تقرير مخزون — ${kpiWh.name}` : "تقرير ملخص المخزون والمنتجات";
    const firstSummaryLabel = kpiWh ? "حالة المخزن" : "المخازن النشطة";
    const firstSummaryValue = kpiWh ? (kpiWh.is_active ? "نشط" : "متوقف") : String(activeWarehouses);
    const rows = scopedItems.map((it, i) => `

      <tr>
        <td>${i + 1}</td>
        <td>${esc(it.name)}${it.sku ? ` <span style="color:#666;font-size:11px">(${esc(it.sku)})</span>` : ''}</td>
        <td>${esc(it.warehouse?.name || '—')}</td>
        <td>${esc(it.category || '—')}</td>
        <td>${it.stock}</td>
        <td>${esc(it.unit)}</td>
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
          <h1>${esc(reportTitle)}</h1>
          <p>كابيتال أوستريش</p>
          <p>تاريخ الإصدار: ${new Date().toLocaleString("ar-EG")}</p>
        </div>
        <div style="width:70px"></div>
      </div>
      <div class="summary">
        <div><strong>${scopedItems.length}</strong><span>إجمالي الأصناف</span></div>
        <div><strong>${esc(firstSummaryValue)}</strong><span>${esc(firstSummaryLabel)}</span></div>
        <div><strong>${totalValue.toLocaleString()}</strong><span>قيمة المخزون (ج.م)</span></div>
        <div><strong style="color:#c0392b">${lowCount}</strong><span>أصناف منخفضة</span></div>
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
        {/* Premium Header */}
        <div className="relative overflow-hidden rounded-3xl border border-primary/20 bg-gradient-to-br from-primary/10 via-background to-accent/10 p-6 shadow-sm">
          <div className="absolute -top-16 -right-16 w-56 h-56 rounded-full bg-primary/10 blur-3xl pointer-events-none" />
          <div className="absolute -bottom-16 -left-16 w-56 h-56 rounded-full bg-accent/10 blur-3xl pointer-events-none" />
          <div className="relative flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-lg shadow-primary/30 ring-1 ring-white/20">
                <Warehouse className="w-8 h-8 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-3xl font-bold bg-gradient-to-l from-primary to-foreground bg-clip-text text-transparent">المخازن</h1>
                <p className="text-muted-foreground mt-1">إدارة المخازن المتعددة وحركات المخزون</p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button variant="outline" size="sm" onClick={exportInventorySummaryPDF}><FileText className="w-4 h-4 ml-2 text-red-600" />تقرير PDF</Button>
              {isGeneralManager && (<Link to="/modules/warehouses/import"><Button variant="outline" size="sm"><Upload className="w-4 h-4 ml-2" />استيراد CSV</Button></Link>)}
              {!canManageWarehouses && (<Badge variant="outline">عرض فقط</Badge>)}
            </div>
          </div>
        </div>

        {/* KPI Scope label + reset to total */}
        <div className="flex items-center justify-between flex-wrap gap-2 px-1 -mb-2">
          <div className="flex items-center gap-2 text-xs">
            <Badge variant={kpiWh ? "default" : "outline"} className="rounded-full">
              {kpiScopeLabel}
            </Badge>
            {kpiWh && (
              <span className="text-muted-foreground">
                — الكروت أدناه تخص هذا المخزن فقط
              </span>
            )}
          </div>
          {kpiWh && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setForceAllKpi(true); setActiveTab("items"); }}
            >
              <BarChart3 className="w-4 h-4 ml-1" />
              عرض إجمالي كل المخازن
            </Button>
          )}
        </div>

        {/* KPIs — Premium (scope-aware) */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card className="group relative overflow-hidden rounded-2xl border-primary/10 bg-gradient-to-br from-card to-primary/[0.03] hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5 hover:-translate-y-0.5 transition-all duration-300">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <CardDescription className="text-xs font-medium">{kpiFirstCardLabel}</CardDescription>
                  <CardTitle className="text-3xl font-bold tabular-nums">{kpiFirstCardValue}</CardTitle>
                </div>
                <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center ring-1 ring-primary/15 group-hover:bg-primary/15 transition-colors">
                  <Warehouse className="w-5 h-5 text-primary" />
                </div>
              </div>
            </CardHeader>
          </Card>
          <Card className="group relative overflow-hidden rounded-2xl border-primary/10 bg-gradient-to-br from-card to-primary/[0.03] hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5 hover:-translate-y-0.5 transition-all duration-300">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <CardDescription className="text-xs font-medium">إجمالي الأصناف</CardDescription>
                  <CardTitle className="text-3xl font-bold tabular-nums">{kpiItems.length}</CardTitle>
                </div>
                <div className="w-11 h-11 rounded-xl bg-blue-500/10 flex items-center justify-center ring-1 ring-blue-500/15 group-hover:bg-blue-500/15 transition-colors">
                  <Package className="w-5 h-5 text-blue-600" />
                </div>
              </div>
            </CardHeader>
          </Card>
          <Card className="group relative overflow-hidden rounded-2xl border-primary/10 bg-gradient-to-br from-card to-primary/[0.03] hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5 hover:-translate-y-0.5 transition-all duration-300">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <CardDescription className="text-xs font-medium">قيمة المخزون</CardDescription>
                  <CardTitle className="text-2xl font-bold tabular-nums">{kpiTotalValue.toLocaleString()}</CardTitle>
                </div>
                <div className="w-11 h-11 rounded-xl bg-emerald-500/10 flex items-center justify-center ring-1 ring-emerald-500/15 group-hover:bg-emerald-500/15 transition-colors">
                  <BarChart3 className="w-5 h-5 text-emerald-600" />
                </div>
              </div>
            </CardHeader>
          </Card>
          <Card className={`group relative overflow-hidden rounded-2xl bg-gradient-to-br from-card to-destructive/[0.04] hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 ${kpiLowStock.length > 0 ? "border-destructive/40 hover:shadow-destructive/10" : "border-primary/10 hover:border-primary/30"}`}>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <CardDescription className="text-xs font-medium">أصناف منخفضة</CardDescription>
                  <CardTitle className={`text-3xl font-bold tabular-nums ${kpiLowStock.length > 0 ? "text-destructive" : ""}`}>{kpiLowStock.length}</CardTitle>
                </div>
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center ring-1 transition-colors ${kpiLowStock.length > 0 ? "bg-destructive/10 ring-destructive/20 group-hover:bg-destructive/15" : "bg-muted ring-border"}`}>
                  <AlertTriangle className={`w-5 h-5 ${kpiLowStock.length > 0 ? "text-destructive" : "text-muted-foreground"}`} />
                </div>
              </div>
            </CardHeader>
          </Card>
        </div>


        <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v); setForceAllKpi(false); if (v === "more") setMenuSubview(null); }} defaultValue="items">
          <div className="overflow-x-auto pb-1">
            <TabsList className="w-max flex-nowrap bg-gradient-to-l from-muted/60 to-muted/30 border border-border/60 rounded-2xl p-1.5 shadow-sm [&_[data-state=active]]:bg-gradient-to-br [&_[data-state=active]]:from-primary [&_[data-state=active]]:to-primary/80 [&_[data-state=active]]:text-primary-foreground [&_[data-state=active]]:shadow-md [&_[data-state=active]]:shadow-primary/20 [&>button]:rounded-xl [&>button]:transition-all">

              <TabsTrigger value="available" className="gap-1"><Warehouse className="w-4 h-4" />المتاح في المخازن</TabsTrigger>
              <TabsTrigger value="items">الأصناف</TabsTrigger>

              <TabsTrigger value="receipts" className="gap-1"><Inbox className="w-4 h-4" />الاستلامات</TabsTrigger>
              <TabsTrigger value="movements">الحركات</TabsTrigger>
              <TabsTrigger value="low">منخفضة <Badge variant="destructive" className="mr-2">{lowStockItems.length}</Badge></TabsTrigger>
              <TabsTrigger value="distribution" className="gap-1"><MapPin className="w-4 h-4" />التوزيع الجغرافي</TabsTrigger>
              <TabsTrigger value="wh-main" className="gap-1"><Warehouse className="w-4 h-4" />المخزن الرئيسي</TabsTrigger>
              <TabsTrigger value="wh-agouza" className="gap-1"><Warehouse className="w-4 h-4" />مخزن العجوزة</TabsTrigger>
              <TabsTrigger value="wh-hht" className="gap-1"><Warehouse className="w-4 h-4" />هايبر هيلثي تيست</TabsTrigger>
              <TabsTrigger value="wh-carrefour" className="gap-1"><Warehouse className="w-4 h-4" />هايبر كارفور</TabsTrigger>
              <TabsTrigger value="wh-packaging" className="gap-1"><Package className="w-4 h-4" />التغليف والتعبئة</TabsTrigger>
              <TabsTrigger value="wh-activity" className="gap-1"><BarChart3 className="w-4 h-4" />سجل حركات المخزن الرئيسي</TabsTrigger>
              <TabsTrigger value="reports" className="gap-1"><FileText className="w-4 h-4" />التقارير</TabsTrigger>
              <TabsTrigger value="menu" className="gap-1"><UtensilsCrossed className="w-4 h-4" />المنيو</TabsTrigger>
              <TabsTrigger value="more" className="gap-1"><Menu className="w-4 h-4" />المزيد</TabsTrigger>
            </TabsList>
          </div>

          {/* AVAILABLE — المتاح في المخازن (نفس محتوى /warehouse-stock) */}
          <TabsContent value="available" className="space-y-4">
            <WarehouseStockView embedded />
          </TabsContent>

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


          {/* RECEIPTS — top-level grouped receipts hub (includes pending slaughter batches) */}
          <TabsContent value="receipts" className="space-y-4">
            {pendingBatches.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Beef className="w-5 h-5 text-primary" />
                  <h3 className="font-bold">دفعات المجزر بانتظار الاستلام <Badge variant="destructive" className="mr-1">{pendingBatches.length}</Badge></h3>
                </div>
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
            <WarehouseReceiptsTab />
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
                    <TableHead className="text-center">إجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groupedMovements.length === 0 ? (
                    <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">لا توجد حركات</TableCell></TableRow>
                  ) : groupedMovements.map((row) => {
                    if (row.kind === "manual") {
                      const isIn = row.direction === "in";
                      const sample = row.movs[0];
                      const unit = sample?.item?.unit || "كجم";
                      return (
                        <TableRow key={row.reference} className={isIn ? "bg-emerald-50/40" : "bg-rose-50/40"}>
                          <TableCell className="text-xs">{formatDateTime(row.date)}</TableCell>
                          <TableCell>
                            <Badge className={`gap-1 ${isIn ? "bg-emerald-600 hover:bg-emerald-700" : "bg-rose-600 hover:bg-rose-700"}`}>
                              {isIn ? <ArrowDown className="w-3 h-3" /> : <ArrowUp className="w-3 h-3" />}
                              {isIn ? "توريد مباشر" : "صرف مباشر"}
                            </Badge>
                          </TableCell>
                          <TableCell colSpan={2} className="font-medium">
                            <span className="text-muted-foreground">توريدة</span>{" "}
                            <span className="font-mono">{row.reference}</span>
                            <span className="text-muted-foreground mr-2">({row.movs.length} صنف)</span>
                          </TableCell>
                          <TableCell>{row.totalQty.toFixed(2)} {unit}</TableCell>
                          <TableCell>{row.partyLabel || "—"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground font-mono">{row.reference}</TableCell>
                          <TableCell>
                            <div className="flex gap-1 justify-center">
                              <Button size="sm" variant="outline" onClick={() => setManualGroupRef(row.reference)}>
                                <Eye className="w-3 h-3 ml-1" /> تفاصيل
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    }
                    const m = row.mov;
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
                        <TableCell />
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


          {/* Embedded warehouse pages with per-warehouse KPI cards on top */}
          {(() => {
            const findByPatterns = (patterns: RegExp[]) =>
              warehouses.find((w) => patterns.some((p) => p.test(w.name)));
            const findByType = (type: string) => warehouses.find((w) => w.type === type);

            const TABS = [
              { value: "wh-main", scope: "main", label: "المخزن الرئيسي",
                wh: findByPatterns([/رئيسي/, /main/i]) },
              { value: "wh-agouza", scope: "agouza", label: "مخزن العجوزة",
                wh: findByPatterns([/عجوزة/, /agouza/i]) },
              { value: "wh-hht", scope: "healthy", label: "هايبر هيلثي تيست",
                wh: findByPatterns([/هيلثي/, /healthy/i]) },
              { value: "wh-carrefour", scope: "carrefour", label: "هايبر كارفور",
                wh: findByPatterns([/كارفور/, /carrefour/i]) },
              { value: "wh-packaging", label: "التغليف والتعبئة",
                wh: findByPatterns([/تغليف/, /تعبئة/, /packaging/i]) || findByType("packaging") },
              { value: "wh-activity", label: "سجل حركات المخزن الرئيسي",
                wh: findByPatterns([/رئيسي/, /main/i]) },
            ] as const;

            return TABS.map((t) => {
              // Per-tab items list locked to this warehouse only (no dropdown).
              // For Main Warehouse, also exclude meat-factory / feed / packaging
              // categories even if mis-assigned in DB.
              const tabItems = t.wh
                ? items
                    .filter((i) => i.warehouse_id === t.wh!.id)
                    .filter((i) =>
                      t.value === "wh-main"
                        ? !isMainWarehouseExcludedCategory((i as any).category)
                        : true
                    )
                : [];
              return (
                <TabsContent key={t.value} value={t.value} className="space-y-4">
                  {t.value !== "wh-activity" && (
                    <WarehouseKpisBlock
                      warehouseId={t.wh?.id}
                      warehouseName={t.label}
                      items={items}
                      movements={movements}
                    />
                  )}
                  {t.value !== "wh-activity" && t.value !== "wh-main" && t.value !== "wh-agouza" && t.value !== "wh-hht" && t.value !== "wh-carrefour" && t.wh && (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base flex items-center gap-2">
                          <Package className="w-4 h-4 text-primary" />
                          أصناف {t.label}
                          <Badge variant="outline">{tabItems.length}</Badge>
                        </CardTitle>
                        <CardDescription>عرض مقصور على هذا المخزن فقط</CardDescription>
                      </CardHeader>
                      <CardContent className="p-0">
                        <div className="overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>الصنف</TableHead>
                                <TableHead>الفئة</TableHead>
                                <TableHead>الرصيد</TableHead>
                                <TableHead>الوحدة</TableHead>
                                <TableHead>الحد الأدنى</TableHead>
                                <TableHead>التكلفة</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {tabItems.length === 0 ? (
                                <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">لا توجد أصناف لهذا المخزن</TableCell></TableRow>
                              ) : tabItems.map((it) => (
                                <TableRow key={it.id} className={it.stock <= it.low_stock_threshold ? "bg-destructive/5" : ""}>
                                  <TableCell className="font-medium">{it.name}{it.sku && <span className="text-xs text-muted-foreground mr-1">({it.sku})</span>}</TableCell>
                                  <TableCell className="text-sm text-muted-foreground">{(it as any).category || "—"}</TableCell>
                                  <TableCell className={it.stock <= it.low_stock_threshold ? "text-destructive font-bold" : ""}>{it.stock}</TableCell>
                                  <TableCell>{it.unit}</TableCell>
                                  <TableCell>{it.low_stock_threshold}</TableCell>
                                  <TableCell>{Number(it.unit_cost || 0).toFixed(2)}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                  {t.value === "wh-activity" ? (
                    <MainWarehouseActivity embedded />
                  ) : "scope" in t ? (
                    <WarehouseStockView scope={t.scope} embedded />
                  ) : null}
                </TabsContent>
              );
            });
          })()}

          <TabsContent value="reports" className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <Link to="/modules/warehouses/daily-report" className="block">
                <Card className="cursor-pointer hover:border-primary transition-colors h-full">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base"><BarChart3 className="w-5 h-5 text-emerald-600" />التقرير اليومي للمخزن الرئيسي</CardTitle>
                    <CardDescription>وارد وصرف اليوم، أصناف منخفضة، أكثر الأصناف حركة</CardDescription>
                  </CardHeader>
                </Card>
              </Link>
              <Link to="/modules/warehouses/adjustments-log" className="block">
                <Card className="cursor-pointer hover:border-primary transition-colors h-full">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base"><FileText className="w-5 h-5 text-amber-600" />سجل تعديلات المخزون</CardTitle>
                    <CardDescription>التسويات، الجرد، التعديلات بصلاحية مدير</CardDescription>
                  </CardHeader>
                </Card>
              </Link>
              <Link to="/modules/warehouses/stocktaking" className="block">
                <Card className="cursor-pointer hover:border-primary transition-colors h-full border-violet-200">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base"><ClipboardCheck className="w-5 h-5 text-violet-600" />جرد وتسوية المخزون</CardTitle>
                    <CardDescription>إدخال الجرد الفعلي، مراجعة فروق الجرد، واعتماد الرصيد النهائي</CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            </div>
            <WarehouseReports embedded />
          </TabsContent>

          {/* RESTAURANT MENU tab (products & prices from PDF) */}
          <TabsContent value="menu" className="space-y-4">
            <RestaurantMenuTab />
          </TabsContent>

          {/* MORE tab — admin / less-used sub-pages */}
          <TabsContent value="more" className="space-y-4">
            {menuSubview ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setMenuSubview(null)}><ArrowLeftRight className="w-4 h-4 ml-1" />رجوع للقائمة</Button>
                </div>
                {menuSubview === "/modules/warehouses/main-guide" ? (
                  <MainWarehouseGuide embedded />
                ) : menuSubview === "/modules/warehouses/operational-dates" ? (
                  isGeneralManager || isExecutiveManager ? (
                    <WarehouseOperationalDates embedded />
                  ) : (
                    <Card><CardContent className="py-10 text-center text-muted-foreground">هذا الجزء مخصص للإدارة فقط.</CardContent></Card>
                  )
                ) : menuSubview === "/modules/warehouses/opening-balance" ? (
                  <WarehouseOpeningBalance embedded />
                ) : menuSubview === "/modules/warehouses/dashboard" ? (
                  <WarehouseDashboard embedded />
                ) : (
                  <Card><CardContent className="py-10 text-center text-muted-foreground">القسم غير متاح أو غير مسجل.</CardContent></Card>
                )}
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <Card className="cursor-pointer hover:border-primary transition-colors" onClick={() => setMenuSubview("/modules/warehouses/main-guide")}>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base"><BookOpen className="w-5 h-5 text-primary" />دليل المخزن الرئيسي</CardTitle>
                    <CardDescription>تعليمات وتشغيل المخزن الرئيسي</CardDescription>
                  </CardHeader>
                </Card>
                <Card className="cursor-pointer hover:border-primary transition-colors" onClick={() => setMenuSubview("/modules/warehouses/operational-dates")}>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base"><Calendar className="w-5 h-5 text-primary" />تواريخ بداية التشغيل الفعلي</CardTitle>
                    <CardDescription>تواريخ بدء التشغيل الفعلي للمخازن</CardDescription>
                  </CardHeader>
                </Card>
                <Card className="cursor-pointer hover:border-primary transition-colors" onClick={() => setMenuSubview("/modules/warehouses/opening-balance")}>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base"><Scale className="w-5 h-5 text-primary" />الرصيد الافتتاحي للمخازن</CardTitle>
                    <CardDescription>إدارة الأرصدة الافتتاحية والاعتمادات</CardDescription>
                  </CardHeader>
                </Card>
                <Card className="cursor-pointer hover:border-primary transition-colors" onClick={() => setMenuSubview("/modules/warehouses/dashboard")}>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base"><BarChart3 className="w-5 h-5 text-primary" />لوحة المؤشرات</CardTitle>
                    <CardDescription>إحصائيات وتحليلات المخازن</CardDescription>
                  </CardHeader>
                </Card>
                <Link to="/modules/warehouses/daily-report" className="block">
                  <Card className="cursor-pointer hover:border-primary transition-colors h-full">
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center gap-2 text-base"><BarChart3 className="w-5 h-5 text-emerald-600" />التقرير اليومي للمخزن الرئيسي</CardTitle>
                      <CardDescription>وارد وصرف اليوم، أصناف منخفضة، أكثر الأصناف حركة</CardDescription>
                    </CardHeader>
                  </Card>
                </Link>
                <Link to="/modules/warehouses/adjustments-log" className="block">
                  <Card className="cursor-pointer hover:border-primary transition-colors h-full">
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center gap-2 text-base"><FileText className="w-5 h-5 text-amber-600" />سجل تعديلات المخزون</CardTitle>
                      <CardDescription>التسويات، الجرد، التعديلات بصلاحية مدير</CardDescription>
                    </CardHeader>
                  </Card>
                </Link>
                <Card className="cursor-pointer hover:border-primary transition-colors" onClick={() => { exportInventorySummaryPDF(); }}>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base"><FileText className="w-5 h-5 text-red-600" />تقرير PDF</CardTitle>
                    <CardDescription>تقرير ملخص المخزون والمنتجات</CardDescription>
                  </CardHeader>
                </Card>
              </div>
            )}
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

      {/* Manual Supply / Issuance Group Details */}
      <Dialog open={!!manualGroupRef} onOpenChange={(v) => { if (!v) setManualGroupRef(null); }}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              {manualGroup ? (
                <>
                  {manualGroup.direction === "in" ? "تفاصيل توريدة" : "تفاصيل صرف"}{" "}
                  <span className="font-mono text-primary">{manualGroup.reference}</span>
                </>
              ) : "تفاصيل التوريدة"}
            </DialogTitle>
            <DialogDescription>
              {manualGroup ? (
                <>
                  {formatDateTime(manualGroup.date)} • {manualGroup.partyLabel} •{" "}
                  {manualGroup.movs.length} صنف • إجمالي {manualGroup.totalQty.toFixed(2)} كجم
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>

          {manualGroup && (
            <div className="space-y-3">
              <div className="overflow-x-auto border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الصنف</TableHead>
                      <TableHead className="text-center">عدد العبوات</TableHead>
                      <TableHead className="text-center">وزن العبوة</TableHead>
                      <TableHead className="text-center">الكمية</TableHead>
                      <TableHead className="text-center">الوحدة</TableHead>
                      <TableHead className="text-center">الرصيد قبل</TableHead>
                      <TableHead className="text-center">الرصيد بعد</TableHead>
                      <TableHead>ملاحظات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {manualGroup.movs.map((m) => {
                      const before = parseNoteField(m.notes, "قبل");
                      const after = parseNoteField(m.notes, "بعد");
                      const extra = parseNoteField(m.notes, "ملاحظات");
                      return (
                        <TableRow key={m.id}>
                          <TableCell className="font-medium">{m.item?.name || "—"}</TableCell>
                          <TableCell className="text-center">{m.package_count ?? "—"}</TableCell>
                          <TableCell className="text-center">{m.package_weight_kg ?? "—"}</TableCell>
                          <TableCell className="text-center">{Number(m.quantity).toFixed(2)}</TableCell>
                          <TableCell className="text-center">{m.item?.unit || "كجم"}</TableCell>
                          <TableCell className="text-center text-xs">{before || "—"}</TableCell>
                          <TableCell className="text-center text-xs">{after || "—"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{extra || "—"}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {!canManageManual && (
                <p className="text-xs text-muted-foreground">
                  أزرار الطباعة والإلغاء متاحة للمدير العام والمدير التنفيذي فقط.
                </p>
              )}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setManualGroupRef(null)}>إغلاق</Button>
            {canManageManual && manualGroup && (
              <>
                <Button variant="outline" onClick={printManualGroup}>
                  <Printer className="w-4 h-4 ml-1" /> طباعة
                </Button>
                <Button variant="destructive" onClick={cancelManualGroup} disabled={manualBusy}>
                  <Trash2 className="w-4 h-4 ml-1" /> إلغاء التوريدة
                </Button>
              </>
            )}
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
