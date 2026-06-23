import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Info, Loader2, PackagePlus, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import AddManualPartyDialog from "@/components/warehouse/AddManualPartyDialog";

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

const SUPPLY_SOURCES: { value: string; label: string }[] = [
  { value: "slaughterhouse", label: "المجزر" },
  { value: "meat_factory", label: "مصنع اللحوم" },
  { value: "return_agouza", label: "مرتجع من العجوزة" },
  { value: "return_private_courier", label: "مرتجع مندوب خاص" },
  { value: "return_healthy_test", label: "مرتجع هيلثي تيست" },
  { value: "return_carrefour", label: "مرتجع كارفور" },
  { value: "return_customer", label: "مرتجع عميل" },
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

const generateOpNo = async (prefix: "MAN-IN" | "MAN-OUT") => {
  const stamp = todayStamp();
  const like = `${prefix}-${stamp}-%`;
  const { data } = await supabase
    .from("inventory_movements")
    .select("reference")
    .like("reference", like);
  const max = (data || []).reduce((acc: number, r: any) => {
    const m = String(r.reference || "").match(/-(\d{4})$/);
    const n = m ? parseInt(m[1], 10) : 0;
    return n > acc ? n : acc;
  }, 0);
  return `${prefix}-${stamp}-${String(max + 1).padStart(4, "0")}`;
};

const ManualStockAdditionDialog = ({
  open,
  onOpenChange,
  warehouseId,
  warehouseName,
  items,
  onSaved,
}: Props) => {
  const { user, isGeneralManager, isExecutiveManager, isWarehouseSupervisor } = useAuth() as any;
  const canAddParty = isGeneralManager || isExecutiveManager || isWarehouseSupervisor;
  const canManualKg = isGeneralManager || isExecutiveManager;
  const [sourceKey, setSourceKey] = useState("");
  const [sourceOther, setSourceOther] = useState("");
  const [reason, setReason] = useState("");
  const [supplier, setSupplier] = useState("");
  const [deliveryDate, setDeliveryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<Row[]>([newRow()]);
  const [saving, setSaving] = useState(false);
  const [customParties, setCustomParties] = useState<{ id: string; name: string }[]>([]);
  const [addPartyOpen, setAddPartyOpen] = useState(false);

  const loadCustom = async () => {
    const { data } = await supabase
      .from("warehouse_manual_parties" as any)
      .select("id,name")
      .in("kind", ["supply", "both"])
      .eq("is_active", true)
      .order("name");
    setCustomParties((data as any) || []);
  };

  useEffect(() => { if (open) void loadCustom(); }, [open]);

  useEffect(() => {
    if (!open) {
      setSourceKey(""); setSourceOther("");
      setReason(""); setSupplier("");
      setDeliveryDate(new Date().toISOString().slice(0, 10));
      setNotes("");
      setRows([newRow()]);
    }
  }, [open]);

  const itemsById = useMemo(() => {
    const m = new Map<string, InventoryItem>();
    items.forEach(i => m.set(i.id, i));
    return m;
  }, [items]);

  const customMatch = customParties.find((p) => `custom:${p.id}` === sourceKey);
  const sourceLabel = sourceKey === "other"
    ? sourceOther.trim()
    : customMatch
      ? customMatch.name
      : (SUPPLY_SOURCES.find(s => s.value === sourceKey)?.label || "");
  const validSource = !!sourceKey && (sourceKey !== "other" || sourceOther.trim().length > 0);

  // merge duplicate items by aggregating kg
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

  const validRows = rows.length > 0 && rows.every(r => r.itemId && rowQty(r) > 0);
  const canSave = validSource && reason.trim().length > 0 && supplier.trim().length > 0 && !!deliveryDate && validRows && mergedRows.size > 0 && !saving;

  const updateRow = (uid: string, patch: Partial<Row>) =>
    setRows(rs => rs.map(r => r.uid === uid ? { ...r, ...patch } : r));
  const removeRow = (uid: string) =>
    setRows(rs => rs.length <= 1 ? rs : rs.filter(r => r.uid !== uid));
  const addRow = () => setRows(rs => [...rs, newRow()]);

  const handleSave = async () => {
    if (!validSource) { toast({ title: "اختر جهة التوريد", variant: "destructive" }); return; }
    if (!supplier.trim()) { toast({ title: "أدخل القائم بالتوريد", variant: "destructive" }); return; }
    if (!deliveryDate) { toast({ title: "اختر تاريخ التوريد", variant: "destructive" }); return; }
    if (!reason.trim()) { toast({ title: "أدخل سبب الإضافة / التوريد", variant: "destructive" }); return; }
    if (mergedRows.size === 0) { toast({ title: "أضف صنف واحد على الأقل", variant: "destructive" }); return; }
    for (const r of rows) {
      if (!r.itemId) { toast({ title: "اختر الصنف في كل صف", variant: "destructive" }); return; }
      if (rowQty(r) <= 0) { toast({ title: "أدخل كمية صحيحة لكل صنف", variant: "destructive" }); return; }
    }

    setSaving(true);
    try {
      const opNo = await generateOpNo("MAN-IN");
      const performedAt = new Date().toISOString();
      const partyLabel = `توريد مباشر مؤقت من: ${sourceLabel}`;

      // Aggregate by item (in case duplicates), but keep package info from first occurrence
      const byItem = new Map<string, { qty: number; pkgCount: number | null; pkgWeight: number | null; manual: boolean }>();
      rows.forEach(r => {
        const q = rowQty(r);
        if (!r.itemId || q <= 0) return;
        const cur = byItem.get(r.itemId);
        if (cur) {
          cur.qty += q;
          cur.manual = cur.manual || r.manualKgMode;
          // null out package info if mixed modes
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

      for (const [itemId, info] of byItem.entries()) {
        const it = itemsById.get(itemId);
        if (!it) continue;
        const unit = it.unit || "كجم";
        const stockBefore = Number(it.stock || 0);
        const stockAfter = stockBefore + info.qty;
        const pkgLine = info.manual
          ? `إدخال يدوي بالكيلو: ${info.qty} كجم`
          : `${info.pkgCount} عبوة × ${info.pkgWeight} كجم = ${info.qty} كجم`;
        const combinedNotes = [
          `توريد مباشر مؤقت`,
          `رقم العملية: ${opNo}`,
          `جهة التوريد: ${sourceLabel}`,
          `القائم بالتوريد: ${supplier.trim()}`,
          `تاريخ التوريد: ${deliveryDate}`,
          pkgLine,
          `السبب: ${reason.trim()}`,
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
          movement_type: "in",
          quantity: info.qty,
          package_count: info.pkgCount,
          package_weight_kg: info.pkgWeight,
          quantity_kg: info.qty,
          reference: opNo,
          reference_type: "manual_addition",
          party: partyWithPkg,
          reason: reason.trim(),
          notes: combinedNotes,
          module: "warehouse_manual",
          performed_by: user?.id ?? null,
          performed_at: performedAt,
        });
        stockUpdates.push({ id: itemId, newStock: stockAfter });
      }

      const { error: mErr } = await supabase.from("inventory_movements").insert(inserts as any);
      if (mErr) throw mErr;

      for (const u of stockUpdates) {
        const { error } = await supabase.from("inventory_items").update({ stock: u.newStock }).eq("id", u.id);
        if (error) throw error;
      }

      toast({
        title: "تم حفظ التوريد",
        description: `${opNo} — ${stockUpdates.length} صنف (${sourceLabel})`,
      });
      onOpenChange(false);
      onSaved?.();
    } catch (e: any) {
      toast({
        title: "تعذر حفظ التوريد",
        description: e?.message || "خطأ غير معروف",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const totalQty = Array.from(mergedRows.values()).reduce((a, b) => a + b, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <PackagePlus className="w-5 h-5 text-emerald-600" />
            إضافة رصيد / توريد مباشر — {warehouseName || "المخزن الرئيسي"}
            <Badge variant="secondary" className="bg-amber-100 text-amber-800 border border-amber-300">
              توريد مباشر مؤقت
            </Badge>
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            أضف أكثر من صنف داخل نفس العملية. عند الحفظ يتم إنشاء رقم عملية واحد مشترك لكل الأصناف
            وتسجيل حركة لكل صنف بنفس الرقم.
          </DialogDescription>
        </DialogHeader>

        <Alert className="border-amber-300 bg-amber-50 dark:bg-amber-950/30">
          <Info className="h-4 w-4 text-amber-700" />
          <AlertDescription className="text-xs text-amber-900 dark:text-amber-200">
            هذه العملية لا تخصم من أي مخزن آخر ولا تنشئ خزنة أو فاتورة أو تحويل داخلي.
          </AlertDescription>
        </Alert>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">جهة التوريد *</Label>
            <div className="flex gap-2">
              <Select value={sourceKey} onValueChange={setSourceKey}>
                <SelectTrigger className="flex-1"><SelectValue placeholder="اختر جهة التوريد" /></SelectTrigger>
                <SelectContent>
                  {SUPPLY_SOURCES.map(s => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
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
            {sourceKey === "other" && (
              <Input
                className="mt-2"
                value={sourceOther}
                onChange={(e) => setSourceOther(e.target.value)}
                placeholder="اكتب جهة التوريد"
                maxLength={120}
              />
            )}
          </div>

          <AddManualPartyDialog
            open={addPartyOpen}
            onOpenChange={setAddPartyOpen}
            kind="supply"
            onCreated={async (p) => { await loadCustom(); setSourceKey(`custom:${p.id}`); }}
          />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">القائم بالتوريد *</Label>
              <Input
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
                placeholder="مثال: عبدالمنعم عثمان، محمد شعلة، مسؤول المجزر"
                maxLength={120}
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
              <Label className="text-xs">سبب الإضافة / التوريد *</Label>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="مثال: تسوية رصيد، مرتجع تشغيل، تصحيح جرد"
                maxLength={200}
              />
            </div>
            <div className="md:col-span-3">
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
              <div className="font-semibold text-sm">أصناف التوريد</div>
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
                    <th className="p-2 text-right">قبل</th>
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
                    const after = before + q;
                    return (
                      <tr key={r.uid} className="border-t align-top">
                        <td className="p-1 min-w-[180px]">
                          <Select value={r.itemId} onValueChange={(v) => updateRow(r.uid, { itemId: v })}>
                            <SelectTrigger className="h-8"><SelectValue placeholder="اختر الصنف" /></SelectTrigger>
                            <SelectContent className="max-h-72">
                              {items.length === 0 ? (
                                <div className="px-3 py-2 text-xs text-muted-foreground">لا توجد أصناف</div>
                              ) : items.map((i) => (
                                <SelectItem key={i.id} value={i.id}>
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
                            <span className="font-bold">{q > 0 ? `${q} كجم` : "—"}</span>
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
                        <td className="p-1 text-emerald-700 font-semibold">{it && q > 0 ? after : "—"}</td>
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
              <div className="p-2 text-xs bg-emerald-50 dark:bg-emerald-950/30 border-t flex justify-between">
                <span>إجمالي عدد الأصناف: <b>{mergedRows.size}</b></span>
                <span>إجمالي الكمية: <b className="text-emerald-700">+{totalQty}</b> كجم</span>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            إلغاء
          </Button>
          <Button onClick={handleSave} disabled={!canSave} className="bg-emerald-600 hover:bg-emerald-700">
            {saving ? <Loader2 className="w-4 h-4 ml-1 animate-spin" /> : <PackagePlus className="w-4 h-4 ml-1" />}
            حفظ التوريد
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ManualStockAdditionDialog;
