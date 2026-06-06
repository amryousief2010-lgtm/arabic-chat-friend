import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Save, X, ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

interface Props {
  row: any;
  customerName?: string;
  onClose: () => void;
  onSaved?: () => void;
}

const numFields = [
  { key: "received_eggs", label: "البيض الوارد", critical: true },
  { key: "net_eggs", label: "البيض الصافي", critical: true },
  { key: "candle1_infertile", label: "لايح (كشف 1)", critical: true },
  { key: "candle1_fertile", label: "مخصب (كشف 1)", critical: true },
  { key: "candle2_dead", label: "نافق (كشف 2)", critical: true },
  { key: "hatcher_dead", label: "نافق الهاتشر", critical: true },
  { key: "hatched_chicks", label: "الكتاكيت الناتجة", critical: true },
];

const dateFields = [
  { key: "entry_date", label: "تاريخ الدخول", critical: false },
  { key: "candle1_date", label: "تاريخ الكشف 1", critical: false },
  { key: "candle2_date", label: "تاريخ الكشف 2", critical: false },
  { key: "exit_date", label: "تاريخ الخروج", critical: true },
];

const ALLOWED_ROLES = ["general_manager", "executive_manager", "hatchery_manager", "farm_manager"] as const;

export default function HatchBatchRowEditDialog({ row, customerName, onClose, onSaved }: Props) {
  const { roles, profile, user } = useAuth();
  const canEdit = useMemo(
    () => roles.some((r) => (ALLOWED_ROLES as readonly string[]).includes(r)),
    [roles]
  );
  const [form, setForm] = useState<any>(() => ({ ...row }));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const set = (k: string, v: any) => setForm((p: any) => ({ ...p, [k]: v }));

  const buildChanges = () => {
    const changes: Record<string, { before: any; after: any; critical?: boolean }> = {};
    const all = [
      ...numFields,
      ...dateFields,
      { key: "machine", label: "الماكينة", critical: false },
      { key: "status", label: "الحالة", critical: true },
      { key: "notes", label: "ملاحظات", critical: false },
    ];
    for (const f of all) {
      const before = row[f.key] ?? null;
      let after = form[f.key];
      if (after === "") after = null;
      // normalize numbers
      if (numFields.find((n) => n.key === f.key) && after != null) after = Number(after);
      const a = before == null ? null : String(before);
      const b = after == null ? null : String(after);
      if (a !== b) changes[f.key] = { before, after, critical: f.critical };
    }
    return changes;
  };

  const changes = useMemo(buildChanges, [form, row]);
  const hasCritical = Object.values(changes).some((c) => c.critical);
  const hasAny = Object.keys(changes).length > 0;

  const save = async () => {
    if (!canEdit) { toast.error("لا تملك صلاحية التعديل"); return; }
    if (!hasAny) { toast.info("لا توجد تغييرات"); return; }
    if (hasCritical && reason.trim().length < 5) {
      toast.error("يجب إدخال سبب التعديل (5 أحرف على الأقل) عند تعديل الحقول المهمة");
      return;
    }

    setSaving(true);
    try {
      const payload: any = {};
      Object.entries(changes).forEach(([k, v]) => { payload[k] = v.after; });

      const { error } = await supabase.from("hatch_batches").update(payload).eq("id", row.id);
      if (error) throw error;

      await supabase.from("hatch_batch_edit_audit").insert({
        batch_id: row.id,
        batch_number: row.batch_number || null,
        operational_batch_no: row.operational_batch_no || null,
        customer_id: row.customer_id || null,
        customer_name: customerName || row.customer_name || null,
        actor_id: user?.id || null,
        actor_name: profile?.full_name || user?.email || null,
        changes,
        reason: reason.trim() || null,
      });

      toast.success("تم تحديث بيانات الدفعة وتسجيل التعديل في سجل التدقيق");
      onSaved?.();
      onClose();
    } catch (e: any) {
      toast.error(e.message || "فشل التحديث");
    } finally {
      setSaving(false);
    }
  };

  if (!canEdit) {
    return (
      <Dialog open onOpenChange={onClose}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-700">
              <ShieldAlert className="w-5 h-5" /> لا تملك صلاحية التعديل
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            تعديل بيانات الدفعة متاح فقط للمدير العام، المدير التنفيذي، مدير المعمل، أو مدير المزرعة.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>إغلاق</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

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
              <Label>{f.label} {f.critical && <span className="text-red-600">*</span>}</Label>
              <Input
                type="date"
                value={form[f.key] ? String(form[f.key]).slice(0, 10) : ""}
                onChange={(e) => set(f.key, e.target.value)}
              />
            </div>
          ))}

          {numFields.map((f) => (
            <div key={f.key}>
              <Label>{f.label} {f.critical && <span className="text-red-600">*</span>}</Label>
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

          <div className="md:col-span-2 border-t pt-3">
            <Label className="font-semibold">
              سبب التعديل {hasCritical && <span className="text-red-600">* مطلوب (تعديل حقول مهمة)</span>}
            </Label>
            <Textarea
              placeholder="مثال: تصحيح خطأ إدخال من الشيت، أو تعديل نتيجة كشف بعد إعادة المراجعة..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
            />
          </div>

          {hasAny && (
            <div className="md:col-span-2 text-xs bg-slate-50 border rounded p-2">
              <b>التغييرات ({Object.keys(changes).length}):</b>
              <ul className="mt-1 space-y-0.5">
                {Object.entries(changes).map(([k, v]) => (
                  <li key={k}>
                    <span className="font-mono">{k}</span>: {String(v.before ?? "—")} → <b>{String(v.after ?? "—")}</b>
                    {v.critical && <span className="text-red-600 mr-1">⚠</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="text-xs text-muted-foreground bg-amber-50 border border-amber-200 p-2 rounded">
          ⚠️ التعديل يحدّث بيانات هذا الصف فقط ويُسجّل في سجل تدقيق التعديلات. لا يتم إنشاء أي حركة خزنة أو تحصيل.
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            <X className="w-4 h-4 ml-1" /> إلغاء
          </Button>
          <Button onClick={save} disabled={saving || !hasAny} className="bg-purple-600 hover:bg-purple-700">
            <Save className="w-4 h-4 ml-1" /> {saving ? "جاري الحفظ..." : "حفظ التعديل"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
