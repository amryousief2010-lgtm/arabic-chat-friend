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
import { Info, Loader2, PackageMinus, Plus } from "lucide-react";
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

const ManualStockOutDialog = ({
  open,
  onOpenChange,
  warehouseId,
  warehouseName,
  items,
  onSaved,
}: Props) => {
  const { user, isGeneralManager, isExecutiveManager, isWarehouseSupervisor } = useAuth() as any;
  const canAddParty = isGeneralManager || isExecutiveManager || isWarehouseSupervisor;
  const [destKey, setDestKey] = useState("");
  const [destOther, setDestOther] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState<string>("");
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
      .in("kind", ["dispatch", "both"])
      .eq("is_active", true)
      .order("name");
    setCustomParties((data as any) || []);
  };

  useEffect(() => {
    if (!open) {
      setDestKey(""); setDestOther(""); setCustomerName("");
      setItemId(""); setQty(""); setUnitOverride(""); setReason(""); setNotes("");
    } else {
      void loadCustom();
    }
  }, [open]);

  useEffect(() => {
    if (destKey === "customer" && customers.length === 0) {
      supabase.from("customers").select("id, name").order("name").limit(500)
        .then(({ data }) => setCustomers(data || []));
    }
  }, [destKey, customers.length]);

  const selected = useMemo(() => items.find((i) => i.id === itemId), [items, itemId]);
  const unit = unitOverride || selected?.unit || "";
  const qtyNum = Number(qty);
  const validQty = Number.isFinite(qtyNum) && qtyNum > 0;
  const stockBefore = Number(selected?.stock || 0);
  const stockAfter = validQty ? stockBefore - qtyNum : stockBefore;
  const exceedsStock = validQty && qtyNum > stockBefore;

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

  const canSave = !!selected && validQty && !exceedsStock
    && reason.trim().length > 0 && validDest && !saving;

  const partyLabel = destLabel ? `صرف مباشر مؤقت إلى: ${destLabel}` : "صرف مباشر مؤقت";

  const handleSave = async () => {
    if (!validDest) { toast({ title: "اختر جهة الصرف", variant: "destructive" }); return; }
    if (!selected) { toast({ title: "اختر الصنف", variant: "destructive" }); return; }
    if (!validQty) { toast({ title: "أدخل كمية موجبة أكبر من صفر", variant: "destructive" }); return; }
    if (exceedsStock) {
      toast({ title: "الكمية أكبر من الرصيد المتاح", description: `المتاح: ${stockBefore} ${unit}`, variant: "destructive" });
      return;
    }
    if (!reason.trim()) { toast({ title: "أدخل سبب الصرف", variant: "destructive" }); return; }

    setSaving(true);
    try {
      const ref = `MANUAL-OUT-${Date.now()}`;
      const combinedNotes = [
        `صرف مباشر مؤقت`,
        `جهة الصرف: ${destLabel}`,
        `السبب: ${reason.trim()}`,
        notes.trim() ? `ملاحظات: ${notes.trim()}` : null,
        `الكمية: ${qtyNum} ${unit}`,
        `قبل: ${stockBefore} ${unit}`,
        `بعد: ${stockAfter} ${unit}`,
      ].filter(Boolean).join(" • ");

      const { error: mErr } = await supabase.from("inventory_movements").insert({
        warehouse_id: warehouseId,
        item_id: selected.id,
        movement_type: "out",
        quantity: qtyNum,
        reference: ref,
        reference_type: "manual_out",
        party: partyLabel,
        reason: reason.trim(),
        notes: combinedNotes,
        module: "warehouse_manual",
        performed_by: user?.id ?? null,
        performed_at: new Date().toISOString(),
      });
      if (mErr) throw mErr;

      const { error: sErr } = await supabase
        .from("inventory_items")
        .update({ stock: stockAfter })
        .eq("id", selected.id);
      if (sErr) throw sErr;

      toast({
        title: "تم الصرف",
        description: `${selected.name}: ${stockBefore} → ${stockAfter} ${unit} (${destLabel})`,
      });
      onOpenChange(false);
      onSaved?.();
    } catch (e: any) {
      toast({
        title: "تعذر الصرف",
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
            <PackageMinus className="w-5 h-5 text-rose-600" />
            صرف منتجات / توريد للجهات — {warehouseName || "المخزن الرئيسي"}
            <Badge variant="secondary" className="bg-amber-100 text-amber-800 border border-amber-300">
              صرف مباشر مؤقت
            </Badge>
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            تستخدم هذه الشاشة لصرف منتجات من المخزن الرئيسي مباشرة للجهات
            (فرع العجوزة، مندوب خاص، هيلثي تيست، كارفور، عميل، تالف، استخدام
            داخلي...) بدون إنشاء تحويل داخلي أو فاتورة أو حركة خزنة.
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
            <Label className="text-xs">جهة الصرف / التوريد *</Label>
            <Select value={destKey} onValueChange={(v) => { setDestKey(v); setCustomerName(""); setDestOther(""); }}>
              <SelectTrigger><SelectValue placeholder="اختر جهة الصرف" /></SelectTrigger>
              <SelectContent>
                {DESTINATIONS.map(d => (
                  <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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

          <div>
            <Label className="text-xs">الصنف *</Label>
            <Select value={itemId} onValueChange={setItemId}>
              <SelectTrigger><SelectValue placeholder="اختر صنف من المخزن" /></SelectTrigger>
              <SelectContent className="max-h-72">
                {items.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-muted-foreground">لا توجد أصناف</div>
                ) : items.map((i) => (
                  <SelectItem key={i.id} value={i.id} disabled={Number(i.stock || 0) <= 0}>
                    {i.name} {i.unit ? `(${i.unit})` : ""} — متاح: {Number(i.stock || 0)}
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
                placeholder={selected ? `حتى ${stockBefore}` : "مثال: 10"}
              />
              {exceedsStock && (
                <p className="text-[11px] text-destructive mt-1">
                  الكمية أكبر من المتاح ({stockBefore} {unit})
                </p>
              )}
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
            <Label className="text-xs">سبب الصرف *</Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="مثال: توريد للفرع، تسليم لمندوب، توريد لعميل، تالف..."
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

          {selected && validQty && !exceedsStock && validDest && (
            <div className="rounded border border-rose-200 bg-rose-50 dark:bg-rose-950/30 p-2 text-xs space-y-0.5">
              <div>جهة الصرف: <b>{destLabel}</b></div>
              <div>قبل الصرف: <b>{stockBefore}</b> {unit}</div>
              <div>الكمية المصروفة: <b className="text-rose-700">−{qtyNum}</b> {unit}</div>
              <div>بعد الصرف: <b className="text-rose-700">{stockAfter}</b> {unit}</div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            إلغاء
          </Button>
          <Button onClick={handleSave} disabled={!canSave} className="bg-rose-600 hover:bg-rose-700">
            {saving ? <Loader2 className="w-4 h-4 ml-1 animate-spin" /> : <PackageMinus className="w-4 h-4 ml-1" />}
            حفظ الصرف
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ManualStockOutDialog;
