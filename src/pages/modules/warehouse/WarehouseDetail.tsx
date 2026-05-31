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
import { printSupplyRequest, printOrderInvoice } from "@/lib/printUtils";

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
  const { canManageWarehouses, user, isGeneralManager, isExecutiveManager } = useAuth();
  const canDeleteOutletOrder = isGeneralManager || isExecutiveManager;
  const { toast } = useToast();
  const [warehouse, setWarehouse] = useState<any>(null);
  const [allWarehouses, setAllWarehouses] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [movements, setMovements] = useState<any[]>([]);
  const [orderItems, setOrderItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [supplyDialog, setSupplyDialog] = useState(false);
  // الكميات المطلوبة بوحدة نص كيلو (= 0.5 كجم لكل وحدة)
  const [supplyQty, setSupplyQty] = useState<Record<string, number>>({});
  const [transfers, setTransfers] = useState<any[]>([]);
  const [outletOrders, setOutletOrders] = useState<any[]>([]);
  // مخزون المخزن الرئيسي (قبل الطلبات) — لعرضه في حوار التوريد
  const [mainStockByName, setMainStockByName] = useState<Record<string, number>>({});
  const [receiveDialog, setReceiveDialog] = useState<any>(null); // transfer obj
  const [editRequestDialog, setEditRequestDialog] = useState<any>(null); // transfer obj
  const [editRequestQty, setEditRequestQty] = useState<Record<string, number>>({}); // line_id -> half-kg packages

  const [receiveLines, setReceiveLines] = useState<Record<string, { qty: number; notes: string }>>({});
  const [receiveHeaderNotes, setReceiveHeaderNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);


  const isAgouza = useMemo(() => !!warehouse && (warehouse.name?.includes("العجوزة") || warehouse.location?.includes("العجوزة")), [warehouse]);
  const isMain = useMemo(() => !!warehouse && !isAgouza && (warehouse.name?.includes("الرئيسي") || warehouse.name?.includes("المقر") || warehouse.type === "finished_goods"), [warehouse, isAgouza]);
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
    // عند العرض من العجوزة نعرض أيضاً الطلبات المسجَّلة على المخزن الرئيسي (عرض فقط + تصدير)
    const orderSourceIds = [id];
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const { data: ords } = await supabase
      .from("orders")
      .select("id, order_number, created_at, status, fulfillment_type, total, subtotal, discount, delivery_fee, notes, delivery_address, payment_status, payment_method, source_warehouse_id, source:warehouses!orders_source_warehouse_id_fkey(name), customer:customers(name, phone, governorate), order_items(product_name, quantity, unit_price, total_price, offer_name)")
      .in("source_warehouse_id", orderSourceIds)
      .gte("created_at", fiveDaysAgo)
      .order("created_at", { ascending: false })
      .limit(2000);
    // فلترة: نعرض فقط طلبات (تسليم/توصيل) المسجَّلة على هذا المخزن (العجوزة أو الرئيسي)
    const currentIsMain = !!wRes.data && !currentIsAgouza && ((wRes.data.name || "").includes("الرئيسي") || (wRes.data.name || "").includes("المقر") || wRes.data.type === "finished_goods");
    const filteredOrds = (ords || []).filter((o: any) => {
      if (!currentIsAgouza && !currentIsMain) return true;
      if (o.source_warehouse_id !== id) return false;
      const ft = o.fulfillment_type;
      return ft === "pickup" || ft === "delivery";
    });
    setOutletOrders(filteredOrds);

    // مخزون المخزن الرئيسي (raw stock قبل خصم الطلبات) — للعرض في حوار التوريد
    if (currentIsAgouza && mainWh) {
      const { data: mainInv } = await supabase
        .from("inventory_items")
        .select("name, stock")
        .eq("warehouse_id", mainWh.id);
      const map: Record<string, number> = {};
      (mainInv || []).forEach((r: any) => {
        const key = (r.name || "").trim();
        if (key) map[key] = (map[key] || 0) + Number(r.stock || 0);
      });
      setMainStockByName(map);
    } else {
      setMainStockByName({});
    }
    setLoading(false);
  };


  useEffect(() => { fetchAll(); }, [id]);

  // Realtime: refresh when orders/order_items change so new orders by moderators appear instantly
  useEffect(() => {
    if (!id) return;
    const ch = supabase
      .channel(`warehouse-detail-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => fetchAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "order_items" }, () => fetchAll())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id]);


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

  // قائمة احتياج التوريد. كل القيم هنا بوحدة "نص كيلو" (1 وحدة = 0.5 كجم)
  // الحد الأقصى للكمية المقترحة 20 نص كيلو (= 10 كجم).
  const MAX_HALF_KG = 20;
  const kgToHalf = (kg: number) => Math.max(0, Math.round(kg * 2));
  const supplyNeeds = useMemo(() => {
    if (!isAgouza) return [];
    const needs: Array<{ name: string; demandHalf: number; stockHalf: number; mainStockHalf: number; suggestedHalf: number; unit: string; item?: any }> = [];
    const seen = new Set<string>();

    // 1) كل المنتجات الموجودة فى مخزن العجوزة (حتى لو الرصيد صفر أو مفيش طلبات عليها)
    items.forEach((item: any) => {
      const name = (item.name || "").trim();
      if (!name || seen.has(name)) return;
      seen.add(name);
      const stockKg = Number(item.stock || 0);
      const demandKg = demandByProduct.get(name) || 0;
      const demandHalf = Math.ceil(demandKg * 2);
      const stockHalf = Math.floor(stockKg * 2);
      const mainStockHalf = Math.floor((mainStockByName[name] ?? 0) * 2);
      const rawSuggested = Math.max(0, demandHalf - stockHalf);
      const suggestedHalf = Math.min(MAX_HALF_KG, rawSuggested);
      needs.push({ name, demandHalf, stockHalf, mainStockHalf, suggestedHalf, unit: item?.unit || "كجم", item });
    });

    // 2) كمان أى منتج عليه طلب لكنه مش موجود كصنف فى العجوزة لسه
    demandByProduct.forEach((demandKg, name) => {
      if (seen.has(name)) return;
      seen.add(name);
      const item = items.find((i: any) => i.name?.trim() === name);
      const stockKg = item ? Number(item.stock) : 0;
      const demandHalf = Math.ceil(demandKg * 2);
      const stockHalf = Math.floor(stockKg * 2);
      const mainStockHalf = Math.floor((mainStockByName[name] ?? 0) * 2);
      const rawSuggested = Math.max(0, demandHalf - stockHalf);
      const suggestedHalf = Math.min(MAX_HALF_KG, rawSuggested);
      needs.push({ name, demandHalf, stockHalf, mainStockHalf, suggestedHalf, unit: item?.unit || "كجم", item });
    });

    // 3) ترتيب: المقترح أكتر الأول، بعدين الأكثر متاح بالرئيسي
    return needs.sort((a, b) => (b.suggestedHalf - a.suggestedHalf) || (b.mainStockHalf - a.mainStockHalf) || a.name.localeCompare(b.name, "ar"));
  }, [demandByProduct, items, isAgouza, mainStockByName]);

  // طلبات الاستلام من المخزن الرئيسي — لمسؤول المخزن (هادى) ولأحمد خاطر فى العجوزة (عرض)
  const pickupOrders = useMemo(() => {
    if (!isMain && !isAgouza) return [];
    return outletOrders.filter((o: any) => {
      if (o.fulfillment_type !== "pickup") return false;
      if (["delivered", "cancelled", "returned"].includes(o.status)) return false;
      if (isMain) return o.source_warehouse_id === id;
      // isAgouza: show pickup orders from main warehouse
      return o.source_warehouse_id && o.source_warehouse_id !== id;
    });
  }, [outletOrders, isMain, isAgouza, id]);


  const handlePrintPickupInvoice = (o: any) => {
    printOrderInvoice({
      order_number: o.order_number,
      created_at: o.created_at,
      customer_name: o.customer?.name || "-",
      customer_phone: o.customer?.phone || "",
      delivery_address: o.delivery_address || "",
      payment_method: o.payment_method || "cash",
      payment_status: o.payment_status || "pending",
      notes: o.notes || "",
      items: (o.order_items || []).map((it: any) => ({
        product_name: it.product_name,
        quantity: Number(it.quantity || 0),
        unit_price: Number(it.unit_price || 0),
        total_price: Number(it.total_price || 0),
        offer_name: it.offer_name,
      })),
      subtotal: Number(o.subtotal || 0),
      discount: Number(o.discount || 0),
      delivery_fee: Number(o.delivery_fee || 0),
      total: Number(o.total ?? 0),
      source_warehouse_name: o.source?.name || warehouse?.name || "",
    } as any);
  };


  const openSupplyDialog = () => {
    const init: Record<string, number> = {};
    supplyNeeds.forEach(n => { init[n.name] = n.suggestedHalf; });
    setSupplyQty(init);
    setSupplyDialog(true);
  };


  const submitSupplyRequest = async () => {

    if (!mainWarehouse) {
      toast({ title: "لا يوجد مخزن رئيسي", description: "تعذر تحديد المخزن المصدر", variant: "destructive" });
      return;
    }
    // supplyQty قيمها بوحدة نص كيلو — نحولها لكجم قبل الإرسال للـ RPC
    const requested = Object.entries(supplyQty).filter(([_, q]) => q > 0);
    if (requested.length === 0) {
      toast({ title: "لا يوجد أصناف", description: "أدخل كميات أكبر من صفر", variant: "destructive" });
      return;
    }

    // Resolve source item IDs by name from main warehouse
    const { data: mainItems, error: mErr } = await supabase
      .from("inventory_items")
      .select("id, name, stock")
      .eq("warehouse_id", mainWarehouse.id);
    if (mErr) {
      toast({ title: "تعذّر قراءة مخزون الرئيسي", description: mErr.message, variant: "destructive" });
      return;
    }

    const lines: Array<{ source_item_id: string; qty: number }> = [];
    const missing: string[] = [];
    const insufficient: string[] = [];
    for (const [name, halfQty] of requested) {
      const qtyKg = Number(halfQty) * 0.5;
      const src = (mainItems || []).find((m: any) => m.name?.trim() === name.trim());
      if (!src) { missing.push(name); continue; }
      if (Number(src.stock) < qtyKg) { insufficient.push(`${name} (متاح ${src.stock} كجم)`); continue; }
      lines.push({ source_item_id: src.id, qty: qtyKg });
    }

    if (lines.length === 0) {
      const details = [
        missing.length ? `مفقود من الرئيسي: ${missing.join("، ")}` : "",
        insufficient.length ? `غير كافٍ: ${insufficient.join("، ")}` : "",
      ].filter(Boolean).join(" • ");
      toast({ title: "لا يمكن التنفيذ", description: details || "راجع الكميات", variant: "destructive" });
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
      const printLines = requested.map(([name, halfQty]) => {
        const qtyKg = Number(halfQty) * 0.5;
        return { name, qty: qtyKg, unit: "كجم" };
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
    // store in half-kg packages (1 package = 0.5 kg)
    (t.items || []).forEach((li: any) => { init[li.id] = Math.round(Number(li.requested_qty) * 2); });
    setApproveQty(init);
    setApproveDialog(t);
  };

  const submitApprove = async () => {
    if (!approveDialog) return;
    // convert packages back to kg before sending
    const approved_lines = Object.entries(approveQty).map(([line_id, pkgs]) => ({ line_id, approved_qty: Number(pkgs) * 0.5 }));
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

  const openEditRequestDialog = (t: any) => {
    const init: Record<string, number> = {};
    (t.items || []).forEach((li: any) => { init[li.id] = Math.round(Number(li.requested_qty) * 2); });
    setEditRequestQty(init);
    setEditRequestDialog(t);
  };

  const submitEditRequest = async () => {
    if (!editRequestDialog) return;
    const lines = Object.entries(editRequestQty).map(([line_id, pkgs]) => ({
      line_id, qty: Number(pkgs) * 0.5,
    }));
    setSubmitting(true);
    const { error } = await supabase.rpc("update_transfer_request_quantities", {
      p_transfer_id: editRequestDialog.id,
      p_lines: lines,
    });
    setSubmitting(false);
    if (error) {
      toast({ title: "تعذر تعديل الطلب", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "تم تعديل الطلب", description: "تم حفظ الكميات الجديدة" });
    setEditRequestDialog(null);
    fetchAll();
  };

  const cancelTransferRequest = async (t: any) => {
    if (!window.confirm(`هل تريد إلغاء طلب التحويل ${t.transfer_no} بالكامل؟`)) return;
    setSubmitting(true);
    const { data, error } = await supabase.rpc("cancel_transfer_request", { p_transfer_id: t.id });
    setSubmitting(false);
    if (error) {
      toast({ title: "تعذر الإلغاء", description: error.message, variant: "destructive" });
      return;
    }
    const result = data as any;
    if (!result?.success) {
      toast({ title: "تعذر الإلغاء", description: result?.message || "لا يمكن إلغاء هذا الطلب", variant: "destructive" });
      return;
    }
    toast({ title: "تم إلغاء الطلب" });
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
      "م": i + 1, "الصنف": n.name,
      "الطلب (نص كيلو)": n.demandHalf,
      "الرصيد بالعجوزة (نص كيلو)": n.stockHalf,
      "المتاح بالرئيسي (نص كيلو)": n.mainStockHalf,
      "الكمية المقترحة (نص كيلو)": n.suggestedHalf,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{ wch: 5 }, { wch: 30 }, { wch: 16 }, { wch: 22 }, { wch: 22 }, { wch: 22 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "احتياج التوريد");
    XLSX.writeFile(wb, `احتياج-توريد-${warehouse?.name || ""}.xlsx`);
  };

  // طلبات منفذ المخزن — تجميع وتصدير Excel
  const statusArLabel = (s: string) => ({
    pending: "قيد المراجعة", confirmed: "مؤكد", processing: "قيد التجهيز",
    ready: "جاهز", shipped: "تم الشحن", out_for_delivery: "خرج للتوصيل",
    delivered: "تم التسليم", cancelled: "ملغى", returned: "مرتجع",
  }[s] || s);
  const fulfillmentLabel = (f: string) => ({
    pickup: "استلام من المنفذ", delivery: "توصيل", shipping: "شحن",
  }[f] || f || "-");

  const exportOutletOrdersExcel = () => {
    const summary = outletOrders.map((o, i) => ({
      "م": i + 1,
      "رقم الطلب": o.order_number,
      "التاريخ": new Date(o.created_at).toLocaleString("ar-EG"),
      "المخزن": o.source?.name || "-",
      "العميل": o.customer?.name || "-",
      "الهاتف": o.customer?.phone || "-",
      "المحافظة": o.customer?.governorate || "-",
      "نوع التنفيذ": fulfillmentLabel(o.fulfillment_type),
      "الحالة": statusArLabel(o.status),
      "الدفع": o.payment_method || "-",
      "حالة الدفع": o.payment_status || "-",
      "عدد الأصناف": (o.order_items || []).length,
      "الإجمالي": Number(o.total ?? o.total_amount ?? 0),

    }));
    const lines: any[] = [];
    outletOrders.forEach((o) => {
      (o.order_items || []).forEach((li: any) => {
        lines.push({
          "رقم الطلب": o.order_number,
          "التاريخ": new Date(o.created_at).toLocaleString("ar-EG"),
          "المخزن": o.source?.name || "-",
          "العميل": o.customer?.name || "-",
          "الصنف": li.product_name,
          "الكمية": Number(li.quantity || 0),
          "سعر الوحدة": Number(li.unit_price || 0),
          "الإجمالي": Number(li.total_price || 0),
        });
      });
    });
    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.json_to_sheet(summary);
    ws1["!cols"] = [{ wch: 5 }, { wch: 14 }, { wch: 18 }, { wch: 18 }, { wch: 22 }, { wch: 14 }, { wch: 12 }, { wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws1, "ملخص الطلبات");
    const ws2 = XLSX.utils.json_to_sheet(lines);
    ws2["!cols"] = [{ wch: 14 }, { wch: 18 }, { wch: 18 }, { wch: 22 }, { wch: 30 }, { wch: 10 }, { wch: 12 }, { wch: 12 }];

    XLSX.utils.book_append_sheet(wb, ws2, "تفاصيل الأصناف");
    XLSX.writeFile(wb, `طلبات-${warehouse?.name || "المنفذ"}-${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  const printOutletOrder = (o: any) => {
    printOrderInvoice({
      order_number: o.order_number,
      created_at: o.created_at,
      customer_name: o.customer?.name || "-",
      customer_phone: o.customer?.phone || "",
      delivery_address: o.delivery_address || null,
      payment_method: o.payment_method || "",
      payment_status: o.payment_status || "",
      source_warehouse_name: o.source?.name || warehouse?.name || null,
      notes: o.notes || null,
      items: (o.order_items || []).map((li: any) => ({
        product_name: li.product_name,
        quantity: Number(li.quantity || 0),
        unit_price: Number(li.unit_price || 0),
        total_price: Number(li.total_price || 0),
        offer_name: li.offer_name || null,
      })),
      subtotal: Number(o.subtotal || 0),
      discount: Number(o.discount || 0),
      delivery_fee: Number(o.delivery_fee || 0),
      total: Number(o.total ?? 0),
    });
  };

  const deleteOutletOrder = async (o: any) => {
    if (!canDeleteOutletOrder) {
      toast({ title: "غير مسموح", description: "حذف الطلبات من صلاحيات المدير العام والتنفيذي فقط", variant: "destructive" });
      return;
    }
    if (!window.confirm(`تأكيد حذف الطلب ${o.order_number}؟ لا يمكن التراجع.`)) return;
    const { error: e1 } = await supabase.from("order_items").delete().eq("order_id", o.id);
    if (e1) { toast({ title: "خطأ", description: e1.message, variant: "destructive" }); return; }
    const { error: e2 } = await supabase.from("orders").delete().eq("id", o.id);
    if (e2) { toast({ title: "خطأ", description: e2.message, variant: "destructive" }); return; }
    toast({ title: "تم الحذف", description: `الطلب ${o.order_number} تم حذفه` });
    setOutletOrders((prev) => prev.filter((x) => x.id !== o.id));
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
            {(isMain || isAgouza) && (
              <TabsTrigger value="pickup" className="gap-1">
                <Package className="w-4 h-4" />استلام من المخزن
                {pickupOrders.length > 0 && <Badge variant="destructive" className="mr-1">{pickupOrders.length}</Badge>}
              </TabsTrigger>
            )}

                {pickupOrders.length > 0 && <Badge variant="destructive" className="mr-1">{pickupOrders.length}</Badge>}
              </TabsTrigger>
            )}


            <TabsTrigger value="outlet" className="gap-1">
              <FileSpreadsheet className="w-4 h-4" />طلبات المنفذ
              {outletOrders.length > 0 && <Badge variant="secondary" className="mr-1">{outletOrders.length}</Badge>}
            </TabsTrigger>
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
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:bg-destructive/10"
                        title="حذف الطلب نهائياً"
                        onClick={() => cancelTransferRequest(t)}
                      >
                        <XCircle className="w-4 h-4 ml-1" />حذف
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
                      <TableHead>الصنف</TableHead><TableHead>المطلوب (عبوات ½ كجم)</TableHead><TableHead>الإجمالي (كجم)</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {(t.items || []).map((li: any) => (
                        <TableRow key={li.id}>
                          <TableCell className="font-medium">{li.item_name}</TableCell>
                          <TableCell>{Math.round(Number(li.requested_qty) * 2)} عبوة</TableCell>
                          <TableCell className="text-muted-foreground">{Number(li.requested_qty).toFixed(1)} كجم</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <div className="p-3 border-t flex justify-end gap-2">
                    {t.status === "pending_approval" && (
                      <Button size="sm" variant="default" onClick={() => openEditRequestDialog(t)}>
                        تعديل الكميات
                      </Button>
                    )}
                    {t.status === "pending_approval" && (
                      <Button size="sm" variant="outline" className="text-destructive border-destructive/40 hover:bg-destructive/10" onClick={() => cancelTransferRequest(t)}>
                        <XCircle className="w-4 h-4 ml-1" />إلغاء الطلب
                      </Button>
                    )}
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
                      <TableHead>الصنف</TableHead><TableHead>الطلب (نص كيلو)</TableHead>
                      <TableHead>الرصيد بالعجوزة (نص كيلو)</TableHead>
                      <TableHead>المتاح بالرئيسي (نص كيلو)</TableHead>
                      <TableHead>الكمية المقترحة (نص كيلو)</TableHead><TableHead>الحالة</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {supplyNeeds.length === 0 ? (
                        <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">لا يوجد احتياج توريد حالياً</TableCell></TableRow>
                      ) : supplyNeeds.map(n => (
                        <TableRow key={n.name}>
                          <TableCell className="font-medium">{n.name}</TableCell>
                          <TableCell>{n.demandHalf}</TableCell>
                          <TableCell className={n.stockHalf === 0 ? "text-destructive font-bold" : ""}>{n.stockHalf}</TableCell>
                          <TableCell className={n.mainStockHalf === 0 ? "text-destructive font-bold" : ""}>{n.mainStockHalf}</TableCell>
                          <TableCell className="text-orange-600 font-bold">{n.suggestedHalf}</TableCell>
                          <TableCell>
                            {n.stockHalf === 0
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

          <TabsContent value="outlet" className="space-y-3">
            <Card>
              <CardHeader className="pb-3 flex flex-row items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
                    {isAgouza ? "طلبات منفذ العجوزة + المخزن الرئيسي" : `طلبات منفذ ${warehouse.name}`}
                  </CardTitle>
                  <CardDescription>
                    {isAgouza
                      ? `كل الطلبات المسجَّلة على العجوزة والمخزن الرئيسي (عرض فقط) • إجمالى ${outletOrders.length}`
                      : `الطلبات المسجَّلة على هذا المنفذ • إجمالى ${outletOrders.length}`}
                  </CardDescription>
                </div>
                <Button size="sm" variant="outline" onClick={exportOutletOrdersExcel} disabled={outletOrders.length === 0}>
                  <FileSpreadsheet className="w-4 h-4 ml-1 text-emerald-600" />تحميل Excel
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                {outletOrders.length === 0 ? (
                  <div className="py-10 text-center text-muted-foreground">لا توجد طلبات مسجّلة على هذا المنفذ</div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader><TableRow>
                        <TableHead>رقم الطلب</TableHead><TableHead>التاريخ</TableHead>
                        <TableHead>المخزن</TableHead>
                        <TableHead>العميل</TableHead><TableHead>المحافظة</TableHead>
                        <TableHead>التنفيذ</TableHead><TableHead>الحالة</TableHead>
                        <TableHead>الإجمالى</TableHead>
                        <TableHead className="text-center">إجراءات</TableHead>
                      </TableRow></TableHeader>
                      <TableBody>
                        {outletOrders.slice(0, 200).map((o) => (
                          <TableRow key={o.id}>
                            <TableCell className="font-mono text-xs">{o.order_number}</TableCell>
                            <TableCell className="text-xs">{formatDateTime(o.created_at)}</TableCell>
                            <TableCell className="text-xs">
                              <Badge variant={o.source_warehouse_id === id ? "default" : "secondary"}>{o.source?.name || "-"}</Badge>
                            </TableCell>
                            <TableCell>{o.customer?.name || "-"}</TableCell>
                            <TableCell className="text-xs">{o.customer?.governorate || "-"}</TableCell>
                            <TableCell className="text-xs">{fulfillmentLabel(o.fulfillment_type)}</TableCell>
                            <TableCell><Badge variant="outline">{statusArLabel(o.status)}</Badge></TableCell>
                            <TableCell className="font-semibold">{Number(o.total ?? o.total_amount ?? 0).toLocaleString()}</TableCell>
                            <TableCell>
                              <div className="flex items-center justify-center gap-1">
                                <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => printOutletOrder(o)}>
                                  طباعة
                                </Button>
                                {isGeneralManager && (
                                  <Button size="sm" variant="destructive" className="h-7 px-2" onClick={() => deleteOutletOrder(o)}>
                                    حذف
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {outletOrders.length > 200 && (
                      <div className="p-3 text-center text-xs text-muted-foreground">يتم عرض أحدث 200 طلب — حمّل ملف Excel للحصول على الكل ({outletOrders.length})</div>
                    )}
                  </div>
                )}

              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="pickup" className="space-y-3">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Package className="w-5 h-5 text-primary" />
                  طلبات استلام من المخزن الرئيسي
                </CardTitle>
                <CardDescription>
                  الأوردرات اللى العميل هيستلمها من المخزن — جهّز الفاتورة والأصناف قبل وصوله • إجمالى {pickupOrders.length}
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {pickupOrders.length === 0 ? (
                  <div className="py-10 text-center text-muted-foreground">لا توجد طلبات استلام معلقة حالياً</div>
                ) : (
                  <div className="divide-y">
                    {pickupOrders.map((o: any) => {
                      const itemsCount = (o.order_items || []).length;
                      const total = Number(o.total ?? 0);
                      return (
                        <div key={o.id} className="p-4 space-y-3">
                          <div className="flex items-start justify-between flex-wrap gap-2">
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-mono text-sm font-semibold">{o.order_number}</span>
                                <Badge variant="outline">{statusArLabel(o.status)}</Badge>
                                <Badge variant={o.payment_status === "paid" ? "default" : "secondary"}>
                                  {o.payment_status === "paid" ? "مدفوع" : "غير مدفوع"} • {o.payment_method || "-"}
                                </Badge>
                              </div>
                              <div className="text-xs text-muted-foreground mt-1">{formatDateTime(o.created_at)}</div>
                              <div className="text-sm mt-2">
                                <span className="font-medium">{o.customer?.name || "-"}</span>
                                {o.customer?.phone && <span className="text-muted-foreground mr-2 font-mono">{o.customer.phone}</span>}
                              </div>
                            </div>
                            <div className="text-left">
                              <div className="text-xs text-muted-foreground">الإجمالى</div>
                              <div className="text-xl font-bold text-primary">{total.toLocaleString()} ج.م</div>
                              <Button size="sm" className="mt-2" onClick={() => handlePrintPickupInvoice(o)}>
                                <FileSpreadsheet className="w-4 h-4 ml-1" />طباعة الفاتورة
                              </Button>
                            </div>
                          </div>
                          <div className="bg-muted/40 rounded-md overflow-hidden">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>الصنف</TableHead>
                                  <TableHead className="text-center">الكمية</TableHead>
                                  <TableHead className="text-center">السعر</TableHead>
                                  <TableHead className="text-left">الإجمالى</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {(o.order_items || []).map((li: any, idx: number) => (
                                  <TableRow key={idx}>
                                    <TableCell className="text-sm">{li.product_name}{li.offer_name ? <span className="text-xs text-muted-foreground mr-1">({li.offer_name})</span> : null}</TableCell>
                                    <TableCell className="text-center text-sm">{Number(li.quantity || 0)}</TableCell>
                                    <TableCell className="text-center text-sm">{Number(li.unit_price || 0).toLocaleString()}</TableCell>
                                    <TableCell className="text-left text-sm font-semibold">{Number(li.total_price || 0).toLocaleString()}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                          {o.notes && (
                            <div className="text-xs bg-yellow-50 border border-yellow-200 rounded px-3 py-2">
                              <span className="font-semibold">ملاحظات: </span>{o.notes}
                            </div>
                          )}
                          <div className="text-xs text-muted-foreground">عدد الأصناف: {itemsCount}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

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
                  <TableHead>الصنف</TableHead>
                  <TableHead>متاح بالعجوزة</TableHead>
                  <TableHead>متاح بالرئيسي (قبل الطلبات)</TableHead>
                  
                  <TableHead>الكمية (نص كيلو)</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {supplyNeeds.map(n => {
                    const cap = Math.min(MAX_HALF_KG, n.mainStockHalf || MAX_HALF_KG);
                    return (
                      <TableRow key={n.name}>
                        <TableCell className="font-medium">{n.name}</TableCell>
                        <TableCell>{n.stockHalf} نص كيلو</TableCell>
                        <TableCell className={n.mainStockHalf === 0 ? "text-destructive font-bold" : ""}>{n.mainStockHalf} نص كيلو</TableCell>
                        
                        <TableCell>
                          <Input type="number" min={0} max={cap} step={1} className="w-24"
                            value={supplyQty[n.name] ?? 0}
                            onChange={e => {
                              const v = Math.max(0, Math.min(cap, Math.floor(Number(e.target.value) || 0)));
                              setSupplyQty({ ...supplyQty, [n.name]: v });
                            }} />
                          <div className="text-[10px] text-muted-foreground mt-1">حد أقصى {cap} (10 كجم{n.mainStockHalf < MAX_HALF_KG ? " أو المتاح بالرئيسي" : ""})</div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
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
              من {approveDialog?.destination?.name}. الكميات معروضة بعبوات نصف الكيلو. يمكنك تعديلها قبل الموافقة. عند الموافقة سيُخصم المخزون فوراً من {warehouse?.name}.
            </DialogDescription>
          </DialogHeader>
          <Table>

            <TableHeader><TableRow>
              <TableHead>الصنف</TableHead>
              <TableHead>المطلوب (عبوات ½ كجم)</TableHead>
              <TableHead>الموافق عليها (عبوات ½ كجم)</TableHead>
              <TableHead>الإجمالي (كجم)</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {(approveDialog?.items || []).map((li: any) => {
                const reqPkgs = Math.round(Number(li.requested_qty) * 2);
                const curPkgs = approveQty[li.id] ?? 0;
                return (
                  <TableRow key={li.id}>
                    <TableCell className="font-medium">{li.item_name}</TableCell>
                    <TableCell>{reqPkgs} عبوة</TableCell>
                    <TableCell>
                      <Input type="number" min={0} max={reqPkgs} step={1} className="w-24"
                        value={curPkgs}
                        onChange={e => setApproveQty({ ...approveQty, [li.id]: Math.max(0, Math.min(reqPkgs, Math.floor(Number(e.target.value)))) })} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{(curPkgs * 0.5).toFixed(1)} كجم</TableCell>
                  </TableRow>
                );
              })}
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

      {/* Edit My Pending Request Dialog — requester adjusts quantities before approval */}
      <Dialog open={!!editRequestDialog} onOpenChange={(o) => !o && setEditRequestDialog(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>تعديل طلب التوريد {editRequestDialog?.transfer_no}</DialogTitle>
            <DialogDescription>
              يمكنك زيادة أو نقصان الكميات بعبوات نص الكيلو (حد أقصى 20 عبوة = 10 كجم لكل صنف). ضع 0 لحذف الصنف من الطلب.
            </DialogDescription>
          </DialogHeader>
          <Table>
            <TableHeader><TableRow>
              <TableHead>الصنف</TableHead>
              <TableHead>الكمية (عبوات ½ كجم)</TableHead>
              <TableHead>الإجمالي (كجم)</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {(editRequestDialog?.items || []).map((li: any) => {
                const cur = editRequestQty[li.id] ?? 0;
                return (
                  <TableRow key={li.id}>
                    <TableCell className="font-medium">{li.item_name}</TableCell>
                    <TableCell>
                      <Input type="number" min={0} max={20} step={1} className="w-24"
                        value={cur}
                        onChange={e => setEditRequestQty({
                          ...editRequestQty,
                          [li.id]: Math.max(0, Math.min(20, Math.floor(Number(e.target.value) || 0)))
                        })} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{(cur * 0.5).toFixed(1)} كجم</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditRequestDialog(null)}>إلغاء</Button>
            <Button onClick={submitEditRequest} disabled={submitting}>
              <CheckCircle2 className="w-4 h-4 ml-1" />حفظ التعديلات
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
