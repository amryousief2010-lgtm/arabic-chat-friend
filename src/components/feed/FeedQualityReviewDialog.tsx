import { useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

const QC_ROLES = [
  "general_manager","executive_manager","quality_manager","quality_inspector",
  "feed_factory_manager","feed_factory_supervisor",
];

interface Props {
  batchId: string | null;
  batchNumber?: string;
  open: boolean;
  onClose: () => void;
  onDone?: () => void;
}

export const FeedQualityReviewDialog = ({ batchId, batchNumber, open, onClose, onDone }: Props) => {
  const { role } = useAuth();
  const canDecide = !!role && QC_ROLES.includes(role);
  const [result, setResult] = useState<"passed" | "rework" | "rejected">("passed");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!batchId) return;
    if (!canDecide) { toast.error("غير مصرح لك بتسجيل فحص الجودة"); return; }
    setSaving(true);
    const { error } = await supabase.from("feed_qc_checks" as any).insert({
      batch_id: batchId, result, variance_reason: reason || null, notes: notes || null,
    });
    setSaving(false);
    if (error) { toast.error("فشل التسجيل: " + error.message); return; }
    toast.success("✅ تم تسجيل قرار فحص الجودة");
    setReason(""); setNotes(""); setResult("passed");
    onDone?.();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>فحص الجودة — دفعة {batchNumber}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>القرار</Label>
            <Select value={result} onValueChange={(v: any) => setResult(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="passed">مقبولة</SelectItem>
                <SelectItem value="rework">إعادة معالجة</SelectItem>
                <SelectItem value="rejected">مرفوضة</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>سبب الانحراف (اختياري)</Label>
            <Textarea rows={2} value={reason} onChange={e => setReason(e.target.value)} />
          </div>
          <div>
            <Label>ملاحظات</Label>
            <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
          <Button onClick={submit} disabled={saving || !canDecide}>
            {saving ? "جارٍ الحفظ..." : "حفظ القرار"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default FeedQualityReviewDialog;
