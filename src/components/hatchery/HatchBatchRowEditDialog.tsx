import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Save, X } from "lucide-react";

interface Props {
  row: any; // hatch_batches row (raw)
  customerName?: string;
  onClose: () => void;
  onSaved?: () => void;
}

const numFields = [
  { key: "received_eggs", label: "البيض الوارد" },
  { key: "net_eggs", label: "البيض الصافي" },
  { key: "candle1_infertile", label: "لايح (كشف 1)" },
  { key: "candle1_fertile", label: "مخصب (كشف 1)" },
  { key: "candle2_dead", label: "نافق (كشف 2)" },
  { key: "hatcher_dead", label: "نافق الهاتشر" },
  { key: "chicks_produced", label: "الكتاكيت الناتجة" },
  { key: "charge_total", label: "الحساب التقديري" },
];

const dateFields = [
  { key: "entry_date", label: "تاريخ الدخول" },
  { key: "candle1_date", label: "تاريخ الكشف 1" },
  { key: "candle2_date", label: "تاريخ الكشف 2" },
  { key: "exit_date", label: "تاريخ الخروج" },
];

export default function HatchBatchRowEditDialog({ row, customerName, onClose, onSaved }: Props) {
  const [form, setForm] = useState<any>(() => ({ ...row }));
  const [saving, setSaving] = useState(false);

  const set = (k: string, v: any) => setForm((p: any) => ({ ...p, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      const payload: any = { machine: form.machine, notes: form.notes };
      numFields.forEach((f) => {
        const v = form[f.key];
        payload[f.key] = v === "" || v == null ? null : Number(v);
      });
      dateFields.forEach((f) => {
        payload[f.key] = form[f.key] || null;
      });
      const { error } = await supabase.from("hatch_batches").update(payload).eq("id", row.id);
      if (error) throw error;
      toast.success("تم تحديث بيانات الدفعة");
      onSaved?.();
      onClose();
    } catch (e: any) {
      toast.error(e.message || "فشل التحديث");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            تعديل صف الدفعة — {customerName || row.customer_name || "عميل"} ({row.batch_number})
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="md:col-span-2">
            <Label>الماكينة</Label>
            <Input value={form.machine || ""} onChange={(e) => set("machine", e.target.value)} />
          </div>

          {dateFields.map((f) => (
            <div key={f.key}>
              <Label>{f.label}</Label>
              <Input
                type="date"
                value={form[f.key] ? String(form[f.key]).slice(0, 10) : ""}
                onChange={(e) => set(f.key, e.target.value)}
              />
            </div>
          ))}

          {numFields.map((f) => (
            <div key={f.key}>
              <Label>{f.label}</Label>
              <Input
                type="number"
                value={form[f.key] ?? ""}
                onChange={(e) => set(f.key, e.target.value)}
              />
            </div>
          ))}

          <div className="md:col-span-2">
            <Label>ملاحظات</Label>
            <Textarea
              value={form.notes || ""}
              onChange={(e) => set("notes", e.target.value)}
              rows={2}
            />
          </div>
        </div>

        <div className="text-xs text-muted-foreground bg-amber-50 border border-amber-200 p-2 rounded">
          ⚠️ التعديل يحدّث بيانات هذا الصف فقط في جدول الدفعات. لا يتم إنشاء أي حركة خزنة أو تحصيل.
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            <X className="w-4 h-4 ml-1" /> إلغاء
          </Button>
          <Button onClick={save} disabled={saving} className="bg-purple-600 hover:bg-purple-700">
            <Save className="w-4 h-4 ml-1" /> {saving ? "جاري الحفظ..." : "حفظ التعديل"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
