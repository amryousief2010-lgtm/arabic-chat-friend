import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Receipt, Printer, FileSpreadsheet, FileText, AlertTriangle, Users, Wallet, Link2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { openPrintWindow, escapeHtml, fmtNum, fmtDate, COMPANY_AR } from "@/lib/printPdf";

interface AdvanceRow {
  id: string;
  source: "main" | "lab" | "slaughter";
  sourceLabel: string;
  date: string;
  description: string;
  beneficiary: string | null;
  amount: number;
  status: string;
  paymentMethod: string | null;
  reference: string | null;
  createdBy: string | null;
  approvedBy: string | null;
  notes: string | null;
  matchedEmployeeId: string | null;
  matchedName: string | null;
  department: string | null;
  location: string | null;
}

interface Employee { id: string; full_name: string; department: string | null; current_location_id: string | null; }
interface Location { id: string; name: string; department: string | null; }

const SRC_LABEL: Record<string, string> = {
  main: "الخزنة الرئيسية",
  lab: "خزنة المعمل",
  slaughter: "عهدة المجزر",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "قيد المراجعة",
  pending_approval: "قيد المراجعة",
  pending_review: "قيد المراجعة",
  approved: "معتمدة",
  posted: "مُرحَّلة",
  paid: "مدفوعة",
  rejected: "مرفوضة",
};

const STATUS_COLOR: Record<string, string> = {
  approved: "bg-green-500/15 text-green-700",
  posted: "bg-green-500/15 text-green-700",
  paid: "bg-green-500/15 text-green-700",
  pending: "bg-amber-500/15 text-amber-700",
  pending_approval: "bg-amber-500/15 text-amber-700",
  pending_review: "bg-amber-500/15 text-amber-700",
  rejected: "bg-red-500/15 text-red-700",
};

const ADVANCE_REGEX = /سلف|advance/i;

// Normalize Arabic letters for matching
const normalize = (s: string) =>
  (s || "")
    .replace(/[ًٌٍَُِّْـ]/g, "")
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

function tryMatchEmployee(text: string, employees: Employee[]): Employee | null {
  const n = normalize(text);
  if (!n) return null;
  // Try each employee — match if any 2 consecutive tokens of employee name appear in text,
  // or if first name (token) matches and it's unique.
  let best: { emp: Employee; score: number } | null = null;
  for (const e of employees) {
    const ne = normalize(e.full_name);
    if (!ne) continue;
    const tokens = ne.split(" ").filter(t => t.length >= 2);
    if (!tokens.length) continue;
    let score = 0;
    for (const t of tokens) if (n.includes(t)) score++;
    if (score >= 2) {
      if (!best || score > best.score) best = { emp: e, score };
    } else if (score === 1 && tokens[0].length >= 3 && n.includes(tokens[0])) {
      // Single-token match: only count if no other employee shares the same first token
      const others = employees.filter(o => o.id !== e.id && normalize(o.full_name).split(" ")[0] === tokens[0]);
      if (others.length === 0 && (!best || best.score < 1)) best = { emp: e, score: 1 };
    }
  }
  return best?.emp ?? null;
}

