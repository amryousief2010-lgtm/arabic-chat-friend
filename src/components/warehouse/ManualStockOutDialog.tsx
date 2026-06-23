import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, Info, Loader2, Lock, PackageMinus, Plus, Printer, ShieldAlert, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import AddManualPartyDialog from "@/components/warehouse/AddManualPartyDialog";
import { printWarehouseSlip, SlipItemRow } from "@/lib/printWarehouseSlip";
import { STOCK_ADJUSTMENT_REASONS, isValidAdjustmentReason } from "@/lib/warehouseAdjustmentReasons";
import { useStocktakingLock } from "@/hooks/useStocktakingLock";
import { useReservedQuantities } from "@/hooks/useReservedQuantities";

interface InventoryItem {
  id: string;
  name: string;
  unit?: string | null;
  stock?: number | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  warehouseId: string;
  warehouseName?: string;
  items: InventoryItem[];
  onSaved?: () => void;
}

interface Row {
  uid: string;
  itemId: string;
  manualKgMode: boolean;
  packageCount: string;
  packageWeightKg: string;
  manualKg: string;
}

const DESTINATIONS: { value: string; label: string }[] = [
  { value: "agouza_branch", label: "فرع العجوزة" },
  { value: "private_courier", label: "مندوب خاص" },
  { value: "healthy_test", label: "هيلثي تيست" },
  { value: "carrefour", label: "كارفور" },
  { value: "customer", label: "عميل" },
  { value: "damaged", label: "تالف / هالك" },
  { value: "internal_use", label: "استخدام داخلي" },
  { value: "other", label: "أخرى" },
];

const newRow = (): Row => ({
  uid: Math.random().toString(36).slice(2),
  itemId: "",
  manualKgMode: false,
  packageCount: "",
  packageWeightKg: "0.5",
  manualKg: "",
});

const rowQty = (r: Row): number => {
  if (r.manualKgMode) {
    const v = Number(r.manualKg);
    return Number.isFinite(v) && v > 0 ? v : 0;
  }
  const c = Number(r.packageCount);
  const w = Number(r.packageWeightKg);
  return Number.isFinite(c) && c > 0 && Number.isFinite(w) && w > 0 ? c * w : 0;
};

const todayStamp = () => {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
};

const generateOpNo = async () => {
  const stamp = todayStamp();
  const like = `MAN-OUT-${stamp}-%`;
  const { data } = await supabase
    .from("inventory_movements")
    .select("reference")
    .like("reference", like);
  const max = (data || []).reduce((acc: number, r: any) => {
    const m = String(r.reference || "").match(/-(\d{4})$/);
    const n = m ? parseInt(m[1], 10) : 0;
    return n > acc ? n : acc;
  }, 0);
  return `MAN-OUT-${stamp}-${String(max + 1).padStart(4, "0")}`;
};

