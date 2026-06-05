import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { openPrintWindow, escapeHtml, fmtNum, fmtDate } from "@/lib/printPdf";
import * as XLSX from "xlsx";
import {
  Wallet, TrendingUp, TrendingDown, CircleDollarSign, Banknote, Smartphone, Building2,
  CreditCard, CheckCircle2, XCircle, Printer, FileSpreadsheet, Plus, Lock, Unlock,
  ShieldAlert, ScrollText, AlertTriangle, FileCheck2, Link as LinkIcon, Users, Boxes,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { OpeningBalancesPanel, ExternalCollectionsPanel, ExternalSummaryCard, TotalLabFundsCard } from "@/pages/lab-treasury/LabTreasuryExtras";

type PaymentMethod = "cash" | "vodafone_cash" | "instapay" | "bank_transfer";
type MovementType = "income" | "expense";
type Status = "pending" | "approved" | "rejected";
type IncomeCat = "hatching" | "chick_sales" | "other";
type ExpenseCat =
  | "electricity" | "maintenance" | "water"
  | "salaries_mother_farm" | "salaries_hatchery" | "salaries_brooding"
  | "medicine" | "feed_supplies" | "tools" | "transport" | "other";

interface Movement {
  id: string;
  movement_type: MovementType;
  movement_date: string;
  income_category: IncomeCat | null;
  expense_category: ExpenseCat | null;
  customer_name: string | null;
  units_count: number | null;
  unit_price: number | null;
  amount: number;
  payment_method: PaymentMethod;
  description: string | null;
  beneficiary: string | null;
  notes: string | null;
  receipt_url: string | null;
  status: Status;
  rejection_reason: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  deletion_reason: string | null;
  balance_after: number | null;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  source_table: string | null;
  source_id: string | null;
  source_ref: string | null;
}

interface DayClosure {
  id: string;
  closure_date: string;
  closed_by: string;
  closed_at: string;
  opening_balance: number;
  closing_balance: number;
  cash_balance: number;
  vodafone_balance: number;
  instapay_balance: number;
  bank_balance: number;
  total_income: number;
  total_expense: number;
  net_movement: number;
  notes: string | null;
  reopened_at: string | null;
  reopened_by: string | null;
  reopen_reason: string | null;
}

interface AuditRow {
  id: string;
  action: string;
  movement_id: string | null;
  actor_id: string | null;
  actor_name: string | null;
  reason: string | null;
  metadata: any;
  created_at: string;
}

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cash: "نقدي",
  vodafone_cash: "فودافون كاش",
  instapay: "إنستا باي",
  bank_transfer: "تحويل بنكي",
};

const INCOME_LABELS: Record<IncomeCat, string> = {
  hatching: "تفريخ بيض عملاء",
  chick_sales: "بيع كتاكيت",
  other: "إيراد آخر",
};

const EXPENSE_LABELS: Record<ExpenseCat, string> = {
  electricity: "كهرباء", maintenance: "صيانة", water: "مياه",
  salaries_mother_farm: "رواتب موظفي مزرعة الأمهات",
  salaries_hatchery: "رواتب موظفي معمل التفريخ",
  salaries_brooding: "رواتب موظفي الحضانات",
  medicine: "أدوية ومطهرات", feed_supplies: "علف ومستلزمات كتاكيت",
  tools: "أدوات تشغيل", transport: "نقل ومشاوير", other: "مصروفات أخرى",
};

const STATUS_LABELS: Record<Status, string> = {
  pending: "بانتظار الاعتماد",
  approved: "معتمدة",
  rejected: "مرفوضة",
};

const ACTION_LABELS: Record<string, string> = {
  insert_income: "إضافة إيراد", insert_expense: "إضافة مصروف",
  approve: "اعتماد حركة", reject: "رفض حركة", delete: "حذف حركة",
  update: "تعديل حركة", export_excel: "تصدير Excel", export_pdf: "تصدير PDF",
  print_report: "طباعة تقرير", close_day: "إقفال يوم", reopen_day: "إعادة فتح يوم",
  print_census: "طباعة محضر جرد",
};

const incomeSchema = z.object({
  movement_date: z.string().min(1, "التاريخ مطلوب"),
  income_category: z.enum(["hatching", "chick_sales", "other"]),
  customer_name: z.string().max(200).optional(),
  units_count: z.number().nonnegative().optional(),
  unit_price: z.number().nonnegative().optional(),
  amount: z.number().positive("المبلغ يجب أن يكون أكبر من صفر"),
  payment_method: z.enum(["cash", "vodafone_cash", "instapay", "bank_transfer"]),
  description: z.string().max(500).optional(),
  notes: z.string().max(1000).optional(),
});

const expenseSchema = z.object({
  movement_date: z.string().min(1, "التاريخ مطلوب"),
  expense_category: z.enum([
    "electricity", "maintenance", "water",
    "salaries_mother_farm", "salaries_hatchery", "salaries_brooding",
    "medicine", "feed_supplies", "tools", "transport", "other",
  ]),
  amount: z.number().positive("المبلغ يجب أن يكون أكبر من صفر"),
  payment_method: z.enum(["cash", "vodafone_cash", "instapay", "bank_transfer"]),
  description: z.string().max(500).optional(),
  beneficiary: z.string().max(200).optional(),
  notes: z.string().max(1000).optional(),
});

const today = () => new Date().toISOString().slice(0, 10);

