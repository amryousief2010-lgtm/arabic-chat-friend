import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Wallet } from "lucide-react";
import { fetchAdvancesByEmployee, sumAdvances, type TreasuryAdvanceRow } from "@/lib/hrAdvances";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  employeeId: string;
  employeeName: string;
  baseSalary: number;
  employeeFullName?: string; // for advance matching (defaults to employeeName parsed)
}

interface Deduction {
  id: string;
  deduction_date: string;
  deduction_type: string;
  amount: number;
  status: "pending" | "approved" | "rejected";
  reason: string | null;
  notes: string | null;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  days_count: number | null;
  daily_value: number | null;
  days_per_month: number | null;
  monthly_salary_snapshot: number | null;
  month: number;
  year: number;
}

const TYPE_LABEL: Record<string, string> = {
  absence: "غياب",
  late: "تأخير",
  penalty: "جزاء",
  damages: "تلفيات",
  advance_repayment: "خصم سلفة",
  administrative: "خصم إداري",
  days_deduction: "خصم أيام",
  other: "أخرى",
};

const STATUS_LABEL: Record<string, { ar: string; cls: string }> = {
  pending: { ar: "بانتظار الاعتماد", cls: "bg-amber-500/15 text-amber-700" },
  approved: { ar: "معتمد", cls: "bg-emerald-500/15 text-emerald-700" },
  rejected: { ar: "مرفوض", cls: "bg-rose-500/15 text-rose-700" },
};

const SOURCE_CLS: Record<string, string> = {
  slaughter: "bg-rose-500/15 text-rose-700",
  lab: "bg-indigo-500/15 text-indigo-700",
  main: "bg-amber-500/15 text-amber-700",
};

