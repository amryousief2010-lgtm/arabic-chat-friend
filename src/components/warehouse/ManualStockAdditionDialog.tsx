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
import { Info, Loader2, PackagePlus, Plus } from "lucide-react";
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
  const [itemId, setItemId] = useState("");
  const [packageCount, setPackageCount] = useState<string>("");
  const [packageWeightKg, setPackageWeightKg] = useState<string>("0.5");
  const [manualKgMode, setManualKgMode] = useState(false);
  const [manualKg, setManualKg] = useState<string>("");
  const [unitOverride, setUnitOverride] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
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
      setItemId(""); setPackageCount(""); setPackageWeightKg("0.5");
      setManualKgMode(false); setManualKg("");
      setUnitOverride(""); setReason(""); setNotes("");
    }
  }, [open]);


  const selected = useMemo(() => items.find((i) => i.id === itemId), [items, itemId]);
  const unit = unitOverride || selected?.unit || "كجم";
  const pkgCountNum = Number(packageCount);
  const pkgWeightNum = Number(packageWeightKg);
  const validPkg = !manualKgMode && Number.isFinite(pkgCountNum) && pkgCountNum > 0 && Number.isFinite(pkgWeightNum) && pkgWeightNum > 0;
  const manualKgNum = Number(manualKg);
  const validManualKg = manualKgMode && Number.isFinite(manualKgNum) && manualKgNum > 0;
  const qtyNum = manualKgMode ? manualKgNum : (validPkg ? pkgCountNum * pkgWeightNum : 0);
  const validQty = qtyNum > 0;
  const customMatch = customParties.find((p) => `custom:${p.id}` === sourceKey);
  const sourceLabel = sourceKey === "other"
    ? sourceOther.trim()
    : customMatch
      ? customMatch.name
      : (SUPPLY_SOURCES.find(s => s.value === sourceKey)?.label || "");
  const validSource = !!sourceKey && (sourceKey !== "other" || sourceOther.trim().length > 0);
  const canSave = !!selected && (manualKgMode ? validManualKg : validPkg) && reason.trim().length > 0 && validSource && !saving;
  const stockBefore = Number(selected?.stock || 0);
  const stockAfter = validQty ? stockBefore + qtyNum : stockBefore;

  const partyLabel = sourceLabel ? `توريد مباشر مؤقت من: ${sourceLabel}` : "توريد مباشر مؤقت";

  const handleSave = async () => {
    if (!validSource) { toast({ title: "اختر جهة التوريد", variant: "destructive" }); return; }
    if (!selected) { toast({ title: "اختر الصنف", variant: "destructive" }); return; }
    if (manualKgMode) {
      if (!validManualKg) { toast({ title: "أدخل كمية بالكيلو موجبة أكبر من صفر", variant: "destructive" }); return; }
    } else {
      if (!validPkg) { toast({ title: "أدخل عدد عبوات موجب ووزن عبوة صحيح", variant: "destructive" }); return; }
    }
    if (!reason.trim()) { toast({ title: "أدخل سبب الإضافة / التوريد", variant: "destructive" }); return; }

    setSaving(true);
    try {
      const ref = `MANUAL-ADD-${Date.now()}`;
      const pkgLine = manualKgMode
        ? `إدخال يدوي بالكيلو: ${qtyNum} كجم`
        : `${pkgCountNum} عبوة × ${pkgWeightNum} كجم = ${qtyNum} كجم`;
      const combinedNotes = [
        `توريد مباشر مؤقت`,
        `جهة التوريد: ${sourceLabel}`,
        pkgLine,
        `السبب: ${reason.trim()}`,
        notes.trim() ? `ملاحظات: ${notes.trim()}` : null,
        `قبل: ${stockBefore} ${unit}`,
        `بعد: ${stockAfter} ${unit}`,
      ].filter(Boolean).join(" • ");

      const partyWithPkg = manualKgMode
        ? partyLabel
        : `${partyLabel} — ${pkgCountNum} عبوة × ${pkgWeightNum} كجم = ${qtyNum} كجم`;

      const { error: mErr } = await supabase.from("inventory_movements").insert({
        warehouse_id: warehouseId,
        item_id: selected.id,
        movement_type: "in",
        quantity: qtyNum,
        package_count: manualKgMode ? null : pkgCountNum,
        package_weight_kg: manualKgMode ? null : pkgWeightNum,
        quantity_kg: qtyNum,
        reference: ref,
        reference_type: "manual_addition",
        party: partyWithPkg,
        reason: reason.trim(),
        notes: combinedNotes,
        module: "warehouse_manual",
        performed_by: user?.id ?? null,
        performed_at: new Date().toISOString(),
      } as any);
      if (mErr) throw mErr;

      const { error: sErr } = await supabase
        .from("inventory_items")
        .update({ stock: stockAfter })
        .eq("id", selected.id);
      if (sErr) throw sErr;

      toast({
        title: "تمت الإضافة اليدوية",
        description: `${selected.name}: ${stockBefore} → ${stockAfter} ${unit} (${sourceLabel})`,
      });
      onOpenChange(false);
      onSaved?.();
    } catch (e: any) {
      toast({
        title: "تعذرت الإضافة اليدوية",
        description: e?.message || "خطأ غير معروف",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <PackagePlus className="w-5 h-5 text-emerald-600" />
            إضافة رصيد / توريد مباشر — {warehouseName || "المخزن الرئيسي"}
            <Badge variant="secondary" className="bg-amber-100 text-amber-800 border border-amber-300">
              توريد مباشر مؤقت
            </Badge>
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            تستخدم هذه الشاشة لإضافة توريد مباشر أو مرتجع إلى المخزن الرئيسي
            بدون إنشاء تحويل داخلي أو خصم من أي مخزن آخر. يتم تسجيل الحركة في
            سجل المخزن كمصدر <b>توريد مباشر مؤقت</b>.
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


          <div>
            <Label className="text-xs">الصنف *</Label>
            <Select value={itemId} onValueChange={setItemId}>
              <SelectTrigger><SelectValue placeholder="اختر صنف من المخزن الرئيسي" /></SelectTrigger>
              <SelectContent className="max-h-72">
                {items.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-muted-foreground">لا توجد أصناف</div>
                ) : items.map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.name} {i.unit ? `(${i.unit})` : ""} — رصيد حالي: {Number(i.stock || 0)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">الكمية *</Label>
              <Input
                type="number"
                min="0"
                step="any"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder="مثال: 25"
              />
            </div>
            <div>
              <Label className="text-xs">الوحدة</Label>
              <Input
                value={unitOverride}
                onChange={(e) => setUnitOverride(e.target.value)}
                placeholder={selected?.unit || "—"}
              />
            </div>
          </div>

          <div>
            <Label className="text-xs">سبب الإضافة / التوريد *</Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="مثال: تسوية رصيد، مرتجع تشغيل، تصحيح جرد، توريد مباشر مؤقت"
              maxLength={200}
            />
          </div>

          <div>
            <Label className="text-xs">ملاحظات (اختياري)</Label>
            <Textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={500}
            />
          </div>

          {selected && validQty && validSource && (
            <div className="rounded border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 p-2 text-xs space-y-0.5">
              <div>جهة التوريد: <b>{sourceLabel}</b></div>
              <div>قبل الإضافة: <b>{stockBefore}</b> {unit}</div>
              <div>الكمية المضافة: <b className="text-emerald-700">+{qtyNum}</b> {unit}</div>
              <div>بعد الإضافة: <b className="text-emerald-700">{stockAfter}</b> {unit}</div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            إلغاء
          </Button>
          <Button onClick={handleSave} disabled={!canSave} className="bg-emerald-600 hover:bg-emerald-700">
            {saving ? <Loader2 className="w-4 h-4 ml-1 animate-spin" /> : <PackagePlus className="w-4 h-4 ml-1" />}
            حفظ الإضافة اليدوية
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ManualStockAdditionDialog;
