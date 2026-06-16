import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Skull } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const fmt = (n: number) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });

export function LiveBatchMortalityDialog({
  open,
  onOpenChange,
  liveBatch,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  liveBatch: {
    id: string;
    receipt_number: string;
    current_alive_count: number;
    cost_per_bird_current: number;
  } | null;
  onSaved?: () => void;
}) {
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [deadCount, setDeadCount] = useState<number>(0);
  const [reason, setReason] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [loadOnRemaining, setLoadOnRemaining] = useState<boolean>(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setDate(new Date().toISOString().slice(0, 10));
      setDeadCount(0);
      setReason("");
      setNotes("");
      setLoadOnRemaining(true);
    }
  }, [open]);

  const cpb = Number(liveBatch?.cost_per_bird_current || 0);
  const alive = Number(liveBatch?.current_alive_count || 0);
  const totalLoss = cpb * deadCount;
  const remaining = Math.max(alive - deadCount, 0);
  const extraPerBird = loadOnRemaining && remaining > 0 ? totalLoss / remaining : 0;

  const save = async () => {
    if (!liveBatch) return;
    if (saving) return;
    if (deadCount <= 0) return toast.error("ادخل عدد النافق");
    if (deadCount > alive) return toast.error(`عدد النافق أكبر من النعام الحي (${alive})`);

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const reference_id = `slaughter_mortality_${liveBatch.id.slice(0, 8)}_${date}_${deadCount}`;
      const { error } = await supabase.from("slaughter_live_mortality" as any).insert({
        live_batch_id: liveBatch.id,
        mortality_date: date,
        dead_count: deadCount,
        reason,
        cost_per_bird_before: cpb,
        total_loss_cost: totalLoss,
        load_on_remaining: loadOnRemaining,
        notes,
        reference_id,
        created_by: user?.id,
      });
      if (error) {
        if (error.message?.includes("duplicate key") || error.message?.includes("unique")) {
          toast.error("تم تسجيل هذه الحركة من قبل");
        } else {
          throw error;
        }
        return;
      }
      toast.success(`تم تسجيل نفوق ${deadCount} نعامة — تكلفة ${fmt(totalLoss)} ج.م`);
      onOpenChange(false);
      onSaved?.();
    } catch (e: any) {
      toast.error(e.message || "فشل الحفظ");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Skull className="h-5 w-5 text-destructive" />
            تسجيل نفوق — {liveBatch?.receipt_number || ""}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>التاريخ</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <Label>عدد النافق</Label>
              <Input type="number" value={deadCount || ""} onChange={(e) => setDeadCount(Number(e.target.value))} />
            </div>
          </div>
          <div>
            <Label>سبب النفوق</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثال: مرض / حرارة / حادث" />
          </div>
          <div>
            <Label>ملاحظات</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={loadOnRemaining} onCheckedChange={(v) => setLoadOnRemaining(!!v)} />
            تحميل تكلفة النافق على باقي النعام الحي
          </label>

          {deadCount > 0 && (
            <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-1">
              <div>تكلفة النعامة قبل النفوق: <b>{fmt(cpb)}</b> ج.م</div>
              <div>إجمالي تكلفة النافق: <b className="text-destructive">{fmt(totalLoss)}</b> ج.م</div>
              <div>المتبقي حي: <b>{remaining}</b> نعامة</div>
              {loadOnRemaining && extraPerBird > 0 && (
                <div className="text-orange-700">
                  زيادة تكلفة كل نعامة باقية: <b>+{fmt(extraPerBird)}</b> ج.م
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={saving || deadCount <= 0 || deadCount > alive} variant="destructive">
            {saving ? "جاري الحفظ..." : "تسجيل النفوق"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default LiveBatchMortalityDialog;