export default function EmployeeDeductionsDialog({
  open, onOpenChange, employeeId, employeeName, baseSalary, employeeFullName,
}: Props) {
  const [rows, setRows] = useState<Deduction[]>([]);
  const [advances, setAdvances] = useState<TreasuryAdvanceRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      setLoading(true);
      const fullName = employeeFullName || employeeName.replace(/\s*\([^)]*\)\s*$/, "");
      const [dedRes, advRes] = await Promise.all([
        supabase
          .from("hr_deductions")
          .select(
            "id, deduction_date, deduction_type, amount, status, reason, notes, created_by, approved_by, approved_at, days_count, daily_value, days_per_month, monthly_salary_snapshot, month, year"
          )
          .eq("employee_id", employeeId)
          .order("deduction_date", { ascending: false }),
        fetchAdvancesByEmployee([{ id: employeeId, full_name: fullName }]),
      ]);
      setRows((dedRes.data || []) as Deduction[]);
      setAdvances(advRes.map[employeeId] || []);
      setLoading(false);
    })();
  }, [open, employeeId, employeeName, employeeFullName]);

  const approved = rows.filter((r) => r.status === "approved");
  const pending = rows.filter((r) => r.status === "pending");
  const totalApproved = approved.reduce((s, r) => s + Number(r.amount), 0);
  const totalPending = pending.reduce((s, r) => s + Number(r.amount), 0);
  const totalAdvances = sumAdvances(advances);
  const hasMissingSalary = Number(baseSalary || 0) <= 0;
  const totalDeductions = totalApproved + totalAdvances;
  const net = hasMissingSalary ? null : Math.max(0, Number(baseSalary || 0) - totalDeductions);

  const fmt = (n: number) => n.toLocaleString("ar-EG", { maximumFractionDigits: 2 });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>تفاصيل خصومات الموظف</DialogTitle>
          <DialogDescription>{employeeName}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
          <div className="rounded-lg border p-3">
            <div className="text-muted-foreground text-xs">الراتب الأساسي</div>
            <div className="font-mono font-bold text-lg">{fmt(Number(baseSalary))}</div>
          </div>
          <div className="rounded-lg border p-3 bg-emerald-500/5">
            <div className="text-muted-foreground text-xs">الخصومات المعتمدة</div>
            <div className="font-mono font-bold text-lg text-rose-700">- {fmt(totalApproved)}</div>
          </div>
          <div className="rounded-lg border p-3 bg-purple-500/5">
            <div className="text-muted-foreground text-xs">السلف / العهد</div>
            <div className="font-mono font-bold text-lg text-rose-700">- {fmt(totalAdvances)}</div>
          </div>
          <div className="rounded-lg border p-3 bg-amber-500/5">
            <div className="text-muted-foreground text-xs">بانتظار الاعتماد</div>
            <div className="font-mono font-bold text-lg text-amber-700">{fmt(totalPending)}</div>
          </div>
          <div className="rounded-lg border p-3 bg-primary/5">
            <div className="text-muted-foreground text-xs">صافي الراتب المتوقع</div>
            <div className="font-mono font-bold text-lg text-primary">
              {hasMissingSalary ? "—" : fmt(net!)}
            </div>
          </div>
        </div>

        {hasMissingSalary && (rows.some((r) => r.status === "approved") || advances.length > 0) && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
            راتب الموظف غير مسجل، لا يمكن احتساب صافي الراتب. الخصومات والسلف ظاهرة كمستحقة الخصم لحين تسجيل الراتب.
          </div>
        )}

        {/* السلف والعهد */}
        <div className="space-y-2">
          <h3 className="flex items-center gap-2 font-bold text-sm">
            <Wallet className="w-4 h-4 text-purple-700" />
            السلف والعهد ({advances.length})
            <span className="text-xs text-muted-foreground font-normal">مطابقة من حركات الخزن بحسب الاسم</span>
          </h3>
          {loading ? (
            <div className="flex items-center justify-center py-4 text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 animate-spin ml-2" /> جارٍ التحميل...
            </div>
          ) : advances.length === 0 ? (
            <p className="text-center text-muted-foreground py-4 text-sm border rounded-lg">
              لا توجد سلف أو عهد مرتبطة بهذا الموظف في الخزن
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>المصدر</TableHead>
                  <TableHead>المرجع</TableHead>
                  <TableHead>الوصف / الملاحظات</TableHead>
                  <TableHead>القيمة</TableHead>
                  <TableHead>خصم هذا الشهر</TableHead>
                  <TableHead>الحالة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {advances.map((a) => (
                  <TableRow key={`${a.source}-${a.id}`}>
                    <TableCell className="font-mono text-xs">{a.date}</TableCell>
                    <TableCell><Badge className={SOURCE_CLS[a.source]}>{a.sourceLabel}</Badge></TableCell>
                    <TableCell className="font-mono text-xs">{a.reference || "—"}</TableCell>
                    <TableCell className="text-xs">
                      <div>{a.description || "—"}</div>
                      {a.beneficiary && <div className="text-muted-foreground">المستفيد: {a.beneficiary}</div>}
                    </TableCell>
                    <TableCell className="font-mono">{fmt(a.amount)}</TableCell>
                    <TableCell className="font-mono text-rose-700">- {fmt(a.amount)}</TableCell>
                    <TableCell><Badge variant="outline">{a.status || "—"}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {/* الخصومات العادية */}
        <h3 className="font-bold text-sm mt-2">الخصومات الإدارية والغياب ({rows.length})</h3>
        {loading ? null : rows.length === 0 ? (
          <p className="text-center text-muted-foreground py-4 text-sm border rounded-lg">لا توجد خصومات مسجلة</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>التاريخ</TableHead>
                <TableHead>الشهر</TableHead>
                <TableHead>النوع</TableHead>
                <TableHead>التفاصيل</TableHead>
                <TableHead>المبلغ</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>السبب</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const st = STATUS_LABEL[r.status];
                const isDays = r.deduction_type === "days_deduction";
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.deduction_date}</TableCell>
                    <TableCell className="font-mono text-xs">{r.month}/{r.year}</TableCell>
                    <TableCell>{TYPE_LABEL[r.deduction_type] || r.deduction_type}</TableCell>
                    <TableCell className="text-xs">
                      {isDays && r.days_count ? (
                        <div className="space-y-0.5">
                          <div>عدد الأيام: <b>{Number(r.days_count)}</b></div>
                          <div>قيمة اليوم: <b>{Number(r.daily_value || 0).toLocaleString("ar-EG", { maximumFractionDigits: 2 })}</b></div>
                          {r.days_per_month && <div className="text-muted-foreground">/ {r.days_per_month} يوم</div>}
                        </div>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="font-mono">{Number(r.amount).toLocaleString("ar-EG")}</TableCell>
                    <TableCell><Badge className={st.cls}>{st.ar}</Badge></TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.reason || "—"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}
