import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Pencil, Plus, Trash2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

const fmt = (n: any) => Number(n || 0).toLocaleString("ar-EG", { maximumFractionDigits: 2 });

type Line = { key: string; raw_id: string; qty: number };
const newLine = (): Line => ({ key: crypto.randomUUID(), raw_id: "", qty: 0 });

export default function FeedProductionEditDialog({
  invoice,
  rawMaterials,
  onOpenChange,
  onSaved,
}: {
  invoice: any | null;
  rawMaterials: any[];
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const open = !!invoice;
  const [date, setDate] = useState("");
  const [qty, setQty] = useState<number>(0);
  const [bags, setBags] = useState<number>(0);
  const [labor, setLabor] = useState<number>(0);
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!invoice) return;
    setDate(invoice.prod_date || new Date().toISOString().slice(0, 10));
    setQty(Number(invoice.qty_produced || 0));
    setBags(Number(invoice.bags || 0));
    setLabor(Number(invoice.labor_cost || 0));
    setNotes(invoice.notes || "");
    setReason("");
    setLines(
      (invoice.feed_production_invoice_items || []).map((i: any) => ({
        key: crypto.randomUUID(),
        raw_id: i.raw_material_id,
        qty: Number(i.quantity || 0),
      })),
    );
  }, [invoice]);

  const materialsCost = useMemo(
    () =>
      lines.reduce((s, l) => {
        const m = rawMaterials.find((r: any) => r.id === l.raw_id);
        return s + Number(m?.unit_cost || 0) * Number(l.qty || 0);
      }, 0),
    [lines, rawMaterials],
  );
  const totalCost = materialsCost + Number(labor || 0);
  const unitCost = qty > 0 ? totalCost / qty : 0;

  const save = async () => {
    if (saving) return;
    if (!qty || qty <= 0) return toast.error("الكمية المنتجة يجب أن تكون أكبر من صفر");
    const valid = lines.filter((l) => l.raw_id && l.qty > 0);
    if (!valid.length) return toast.error("أضف خامة واحدة على الأقل");
    if (reason.trim().length < 3) return toast.error("سبب التعديل مطلوب (٣ أحرف على الأقل)");
    if (!window.confirm(
      `تعديل فاتورة ${invoice.prod_no}؟\n` +
        `سيتم إرجاع الخامات القديمة، وخصم الخامات الجديدة، وضبط مخزون المنتج والأجرة تلقائيًا.`,
    ))
      return;

    setSaving(true);
    const { error } = await (supabase as any).rpc("edit_approved_feed_production_invoice", {
      p_invoice_id: invoice.id,
      p_prod_date: date,
      p_qty_produced: qty,
      p_bags: bags,
      p_labor_cost: labor,
      p_notes: notes,
      p_items: valid.map((l) => ({ raw_material_id: l.raw_id, quantity: l.qty })),
      p_edit_reason: reason.trim(),
    });
    setSaving(false);
    if (error) return toast.error(error.message || "فشل التعديل");
    toast.success("تم تعديل الفاتورة وضبط المخزون والخزنة");
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-5 w-5" />
            تعديل فاتورة تصنيع معتمدة — {invoice?.prod_no}
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
          <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
          <div className="text-amber-900 leading-relaxed">
            تعديل الفاتورة بعد الاعتماد سيقوم تلقائيًا بـ:
            إرجاع الخامات القديمة للمخزون، ثم خصم الخامات الجديدة،
            ضبط مخزون المنتج (طرح الكمية القديمة وإضافة الجديدة)،
            وتحديث أجرة التصنيع في خزنة المصنع. سبب التعديل يُسجَّل في سجل المراجعة.
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="col-span-2">
            <Label>المنتج</Label>
            <Input value={invoice?.feed_products?.name || ""} disabled />
          </div>
          <div>
            <Label>التاريخ</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <Label>الكمية المنتجة (كجم)</Label>
            <Input type="number" value={qty || ""} onChange={(e) => setQty(Number(e.target.value))} />
          </div>
          <div>
            <Label>عدد الشكاير</Label>
            <Input type="number" value={bags || ""} onChange={(e) => setBags(Number(e.target.value))} />
          </div>
          <div>
            <Label>أجرة التصنيع (ج.م)</Label>
            <Input type="number" value={labor || ""} onChange={(e) => setLabor(Number(e.target.value))} />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>الخامات المستهلكة</Label>
            <Button size="sm" variant="outline" onClick={() => setLines([...lines, newLine()])}>
              <Plus className="h-3 w-3 ml-1" /> خامة
            </Button>
          </div>
          <div className="grid grid-cols-12 gap-2 text-xs text-muted-foreground font-semibold px-1">
            <div className="col-span-6">الصنف</div>
            <div className="col-span-2">الكمية</div>
            <div className="col-span-3 text-left">الإجمالي</div>
            <div className="col-span-1"></div>
          </div>
          {lines.map((l) => {
            const m = rawMaterials.find((r: any) => r.id === l.raw_id);
            const uc = Number(m?.unit_cost || 0);
            return (
              <div key={l.key} className="grid grid-cols-12 gap-2 items-end border-b pb-2">
                <div className="col-span-6">
                  <Select
                    value={l.raw_id}
                    onValueChange={(v) => setLines(lines.map((x) => (x.key === l.key ? { ...x, raw_id: v } : x)))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="اختر الخامة" />
                    </SelectTrigger>
                    <SelectContent>
                      {rawMaterials.map((r: any) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.name} (متاح: {fmt(Number(r.stock))} {r.unit || "كجم"} — {fmt(Number(r.unit_cost))} ج)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <Input
                    type="number"
                    placeholder="الكمية"
                    value={l.qty || ""}
                    onChange={(e) => setLines(lines.map((x) => (x.key === l.key ? { ...x, qty: Number(e.target.value) } : x)))}
                  />
                </div>
                <div className="col-span-3 text-sm font-bold text-left">{fmt(Number(l.qty || 0) * uc)} ج</div>
                <div className="col-span-1">
                  <Button size="icon" variant="ghost" onClick={() => setLines(lines.filter((x) => x.key !== l.key))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        <div>
          <Label>ملاحظات</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </div>
        <div>
          <Label>
            سبب التعديل <span className="text-red-600">*</span>
          </Label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="مثال: خطأ في إدخال الكمية / تصحيح خامة / تعديل الأجرة..."
          />
        </div>

        <div className="border-t pt-3 flex items-center justify-between flex-wrap gap-3 text-sm">
          <div>الخامات: <b>{fmt(materialsCost)}</b> ج.م</div>
          <div>الأجرة: <b>{fmt(labor)}</b> ج.م</div>
          <div>الإجمالي: <b>{fmt(totalCost)}</b> ج.م</div>
          <div>تكلفة الكيلو: <b className="text-primary">{fmt(unitCost)}</b> ج/كجم</div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            إلغاء
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "جاري التعديل..." : "حفظ التعديل"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
