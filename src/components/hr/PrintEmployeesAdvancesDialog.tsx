import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Printer, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { openPrintWindow, escapeHtml, fmtNum, fmtDate, COMPANY_AR } from "@/lib/printPdf";

interface Employee {
  id: string; code: string; full_name: string; job_title: string | null;
  department: string | null; current_location_id: string | null;
  employment_type: "monthly" | "daily" | "temporary";
  base_salary: number; daily_rate: number | null;
  status: "active" | "inactive"; notes: string | null;
}
interface Location { id: string; name: string; department: string | null; }
interface Advance {
  id: string; source: "main" | "lab" | "slaughter"; sourceLabel: string;
  date: string; amount: number; description: string; beneficiary: string | null;
  status: string; matchedEmployeeId: string | null;
}

const SRC_LABEL: Record<string, string> = {
  main: "الخزنة الرئيسية", lab: "خزنة المعمل", slaughter: "عهدة المجزر",
};
const ADVANCE_REGEX = /سلف|advance/i;
const EMP_TYPE_LABEL: Record<string, string> = { monthly: "شهري", daily: "يومية", temporary: "مؤقت" };

const normalize = (s: string) =>
  (s || "")
    .replace(/[ًٌٍَُِّْـ]/g, "")
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim().toLowerCase();

function tryMatchEmployee(text: string, employees: Employee[]): Employee | null {
  const n = normalize(text);
  if (!n) return null;
  let best: { emp: Employee; score: number } | null = null;
  for (const e of employees) {
    const ne = normalize(e.full_name);
    if (!ne) continue;
    const tokens = ne.split(" ").filter((t) => t.length >= 2);
    if (!tokens.length) continue;
    let score = 0;
    for (const t of tokens) if (n.includes(t)) score++;
    if (score >= 2) {
      if (!best || score > best.score) best = { emp: e, score };
    } else if (score === 1 && tokens[0].length >= 3 && n.includes(tokens[0])) {
      const others = employees.filter((o) => o.id !== e.id && normalize(o.full_name).split(" ")[0] === tokens[0]);
      if (others.length === 0 && (!best || best.score < 1)) best = { emp: e, score: 1 };
    }
  }
  return best?.emp ?? null;
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  employees: Employee[];
  locations: Location[];
}

