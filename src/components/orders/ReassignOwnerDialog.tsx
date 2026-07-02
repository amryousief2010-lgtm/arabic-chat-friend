import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  orderId: string;
  orderNumber: string;
  currentOwnerId: string | null;
  currentOwnerName: string;
  onDone?: () => void;
}

interface Candidate {
  id: string;
  name: string;
}

export default function ReassignOwnerDialog({
  open,
  onOpenChange,
  orderId,
  orderNumber,
  currentOwnerId,
  currentOwnerName,
  onDone,
}: Props) {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [newOwnerId, setNewOwnerId] = useState<string>("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setNewOwnerId("");
    setReason("");
    (async () => {
      setLoading(true);
      // Users with a sales role
      const { data: roleRows, error: rErr } = await supabase
        .from("user_roles")
        .select("user_id, role")
        .in("role", ["sales_moderator", "sales_manager", "marketing_sales_manager"]);
      if (rErr) {
        toast.error("تعذر تحميل قائمة المسوقات");
        setLoading(false);
        return;
      }
      const ids = Array.from(new Set((roleRows || []).map((r: any) => r.user_id)));
      if (ids.length === 0) {
        setCandidates([]);
        setLoading(false);
        return;
      }
      const { data: profiles } = await supabase
        .from("profile_directory")
        .select("id, full_name")
        .in("id", ids);
      const list: Candidate[] = (profiles || [])
        .map((p: any) => ({ id: p.id, name: p.full_name }))
        .filter((c) => c.id !== currentOwnerId)
        .sort((a, b) => a.name.localeCompare(b.name, "ar"));
      setCandidates(list);
      setLoading(false);
    })();
  }, [open, currentOwnerId]);

  const handleSubmit = async () => {
    if (!newOwnerId) {
      toast.error("اختر المسؤولة الجديدة");
      return;
    }
    if (reason.trim().length < 3) {
      toast.error("يجب كتابة سبب التغيير");
      return;
    }
    setSaving(true);
    const { error } = await supabase.rpc("reassign_order_owner", {
      p_order_id: orderId,
      p_new_owner_id: newOwnerId,
      p_reason: reason.trim(),
    });
    setSaving(false);
    if (error) {
      const msg = error.message || "";
      if (msg.includes("insufficient_privilege"))
        toast.error("ليس لديك صلاحية نقل الأوردر");
      else if (msg.includes("same_owner"))
        toast.error("المسؤولة الجديدة هي نفس الحالية");
      else if (msg.includes("invalid_new_owner_role"))
        toast.error("المستخدم المختار ليس ضمن فريق المبيعات");
      else if (msg.includes("reason_required"))
        toast.error("يجب كتابة سبب التغيير");
      else toast.error("تعذر نقل الأوردر: " + msg);
      return;
    }
    toast.success("تم نقل الأوردر إلى المسؤولة الجديدة");
    onOpenChange(false);
    onDone?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle>نقل الأوردر {orderNumber} لمسوقة أخرى</DialogTitle>
          <DialogDescription>
            يتم فقط تغيير المسوقة المسؤولة عن الأوردر (تارجت المبيعات). لا تتغير
            بيانات العميل ولا قيمة الأوردر ولا التحصيل ولا المخزون.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="text-sm">
            <span className="text-muted-foreground">المسؤولة الحالية: </span>
            <span className="font-semibold">{currentOwnerName || "غير محدد"}</span>
          </div>

          <div className="space-y-1.5">
            <Label>المسؤولة الجديدة</Label>
            <Select value={newOwnerId} onValueChange={setNewOwnerId} disabled={loading}>
              <SelectTrigger>
                <SelectValue placeholder={loading ? "جارِ التحميل..." : "اختر المسوقة"} />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>سبب التغيير</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="مثال: تصحيح تسجيل الأوردر"
              rows={3}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            إلغاء
          </Button>
          <Button onClick={handleSubmit} disabled={saving || loading}>
            {saving ? "جارٍ النقل..." : "نقل الأوردر"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
