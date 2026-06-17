import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MinusCircle, Plus, Search, Check, X, Trash2, Printer, FileSpreadsheet, Edit } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { openPrintWindow } from "@/lib/printPdf";

interface Employee { id: string; code: string; full_name: string; department: string | null; base_salary?: number | null; }

type DeductionType = "absence"|"late"|"penalty"|"damages"|"advance_repayment"|"administrative"|"days_deduction"|"other";
type Status = "pending"|"approved"|"rejected";

interface Deduction {
  id: string;
  employee_id: string;
  deduction_date: string;
  month: number;
  year: number;
  deduction_type: DeductionType;
  amount: number;
  reason: string | null;
  notes: string | null;
  status: Status;
  reference_id: string | null;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  created_at: string;
  days_count?: number | null;
  daily_value?: number | null;
  days_per_month?: number | null;
  monthly_salary_snapshot?: number | null;
}

const typeLabel: Record<DeductionType, string> = {
  absence: "غياب",
  late: "تأخير",
  penalty: "جزاء",
  damages: "تلفيات",
  advance_repayment: "سلفة تخصم من الراتب",
  administrative: "خصم إداري",
  days_deduction: "خصم أيام",
  other: "أخرى",
};

const statusLabel: Record<Status, string> = { pending: "بانتظار الاعتماد", approved: "معتمد", rejected: "مرفوض" };
const statusColor: Record<Status, string> = {
  pending: "bg-amber-500/15 text-amber-700",
  approved: "bg-emerald-500/15 text-emerald-700",
  rejected: "bg-rose-500/15 text-rose-700",
};

const DEFAULT_DAYS_PER_MONTH = 30;

const now = new Date();
const blankForm = () => ({
  employee_id: "",
  deduction_date: now.toISOString().slice(0, 10),
  month: now.getMonth() + 1,
  year: now.getFullYear(),
  deduction_type: "administrative" as DeductionType,
  amount: 0,
  reason: "",
  notes: "",
  days_count: 0,
  days_per_month: DEFAULT_DAYS_PER_MONTH,
});

// Mohamed Shaala — sole authorized recorder for HR deductions/attendance
const MOHAMED_SHAALA_ID = "d1d37093-182a-4ee9-932c-d2a2b45f33ec";

