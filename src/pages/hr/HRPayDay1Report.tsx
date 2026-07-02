import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Wallet, Users, Printer, FileSpreadsheet, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import * as XLSX from "xlsx";
import { openPrintWindow, escapeHtml, fmtNum, COMPANY_AR } from "@/lib/printPdf";

interface Employee {
  id: string;
  full_name: string;
  department: string | null;
  job_title: string | null;
  base_salary: number;
  pay_day: number;
  status: string;
  is_suspended: boolean;
}

interface DeductionRow {
  id: string;
  employee_id: string;
  deduction_type: string;
  amount: number;
  status: string;
  deduction_date: string;
  reason: string | null;
}

interface Payout {
  id: string;
  employee_id: string;
  month: number;
  year: number;
  net_amount: number;
  paid_at: string;
  paid_by: string | null;
  notes: string | null;
  status: string;
}

const MONTHS_AR = [
  "يناير","فبراير","مارس","أبريل","مايو","يونيو",
  "يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر",
];

interface Row {
  emp: Employee;
  base: number;
  advances: number;
  penalties: number;
  absence: number;
  other: number;
  bonus: number;
  net: number;
  payout: Payout | null;
  deductions: DeductionRow[];
}

export default function HRPayDay1Report() {
  const { user, isGeneralManager, isExecutiveManager } = useAuth();
  const today = new Date();
  const [month, setMonth] = useState<number>(today.getMonth() + 1);
  const [year, setYear] = useState<number>(today.getFullYear());
  const [payDay, setPayDay] = useState<number>(1);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [detail, setDetail] = useState<Row | null>(null);
  const [approving, setApproving] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [emps, deds, payouts, bonuses] = await Promise.all([
        supabase
          .from("hr_employees")
          .select("id, full_name, department, job_title, base_salary, pay_day, status, is_suspended")
          .eq("pay_day", payDay)
          .eq("status", "active")
          .order("full_name"),
        supabase
          .from("hr_deductions")
          .select("id, employee_id, deduction_type, amount, status, deduction_date, reason")
          .eq("month", month)
          .eq("year", year),
        (supabase as any)
          .from("hr_payroll_payouts")
          .select("*")
          .eq("month", month)
          .eq("year", year),
        supabase
          .from("payroll_bonus_overrides")
          .select("moderator_name, month, year, processed_bonus, meat_bonus, bone_bonus")
          .eq("month", month)
          .eq("year", year),
      ]);

      if (emps.error) throw emps.error;
      if (deds.error) throw deds.error;
      if (payouts.error) throw payouts.error;

      const employees = (emps.data ?? []) as Employee[];
      const deductions = (deds.data ?? []) as DeductionRow[];
      const paidMap = new Map<string, Payout>();
      ((payouts.data ?? []) as Payout[]).forEach((p) => paidMap.set(p.employee_id, p));
      const bonusMap = new Map<string, number>();
      ((bonuses.data ?? []) as any[]).forEach((b) => {
        const total = Number(b.processed_bonus || 0) + Number(b.meat_bonus || 0) + Number(b.bone_bonus || 0);
        bonusMap.set((b.moderator_name || "").trim(), (bonusMap.get((b.moderator_name || "").trim()) || 0) + total);
      });

      const rows: Row[] = employees.map((emp) => {
        const empDeds = deductions.filter((d) => d.employee_id === emp.id && d.status === "approved");
        const advances = empDeds
          .filter((d) => d.deduction_type === "advance_repayment")
          .reduce((s, d) => s + Number(d.amount || 0), 0);
        const penalties = empDeds
          .filter((d) => ["penalty", "damages", "administrative", "late"].includes(d.deduction_type))
          .reduce((s, d) => s + Number(d.amount || 0), 0);
        const absence = empDeds
          .filter((d) => ["absence", "days_deduction"].includes(d.deduction_type))
          .reduce((s, d) => s + Number(d.amount || 0), 0);
        const other = empDeds
          .filter((d) => d.deduction_type === "other")
          .reduce((s, d) => s + Number(d.amount || 0), 0);
        const bonus = bonusMap.get((emp.full_name || "").trim()) || 0;
        const base = Number(emp.base_salary || 0);
        const net = base + bonus - advances - penalties - absence - other;
        return {
          emp,
          base,
          advances,
          penalties,
          absence,
          other,
          bonus,
          net,
          payout: paidMap.get(emp.id) ?? null,
          deductions: deductions.filter((d) => d.employee_id === emp.id),
        };
      });

      setRows(rows);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "تعذّر تحميل التقرير");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, year, payDay]);

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => ({
        count: acc.count + 1,
        base: acc.base + r.base,
        advances: acc.advances + r.advances,
        penalties: acc.penalties + r.penalties,
        absence: acc.absence + r.absence,
        bonus: acc.bonus + r.bonus,
        net: acc.net + r.net,
        paid: acc.paid + (r.payout ? 1 : 0),
      }),
      { count: 0, base: 0, advances: 0, penalties: 0, absence: 0, bonus: 0, net: 0, paid: 0 },
    );
  }, [rows]);

  const approvePayout = async (r: Row) => {
    if (r.emp.is_suspended) {
      toast.error("الموظف موقوف — لا يمكن اعتماد الصرف");
      return;
    }
    if (r.payout) {
      toast.error("تم صرف راتب هذا الموظف لهذا الشهر مسبقًا");
      return;
    }
    setApproving(r.emp.id);
    try {
      const { data, error } = await (supabase as any)
        .from("hr_payroll_payouts")
        .insert({
          employee_id: r.emp.id,
          month,
          year,
          pay_day: r.emp.pay_day,
          base_salary: r.base,
          bonus_amount: r.bonus,
          advances_amount: r.advances,
          penalties_amount: r.penalties,
          absence_amount: r.absence,
          other_deductions_amount: r.other,
          net_amount: r.net,
          paid_by: user?.id ?? null,
          status: "paid",
        })
        .select()
        .single();
      if (error) {
        if (String(error.message).includes("duplicate") || (error as any).code === "23505") {
          toast.error("تم صرف راتب هذا الموظف لهذا الشهر مسبقًا");
        } else {
          throw error;
        }
      } else {
        toast.success(`تم اعتماد صرف راتب ${r.emp.full_name} ✅`);
        setRows((prev) => prev.map((x) => (x.emp.id === r.emp.id ? { ...x, payout: data as Payout } : x)));
      }
    } catch (e: any) {
      toast.error(e?.message || "تعذّر اعتماد الصرف");
    } finally {
      setApproving(null);
    }
  };

  const reversePayout = async (r: Row) => {
    if (!r.payout) return;
    if (!isGeneralManager && !isExecutiveManager) {
      toast.error("عكس الصرف يتطلب صلاحية مدير عام أو تنفيذي");
      return;
    }
    if (!confirm(`هل تريد إلغاء صرف راتب ${r.emp.full_name} لشهر ${MONTHS_AR[month - 1]} ${year}؟`)) return;
    try {
      const { error } = await (supabase as any).from("hr_payroll_payouts").delete().eq("id", r.payout.id);
      if (error) throw error;
      toast.success("تم إلغاء الاعتماد");
      setRows((prev) => prev.map((x) => (x.emp.id === r.emp.id ? { ...x, payout: null } : x)));
    } catch (e: any) {
      toast.error(e?.message || "تعذّر الإلغاء");
    }
  };

  const exportExcel = () => {
    const data = rows.map((r) => ({
      "الموظف": r.emp.full_name,
      "القسم": r.emp.department || "-",
      "الوظيفة": r.emp.job_title || "-",
      "الراتب الأساسي": r.base,
      "السلف": r.advances,
      "الجزاءات": r.penalties,
      "الغياب": r.absence,
      "إضافي/مكافآت": r.bonus,
      "صافي القبض": r.net,
      "الحالة": r.payout ? "تم الصرف" : "جاهز للصرف",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `مرتبات يوم ${payDay}`);
    XLSX.writeFile(wb, `مرتبات_يوم_${payDay}_${MONTHS_AR[month - 1]}_${year}.xlsx`);
  };

  const buildPrintHtml = () => {
    const trs = rows
      .map(
        (r, i) => `
      <tr>
        <td>${i + 1}</td>
        <td class="right">${escapeHtml(r.emp.full_name)}</td>
        <td>${escapeHtml(r.emp.department || "-")}</td>
        <td>${escapeHtml(r.emp.job_title || "-")}</td>
        <td class="num">${fmtNum(r.base)}</td>
        <td class="num">${fmtNum(r.bonus)}</td>
        <td class="num neg">${fmtNum(r.advances)}</td>
        <td class="num neg">${fmtNum(r.penalties)}</td>
        <td class="num neg">${fmtNum(r.absence)}</td>
        <td class="num bold">${fmtNum(r.net)}</td>
        <td>${r.payout ? "تم الصرف" : "جاهز"}</td>
      </tr>`,
      )
      .join("");
    return `
      <h1>${escapeHtml(COMPANY_AR)}</h1>
      <h2>تقرير قبض موظفي يوم ${payDay} — ${MONTHS_AR[month - 1]} ${year}</h2>
      <table>
        <thead>
          <tr>
            <th>#</th><th>الموظف</th><th>القسم</th><th>الوظيفة</th>
            <th>الراتب الأساسي</th><th>إضافي/مكافآت</th>
            <th>السلف</th><th>الجزاءات</th><th>الغياب</th>
            <th>صافي القبض</th><th>الحالة</th>
          </tr>
        </thead>
        <tbody>${trs}</tbody>
        <tfoot>
          <tr>
            <td colspan="4" class="right bold">الإجماليات</td>
            <td class="num bold">${fmtNum(totals.base)}</td>
            <td class="num bold">${fmtNum(totals.bonus)}</td>
            <td class="num bold neg">${fmtNum(totals.advances)}</td>
            <td class="num bold neg">${fmtNum(totals.penalties)}</td>
            <td class="num bold neg">${fmtNum(totals.absence)}</td>
            <td class="num bold">${fmtNum(totals.net)}</td>
            <td>-</td>
          </tr>
        </tfoot>
      </table>
      <div class="summary">
        <p><strong>إجمالي صافي القبض المطلوب دفعه:</strong> ${fmtNum(totals.net)} ج.م</p>
        <p><strong>عدد الموظفين:</strong> ${totals.count} — <strong>تم الصرف:</strong> ${totals.paid} — <strong>متبقي:</strong> ${totals.count - totals.paid}</p>
      </div>
      <div class="signatures">
        <div class="sig"><span>إعداد</span><div class="line"></div></div>
        <div class="sig"><span>مراجعة</span><div class="line"></div></div>
        <div class="sig"><span>اعتماد</span><div class="line"></div></div>
        <div class="sig"><span>توقيع المستلم</span><div class="line"></div></div>
      </div>
    `;
  };

  const doPrint = () => {
    openPrintWindow(
      `تقرير قبض موظفي يوم ${payDay} — ${MONTHS_AR[month - 1]} ${year}`,
      buildPrintHtml(),
      `
        table { width:100%; border-collapse:collapse; margin-top:10px; font-size:12px; }
        th,td { border:1px solid #ccc; padding:6px; text-align:center; }
        th { background:#f3f4f6; }
        .right { text-align:right; }
        .num { text-align:left; direction:ltr; }
        .neg { color:#b91c1c; }
        .bold { font-weight:700; }
        tfoot td { background:#fef3c7; }
        .summary { margin-top:14px; font-size:13px; }
        .signatures { margin-top:40px; display:flex; justify-content:space-between; gap:20px; }
        .sig { flex:1; text-align:center; }
        .sig .line { border-top:1px solid #333; margin-top:40px; }
      `,
    );
  };

  const years = Array.from({ length: 7 }, (_, i) => today.getFullYear() - 3 + i);

  return (
    <DashboardLayout>
      <div className="p-4 space-y-4" dir="rtl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Wallet className="w-6 h-6 text-primary" />
              تقرير قبض موظفي يوم {payDay}
            </h1>
            <p className="text-sm text-muted-foreground">
              مرتبات {MONTHS_AR[month - 1]} {year} — الموظفين الذين موعد قبضهم يوم {payDay} من الشهر
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={doPrint}><Printer className="w-4 h-4 ml-1" /> طباعة</Button>
            <Button variant="outline" onClick={exportExcel}><FileSpreadsheet className="w-4 h-4 ml-1" /> Excel</Button>
          </div>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="p-4 flex flex-wrap gap-3 items-end">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">يوم القبض</label>
              <Select value={String(payDay)} onValueChange={(v) => setPayDay(Number(v))}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[1, 5, 15].map((d) => <SelectItem key={d} value={String(d)}>يوم {d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">الشهر</label>
              <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MONTHS_AR.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">السنة</label>
              <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          <KpiCard icon={<Users className="w-4 h-4" />} label="عدد الموظفين" value={totals.count} />
          <KpiCard label="إجمالي الرواتب" value={fmtNum(totals.base)} />
          <KpiCard label="إجمالي المكافآت" value={fmtNum(totals.bonus)} />
          <KpiCard label="إجمالي السلف" value={fmtNum(totals.advances)} tone="danger" />
          <KpiCard label="إجمالي الجزاءات" value={fmtNum(totals.penalties)} tone="danger" />
          <KpiCard label="إجمالي الغياب" value={fmtNum(totals.absence)} tone="danger" />
          <KpiCard label="صافي القبض المطلوب" value={fmtNum(totals.net)} tone="success" />
        </div>

        {/* Table */}
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base">
              {loading ? (
                <span className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> جاري التحميل…</span>
              ) : (
                `${rows.length} موظف — تم الصرف: ${totals.paid} / متبقي: ${totals.count - totals.paid}`
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الموظف</TableHead>
                  <TableHead>القسم</TableHead>
                  <TableHead>الوظيفة</TableHead>
                  <TableHead className="text-left">الراتب</TableHead>
                  <TableHead className="text-left">مكافآت</TableHead>
                  <TableHead className="text-left">سلف</TableHead>
                  <TableHead className="text-left">جزاءات</TableHead>
                  <TableHead className="text-left">غياب</TableHead>
                  <TableHead className="text-left font-bold">صافي القبض</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>إجراء</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && !loading && (
                  <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground py-6">لا يوجد موظفين لهذا الفلتر</TableCell></TableRow>
                )}
                {rows.map((r) => (
                  <TableRow key={r.emp.id} className={r.payout ? "bg-green-50/40" : ""}>
                    <TableCell>
                      <button className="text-primary hover:underline font-medium" onClick={() => setDetail(r)}>
                        {r.emp.full_name}
                      </button>
                      {r.emp.is_suspended && <Badge variant="destructive" className="mr-2 text-xs">موقوف</Badge>}
                    </TableCell>
                    <TableCell>{r.emp.department || "-"}</TableCell>
                    <TableCell>{r.emp.job_title || "-"}</TableCell>
                    <TableCell className="text-left tabular-nums">{fmtNum(r.base)}</TableCell>
                    <TableCell className="text-left tabular-nums text-emerald-700">{fmtNum(r.bonus)}</TableCell>
                    <TableCell className="text-left tabular-nums text-rose-700">{fmtNum(r.advances)}</TableCell>
                    <TableCell className="text-left tabular-nums text-rose-700">{fmtNum(r.penalties)}</TableCell>
                    <TableCell className="text-left tabular-nums text-rose-700">{fmtNum(r.absence)}</TableCell>
                    <TableCell className="text-left tabular-nums font-bold">{fmtNum(r.net)}</TableCell>
                    <TableCell>
                      {r.payout ? (
                        <Badge className="bg-green-500/15 text-green-700 hover:bg-green-500/25"><CheckCircle2 className="w-3 h-3 ml-1" /> تم الصرف</Badge>
                      ) : r.emp.is_suspended ? (
                        <Badge variant="destructive"><AlertCircle className="w-3 h-3 ml-1" /> موقوف</Badge>
                      ) : (
                        <Badge variant="outline">جاهز للصرف</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {r.payout ? (
                        (isGeneralManager || isExecutiveManager) && (
                          <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => reversePayout(r)}>
                            إلغاء الاعتماد
                          </Button>
                        )
                      ) : (
                        <Button size="sm" onClick={() => approvePayout(r)} disabled={approving === r.emp.id || r.emp.is_suspended}>
                          {approving === r.emp.id ? <Loader2 className="w-4 h-4 animate-spin" /> : "اعتماد الصرف"}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Details dialog */}
        <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" dir="rtl">
            <DialogHeader>
              <DialogTitle>تفاصيل قبض {detail?.emp.full_name} — {detail && `${MONTHS_AR[month - 1]} ${year}`}</DialogTitle>
            </DialogHeader>
            {detail && (
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  <InfoRow label="القسم" value={detail.emp.department || "-"} />
                  <InfoRow label="الوظيفة" value={detail.emp.job_title || "-"} />
                  <InfoRow label="الراتب الأساسي" value={`${fmtNum(detail.base)} ج.م`} />
                  <InfoRow label="مكافآت/إضافي" value={`${fmtNum(detail.bonus)} ج.م`} />
                </div>
                <div className="border-t pt-3">
                  <h4 className="font-semibold mb-2">الخصومات المعتمدة ({detail.deductions.filter(d => d.status === "approved").length})</h4>
                  <div className="space-y-1 max-h-60 overflow-y-auto">
                    {detail.deductions.filter(d => d.status === "approved").map((d) => (
                      <div key={d.id} className="flex justify-between py-1 border-b text-xs">
                        <span>
                          <Badge variant="outline" className="ml-2">{d.deduction_type}</Badge>
                          {d.deduction_date} — {d.reason || "-"}
                        </span>
                        <span className="tabular-nums text-rose-700">{fmtNum(d.amount)}</span>
                      </div>
                    ))}
                    {detail.deductions.filter(d => d.status === "approved").length === 0 && (
                      <p className="text-muted-foreground text-xs">لا توجد خصومات معتمدة لهذا الشهر</p>
                    )}
                  </div>
                </div>
                <div className="border-t pt-3 bg-primary/5 -mx-6 px-6 py-3">
                  <div className="flex justify-between text-lg font-bold">
                    <span>صافي القبض النهائي</span>
                    <span className="tabular-nums">{fmtNum(detail.net)} ج.م</span>
                  </div>
                  {detail.payout && (
                    <p className="text-xs text-green-700 mt-1">
                      ✅ تم الصرف بتاريخ {new Date(detail.payout.paid_at).toLocaleString("ar-EG")}
                    </p>
                  )}
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}

function KpiCard({ icon, label, value, tone }: { icon?: React.ReactNode; label: string; value: string | number; tone?: "danger" | "success" }) {
  const cls = tone === "danger" ? "text-rose-700" : tone === "success" ? "text-emerald-700" : "text-foreground";
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-xs text-muted-foreground flex items-center gap-1">{icon}{label}</div>
        <div className={`text-lg font-bold tabular-nums ${cls}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}
