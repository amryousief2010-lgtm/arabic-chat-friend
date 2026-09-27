import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
  onSaved?: (newBill: string) => void;
}

function arabicWaybillError(message: string): string {
  const m = message || "";
  if (m.includes("EMPTY_BILL")) return "أدخل رقم البوليصة";
  if (m.includes("DUPLICATE_WAYBILL") || m.includes("23505")) return "رقم البوليصة مستخدم في طلب آخر";
  if (m.includes("NOT_AUTHORIZED") || m.includes("NOT_ALLOWED_GOVERNORATE") || m.includes("ORDER_NOT_FOUND")) {
    return "غير مسموح";
  }
  return "تعذر حفظ رقم البوليصة";
}

export function ManualWaybillDialog({ open, onOpenChange, order, onSaved }: Props) {
  const queryClient = useQueryClient();
  const [bill, setBill] = useState(order.shipping_bill_no || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setBill(order.shipping_bill_no || "");
  }, [open, order.id, order.shipping_bill_no]);

  const save = async () => {
    const clean = bill.trim();
    if (!clean) {
      toast.error("أدخل رقم البوليصة");
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc("set_order_waybill_manual", {
        p_order_id: order.id,
        p_bill_no: clean,
      });
      if (error) throw error;
      const next = (data as { new_bill_no?: string } | null)?.new_bill_no || clean;
      onSaved?.(next);
      await queryClient.invalidateQueries();
      toast.success("تم حفظ رقم البوليصة");
      onOpenChange(false);
    } catch (e: any) {
      toast.error(arabicWaybillError(`${e?.code || ""} ${e?.message || e || ""}`));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle>{order.shipping_bill_no ? "تعديل البوليصة" : "إدخال بوليصة"}</DialogTitle>
          <DialogDescription>طلب {order.order_number}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="manual-waybill">رقم البوليصة</Label>
          <Input
            id="manual-waybill"
            value={bill}
            onChange={(e) => setBill(e.target.value)}
            dir="ltr"
            autoComplete="off"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>إلغاء</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ManualWaybillDialog;