const HRDeductions = () => {
  const { user, isGeneralManager, isExecutiveManager, roles } = useAuth();
  const isMohamedShaala = user?.id === MOHAMED_SHAALA_ID;
  const canRecord = isMohamedShaala || isGeneralManager || isExecutiveManager;
  const canApprove = isGeneralManager || isExecutiveManager;

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [deductions, setDeductions] = useState<Deduction[]>([]);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState("");
  const [fEmp, setFEmp] = useState<string>("all");
  const [fDept, setFDept] = useState<string>("all");
  const [fType, setFType] = useState<string>("all");
  const [fStatus, setFStatus] = useState<string>("all");
  const [fMonth, setFMonth] = useState<string>("all");
  const [fYear, setFYear] = useState<string>(String(now.getFullYear()));
  const [fFrom, setFFrom] = useState<string>("");
  const [fTo, setFTo] = useState<string>("");

  // Dialog
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Deduction | null>(null);
  const [form, setForm] = useState(blankForm());
  const [saving, setSaving] = useState(false);

  // Reject
  const [rejectOf, setRejectOf] = useState<Deduction | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const load = async () => {
    setLoading(true);
    const [emp, ded] = await Promise.all([
      supabase.from("hr_employees").select("id, code, full_name, department, base_salary").order("full_name"),
      supabase.from("hr_deductions").select("*").order("deduction_date", { ascending: false }).limit(2000),
    ]);
    setEmployees((emp.data || []) as Employee[]);
    setDeductions((ded.data || []) as Deduction[]);

    const userIds = new Set<string>();
    (ded.data || []).forEach((d: any) => {
      if (d.created_by) userIds.add(d.created_by);
      if (d.approved_by) userIds.add(d.approved_by);
      if (d.rejected_by) userIds.add(d.rejected_by);
    });
    if (userIds.size > 0) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", Array.from(userIds));
      const map: Record<string, string> = {};
      (profs || []).forEach((p: any) => { map[p.id] = p.full_name || "—"; });
      setProfiles(map);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const empById = useMemo(() => {
    const m = new Map<string, Employee>();
    employees.forEach((e) => m.set(e.id, e));
    return m;
  }, [employees]);

  const departments = useMemo(() => {
    const s = new Set<string>();
    employees.forEach((e) => e.department && s.add(e.department));
    return Array.from(s).sort();
  }, [employees]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return deductions.filter((d) => {
      const emp = empById.get(d.employee_id);
      if (fEmp !== "all" && d.employee_id !== fEmp) return false;
      if (fDept !== "all" && (emp?.department || "") !== fDept) return false;
      if (fType !== "all" && d.deduction_type !== fType) return false;
      if (fStatus !== "all" && d.status !== fStatus) return false;
      if (fMonth !== "all" && d.month !== Number(fMonth)) return false;
      if (fYear !== "all" && d.year !== Number(fYear)) return false;
      if (fFrom && d.deduction_date < fFrom) return false;
      if (fTo && d.deduction_date > fTo) return false;
      if (!q) return true;
      return (
        emp?.full_name.toLowerCase().includes(q) ||
        emp?.code.toLowerCase().includes(q) ||
        (d.reason || "").toLowerCase().includes(q)
      );
    });
  }, [deductions, search, fEmp, fDept, fType, fStatus, fMonth, fYear, fFrom, fTo, empById]);

  const totals = useMemo(() => {
    const t = { count: filtered.length, pending: 0, approved: 0, rejected: 0, total: 0 };
    filtered.forEach((d) => {
      const a = Number(d.amount || 0);
      t.total += a;
      if (d.status === "pending") t.pending += a;
      else if (d.status === "approved") t.approved += a;
      else if (d.status === "rejected") t.rejected += a;
    });
    return t;
  }, [filtered]);

  const openCreate = () => {
    if (!canRecord) return;
    setEditing(null);
    setForm(blankForm());
    setOpen(true);
  };

  const openEdit = (d: Deduction) => {
    if (!canRecord) return;
    if (d.status === "approved") {
      toast.error("لا يمكن تعديل خصم معتمد");
      return;
    }
    setEditing(d);
    setForm({
      employee_id: d.employee_id,
      deduction_date: d.deduction_date,
      month: d.month,
      year: d.year,
      deduction_type: d.deduction_type,
      amount: Number(d.amount),
      reason: d.reason || "",
      notes: d.notes || "",
      days_count: Number(d.days_count || 0),
      days_per_month: Number(d.days_per_month || DEFAULT_DAYS_PER_MONTH),
    });
    setOpen(true);
  };

  const selectedEmp = useMemo(() => empById.get(form.employee_id), [empById, form.employee_id]);
  const empSalary = Number(selectedEmp?.base_salary || 0);
  const isDays = form.deduction_type === "days_deduction";
  const dailyValue = isDays && form.days_per_month > 0 ? empSalary / form.days_per_month : 0;
  const computedDaysAmount = isDays ? +(dailyValue * (form.days_count || 0)).toFixed(2) : 0;

  const save = async () => {
    if (!canRecord) return;
    if (!form.employee_id) return toast.error("اختر الموظف");
    if (!form.deduction_type) return toast.error("اختر نوع الخصم");

    let finalAmount = form.amount;
    let daysCount: number | null = null;
    let dailyVal: number | null = null;
    let daysPerMonth: number | null = null;
    let salarySnapshot: number | null = null;

    if (isDays) {
      if (!empSalary || empSalary <= 0) {
        return toast.error("لا يمكن حساب خصم الأيام لأن راتب الموظف غير مسجل");
      }
      if (!form.days_per_month || form.days_per_month <= 0) {
        return toast.error("عدد أيام الشهر يجب أن يكون أكبر من صفر");
      }
      if (!form.days_count || form.days_count <= 0) {
        return toast.error("عدد الأيام المخصومة يجب أن يكون أكبر من صفر");
      }
      if (form.days_count > form.days_per_month) {
        return toast.error("عدد الأيام المخصومة لا يمكن أن يتجاوز عدد أيام الشهر");
      }
      finalAmount = computedDaysAmount;
      daysCount = form.days_count;
      dailyVal = +dailyValue.toFixed(4);
      daysPerMonth = form.days_per_month;
      salarySnapshot = empSalary;
    } else {
      if (!finalAmount || finalAmount <= 0) return toast.error("أدخل مبلغ صحيح");
    }

    setSaving(true);
    try {
      const refId = `employee_deduction_${form.employee_id}_${form.deduction_date}_${finalAmount}_${form.deduction_type}${isDays ? `_${daysCount}d` : ""}`;

      // Soft duplicate warning (same employee/month/type/reason/days)
      if (!editing) {
        const dupSimilar = deductions.find(
          (x) =>
            x.employee_id === form.employee_id &&
            x.month === form.month &&
            x.year === form.year &&
            x.deduction_type === form.deduction_type &&
            (x.reason || "") === (form.reason || "") &&
            (isDays ? Number(x.days_count || 0) === Number(daysCount) : true) &&
            x.status !== "rejected"
        );
        if (dupSimilar) {
          if (!confirm("يوجد خصم مشابه لهذا الموظف في نفس الشهر — هل تريد المتابعة؟")) {
            setSaving(false);
            return;
          }
        }
      }

      const payload: any = {
        employee_id: form.employee_id,
        deduction_date: form.deduction_date,
        month: form.month,
        year: form.year,
        deduction_type: form.deduction_type,
        amount: finalAmount,
        reason: form.reason || null,
        notes: form.notes || null,
        days_count: daysCount,
        daily_value: dailyVal,
        days_per_month: daysPerMonth,
        monthly_salary_snapshot: salarySnapshot,
      };

      if (editing) {
        const { error } = await supabase.from("hr_deductions").update(payload).eq("id", editing.id);
        if (error) throw error;
        await supabase.from("hr_audit_log").insert({
          entity_type: "hr_deduction",
          entity_id: editing.id,
          employee_id: form.employee_id,
          action: "update",
          before_data: editing as any,
          after_data: payload,
          performed_by: user?.id,
          reason: "تعديل خصم",
        });
        toast.success("تم تحديث الخصم");
      } else {
        const { data, error } = await supabase
          .from("hr_deductions")
          .insert({ ...payload, status: "pending", reference_id: refId, created_by: user?.id })
          .select()
          .single();
        if (error) throw error;
        await supabase.from("hr_audit_log").insert({
          entity_type: "hr_deduction",
          entity_id: (data as any).id,
          employee_id: form.employee_id,
          action: "create",
          after_data: data as any,
          performed_by: user?.id,
          reason: isDays
            ? `تسجيل خصم أيام (${daysCount} يوم × ${dailyVal} = ${finalAmount})`
            : `تسجيل خصم ${typeLabel[form.deduction_type]}`,
        });
        toast.success("تم تسجيل الخصم بحالة بانتظار الاعتماد");
      }
      setOpen(false);
      await load();
    } catch (e: any) {
      const msg = e?.message || "خطأ";
      if (msg.includes("hr_deductions_reference_id_key") || msg.includes("duplicate key")) {
        toast.error("هذا الخصم مسجل بالفعل (نفس الموظف/التاريخ/المبلغ/النوع)");
      } else {
        toast.error("فشل الحفظ: " + msg);
      }
    } finally {
      setSaving(false);
    }
  };

  const approve = async (d: Deduction) => {
    if (!canApprove) return;
    const { error } = await supabase
      .from("hr_deductions")
      .update({ status: "approved", approved_by: user?.id, approved_at: new Date().toISOString() })
      .eq("id", d.id)
      .eq("status", "pending");
    if (error) return toast.error("فشل الاعتماد: " + error.message);
    await supabase.from("hr_audit_log").insert({
      entity_type: "hr_deduction",
      entity_id: d.id,
      employee_id: d.employee_id,
      action: "approve",
      after_data: { ...d, status: "approved" } as any,
      performed_by: user?.id,
      reason: `اعتماد خصم ${typeLabel[d.deduction_type]}`,
    });
    toast.success("تم اعتماد الخصم");
    await load();
  };

  const submitReject = async () => {
    if (!rejectOf || !canApprove) return;
    const { error } = await supabase
      .from("hr_deductions")
      .update({
        status: "rejected",
        rejected_by: user?.id,
        rejected_at: new Date().toISOString(),
        rejection_reason: rejectReason || null,
      })
      .eq("id", rejectOf.id);
    if (error) return toast.error("فشل الرفض: " + error.message);
    await supabase.from("hr_audit_log").insert({
      entity_type: "hr_deduction",
      entity_id: rejectOf.id,
      employee_id: rejectOf.employee_id,
      action: "reject",
      after_data: { ...rejectOf, status: "rejected", rejection_reason: rejectReason } as any,
      performed_by: user?.id,
      reason: rejectReason || "رفض خصم",
    });
    toast.success("تم رفض الخصم");
    setRejectOf(null);
    setRejectReason("");
    await load();
  };

  const remove = async (d: Deduction) => {
    if (!canApprove) return;
    if (!confirm("حذف هذا الخصم نهائيًا؟")) return;
    const { error } = await supabase.from("hr_deductions").delete().eq("id", d.id);
    if (error) return toast.error("فشل الحذف: " + error.message);
    await supabase.from("hr_audit_log").insert({
      entity_type: "hr_deduction",
      entity_id: d.id,
      employee_id: d.employee_id,
      action: "delete",
      before_data: d as any,
      performed_by: user?.id,
      reason: "حذف خصم",
    });
    toast.success("تم الحذف");
    await load();
  };

  const exportExcel = () => {
    const rows = filtered.map((d, i) => {
      const e = empById.get(d.employee_id);
      return {
        "#": i + 1,
        "التاريخ": d.deduction_date,
        "الشهر": d.month,
        "السنة": d.year,
        "كود الموظف": e?.code || "",
        "اسم الموظف": e?.full_name || "",
        "القسم": e?.department || "",
        "نوع الخصم": typeLabel[d.deduction_type],
        "المبلغ": Number(d.amount),
        "السبب": d.reason || "",
        "ملاحظات": d.notes || "",
        "الحالة": statusLabel[d.status],
        "من سجل": profiles[d.created_by || ""] || "",
        "من اعتمد": profiles[d.approved_by || ""] || "",
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "خصومات");
    XLSX.writeFile(wb, `hr-deductions-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const printReport = () => {
    const rowsHtml = filtered.map((d, i) => {
      const e = empById.get(d.employee_id);
      return `<tr>
        <td>${i + 1}</td>
        <td>${d.deduction_date}</td>
        <td>${e?.code || ""}</td>
        <td>${e?.full_name || ""}</td>
        <td>${e?.department || ""}</td>
        <td>${typeLabel[d.deduction_type]}</td>
        <td style="text-align:left">${Number(d.amount).toLocaleString("ar-EG")}</td>
        <td>${d.reason || ""}</td>
        <td>${statusLabel[d.status]}</td>
      </tr>`;
    }).join("");
    const html = `
      <div style="text-align:center;margin-bottom:16px">
        <h1 style="margin:0">تقرير خصومات الموظفين</h1>
        <div style="color:#666;font-size:12px">${new Date().toLocaleString("ar-EG")}</div>
      </div>
      <div style="margin-bottom:8px;font-size:12px">
        إجمالي الخصومات (في النطاق): <b>${totals.total.toLocaleString("ar-EG")} ج.م</b>
        — معتمد: <b>${totals.approved.toLocaleString("ar-EG")}</b>
        — بانتظار: <b>${totals.pending.toLocaleString("ar-EG")}</b>
        — مرفوض: <b>${totals.rejected.toLocaleString("ar-EG")}</b>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead style="background:#f3f4f6">
          <tr>
            <th>#</th><th>التاريخ</th><th>الكود</th><th>الموظف</th><th>القسم</th>
            <th>النوع</th><th>المبلغ</th><th>السبب</th><th>الحالة</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>`;
    openPrintWindow("تقرير خصومات الموظفين", html);
  };

  const monthOptions = [
    { v: "all", l: "كل الشهور" },
    ...Array.from({ length: 12 }, (_, i) => ({ v: String(i + 1), l: `${i + 1}` })),
  ];
  const yearOptions = [
    { v: "all", l: "كل السنوات" },
    ...Array.from({ length: 6 }, (_, i) => {
      const y = now.getFullYear() - 3 + i;
      return { v: String(y), l: String(y) };
    }),
  ];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-rose-500/10 flex items-center justify-center">
              <MinusCircle className="w-7 h-7 text-rose-600" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">خصومات الموظفين</h1>
              <p className="text-muted-foreground mt-1">تسجيل واعتماد خصومات الراتب — لا تتحرك الخزنة، فقط تخصم من بيان الراتب</p>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" onClick={exportExcel}><FileSpreadsheet className="w-4 h-4 ml-1" />Excel</Button>
            <Button variant="outline" onClick={printReport}><Printer className="w-4 h-4 ml-1" />طباعة / PDF</Button>
            {canRecord && <Button onClick={openCreate}><Plus className="w-4 h-4 ml-1" />إضافة خصم</Button>}
          </div>
        </div>

        {/* KPI */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardContent className="pt-4"><div className="text-xs text-muted-foreground">العدد</div><div className="text-2xl font-bold mt-1">{totals.count}</div></CardContent></Card>
          <Card><CardContent className="pt-4"><div className="text-xs text-muted-foreground">إجمالي معتمد</div><div className="text-2xl font-bold mt-1 text-emerald-700">{totals.approved.toLocaleString("ar-EG")}</div></CardContent></Card>
          <Card><CardContent className="pt-4"><div className="text-xs text-muted-foreground">بانتظار الاعتماد</div><div className="text-2xl font-bold mt-1 text-amber-700">{totals.pending.toLocaleString("ar-EG")}</div></CardContent></Card>
          <Card><CardContent className="pt-4"><div className="text-xs text-muted-foreground">مرفوض</div><div className="text-2xl font-bold mt-1 text-rose-700">{totals.rejected.toLocaleString("ar-EG")}</div></CardContent></Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>الفلاتر</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
              <div>
                <Label className="text-xs">الموظف</Label>
                <Select value={fEmp} onValueChange={setFEmp}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value="all">الكل</SelectItem>
                    {employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">القسم</Label>
                <Select value={fDept} onValueChange={setFDept}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">الكل</SelectItem>
                    {departments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">النوع</Label>
                <Select value={fType} onValueChange={setFType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">الكل</SelectItem>
                    {Object.entries(typeLabel).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">الحالة</Label>
                <Select value={fStatus} onValueChange={setFStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">الكل</SelectItem>
                    <SelectItem value="pending">بانتظار الاعتماد</SelectItem>
                    <SelectItem value="approved">معتمد</SelectItem>
                    <SelectItem value="rejected">مرفوض</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">الشهر</Label>
                <Select value={fMonth} onValueChange={setFMonth}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {monthOptions.map((o) => <SelectItem key={o.v} value={o.v}>{o.l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">السنة</Label>
                <Select value={fYear} onValueChange={setFYear}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {yearOptions.map((o) => <SelectItem key={o.v} value={o.v}>{o.l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">من تاريخ</Label>
                <Input type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">إلى تاريخ</Label>
                <Input type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} />
              </div>
              <div className="md:col-span-2">
                <Label className="text-xs">بحث</Label>
                <div className="relative">
                  <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input placeholder="بحث بالاسم/الكود/السبب..." value={search} onChange={(e) => setSearch(e.target.value)} className="pr-9" />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>قائمة الخصومات ({filtered.length})</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>التاريخ</TableHead>
                    <TableHead>الموظف</TableHead>
                    <TableHead>القسم</TableHead>
                    <TableHead>الشهر/السنة</TableHead>
                    <TableHead>النوع</TableHead>
                    <TableHead>المبلغ</TableHead>
                    <TableHead>السبب</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead>المسجِّل</TableHead>
                    <TableHead>المعتمِد</TableHead>
                    <TableHead className="text-left">إجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow><TableCell colSpan={11} className="text-center py-8 text-muted-foreground">جارٍ التحميل...</TableCell></TableRow>
                  ) : filtered.length === 0 ? (
                    <TableRow><TableCell colSpan={11} className="text-center py-8 text-muted-foreground">لا توجد خصومات مطابقة</TableCell></TableRow>
                  ) : (
                    filtered.map((d) => {
                      const e = empById.get(d.employee_id);
                      return (
                        <TableRow key={d.id}>
                          <TableCell className="font-mono text-xs">{d.deduction_date}</TableCell>
                          <TableCell>
                            <div className="font-medium">{e?.full_name || "—"}</div>
                            <div className="text-xs text-muted-foreground font-mono">{e?.code}</div>
                          </TableCell>
                          <TableCell className="text-sm">{e?.department || "—"}</TableCell>
                          <TableCell className="text-xs font-mono">{d.month}/{d.year}</TableCell>
                          <TableCell><Badge variant="outline">{typeLabel[d.deduction_type]}</Badge></TableCell>
                          <TableCell className="font-mono font-semibold text-rose-700">{Number(d.amount).toLocaleString("ar-EG")}</TableCell>
                          <TableCell className="text-sm max-w-[200px] truncate" title={d.reason || ""}>{d.reason || "—"}</TableCell>
                          <TableCell><Badge className={statusColor[d.status]}>{statusLabel[d.status]}</Badge></TableCell>
                          <TableCell className="text-xs">{profiles[d.created_by || ""] || "—"}</TableCell>
                          <TableCell className="text-xs">{profiles[d.approved_by || ""] || "—"}</TableCell>
                          <TableCell>
                            <div className="flex gap-1 justify-end">
                              {d.status === "pending" && canApprove && (
                                <>
                                  <Button size="sm" variant="ghost" className="text-emerald-700 hover:bg-emerald-50" onClick={() => approve(d)} title="اعتماد">
                                    <Check className="w-4 h-4" />
                                  </Button>
                                  <Button size="sm" variant="ghost" className="text-rose-700 hover:bg-rose-50" onClick={() => { setRejectOf(d); setRejectReason(""); }} title="رفض">
                                    <X className="w-4 h-4" />
                                  </Button>
                                </>
                              )}
                              {d.status !== "approved" && canRecord && (
                                <Button size="sm" variant="ghost" onClick={() => openEdit(d)} title="تعديل">
                                  <Edit className="w-4 h-4" />
                                </Button>
                              )}
                              {canApprove && (
                                <Button size="sm" variant="ghost" className="text-rose-700" onClick={() => remove(d)} title="حذف">
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Add/Edit dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? "تعديل خصم" : "إضافة خصم"}</DialogTitle>
            <DialogDescription>الخصم يُسجل بحالة "بانتظار الاعتماد" ولا يدخل في بيان الراتب إلا بعد اعتماده.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="md:col-span-2">
              <Label>الموظف *</Label>
              <Select value={form.employee_id} onValueChange={(v) => setForm({ ...form, employee_id: v })}>
                <SelectTrigger><SelectValue placeholder="اختر الموظف" /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.full_name} {e.department ? `— ${e.department}` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>التاريخ *</Label>
              <Input
                type="date"
                value={form.deduction_date}
                onChange={(e) => {
                  const dt = new Date(e.target.value);
                  setForm({
                    ...form,
                    deduction_date: e.target.value,
                    month: dt.getMonth() + 1 || form.month,
                    year: dt.getFullYear() || form.year,
                  });
                }}
              />
            </div>
            <div>
              <Label>المبلغ *{isDays && <span className="text-xs text-muted-foreground"> (محسوب تلقائيًا)</span>}</Label>
              <Input
                type="number"
                step="0.01"
                value={isDays ? computedDaysAmount || "" : (form.amount || "")}
                onChange={(e) => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })}
                readOnly={isDays}
                className={isDays ? "bg-muted" : ""}
              />
            </div>
            <div>
              <Label>الشهر *</Label>
              <Select value={String(form.month)} onValueChange={(v) => setForm({ ...form, month: Number(v) })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 12 }, (_, i) => <SelectItem key={i + 1} value={String(i + 1)}>{i + 1}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>السنة *</Label>
              <Input type="number" value={form.year} onChange={(e) => setForm({ ...form, year: parseInt(e.target.value) || form.year })} />
            </div>
            <div className="md:col-span-2">
              <Label>نوع الخصم *</Label>
              <Select value={form.deduction_type} onValueChange={(v: DeductionType) => setForm({ ...form, deduction_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(typeLabel).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {isDays && (
              <div className="md:col-span-2 rounded-lg border bg-primary/5 p-3 space-y-3">
                {!empSalary ? (
                  <div className="text-sm text-rose-700">⚠ لا يمكن حساب خصم الأيام لأن راتب الموظف غير مسجل</div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                      <div>
                        <div className="text-xs text-muted-foreground">الراتب الشهري</div>
                        <div className="font-mono font-bold">{empSalary.toLocaleString("ar-EG")} ج.م</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">قيمة اليوم</div>
                        <div className="font-mono font-bold text-primary">{dailyValue.toLocaleString("ar-EG", { maximumFractionDigits: 2 })} ج.م</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">إجمالي الخصم</div>
                        <div className="font-mono font-bold text-rose-700">{computedDaysAmount.toLocaleString("ar-EG")} ج.م</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label>عدد أيام الشهر المعتمد *</Label>
                        <Input
                          type="number"
                          min={1}
                          max={31}
                          value={form.days_per_month}
                          onChange={(e) => setForm({ ...form, days_per_month: parseInt(e.target.value) || DEFAULT_DAYS_PER_MONTH })}
                        />
                      </div>
                      <div>
                        <Label>عدد الأيام المخصومة *</Label>
                        <Input
                          type="number"
                          min={0}
                          step="0.5"
                          value={form.days_count || ""}
                          onChange={(e) => setForm({ ...form, days_count: parseFloat(e.target.value) || 0 })}
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
            <div className="md:col-span-2">
              <Label>سبب الخصم</Label>
              <Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="مثال: غياب يوم 15" />
            </div>
            <div className="md:col-span-2">
              <Label>ملاحظات</Label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button onClick={save} disabled={saving}>{saving ? "جارٍ الحفظ..." : (editing ? "حفظ التعديلات" : "تسجيل الخصم")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject dialog */}
      <Dialog open={!!rejectOf} onOpenChange={(o) => !o && setRejectOf(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>رفض الخصم</DialogTitle>
            <DialogDescription>
              {rejectOf && <>الموظف: <b>{empById.get(rejectOf.employee_id)?.full_name}</b> — المبلغ: <b>{Number(rejectOf.amount).toLocaleString("ar-EG")} ج.م</b></>}
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label>سبب الرفض</Label>
            <Textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={3} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOf(null)}>إلغاء</Button>
            <Button variant="destructive" onClick={submitReject}>تأكيد الرفض</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default HRDeductions;
