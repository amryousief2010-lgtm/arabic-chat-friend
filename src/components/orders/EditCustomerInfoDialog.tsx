import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import GovernorateSelect from "@/components/shared/GovernorateSelect";
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
  const [phone2, setPhone2] = useState("");
  const [email, setEmail] = useState("");
  const [governorate, setGovernorate] = useState("");
  const [city, setCity] = useState("");
  const [area, setArea] = useState("");
  const [notes, setNotes] = useState("");
  const [address, setAddress] = useState(initialAddress || "");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [applyToCustomer, setApplyToCustomer] = useState(true);

  useEffect(() => {
    if (!open) return;
    setName(initialName || "");
    setPhone(initialPhone || "");
    setAddress(initialAddress || "");
    setApplyToCustomer(true);
    setPhone2("");
    setEmail("");
    setGovernorate("");
    setCity("");
    setArea("");
    setNotes("");

    // تحميل كل بيانات العميل المسجلة حتى تظهر جاهزة للتعديل
    if (!customerId) return;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("customers")
        .select("name, phone, phone2, email, governorate, city, area, address, notes")
        .eq("id", customerId)
        .maybeSingle();
      setLoading(false);
      if (error || !data) return;
      setName(data.name || initialName || "");
      setPhone(data.phone || initialPhone || "");
      setPhone2(data.phone2 || "");
      setEmail(data.email || "");
      setGovernorate(data.governorate || "");
      setCity(data.city || "");
      setArea(data.area || "");
      setNotes(data.notes || "");
      setAddress(initialAddress || data.address || "");
    })();
  }, [open, customerId, initialName, initialPhone, initialAddress]);

  const save = async () => {
    const cleanName = name.trim();
    const cleanPhone = phone.trim();
    if (!cleanName) return toast.error("اسم العميل مطلوب");
    if (!cleanPhone) return toast.error("رقم الهاتف مطلوب");

    setSaving(true);
    try {
      const orderPatch: any = {
        delivery_address: address.trim() || null,
      };
      const { error: oErr } = await supabase.from("orders").update(orderPatch).eq("id", orderId);
      if (oErr) throw oErr;

      if (applyToCustomer && customerId) {
        const { error: cErr } = await supabase
          .from("customers")
          .update({
            name: cleanName,
            phone: cleanPhone,
            phone2: phone2.trim() || null,
            email: email.trim() || null,
            governorate: governorate.trim() || null,
            city: city.trim() || null,
            area: area.trim() || null,
            address: address.trim() || null,
            notes: notes.trim() || null,
          })
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
      <DialogContent dir="rtl" className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>تعديل بيانات العميل</DialogTitle>
        </DialogHeader>
        {loading ? (
          <p className="text-sm text-muted-foreground py-6 text-center">جارِ تحميل بيانات العميل…</p>
        ) : (
          <div className="space-y-3">
            <div>
              <Label>اسم العميل *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>رقم الهاتف *</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" className="font-mono" />
              </div>
              <div>
                <Label>رقم هاتف إضافي</Label>
                <Input
                  value={phone2}
                  onChange={(e) => setPhone2(e.target.value)}
                  dir="ltr"
                  className="font-mono"
                  placeholder="اختياري"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>المحافظة</Label>
                <GovernorateSelect value={governorate} onChange={setGovernorate} />
              </div>
              <div>
                <Label>المدينة</Label>
                <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="اختياري" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>المنطقة</Label>
                <Input value={area} onChange={(e) => setArea(e.target.value)} placeholder="اختياري" />
              </div>
              <div>
                <Label>البريد الإلكتروني</Label>
                <Input value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" placeholder="اختياري" />
              </div>
            </div>
            <div>
              <Label>العنوان</Label>
              <Textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={3} />
            </div>
            <div>
              <Label>ملاحظات العميل</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="اختياري" />
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
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button onClick={save} disabled={saving || loading}>{saving ? "جارِ الحفظ..." : "حفظ"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
