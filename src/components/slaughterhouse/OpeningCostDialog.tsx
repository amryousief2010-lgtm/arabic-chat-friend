import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Batch = {
  id: string;
  receipt_number: string;
  bird_count: number;
  opening_cost_total?: number | null;
  cost_per_bird_current?: number | null;
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  batch: Batch | null;
  onSaved?: () => void;
}

export function OpeningCostDialog({ open, onOpenChange, batch, onSaved }: Props) {
  const [mode, setMode] = useState<"per_bird" | "total">("per_bird");
  const [perBird, setPerBird] = useState<string>("");
  const [total, setTotal] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const birds = batch?.bird_count || 0;
  const oldOpening = Number(batch?.opening_cost_total || 0);
  const isEdit = oldOpening > 0;

  useEffect(() => {
    if (open) {
      setPerBird("");
      setTotal("");
      setReason("");
      setMode("per_bird");
    }
  }, [open]);

  const computed = useMemo(() => {
    if (mode === "per_bird") {
      const p = parseFloat(perBird) || 0;
      return { perBird: p, total: p * birds };
    }
    const t = parseFloat(total) || 0;
    return { perBird: birds > 0 ? t / birds : 0, total: t };
  }, [mode, perBird, total, birds]);

  const fmt = (n: number) =>
    Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });

  const save = async () => {
    if (!batch) return;
    if (computed.total <= 0) {
      toast.error("أدخل قيمة صحيحة أكبر من صفر");
      return;
    }
    if (isEdit && reason.trim().length < 3) {
      toast.error("التعديل يتطلب كتابة سبب");
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc("set_opening_live_ostrich_cost" as any, {
        p_live_batch_id: batch.id,
        p_total_cost: computed.total,
        p_reason: reason || null,
      });
      if (error) throw error;
      const res = data as any;
      toast.success(
        `تم الحفظ — تكلفة النعامة: ${fmt(res?.cost_per_bird || 0)} ج.م`,
      );
      onSaved?.();
      onOpenChange(false);
    } catch (e: any) {
      const msg = String(e?.message || "");
      if (msg.includes("edit_requires_admin")) {
        toast.error("التعديل يتطلب صلاحية المدير العام أو التنفيذي");
      } else if (msg.includes("insert_requires_authorized_role")) {
        toast.error("ليس لديك صلاحية إدخال تكلفة افتتاحية");
      } else {
        toast.error(msg || "فشل الحفظ");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "تعديل التكلفة الافتتاحية" : "إدخال تكلفة افتتاحية"} —{" "}
            {batch?.receipt_number}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription className="text-xs">
              لا يؤثر على الخزنة ولا المخزون — تكلفة افتتاحية فقط لحساب تكلفة الدبح.
            </AlertDescription>
          </Alert>

          <div className="grid grid-cols-3 gap-2 text-sm">
            <div className="rounded border p-2"><div className="text-muted-foreground text-xs">عدد النعام</div><div className="font-bold">{birds}</div></div>
            <div className="rounded border p-2"><div className="text-muted-foreground text-xs">التكلفة الحالية للنعامة</div><div className="font-bold">{fmt(Number(batch?.cost_per_bird_current || 0))}</div></div>
            <div className="rounded border p-2"><div className="text-muted-foreground text-xs">إجمالي افتتاحي سابق</div><div className="font-bold">{fmt(oldOpening)}</div></div>
          </div>

          <div className="flex gap-2">
            <Button type="button" size="sm" variant={mode === "per_bird" ? "default" : "outline"} onClick={() => setMode("per_bird")}>تكلفة النعامة</Button>
            <Button type="button" size="sm" variant={mode === "total" ? "default" : "outline"} onClick={() => setMode("total")}>إجمالي الدفعة</Button>
          </div>

          {mode === "per_bird" ? (
            <div>
              <Label>تكلفة النعامة الواحدة (ج.م)</Label>
              <Input type="number" min="0" step="0.01" value={perBird} onChange={(e) => setPerBird(e.target.value)} placeholder="مثال: 5000" />
            </div>
          ) : (
            <div>
              <Label>إجمالي تكلفة الدفعة (ج.م)</Label>
              <Input type="number" min="0" step="0.01" value={total} onChange={(e) => setTotal(e.target.value)} placeholder={`مثال: ${5000 * birds}`} />
            </div>
          )}

          <div className="rounded-md bg-muted p-3 text-sm space-y-1">
            <div className="flex justify-between"><span>تكلفة النعامة المحسوبة:</span><span className="font-bold">{fmt(computed.perBird)} ج.م</span></div>
            <div className="flex justify-between"><span>إجمالي الدفعة:</span><span className="font-bold text-primary">{fmt(computed.total)} ج.م</span></div>
          </div>

          <div>
            <Label>{isEdit ? "سبب التعديل (مطلوب)" : "ملاحظات / سبب"}</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} placeholder={isEdit ? "اشرح سبب التعديل…" : "اختياري"} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>إلغاء</Button>
          <Button onClick={save} disabled={saving || computed.total <= 0}>{saving ? "جارٍ الحفظ…" : "حفظ"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