export default function LabTreasury() {
  const { user, isGeneralManager, isExecutiveManager, roles } = useAuth();
  const navigate = useNavigate();
  const isApprover = roles.includes('lab_treasury_approver');
  const isManager = isGeneralManager || isExecutiveManager; // full admin (delete/reopen)
  const canApprove = isManager || isApprover;

  const [movements, setMovements] = useState<Movement[]>([]);
  const [closures, setClosures] = useState<DayClosure[]>([]);
  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [openingByMethod, setOpeningByMethod] = useState<Record<PaymentMethod, number>>({ cash: 0, vodafone_cash: 0, instapay: 0, bank_transfer: 0 });
  const [loading, setLoading] = useState(true);

  // filters
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [fType, setFType] = useState<string>("all");
  const [fCategory, setFCategory] = useState<string>("all");
  const [fPayment, setFPayment] = useState<string>("all");
  const [fStatus, setFStatus] = useState<string>("all");
  const [fCustomer, setFCustomer] = useState("");

  // forms
  const [incForm, setIncForm] = useState({
    movement_date: today(), income_category: "hatching" as IncomeCat,
    customer_name: "", units_count: "" as any, unit_price: "" as any, amount: "" as any,
    payment_method: "cash" as PaymentMethod, description: "", notes: "",
  });
  const [incReceipt, setIncReceipt] = useState<File | null>(null);

  const [expForm, setExpForm] = useState({
    movement_date: today(), expense_category: "electricity" as ExpenseCat,
    amount: "" as any, payment_method: "cash" as PaymentMethod,
    description: "", beneficiary: "", notes: "",
  });
  const [expReceipt, setExpReceipt] = useState<File | null>(null);

  // dialogs
  const [rejectDlg, setRejectDlg] = useState<{ open: boolean; movement: Movement | null; reason: string }>({ open: false, movement: null, reason: "" });
  const [deleteDlg, setDeleteDlg] = useState<{ open: boolean; movement: Movement | null; reason: string }>({ open: false, movement: null, reason: "" });
  const [closeDayDlg, setCloseDayDlg] = useState<{ open: boolean; date: string; notes: string }>({ open: false, date: today(), notes: "" });
  const [reopenDlg, setReopenDlg] = useState<{ open: boolean; closure: DayClosure | null; reason: string }>({ open: false, closure: null, reason: "" });

  // daily report
  const [reportDate, setReportDate] = useState(today());
  const [reportData, setReportData] = useState<any>(null);

  async function fetchData() {
    setLoading(true);
    const [{ data: mvs, error: e1 }, { data: cls }, { data: aud }, { data: ops }] = await Promise.all([
      (supabase as any).from("lab_treasury_movements").select("*").order("movement_date", { ascending: false }).order("created_at", { ascending: false }).limit(1000),
      (supabase as any).from("lab_treasury_day_closures").select("*").order("closure_date", { ascending: false }).limit(200),
      canApprove
        ? (supabase as any).from("lab_treasury_audit_log").select("*").order("created_at", { ascending: false }).limit(500)
        : Promise.resolve({ data: [] }),
      (supabase as any).from("lab_treasury_opening_balances").select("cash_amount,vodafone_cash_amount,instapay_amount,bank_transfer_amount,status").eq("status", "approved"),
    ]);
    if (e1) { toast.error("فشل تحميل الخزنة: " + e1.message); setLoading(false); return; }
    const list = (mvs || []) as Movement[];
    setMovements(list);
    setClosures((cls || []) as DayClosure[]);
    setAuditRows((aud || []) as AuditRow[]);
    const op: Record<PaymentMethod, number> = { cash: 0, vodafone_cash: 0, instapay: 0, bank_transfer: 0 };
    (ops || []).forEach((o: any) => {
      op.cash += Number(o.cash_amount || 0);
      op.vodafone_cash += Number(o.vodafone_cash_amount || 0);
      op.instapay += Number(o.instapay_amount || 0);
      op.bank_transfer += Number(o.bank_transfer_amount || 0);
    });
    setOpeningByMethod(op);

    const ids = Array.from(new Set([
      ...list.flatMap((m) => [m.created_by, m.approved_by, m.rejected_by]),
      ...(cls || []).flatMap((c: any) => [c.closed_by, c.reopened_by]),
      ...(aud || []).map((a: any) => a.actor_id),
    ].filter(Boolean))) as string[];
    if (ids.length) {
      const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", ids);
      const map: Record<string, string> = {};
      (profs || []).forEach((p: any) => { map[p.id] = p.full_name || ""; });
      setProfiles(map);
    }
    setLoading(false);
  }

  useEffect(() => { fetchData(); }, []);

  useEffect(() => {
    const ch = supabase
      .channel("lab-treasury-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "lab_treasury_movements" }, () => fetchData())
      .on("postgres_changes", { event: "*", schema: "public", table: "lab_treasury_day_closures" }, () => fetchData())
      .on("postgres_changes", { event: "*", schema: "public", table: "lab_treasury_opening_balances" }, () => fetchData())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  // ---- Audit helper ----
  async function logAudit(action: string, opts: { movement_id?: string; reason?: string; before?: any; after?: any; metadata?: any } = {}) {
    if (!user) return;
    await (supabase as any).from("lab_treasury_audit_log").insert({
      action,
      movement_id: opts.movement_id ?? null,
      actor_id: user.id,
      actor_name: profiles[user.id] || user.email || null,
      reason: opts.reason ?? null,
      before_data: opts.before ?? null,
      after_data: opts.after ?? null,
      metadata: opts.metadata ?? null,
    });
  }

  // ---- Derived balances ----
  const approved = useMemo(() => movements.filter((m) => m.status === "approved"), [movements]);
  const pending = useMemo(() => movements.filter((m) => m.status === "pending"), [movements]);

  const officialByMethod = useMemo(() => {
    const map: Record<PaymentMethod, number> = { ...openingByMethod };
    approved.forEach((m) => { map[m.payment_method] += (m.movement_type === "income" ? 1 : -1) * Number(m.amount); });
    return map;
  }, [approved, openingByMethod]);
  const estimatedByMethod = useMemo(() => {
    const map: Record<PaymentMethod, number> = { ...officialByMethod };
    pending.forEach((m) => { map[m.payment_method] += (m.movement_type === "income" ? 1 : -1) * Number(m.amount); });
    return map;
  }, [officialByMethod, pending]);

  const officialTotal = officialByMethod.cash + officialByMethod.vodafone_cash + officialByMethod.instapay + officialByMethod.bank_transfer;
  const estimatedTotal = estimatedByMethod.cash + estimatedByMethod.vodafone_cash + estimatedByMethod.instapay + estimatedByMethod.bank_transfer;
  const pendingTotal = estimatedTotal - officialTotal;
  const openingTotal = openingByMethod.cash + openingByMethod.vodafone_cash + openingByMethod.instapay + openingByMethod.bank_transfer;

  const todayStr = today();
  const monthStart = todayStr.slice(0, 7);
  const todayIncome = approved.filter((m) => m.movement_date === todayStr && m.movement_type === "income").reduce((s, m) => s + Number(m.amount), 0);
  const todayExpense = approved.filter((m) => m.movement_date === todayStr && m.movement_type === "expense").reduce((s, m) => s + Number(m.amount), 0);
  const monthIncome = approved.filter((m) => m.movement_date.startsWith(monthStart) && m.movement_type === "income").reduce((s, m) => s + Number(m.amount), 0);
  const monthExpense = approved.filter((m) => m.movement_date.startsWith(monthStart) && m.movement_type === "expense").reduce((s, m) => s + Number(m.amount), 0);

  const closedDates = useMemo(() => new Set(closures.filter((c) => !c.reopened_at).map((c) => c.closure_date)), [closures]);

  const filtered = useMemo(() => {
    return movements.filter((m) => {
      if (fromDate && m.movement_date < fromDate) return false;
      if (toDate && m.movement_date > toDate) return false;
      if (fType !== "all" && m.movement_type !== fType) return false;
      if (fPayment !== "all" && m.payment_method !== fPayment) return false;
      if (fStatus !== "all" && m.status !== fStatus) return false;
      if (fCategory !== "all" && m.income_category !== fCategory && m.expense_category !== fCategory) return false;
      if (fCustomer && !(m.customer_name || "").toLowerCase().includes(fCustomer.toLowerCase())) return false;
      return true;
    });
  }, [movements, fromDate, toDate, fType, fCategory, fPayment, fStatus, fCustomer]);

  // ---- Expense balance check (UI warning) ----
  const expAmountNum = Number(expForm.amount) || 0;
  const expAvailable = officialByMethod[expForm.payment_method] ?? 0;
  const expExceeds = expAmountNum > 0 && expAmountNum > expAvailable;

  async function uploadReceipt(file: File | null): Promise<string | null> {
    if (!file || !user) return null;
    const path = `${user.id}/${Date.now()}-${file.name.replace(/[^\w.\-]/g, "_")}`;
    const { error } = await supabase.storage.from("lab-treasury-receipts").upload(path, file, { upsert: false });
    if (error) { toast.error("فشل رفع الإيصال: " + error.message); return null; }
    return path;
  }

  async function submitIncome() {
    if (!user) return;
    const parsed = incomeSchema.safeParse({
      ...incForm,
      units_count: incForm.units_count === "" ? undefined : Number(incForm.units_count),
      unit_price: incForm.unit_price === "" ? undefined : Number(incForm.unit_price),
      amount: Number(incForm.amount),
    });
    if (!parsed.success) { toast.error(parsed.error.errors[0]?.message || "تحقق من الحقول"); return; }
    const receipt_url = await uploadReceipt(incReceipt);
    const payload = {
      movement_type: "income" as const,
      movement_date: parsed.data.movement_date,
      income_category: parsed.data.income_category,
      customer_name: parsed.data.customer_name || null,
      units_count: parsed.data.units_count ?? null,
      unit_price: parsed.data.unit_price ?? null,
      amount: parsed.data.amount,
      payment_method: parsed.data.payment_method,
      description: parsed.data.description || null,
      notes: parsed.data.notes || null,
      receipt_url,
      created_by: user.id,
      status: "pending" as const,
    };
    const { data, error } = await (supabase as any).from("lab_treasury_movements").insert(payload).select().single();
    if (error) { toast.error("فشل التسجيل: " + error.message); return; }
    await logAudit("insert_income", { movement_id: data?.id, after: payload });
    toast.success("تم تسجيل الإيراد — بانتظار الاعتماد");
    setIncForm({ ...incForm, customer_name: "", units_count: "", unit_price: "", amount: "", description: "", notes: "" });
    setIncReceipt(null);
    fetchData();
  }

  async function submitExpense() {
    if (!user) return;
    const parsed = expenseSchema.safeParse({ ...expForm, amount: Number(expForm.amount) });
    if (!parsed.success) { toast.error(parsed.error.errors[0]?.message || "تحقق من الحقول"); return; }
    if (expExceeds && !isManager) {
      toast.error(`الرصيد المتاح في ${PAYMENT_LABELS[expForm.payment_method]} غير كافٍ (${fmtNum(expAvailable, 2)} ج). يلزم اعتماد المدير العام أو التنفيذي.`);
      return;
    }
    if (expExceeds && isManager) {
      if (!confirm(`تحذير: المبلغ يتجاوز الرصيد المتاح في ${PAYMENT_LABELS[expForm.payment_method]} (${fmtNum(expAvailable, 2)} ج). هل تريد المتابعة بصلاحية الإدارة؟`)) return;
    }
    const receipt_url = await uploadReceipt(expReceipt);
    const payload = {
      movement_type: "expense" as const,
      movement_date: parsed.data.movement_date,
      expense_category: parsed.data.expense_category,
      amount: parsed.data.amount,
      payment_method: parsed.data.payment_method,
      description: parsed.data.description || null,
      beneficiary: parsed.data.beneficiary || null,
      notes: parsed.data.notes || null,
      receipt_url,
      created_by: user.id,
      status: "pending" as const,
    };
    const { data, error } = await (supabase as any).from("lab_treasury_movements").insert(payload).select().single();
    if (error) { toast.error("فشل التسجيل: " + error.message); return; }
    await logAudit("insert_expense", { movement_id: data?.id, after: payload, metadata: expExceeds ? { override: true, available: expAvailable } : null });
    toast.success("تم تسجيل المصروف — بانتظار الاعتماد");
    setExpForm({ ...expForm, amount: "", description: "", beneficiary: "", notes: "" });
    setExpReceipt(null);
    fetchData();
  }

  async function approve(m: Movement) {
    const { error } = await (supabase as any).from("lab_treasury_movements")
      .update({ status: "approved" }).eq("id", m.id);
    if (error) { toast.error("فشل الاعتماد: " + error.message); return; }
    await logAudit("approve", { movement_id: m.id, before: { status: m.status }, after: { status: "approved" } });
    toast.success("تم اعتماد الحركة");
    fetchData();
  }

  async function confirmReject() {
    if (!rejectDlg.movement) return;
    const reason = rejectDlg.reason.trim();
    if (reason.length < 3) { toast.error("سبب الرفض إلزامي (3 أحرف على الأقل)"); return; }
    const m = rejectDlg.movement;
    const { error } = await (supabase as any).from("lab_treasury_movements")
      .update({ status: "rejected", rejection_reason: reason }).eq("id", m.id);
    if (error) { toast.error("فشل الرفض: " + error.message); return; }
    await logAudit("reject", { movement_id: m.id, reason, before: { status: m.status }, after: { status: "rejected" } });
    toast.success("تم رفض الحركة");
    setRejectDlg({ open: false, movement: null, reason: "" });
    fetchData();
  }

  async function confirmDelete() {
    if (!deleteDlg.movement) return;
    const reason = deleteDlg.reason.trim();
    if (reason.length < 3) { toast.error("سبب الحذف إلزامي (3 أحرف على الأقل)"); return; }
    const m = deleteDlg.movement;
    // Log first so we keep audit even if delete cascades
    await logAudit("delete", { movement_id: m.id, reason, before: m });
    const { error } = await (supabase as any).from("lab_treasury_movements").delete().eq("id", m.id);
    if (error) { toast.error("فشل الحذف: " + error.message); return; }
    toast.success("تم الحذف وتسجيله في سجل التدقيق");
    setDeleteDlg({ open: false, movement: null, reason: "" });
    fetchData();
  }

  // ---- Day closures ----
  function buildDayClosurePayload(date: string) {
    const dayMovs = approved.filter((m) => m.movement_date === date);
    const incomeT = dayMovs.filter((m) => m.movement_type === "income").reduce((s, m) => s + Number(m.amount), 0);
    const expenseT = dayMovs.filter((m) => m.movement_type === "expense").reduce((s, m) => s + Number(m.amount), 0);
    const opening = approved.filter((m) => m.movement_date < date).reduce((s, m) =>
      s + (m.movement_type === "income" ? 1 : -1) * Number(m.amount), 0);
    const closing = opening + incomeT - expenseT;
    // closing balances by method up to and including this date
    const upTo = approved.filter((m) => m.movement_date <= date);
    const byM: Record<PaymentMethod, number> = { cash: 0, vodafone_cash: 0, instapay: 0, bank_transfer: 0 };
    upTo.forEach((m) => { byM[m.payment_method] += (m.movement_type === "income" ? 1 : -1) * Number(m.amount); });
    return {
      opening_balance: opening, closing_balance: closing,
      total_income: incomeT, total_expense: expenseT, net_movement: incomeT - expenseT,
      cash_balance: byM.cash, vodafone_balance: byM.vodafone_cash,
      instapay_balance: byM.instapay, bank_balance: byM.bank_transfer,
    };
  }

  async function closeDay() {
    if (!user || !isManager) return;
    const date = closeDayDlg.date;
    if (closedDates.has(date)) { toast.error("هذا اليوم مُقفل بالفعل"); return; }
    const hasPending = movements.some((m) => m.movement_date === date && m.status === "pending");
    if (hasPending && !confirm("يوجد حركات بانتظار الاعتماد لهذا اليوم. متابعة الإقفال؟")) return;
    const payload = { closure_date: date, closed_by: user.id, notes: closeDayDlg.notes || null, ...buildDayClosurePayload(date) };
    const { error } = await (supabase as any).from("lab_treasury_day_closures").insert(payload);
    if (error) { toast.error("فشل الإقفال: " + error.message); return; }
    await logAudit("close_day", { metadata: { date, ...payload } });
    toast.success(`تم إقفال يوم ${date}`);
    setCloseDayDlg({ open: false, date: today(), notes: "" });
    fetchData();
  }

  async function reopenDay() {
    if (!user || !isGeneralManager || !reopenDlg.closure) return;
    const reason = reopenDlg.reason.trim();
    if (reason.length < 3) { toast.error("سبب إعادة الفتح إلزامي"); return; }
    const c = reopenDlg.closure;
    const { error } = await (supabase as any).from("lab_treasury_day_closures")
      .update({ reopened_at: new Date().toISOString(), reopened_by: user.id, reopen_reason: reason })
      .eq("id", c.id);
    if (error) { toast.error("فشل إعادة الفتح: " + error.message); return; }
    await logAudit("reopen_day", { reason, metadata: { date: c.closure_date } });
    toast.success("تمت إعادة فتح اليوم");
    setReopenDlg({ open: false, closure: null, reason: "" });
    fetchData();
  }

  // ---- Daily report ----
  async function loadDailyReport() {
    const { data, error } = await (supabase as any).rpc("lab_treasury_daily_report", { p_date: reportDate });
    if (error) { toast.error("فشل تحميل التقرير: " + error.message); return; }
    setReportData(data);
  }
  useEffect(() => { loadDailyReport(); }, [reportDate]);

  // ---- Source navigation ----
  function openSource(m: Movement) {
    if (!m.source_table) return;
    switch (m.source_table) {
      case "hatch_customer_payments":
      case "hatchery_invoice_payments":
        navigate("/hatchery-payments");
        break;
      case "brooding_chick_sales":
        navigate("/modules/brooding");
        break;
      default:
        toast.info(`المصدر: ${m.source_table} #${m.source_id?.slice(0, 8) || ""}`);
    }
  }

  // ---- Operational reports (server-side via RPC) ----
  const [opReportType, setOpReportType] = useState<"hatching_customer" | "hatching_batch" | "chicksales_batch" | "chicksales_customer" | "net">("hatching_customer");
  const [opRows, setOpRows] = useState<any[]>([]);
  const [opNet, setOpNet] = useState<any>(null);
  const [opFrom, setOpFrom] = useState("");
  const [opTo, setOpTo] = useState("");

  async function loadOpReport() {
    const fn = {
      hatching_customer: "lab_treasury_hatching_by_customer",
      hatching_batch: "lab_treasury_hatching_by_batch",
      chicksales_batch: "lab_treasury_chicksales_by_batch",
      chicksales_customer: "lab_treasury_chicksales_by_customer",
      net: "lab_treasury_net_operation",
    }[opReportType];
    const { data, error } = await (supabase as any).rpc(fn, { p_from: opFrom || null, p_to: opTo || null });
    if (error) { toast.error("فشل التقرير: " + error.message); return; }
    if (opReportType === "net") { setOpNet(data); setOpRows([]); }
    else { setOpRows(data || []); setOpNet(null); }
  }
  useEffect(() => { loadOpReport(); }, [opReportType, opFrom, opTo]);

  // ---- Exports ----
  async function exportExcel() {
    const rows = filtered.map((m) => ({
      "التاريخ": m.movement_date,
      "النوع": m.movement_type === "income" ? "إيراد" : "مصروف",
      "البيان": m.movement_type === "income"
        ? INCOME_LABELS[m.income_category as IncomeCat] || ""
        : EXPENSE_LABELS[m.expense_category as ExpenseCat] || "",
      "العميل/المستفيد": m.customer_name || m.beneficiary || "",
      "وارد": m.movement_type === "income" ? Number(m.amount) : 0,
      "منصرف": m.movement_type === "expense" ? Number(m.amount) : 0,
      "طريقة الدفع": PAYMENT_LABELS[m.payment_method],
      "الرصيد بعد": m.balance_after ?? "",
      "الحالة": STATUS_LABELS[m.status],
      "سجّل بواسطة": profiles[m.created_by || ""] || "",
      "ملاحظات": m.notes || "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "خزنة المعمل");
    XLSX.writeFile(wb, `lab-treasury-${todayStr}.xlsx`);
    await logAudit("export_excel", { metadata: { count: rows.length, filters: { fromDate, toDate, fType, fCategory, fPayment, fStatus } } });
  }

  async function printReport(title: string) {
    const rowsHtml = filtered.map((m) => `
      <tr>
        <td>${escapeHtml(m.movement_date)}</td>
        <td>${m.movement_type === "income" ? "إيراد" : "مصروف"}</td>
        <td>${escapeHtml(m.movement_type === "income"
          ? INCOME_LABELS[m.income_category as IncomeCat] || ""
          : EXPENSE_LABELS[m.expense_category as ExpenseCat] || "")}</td>
        <td>${escapeHtml(m.customer_name || m.beneficiary || "")}</td>
        <td class="num">${m.movement_type === "income" ? fmtNum(m.amount, 2) : "—"}</td>
        <td class="num">${m.movement_type === "expense" ? fmtNum(m.amount, 2) : "—"}</td>
        <td>${PAYMENT_LABELS[m.payment_method]}</td>
        <td class="num">${m.balance_after != null ? fmtNum(m.balance_after, 2) : "—"}</td>
        <td>${STATUS_LABELS[m.status]}</td>
      </tr>`).join("");
    const totalIn = filtered.filter((m) => m.movement_type === "income" && m.status === "approved").reduce((s, m) => s + Number(m.amount), 0);
    const totalOut = filtered.filter((m) => m.movement_type === "expense" && m.status === "approved").reduce((s, m) => s + Number(m.amount), 0);
    const body = `
      <header><div><h1>${escapeHtml(title)}</h1><div class="en">Lab & Brooding Treasury</div></div>
        <div class="meta">${fmtDate(new Date())}</div></header>
      <div class="stats">
        <div class="stat"><div class="k">إجمالي الوارد</div><div class="v num">${fmtNum(totalIn, 2)}</div></div>
        <div class="stat"><div class="k">إجمالي المنصرف</div><div class="v num">${fmtNum(totalOut, 2)}</div></div>
        <div class="stat"><div class="k">صافي الحركة</div><div class="v num">${fmtNum(totalIn - totalOut, 2)}</div></div>
      </div>
      <table>
        <thead><tr><th>التاريخ</th><th>النوع</th><th>البيان</th><th>العميل/المستفيد</th>
          <th>وارد</th><th>منصرف</th><th>طريقة الدفع</th><th>الرصيد بعد</th><th>الحالة</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>`;
    openPrintWindow(title, body);
    await logAudit("export_pdf", { metadata: { title } });
  }

  async function printDailyReport() {
    if (!reportData) { await loadDailyReport(); return; }
    const r = reportData;
    const body = `
      <header><div><h1>التقرير اليومي - خزنة المعمل والحضانات</h1></div>
        <div class="meta">${escapeHtml(r.date)}</div></header>
      <div class="stats">
        <div class="stat"><div class="k">رصيد أول اليوم</div><div class="v num">${fmtNum(r.opening_balance, 2)}</div></div>
        <div class="stat"><div class="k">إجمالي الإيرادات</div><div class="v num">${fmtNum(r.income_total, 2)}</div></div>
        <div class="stat"><div class="k">إجمالي المصروفات</div><div class="v num">${fmtNum(r.expense_total, 2)}</div></div>
        <div class="stat"><div class="k">صافي الحركة</div><div class="v num">${fmtNum(r.net_movement, 2)}</div></div>
        <div class="stat"><div class="k">رصيد آخر اليوم</div><div class="v num">${fmtNum(r.closing_balance, 2)}</div></div>
        <div class="stat"><div class="k">حركات معلقة</div><div class="v num">${r.pending_count}</div></div>
        <div class="stat"><div class="k">حركات مرفوضة</div><div class="v num">${r.rejected_count}</div></div>
      </div>
      <h3>الرصيد حسب طريقة الدفع (نهاية اليوم)</h3>
      <table><thead><tr><th>طريقة الدفع</th><th>الرصيد</th></tr></thead><tbody>
        ${Object.entries(r.by_method || {}).map(([k, v]) => `<tr><td>${PAYMENT_LABELS[k as PaymentMethod] || k}</td><td class="num">${fmtNum(Number(v), 2)}</td></tr>`).join("")}
      </tbody></table>`;
    openPrintWindow("تقرير يومي - خزنة المعمل", body);
    await logAudit("print_report", { metadata: { date: r.date } });
  }

  async function printCensus() {
    const body = `
      <header><div><h1>محضر جرد خزنة المعمل والحضانات</h1></div>
        <div class="meta">${fmtDate(new Date())}</div></header>
      <table><tbody>
        <tr><th>التاريخ</th><td>${todayStr}</td></tr>
        <tr><th>مسؤول الخزنة</th><td>محمد خالد</td></tr>
        <tr><th>الرصيد النقدي</th><td class="num">${fmtNum(officialByMethod.cash, 2)} ج</td></tr>
        <tr><th>رصيد فودافون كاش</th><td class="num">${fmtNum(officialByMethod.vodafone_cash, 2)} ج</td></tr>
        <tr><th>رصيد إنستا باي</th><td class="num">${fmtNum(officialByMethod.instapay, 2)} ج</td></tr>
        <tr><th>رصيد التحويل البنكي</th><td class="num">${fmtNum(officialByMethod.bank_transfer, 2)} ج</td></tr>
        <tr><th>إجمالي الرصيد</th><td class="num"><b>${fmtNum(officialTotal, 2)} ج</b></td></tr>
      </tbody></table>
      <div style="margin-top:60px;display:flex;justify-content:space-between;gap:40px;">
        <div style="flex:1;text-align:center;">
          <div style="border-top:1px solid #000;padding-top:8px;margin-top:60px;">توقيع مسؤول الخزنة<br/>(محمد خالد)</div>
        </div>
        <div style="flex:1;text-align:center;">
          <div style="border-top:1px solid #000;padding-top:8px;margin-top:60px;">توقيع المدير / المحاسب</div>
        </div>
      </div>`;
    openPrintWindow("محضر جرد خزنة المعمل والحضانات", body);
    await logAudit("print_census", { metadata: { totals: officialByMethod, total: officialTotal } });
  }

  // ---- Render ----
  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <Wallet className="w-7 h-7 text-primary" />
            <h1 className="text-2xl font-bold">خزنة المعمل والحضانات</h1>
            <Badge variant="outline">المسؤول: محمد خالد</Badge>
          </div>
          <Button variant="outline" onClick={printCensus} className="gap-2">
            <FileCheck2 className="w-4 h-4" />محضر جرد الخزنة
          </Button>
        </div>

        <Tabs defaultValue="dashboard" className="w-full">
          <TabsList className="flex flex-wrap h-auto">
            <TabsTrigger value="dashboard">لوحة الخزنة</TabsTrigger>
            <TabsTrigger value="income">إضافة إيراد</TabsTrigger>
            <TabsTrigger value="expense">إضافة مصروف</TabsTrigger>
            <TabsTrigger value="log">سجل الحركات</TabsTrigger>
            {canApprove && <TabsTrigger value="approvals">الاعتمادات</TabsTrigger>}
            <TabsTrigger value="daily">التقرير اليومي</TabsTrigger>
            <TabsTrigger value="closures">إقفال الأيام</TabsTrigger>
            <TabsTrigger value="openings">الأرصدة الافتتاحية</TabsTrigger>
            <TabsTrigger value="external">التحصيلات الخارجية</TabsTrigger>
            <TabsTrigger value="reports">التقارير</TabsTrigger>
            {canApprove && <TabsTrigger value="audit">سجل التدقيق</TabsTrigger>}
          </TabsList>

          {/* Dashboard */}
          <TabsContent value="dashboard" className="space-y-4">
            <Alert>
              <ShieldAlert className="w-4 h-4" />
              <AlertTitle>الرصيد الرسمي vs التقديري</AlertTitle>
              <AlertDescription className="text-xs">
                الرصيد الرسمي يُحتسب من الحركات <b>المعتمدة فقط</b>. الرصيد التقديري يشمل الحركات بانتظار الاعتماد كمؤشر داخلي.
              </AlertDescription>
            </Alert>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <StatCard icon={<CheckCircle2 />} title="الرصيد الرسمي المعتمد" value={fmtNum(officialTotal, 2)} accent />
              <StatCard icon={<CircleDollarSign />} title="الرصيد التقديري (مع المعلق)" value={fmtNum(estimatedTotal, 2)} />
              <StatCard icon={<AlertTriangle />} title="صافي الحركات المعلقة" value={fmtNum(pendingTotal, 2)} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <ExternalSummaryCard />
              <TotalLabFundsCard officialTotal={officialTotal} />
            </div>

            <Card>
              <CardHeader><CardTitle>الرصيد حسب طريقة الدفع</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>طريقة الدفع</TableHead>
                      <TableHead className="text-end">الرسمي (معتمد)</TableHead>
                      <TableHead className="text-end">التقديري (+ معلق)</TableHead>
                      <TableHead className="text-end">الفرق</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(["cash", "vodafone_cash", "instapay", "bank_transfer"] as PaymentMethod[]).map((pm) => (
                      <TableRow key={pm}>
                        <TableCell className="flex items-center gap-2">
                          {pm === "cash" && <Banknote className="w-4 h-4" />}
                          {pm === "vodafone_cash" && <Smartphone className="w-4 h-4" />}
                          {pm === "instapay" && <CreditCard className="w-4 h-4" />}
                          {pm === "bank_transfer" && <Building2 className="w-4 h-4" />}
                          {PAYMENT_LABELS[pm]}
                        </TableCell>
                        <TableCell className="text-end font-mono font-semibold">{fmtNum(officialByMethod[pm], 2)}</TableCell>
                        <TableCell className="text-end font-mono">{fmtNum(estimatedByMethod[pm], 2)}</TableCell>
                        <TableCell className="text-end font-mono text-muted-foreground">{fmtNum(estimatedByMethod[pm] - officialByMethod[pm], 2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard icon={<TrendingUp />} title="إيرادات اليوم" value={fmtNum(todayIncome, 2)} />
              <StatCard icon={<TrendingDown />} title="مصروفات اليوم" value={fmtNum(todayExpense, 2)} />
              <StatCard icon={<TrendingUp />} title="إيرادات الشهر" value={fmtNum(monthIncome, 2)} />
              <StatCard icon={<TrendingDown />} title="مصروفات الشهر" value={fmtNum(monthExpense, 2)} />
            </div>
          </TabsContent>

          {/* Income form */}
          <TabsContent value="income">
            <Card>
              <CardHeader><CardTitle>إضافة إيراد جديد</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                <Field label="التاريخ"><Input type="date" value={incForm.movement_date} onChange={(e) => setIncForm({ ...incForm, movement_date: e.target.value })} /></Field>
                <Field label="نوع الإيراد">
                  <Select value={incForm.income_category} onValueChange={(v) => setIncForm({ ...incForm, income_category: v as IncomeCat })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(INCOME_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field label="اسم العميل"><Input value={incForm.customer_name} onChange={(e) => setIncForm({ ...incForm, customer_name: e.target.value })} /></Field>
                <Field label="العدد (بيض/كتاكيت)"><Input type="number" value={incForm.units_count} onChange={(e) => setIncForm({ ...incForm, units_count: e.target.value })} /></Field>
                <Field label="سعر الوحدة"><Input type="number" value={incForm.unit_price} onChange={(e) => {
                  const up = e.target.value; const units = Number(incForm.units_count) || 0;
                  setIncForm({ ...incForm, unit_price: up, amount: up && units ? String(Number(up) * units) : incForm.amount });
                }} /></Field>
                <Field label="إجمالي المبلغ *"><Input type="number" value={incForm.amount} onChange={(e) => setIncForm({ ...incForm, amount: e.target.value })} /></Field>
                <Field label="طريقة التحصيل">
                  <Select value={incForm.payment_method} onValueChange={(v) => setIncForm({ ...incForm, payment_method: v as PaymentMethod })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(PAYMENT_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field label="الوصف"><Input value={incForm.description} onChange={(e) => setIncForm({ ...incForm, description: e.target.value })} /></Field>
                <Field label="صورة الإيصال"><Input type="file" accept="image/*,application/pdf" onChange={(e) => setIncReceipt(e.target.files?.[0] || null)} /></Field>
                <div className="md:col-span-2 lg:col-span-3">
                  <Field label="ملاحظات"><Textarea value={incForm.notes} onChange={(e) => setIncForm({ ...incForm, notes: e.target.value })} /></Field>
                </div>
                <div className="md:col-span-2 lg:col-span-3">
                  <Button onClick={submitIncome} className="gap-2"><Plus className="w-4 h-4" />تسجيل الإيراد</Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Expense form */}
          <TabsContent value="expense">
            <Card>
              <CardHeader><CardTitle>إضافة مصروف جديد</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                <Field label="التاريخ"><Input type="date" value={expForm.movement_date} onChange={(e) => setExpForm({ ...expForm, movement_date: e.target.value })} /></Field>
                <Field label="بند المصروف">
                  <Select value={expForm.expense_category} onValueChange={(v) => setExpForm({ ...expForm, expense_category: v as ExpenseCat })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(EXPENSE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field label="المبلغ *"><Input type="number" value={expForm.amount} onChange={(e) => setExpForm({ ...expForm, amount: e.target.value })} /></Field>
                <Field label="طريقة الدفع">
                  <Select value={expForm.payment_method} onValueChange={(v) => setExpForm({ ...expForm, payment_method: v as PaymentMethod })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(PAYMENT_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field label="المستفيد / الجهة"><Input value={expForm.beneficiary} onChange={(e) => setExpForm({ ...expForm, beneficiary: e.target.value })} /></Field>
                <Field label="الوصف"><Input value={expForm.description} onChange={(e) => setExpForm({ ...expForm, description: e.target.value })} /></Field>
                <Field label="صورة الإيصال"><Input type="file" accept="image/*,application/pdf" onChange={(e) => setExpReceipt(e.target.files?.[0] || null)} /></Field>
                <div className="md:col-span-2 lg:col-span-3">
                  <Field label="ملاحظات"><Textarea value={expForm.notes} onChange={(e) => setExpForm({ ...expForm, notes: e.target.value })} /></Field>
                </div>
                <div className="md:col-span-2 lg:col-span-3 space-y-2">
                  <div className="text-sm text-muted-foreground">
                    الرصيد المتاح في {PAYMENT_LABELS[expForm.payment_method]}: <span className="font-mono font-semibold">{fmtNum(expAvailable, 2)} ج</span>
                  </div>
                  {expExceeds && (
                    <Alert variant="destructive">
                      <AlertTriangle className="w-4 h-4" />
                      <AlertTitle>المبلغ يتجاوز الرصيد المتاح</AlertTitle>
                      <AlertDescription>
                        {isManager
                          ? "بصلاحيتك يمكنك المتابعة، وسيُسجل التجاوز في سجل التدقيق."
                          : "لا يمكن الحفظ. يلزم اعتماد المدير العام أو التنفيذي."}
                      </AlertDescription>
                    </Alert>
                  )}
                  <Button onClick={submitExpense} disabled={expExceeds && !isManager} className="gap-2">
                    <Plus className="w-4 h-4" />تسجيل المصروف
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Log */}
          <TabsContent value="log" className="space-y-3">
            <Card>
              <CardHeader><CardTitle>فلاتر</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
                <Field label="من"><Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></Field>
                <Field label="إلى"><Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} /></Field>
                <Field label="النوع">
                  <Select value={fType} onValueChange={setFType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">الكل</SelectItem>
                      <SelectItem value="income">إيراد</SelectItem>
                      <SelectItem value="expense">مصروف</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="التصنيف">
                  <Select value={fCategory} onValueChange={setFCategory}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">الكل</SelectItem>
                      {Object.entries(INCOME_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                      {Object.entries(EXPENSE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="طريقة الدفع">
                  <Select value={fPayment} onValueChange={setFPayment}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">الكل</SelectItem>
                      {Object.entries(PAYMENT_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="الحالة">
                  <Select value={fStatus} onValueChange={setFStatus}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">الكل</SelectItem>
                      {Object.entries(STATUS_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="العميل"><Input value={fCustomer} onChange={(e) => setFCustomer(e.target.value)} placeholder="بحث..." /></Field>
              </CardContent>
            </Card>

            <div className="flex gap-2 flex-wrap">
              <Button variant="outline" onClick={exportExcel} className="gap-2"><FileSpreadsheet className="w-4 h-4" />Excel</Button>
              <Button variant="outline" onClick={() => printReport("كشف حركة خزنة المعمل والحضانات")} className="gap-2"><Printer className="w-4 h-4" />طباعة / PDF</Button>
            </div>

            <Card>
              <CardContent className="p-0 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>التاريخ</TableHead>
                      <TableHead>النوع</TableHead>
                      <TableHead>البيان</TableHead>
                      <TableHead>وارد</TableHead>
                      <TableHead>منصرف</TableHead>
                      <TableHead>طريقة</TableHead>
                      <TableHead>الحالة</TableHead>
                      <TableHead>المصدر</TableHead>
                      <TableHead>سجّل بواسطة</TableHead>
                      {isManager && <TableHead>إجراءات</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow><TableCell colSpan={isManager ? 10 : 9} className="text-center py-8">جارٍ التحميل...</TableCell></TableRow>
                    ) : filtered.length === 0 ? (
                      <TableRow><TableCell colSpan={isManager ? 10 : 9} className="text-center py-8 text-muted-foreground">لا توجد حركات</TableCell></TableRow>
                    ) : filtered.map((m) => (
                      <TableRow key={m.id} className={closedDates.has(m.movement_date) ? "bg-muted/30" : ""}>
                        <TableCell>
                          {m.movement_date}
                          {closedDates.has(m.movement_date) && <Lock className="inline w-3 h-3 ms-1 text-muted-foreground" />}
                        </TableCell>
                        <TableCell>{m.movement_type === "income" ? <Badge variant="default">إيراد</Badge> : <Badge variant="destructive">مصروف</Badge>}</TableCell>
                        <TableCell>
                          {m.movement_type === "income"
                            ? INCOME_LABELS[m.income_category as IncomeCat]
                            : EXPENSE_LABELS[m.expense_category as ExpenseCat]}
                          {m.customer_name && <div className="text-xs text-muted-foreground">{m.customer_name}</div>}
                          {m.beneficiary && <div className="text-xs text-muted-foreground">{m.beneficiary}</div>}
                          {m.rejection_reason && <div className="text-xs text-destructive">رفض: {m.rejection_reason}</div>}
                        </TableCell>
                        <TableCell className="font-mono">{m.movement_type === "income" ? fmtNum(m.amount, 2) : "—"}</TableCell>
                        <TableCell className="font-mono">{m.movement_type === "expense" ? fmtNum(m.amount, 2) : "—"}</TableCell>
                        <TableCell>{PAYMENT_LABELS[m.payment_method]}</TableCell>
                        <TableCell><StatusBadge s={m.status} /></TableCell>
                        <TableCell className="text-xs">
                          {m.source_table ? (
                            <Button size="sm" variant="link" className="h-auto p-0 text-xs gap-1" onClick={() => openSource(m)}>
                              <LinkIcon className="w-3 h-3" />{m.source_ref || "عرض المصدر"}
                            </Button>
                          ) : "—"}
                        </TableCell>
                        <TableCell className="text-xs">{profiles[m.created_by || ""] || "—"}</TableCell>
                        {isManager && (
                          <TableCell>
                            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDeleteDlg({ open: true, movement: m, reason: "" })}>حذف</Button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Approvals */}
          {canApprove && (
            <TabsContent value="approvals" className="space-y-3">
              <Card>
                <CardHeader><CardTitle>الحركات بانتظار الاعتماد</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {pending.length === 0 && <div className="text-center text-muted-foreground py-6">لا توجد حركات معلقة</div>}
                  {pending.map((m) => (
                    <div key={m.id} className="border rounded-md p-3 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant={m.movement_type === "income" ? "default" : "destructive"}>
                          {m.movement_type === "income" ? "إيراد" : "مصروف"}
                        </Badge>
                        <span className="font-semibold">{fmtNum(m.amount, 2)} ج</span>
                        <span className="text-sm text-muted-foreground">{m.movement_date}</span>
                        <Badge variant="outline">{PAYMENT_LABELS[m.payment_method]}</Badge>
                        <span className="text-sm">
                          {m.movement_type === "income"
                            ? INCOME_LABELS[m.income_category as IncomeCat]
                            : EXPENSE_LABELS[m.expense_category as ExpenseCat]}
                        </span>
                        <span className="text-xs text-muted-foreground">— {profiles[m.created_by || ""] || ""}</span>
                      </div>
                      {(m.customer_name || m.beneficiary || m.description || m.notes) && (
                        <div className="text-xs text-muted-foreground space-y-0.5">
                          {m.customer_name && <div>عميل: {m.customer_name}</div>}
                          {m.beneficiary && <div>مستفيد: {m.beneficiary}</div>}
                          {m.description && <div>وصف: {m.description}</div>}
                          {m.notes && <div>ملاحظات: {m.notes}</div>}
                        </div>
                      )}
                      <div className="flex gap-2 items-center flex-wrap">
                        <Button size="sm" onClick={() => approve(m)} className="gap-1"><CheckCircle2 className="w-4 h-4" />اعتماد</Button>
                        <Button size="sm" variant="destructive" onClick={() => setRejectDlg({ open: true, movement: m, reason: "" })} className="gap-1"><XCircle className="w-4 h-4" />رفض</Button>
                        <Button size="sm" variant="outline" onClick={() => setDeleteDlg({ open: true, movement: m, reason: "" })}>حذف</Button>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>
          )}

          {/* Daily Report */}
          <TabsContent value="daily" className="space-y-3">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>التقرير اليومي</span>
                  <div className="flex gap-2 items-center">
                    <Input type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} className="w-44" />
                    <Button variant="outline" onClick={printDailyReport} className="gap-2"><Printer className="w-4 h-4" />طباعة</Button>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {!reportData ? <div className="text-center py-6 text-muted-foreground">جارٍ التحميل...</div> : (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <StatCard title="رصيد أول اليوم" value={fmtNum(reportData.opening_balance, 2)} />
                      <StatCard title="إجمالي الإيرادات" value={fmtNum(reportData.income_total, 2)} icon={<TrendingUp />} />
                      <StatCard title="إجمالي المصروفات" value={fmtNum(reportData.expense_total, 2)} icon={<TrendingDown />} />
                      <StatCard title="صافي حركة اليوم" value={fmtNum(reportData.net_movement, 2)} accent />
                      <StatCard title="رصيد آخر اليوم" value={fmtNum(reportData.closing_balance, 2)} accent />
                      <StatCard title="حركات بانتظار الاعتماد" value={String(reportData.pending_count)} icon={<AlertTriangle />} />
                      <StatCard title="حركات مرفوضة" value={String(reportData.rejected_count)} icon={<XCircle />} />
                    </div>
                    <Card>
                      <CardHeader><CardTitle className="text-base">الرصيد حسب طريقة الدفع (نهاية اليوم)</CardTitle></CardHeader>
                      <CardContent>
                        <Table>
                          <TableHeader><TableRow><TableHead>الطريقة</TableHead><TableHead className="text-end">الرصيد</TableHead></TableRow></TableHeader>
                          <TableBody>
                            {Object.entries(reportData.by_method || {}).map(([k, v]) => (
                              <TableRow key={k}>
                                <TableCell>{PAYMENT_LABELS[k as PaymentMethod] || k}</TableCell>
                                <TableCell className="text-end font-mono">{fmtNum(Number(v), 2)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Day Closures */}
          <TabsContent value="closures" className="space-y-3">
            {isManager && (
              <Card>
                <CardHeader><CardTitle>إقفال يوم الخزنة</CardTitle></CardHeader>
                <CardContent>
                  <Button onClick={() => setCloseDayDlg({ open: true, date: today(), notes: "" })} className="gap-2">
                    <Lock className="w-4 h-4" />إقفال يوم جديد
                  </Button>
                </CardContent>
              </Card>
            )}
            <Card>
              <CardHeader><CardTitle>الأيام المُقفلة</CardTitle></CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>التاريخ</TableHead>
                      <TableHead>رصيد أول اليوم</TableHead>
                      <TableHead>إيرادات</TableHead>
                      <TableHead>مصروفات</TableHead>
                      <TableHead>رصيد آخر اليوم</TableHead>
                      <TableHead>أقفل بواسطة</TableHead>
                      <TableHead>الحالة</TableHead>
                      {isGeneralManager && <TableHead>إجراء</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {closures.length === 0 ? (
                      <TableRow><TableCell colSpan={isGeneralManager ? 8 : 7} className="text-center py-8 text-muted-foreground">لا توجد أيام مُقفلة</TableCell></TableRow>
                    ) : closures.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell>{c.closure_date}</TableCell>
                        <TableCell className="font-mono">{fmtNum(c.opening_balance, 2)}</TableCell>
                        <TableCell className="font-mono">{fmtNum(c.total_income, 2)}</TableCell>
                        <TableCell className="font-mono">{fmtNum(c.total_expense, 2)}</TableCell>
                        <TableCell className="font-mono font-semibold">{fmtNum(c.closing_balance, 2)}</TableCell>
                        <TableCell className="text-xs">{profiles[c.closed_by] || "—"}</TableCell>
                        <TableCell>
                          {c.reopened_at
                            ? <Badge variant="outline" className="gap-1"><Unlock className="w-3 h-3" />أُعيد فتحه</Badge>
                            : <Badge variant="secondary" className="gap-1"><Lock className="w-3 h-3" />مُقفل</Badge>}
                        </TableCell>
                        {isGeneralManager && (
                          <TableCell>
                            {!c.reopened_at && (
                              <Button size="sm" variant="outline" onClick={() => setReopenDlg({ open: true, closure: c, reason: "" })}>إعادة فتح</Button>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Opening balances */}
          <TabsContent value="openings" className="space-y-3">
            <OpeningBalancesPanel />
          </TabsContent>

          {/* External collections (عُهَد) */}
          <TabsContent value="external" className="space-y-3">
            <ExternalCollectionsPanel />
          </TabsContent>

          {/* Reports */}
          <TabsContent value="reports" className="space-y-3">
            <Card>
              <CardHeader><CardTitle>التقارير</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => { setFromDate(todayStr); setToDate(todayStr); printReport("تقرير يومي - خزنة المعمل والحضانات"); }}>تقرير يومي</Button>
                  <Button variant="outline" onClick={() => { setFromDate(`${monthStart}-01`); setToDate(todayStr); printReport("تقرير شهري - خزنة المعمل والحضانات"); }}>تقرير شهري</Button>
                  <Button variant="outline" onClick={() => { setFCategory("hatching"); setFType("income"); printReport("تقرير إيرادات التفريخ"); }}>إيرادات التفريخ</Button>
                  <Button variant="outline" onClick={() => { setFCategory("chick_sales"); setFType("income"); printReport("تقرير إيرادات بيع الكتاكيت"); }}>إيرادات بيع الكتاكيت</Button>
                  <Button variant="outline" onClick={() => { setFType("expense"); printReport("تقرير المصروفات حسب البند"); }}>المصروفات حسب البند</Button>
                  <Button variant="outline" onClick={exportExcel} className="gap-2"><FileSpreadsheet className="w-4 h-4" />تصدير Excel</Button>
                  <Button variant="outline" onClick={printCensus} className="gap-2"><FileCheck2 className="w-4 h-4" />محضر جرد الخزنة</Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Users className="w-5 h-5" />التقارير التشغيلية المرتبطة</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2 items-end">
                  <Field label="نوع التقرير">
                    <Select value={opReportType} onValueChange={(v) => setOpReportType(v as any)}>
                      <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="hatching_customer">إيرادات التفريخ حسب العميل</SelectItem>
                        <SelectItem value="hatching_batch">إيرادات التفريخ حسب الدفعة</SelectItem>
                        <SelectItem value="chicksales_batch">مبيعات الكتاكيت حسب الدفعة</SelectItem>
                        <SelectItem value="chicksales_customer">مبيعات الكتاكيت حسب العميل</SelectItem>
                        <SelectItem value="net">صافي تشغيل المعمل والحضانات</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="من"><Input type="date" value={opFrom} onChange={(e) => setOpFrom(e.target.value)} /></Field>
                  <Field label="إلى"><Input type="date" value={opTo} onChange={(e) => setOpTo(e.target.value)} /></Field>
                </div>

                {opReportType === "net" && opNet && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <StatCard title="إيرادات التفريخ" value={fmtNum(opNet.hatching_income, 2)} icon={<TrendingUp />} />
                    <StatCard title="إيرادات بيع الكتاكيت" value={fmtNum(opNet.chick_sales_income, 2)} icon={<Boxes />} />
                    <StatCard title="إيرادات أخرى" value={fmtNum(opNet.other_income, 2)} />
                    <StatCard title="إجمالي الإيرادات" value={fmtNum(opNet.total_income, 2)} accent />
                    <StatCard title="إجمالي المصروفات" value={fmtNum(opNet.total_expense, 2)} icon={<TrendingDown />} />
                    <StatCard title="صافي التشغيل" value={fmtNum(opNet.net_operation, 2)} accent />
                    <StatCard title="إيرادات معلقة" value={fmtNum(opNet.pending_income, 2)} icon={<AlertTriangle />} />
                    <StatCard title="مصروفات معلقة" value={fmtNum(opNet.pending_expense, 2)} icon={<AlertTriangle />} />
                  </div>
                )}

                {opReportType !== "net" && (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {opReportType === "hatching_customer" && <>
                            <TableHead>العميل</TableHead><TableHead>عدد الحركات</TableHead>
                            <TableHead className="text-end">إجمالي</TableHead>
                            <TableHead className="text-end">المعتمد</TableHead>
                            <TableHead className="text-end">المعلق</TableHead>
                          </>}
                          {opReportType === "hatching_batch" && <>
                            <TableHead>الدفعة / المرجع</TableHead><TableHead>العميل</TableHead>
                            <TableHead>عدد الحركات</TableHead>
                            <TableHead className="text-end">إجمالي</TableHead>
                            <TableHead className="text-end">المعتمد</TableHead>
                          </>}
                          {opReportType === "chicksales_batch" && <>
                            <TableHead>الدفعة</TableHead><TableHead>عدد المبيعات</TableHead>
                            <TableHead className="text-end">إجمالي الكتاكيت</TableHead>
                            <TableHead className="text-end">إجمالي</TableHead>
                            <TableHead className="text-end">المعتمد</TableHead>
                          </>}
                          {opReportType === "chicksales_customer" && <>
                            <TableHead>العميل</TableHead><TableHead>عدد المبيعات</TableHead>
                            <TableHead className="text-end">إجمالي الكتاكيت</TableHead>
                            <TableHead className="text-end">إجمالي</TableHead>
                            <TableHead className="text-end">المعتمد</TableHead>
                          </>}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {opRows.length === 0 ? (
                          <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">لا توجد بيانات</TableCell></TableRow>
                        ) : opRows.map((r, i) => (
                          <TableRow key={i}>
                            {opReportType === "hatching_customer" && <>
                              <TableCell>{r.customer_name}</TableCell>
                              <TableCell>{r.movements_count}</TableCell>
                              <TableCell className="text-end font-mono">{fmtNum(r.total_amount, 2)}</TableCell>
                              <TableCell className="text-end font-mono">{fmtNum(r.approved_amount || 0, 2)}</TableCell>
                              <TableCell className="text-end font-mono">{fmtNum(r.pending_amount || 0, 2)}</TableCell>
                            </>}
                            {opReportType === "hatching_batch" && <>
                              <TableCell className="text-xs">{r.batch_ref}</TableCell>
                              <TableCell>{r.customer_name}</TableCell>
                              <TableCell>{r.movements_count}</TableCell>
                              <TableCell className="text-end font-mono">{fmtNum(r.total_amount, 2)}</TableCell>
                              <TableCell className="text-end font-mono">{fmtNum(r.approved_amount || 0, 2)}</TableCell>
                            </>}
                            {opReportType === "chicksales_batch" && <>
                              <TableCell className="text-xs">{r.batch_ref}</TableCell>
                              <TableCell>{r.sales_count}</TableCell>
                              <TableCell className="text-end font-mono">{fmtNum(r.total_chicks || 0, 0)}</TableCell>
                              <TableCell className="text-end font-mono">{fmtNum(r.total_amount, 2)}</TableCell>
                              <TableCell className="text-end font-mono">{fmtNum(r.approved_amount || 0, 2)}</TableCell>
                            </>}
                            {opReportType === "chicksales_customer" && <>
                              <TableCell>{r.customer_name}</TableCell>
                              <TableCell>{r.sales_count}</TableCell>
                              <TableCell className="text-end font-mono">{fmtNum(r.total_chicks || 0, 0)}</TableCell>
                              <TableCell className="text-end font-mono">{fmtNum(r.total_amount, 2)}</TableCell>
                              <TableCell className="text-end font-mono">{fmtNum(r.approved_amount || 0, 2)}</TableCell>
                            </>}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>


          {/* Audit */}
          {canApprove && (
            <TabsContent value="audit" className="space-y-3">
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><ScrollText className="w-5 h-5" />سجل التدقيق - آخر 500 حدث</CardTitle></CardHeader>
                <CardContent className="p-0 overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>التاريخ والوقت</TableHead>
                        <TableHead>الإجراء</TableHead>
                        <TableHead>المستخدم</TableHead>
                        <TableHead>السبب</TableHead>
                        <TableHead>تفاصيل</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {auditRows.length === 0 ? (
                        <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">لا توجد عمليات</TableCell></TableRow>
                      ) : auditRows.map((a) => (
                        <TableRow key={a.id}>
                          <TableCell className="text-xs whitespace-nowrap">{new Date(a.created_at).toLocaleString("ar-EG")}</TableCell>
                          <TableCell><Badge variant="outline">{ACTION_LABELS[a.action] || a.action}</Badge></TableCell>
                          <TableCell className="text-xs">{a.actor_name || profiles[a.actor_id || ""] || "—"}</TableCell>
                          <TableCell className="text-xs">{a.reason || "—"}</TableCell>
                          <TableCell className="text-xs max-w-xs truncate" title={JSON.stringify(a.metadata || a)}>{a.movement_id ? `#${a.movement_id.slice(0, 8)}` : (a.metadata ? JSON.stringify(a.metadata).slice(0, 80) : "—")}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>
          )}
        </Tabs>
      </div>

      {/* Reject Dialog */}
      <Dialog open={rejectDlg.open} onOpenChange={(o) => setRejectDlg({ ...rejectDlg, open: o })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>رفض الحركة</DialogTitle>
            <DialogDescription>سبب الرفض إلزامي ويُحفظ في سجل التدقيق.</DialogDescription>
          </DialogHeader>
          <Textarea placeholder="اكتب سبب الرفض..." value={rejectDlg.reason} onChange={(e) => setRejectDlg({ ...rejectDlg, reason: e.target.value })} rows={4} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDlg({ open: false, movement: null, reason: "" })}>إلغاء</Button>
            <Button variant="destructive" onClick={confirmReject}>تأكيد الرفض</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={deleteDlg.open} onOpenChange={(o) => setDeleteDlg({ ...deleteDlg, open: o })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>حذف الحركة</DialogTitle>
            <DialogDescription>سبب الحذف إلزامي ويُسجل في سجل التدقيق مع نسخة كاملة من الحركة قبل الحذف.</DialogDescription>
          </DialogHeader>
          <Textarea placeholder="اكتب سبب الحذف..." value={deleteDlg.reason} onChange={(e) => setDeleteDlg({ ...deleteDlg, reason: e.target.value })} rows={4} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDlg({ open: false, movement: null, reason: "" })}>إلغاء</Button>
            <Button variant="destructive" onClick={confirmDelete}>تأكيد الحذف</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Close Day Dialog */}
      <Dialog open={closeDayDlg.open} onOpenChange={(o) => setCloseDayDlg({ ...closeDayDlg, open: o })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>إقفال يوم الخزنة</DialogTitle>
            <DialogDescription>بعد الإقفال لن تُقبل أي تعديلات أو حذف على حركات هذا اليوم إلا بصلاحية المدير العام أو التنفيذي.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Field label="التاريخ"><Input type="date" value={closeDayDlg.date} onChange={(e) => setCloseDayDlg({ ...closeDayDlg, date: e.target.value })} /></Field>
            <Field label="ملاحظات"><Textarea value={closeDayDlg.notes} onChange={(e) => setCloseDayDlg({ ...closeDayDlg, notes: e.target.value })} rows={3} /></Field>
            {(() => { const p = buildDayClosurePayload(closeDayDlg.date); return (
              <div className="text-xs space-y-1 bg-muted/40 p-3 rounded">
                <div>رصيد أول اليوم: <b>{fmtNum(p.opening_balance, 2)}</b></div>
                <div>إيرادات: <b>{fmtNum(p.total_income, 2)}</b> | مصروفات: <b>{fmtNum(p.total_expense, 2)}</b></div>
                <div>صافي: <b>{fmtNum(p.net_movement, 2)}</b> | رصيد آخر اليوم: <b>{fmtNum(p.closing_balance, 2)}</b></div>
              </div>
            );})()}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseDayDlg({ open: false, date: today(), notes: "" })}>إلغاء</Button>
            <Button onClick={closeDay} className="gap-2"><Lock className="w-4 h-4" />تأكيد الإقفال</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reopen Day Dialog */}
      <Dialog open={reopenDlg.open} onOpenChange={(o) => setReopenDlg({ ...reopenDlg, open: o })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>إعادة فتح يوم مُقفل</DialogTitle>
            <DialogDescription>هذه عملية حساسة. سيُسجل سبب الفتح في سجل التدقيق.</DialogDescription>
          </DialogHeader>
          <Textarea placeholder="سبب إعادة الفتح..." value={reopenDlg.reason} onChange={(e) => setReopenDlg({ ...reopenDlg, reason: e.target.value })} rows={4} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReopenDlg({ open: false, closure: null, reason: "" })}>إلغاء</Button>
            <Button onClick={reopenDay} className="gap-2"><Unlock className="w-4 h-4" />تأكيد الفتح</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}

function StatCard({ title, value, icon, accent }: { title: string; value: string; icon?: React.ReactNode; accent?: boolean }) {
  return (
    <Card className={accent ? "border-primary/40 bg-primary/5" : ""}>
      <CardContent className="p-4 flex items-center justify-between gap-2">
        <div>
          <div className="text-xs text-muted-foreground">{title}</div>
          <div className="text-xl font-bold font-mono">{value}</div>
        </div>
        {icon && <div className="text-muted-foreground">{icon}</div>}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ s }: { s: Status }) {
  if (s === "approved") return <Badge variant="default" className="gap-1"><CheckCircle2 className="w-3 h-3" />معتمدة</Badge>;
  if (s === "pending") return <Badge variant="secondary" className="gap-1"><AlertTriangle className="w-3 h-3" />معلقة</Badge>;
  return <Badge variant="destructive" className="gap-1"><XCircle className="w-3 h-3" />مرفوضة</Badge>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
