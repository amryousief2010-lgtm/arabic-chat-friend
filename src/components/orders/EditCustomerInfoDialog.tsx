import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  orderId: string;
  customerId: string | null;
  initialName: string;
  initialPhone: string;
  initialAddress: string | null;
  onSaved?: (next: { customer_name: string; customer_phone: string; delivery_address: string | null }) => void;
}

export default function EditCustomerInfoDialog({
  open,
  onOpenChange,
  orderId,
  customerId,
  initialName,
  initialPhone,
  initialAddress,
  onSaved,
}: Props) {
  const [name, setName] = useState(initialName || "");
  const [phone, setPhone] = useState(initialPhone || "");
  const [address, setAddress] = useState(initialAddress || "");
  const [saving, setSaving] = useState(false);
  const [applyToCustomer, setApplyToCustomer] = useState(true);

  useEffect(() => {
    if (!open) return;
    setName(initialName || "");
    setPhone(initialPhone || "");
    setAddress(initialAddress || "");
    setApplyToCustomer(true);
  }, [open, initialName, initialPhone, initialAddress]);

  const save = async () => {
    const cleanName = name.trim();
    const cleanPhone = phone.trim();
    if (!cleanName) return toast.error("اسم العميل مطلوب");
    if (!cleanPhone) return toast.error("رقم الهاتف مطلوب");

    setSaving(true);
    try {
      const orderPatch: any = {
        customer_name: cleanName,
        customer_phone: cleanPhone,
        delivery_address: address.trim() || null,
      };
      const { error: oErr } = await supabase.from("orders").update(orderPatch).eq("id", orderId);
      if (oErr) throw oErr;

      if (applyToCustomer && customerId) {
        const { error: cErr } = await supabase
          .from("customers")
          .update({ name: cleanName, phone: cleanPhone, address: address.trim() || null })
          .eq("id", customerId);
        if (cErr) throw cErr;
      }

      toast.success("تم تحديث بيانات العميل");
      onSaved?.({
        customer_name: cleanName,
        customer_phone: cleanPhone,
        delivery_address: orderPatch.delivery_address,
      });
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message || "تعذّر حفظ التعديلات");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl">
        <DialogHeader>
          <DialogTitle>تعديل بيانات العميل</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>اسم العميل *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label>رقم الهاتف *</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" className="font-mono" />
          </div>
          <div>
            <Label>العنوان</Label>
            <Textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={3} />
          </div>
          {customerId && (
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={applyToCustomer}
                onChange={(e) => setApplyToCustomer(e.target.checked)}
              />
              <span>تحديث بيانات العميل في سجل العملاء أيضًا</span>
            </label>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button onClick={save} disabled={saving}>{saving ? "جارِ الحفظ..." : "حفظ"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