const PrintEmployeesAdvancesDialog = ({ open, onOpenChange, employees, locations }: Props) => {
  const [loading, setLoading] = useState(false);
  const [advances, setAdvances] = useState<Advance[]>([]);
  const [aliases, setAliases] = useState<Array<{ normalized_name: string; employee_id: string }>>([]);

  // Filters
  const today = new Date().toISOString().slice(0, 10);
  const firstOfMonth = today.slice(0, 8) + "01";
  const [fromDate, setFromDate] = useState(firstOfMonth);
  const [toDate, setToDate] = useState(today);
  const [preset, setPreset] = useState<"month" | "all" | "custom">("month");
  const [fLoc, setFLoc] = useState("all");
  const [fDept, setFDept] = useState("all");
  const [fEmp, setFEmp] = useState("all");
  const [fStatus, setFStatus] = useState<"all" | "active" | "inactive">("active");

  useEffect(() => {
    if (open) void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function loadData() {
    setLoading(true);
    try {
      const [aliasRes, slRes, labRes, mainRes] = await Promise.all([
        supabase.from("hr_employee_name_aliases" as any).select("normalized_name, employee_id"),
        supabase.from("slaughter_custody_expenses")
          .select("id, expense_date, category, description, amount, beneficiary, status")
          .or("description.ilike.%سلف%,description.ilike.%advance%,category.ilike.%سلف%,category.ilike.%advance%"),
        supabase.from("lab_treasury_movements")
          .select("id, movement_date, description, amount, beneficiary, status, expense_category")
          .or("description.ilike.%سلف%,description.ilike.%advance%,expense_category.ilike.%advance%")
          .eq("movement_type", "expense"),
        supabase.from("main_treasury_transactions")
          .select("id, txn_date, description, amount, counterparty, status")
          .or("description.ilike.%سلف%,description.ilike.%advance%"),
      ]);
      const aliasList = (aliasRes.data as any[]) || [];
      setAliases(aliasList.map((a) => ({ normalized_name: a.normalized_name, employee_id: a.employee_id })));

      const aliasMap = new Map<string, string>();
      aliasList.forEach((a) => aliasMap.set(a.normalized_name, a.employee_id));
      const empById = new Map(employees.map((e) => [e.id, e]));

      const resolve = (text: string, rawName: string | null): Employee | null => {
        const nRaw = normalize(rawName || "");
        if (nRaw && aliasMap.has(nRaw)) {
          const e = empById.get(aliasMap.get(nRaw)!);
          if (e) return e;
        }
        for (const [k, eid] of aliasMap) {
          if (k && normalize(text).includes(k)) {
            const e = empById.get(eid);
            if (e) return e;
          }
        }
        return tryMatchEmployee(text, employees);
      };

      const out: Advance[] = [];
      for (const r of (slRes.data as any[]) || []) {
        const text = `${r.description ?? ""} ${r.beneficiary ?? ""}`;
        if (!ADVANCE_REGEX.test(text) && !ADVANCE_REGEX.test(r.category ?? "")) continue;
        const m = resolve(text, r.beneficiary);
        out.push({
          id: r.id, source: "slaughter", sourceLabel: SRC_LABEL.slaughter,
          date: r.expense_date, amount: Number(r.amount) || 0,
          description: r.description ?? "", beneficiary: r.beneficiary,
          status: r.status, matchedEmployeeId: m?.id ?? null,
        });
      }
      for (const r of (labRes.data as any[]) || []) {
        const text = `${r.description ?? ""} ${r.beneficiary ?? ""}`;
        if (!ADVANCE_REGEX.test(text)) continue;
        const m = resolve(text, r.beneficiary);
        out.push({
          id: r.id, source: "lab", sourceLabel: SRC_LABEL.lab,
          date: r.movement_date, amount: Number(r.amount) || 0,
          description: r.description ?? "", beneficiary: r.beneficiary,
          status: r.status, matchedEmployeeId: m?.id ?? null,
        });
      }
      for (const r of (mainRes.data as any[]) || []) {
        const text = `${r.description ?? ""} ${r.counterparty ?? ""}`;
        if (!ADVANCE_REGEX.test(text)) continue;
        const m = resolve(text, r.counterparty);
        out.push({
          id: r.id, source: "main", sourceLabel: SRC_LABEL.main,
          date: r.txn_date, amount: Number(r.amount) || 0,
          description: r.description ?? "", beneficiary: r.counterparty,
          status: r.status, matchedEmployeeId: m?.id ?? null,
        });
      }
      out.sort((a, b) => a.date.localeCompare(b.date));
      setAdvances(out);
    } catch (e: any) {
      toast.error("فشل تحميل السلف: " + (e?.message || "خطأ"));
    } finally {
      setLoading(false);
    }
  }

  const locById = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations]);
  const departments = useMemo(
    () => Array.from(new Set(employees.map((e) => e.department).filter(Boolean))) as string[],
    [employees]
  );

  const handlePreset = (v: "month" | "all" | "custom") => {
    setPreset(v);
    if (v === "month") { setFromDate(firstOfMonth); setToDate(today); }
    else if (v === "all") { setFromDate(""); setToDate(today); }
  };

  // Build report data
  const report = useMemo(() => {
    const validAdv = advances.filter((a) => {
      if (a.status === "rejected") return false;
      if (fromDate && a.date < fromDate) return false;
      if (toDate && a.date > toDate) return false;
      return true;
    });

    const empFiltered = employees.filter((e) => {
      if (fStatus !== "all" && e.status !== fStatus) return false;
      if (fLoc !== "all" && e.current_location_id !== fLoc) return false;
      if (fDept !== "all" && e.department !== fDept) return false;
      if (fEmp !== "all" && e.id !== fEmp) return false;
      return true;
    });

    const advByEmp = new Map<string, Advance[]>();
    for (const a of validAdv) {
      if (!a.matchedEmployeeId) continue;
      const arr = advByEmp.get(a.matchedEmployeeId) || [];
      arr.push(a);
      advByEmp.set(a.matchedEmployeeId, arr);
    }

    const rows = empFiltered.map((e) => {
      const advs = advByEmp.get(e.id) || [];
      const totalAdv = advs.reduce((s, a) => s + a.amount, 0);
      const sources = Array.from(new Set(advs.map((a) => a.sourceLabel)));
      const base = Number(e.base_salary) || 0;
      const daily = Number(e.daily_rate) || 0;
      const deductions = 0;
      const bonuses = 0;
      const isDaily = e.employment_type === "daily";
      const needsAttendance = isDaily;
      const net = needsAttendance ? null : base - totalAdv - deductions + bonuses;
      return {
        emp: e,
        location: e.current_location_id ? locById.get(e.current_location_id)?.name ?? "—" : "—",
        advs,
        totalAdv,
        advCount: advs.length,
        sources,
        deductions,
        bonuses,
        net,
        needsAttendance,
      };
    });

    const unmatched = validAdv.filter((a) => !a.matchedEmployeeId);

    return {
      rows,
      unmatched,
      totals: {
        empCount: rows.length,
        totalBase: rows.reduce((s, r) => s + (Number(r.emp.base_salary) || 0), 0),
        totalAdvances: rows.reduce((s, r) => s + r.totalAdv, 0),
        totalNet: rows.reduce((s, r) => s + (r.net ?? 0), 0),
      },
    };
  }, [advances, employees, fromDate, toDate, fStatus, fLoc, fDept, fEmp, locById]);

  function buildHtml() {
    const periodLabel = fromDate ? `${fmtDate(fromDate)} → ${fmtDate(toDate)}` : `من بداية الخزن → ${fmtDate(toDate)}`;
    const empRows = report.rows.map((r, i) => {
      const advDetail = r.advs.length
        ? r.advs.map((a) => `• ${fmtNum(a.amount, 2)} ج — ${escapeHtml(a.sourceLabel)} — ${fmtDate(a.date)}`).join("<br/>")
        : "—";
      return `<tr>
        <td>${i + 1}</td>
        <td class="mono">${escapeHtml(r.emp.code)}</td>
        <td>${escapeHtml(r.emp.full_name)}</td>
        <td>${escapeHtml(r.emp.job_title || "—")}</td>
        <td>${escapeHtml(r.emp.department || "—")}</td>
        <td>${escapeHtml(r.location)}</td>
        <td>${EMP_TYPE_LABEL[r.emp.employment_type]}</td>
        <td class="num">${fmtNum(r.emp.base_salary, 2)}</td>
        <td class="num">${r.emp.daily_rate ? fmtNum(r.emp.daily_rate, 2) : "—"}</td>
        <td class="num">${fmtNum(r.totalAdv, 2)}</td>
        <td>${r.advCount}</td>
        <td style="font-size:9px">${escapeHtml(r.sources.join(" / ") || "—")}</td>
        <td style="font-size:9px">${advDetail}</td>
        <td class="num">${fmtNum(r.deductions, 2)}</td>
        <td class="num">${fmtNum(r.bonuses, 2)}</td>
        <td class="num" style="font-weight:bold;color:${r.needsAttendance ? "#999" : r.net! < 0 ? "#c00" : "#060"}">
          ${r.needsAttendance ? "يحتاج حضور" : fmtNum(r.net!, 2)}
        </td>
        <td>${r.emp.status === "active" ? "نشط" : "غير نشط"}</td>
        <td style="font-size:9px">${escapeHtml(r.emp.notes || "—")}</td>
      </tr>`;
    }).join("");

    const unmatchedRows = report.unmatched.map((a, i) => `<tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(a.beneficiary || "—")}</td>
      <td class="num">${fmtNum(a.amount, 2)}</td>
      <td>${escapeHtml(a.sourceLabel)}</td>
      <td>${fmtDate(a.date)}</td>
      <td style="font-size:9px">${escapeHtml(a.description)}</td>
      <td style="color:#c00">يحتاج ربط بموظف</td>
    </tr>`).join("");

    return `
<header>
  <div>
    <h1>بيان بيانات الموظفين والسلف</h1>
    <div class="en">Employees &amp; Advances Statement</div>
  </div>
  <div class="meta">
    <div>${COMPANY_AR}</div>
    <div>الفترة: ${periodLabel}</div>
    <div>تاريخ الطباعة: ${new Date().toLocaleString("ar-EG")}</div>
  </div>
</header>

<div class="stats">
  <div class="stat"><div class="k">عدد الموظفين</div><div class="v">${report.totals.empCount}</div></div>
  <div class="stat"><div class="k">إجمالي الرواتب الأساسية</div><div class="v">${fmtNum(report.totals.totalBase, 2)} ج</div></div>
  <div class="stat"><div class="k">إجمالي السلف</div><div class="v">${fmtNum(report.totals.totalAdvances, 2)} ج</div></div>
  <div class="stat"><div class="k">إجمالي المتبقي</div><div class="v">${fmtNum(report.totals.totalNet, 2)} ج</div></div>
</div>

<h2>قائمة الموظفين</h2>
<table>
  <thead>
    <tr>
      <th>#</th><th>الكود</th><th>الاسم</th><th>الوظيفة</th><th>القسم</th><th>مكان العمل</th>
      <th>التعيين</th><th>المرتب</th><th>اليومية</th><th>إجمالي السلف</th><th>عدد</th>
      <th>الخزن</th><th>تفاصيل السلف</th><th>خصومات</th><th>مكافآت</th><th>المتبقي</th><th>الحالة</th><th>ملاحظات</th>
    </tr>
  </thead>
  <tbody>${empRows || `<tr><td colspan="18" style="text-align:center">لا يوجد موظفون</td></tr>`}</tbody>
</table>

${report.unmatched.length ? `
<h2 style="color:#c00">سلف غير مربوطة بموظف (${report.unmatched.length})</h2>
<table>
  <thead><tr>
    <th>#</th><th>الاسم بالخزنة</th><th>المبلغ</th><th>الخزنة</th><th>التاريخ</th><th>الوصف</th><th>ملاحظة</th>
  </tr></thead>
  <tbody>${unmatchedRows}</tbody>
</table>` : ""}

<div style="margin-top:24px; display:grid; grid-template-columns:repeat(3,1fr); gap:16px; text-align:center; font-size:11px">
  <div style="border-top:1px solid #333; padding-top:6px">توقيع الحسابات</div>
  <div style="border-top:1px solid #333; padding-top:6px">توقيع المدير التنفيذي</div>
  <div style="border-top:1px solid #333; padding-top:6px">توقيع المدير العام</div>
</div>
    `;
  }

  function handlePrint() {
    openPrintWindow("بيان بيانات الموظفين والسلف", buildHtml(), `.mono{font-family:monospace}`);
  }

  function exportExcel() {
    const summary = report.rows.map((r, i) => ({
      "#": i + 1,
      "الكود": r.emp.code,
      "الاسم": r.emp.full_name,
      "الوظيفة": r.emp.job_title || "—",
      "القسم": r.emp.department || "—",
      "مكان العمل": r.location,
      "نوع التعيين": EMP_TYPE_LABEL[r.emp.employment_type],
      "المرتب الأساسي": Number(r.emp.base_salary) || 0,
      "قيمة اليومية": r.emp.daily_rate || 0,
      "إجمالي السلف": r.totalAdv,
      "عدد السلف": r.advCount,
      "الخزن": r.sources.join(" / "),
      "خصومات": r.deductions,
      "مكافآت": r.bonuses,
      "المتبقي في الراتب": r.needsAttendance ? "يحتاج حضور" : r.net,
      "الحالة": r.emp.status === "active" ? "نشط" : "غير نشط",
      "ملاحظات": r.emp.notes || "",
    }));

    const detail: any[] = [];
    for (const r of report.rows) {
      for (const a of r.advs) {
        detail.push({
          "اسم الموظف": r.emp.full_name,
          "كود الموظف": r.emp.code,
          "تاريخ السلفة": a.date,
          "مبلغ السلفة": a.amount,
          "الخزنة": a.sourceLabel,
          "رقم الحركة": a.id,
          "الحالة": a.status,
          "الوصف": a.description,
        });
      }
    }

    const unmatched = report.unmatched.map((a) => ({
      "الاسم بالخزنة": a.beneficiary || "—",
      "تاريخ السلفة": a.date,
      "مبلغ السلفة": a.amount,
      "الخزنة": a.sourceLabel,
      "رقم الحركة": a.id,
      "الحالة": a.status,
      "الوصف": a.description,
    }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), "ملخص الموظفين");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detail), "تفاصيل السلف");
    if (unmatched.length) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(unmatched), "سلف غير مربوطة");
    }
    XLSX.writeFile(wb, `بيان_الموظفين_والسلف_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>طباعة بيان الموظفين والسلف</DialogTitle>
          <DialogDescription>
            اختر الفترة والفلاتر ثم اطبع أو صدّر التقرير. لا يقوم هذا التقرير بأي تعديل على الخزن.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>الفترة</Label>
            <Select value={preset} onValueChange={(v: any) => handlePreset(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="month">الشهر الحالي</SelectItem>
                <SelectItem value="all">من بداية إنشاء الخزن</SelectItem>
                <SelectItem value="custom">فترة مخصصة</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>من تاريخ</Label>
              <Input type="date" value={fromDate} onChange={(e) => { setFromDate(e.target.value); setPreset("custom"); }} />
            </div>
            <div>
              <Label>إلى تاريخ</Label>
              <Input type="date" value={toDate} onChange={(e) => { setToDate(e.target.value); setPreset("custom"); }} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>مكان العمل</Label>
              <Select value={fLoc} onValueChange={setFLoc}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الأماكن</SelectItem>
                  {locations.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>القسم</Label>
              <Select value={fDept} onValueChange={setFDept}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الأقسام</SelectItem>
                  {departments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>الموظف</Label>
              <Select value={fEmp} onValueChange={setFEmp}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الموظفين</SelectItem>
                  {employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>الحالة</Label>
              <Select value={fStatus} onValueChange={(v: any) => setFStatus(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="active">نشط</SelectItem>
                  <SelectItem value="inactive">غير نشط</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
            <div className="flex justify-between"><span>عدد الموظفين:</span><strong>{report.totals.empCount}</strong></div>
            <div className="flex justify-between"><span>إجمالي الرواتب الأساسية:</span><strong>{report.totals.totalBase.toLocaleString("ar-EG")} ج</strong></div>
            <div className="flex justify-between"><span>إجمالي السلف:</span><strong className="text-amber-700">{report.totals.totalAdvances.toLocaleString("ar-EG")} ج</strong></div>
            <div className="flex justify-between"><span>إجمالي المتبقي للموظفين:</span><strong className="text-emerald-700">{report.totals.totalNet.toLocaleString("ar-EG")} ج</strong></div>
            {report.unmatched.length > 0 && (
              <div className="flex justify-between text-red-600">
                <span>سلف غير مربوطة:</span><strong>{report.unmatched.length}</strong>
              </div>
            )}
            {loading && <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="w-3 h-3 animate-spin" /> جارٍ تحميل السلف...</div>}
          </div>
        </div>

        <DialogFooter className="gap-2 flex-wrap">
          <Button variant="outline" onClick={() => onOpenChange(false)}>إغلاق</Button>
          <Button variant="outline" onClick={exportExcel} disabled={loading}>
            <FileSpreadsheet className="w-4 h-4 ml-1" /> تصدير Excel
          </Button>
          <Button variant="outline" onClick={handlePrint} disabled={loading}>
            <FileText className="w-4 h-4 ml-1" /> تصدير PDF
          </Button>
          <Button onClick={handlePrint} disabled={loading}>
            <Printer className="w-4 h-4 ml-1" /> طباعة
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default PrintEmployeesAdvancesDialog;
