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
  billNo: string;
  missingId?: string | null;
  /** Pre-filled order number (e.g. the suggested candidate). */
  defaultOrderNumber?: string;
  onLinked?: () => void;
}

/**
 * Manual re-link: pick an internal order by its order number and bind
 * a Zodex bill to it (used from the Zodex review screen).
 */
export function LinkBillToOrderDialog({
  open, onOpenChange, billNo, missingId, defaultOrderNumber, onLinked,
}: Props) {
  const [orderNo, setOrderNo] = useState(defaultOrderNumber || "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const clean = orderNo.trim();
    if (!clean) {
      toast.error("اكتب رقم الأوردر");
      return;
    }
    setSaving(true);
    try {
      const { data: order, error: findErr } = await supabase
        .from("orders")
        .select("id, order_number, shipping_bill_no")
        .ilike("order_number", clean)
        .maybeSingle();
      if (findErr) throw findErr;
      if (!order?.id) {
        toast.error("مفيش أوردر بالرقم ده");
        setSaving(false);
        return;
      }
      if (order.shipping_bill_no && order.shipping_bill_no !== billNo) {
        toast.error(`الأوردر ده مربوط ببوليصة تانية: ${order.shipping_bill_no}`);
        setSaving(false);
        return;
      }

      const { data, error } = await supabase.rpc("link_zodex_bill_to_order", {
        p_bill_no: billNo,
        p_order_id: order.id,
        p_missing_id: missingId ?? null,
        p_match_score: 100,
        p_match_reason: "[ربط يدوي من شاشة مراجعة زودكس]",
      });
      if (error) throw error;
      const res = data as any;
      if (res && res.ok === false) throw new Error(res.error || "فشل الربط");

      toast.success(`تم ربط ${billNo} بالأوردر ${order.order_number}`);
      onOpenChange(false);
      onLinked?.();
    } catch (e: any) {
      toast.error(`فشل الربط: ${e.message || e}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>إعادة ربط البوليصة بأوردر</DialogTitle>
          <DialogDescription>
            البوليصة <b dir="ltr">{billNo}</b> — اكتب رقم الأوردر اللي هيتربط بيها.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label>رقم الأوردر</Label>
          <Input
            value={orderNo}
            onChange={(e) => setOrderNo(e.target.value)}
            placeholder="ORD-20260726-123456"
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
            ربط
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default LinkBillToOrderDialog;
