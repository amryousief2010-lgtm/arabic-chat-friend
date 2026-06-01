import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Search, RefreshCw, ArrowUpRight, ArrowDownLeft, Loader2, Plus, Trash2, Pencil, Printer, FileSpreadsheet, FileText, Eye, Package, CheckCircle2, AlertTriangle, ChevronsUpDown, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import * as XLSX from "xlsx";

// كل عبوة = نص كيلو للأصناف الموزونة
const PACKAGE_KG = 0.5;
const isWeightUnit = (u?: string | null) => {
  const s = (u || "").toLowerCase();
  return s.includes("كيلو") || s.includes("كجم") || s.includes("kg");
};
// كم عبوة (نص كيلو) في الرصيد
const toPackages = (kg: number) => Math.floor((Number(kg) || 0) / PACKAGE_KG);

type ReceiptLine = {
  name: string;
  unit: string;
  inputQty: number;        // ما أدخله المستخدم (عبوة أو قطعة)
  inputUnit: string;       // "عبوة" أو الوحدة الأصلية
  deductedQty: number;     // ما خُصم فعلياً من المخزن الرئيسي بنفس وحدة الصنف
  deductedUnit: string;
};

interface Props {
  warehouseName: string; // exact warehouse name in DB
  pageTitle: string;
  pageSubtitle: string;
}

interface InventoryItem {
  id: string;
  name: string;
  unit: string;
  stock: number;
  product_id: string | null;
}

interface Movement {
  id: string;
  warehouse_id?: string;
  performed_at: string;
  movement_type: string;
  quantity: number;
  notes: string | null;
  party: string | null;
  item_id: string;
  product_id?: string | null;
  source_warehouse_id?: string | null;
  destination_warehouse_id?: string | null;
  reference_type?: string | null;
  item_name?: string;
}

const MAIN_WAREHOUSE_NAME_HINTS = ["الرئيسي", "المقر"];

const ensureMutationSucceeded = (
  error: { message?: string } | null,
  count: number | null | undefined,
  fallbackMessage: string,
) => {
  if (error) throw error;
  if (typeof count === "number" && count < 1) {
    throw new Error(fallbackMessage);
  }
};

