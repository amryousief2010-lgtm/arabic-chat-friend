import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called with the new customer { id, name, customer_type } after successful save. */
  onCreated: (customer: { id: string; name: string; customer_type: string }) => void;
  /** Existing customers list — for client-side duplicate check. */
  existing?: Array<{ id: string; name: string; phone?: string | null }>;
}

export default function QuickAddHatchCustomerDialog({ open, onClose, onCreated, existing = [] }: Props) {
  const { profile, user } = useAuth();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [customerType, setCustomerType] = useState<"external" | "internal">("external");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setName(""); setPhone(""); setAddress(""); setCustomerType("external"); setNotes("");
  };

  const close = () => { reset(); onClose(); };

  const findDuplicate = () => {
    const nm = name.trim().toLowerCase();
    const ph = phone.trim();
    return existing.find((c) =>
      (nm && c.name?.trim().toLowerCase() === nm) ||
      (ph && (c.phone || "").trim() === ph)
    );
  };

  const save = async () => {
    if (!name.trim()) return toast.error("اسم العميل مطلوب");
    if (saving) return;

    const dup = findDuplicate();
    if (dup) {
      const useExisting = window.confirm(`هذا العميل موجود بالفعل: "${dup.name}"\n\nاضغط موافق لاستخدامه أو إلغاء للعودة.`);
      if (useExisting) {
        onCreated({ id: dup.id, name: dup.name, customer_type: "external" });
        close();
      }
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase
        .from("hatch_customers" as any)
        .insert({
          name: name.trim(),
          phone: phone.trim() || null,
          address: address.trim() || null,
          customer_type: customerType,
          notes: notes.trim() || null,
          is_active: true,
        })
        .select("id, name, customer_type")
        .single();
      if (error) {
        // Postgres unique violation? fall through.
        if ((error as any).code === "23505") {
          toast.error("هذا العميل موجود بالفعل");
        } else {
          toast.error(error.message);
        }
        return;
      }

      // Audit log (best-effort — silent if it fails)
      await supabase.from("hatch_batch_edit_audit" as any).insert({
        batch_id: null,
        batch_number: null,
        customer_id: (data as any).id,
        customer_name: (data as any).name,
        actor_id: user?.id ?? null,
        actor_name: profile?.full_name || user?.email || null,
        changes: {
          action: "customer_quick_added",
          source: "hatchery_batch_customer_quick_add",
          phone: phone.trim() || null,
          address: address.trim() || null,
          customer_type: customerType,
        },
        reason: "إضافة عميل جديد من داخل شاشة الدفعة",
      }).then(() => {}, () => {});

      toast.success("تم إضافة العميل بنجاح");
      onCreated(data as any);
      close();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-purple-600" />
            إضافة عميل معمل جديد
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">اسم العميل *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">رقم الهاتف</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01xxxxxxxxx" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">نوع العميل</Label>
              <Select value={customerType} onValueChange={(v) => setCustomerType(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="external">عميل خارجي</SelectItem>
                  <SelectItem value="internal">نعام العاصمة / داخلي</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">العنوان / المنطقة</Label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">ملاحظات</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={close} disabled={saving}>إلغاء</Button>
          <Button onClick={save} disabled={saving} className="bg-purple-600 hover:bg-purple-700">
            {saving ? "جاري الحفظ…" : "حفظ العميل"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
