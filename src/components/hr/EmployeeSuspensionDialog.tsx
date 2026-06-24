import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Calculator, Printer, UserMinus, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { openPrintWindow } from "@/lib/printPdf";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  employee: {
    id: string;
    code: string;
    full_name: string;
    job_title: string | null;
    location_name?: string | null;
    base_salary: number;
    pay_day: number;
  };
  onDone?: () => void;
}

const DAYS_PER_MONTH = 30;

const EmployeeSuspensionDialog = ({ open, onOpenChange, employee, onDone }: Props) => {
  const { user, isGeneralManager, isExecutiveManager, roles } = useAuth();
  const canConfirm = isGeneralManager || isExecutiveManager || roles.includes("hr_manager");

  const today = new Date().toISOString().slice(0, 10);
  const [suspensionDate, setSuspensionDate] = useState(today);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [deductionsAmount, setDeductionsAmount] = useState(0);
  const [advancesAmount, setAdvancesAmount] = useState(0);
  const [missingDocs, setMissingDocs] = useState<{ id: boolean; contract: boolean } | null>(null);
  const [calculated, setCalculated] = useState(false);

  useEffect(() => {
    if (!open) {
      setSuspensionDate(today);
      setReason("");
      setNotes("");
      setCalculated(false);
      setDeductionsAmount(0);
      setAdvancesAmount(0);
    }
  }, [open]);

  const dailyValue = useMemo(
     () => (Number(employee.base_salary) || 0) / DAYS_PER_MONTH,
    [employee.base_salary]
  );

  const daysCount = useMemo(() => {
    if (!suspensionDate) return 0;
    const d = new Date(suspensionDate);
    return Math.max(0, Math.min(DAYS_PER_MONTH, d.getDate()));
  }, [suspensionDate]);

  const gross = useMemo(() => +(dailyValue * daysCount).toFixed(2), [dailyValue, daysCount]);
  const net = useMemo(
    () => Math.max(0, +(gross - deductionsAmount - advancesAmount).toFixed(2)),
    [gross, deductionsAmount, advancesAmount]
  );

  const calculate = async () => {
    if (!suspensionDate) {
      toast.error("أدخل تاريخ الإيقاف أولاً");
      return;
    }
    const d = new Date(suspensionDate);
    const month = d.getMonth() + 1;
    const year = d.getFullYear();

    // Approved deductions (month of suspension)
    const { data: ded } = await supabase
      .from("hr_deductions")
      .select("amount, deduction_type, status")
      .eq("employee_id", employee.id)
      .eq("status", "approved")
      .eq("month", month)
      .eq("year", year);

    let totalDed = 0;
    let totalAdv = 0;
    (ded || []).forEach((r: any) => {
      const amt = Number(r.amount) || 0;
      if (r.deduction_type === "advance_repayment") totalAdv += amt;
      else totalDed += amt;
    });
    setDeductionsAmount(totalDed);
    setAdvancesAmount(totalAdv);

    // Documents status
    const { data: docs } = await supabase.rpc("get_hr_documents_status");
    const row = (docs || []).find((x: any) => x.employee_id === employee.id);
    setMissingDocs(row ? { id: !!row.has_id, contract: !!row.has_contract } : { id: false, contract: false });

    setCalculated(true);
    toast.success("تم حساب المستحق");
  };

  const confirm = async () => {
    if (!canConfirm) {
      toast.error("ليس لديك صلاحية إيقاف الموظفين");
      return;
    }
    if (!reason.trim() || reason.trim().length < 3) {
      toast.error("سبب الإيقاف مطلوب");
      return;
    }
    if (!calculated) {
      toast.error("اضغط حساب المستحقات أولاً");
      return;
    }
    setSaving(true);
    try {
      const { error: insErr } = await supabase.from("hr_employee_suspensions").insert({
        employee_id: employee.id,
        action: "suspend",
        suspension_date: suspensionDate,
        reason: reason.trim(),
        notes: notes.trim() || null,
        base_salary: Number(employee.base_salary) || 0,
        daily_value: dailyValue,
        days_count: daysCount,
        gross_amount: gross,
        deductions_amount: deductionsAmount,
        advances_amount: advancesAmount,
        net_amount: net,
        performed_by: user?.id,
      });
      if (insErr) throw insErr;

      const { error: updErr } = await supabase
        .from("hr_employees")
        .update({
          is_suspended: true,
          suspension_date: suspensionDate,
          suspension_reason: reason.trim(),
          suspension_notes: notes.trim() || null,
          suspension_net_amount: net,
          suspended_by: user?.id,
          suspended_at: new Date().toISOString(),
        })
        .eq("id", employee.id);
      if (updErr) throw updErr;

      await supabase.from("hr_audit_log").insert({
        entity_type: "hr_employee",
        entity_id: employee.id,
        employee_id: employee.id,
        action: "suspend",
        after_data: {
          suspension_date: suspensionDate,
          reason: reason.trim(),
          net_amount: net,
        } as any,
        reason: reason.trim(),
        performed_by: user?.id,
      });

      toast.success(`تم إيقاف ${employee.full_name} عن العمل`);
      onDone?.();
      onOpenChange(false);
    } catch (e: any) {
      toast.error("فشل الإيقاف: " + (e?.message || "خطأ غير معروف"));
    } finally {
      setSaving(false);
    }
  };

  const print = () => {
    const fmt = (n: number) => n.toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const body = `
      <h1 style="text-align:center">إقرار إيقاف عن العمل / مخالصة مؤقتة</h1>
      <table class="info">
        <tr><th>اسم الموظف</th><td>${employee.full_name}</td><th>الكود</th><td>${employee.code}</td></tr>
        <tr><th>الوظيفة</th><td>${employee.job_title || "—"}</td><th>مكان العمل</th><td>${employee.location_name || "—"}</td></tr>
        <tr><th>تاريخ الإيقاف</th><td>${suspensionDate}</td><th>يوم الصرف</th><td>${employee.pay_day}</td></tr>
        <tr><th>السبب</th><td colspan="3">${reason || "—"}</td></tr>
        ${notes ? `<tr><th>ملاحظات</th><td colspan="3">${notes}</td></tr>` : ""}
      </table>

      <h2>تفاصيل المستحقات</h2>
      <table class="amounts">
        <tr><th>المرتب الأساسي</th><td>${fmt(Number(employee.base_salary) || 0)}</td></tr>
        <tr><th>قيمة اليوم (المرتب ÷ 30)</th><td>${fmt(dailyValue)}</td></tr>
        <tr><th>عدد الأيام المستحقة</th><td>${daysCount}</td></tr>
        <tr><th>إجمالي المستحق قبل الخصومات</th><td>${fmt(gross)}</td></tr>
        <tr><th>الخصومات</th><td>- ${fmt(deductionsAmount)}</td></tr>
        <tr><th>السلف / العهد</th><td>- ${fmt(advancesAmount)}</td></tr>
        <tr class="net"><th>صافي المستحق</th><td>${fmt(net)} ج.م</td></tr>
      </table>

      <div class="signatures">
        <div><div class="line"></div><div>توقيع الموظف</div></div>
        <div><div class="line"></div><div>توقيع الإدارة</div></div>
      </div>
    `;
    const css = `
      body { font-family: 'Cairo','Tajawal',sans-serif; direction: rtl; padding: 30px; }
      h1 { font-size: 20px; margin-bottom: 20px; }
      h2 { font-size: 14px; margin-top: 20px; border-bottom: 1px solid #333; padding-bottom: 4px; }
      table { width: 100%; border-collapse: collapse; margin-top: 8px; }
      th, td { border: 1px solid #999; padding: 8px; text-align: right; }
      table.info th { background: #f3f4f6; width: 18%; }
      table.amounts th { background: #f3f4f6; width: 60%; }
      tr.net th, tr.net td { background: #fde68a; font-weight: bold; font-size: 14px; }
      .signatures { display: flex; justify-content: space-around; margin-top: 60px; }
      .signatures > div { text-align: center; }
      .signatures .line { width: 200px; border-bottom: 1px solid #333; height: 40px; margin-bottom: 6px; }
    `;
    openPrintWindow(`إيقاف-${employee.code}`, body, css);
  };

  const fmt = (n: number) => n.toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserMinus className="w-5 h-5 text-rose-700" /> إيقاف الموظف عن العمل
          </DialogTitle>
          <DialogDescription>
            {employee.full_name} ({employee.code}) — {employee.job_title || "—"}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-1">
            <div className="flex justify-between"><span className="text-muted-foreground">المرتب الأساسي</span><span className="font-mono font-bold">{fmt(Number(employee.base_salary) || 0)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">يوم الصرف</span><Badge>يوم {employee.pay_day}</Badge></div>
            <div className="flex justify-between"><span className="text-muted-foreground">مكان العمل</span><span>{employee.location_name || "—"}</span></div>
          </div>
          <div>
            <Label>تاريخ الإيقاف عن العمل *</Label>
            <Input type="date" value={suspensionDate} onChange={(e) => { setSuspensionDate(e.target.value); setCalculated(false); }} />
          </div>
          <div className="md:col-span-2">
            <Label>سبب الإيقاف *</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثال: انتهاء العقد / إنذار نهائي / استقالة..." />
          </div>
          <div className="md:col-span-2">
            <Label>ملاحظات</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>

        <div className="flex gap-2 mt-2">
          <Button variant="outline" onClick={calculate}>
            <Calculator className="w-4 h-4 ml-1" /> حساب مستحقات الإيقاف
          </Button>
        </div>

        {calculated && (
          <div className="mt-3 rounded-lg border p-4 bg-amber-50 dark:bg-amber-950/20 space-y-2 text-sm">
            <h3 className="font-bold mb-2">ملخص المستحقات حتى {suspensionDate}</h3>
            <div className="grid grid-cols-2 gap-2">
              <Row label="عدد الأيام المستحقة" value={String(daysCount)} />
              <Row label="قيمة اليوم" value={fmt(dailyValue)} />
              <Row label="إجمالي المستحق قبل الخصومات" value={fmt(gross)} />
              <Row label="إجمالي الخصومات" value={`- ${fmt(deductionsAmount)}`} className="text-rose-700" />
              <Row label="إجمالي السلف / العهد" value={`- ${fmt(advancesAmount)}`} className="text-rose-700" />
              <Row label="صافي المستحق النهائي" value={`${fmt(net)} ج.م`} className="text-primary font-bold text-base" />
            </div>
            {missingDocs && (!missingDocs.id || !missingDocs.contract) && (
              <div className="flex items-start gap-2 text-amber-800 mt-2">
                <AlertTriangle className="w-4 h-4 mt-0.5" />
                <div>مستندات ناقصة: {!missingDocs.id && "بطاقة"} {!missingDocs.id && !missingDocs.contract && " / "}{!missingDocs.contract && "عقد"}</div>
              </div>
            )}
            {advancesAmount > 0 && (
              <div className="flex items-start gap-2 text-amber-800">
                <AlertTriangle className="w-4 h-4 mt-0.5" />
                <div>يوجد سلف/عهد مفتوحة بقيمة {fmt(advancesAmount)} — تم خصمها من الصافي.</div>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button variant="outline" onClick={print} disabled={!calculated}>
            <Printer className="w-4 h-4 ml-1" /> طباعة إقرار الإيقاف
          </Button>
          <Button onClick={confirm} disabled={saving || !canConfirm || !calculated} className="bg-rose-600 hover:bg-rose-700 text-white">
            {saving ? "جارٍ التنفيذ..." : "تأكيد الإيقاف"}
          </Button>
        </DialogFooter>

        {!canConfirm && (
          <p className="text-xs text-muted-foreground text-center">
            الإيقاف متاح للمدير العام والمدير التنفيذي ومسؤول الموارد البشرية فقط.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
};

const Row = ({ label, value, className = "" }: { label: string; value: string; className?: string }) => (
  <div className="flex justify-between border-b border-amber-200/60 py-1">
    <span className="text-muted-foreground">{label}</span>
    <span className={`font-mono ${className}`}>{value}</span>
  </div>
);

export default EmployeeSuspensionDialog;
