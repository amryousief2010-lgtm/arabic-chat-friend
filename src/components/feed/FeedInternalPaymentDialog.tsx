import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

export type Department = "brooding" | "slaughterhouse" | "mother_farm";

const DEPT_LABEL: Record<Department, string> = {
  brooding: "حضانات التسمين",
  slaughterhouse: "مخزن علف المجزر",
  mother_farm: "مزرعة الأمهات",
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  department: Department;
  lockDepartment?: boolean;
  remainingDebt?: number;
  onSaved?: () => void;
}

const PAYMENT_METHODS = [
  { v: "cash", l: "نقدي" },
  { v: "vodafone_cash", l: "فودافون كاش" },
  { v: "instapay", l: "إنستا باي" },
  { v: "bank_transfer", l: "تحويل بنكي" },
  { v: "internal_settlement", l: "تسوية داخلية" },
];

export default function FeedInternalPaymentDialog({ open, onOpenChange, department, lockDepartment, remainingDebt, onSaved }: Props) {
  const { user, roles } = useAuth() as any;
  const [dept, setDept] = useState<Department>(department);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [ref, setRef] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const isOverride = (roles || []).some((r: string) => ["general_manager", "executive_manager"].includes(r));

  const handleSave = async () => {
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      toast.error("ادخل مبلغ صحيح");
      return;
    }
    if (remainingDebt !== undefined && amt > remainingDebt && !isOverride) {
      toast.error("المبلغ أكبر من المديونية المتبقية. يحتاج اعتماد مدير عام/تنفيذي.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("feed_internal_payments" as any).insert({
      department_type: dept,
      amount: amt,
      payment_method: method,
      payment_date: date,
      reference_no: ref || null,
      notes: notes || null,
      created_by: user?.id || null,
      status: "pending",
    });
    setSaving(false);
    if (error) {
      toast.error("فشل تسجيل السداد: " + error.message);
      return;
    }
    toast.success("تم تسجيل السداد — بانتظار الاعتماد");
    setAmount(""); setRef(""); setNotes("");
    onOpenChange(false);
    onSaved?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl">
        <DialogHeader>
          <DialogTitle>تسجيل سداد لمصنع العلف</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>القسم المسدد</Label>
            <Select value={dept} onValueChange={(v) => setDept(v as Department)} disabled={lockDepartment}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="brooding">حضانات التسمين</SelectItem>
                <SelectItem value="slaughterhouse">مخزن علف المجزر</SelectItem>
                <SelectItem value="mother_farm">مزرعة الأمهات</SelectItem>
              </SelectContent>
            </Select>
            {dept === "mother_farm" && (
              <p className="text-xs text-muted-foreground mt-1">سيُسجَّل السداد من خزنة المعمل عند الاعتماد.</p>
            )}
          </div>
          {remainingDebt !== undefined && (
            <div className="text-sm text-muted-foreground">
              المديونية المتبقية: <b className="text-foreground">{remainingDebt.toLocaleString("ar-EG")} ج.م</b>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>المبلغ</Label>
              <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <Label>تاريخ السداد</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>طريقة السداد</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((m) => <SelectItem key={m.v} value={m.v}>{m.l}</SelectItem>)}
              </SelectContent>
            </Select>
            {method === "internal_settlement" && (
              <p className="text-xs text-amber-700 mt-1">تسوية داخلية — لن يدخل مبلغ نقدي لخزنة المصنع.</p>
            )}
          </div>
          <div>
            <Label>رقم إيصال / مرجع</Label>
            <Input value={ref} onChange={(e) => setRef(e.target.value)} />
          </div>
          <div>
            <Label>ملاحظات</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button onClick={handleSave} disabled={saving}>تسجيل السداد</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
