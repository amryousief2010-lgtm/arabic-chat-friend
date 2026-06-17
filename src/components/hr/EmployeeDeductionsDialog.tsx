import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  employeeId: string;
  employeeName: string;
  baseSalary: number;
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
  other: "أخرى",
};

const STATUS_LABEL: Record<string, { ar: string; cls: string }> = {
  pending: { ar: "بانتظار الاعتماد", cls: "bg-amber-500/15 text-amber-700" },
  approved: { ar: "معتمد", cls: "bg-emerald-500/15 text-emerald-700" },
  rejected: { ar: "مرفوض", cls: "bg-rose-500/15 text-rose-700" },
};

export default function EmployeeDeductionsDialog({
  open, onOpenChange, employeeId, employeeName, baseSalary,
}: Props) {
  const [rows, setRows] = useState<Deduction[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("hr_deductions")
        .select("id, deduction_date, deduction_type, amount, status, reason, notes, created_by, approved_by, approved_at")
        .eq("employee_id", employeeId)
        .order("deduction_date", { ascending: false });
      setRows((data || []) as Deduction[]);
      setLoading(false);
    })();
  }, [open, employeeId]);

  const approved = rows.filter((r) => r.status === "approved");
  const pending = rows.filter((r) => r.status === "pending");
  const totalApproved = approved.reduce((s, r) => s + Number(r.amount), 0);
  const totalPending = pending.reduce((s, r) => s + Number(r.amount), 0);
  const net = Math.max(0, Number(baseSalary || 0) - totalApproved);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>تفاصيل خصومات الموظف</DialogTitle>
          <DialogDescription>{employeeName}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div className="rounded-lg border p-3">
            <div className="text-muted-foreground text-xs">الراتب الأساسي</div>
            <div className="font-mono font-bold text-lg">{Number(baseSalary).toLocaleString("ar-EG")}</div>
          </div>
          <div className="rounded-lg border p-3 bg-emerald-500/5">
            <div className="text-muted-foreground text-xs">إجمالي الخصومات المعتمدة</div>
            <div className="font-mono font-bold text-lg text-rose-700">- {totalApproved.toLocaleString("ar-EG")}</div>
          </div>
          <div className="rounded-lg border p-3 bg-amber-500/5">
            <div className="text-muted-foreground text-xs">بانتظار الاعتماد</div>
            <div className="font-mono font-bold text-lg text-amber-700">{totalPending.toLocaleString("ar-EG")}</div>
          </div>
          <div className="rounded-lg border p-3 bg-primary/5">
            <div className="text-muted-foreground text-xs">صافي الراتب المتوقع</div>
            <div className="font-mono font-bold text-lg text-primary">{net.toLocaleString("ar-EG")}</div>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin ml-2" /> جارٍ التحميل...
          </div>
        ) : rows.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">لا توجد خصومات مسجلة لهذا الموظف</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>التاريخ</TableHead>
                <TableHead>النوع</TableHead>
                <TableHead>المبلغ</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>السبب</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const st = STATUS_LABEL[r.status];
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.deduction_date}</TableCell>
                    <TableCell>{TYPE_LABEL[r.deduction_type] || r.deduction_type}</TableCell>
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
