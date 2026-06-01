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
import { Search, RefreshCw, ArrowUpRight, ArrowDownLeft, Loader2, Plus, Trash2, Pencil, Printer, FileSpreadsheet } from "lucide-react";
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
  performed_at: string;
  movement_type: string;
  quantity: number;
  notes: string | null;
  party: string | null;
  item_id: string;
  source_warehouse_id?: string | null;
  destination_warehouse_id?: string | null;
  reference_type?: string | null;
  item_name?: string;
}

const MAIN_WAREHOUSE_NAME_HINTS = ["الرئيسي", "المقر"];

export default function CustomerWarehouseView({ warehouseName, pageTitle, pageSubtitle }: Props) {
  const { user, isGeneralManager, isExecutiveManager, isWarehouseSupervisor } = useAuth();
  const canEditMovements = isGeneralManager || isExecutiveManager || isWarehouseSupervisor;
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [whId, setWhId] = useState<string | null>(null);
  const [mainWhId, setMainWhId] = useState<string | null>(null);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [mainItems, setMainItems] = useState<InventoryItem[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);

  // dialog state
  const [openDialog, setOpenDialog] = useState<null | "supply" | "return">(null);
  type Line = { name: string; qty: string };
  const [lines, setLines] = useState<Line[]>([{ name: "", qty: "" }]);
  const [notes, setNotes] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

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
      await supabase.from("inventory_items").update({ stock: 0, is_active: false }).eq("id", it.id);
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
            .select("id, performed_at, movement_type, quantity, notes, party, item_id, source_warehouse_id, destination_warehouse_id, reference_type")
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

  // For supply: pick from main items. For return: pick from this warehouse's items.
  const pickList = openDialog === "supply" ? mainItems : items;

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
    const { data } = await supabase
      .from("inventory_movements")
      .select("id, item_id, warehouse_id, movement_type, quantity")
      .eq("source_warehouse_id", m.source_warehouse_id)
      .eq("destination_warehouse_id", m.destination_warehouse_id)
      .eq("performed_at", m.performed_at)
      .eq("quantity", m.quantity);
    const rows = (data || []) as any[];
    return rows.find((r) => r.id !== m.id) || null;
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
        await supabase.from("inventory_items").update({ stock: Number(thisItem.stock) + delta }).eq("id", m.item_id);
      }
      if (pair) {
        const pItem = (await supabase.from("inventory_items").select("id, stock").eq("id", pair.item_id).single()).data as any;
        if (pItem) {
          const delta = pair.movement_type === "in" ? -Number(pair.quantity) : Number(pair.quantity);
          await supabase.from("inventory_items").update({ stock: Number(pItem.stock) + delta }).eq("id", pair.item_id);
        }
        await supabase.from("inventory_movements").delete().eq("id", pair.id);
      }
      await supabase.from("inventory_movements").delete().eq("id", m.id);
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

          <TabsContent value="stock">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">المنتجات في {warehouseName}</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>المنتج</TableHead>
                      <TableHead>الوحدة</TableHead>
                      <TableHead className="text-left">الرصيد</TableHead>
                      {canEditMovements && <TableHead className="text-left">إجراءات</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredItems.length === 0 ? (
                      <TableRow><TableCell colSpan={canEditMovements ? 4 : 3} className="text-center text-muted-foreground">
                        {loading ? "جاري التحميل..." : "لا توجد منتجات بعد. ابدأ بتسجيل أول توريد."}
                      </TableCell></TableRow>
                    ) : filteredItems.map((it) => (
                      <TableRow key={it.id}>
                        <TableCell>{it.name}</TableCell>
                        <TableCell>{it.unit}</TableCell>
                        <TableCell className="text-left font-semibold">{Number(it.stock).toLocaleString("ar-EG")}</TableCell>
                        {canEditMovements && (
                          <TableCell className="text-left">
                            <div className="flex gap-1 justify-end">
                              <Button variant="ghost" size="icon" onClick={() => openItemEdit(it)} title="تعديل الرصيد">
                                <Pencil className="w-4 h-4" />
                              </Button>
                              <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDeleteItem(it)} title="حذف وإرجاع للرئيسي">
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="movements">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">آخر 200 حركة</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>التاريخ</TableHead>
                      <TableHead>النوع</TableHead>
                      <TableHead>المنتج</TableHead>
                      <TableHead className="text-left">الكمية</TableHead>
                      <TableHead>ملاحظات</TableHead>
                      {canEditMovements && <TableHead className="text-left">إجراءات</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {movements.length === 0 ? (
                      <TableRow><TableCell colSpan={canEditMovements ? 6 : 5} className="text-center text-muted-foreground">لا توجد حركات</TableCell></TableRow>
                    ) : movements.map((m) => {
                      const isIn = m.movement_type === "in" || m.movement_type === "transfer_in";
                      return (
                        <TableRow key={m.id}>
                          <TableCell className="text-xs">{new Date(m.performed_at).toLocaleString("ar-EG")}</TableCell>
                          <TableCell>
                            <Badge variant={isIn ? "default" : "secondary"}>
                              {isIn ? "توريد (دخول)" : "مرتجع (خروج)"}
                            </Badge>
                          </TableCell>
                          <TableCell>{m.item_name}</TableCell>
                          <TableCell className="text-left font-semibold">{Number(m.quantity).toLocaleString("ar-EG")}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{m.notes || "—"}</TableCell>
                          {canEditMovements && (
                            <TableCell className="text-left">
                              <div className="flex gap-1 justify-end">
                                <Button variant="ghost" size="icon" onClick={() => openEdit(m)} title="تعديل">
                                  <Pencil className="w-4 h-4" />
                                </Button>
                                <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDeleteMovement(m)} title="حذف">
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                            </TableCell>
                          )}
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
                return (
                  <div key={idx} className="flex items-start gap-2 p-2 rounded-md border bg-muted/30">
                    <div className="flex-1 space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">المنتج</label>
                      <Select value={line.name} onValueChange={(v) => updateLine(idx, { name: v })}>
                        <SelectTrigger><SelectValue placeholder="اختر منتجاً" /></SelectTrigger>
                        <SelectContent>
                          {pickList.length === 0 ? (
                            <div className="p-3 text-sm text-muted-foreground">
                              {openDialog === "supply" ? "المخزن الرئيسي فارغ" : "لا توجد منتجات في هذا المخزن"}
                            </div>
                          ) : pickList.map((i) => (
                            <SelectItem key={i.id} value={i.name} disabled={chosenElsewhere.has(i.name)}>
                              {i.name} — متاح: {Number(i.stock).toLocaleString("ar-EG")} {i.unit}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="w-28 space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">الكمية</label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.qty}
                        onChange={(e) => updateLine(idx, { qty: e.target.value })}
                      />
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
    </DashboardLayout>
  );
}