const ManualStockOutDialog = ({
  open,
  onOpenChange,
  warehouseId,
  warehouseName,
  items,
  onSaved,
}: Props) => {
  const { user, profile, isGeneralManager, isExecutiveManager, isWarehouseSupervisor } = useAuth() as any;
  const canAddParty = isGeneralManager || isExecutiveManager || isWarehouseSupervisor;
  const canManualKg = isGeneralManager || isExecutiveManager;
  const isManager = isGeneralManager || isExecutiveManager;
  const [destKey, setDestKey] = useState("");
  const [destOther, setDestOther] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
  const [reason, setReason] = useState(""); // stores القائم بالتوريد (supplier)
  const [category, setCategory] = useState<string>(""); // سبب الصرف الإجباري (الفئة)
  const [overrideNegative, setOverrideNegative] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [deliveryDate, setDeliveryDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<Row[]>([newRow()]);
  const [saving, setSaving] = useState(false);
  const [customParties, setCustomParties] = useState<{ id: string; name: string }[]>([]);
  const [addPartyOpen, setAddPartyOpen] = useState(false);
  const [lastSaved, setLastSaved] = useState<{
    opNo: string;
    partyLabel: string;
    supplier: string;
    deliveryDate: string;
    performedByName: string;
    performedAt: string;
    notes: string;
    rows: SlipItemRow[];
  } | null>(null);

  const loadCustom = async () => {
    const { data } = await supabase
      .from("warehouse_manual_parties" as any)
      .select("id,name")
      .in("kind", ["dispatch", "both"])
      .eq("is_active", true)
      .order("name");
    setCustomParties((data as any) || []);
  };

  useEffect(() => {
    if (!open) {
      setDestKey(""); setDestOther(""); setCustomerName("");
      setReason(""); setNotes(""); setCategory("");
      setOverrideNegative(false); setOverrideReason("");
      setDeliveryDate(new Date().toISOString().slice(0, 10));
      setRows([newRow()]);
      setLastSaved(null);
    } else {
      void loadCustom();
    }
  }, [open]);

  const { lock } = useStocktakingLock(open ? warehouseId : null);
  const selectedItemIds = useMemo(
    () => Array.from(new Set(rows.map((r) => r.itemId).filter(Boolean))),
    [rows]
  );
  const { reservedByItem } = useReservedQuantities(open ? warehouseId : null, selectedItemIds);

  useEffect(() => {
    if (destKey === "customer" && customers.length === 0) {
      supabase.from("customers").select("id, name").order("name").limit(500)
        .then(({ data }) => setCustomers(data || []));
    }
  }, [destKey, customers.length]);

  const itemsById = useMemo(() => {
    const m = new Map<string, InventoryItem>();
    items.forEach(i => m.set(i.id, i));
    return m;
  }, [items]);

  const customMatch = customParties.find((p) => `custom:${p.id}` === destKey);
  const destBaseLabel = destKey === "other"
    ? destOther.trim()
    : customMatch
      ? customMatch.name
      : (DESTINATIONS.find(d => d.value === destKey)?.label || "");
  const destLabel = destKey === "customer" && customerName.trim()
    ? `عميل / ${customerName.trim()}`
    : destBaseLabel;

  const validDest = !!destKey
    && (destKey !== "other" || destOther.trim().length > 0)
    && (destKey !== "customer" || customerName.trim().length > 0);

  // merge duplicate items
  const mergedRows = useMemo(() => {
    const acc = new Map<string, number>();
    rows.forEach(r => {
      if (!r.itemId) return;
      const q = rowQty(r);
      if (q <= 0) return;
      acc.set(r.itemId, (acc.get(r.itemId) || 0) + q);
    });
    return acc;
  }, [rows]);

  // Reservation analysis per merged row
  const reservationAnalysis = useMemo(() => {
    const out: Array<{
      itemId: string; name: string; unit: string;
      stock: number; reserved: number; available: number;
      requested: number; availableAfter: number; reservedFlag: boolean; negative: boolean;
    }> = [];
    for (const [id, q] of mergedRows.entries()) {
      const it = itemsById.get(id);
      if (!it) continue;
      const stock = Number(it.stock || 0);
      const reserved = Number(reservedByItem[id] || 0);
      const available = stock - reserved;
      const availableAfter = available - q;
      out.push({
        itemId: id,
        name: it.name,
        unit: it.unit || "كجم",
        stock, reserved, available,
        requested: q,
        availableAfter,
        reservedFlag: reserved > 0,
        negative: availableAfter < 0,
      });
    }
    return out;
  }, [mergedRows, itemsById, reservedByItem]);

  const hasReservedConflict = reservationAnalysis.some((r) => r.reservedFlag);
  const hasNegativeAfter = reservationAnalysis.some((r) => r.negative);
  const exceedRows = reservationAnalysis.filter((r) => r.requested > r.stock).map((r) => r.itemId);
  const negativeBlocked = hasNegativeAfter && (!isManager || !overrideNegative || overrideReason.trim().length < 3);

  const validRows = rows.length > 0 && rows.every(r => r.itemId && rowQty(r) > 0);
  const canSave = validDest
    && reason.trim().length > 0
    && isValidAdjustmentReason(category)
    && deliveryDate.length > 0
    && validRows
    && mergedRows.size > 0
    && exceedRows.length === 0
    && !negativeBlocked
    && !saving;

  const updateRow = (uid: string, patch: Partial<Row>) =>
    setRows(rs => rs.map(r => r.uid === uid ? { ...r, ...patch } : r));
  const removeRow = (uid: string) =>
    setRows(rs => rs.length <= 1 ? rs : rs.filter(r => r.uid !== uid));
  const addRow = () => setRows(rs => [...rs, newRow()]);

  const handleSave = async () => {
    if (!validDest) { toast({ title: "اختر جهة الصرف", variant: "destructive" }); return; }
    if (!reason.trim()) { toast({ title: "أدخل اسم القائم بالتوريد", variant: "destructive" }); return; }
    if (!isValidAdjustmentReason(category)) { toast({ title: "اختر سبب الصرف من القائمة (إجباري)", variant: "destructive" }); return; }
    if (!deliveryDate) { toast({ title: "اختر تاريخ التوريد", variant: "destructive" }); return; }
    if (mergedRows.size === 0) { toast({ title: "أضف صنف واحد على الأقل", variant: "destructive" }); return; }
    for (const r of rows) {
      if (!r.itemId) { toast({ title: "اختر الصنف في كل صف", variant: "destructive" }); return; }
      if (rowQty(r) <= 0) { toast({ title: "أدخل كمية صحيحة لكل صنف", variant: "destructive" }); return; }
    }
    if (exceedRows.length > 0) {
      toast({ title: "الكمية أكبر من الرصيد الفعلي في بعض الأصناف", variant: "destructive" });
      return;
    }
    if (hasNegativeAfter) {
      if (!isManager) {
        toast({
          title: "صرف يجعل المتاح بالسالب — يتطلب صلاحية المدير العام أو التنفيذي",
          variant: "destructive",
        });
        return;
      }
      if (!overrideNegative || overrideReason.trim().length < 3) {
        toast({
          title: "فعّل تأكيد المدير وسجّل سببًا واضحًا (≥ ٣ حروف) للصرف بالسالب",
          variant: "destructive",
        });
        return;
      }
    }

    setSaving(true);
    try {
      const opNo = await generateOpNo();
      const performedAt = new Date().toISOString();
      const partyLabel = `صرف مباشر مؤقت إلى: ${destLabel}`;

      const byItem = new Map<string, { qty: number; pkgCount: number | null; pkgWeight: number | null; manual: boolean }>();
      rows.forEach(r => {
        const q = rowQty(r);
        if (!r.itemId || q <= 0) return;
        const cur = byItem.get(r.itemId);
        if (cur) {
          cur.qty += q;
          cur.manual = cur.manual || r.manualKgMode;
          if (r.manualKgMode) { cur.pkgCount = null; cur.pkgWeight = null; }
        } else {
          byItem.set(r.itemId, {
            qty: q,
            pkgCount: r.manualKgMode ? null : Number(r.packageCount),
            pkgWeight: r.manualKgMode ? null : Number(r.packageWeightKg),
            manual: r.manualKgMode,
          });
        }
      });

      const inserts: any[] = [];
      const stockUpdates: { id: string; newStock: number }[] = [];
      const slipRows: SlipItemRow[] = [];

      for (const [itemId, info] of byItem.entries()) {
        const it = itemsById.get(itemId);
        if (!it) continue;
        const unit = it.unit || "كجم";
        const stockBefore = Number(it.stock || 0);
        const stockAfter = stockBefore - info.qty;
        const pkgLine = info.manual
          ? `إدخال يدوي بالكيلو: ${info.qty} كجم`
          : `${info.pkgCount} عبوة × ${info.pkgWeight} كجم = ${info.qty} كجم`;
        const combinedNotes = [
          `صرف مباشر مؤقت`,
          `رقم العملية: ${opNo}`,
          `جهة الصرف: ${destLabel}`,
          pkgLine,
          `القائم بالتوريد: ${reason.trim()}`,
          `تاريخ التوريد: ${deliveryDate}`,
          notes.trim() ? `ملاحظات: ${notes.trim()}` : null,
          `قبل: ${stockBefore} ${unit}`,
          `بعد: ${stockAfter} ${unit}`,
        ].filter(Boolean).join(" • ");
        const partyWithPkg = info.manual
          ? partyLabel
          : `${partyLabel} — ${info.pkgCount} عبوة × ${info.pkgWeight} كجم = ${info.qty} كجم`;

        inserts.push({
          warehouse_id: warehouseId,
          item_id: itemId,
          movement_type: "out",
          quantity: info.qty,
          package_count: info.pkgCount,
          package_weight_kg: info.pkgWeight,
          quantity_kg: info.qty,
          reference: opNo,
          reference_type: "manual_out",
          party: partyWithPkg,
          reason: reason.trim(),
          notes: combinedNotes,
          module: "warehouse_manual",
          performed_by: user?.id ?? null,
          performed_at: performedAt,
        });
        stockUpdates.push({ id: itemId, newStock: stockAfter });
        slipRows.push({
          name: it.name,
          unit,
          packageCount: info.pkgCount,
          packageWeightKg: info.pkgWeight,
          quantity: info.qty,
          stockBefore,
          stockAfter,
        });
      }

      const { error: mErr } = await supabase.from("inventory_movements").insert(inserts as any);
      if (mErr) throw mErr;

      for (const u of stockUpdates) {
        const { error } = await supabase.from("inventory_items").update({ stock: u.newStock }).eq("id", u.id);
        if (error) throw error;
      }

      setLastSaved({
        opNo,
        partyLabel: destLabel,
        supplier: reason.trim(),
        deliveryDate,
        performedByName: profile?.full_name || "",
        performedAt,
        notes: notes.trim(),
        rows: slipRows,
      });

      toast({
        title: "تم حفظ الصرف",
        description: `${opNo} — ${stockUpdates.length} صنف (${destLabel})`,
      });
      onSaved?.();
    } catch (e: any) {
      toast({
        title: "تعذر حفظ الصرف",
        description: e?.message || "خطأ غير معروف",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handlePrint = () => {
    if (!lastSaved) return;
    printWarehouseSlip({
      kind: "out",
      opNo: lastSaved.opNo,
      warehouseName: warehouseName || "المخزن الرئيسي",
      partyLabel: lastSaved.partyLabel,
      supplier: lastSaved.supplier,
      deliveryDate: lastSaved.deliveryDate,
      performedByName: lastSaved.performedByName,
      performedAt: lastSaved.performedAt,
      notes: lastSaved.notes,
      rows: lastSaved.rows,
    });
  };

  const totalQty = Array.from(mergedRows.values()).reduce((a, b) => a + b, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <PackageMinus className="w-5 h-5 text-rose-600" />
            صرف منتجات / توريد للجهات — {warehouseName || "المخزن الرئيسي"}
            <Badge variant="secondary" className="bg-amber-100 text-amber-800 border border-amber-300">
              صرف مباشر مؤقت
            </Badge>
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            أضف أكثر من صنف داخل نفس العملية. عند الحفظ يتم إنشاء رقم عملية واحد مشترك لكل الأصناف.
          </DialogDescription>
        </DialogHeader>

        <Alert className="border-amber-300 bg-amber-50 dark:bg-amber-950/30">
          <Info className="h-4 w-4 text-amber-700" />
          <AlertDescription className="text-xs text-amber-900 dark:text-amber-200">
            هذه العملية تخصم من المخزن الرئيسي فقط، ولا تنشئ تحويل داخلي أو فاتورة أو خزنة.
          </AlertDescription>
        </Alert>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">جهة الصرف *</Label>
            <div className="flex gap-2">
              <Select value={destKey} onValueChange={(v) => { setDestKey(v); setCustomerName(""); setDestOther(""); }}>
                <SelectTrigger className="flex-1"><SelectValue placeholder="اختر جهة الصرف" /></SelectTrigger>
                <SelectContent>
                  {DESTINATIONS.map(d => (
                    <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                  ))}
                  {customParties.length > 0 && (
                    <div className="px-2 pt-2 pb-1 text-[10px] text-muted-foreground">جهات مضافة</div>
                  )}
                  {customParties.map((p) => (
                    <SelectItem key={p.id} value={`custom:${p.id}`}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {canAddParty && (
                <Button type="button" variant="outline" size="icon" onClick={() => setAddPartyOpen(true)} title="إضافة جهة">
                  <Plus className="w-4 h-4" />
                </Button>
              )}
            </div>
            {destKey === "other" && (
              <Input
                className="mt-2"
                value={destOther}
                onChange={(e) => setDestOther(e.target.value)}
                placeholder="اكتب جهة الصرف"
                maxLength={120}
              />
            )}
            {destKey === "customer" && (
              <div className="mt-2 space-y-2">
                <Input
                  list="manual-out-customers"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="اختر عميل أو اكتب اسم العميل"
                  maxLength={120}
                />
                <datalist id="manual-out-customers">
                  {customers.map((c) => <option key={c.id} value={c.name} />)}
                </datalist>
              </div>
            )}
          </div>

          <AddManualPartyDialog
            open={addPartyOpen}
            onOpenChange={setAddPartyOpen}
            kind="dispatch"
            onCreated={async (p) => { await loadCustom(); setDestKey(`custom:${p.id}`); }}
          />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">القائم بالتوريد *</Label>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="اسم من قام بالتسليم (مثال: عبدالمنعم عثمان، محمد شعلة، مندوب التوريد)"
                maxLength={200}
              />
            </div>
            <div>
              <Label className="text-xs">تاريخ التوريد *</Label>
              <Input
                type="date"
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">ملاحظات (اختياري)</Label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={500}
              />
            </div>
          </div>

          <div className="rounded border">
            <div className="flex items-center justify-between p-2 bg-muted/40">
              <div className="font-semibold text-sm">أصناف الصرف</div>
              <Button type="button" size="sm" variant="outline" onClick={addRow}>
                <Plus className="w-4 h-4 ml-1" /> إضافة صنف
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/30">
                  <tr>
                    <th className="p-2 text-right">الصنف *</th>
                    <th className="p-2 text-right">الوحدة</th>
                    <th className="p-2 text-right">عدد العبوات</th>
                    <th className="p-2 text-right">وزن العبوة</th>
                    <th className="p-2 text-right">الكمية (كجم)</th>
                    {canManualKg && <th className="p-2 text-right">يدوي</th>}
                    <th className="p-2 text-right">الرصيد</th>
                    <th className="p-2 text-right">بعد</th>
                    <th className="p-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const it = itemsById.get(r.itemId);
                    const unit = it?.unit || "كجم";
                    const before = Number(it?.stock || 0);
                    const q = rowQty(r);
                    const after = before - q;
                    const exceeds = it && q > before;
                    return (
                      <tr key={r.uid} className="border-t align-top">
                        <td className="p-1 min-w-[180px]">
                          <Select value={r.itemId} onValueChange={(v) => updateRow(r.uid, { itemId: v })}>
                            <SelectTrigger className="h-8"><SelectValue placeholder="اختر الصنف" /></SelectTrigger>
                            <SelectContent className="max-h-72">
                              {items.length === 0 ? (
                                <div className="px-3 py-2 text-xs text-muted-foreground">لا توجد أصناف</div>
                              ) : items.map((i) => (
                                <SelectItem key={i.id} value={i.id} disabled={Number(i.stock || 0) <= 0}>
                                  {i.name} {i.unit ? `(${i.unit})` : ""} — {Number(i.stock || 0)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="p-1">{unit}</td>
                        <td className="p-1">
                          <Input
                            type="number" min="1" step="1"
                            className="h-8 w-20"
                            disabled={r.manualKgMode}
                            value={r.packageCount}
                            onChange={(e) => updateRow(r.uid, { packageCount: e.target.value })}
                            placeholder="50"
                          />
                        </td>
                        <td className="p-1">
                          <Input
                            type="number" min="0.001" step="any"
                            className="h-8 w-20"
                            disabled={r.manualKgMode}
                            value={r.packageWeightKg}
                            onChange={(e) => updateRow(r.uid, { packageWeightKg: e.target.value })}
                          />
                        </td>
                        <td className="p-1">
                          {r.manualKgMode ? (
                            <Input
                              type="number" min="0" step="any"
                              className="h-8 w-24"
                              value={r.manualKg}
                              onChange={(e) => updateRow(r.uid, { manualKg: e.target.value })}
                              placeholder="كجم"
                            />
                          ) : (
                            <span className={`font-bold ${exceeds ? "text-destructive" : ""}`}>
                              {q > 0 ? `${q} كجم` : "—"}
                            </span>
                          )}
                        </td>
                        {canManualKg && (
                          <td className="p-1 text-center">
                            <input
                              type="checkbox"
                              checked={r.manualKgMode}
                              onChange={(e) => updateRow(r.uid, { manualKgMode: e.target.checked })}
                            />
                          </td>
                        )}
                        <td className="p-1">{it ? before : "—"}</td>
                        <td className={`p-1 font-semibold ${exceeds ? "text-destructive" : "text-rose-700"}`}>
                          {it && q > 0 ? after : "—"}
                        </td>
                        <td className="p-1">
                          <Button
                            type="button" size="icon" variant="ghost"
                            disabled={rows.length <= 1}
                            onClick={() => removeRow(r.uid)}
                          >
                            <Trash2 className="w-4 h-4 text-rose-600" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {totalQty > 0 && (
              <div className="p-2 text-xs bg-rose-50 dark:bg-rose-950/30 border-t flex justify-between">
                <span>إجمالي عدد الأصناف: <b>{mergedRows.size}</b></span>
                <span>إجمالي الكمية: <b className="text-rose-700">−{totalQty}</b> كجم</span>
              </div>
            )}
            {exceedRows.length > 0 && (
              <div className="p-2 text-xs bg-destructive/10 text-destructive border-t">
                بعض الأصناف الكمية أكبر من الرصيد المتاح — راجع الجدول.
              </div>
            )}
          </div>
        </div>

        {lastSaved && (
          <Alert className="border-rose-300 bg-rose-50 dark:bg-rose-950/30">
            <Info className="h-4 w-4 text-rose-700" />
            <AlertDescription className="text-xs text-rose-900 dark:text-rose-200 flex items-center justify-between gap-2 flex-wrap">
              <span>تم حفظ الصرف برقم <b>{lastSaved.opNo}</b> — يمكنك طباعة محضر الصرف الآن.</span>
              <Button size="sm" variant="outline" onClick={handlePrint} className="border-rose-400">
                <Printer className="w-4 h-4 ml-1" /> طباعة محضر الصرف
              </Button>
            </AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {lastSaved ? "إغلاق" : "إلغاء"}
          </Button>
          {!lastSaved && (
            <Button onClick={handleSave} disabled={!canSave} className="bg-rose-600 hover:bg-rose-700">
              {saving ? <Loader2 className="w-4 h-4 ml-1 animate-spin" /> : <PackageMinus className="w-4 h-4 ml-1" />}
              حفظ الصرف
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ManualStockOutDialog;