const HREmployeeAdvancesReport = () => {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<AdvanceRow[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [aliases, setAliases] = useState<Array<{ id: string; normalized_name: string; employee_id: string; raw_name: string }>>([]);
  const [firstDate, setFirstDate] = useState<string>("");
  const [linkRow, setLinkRow] = useState<AdvanceRow | null>(null);

  // Filters
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [fSource, setFSource] = useState<string>("all");
  const [fEmp, setFEmp] = useState<string>("all");
  const [fLocation, setFLocation] = useState<string>("all");
  const [fDept, setFDept] = useState<string>("all");
  const [fStatus, setFStatus] = useState<string>("all");
  const [fMethod, setFMethod] = useState<string>("all");

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const [empRes, locRes, aliasRes, slRes, labRes, mainRes, firstSlRes, firstLabRes, firstMainRes] = await Promise.all([
        supabase.from("hr_employees").select("id, full_name, department, current_location_id").eq("status", "active"),
        supabase.from("hr_work_locations").select("id, name, department"),
        supabase.from("hr_employee_name_aliases" as any).select("id, normalized_name, employee_id, raw_name"),
        supabase.from("slaughter_custody_expenses").select("id, expense_date, category, description, amount, beneficiary, status, payment_method, notes, created_by, approved_by").or("description.ilike.%سلف%,description.ilike.%advance%,category.ilike.%سلف%,category.ilike.%advance%"),
        supabase.from("lab_treasury_movements").select("id, movement_date, description, amount, beneficiary, status, payment_method, notes, created_by, approved_by, expense_category").or("description.ilike.%سلف%,description.ilike.%advance%,expense_category.ilike.%advance%").eq("movement_type", "expense"),
        supabase.from("main_treasury_transactions").select("id, txn_date, description, amount, counterparty, status, payment_method, created_by, reference_no").or("description.ilike.%سلف%,description.ilike.%advance%"),
        supabase.from("slaughter_custody_expenses").select("expense_date").order("expense_date", { ascending: true }).limit(1),
        supabase.from("lab_treasury_movements").select("movement_date").order("movement_date", { ascending: true }).limit(1),
        supabase.from("main_treasury_transactions").select("txn_date").order("txn_date", { ascending: true }).limit(1),
      ]);

      const emps: Employee[] = (empRes.data as any) || [];
      const locs: Location[] = (locRes.data as any) || [];
      const aliasList: Array<{ id: string; normalized_name: string; employee_id: string; raw_name: string }> =
        (aliasRes.data as any) || [];
      setEmployees(emps);
      setLocations(locs);
      setAliases(aliasList);

      // Build alias lookup: normalized_name -> employee_id
      const aliasMap = new Map<string, string>();
      for (const a of aliasList) aliasMap.set(a.normalized_name, a.employee_id);
      const empById = new Map(emps.map(e => [e.id, e]));

      const resolveMatch = (text: string, rawName: string | null): Employee | null => {
        // 1) alias on raw beneficiary
        const nRaw = normalize(rawName || "");
        if (nRaw && aliasMap.has(nRaw)) {
          const e = empById.get(aliasMap.get(nRaw)!);
          if (e) return e;
        }
        // 2) alias scan over the full text
        for (const [k, eid] of aliasMap) {
          if (k && normalize(text).includes(k)) {
            const e = empById.get(eid);
            if (e) return e;
          }
        }
        // 3) fuzzy match
        return tryMatchEmployee(text, emps);
      };

      const locMap = new Map(locs.map(l => [l.id, l]));

      const out: AdvanceRow[] = [];

      // slaughter custody
      for (const r of (slRes.data as any[]) || []) {
        const text = `${r.description ?? ""} ${r.beneficiary ?? ""}`;
        if (!ADVANCE_REGEX.test(text) && !ADVANCE_REGEX.test(r.category ?? "")) continue;
        const matched = resolveMatch(text, r.beneficiary ?? r.counterparty ?? null);
        const loc = matched?.current_location_id ? locMap.get(matched.current_location_id) : null;
        out.push({
          id: r.id, source: "slaughter", sourceLabel: SRC_LABEL.slaughter,
          date: r.expense_date, description: r.description, beneficiary: r.beneficiary,
          amount: Number(r.amount) || 0, status: r.status, paymentMethod: r.payment_method,
          reference: null, createdBy: r.created_by, approvedBy: r.approved_by, notes: r.notes,
          matchedEmployeeId: matched?.id ?? null, matchedName: matched?.full_name ?? null,
          department: matched?.department ?? loc?.department ?? null,
          location: loc?.name ?? null,
        });
      }
      // lab treasury
      for (const r of (labRes.data as any[]) || []) {
        const text = `${r.description ?? ""} ${r.beneficiary ?? ""}`;
        if (!ADVANCE_REGEX.test(text)) continue;
        const matched = resolveMatch(text, r.beneficiary ?? r.counterparty ?? null);
        const loc = matched?.current_location_id ? locMap.get(matched.current_location_id) : null;
        out.push({
          id: r.id, source: "lab", sourceLabel: SRC_LABEL.lab,
          date: r.movement_date, description: r.description, beneficiary: r.beneficiary,
          amount: Number(r.amount) || 0, status: r.status, paymentMethod: r.payment_method,
          reference: null, createdBy: r.created_by, approvedBy: r.approved_by, notes: r.notes,
          matchedEmployeeId: matched?.id ?? null, matchedName: matched?.full_name ?? null,
          department: matched?.department ?? loc?.department ?? null,
          location: loc?.name ?? null,
        });
      }
      // main treasury
      for (const r of (mainRes.data as any[]) || []) {
        const text = `${r.description ?? ""} ${r.counterparty ?? ""}`;
        if (!ADVANCE_REGEX.test(text)) continue;
        const matched = resolveMatch(text, r.beneficiary ?? r.counterparty ?? null);
        const loc = matched?.current_location_id ? locMap.get(matched.current_location_id) : null;
        out.push({
          id: r.id, source: "main", sourceLabel: SRC_LABEL.main,
          date: r.txn_date, description: r.description, beneficiary: r.counterparty,
          amount: Number(r.amount) || 0, status: r.status, paymentMethod: r.payment_method,
          reference: r.reference_no, createdBy: r.created_by, approvedBy: null, notes: null,
          matchedEmployeeId: matched?.id ?? null, matchedName: matched?.full_name ?? null,
          department: matched?.department ?? loc?.department ?? null,
          location: loc?.name ?? null,
        });
      }

      out.sort((a, b) => a.date.localeCompare(b.date));
      setRows(out);

      // earliest treasury date overall
      const candidates = [
        firstSlRes.data?.[0]?.expense_date,
        firstLabRes.data?.[0]?.movement_date,
        firstMainRes.data?.[0]?.txn_date,
      ].filter(Boolean) as string[];
      const earliest = candidates.sort()[0] ?? "";
      setFirstDate(earliest);
      if (!fromDate) setFromDate(earliest);
      if (!toDate) {
        const today = new Date().toISOString().slice(0, 10);
        setToDate(today);
      }
    } catch (e: any) {
      console.error(e);
      toast.error("فشل تحميل بيانات السلف", { description: e.message });
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (fromDate && r.date < fromDate) return false;
      if (toDate && r.date > toDate) return false;
      if (fSource !== "all" && r.source !== fSource) return false;
      if (fEmp === "__unmatched__" && r.matchedEmployeeId) return false;
      if (fEmp !== "all" && fEmp !== "__unmatched__" && r.matchedEmployeeId !== fEmp) return false;
      if (fLocation !== "all" && r.location !== fLocation) return false;
      if (fDept !== "all" && r.department !== fDept) return false;
      if (fStatus !== "all" && r.status !== fStatus) return false;
      if (fMethod !== "all" && (r.paymentMethod ?? "") !== fMethod) return false;
      return true;
    });
  }, [rows, fromDate, toDate, fSource, fEmp, fLocation, fDept, fStatus, fMethod]);

  const summary = useMemo(() => {
    const byEmp = new Map<string, { name: string; count: number; total: number; lastDate: string; employeeId: string | null }>();
    let totalMain = 0, totalLab = 0, totalSlaughter = 0, totalAll = 0;
    let unmatchedCount = 0;
    for (const r of filtered) {
      if (r.status === "rejected") continue;
      totalAll += r.amount;
      if (r.source === "main") totalMain += r.amount;
      else if (r.source === "lab") totalLab += r.amount;
      else if (r.source === "slaughter") totalSlaughter += r.amount;
      const key = r.matchedEmployeeId ?? `__u__${normalize(r.beneficiary || r.description)}`;
      const name = r.matchedName ?? (r.beneficiary?.trim() || "موظف غير مربوط بقاعدة الموظفين");
      const cur = byEmp.get(key) ?? { name, count: 0, total: 0, lastDate: r.date, employeeId: r.matchedEmployeeId };
      cur.count++;
      cur.total += r.amount;
      if (r.date > cur.lastDate) cur.lastDate = r.date;
      byEmp.set(key, cur);
      if (!r.matchedEmployeeId) unmatchedCount++;
    }
    const grouped = Array.from(byEmp.values()).sort((a, b) => b.total - a.total);
    const top = grouped[0];
    const last = filtered.filter(r => r.status !== "rejected").sort((a, b) => b.date.localeCompare(a.date))[0];
    return { byEmp: grouped, totalMain, totalLab, totalSlaughter, totalAll, unmatchedCount, top, last, empCount: grouped.length };
  }, [filtered]);

  const departments = useMemo(() => Array.from(new Set(employees.map(e => e.department).filter(Boolean))) as string[], [employees]);
  const locationNames = useMemo(() => Array.from(new Set(locations.map(l => l.name))), [locations]);
  const methods = useMemo(() => Array.from(new Set(rows.map(r => r.paymentMethod).filter(Boolean))) as string[], [rows]);

  function exportExcel() {
    const detail = filtered.map((r, i) => ({
      "#": i + 1,
      "التاريخ": r.date,
      "الموظف": r.matchedName ?? r.beneficiary ?? "غير مربوط",
      "القسم": r.department ?? "—",
      "مكان العمل": r.location ?? "—",
      "المبلغ": r.amount,
      "الخزنة": r.sourceLabel,
      "طريقة الصرف": r.paymentMethod ?? "—",
      "الوصف": r.description,
      "رقم المرجع": r.reference ?? "—",
      "الحالة": STATUS_LABEL[r.status] ?? r.status,
      "ملاحظات": r.notes ?? "—",
    }));
    const grouped = summary.byEmp.map(g => ({
      "الموظف": g.name,
      "عدد السلف": g.count,
      "إجمالي السلف": g.total,
      "آخر تاريخ سلفة": g.lastDate,
      "مربوط بقاعدة الموظفين": g.employeeId ? "نعم" : "لا",
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detail), "السلف التفصيلية");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(grouped), "مجمع حسب الموظف");
    XLSX.writeFile(wb, `تقرير_سلف_الموظفين_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function buildPrintHtml() {
    const detailRows = filtered.map((r, i) => `<tr>
      <td>${i + 1}</td>
      <td>${fmtDate(r.date)}</td>
      <td>${escapeHtml(r.matchedName ?? r.beneficiary ?? "غير مربوط")}</td>
      <td>${escapeHtml(r.department ?? "—")}</td>
      <td>${escapeHtml(r.location ?? "—")}</td>
      <td class="num">${fmtNum(r.amount, 2)}</td>
      <td>${escapeHtml(r.sourceLabel)}</td>
      <td>${escapeHtml(r.paymentMethod ?? "—")}</td>
      <td>${escapeHtml(r.description)}</td>
      <td>${escapeHtml(STATUS_LABEL[r.status] ?? r.status)}</td>
    </tr>`).join("");

    const groupedRows = summary.byEmp.map(g => `<tr>
      <td>${escapeHtml(g.name)}${g.employeeId ? "" : ' <span style="color:#c00">⚠️</span>'}</td>
      <td>${g.count}</td>
      <td class="num">${fmtNum(g.total, 2)}</td>
      <td>${fmtDate(g.lastDate)}</td>
    </tr>`).join("");

    return `
<header>
  <div>
    <h1>تقرير سلف الموظفين من بداية إنشاء الخزن</h1>
    <div class="en">Employee Advances Report — Since Inception</div>
  </div>
  <div class="meta">
    <div>${COMPANY_AR}</div>
    <div>الفترة: ${fmtDate(fromDate)} → ${fmtDate(toDate)}</div>
    <div>تاريخ الطباعة: ${new Date().toLocaleString("ar-EG")}</div>
  </div>
</header>

<div class="stats">
  <div class="stat"><div class="k">عدد الموظفين</div><div class="v">${summary.empCount}</div></div>
  <div class="stat"><div class="k">إجمالي قيمة السلف</div><div class="v">${fmtNum(summary.totalAll, 2)} ج</div></div>
  <div class="stat"><div class="k">الخزنة الرئيسية</div><div class="v">${fmtNum(summary.totalMain, 2)} ج</div></div>
  <div class="stat"><div class="k">خزنة المعمل</div><div class="v">${fmtNum(summary.totalLab, 2)} ج</div></div>
  <div class="stat"><div class="k">عهدة المجزر</div><div class="v">${fmtNum(summary.totalSlaughter, 2)} ج</div></div>
  <div class="stat"><div class="k">أكثر موظف</div><div class="v" style="font-size:11px">${escapeHtml(summary.top?.name ?? "—")}</div></div>
  <div class="stat"><div class="k">آخر سلفة</div><div class="v" style="font-size:11px">${fmtDate(summary.last?.date ?? "—")}</div></div>
  <div class="stat"><div class="k">غير مربوطة</div><div class="v">${summary.unmatchedCount}</div></div>
</div>

<h2>مجمع حسب الموظف</h2>
<table>
  <thead><tr><th>الموظف</th><th>عدد السلف</th><th>الإجمالي</th><th>آخر سلفة</th></tr></thead>
  <tbody>${groupedRows || `<tr><td colspan="4" style="text-align:center">لا توجد بيانات</td></tr>`}</tbody>
</table>

<h2>التفصيل</h2>
<table>
  <thead><tr>
    <th>#</th><th>التاريخ</th><th>الموظف</th><th>القسم</th><th>مكان العمل</th>
    <th>المبلغ</th><th>الخزنة</th><th>طريقة الصرف</th><th>الوصف</th><th>الحالة</th>
  </tr></thead>
  <tbody>${detailRows || `<tr><td colspan="10" style="text-align:center">لا توجد بيانات</td></tr>`}</tbody>
</table>

<div style="margin-top:30px; display:grid; grid-template-columns:repeat(3,1fr); gap:24px; text-align:center;">
  <div><div style="border-top:1px solid #555; padding-top:6px;">توقيع الحسابات</div></div>
  <div><div style="border-top:1px solid #555; padding-top:6px;">توقيع المدير التنفيذي</div></div>
  <div><div style="border-top:1px solid #555; padding-top:6px;">توقيع المدير العام</div></div>
</div>
`;
  }

  function printReport() {
    openPrintWindow("تقرير سلف الموظفين", buildPrintHtml());
  }

  async function saveAlias(row: AdvanceRow, employeeId: string) {
    const rawName = (row.beneficiary || row.description || "").trim();
    if (!rawName || !employeeId) return;
    const normalized = normalize(rawName);
    const sourceTable =
      row.source === "main" ? "main_treasury_transactions" :
      row.source === "lab" ? "lab_treasury_movements" : "slaughter_custody_expenses";
    try {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("hr_employee_name_aliases" as any).insert({
        raw_name: rawName,
        normalized_name: normalized,
        employee_id: employeeId,
        source_table: sourceTable,
        source_id: row.id,
        confidence: "manual",
        created_by: u?.user?.id ?? null,
      });
      if (error && !String(error.message).includes("duplicate")) throw error;
      toast.success("تم ربط الاسم بالموظف");
      setLinkRow(null);
      await loadAll();
    } catch (e: any) {
      toast.error("فشل حفظ الربط", { description: e.message });
    }
  }

  // Smart suggestions for the link dialog: prioritize employees in the same dept/source
  function suggestionsFor(row: AdvanceRow | null): Employee[] {
    if (!row) return employees;
    const text = normalize(`${row.beneficiary ?? ""} ${row.description ?? ""}`);
    const sourceDept =
      row.source === "slaughter" ? "المجزر" :
      row.source === "lab" ? "المعمل" : null;
    const score = (e: Employee) => {
      let s = 0;
      const tokens = normalize(e.full_name).split(" ").filter(t => t.length >= 2);
      for (const t of tokens) if (text.includes(t)) s += 5;
      if (sourceDept && (e.department || "").includes(sourceDept)) s += 2;
      return s;
    };
    return [...employees].sort((a, b) => score(b) - score(a));
  }

  return (
    <DashboardLayout>
      <div className="space-y-6 p-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Receipt className="text-purple-600" />
              تقرير سلف الموظفين من بداية إنشاء الخزن
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              يجمع كل حركات السلف من جميع الخزن منذ {firstDate ? fmtDate(firstDate) : "—"} حتى اليوم. (للعرض فقط)
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={printReport}><Printer className="ml-1 h-4 w-4" />طباعة</Button>
            <Button variant="outline" onClick={printReport}><FileText className="ml-1 h-4 w-4" />PDF</Button>
            <Button variant="outline" onClick={exportExcel}><FileSpreadsheet className="ml-1 h-4 w-4" />Excel</Button>
          </div>
        </div>

        {summary.unmatchedCount > 0 && (
          <div className="border border-amber-500/40 bg-amber-50 dark:bg-amber-950/20 text-amber-900 dark:text-amber-200 rounded-md p-3 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5" />
            <div className="text-sm">
              يوجد <b>{summary.unmatchedCount}</b> حركة سلفة لأسماء غير مرتبطة بجدول الموظفين. تأكد من توحيد الأسماء.
            </div>
          </div>
        )}

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <SummaryCard icon={Users} label="عدد الموظفين" value={String(summary.empCount)} color="text-blue-600" />
          <SummaryCard icon={Wallet} label="إجمالي قيمة السلف" value={`${fmtNum(summary.totalAll, 2)} ج`} color="text-purple-600" />
          <SummaryCard label="الخزنة الرئيسية" value={`${fmtNum(summary.totalMain, 2)} ج`} color="text-emerald-600" />
          <SummaryCard label="خزنة المعمل" value={`${fmtNum(summary.totalLab, 2)} ج`} color="text-orange-600" />
          <SummaryCard label="عهدة المجزر" value={`${fmtNum(summary.totalSlaughter, 2)} ج`} color="text-rose-600" />
          <SummaryCard label="أكثر موظف أخذ سلف" value={summary.top?.name ?? "—"} color="text-indigo-600" small />
          <SummaryCard label="آخر سلفة" value={summary.last ? fmtDate(summary.last.date) : "—"} color="text-slate-600" />
          <SummaryCard label="حركات غير مربوطة" value={String(summary.unmatchedCount)} color="text-amber-600" />
        </div>

        {/* Filters */}
        <Card>
          <CardHeader><CardTitle className="text-base">الفلاتر</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
              <div><Label>من تاريخ</Label><Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} /></div>
              <div><Label>إلى تاريخ</Label><Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} /></div>
              <div>
                <Label>الخزنة</Label>
                <Select value={fSource} onValueChange={setFSource}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">الكل</SelectItem>
                    <SelectItem value="main">{SRC_LABEL.main}</SelectItem>
                    <SelectItem value="lab">{SRC_LABEL.lab}</SelectItem>
                    <SelectItem value="slaughter">{SRC_LABEL.slaughter}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>الموظف</Label>
                <Select value={fEmp} onValueChange={setFEmp}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">الكل</SelectItem>
                    <SelectItem value="__unmatched__">غير مربوط بقاعدة الموظفين</SelectItem>
                    {employees.map(e => <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>القسم</Label>
                <Select value={fDept} onValueChange={setFDept}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">الكل</SelectItem>
                    {departments.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>مكان العمل</Label>
                <Select value={fLocation} onValueChange={setFLocation}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">الكل</SelectItem>
                    {locationNames.map(n => <SelectItem key={n} value={n}>{n}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>الحالة</Label>
                <Select value={fStatus} onValueChange={setFStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">الكل</SelectItem>
                    {Object.entries(STATUS_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>طريقة الصرف</Label>
                <Select value={fMethod} onValueChange={setFMethod}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">الكل</SelectItem>
                    {methods.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="detail">
          <TabsList>
            <TabsTrigger value="detail">التفصيل ({filtered.length})</TabsTrigger>
            <TabsTrigger value="grouped">مجمع حسب الموظف ({summary.byEmp.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="detail">
            <Card>
              <CardContent className="p-0 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>التاريخ</TableHead>
                      <TableHead>الموظف</TableHead>
                      <TableHead>القسم</TableHead>
                      <TableHead>مكان العمل</TableHead>
                      <TableHead>المبلغ</TableHead>
                      <TableHead>الخزنة</TableHead>
                      <TableHead>طريقة الصرف</TableHead>
                      <TableHead>الوصف</TableHead>
                      <TableHead>الحالة</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow><TableCell colSpan={10} className="text-center py-8">جارٍ التحميل…</TableCell></TableRow>
                    ) : filtered.length === 0 ? (
                      <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">لا توجد حركات سلف</TableCell></TableRow>
                    ) : filtered.map((r, i) => (
                      <TableRow key={`${r.source}-${r.id}`}>
                        <TableCell>{i + 1}</TableCell>
                        <TableCell className="whitespace-nowrap">{fmtDate(r.date)}</TableCell>
                        <TableCell>
                          {r.matchedName ? r.matchedName : (
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-amber-700 flex items-center gap-1">
                                <AlertTriangle className="h-3 w-3" /> {r.beneficiary?.trim() || "غير مربوط"}
                              </span>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs border-purple-300 text-purple-700 hover:bg-purple-50"
                                onClick={() => setLinkRow(r)}
                              >
                                <Link2 className="h-3 w-3 ml-1" /> ربط بموظف
                              </Button>
                            </div>
                          )}
                        </TableCell>
                        <TableCell>{r.department ?? "—"}</TableCell>
                        <TableCell>{r.location ?? "—"}</TableCell>
                        <TableCell className="font-mono">{fmtNum(r.amount, 2)}</TableCell>
                        <TableCell>{r.sourceLabel}</TableCell>
                        <TableCell>{r.paymentMethod ?? "—"}</TableCell>
                        <TableCell className="max-w-xs truncate" title={r.description}>{r.description}</TableCell>
                        <TableCell>
                          <Badge className={STATUS_COLOR[r.status] ?? ""}>{STATUS_LABEL[r.status] ?? r.status}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="grouped">
            <Card>
              <CardContent className="p-0 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الموظف</TableHead>
                      <TableHead>عدد السلف</TableHead>
                      <TableHead>إجمالي السلف</TableHead>
                      <TableHead>آخر تاريخ سلفة</TableHead>
                      <TableHead>الحالة</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary.byEmp.length === 0 ? (
                      <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">لا توجد بيانات</TableCell></TableRow>
                    ) : summary.byEmp.map((g, i) => (
                      <TableRow key={i}>
                        <TableCell>{g.name}</TableCell>
                        <TableCell>{g.count}</TableCell>
                        <TableCell className="font-mono">{fmtNum(g.total, 2)}</TableCell>
                        <TableCell>{fmtDate(g.lastDate)}</TableCell>
                        <TableCell>
                          {g.employeeId ? (
                            <Badge className="bg-green-500/15 text-green-700">مربوط</Badge>
                          ) : (
                            <Badge className="bg-amber-500/15 text-amber-700">غير مربوط</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <LinkEmployeeDialog
          row={linkRow}
          onClose={() => setLinkRow(null)}
          suggestions={suggestionsFor(linkRow)}
          onSave={(empId) => linkRow && saveAlias(linkRow, empId)}
        />
      </div>
    </DashboardLayout>
  );
};

function SummaryCard({ icon: Icon, label, value, color, small }: { icon?: any; label: string; value: string; color: string; small?: boolean }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-xs text-muted-foreground flex items-center gap-1">
          {Icon && <Icon className={`h-3 w-3 ${color}`} />} {label}
        </div>
        <div className={`font-bold mt-1 ${color} ${small ? "text-sm" : "text-lg"}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

export default HREmployeeAdvancesReport;