export default function CustomerWarehouseView({ warehouseName, pageTitle, pageSubtitle }: Props) {
  const { user, isGeneralManager, isExecutiveManager, isWarehouseSupervisor } = useAuth();
  const canEditMovements = isGeneralManager || isExecutiveManager || isWarehouseSupervisor;
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [whId, setWhId] = useState<string | null>(null);
  const [mainWhId, setMainWhId] = useState<string | null>(null);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [mainItems, setMainItems] = useState<InventoryItem[]>([]);
  const [sellableProductNames, setSellableProductNames] = useState<Set<string>>(new Set());
  const [movements, setMovements] = useState<Movement[]>([]);

  // dialog state
  const [openDialog, setOpenDialog] = useState<null | "supply" | "return">(null);
  type Line = { name: string; qty: string };
  const [lines, setLines] = useState<Line[]>([{ name: "", qty: "" }]);
  const [notes, setNotes] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  // وضع المرتجع: هل نخصم من مخزون العميل (هيلثي تيست) أم نوّرد للمخزن الرئيسي فقط
  // (للمنتجات القديمة اللي مكنتش مسجلة في السيستم أصلاً).
  const [deductFromCustomer, setDeductFromCustomer] = useState<boolean>(true);

  // edit movement dialog
  const [editMov, setEditMov] = useState<Movement | null>(null);
  const [editQty, setEditQty] = useState<string>("");
  const [editBusy, setEditBusy] = useState(false);

  // edit/delete stock item dialog
  const [editItem, setEditItem] = useState<InventoryItem | null>(null);
  const [editStock, setEditStock] = useState<string>("");
  const [itemBusy, setItemBusy] = useState(false);

  // receipt (آخر عملية توريد/مرتجع) for print + excel
  const [receipt, setReceipt] = useState<{
    kind: "supply" | "return";
    at: string;
    notes: string;
    lines: ReceiptLine[];
  } | null>(null);

  const adjustMainForItem = async (itemName: string, unit: string, productId: string | null, delta: number) => {
    // delta > 0 -> add to main, delta < 0 -> subtract from main
    if (!mainWhId || delta === 0) return;
    let mainItem = mainItems.find((i) => i.name === itemName);
    if (!mainItem) {
      const { data: newRow, error } = await supabase
        .from("inventory_items")
        .insert({ warehouse_id: mainWhId, name: itemName, unit, stock: 0, product_id: productId })
        .select("id, name, unit, stock, product_id")
        .single();
      if (error || !newRow) throw error || new Error("تعذّر إنشاء صنف في المخزن الرئيسي");
      mainItem = newRow as InventoryItem;
    }
    const newStock = Number(mainItem.stock) + delta;
    if (newStock < 0) throw new Error("لا يمكن خصم كمية أكبر من رصيد المخزن الرئيسي");
    await supabase.from("inventory_items").update({ stock: newStock }).eq("id", mainItem.id);
  };

  const openItemEdit = (it: InventoryItem) => {
    setEditItem(it);
    setEditStock(String(it.stock));
  };

  const submitItemEdit = async () => {
    if (!editItem) return;
    const newStock = Number(editStock);
    if (!(newStock >= 0)) { toast.error("ادخل رصيداً صحيحاً"); return; }
    const diff = newStock - Number(editItem.stock);
    if (diff === 0) { setEditItem(null); return; }
    setItemBusy(true);
    try {
      // diff > 0: stock increased here -> deduct from main; diff < 0: returned to main
      await adjustMainForItem(editItem.name, editItem.unit, editItem.product_id, -diff);
      await supabase.from("inventory_items").update({ stock: newStock }).eq("id", editItem.id);
      // Log a correction movement
      await supabase.from("inventory_movements").insert({
        item_id: editItem.id,
        warehouse_id: whId,
        source_warehouse_id: diff > 0 ? mainWhId : whId,
        destination_warehouse_id: diff > 0 ? whId : mainWhId,
        movement_type: diff > 0 ? "in" : "out",
        quantity: Math.abs(diff),
        notes: "تعديل رصيد يدوي",
        party: warehouseName,
        reference_type: diff > 0 ? "customer_supply" : "customer_return",
        performed_by: user?.id ?? null,
        product_id: editItem.product_id,
      });
      toast.success("تم تعديل الرصيد");
      setEditItem(null);
      await fetchAll();
    } catch (e: any) {
      toast.error("فشل التعديل: " + (e?.message || ""));
    } finally {
      setItemBusy(false);
    }
  };

  const handleDeleteItem = async (it: InventoryItem) => {
    if (!canEditMovements) return;
    if (!confirm(`حذف "${it.name}" من ${warehouseName}؟ سيتم إرجاع الرصيد (${it.stock}) إلى المخزن الرئيسي.`)) return;
    try {
      const qty = Number(it.stock);
      if (qty > 0) {
        await adjustMainForItem(it.name, it.unit, it.product_id, qty);
        await supabase.from("inventory_movements").insert({
          item_id: it.id,
          warehouse_id: whId,
          source_warehouse_id: whId,
          destination_warehouse_id: mainWhId,
          movement_type: "out",
          quantity: qty,
          notes: "حذف صنف وإرجاع للمخزن الرئيسي",
          party: warehouseName,
          reference_type: "customer_return",
          performed_by: user?.id ?? null,
          product_id: it.product_id,
        });
      }
      const { error: deactivateError, count: deactivatedCount } = await supabase
        .from("inventory_items")
        .update({ stock: 0, is_active: false }, { count: "exact" })
        .eq("id", it.id);
      ensureMutationSucceeded(deactivateError, deactivatedCount, "لم يتم حذف الصنف من المخزن");
      toast.success("تم حذف الصنف وإرجاع الرصيد");
      await fetchAll();
    } catch (e: any) {
      toast.error("فشل الحذف: " + (e?.message || ""));
    }
  };

  const fetchAll = async () => {
    setLoading(true);
    try {
      const { data: whs } = await supabase
        .from("warehouses")
        .select("id, name")
        .eq("is_active", true);
      const target = (whs || []).find((w: any) => w.name === warehouseName);
      const main = (whs || []).find((w: any) =>
        MAIN_WAREHOUSE_NAME_HINTS.some((h) => w.name?.includes(h))
      );
      const targetId = target?.id ?? null;
      const mainId = main?.id ?? null;
      setWhId(targetId);
      setMainWhId(mainId);

      if (targetId) {
        const [itemsRes, movRes] = await Promise.all([
          supabase
            .from("inventory_items")
            .select("id, name, unit, stock, product_id")
            .eq("warehouse_id", targetId)
            .eq("is_active", true)
            .order("name"),
          supabase
            .from("inventory_movements")
            .select("id, warehouse_id, performed_at, movement_type, quantity, notes, party, item_id, product_id, source_warehouse_id, destination_warehouse_id, reference_type")
            .eq("warehouse_id", targetId)
            .order("performed_at", { ascending: false })
            .limit(200),
        ]);
        const its = (itemsRes.data || []) as InventoryItem[];
        setItems(its);
        const movs = (movRes.data || []) as Movement[];
        const nameMap = new Map(its.map((i) => [i.id, i.name]));
        setMovements(movs.map((m) => ({ ...m, item_name: nameMap.get(m.item_id) || "—" })));
      }

      if (mainId) {
        const { data: mItems } = await supabase
          .from("inventory_items")
          .select("id, name, unit, stock, product_id")
          .eq("warehouse_id", mainId)
          .eq("is_active", true)
          .order("name");
        setMainItems((mItems || []) as InventoryItem[]);
      }

      const { data: prodRows } = await supabase
        .from("products")
        .select("name")
        .eq("is_active", true);
      setSellableProductNames(new Set((prodRows || []).map((p: any) => (p.name || "").trim())));
    } catch (e: any) {
      toast.error("تعذّر تحميل بيانات المخزن: " + (e?.message || ""));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouseName]);

  const filteredItems = useMemo(() => {
    const q = search.trim();
    if (!q) return items;
    return items.filter((i) => i.name.includes(q));
  }, [items, search]);

  // تصدير الرصيد الحالي إلى Excel
  const exportStockExcel = () => {
    const rows = filteredItems.map((it) => {
      const stock = Number(it.stock) || 0;
      const weight = isWeightUnit(it.unit);
      return {
        "المنتج": it.name,
        "الوحدة": weight ? "عبوة (نص كيلو)" : it.unit,
        "الكمية (عبوة)": weight ? toPackages(stock) : "—",
        "الكمية (كجم)": weight ? stock : "—",
        "الكمية (قطعة/وحدة)": weight ? "—" : stock,
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "الرصيد الحالي");
    XLSX.writeFile(wb, `الرصيد-${warehouseName}-${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  // طباعة الرصيد الحالي
  const printStock = () => {
    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) return;
    const rowsHtml = filteredItems.map((it) => {
      const stock = Number(it.stock) || 0;
      const weight = isWeightUnit(it.unit);
      const qty = weight ? `${toPackages(stock)} عبوة (= ${stock} كجم)` : `${stock} ${it.unit}`;
      return `<tr><td>${it.name}</td><td>${weight ? "عبوة (نص كيلو)" : it.unit}</td><td>${qty}</td></tr>`;
    }).join("");
    w.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>الرصيد الحالي - ${warehouseName}</title>
      <style>
        body{font-family:'Segoe UI',Tahoma,sans-serif;padding:24px;color:#111}
        h1{font-size:20px;margin:0 0 4px}
        .sub{color:#666;font-size:12px;margin-bottom:16px}
        table{width:100%;border-collapse:collapse;font-size:13px}
        th,td{border:1px solid #ccc;padding:8px;text-align:right}
        th{background:#f3f4f6}
        tfoot td{font-weight:bold;background:#fafafa}
      </style></head><body>
      <h1>الرصيد الحالي — ${warehouseName}</h1>
      <div class="sub">تاريخ الطباعة: ${new Date().toLocaleString("ar-EG")} — عدد الأصناف: ${filteredItems.length}</div>
      <table><thead><tr><th>المنتج</th><th>الوحدة</th><th>الكمية</th></tr></thead>
      <tbody>${rowsHtml || `<tr><td colspan="3" style="text-align:center">لا توجد أصناف</td></tr>`}</tbody></table>
      <script>window.onload=()=>{setTimeout(()=>window.print(),300);}</script>
      </body></html>`);
    w.document.close();
  };

  // For supply: pick from main items (only items with actual stock — last inventory snapshot).
  // For return: pick from this warehouse's items.
  // Deduplicate by trimmed name — لو فى أكثر من صنف بنفس الاسم (مثلاً "اطباق" مرة بالقطعة ومرة بالكجم)
  // نختار الصف صاحب الرصيد الأكبر ونتجاهل التكرار الصفري.
  const pickList = (() => {
    const source = openDialog === "supply" ? mainItems : items;
    const byName = new Map<string, typeof source[number]>();
    for (const it of source) {
      const stock = Number(it.stock) || 0;
      if (stock <= 0) continue;
      const key = (it.name || "").trim();
      if (openDialog === "supply" && sellableProductNames.size > 0 && !sellableProductNames.has(key)) continue;
      const prev = byName.get(key);
      if (!prev || Number(prev.stock) < stock) byName.set(key, it);
    }
    return Array.from(byName.values());
  })();

  const resetDialog = () => {
    setLines([{ name: "", qty: "" }]);
    setNotes("");
  };

  const updateLine = (idx: number, patch: Partial<Line>) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };
  const addLine = () => setLines((prev) => [...prev, { name: "", qty: "" }]);
  const removeLine = (idx: number) =>
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)));

  const submit = async () => {
    if (!openDialog) return;
    if (!whId || !mainWhId) {
      toast.error("لم يتم تحديد المخزن الرئيسي أو مخزن العميل");
      return;
    }
    const sourcePool = openDialog === "supply" ? mainItems : items;

    // حوّل المدخلات: للأصناف الموزونة المدخل بالعبوة (نص كيلو) -> كيلو
    const valid = lines
      .map((l) => {
        const inputQty = Number(l.qty);
        const src = sourcePool.find((i) => i.name === l.name);
        if (!l.name || !(inputQty > 0) || !src) return null;
        const weight = isWeightUnit(src.unit);
        const realQty = weight ? inputQty * PACKAGE_KG : inputQty;
        return {
          name: l.name,
          inputQty,
          inputUnit: weight ? "عبوة" : (src.unit || "قطعة"),
          qty: realQty, // ما يُخصم فعلياً بوحدة الصنف
          unit: src.unit || "",
        };
      })
      .filter(Boolean) as Array<{ name: string; inputQty: number; inputUnit: string; qty: number; unit: string }>;

    if (valid.length === 0) {
      toast.error("اختر منتجاً واحداً على الأقل وادخل كمية صحيحة");
      return;
    }
    const names = valid.map((v) => v.name);
    if (new Set(names).size !== names.length) {
      toast.error("هناك منتج مكرر في القائمة");
      return;
    }
    setSubmitting(true);
    try {
      const sourceWh = openDialog === "supply" ? mainWhId : whId;
      const destWh = openDialog === "supply" ? whId : mainWhId;
      const destPool = openDialog === "supply" ? items : mainItems;
      const refType = openDialog === "supply" ? "customer_supply" : "customer_return";
      const partyLabel = warehouseName;
      const baseNote = notes || (openDialog === "supply" ? "توريد إلى عميل" : "مرتجع من عميل");

      // تحقق الرصيد قبل الخصم
      for (const v of valid) {
        const si = sourcePool.find((i) => i.name === v.name)!;
        if (Number(si.stock) < v.qty) {
          throw new Error(`الكمية المتاحة لـ "${v.name}" (${si.stock} ${si.unit}) أقل من المطلوب (${v.qty} ${v.unit})`);
        }
      }

      const movRows: any[] = [];

      for (const v of valid) {
        const sourceItem = sourcePool.find((i) => i.name === v.name)!;
        let destItem = destPool.find((i) => i.name === v.name);
        if (!destItem) {
          const { data: newRow, error: insErr } = await supabase
            .from("inventory_items")
            .insert({
              warehouse_id: destWh,
              name: v.name,
              unit: sourceItem.unit,
              stock: 0,
              product_id: sourceItem.product_id,
            })
            .select("id, name, unit, stock, product_id")
            .single();
          if (insErr || !newRow) throw insErr || new Error("تعذّر إنشاء صنف الوجهة");
          destItem = newRow as InventoryItem;
        }

        const { error: decErr } = await supabase
          .from("inventory_items")
          .update({ stock: Number(sourceItem.stock) - v.qty })
          .eq("id", sourceItem.id);
        if (decErr) throw decErr;

        const { error: incErr } = await supabase
          .from("inventory_items")
          .update({ stock: Number(destItem.stock) + v.qty })
          .eq("id", destItem.id);
        if (incErr) throw incErr;

        movRows.push(
          {
            item_id: sourceItem.id,
            warehouse_id: sourceWh,
            destination_warehouse_id: destWh,
            source_warehouse_id: sourceWh,
            movement_type: "out",
            quantity: v.qty,
            notes: baseNote,
            party: partyLabel,
            reference_type: refType,
            performed_by: user?.id ?? null,
            product_id: sourceItem.product_id,
          },
          {
            item_id: destItem.id,
            warehouse_id: destWh,
            source_warehouse_id: sourceWh,
            destination_warehouse_id: destWh,
            movement_type: "in",
            quantity: v.qty,
            notes: baseNote,
            party: partyLabel,
            reference_type: refType,
            performed_by: user?.id ?? null,
            product_id: sourceItem.product_id,
          },
        );
      }

      const { error: movErr } = await supabase.from("inventory_movements").insert(movRows);
      if (movErr) throw movErr;

      // احفظ إيصال آخر عملية للطباعة/التصدير
      setReceipt({
        kind: openDialog,
        at: new Date().toISOString(),
        notes: baseNote,
        lines: valid.map((v) => ({
          name: v.name,
          unit: v.unit,
          inputQty: v.inputQty,
          inputUnit: v.inputUnit,
          deductedQty: v.qty,
          deductedUnit: v.unit,
        })),
      });

      toast.success(
        openDialog === "supply"
          ? `تم تسجيل التوريد (${valid.length} صنف) بنجاح`
          : `تم تسجيل المرتجع (${valid.length} صنف) بنجاح`,
      );
      setOpenDialog(null);
      resetDialog();
      await fetchAll();
    } catch (e: any) {
      toast.error("فشل العملية: " + (e?.message || ""));
    } finally {
      setSubmitting(false);
    }
  };

  // Find the paired movement (other side of supply/return) for a given movement
  const findPair = async (m: Movement) => {
    if (!m.source_warehouse_id || !m.destination_warehouse_id) return null;
    let q = supabase
      .from("inventory_movements")
      .select("id, item_id, product_id, warehouse_id, movement_type, quantity, source_warehouse_id, destination_warehouse_id, reference_type, performed_at")
      .eq("source_warehouse_id", m.source_warehouse_id)
      .eq("destination_warehouse_id", m.destination_warehouse_id)
      .eq("performed_at", m.performed_at)
      .eq("quantity", m.quantity)
      .eq("reference_type", m.reference_type || "");
    if (m.product_id) q = q.eq("product_id", m.product_id);
    const { data } = await q;
    const rows = (data || []) as any[];
    return rows.find((r) => r.id !== m.id && r.item_id !== m.item_id && r.movement_type !== m.movement_type && r.warehouse_id !== m.warehouse_id) || null;
  };

  const getInvoiceMovementRows = async (inv: Invoice) => {
    const seed = inv.movements[0];
    if (!seed?.source_warehouse_id || !seed?.destination_warehouse_id) return inv.movements;

    let q = supabase
      .from("inventory_movements")
      .select("id, warehouse_id, performed_at, movement_type, quantity, notes, party, item_id, product_id, source_warehouse_id, destination_warehouse_id, reference_type")
      .eq("performed_at", inv.at)
      .eq("reference_type", inv.kind === "supply" ? "customer_supply" : "customer_return")
      .eq("source_warehouse_id", seed.source_warehouse_id)
      .eq("destination_warehouse_id", seed.destination_warehouse_id)
      .eq("party", warehouseName);

    if (inv.notes) q = q.eq("notes", inv.notes);

    const { data, error } = await q;
    if (error) throw error;
    return (data || []) as Movement[];
  };

  const handleDeleteMovement = async (m: Movement) => {
    if (!canEditMovements) return;
    if (!confirm("هل أنت متأكد من حذف هذه الحركة؟ سيتم عكس تأثيرها على الرصيد.")) return;
    try {
      const pair = await findPair(m);
      // Reverse stock for this side
      const thisItem = (await supabase.from("inventory_items").select("id, stock").eq("id", m.item_id).single()).data as any;
      if (thisItem) {
        const delta = m.movement_type === "in" ? -Number(m.quantity) : Number(m.quantity);
        const { error: thisItemError, count: thisItemCount } = await supabase
          .from("inventory_items")
          .update({ stock: Number(thisItem.stock) + delta }, { count: "exact" })
          .eq("id", m.item_id);
        ensureMutationSucceeded(thisItemError, thisItemCount, "تعذّر عكس رصيد الحركة الحالية");
      }
      if (pair) {
        const pItem = (await supabase.from("inventory_items").select("id, stock").eq("id", pair.item_id).single()).data as any;
        if (pItem) {
          const delta = pair.movement_type === "in" ? -Number(pair.quantity) : Number(pair.quantity);
          const { error: pairItemError, count: pairItemCount } = await supabase
            .from("inventory_items")
            .update({ stock: Number(pItem.stock) + delta }, { count: "exact" })
            .eq("id", pair.item_id);
          ensureMutationSucceeded(pairItemError, pairItemCount, "تعذّر عكس رصيد الحركة المقابلة");
        }
        const { error: pairDeleteError, count: pairDeleteCount } = await supabase
          .from("inventory_movements")
          .delete({ count: "exact" })
          .eq("id", pair.id);
        ensureMutationSucceeded(pairDeleteError, pairDeleteCount, "لم يتم حذف الحركة المقابلة");
      }
      const { error: deleteError, count: deletedCount } = await supabase
        .from("inventory_movements")
        .delete({ count: "exact" })
        .eq("id", m.id);
      ensureMutationSucceeded(deleteError, deletedCount, "لم يتم حذف الحركة");
      toast.success("تم حذف الحركة");
      await fetchAll();
    } catch (e: any) {
      toast.error("فشل الحذف: " + (e?.message || ""));
    }
  };

  const openEdit = (m: Movement) => {
    setEditMov(m);
    setEditQty(String(m.quantity));
  };

  const submitEdit = async () => {
    if (!editMov) return;
    const newQty = Number(editQty);
    if (!(newQty > 0)) {
      toast.error("ادخل كمية صحيحة");
      return;
    }
    const oldQty = Number(editMov.quantity);
    const diff = newQty - oldQty;
    if (diff === 0) {
      setEditMov(null);
      return;
    }
    setEditBusy(true);
    try {
      const pair = await findPair(editMov);
      // Adjust stock for this side
      const thisItem = (await supabase.from("inventory_items").select("id, stock").eq("id", editMov.item_id).single()).data as any;
      if (thisItem) {
        const delta = editMov.movement_type === "in" ? diff : -diff;
        if (Number(thisItem.stock) + delta < 0) throw new Error("الكمية الجديدة تُخفّض الرصيد لأقل من صفر");
        await supabase.from("inventory_items").update({ stock: Number(thisItem.stock) + delta }).eq("id", editMov.item_id);
      }
      if (pair) {
        const pItem = (await supabase.from("inventory_items").select("id, stock").eq("id", pair.item_id).single()).data as any;
        if (pItem) {
          const delta = pair.movement_type === "in" ? diff : -diff;
          if (Number(pItem.stock) + delta < 0) throw new Error("الكمية الجديدة تُخفّض رصيد المخزن الآخر لأقل من صفر");
          await supabase.from("inventory_items").update({ stock: Number(pItem.stock) + delta }).eq("id", pair.item_id);
        }
        await supabase.from("inventory_movements").update({ quantity: newQty }).eq("id", pair.id);
      }
      await supabase.from("inventory_movements").update({ quantity: newQty }).eq("id", editMov.id);
      toast.success("تم تعديل الحركة");
      setEditMov(null);
      await fetchAll();
    } catch (e: any) {
      toast.error("فشل التعديل: " + (e?.message || ""));
    } finally {
      setEditBusy(false);
    }
  };

  // تجميع الحركات على شكل فواتير (كل عملية توريد/مرتجع = فاتورة واحدة)
  type Invoice = { key: string; at: string; kind: "supply" | "return"; notes: string | null; movements: Movement[] };
  const invoices: Invoice[] = useMemo(() => {
    const map = new Map<string, Invoice>();
    for (const m of movements) {
      const isSupply = m.reference_type === "customer_supply";
      const isReturn = m.reference_type === "customer_return";
      if (!isSupply && !isReturn) continue;
      // لتفادي التكرار: نأخذ جهة واحدة فقط من كل عملية
      if (isSupply && m.movement_type !== "in") continue;
      if (isReturn && m.movement_type !== "out") continue;
      const key = `${m.performed_at}|${m.reference_type}`;
      if (!map.has(key)) {
        map.set(key, { key, at: m.performed_at, kind: isSupply ? "supply" : "return", notes: m.notes, movements: [] });
      }
      map.get(key)!.movements.push(m);
    }
    return Array.from(map.values()).sort((a, b) => b.at.localeCompare(a.at));
  }, [movements]);

  const openInvoice = (inv: Invoice) => {
    const lines: ReceiptLine[] = inv.movements.map((m) => {
      const it = items.find((i) => i.id === m.item_id);
      const unit = it?.unit || "";
      const weight = isWeightUnit(unit);
      const qty = Number(m.quantity);
      return {
        name: m.item_name || "—",
        unit,
        inputQty: weight ? qty / PACKAGE_KG : qty,
        inputUnit: weight ? "عبوة" : (unit || "قطعة"),
        deductedQty: qty,
        deductedUnit: unit,
      };
    });
    setReceipt({ kind: inv.kind, at: inv.at, notes: inv.notes || "", lines });
  };

  const handleDeleteInvoice = async (inv: Invoice) => {
    if (!canEditMovements) return;
    if (!confirm(`حذف الفاتورة بتاريخ ${new Date(inv.at).toLocaleString("ar-EG")} (${inv.movements.length} صنف)؟ سيتم عكس الحركات.`)) return;
    try {
      const relatedRows = await getInvoiceMovementRows(inv);
      if (relatedRows.length === 0) {
        throw new Error("الفاتورة غير موجودة حالياً أو تم حذفها بالفعل");
      }

      for (const m of relatedRows) {
        const itemRow = (await supabase.from("inventory_items").select("id, stock").eq("id", m.item_id).single()).data as any;
        if (!itemRow) continue;

        const delta = m.movement_type === "in" ? -Number(m.quantity) : Number(m.quantity);
        const { error: itemError, count: itemCount } = await supabase
          .from("inventory_items")
          .update({ stock: Number(itemRow.stock) + delta }, { count: "exact" })
          .eq("id", m.item_id);
        ensureMutationSucceeded(itemError, itemCount, `تعذّر عكس رصيد الصنف المرتبط بالفاتورة`);
      }

      const { error: deleteError, count: deletedCount } = await supabase
        .from("inventory_movements")
        .delete({ count: "exact" })
        .in("id", relatedRows.map((m) => m.id));
      if (deleteError) throw deleteError;
      if ((deletedCount || 0) < relatedRows.length) {
        throw new Error("لم يتم حذف كل حركات الفاتورة");
      }

      toast.success("تم حذف الفاتورة وعكس حركاتها");
      await fetchAll();
    } catch (e: any) {
      toast.error("فشل الحذف: " + (e?.message || ""));
      await fetchAll();
    }
  };

  // ===== تعديل فاتورة كاملة (تعديل كميات الأصناف أو حذف سطر) =====
  type EditInvLine = { movId: string; itemId: string; name: string; unit: string; originalQty: number; qty: string; remove: boolean; isNew?: boolean };
  const [editInvoice, setEditInvoice] = useState<Invoice | null>(null);
  const [editInvLines, setEditInvLines] = useState<EditInvLine[]>([]);
  const [editInvBusy, setEditInvBusy] = useState(false);

  const editInvoicePickList = useMemo(() => {
    const source = editInvoice?.kind === "supply" ? mainItems : items;
    const byName = new Map<string, typeof source[number]>();
    for (const it of source) {
      const stock = Number(it.stock) || 0;
      if (stock <= 0) continue;
      const key = (it.name || "").trim();
      if (editInvoice?.kind === "supply" && sellableProductNames.size > 0 && !sellableProductNames.has(key)) continue;
      const prev = byName.get(key);
      if (!prev || Number(prev.stock) < stock) byName.set(key, it);
    }
    return Array.from(byName.values());
  }, [editInvoice?.kind, items, mainItems, sellableProductNames]);

  const openEditInvoice = (inv: Invoice) => {
    setEditInvoice(inv);
    setEditInvLines(inv.movements.map((m) => {
      const it = items.find((i) => i.id === m.item_id);
      const unit = it?.unit || "";
      const weight = isWeightUnit(unit);
      const qty = Number(m.quantity);
      const display = weight ? qty / PACKAGE_KG : qty;
      return {
        movId: m.id,
        itemId: m.item_id,
        name: m.item_name || "—",
        unit,
        originalQty: qty,
        qty: String(display),
        remove: false,
      };
    }));
  };

  const addEditInvoiceLine = () => {
    setEditInvLines((prev) => [
      ...prev,
      {
        movId: `new-${Date.now()}-${prev.length}`,
        itemId: "",
        name: "",
        unit: "",
        originalQty: 0,
        qty: "",
        remove: false,
        isNew: true,
      },
    ]);
  };

  const applyMovementQtyChange = async (m: Movement, newQty: number) => {
    const oldQty = Number(m.quantity);
    const diff = newQty - oldQty;
    if (diff === 0) return;
    const pair = await findPair(m);
    const thisItem = (await supabase.from("inventory_items").select("id, stock").eq("id", m.item_id).single()).data as any;
    if (thisItem) {
      const delta = m.movement_type === "in" ? diff : -diff;
      if (Number(thisItem.stock) + delta < 0) throw new Error(`الكمية الجديدة تُخفّض رصيد "${m.item_name}" لأقل من صفر`);
      const { error } = await supabase.from("inventory_items").update({ stock: Number(thisItem.stock) + delta }).eq("id", m.item_id);
      if (error) throw error;
    }
    if (pair) {
      const pItem = (await supabase.from("inventory_items").select("id, stock").eq("id", pair.item_id).single()).data as any;
      if (pItem) {
        const delta = pair.movement_type === "in" ? diff : -diff;
        if (Number(pItem.stock) + delta < 0) throw new Error("الكمية الجديدة تُخفّض رصيد المخزن المقابل لأقل من صفر");
        const { error } = await supabase.from("inventory_items").update({ stock: Number(pItem.stock) + delta }).eq("id", pair.item_id);
        if (error) throw error;
      }
      await supabase.from("inventory_movements").update({ quantity: newQty }).eq("id", pair.id);
    }
    const { error: upErr } = await supabase.from("inventory_movements").update({ quantity: newQty }).eq("id", m.id);
    if (upErr) throw upErr;
  };

  const applyMovementDelete = async (m: Movement) => {
    const pair = await findPair(m);
    const thisItem = (await supabase.from("inventory_items").select("id, stock").eq("id", m.item_id).single()).data as any;
    if (thisItem) {
      const delta = m.movement_type === "in" ? -Number(m.quantity) : Number(m.quantity);
      const { error } = await supabase.from("inventory_items").update({ stock: Number(thisItem.stock) + delta }).eq("id", m.item_id);
      if (error) throw error;
    }
    if (pair) {
      const pItem = (await supabase.from("inventory_items").select("id, stock").eq("id", pair.item_id).single()).data as any;
      if (pItem) {
        const d = pair.movement_type === "in" ? -Number(pair.quantity) : Number(pair.quantity);
        const { error } = await supabase.from("inventory_items").update({ stock: Number(pItem.stock) + d }).eq("id", pair.item_id);
        if (error) throw error;
      }
      await supabase.from("inventory_movements").delete().eq("id", pair.id);
    }
    const { error: delErr, count } = await supabase.from("inventory_movements").delete({ count: "exact" }).eq("id", m.id);
    ensureMutationSucceeded(delErr, count, "تعذّر حذف السطر (تحقق من الصلاحيات)");
  };

  const addInvoiceMovementLine = async (line: EditInvLine) => {
    if (!editInvoice || !whId || !mainWhId) throw new Error("بيانات المخازن غير مكتملة");
    if (!line.name) throw new Error("اختر المنتج الجديد أولاً");

    const sourcePool = editInvoice.kind === "supply" ? mainItems : items;
    const destPool = editInvoice.kind === "supply" ? items : mainItems;
    const sourceWh = editInvoice.kind === "supply" ? mainWhId : whId;
    const destWh = editInvoice.kind === "supply" ? whId : mainWhId;
    const refType = editInvoice.kind === "supply" ? "customer_supply" : "customer_return";
    const baseNote = editInvoice.notes || (editInvoice.kind === "supply" ? "توريد إلى عميل" : "مرتجع من عميل");

    const sourceItem = sourcePool.find((i) => i.name === line.name);
    if (!sourceItem) throw new Error(`الصنف "${line.name}" غير متاح حالياً`);

    const inputQty = Number(line.qty);
    if (!(inputQty > 0)) throw new Error(`كمية غير صحيحة لـ "${line.name}"`);

    const weight = isWeightUnit(sourceItem.unit);
    const realQty = weight ? inputQty * PACKAGE_KG : inputQty;
    if (Number(sourceItem.stock) < realQty) {
      throw new Error(`الكمية المتاحة لـ "${line.name}" أقل من المطلوب`);
    }

    let destItem = destPool.find((i) => i.name === line.name);
    if (!destItem) {
      const { data: newRow, error: insErr } = await supabase
        .from("inventory_items")
        .insert({
          warehouse_id: destWh,
          name: line.name,
          unit: sourceItem.unit,
          stock: 0,
          product_id: sourceItem.product_id,
        })
        .select("id, name, unit, stock, product_id")
        .single();
      if (insErr || !newRow) throw insErr || new Error("تعذّر إنشاء الصنف الجديد في المخزن المقابل");
      destItem = newRow as InventoryItem;
    }

    const { error: sourceErr } = await supabase
      .from("inventory_items")
      .update({ stock: Number(sourceItem.stock) - realQty })
      .eq("id", sourceItem.id);
    if (sourceErr) throw sourceErr;

    const { error: destErr } = await supabase
      .from("inventory_items")
      .update({ stock: Number(destItem.stock) + realQty })
      .eq("id", destItem.id);
    if (destErr) throw destErr;

    const { error: movErr } = await supabase.from("inventory_movements").insert([
      {
        item_id: sourceItem.id,
        warehouse_id: sourceWh,
        source_warehouse_id: sourceWh,
        destination_warehouse_id: destWh,
        movement_type: "out",
        quantity: realQty,
        notes: baseNote,
        party: warehouseName,
        reference_type: refType,
        performed_by: user?.id ?? null,
        product_id: sourceItem.product_id,
        performed_at: editInvoice.at,
      },
      {
        item_id: destItem.id,
        warehouse_id: destWh,
        source_warehouse_id: sourceWh,
        destination_warehouse_id: destWh,
        movement_type: "in",
        quantity: realQty,
        notes: baseNote,
        party: warehouseName,
        reference_type: refType,
        performed_by: user?.id ?? null,
        product_id: sourceItem.product_id,
        performed_at: editInvoice.at,
      },
    ]);
    if (movErr) throw movErr;
  };

  const submitInvoiceEdit = async () => {
    if (!editInvoice) return;
    setEditInvBusy(true);
    try {
      const activeNames = editInvLines.filter((l) => !l.remove).map((l) => l.name).filter(Boolean);
      if (new Set(activeNames).size !== activeNames.length) {
        throw new Error("لا يمكن تكرار نفس المنتج داخل الفاتورة");
      }

      for (const line of editInvLines) {
        if (line.isNew) {
          if (line.remove || !line.name) continue;
          await addInvoiceMovementLine(line);
          continue;
        }

        const m = editInvoice.movements.find((mm) => mm.id === line.movId);
        if (!m) continue;
        if (line.remove) {
          await applyMovementDelete(m);
          continue;
        }
        const inputQty = Number(line.qty);
        if (!(inputQty > 0)) throw new Error(`كمية غير صحيحة لـ "${line.name}"`);
        const weight = isWeightUnit(line.unit);
        const realQty = weight ? inputQty * PACKAGE_KG : inputQty;
        if (realQty !== line.originalQty) {
          await applyMovementQtyChange(m, realQty);
        }
      }
      toast.success("تم حفظ تعديلات الفاتورة");
      setEditInvoice(null);
      await fetchAll();
    } catch (e: any) {
      toast.error("فشل التعديل: " + (e?.message || ""));
    } finally {
      setEditInvBusy(false);
    }
  };

  return (
    <DashboardLayout>
      <Header title={pageTitle} subtitle={pageSubtitle} />
      <div className="p-4 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="بحث باسم المنتج..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pr-9"
            />
          </div>
          <Button variant="outline" onClick={fetchAll} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ml-2 ${loading ? "animate-spin" : ""}`} />
            تحديث
          </Button>
          <Dialog open={openDialog === "supply"} onOpenChange={(o) => { setOpenDialog(o ? "supply" : null); if (!o) resetDialog(); }}>
            <DialogTrigger asChild>
              <Button className="gap-2"><ArrowUpRight className="w-4 h-4" /> توريد جديد</Button>
            </DialogTrigger>
          </Dialog>
          <Dialog open={openDialog === "return"} onOpenChange={(o) => { setOpenDialog(o ? "return" : null); if (!o) resetDialog(); }}>
            <DialogTrigger asChild>
              <Button variant="outline" className="gap-2"><ArrowDownLeft className="w-4 h-4" /> تسجيل مرتجع</Button>
            </DialogTrigger>
          </Dialog>
        </div>

        <Tabs defaultValue="stock" className="w-full">
          <TabsList>
            <TabsTrigger value="stock">الرصيد الحالي</TabsTrigger>
            <TabsTrigger value="movements">سجل التوريد والمرتجع</TabsTrigger>
          </TabsList>

          <TabsContent value="stock" className="space-y-4">
            {/* ملخص الرصيد */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Card className="bg-gradient-to-br from-primary/10 to-primary/5 border-primary/20">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                    <Package className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">عدد الأصناف</p>
                    <p className="text-xl font-bold text-primary">{filteredItems.length}</p>
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-gradient-to-br from-success/10 to-success/5 border-success/20">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-success/20 flex items-center justify-center">
                    <CheckCircle2 className="w-5 h-5 text-success" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">بها رصيد</p>
                    <p className="text-xl font-bold text-success">{filteredItems.filter((i) => Number(i.stock) > 0).length}</p>
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-gradient-to-br from-secondary/10 to-secondary/5 border-secondary/20">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-secondary/20 flex items-center justify-center">
                    <AlertTriangle className="w-5 h-5 text-secondary" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">نفذ رصيدها</p>
                    <p className="text-xl font-bold text-secondary">{filteredItems.filter((i) => Number(i.stock) <= 0).length}</p>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* أدوات الطباعة والتصدير */}
            <div className="flex flex-wrap gap-2 justify-end">
              <Button variant="outline" size="sm" className="gap-2" onClick={printStock} disabled={!filteredItems.length}>
                <Printer className="w-4 h-4" /> طباعة الرصيد
              </Button>
              <Button variant="outline" size="sm" className="gap-2" onClick={exportStockExcel} disabled={!filteredItems.length}>
                <FileSpreadsheet className="w-4 h-4" /> تصدير Excel
              </Button>
            </div>

            {/* عرض المنتجات كبطاقات */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredItems.length === 0 ? (
                <div className="col-span-full text-center py-12 text-muted-foreground">
                  {loading ? "جاري التحميل..." : "لا توجد منتجات بعد. ابدأ بتسجيل أول توريد."}
                </div>
              ) : (
                filteredItems.map((it) => {
                  const stock = Number(it.stock);
                  const isLow = stock <= 0;
                  const isMedium = !isLow && stock < 10;
                  const unitLabel = it.unit || "كجم";
                  return (
                    <Card key={it.id} className={`overflow-hidden border-l-4 transition-all duration-200 hover:shadow-lg ${isLow ? "border-l-destructive" : isMedium ? "border-l-warning" : "border-l-success"}`}>
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between gap-2">
                          <h4 className="font-bold text-foreground truncate flex-1" title={it.name}>{it.name}</h4>
                          {canEditMovements && (
                            <div className="flex gap-1 shrink-0">
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openItemEdit(it)} title="تعديل الرصيد">
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDeleteItem(it)} title="حذف وإرجاع للرئيسي">
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          )}
                        </div>

                        <div className="mt-3 flex items-baseline gap-2">
                          <div className="text-3xl font-extrabold text-foreground">{stock.toLocaleString("ar-EG")}</div>
                          <div className="text-sm text-muted-foreground">{unitLabel}</div>
                        </div>

                        <div className={`mt-2 text-xs font-semibold ${isLow ? "text-destructive" : isMedium ? "text-warning" : "text-success"}`}>
                          {isLow ? "نفذت الكمية" : isMedium ? "رصيد متوسط" : "رصيد جيد"}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })
              )}
            </div>
          </TabsContent>

          <TabsContent value="movements">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">الفواتير (آخر العمليات)</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>التاريخ</TableHead>
                      <TableHead>النوع</TableHead>
                      <TableHead className="text-left">عدد الأصناف</TableHead>
                      <TableHead className="text-left">إجمالي الكميات</TableHead>
                      <TableHead>ملاحظات</TableHead>
                      <TableHead className="text-left">إجراءات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoices.length === 0 ? (
                      <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">لا توجد فواتير</TableCell></TableRow>
                    ) : invoices.map((inv) => {
                      const totalQty = inv.movements.reduce((s, m) => s + Number(m.quantity), 0);
                      return (
                        <TableRow
                          key={inv.key}
                          className="cursor-pointer hover:bg-muted/60"
                          onClick={() => openInvoice(inv)}
                        >
                          <TableCell className="text-xs">{new Date(inv.at).toLocaleString("ar-EG")}</TableCell>
                          <TableCell>
                            <Badge variant={inv.kind === "supply" ? "default" : "secondary"}>
                              {inv.kind === "supply" ? "توريد" : "مرتجع"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-left font-semibold">{inv.movements.length}</TableCell>
                          <TableCell className="text-left">{totalQty.toLocaleString("ar-EG")}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{inv.notes || "—"}</TableCell>
                          <TableCell className="text-left" onClick={(e) => e.stopPropagation()}>
                            <div className="flex gap-1 justify-end">
                              <Button variant="ghost" size="icon" onClick={() => openInvoice(inv)} title="عرض الفاتورة">
                                <Eye className="w-4 h-4" />
                              </Button>
                              {canEditMovements && (
                                <Button variant="ghost" size="icon" onClick={() => openEditInvoice(inv)} title="تعديل الفاتورة">
                                  <Pencil className="w-4 h-4" />
                                </Button>
                              )}
                              {canEditMovements && (
                                <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDeleteInvoice(inv)} title="حذف الفاتورة">
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Shared dialog content rendered once based on state */}
      <Dialog open={!!openDialog} onOpenChange={(o) => { if (!o) { setOpenDialog(null); resetDialog(); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {openDialog === "supply" ? `توريد جديد إلى ${warehouseName}` : `تسجيل مرتجع من ${warehouseName}`}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
            <div className="space-y-2">
              {lines.map((line, idx) => {
                const chosenElsewhere = new Set(
                  lines.filter((_, i) => i !== idx).map((l) => l.name).filter(Boolean),
                );
                const selected = pickList.find((i) => i.name === line.name);
                const weight = selected ? isWeightUnit(selected.unit) : false;
                const inputQty = Number(line.qty) || 0;
                const realQty = weight ? inputQty * PACKAGE_KG : inputQty;
                const inputLabel = selected
                  ? (weight ? "الكمية (عبوة نص كيلو)" : `الكمية (${selected.unit || "قطعة"})`)
                  : "الكمية";
                return (
                  <div key={idx} className="flex items-start gap-2 p-2 rounded-md border bg-muted/30">
                    <div className="flex-1 space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">المنتج</label>
                      <ProductPicker
                        items={pickList}
                        value={line.name}
                        onChange={(v) => updateLine(idx, { name: v })}
                        disabledNames={chosenElsewhere}
                        emptyMessage={openDialog === "supply" ? "المخزن الرئيسي فارغ" : "لا توجد منتجات في هذا المخزن"}
                      />
                      {selected && (
                        <p className="text-[11px] text-muted-foreground">
                          المتاح: {Number(selected.stock).toLocaleString("ar-EG")} {selected.unit}
                          {weight ? ` • ${toPackages(Number(selected.stock)).toLocaleString("ar-EG")} عبوة (نص كيلو)` : ""}
                        </p>
                      )}
                    </div>
                    <div className="w-32 space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">{inputLabel}</label>
                      <Input
                        type="number"
                        min="0"
                        step={weight ? "1" : "0.01"}
                        value={line.qty}
                        onChange={(e) => updateLine(idx, { qty: e.target.value })}
                      />
                      {weight && inputQty > 0 && (
                        <p className="text-[11px] text-muted-foreground">= {realQty.toLocaleString("ar-EG")} كيلو</p>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="mt-5 text-destructive"
                      onClick={() => removeLine(idx)}
                      disabled={lines.length === 1}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                );
              })}
              <Button type="button" variant="outline" size="sm" onClick={addLine} className="gap-1">
                <Plus className="w-4 h-4" /> إضافة منتج
              </Button>
            </div>
            <div>
              <label className="text-sm font-medium">ملاحظات (اختياري)</label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ملاحظات..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpenDialog(null); resetDialog(); }}>إلغاء</Button>
            <Button onClick={submit} disabled={submitting}>
              {submitting && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
              تأكيد
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!editMov} onOpenChange={(o) => { if (!o) setEditMov(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تعديل كمية الحركة</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              المنتج: <span className="font-medium text-foreground">{editMov?.item_name}</span>
            </div>
            <div>
              <label className="text-sm font-medium">الكمية الجديدة</label>
              <Input type="number" min="0" step="0.01" value={editQty} onChange={(e) => setEditQty(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditMov(null)}>إلغاء</Button>
            <Button onClick={submitEdit} disabled={editBusy}>
              {editBusy && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!editItem} onOpenChange={(o) => { if (!o) setEditItem(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تعديل رصيد الصنف</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              المنتج: <span className="font-medium text-foreground">{editItem?.name}</span> — الرصيد الحالي: {editItem?.stock}
            </div>
            <div>
              <label className="text-sm font-medium">الرصيد الجديد</label>
              <Input type="number" min="0" step="0.01" value={editStock} onChange={(e) => setEditStock(e.target.value)} />
              <p className="text-xs text-muted-foreground mt-1">
                الفرق سيُخصم من المخزن الرئيسي أو يُضاف إليه تلقائيًا.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditItem(null)}>إلغاء</Button>
            <Button onClick={submitItemEdit} disabled={itemBusy}>
              {itemBusy && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* تعديل فاتورة كاملة */}
      <Dialog open={!!editInvoice} onOpenChange={(o) => { if (!o) setEditInvoice(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              تعديل {editInvoice?.kind === "supply" ? "فاتورة توريد" : "فاتورة مرتجع"} — {editInvoice ? new Date(editInvoice.at).toLocaleString("ar-EG") : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
            {editInvLines.length === 0 ? (
              <p className="text-sm text-muted-foreground">لا توجد أصناف</p>
            ) : editInvLines.map((l, idx) => {
              const selectedItem = l.isNew ? editInvoicePickList.find((i) => i.name === l.name) : null;
              const currentUnit = l.isNew ? (selectedItem?.unit || l.unit) : l.unit;
              const weight = isWeightUnit(currentUnit);
              const chosenElsewhere = new Set(
                editInvLines
                  .filter((_, i) => i !== idx)
                  .map((x) => x.name)
                  .filter(Boolean),
              );
              return (
                <div key={l.movId} className={`flex items-center gap-2 p-2 rounded border ${l.remove ? "opacity-50 line-through" : ""}`}>
                  <div className="flex-1">
                    {l.isNew ? (
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">المنتج الجديد</label>
                        <ProductPicker
                          items={editInvoicePickList}
                          value={l.name}
                          onChange={(v) => setEditInvLines((prev) => prev.map((x, i) => i === idx ? {
                            ...x,
                            name: v,
                            itemId: editInvoicePickList.find((it) => it.name === v)?.id || "",
                            unit: editInvoicePickList.find((it) => it.name === v)?.unit || "",
                          } : x))}
                          disabledNames={chosenElsewhere}
                          emptyMessage={editInvoice?.kind === "supply" ? "المخزن الرئيسي فارغ" : "لا توجد منتجات في هذا المخزن"}
                        />
                        {selectedItem && (
                          <div className="text-[11px] text-muted-foreground">
                            المتاح: {Number(selectedItem.stock).toLocaleString("ar-EG")} {selectedItem.unit}
                            {weight ? ` • ${toPackages(Number(selectedItem.stock)).toLocaleString("ar-EG")} عبوة` : ""}
                          </div>
                        )}
                      </div>
                    ) : (
                      <>
                        <div className="text-sm font-medium">{l.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {weight ? "عبوة (نص كيلو)" : (currentUnit || "قطعة")} — الكمية الأصلية: {weight ? l.originalQty / PACKAGE_KG : l.originalQty}
                        </div>
                      </>
                    )}
                  </div>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={l.qty}
                    disabled={l.remove}
                    onChange={(e) => setEditInvLines((prev) => prev.map((x, i) => i === idx ? { ...x, qty: e.target.value } : x))}
                    className="w-28"
                  />
                  <Button
                    variant={l.remove ? "outline" : "ghost"}
                    size="icon"
                    className={l.remove ? "" : "text-destructive"}
                    title={l.remove ? "تراجع" : "حذف هذا السطر"}
                    onClick={() => setEditInvLines((prev) => prev.map((x, i) => i === idx ? { ...x, remove: !x.remove } : x))}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              );
            })}
            <Button type="button" variant="outline" size="sm" onClick={addEditInvoiceLine} className="gap-1 w-fit">
              <Plus className="w-4 h-4" /> إضافة منتج جديد
            </Button>
            <p className="text-xs text-muted-foreground">
              عند الحفظ: يمكنك تعديل الكمية، حذف سطر، أو إضافة صنف جديد داخل نفس الفاتورة، وسيتم عكس الأرصدة تلقائياً بين المخزنين.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditInvoice(null)} disabled={editInvBusy}>إلغاء</Button>
            <Button onClick={submitInvoiceEdit} disabled={editInvBusy}>
              {editInvBusy && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
              حفظ التعديلات
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>




      {/* إيصال آخر عملية: طباعة + تصدير اكسيل */}
      <Dialog open={!!receipt} onOpenChange={(o) => { if (!o) setReceipt(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {receipt?.kind === "supply" ? "إيصال توريد" : "إيصال مرتجع"} — {warehouseName}
            </DialogTitle>
          </DialogHeader>
          {receipt && (
            <div id="receipt-print-area" className="space-y-3">
              <div className="text-sm text-muted-foreground flex flex-wrap gap-x-6 gap-y-1">
                <span>التاريخ: {new Date(receipt.at).toLocaleString("ar-EG")}</span>
                <span>عدد الأصناف: {receipt.lines.length}</span>
                {receipt.notes && <span>ملاحظات: {receipt.notes}</span>}
              </div>
              <div className="border rounded-md overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted">
                    <tr>
                      <th className="p-2 text-right">المنتج</th>
                      <th className="p-2 text-right">المُدخل</th>
                      <th className="p-2 text-right">الوحدة</th>
                      <th className="p-2 text-right">المخصوم من الرئيسي</th>
                    </tr>
                  </thead>
                  <tbody>
                    {receipt.lines.map((l, i) => (
                      <tr key={i} className="border-t">
                        <td className="p-2 font-medium">{l.name}</td>
                        <td className="p-2">{l.inputQty.toLocaleString("ar-EG")}</td>
                        <td className="p-2">{l.inputUnit}</td>
                        <td className="p-2">{l.deductedQty.toLocaleString("ar-EG")} {l.deductedUnit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReceipt(null)}>إغلاق</Button>
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => {
                if (!receipt) return;
                const rows = receipt.lines.map((l) => ({
                  "المنتج": l.name,
                  "الكمية المُدخلة": l.inputQty,
                  "وحدة الإدخال": l.inputUnit,
                  "المخصوم من المخزن الرئيسي": l.deductedQty,
                  "وحدة الخصم": l.deductedUnit,
                }));
                const ws = XLSX.utils.json_to_sheet(rows);
                const wb = XLSX.utils.book_new();
                const sheetName = receipt.kind === "supply" ? "توريد" : "مرتجع";
                XLSX.utils.book_append_sheet(wb, ws, sheetName);
                const ts = new Date(receipt.at).toISOString().replace(/[:.]/g, "-").slice(0, 19);
                XLSX.writeFile(wb, `${sheetName}_${warehouseName}_${ts}.xlsx`);
              }}
            >
              <FileSpreadsheet className="w-4 h-4" /> تصدير Excel
            </Button>
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => {
                if (!receipt) return;
                const w = window.open("", "_blank", "width=900,height=700");
                if (!w) return;
                const title = receipt.kind === "supply" ? "إيصال توريد" : "إيصال مرتجع";
                const rows = receipt.lines.map((l) => `
                  <tr>
                    <td>${l.name}</td>
                    <td>${l.inputQty.toLocaleString("ar-EG")}</td>
                    <td>${l.inputUnit}</td>
                    <td>${l.deductedQty.toLocaleString("ar-EG")} ${l.deductedUnit}</td>
                  </tr>`).join("");
                w.document.write(`
                  <html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${title}</title>
                  <style>
                    body{font-family:Tahoma,Arial,sans-serif;padding:20px;direction:rtl;}
                    h2{margin:0 0 6px;} .meta{color:#555;font-size:13px;margin-bottom:12px;}
                    table{width:100%;border-collapse:collapse;font-size:14px;}
                    th,td{border:1px solid #ccc;padding:6px 8px;text-align:right;}
                    th{background:#f1f1f1;}
                    @media print { .noprint{display:none;} }
                  </style></head><body>
                  <h2>${title} — ${warehouseName}</h2>
                  <div class="meta">
                    التاريخ: ${new Date(receipt.at).toLocaleString("ar-EG")}
                    &nbsp;•&nbsp; عدد الأصناف: ${receipt.lines.length}
                    ${receipt.notes ? `&nbsp;•&nbsp; ملاحظات: ${receipt.notes}` : ""}
                  </div>
                  <table>
                    <thead><tr>
                      <th>المنتج</th><th>المُدخل</th><th>الوحدة</th><th>المخصوم من الرئيسي</th>
                    </tr></thead>
                    <tbody>${rows}</tbody>
                  </table>
                  <script>window.onload=()=>{setTimeout(()=>window.print(),300);}</script>
                  </body></html>`);
                w.document.close();
              }}
            >
              <FileText className="w-4 h-4" /> حفظ PDF
            </Button>
            <Button
              className="gap-2"
              onClick={() => {
                if (!receipt) return;
                const w = window.open("", "_blank", "width=900,height=700");
                if (!w) return;
                const title = receipt.kind === "supply" ? "إيصال توريد" : "إيصال مرتجع";
                const rows = receipt.lines.map((l) => `
                  <tr>
                    <td>${l.name}</td>
                    <td>${l.inputQty.toLocaleString("ar-EG")}</td>
                    <td>${l.inputUnit}</td>
                    <td>${l.deductedQty.toLocaleString("ar-EG")} ${l.deductedUnit}</td>
                  </tr>`).join("");
                w.document.write(`
                  <html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${title}</title>
                  <style>
                    body{font-family:Tahoma,Arial,sans-serif;padding:20px;direction:rtl;}
                    h2{margin:0 0 6px;} .meta{color:#555;font-size:13px;margin-bottom:12px;}
                    table{width:100%;border-collapse:collapse;font-size:14px;}
                    th,td{border:1px solid #ccc;padding:6px 8px;text-align:right;}
                    th{background:#f1f1f1;}
                  </style></head><body>
                  <h2>${title} — ${warehouseName}</h2>
                  <div class="meta">
                    التاريخ: ${new Date(receipt.at).toLocaleString("ar-EG")}
                    &nbsp;•&nbsp; عدد الأصناف: ${receipt.lines.length}
                    ${receipt.notes ? `&nbsp;•&nbsp; ملاحظات: ${receipt.notes}` : ""}
                  </div>
                  <table>
                    <thead><tr>
                      <th>المنتج</th><th>المُدخل</th><th>الوحدة</th><th>المخصوم من الرئيسي</th>
                    </tr></thead>
                    <tbody>${rows}</tbody>
                  </table>
                  <script>window.onload=()=>{window.print();}</script>
                  </body></html>`);
                w.document.close();
              }}
            >
              <Printer className="w-4 h-4" /> طباعة
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}

interface ProductPickerProps {
  items: Array<{ id: string; name: string; unit: string; stock: number }>;
  value: string;
  onChange: (name: string) => void;
  disabledNames: Set<string>;
  emptyMessage: string;
}

function ProductPicker({ items, value, onChange, disabledNames, emptyMessage }: ProductPickerProps) {
  const [open, setOpen] = useState(false);
  const selected = items.find((i) => i.name === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span className="truncate text-right">
            {selected ? selected.name : "اختر منتجاً من المخزن الرئيسي"}
          </span>
          <ChevronsUpDown className="w-4 h-4 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(420px,90vw)] p-0" align="start">
        <Command
          filter={(val, search) => (val.includes(search.trim()) ? 1 : 0)}
        >
          <CommandInput placeholder="ابحث باسم المنتج..." />
          <CommandList className="max-h-[300px]">
            <CommandEmpty>{items.length === 0 ? emptyMessage : "لا يوجد منتج مطابق"}</CommandEmpty>
            <CommandGroup>
              {items.map((i) => {
                const w = isWeightUnit(i.unit);
                const kg = Number(i.stock) || 0;
                const isDisabled = disabledNames.has(i.name);
                return (
                  <CommandItem
                    key={i.id}
                    value={i.name}
                    disabled={isDisabled}
                    onSelect={(v) => {
                      onChange(v);
                      setOpen(false);
                    }}
                    className="flex items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Check className={`w-4 h-4 shrink-0 ${value === i.name ? "opacity-100" : "opacity-0"}`} />
                      <span className="truncate font-medium">{i.name}</span>
                    </div>
                    <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                      {kg.toLocaleString("ar-EG")} {i.unit}
                      {w ? ` • ${toPackages(kg).toLocaleString("ar-EG")} عبوة` : ""}
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
