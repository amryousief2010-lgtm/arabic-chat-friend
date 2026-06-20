import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Loader2, PackagePlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";

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

/**
 * Manual Stock Addition — يستخدمه مسؤول المخزن الرئيسي مؤقتًا لإضافة رصيد
 * مباشرة دون فاتورة أو نقل من المجزر/مصنع اللحوم.
 *
 * أثر العملية:
 *  - إنشاء صف في inventory_movements بنوع 'in' وreference_type='manual_addition'
 *  - زيادة stock الصنف في inventory_items بنفس الكمية
 *  - تسجيل السبب والملاحظات و"قبل/بعد" في حقل notes للحركة (للمراجعة)
 *
 * ما لا يحدث: لا حركة خزنة، لا فاتورة، لا أمر نقل من المجزر/المصنع، لا تعديل
 * على أي مخزون آخر.
 */
const ManualStockAdditionDialog = ({
  open,
  onOpenChange,
  warehouseId,
  warehouseName,
  items,
  onSaved,
}: Props) => {
  const { user } = useAuth();
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState<string>("");
  const [unitOverride, setUnitOverride] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setItemId(""); setQty(""); setUnitOverride(""); setReason(""); setNotes("");
    }
  }, [open]);

  const selected = useMemo(() => items.find((i) => i.id === itemId), [items, itemId]);
  const unit = unitOverride || selected?.unit || "";
  const qtyNum = Number(qty);
  const validQty = Number.isFinite(qtyNum) && qtyNum > 0;
  const canSave = !!selected && validQty && reason.trim().length > 0 && !saving;
  const stockBefore = Number(selected?.stock || 0);
  const stockAfter = validQty ? stockBefore + qtyNum : stockBefore;

  const handleSave = async () => {
    if (!selected) {
      toast({ title: "اختر الصنف", variant: "destructive" });
      return;
    }
    if (!validQty) {
      toast({ title: "أدخل كمية موجبة أكبر من صفر", variant: "destructive" });
      return;
    }
    if (!reason.trim()) {
      toast({ title: "أدخل سبب الإضافة اليدوية", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      // 1) سجّل حركة المخزن
      const ref = `MANUAL-ADD-${Date.now()}`;
      const combinedNotes = [
        `توريد مباشر مؤقت / إضافة يدوية مؤقتة`,
        `السبب: ${reason.trim()}`,
        notes.trim() ? `ملاحظات: ${notes.trim()}` : null,
        `الكمية: ${qtyNum} ${unit}`,
        `قبل: ${stockBefore} ${unit}`,
        `بعد: ${stockAfter} ${unit}`,
      ].filter(Boolean).join(" • ");

      const { error: mErr } = await supabase.from("inventory_movements").insert({
        warehouse_id: warehouseId,
        item_id: selected.id,
        movement_type: "in",
        quantity: qtyNum,
        reference: ref,
        reference_type: "manual_addition",
        party: "توريد مباشر مؤقت",
        reason: reason.trim(),
        notes: combinedNotes,
        module: "warehouse_manual",
        performed_by: user?.id ?? null,
        performed_at: new Date().toISOString(),
      });
      if (mErr) throw mErr;

      // 2) حدّث رصيد الصنف فقط (لا خزنة، لا فاتورة، لا نقل)
      const { error: sErr } = await supabase
        .from("inventory_items")
        .update({ stock: stockAfter })
        .eq("id", selected.id);
      if (sErr) throw sErr;

      toast({
        title: "تمت الإضافة اليدوية",
        description: `${selected.name}: ${stockBefore} → ${stockAfter} ${unit}`,
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
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackagePlus className="w-5 h-5 text-emerald-600" />
            إضافة رصيد يدوي — {warehouseName || "المخزن الرئيسي"}
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            صلاحية مؤقتة للسيطرة على المخزون. لن يتم إنشاء أي فاتورة أو حركة
            خزنة أو نقل من المجزر/مصنع اللحوم. تُسجَّل الحركة في سجل المخزن
            باسم <b>"إضافة يدوية"</b>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
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
            <Label className="text-xs">سبب الإضافة *</Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="مثال: تسوية رصيد افتتاحي، إدخال رصيد سابق، تصحيح جرد"
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

          {selected && validQty && (
            <div className="rounded border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 p-2 text-xs space-y-0.5">
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
