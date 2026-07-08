import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  order: { id: string; order_number: string; shipping_bill_no?: string | null };
  onLinked?: () => void;
}

function normalizeBill(s: string) {
  return String(s || "").trim().toUpperCase().replace(/\s+/g, "");
}

export function RelinkBillDialog({ open, onOpenChange, order, onLinked }: Props) {
  const [bill, setBill] = useState(order.shipping_bill_no || "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const clean = normalizeBill(bill);
    if (!/^ZX\d{4,}$/i.test(clean)) {
      toast.error("رقم البوليصة لازم يبدأ بـ ZX متبوعًا بأرقام");
      return;
    }
    setSaving(true);
    try {
      // Ensure no other order already owns this bill
      const { data: dupe } = await supabase
        .from("orders")
        .select("id, order_number")
        .eq("shipping_bill_no", clean)
        .neq("id", order.id)
        .maybeSingle();
      if (dupe?.id) {
        toast.error(`الرقم ده متسجل على أوردر تاني: ${dupe.order_number}`);
        setSaving(false);
        return;
      }
      const { error } = await supabase
        .from("orders")
        .update({ shipping_bill_no: clean })
        .eq("id", order.id);
      if (error) throw error;

      // audit
      const { data: userData } = await supabase.auth.getUser();
      await supabase.from("zodex_bill_link_audit").insert({
        bill_no: clean,
        order_id: order.id,
        linked_by: userData?.user?.id,
        match_reason: "manual_relink",
        previous_bill_no: order.shipping_bill_no || null,
      });

      toast.success(`تم ربط ${clean} بأوردر ${order.order_number}`);
      onOpenChange(false);
      onLinked?.();
    } catch (e: any) {
      toast.error(`فشل الحفظ: ${e.message || e}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>ربط بوليصة يدوي</DialogTitle>
          <DialogDescription>
            أوردر <b>{order.order_number}</b> — ادخل رقم البوليصة من زودكس (يبدأ بـ ZX).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label>رقم البوليصة</Label>
          <Input
            value={bill}
            onChange={(e) => setBill(e.target.value)}
            placeholder="ZX80418582"
            autoFocus
            dir="ltr"
          />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            إلغاء
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin ml-1" />}
            حفظ الربط
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
