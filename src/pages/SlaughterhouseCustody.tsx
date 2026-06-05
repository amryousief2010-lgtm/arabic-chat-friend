import { useEffect, useMemo, useState } from "react";
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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { openPrintWindow, escapeHtml, fmtNum, fmtDate } from "@/lib/printPdf";
import * as XLSX from "xlsx";
import {
  Wallet, Plus, ShieldAlert, CheckCircle2, XCircle, MessageSquare, Upload,
  Printer, FileSpreadsheet, AlertTriangle, ScrollText, Beef,
} from "lucide-react";

type PM = "cash" | "vodafone_cash" | "instapay" | "bank_transfer";
type Status = "pending_review" | "clarification_needed" | "approved" | "rejected" | "over_limit_pending";
type Category =
  | "maintenance" | "utilities" | "supplies" | "cleaning" | "transport" | "daily_labor"
  | "hospitality" | "urgent_purchase" | "government" | "veterinary" | "equipment_repair"
  | "fridge_repair" | "other";

const PM_LBL: Record<PM, string> = { cash: "نقدي", vodafone_cash: "فودافون كاش", instapay: "إنستا باي", bank_transfer: "تحويل بنكي" };
const ST_LBL: Record<Status, string> = {
  pending_review: "بانتظار المراجعة",
  clarification_needed: "مطلوب توضيح",
  approved: "معتمد",
  rejected: "مرفوض",
  over_limit_pending: "تجاوز حد — بانتظار الموافقة",
};
const CAT_LBL: Record<Category, string> = {
  maintenance: "صيانة", utilities: "كهرباء / مياه / مرافق", supplies: "أدوات ومستلزمات تشغيل",
  cleaning: "نظافة ومطهرات", transport: "نقل ومشاوير", daily_labor: "عمالة يومية",
  hospitality: "ضيافة", urgent_purchase: "مشتريات طارئة", government: "مصروفات حكومية / تصاريح",
  veterinary: "مصروفات بيطرية", equipment_repair: "إصلاحات معدات", fridge_repair: "إصلاحات ثلاجات",
  other: "مصروفات أخرى",
};

interface Expense {
  id: string; expense_date: string; category: Category; description: string;
  amount: number; payment_method: PM; beneficiary: string | null; has_invoice: boolean;
  receipt_url: string | null; notes: string | null; status: Status;
  rejection_reason: string | null; over_limit: boolean; week_start_date: string | null;
  created_by: string; reviewed_by: string | null; approved_by: string | null;
  approved_at: string | null; created_at: string;
}
interface Comment { id: string; expense_id: string; body: string; attachment_url: string | null; is_clarification_request: boolean; author_id: string; created_at: string; }
interface Opening { id: string; as_of_date: string; total_amount: number; cash_amount: number; vodafone_cash_amount: number; instapay_amount: number; bank_transfer_amount: number; status: Status; notes: string | null; }
interface Limit { id: string; week_start_date: string; week_end_date: string; limit_amount: number; notes: string | null; }
interface AuditRow { id: string; action: string; entity: string; entity_id: string | null; actor_id: string | null; payload: any; created_at: string; }

const today = () => new Date().toISOString().slice(0, 10);
const mondayOf = (d: Date) => { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); return x.toISOString().slice(0, 10); };
const StatCard = ({ icon, title, value, accent, sub }: any) => (
  <Card className={accent ? "border-primary/40 bg-primary/5" : ""}>
    <CardContent className="p-4">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">{title}</div>
        <div className="text-muted-foreground">{icon}</div>
      </div>
      <div className="text-2xl font-bold font-mono mt-1">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>}
    </CardContent>
  </Card>
);

export default function SlaughterhouseCustody() {
  const { user, profile, roles, isGeneralManager, isExecutiveManager } = useAuth();
  const isKeeper = roles.includes("slaughterhouse_custody_keeper");
  const isManager =
    isGeneralManager || isExecutiveManager ||
    roles.includes("lab_treasury_approver") || roles.includes("slaughterhouse_manager");
  const canReopenWeek = isGeneralManager || isExecutiveManager;

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [openings, setOpenings] = useState<Opening[]>([]);
  const [limits, setLimits] = useState<Limit[]>([]);
  const [balance, setBalance] = useState<{ current_balance: number; total_opening: number; total_approved_expenses: number } | null>(null);
  const [weekUsage, setWeekUsage] = useState<{ week_start_date: string; week_end_date: string; limit_amount: number; approved_total: number; pending_total: number } | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);

  // Add Expense form
  const [form, setForm] = useState({
    expense_date: today(), category: "maintenance" as Category, description: "",
    amount: "", payment_method: "cash" as PM, beneficiary: "", has_invoice: false, notes: "",
  });
  const [receiptFile, setReceiptFile] = useState<File | null>(null);

  // Filters
  const [fStatus, setFStatus] = useState<string>("all");
  const [fCat, setFCat] = useState<string>("all");

  // Dialogs
  const [reviewDlg, setReviewDlg] = useState<{ open: boolean; exp: Expense | null; action: "approve" | "reject" | "clarify" | "approve_over"; reason: string }>({ open: false, exp: null, action: "approve", reason: "" });
  const [commentDlg, setCommentDlg] = useState<{ open: boolean; exp: Expense | null; body: string }>({ open: false, exp: null, body: "" });

  // Opening + Limit forms (manager)
  const [openForm, setOpenForm] = useState({ as_of_date: today(), total_amount: "", cash_amount: "", vodafone_cash_amount: "", instapay_amount: "", bank_transfer_amount: "", notes: "" });
  const [limitForm, setLimitForm] = useState({ week_start_date: mondayOf(new Date()), limit_amount: "", notes: "" });

  async function fetchAll() {
    setLoading(true);
    const [exp, open, lim, bal, usage, aud, cmt] = await Promise.all([
      (supabase as any).from("slaughter_custody_expenses").select("*").order("expense_date", { ascending: false }).limit(1000),
      (supabase as any).from("slaughter_custody_opening_balances").select("*").order("as_of_date", { ascending: false }),
      (supabase as any).from("slaughter_custody_weekly_limits").select("*").order("week_start_date", { ascending: false }),
      (supabase as any).from("v_slaughter_custody_balance").select("*").maybeSingle(),
      (supabase as any).from("v_slaughter_custody_week_usage").select("*").maybeSingle(),
      isManager ? (supabase as any).from("slaughter_custody_audit_log").select("*").order("created_at", { ascending: false }).limit(300) : Promise.resolve({ data: [] }),
      (supabase as any).from("slaughter_custody_comments").select("*").order("created_at", { ascending: false }).limit(500),
    ]);
    if (exp.error) toast.error("فشل تحميل المصروفات: " + exp.error.message);
    setExpenses((exp.data || []) as Expense[]);
    setOpenings((open.data || []) as Opening[]);
    setLimits((lim.data || []) as Limit[]);
    setBalance(bal.data || null);
    setWeekUsage(usage.data || null);
    setAudit((aud.data || []) as AuditRow[]);
    setComments((cmt.data || []) as Comment[]);
    setLoading(false);
  }

  useEffect(() => { if (user) fetchAll(); /* eslint-disable-next-line */ }, [user?.id]);

  async function uploadReceipt(): Promise<string | null> {
    if (!receiptFile || !user) return null;
    const path = `${user.id}/${Date.now()}-${receiptFile.name}`;
    const { error } = await (supabase as any).storage.from("slaughter-custody-receipts").upload(path, receiptFile, { upsert: false });
    if (error) { toast.error("فشل رفع الإيصال: " + error.message); return null; }
    return path;
  }

  async function submitExpense() {
    const amt = Number(form.amount || 0);
    if (amt <= 0) return toast.error("المبلغ مطلوب");
    if (!form.description.trim()) return toast.error("الوصف مطلوب");
    if (form.category === "other" && form.description.trim().length < 5)
      return toast.error("الوصف التفصيلي إجباري عند اختيار مصروفات أخرى");
    const receipt_url = await uploadReceipt();
    const { error } = await (supabase as any).from("slaughter_custody_expenses").insert({
      expense_date: form.expense_date, category: form.category, description: form.description,
      amount: amt, payment_method: form.payment_method, beneficiary: form.beneficiary || null,
      has_invoice: form.has_invoice, receipt_url, notes: form.notes || null,
      created_by: user!.id,
    });
    if (error) return toast.error("فشل التسجيل: " + error.message);
    toast.success("تم تسجيل المصروف — بانتظار المراجعة");
    setForm({ expense_date: today(), category: "maintenance", description: "", amount: "", payment_method: "cash", beneficiary: "", has_invoice: false, notes: "" });
    setReceiptFile(null);
    fetchAll();
  }

  async function applyReview() {
    const { exp, action, reason } = reviewDlg;
    if (!exp) return;
    const updates: any = { reviewed_by: user!.id, reviewed_at: new Date().toISOString() };
    if (action === "approve" || action === "approve_over") {
      updates.status = "approved"; updates.approved_by = user!.id; updates.approved_at = new Date().toISOString();
    } else if (action === "reject") {
      if (!reason.trim()) return toast.error("سبب الرفض إلزامي");
      updates.status = "rejected"; updates.rejection_reason = reason;
    } else if (action === "clarify") {
      if (!reason.trim()) return toast.error("نص التوضيح المطلوب إلزامي");
      updates.status = "clarification_needed";
    }
    const { error } = await (supabase as any).from("slaughter_custody_expenses").update(updates).eq("id", exp.id);
    if (error) return toast.error("فشل: " + error.message);
    if (action === "clarify") {
      await (supabase as any).from("slaughter_custody_comments").insert({
        expense_id: exp.id, body: reason, is_clarification_request: true, author_id: user!.id,
      });
    }
    toast.success("تم");
    setReviewDlg({ open: false, exp: null, action: "approve", reason: "" });
    fetchAll();
  }

  async function submitComment() {
    if (!commentDlg.exp || !commentDlg.body.trim()) return;
    const { error } = await (supabase as any).from("slaughter_custody_comments").insert({
      expense_id: commentDlg.exp.id, body: commentDlg.body, author_id: user!.id,
    });
    if (error) return toast.error("فشل: " + error.message);
    toast.success("تم الإضافة");
    setCommentDlg({ open: false, exp: null, body: "" });
    fetchAll();
  }

  async function submitOpening() {
    const amt = Number(openForm.total_amount || 0);
    if (amt <= 0) return toast.error("المبلغ مطلوب");
    const { error } = await (supabase as any).from("slaughter_custody_opening_balances").insert({
      as_of_date: openForm.as_of_date, total_amount: amt,
      cash_amount: Number(openForm.cash_amount || 0),
      vodafone_cash_amount: Number(openForm.vodafone_cash_amount || 0),
      instapay_amount: Number(openForm.instapay_amount || 0),
      bank_transfer_amount: Number(openForm.bank_transfer_amount || 0),
      notes: openForm.notes || null,
      status: "approved", approved_by: user!.id, approved_at: new Date().toISOString(),
      created_by: user!.id,
    });
    if (error) return toast.error("فشل: " + error.message);
    toast.success("تم اعتماد الرصيد الافتتاحي"); fetchAll();
  }

  async function submitLimit() {
    const amt = Number(limitForm.limit_amount || 0);
    if (amt <= 0) return toast.error("المبلغ مطلوب");
    const ws = new Date(limitForm.week_start_date);
    const we = new Date(ws); we.setDate(we.getDate() + 6);
    const { error } = await (supabase as any).from("slaughter_custody_weekly_limits").upsert({
      week_start_date: limitForm.week_start_date, week_end_date: we.toISOString().slice(0, 10),
      limit_amount: amt, notes: limitForm.notes || null, set_by: user!.id,
    }, { onConflict: "week_start_date" });
    if (error) return toast.error("فشل: " + error.message);
    toast.success("تم حفظ الحد الأسبوعي"); fetchAll();
  }

  // ===== Derived =====
  const visibleExpenses = useMemo(() => {
    return expenses.filter((e) =>
      (fStatus === "all" || e.status === fStatus) &&
      (fCat === "all" || e.category === fCat)
    );
  }, [expenses, fStatus, fCat]);

  const currentBalance = balance?.current_balance ?? 0;
  const limitAmt = weekUsage?.limit_amount ?? 0;
  const approvedThisWeek = weekUsage?.approved_total ?? 0;
  const pendingThisWeek = weekUsage?.pending_total ?? 0;
  const remaining = Math.max(0, limitAmt - approvedThisWeek - pendingThisWeek);
  const usagePct = limitAmt > 0 ? Math.min(100, ((approvedThisWeek + pendingThisWeek) / limitAmt) * 100) : 0;

  const monthAgo = new Date(); monthAgo.setMonth(monthAgo.getMonth() - 1);
  const monthExpensesTotal = expenses
    .filter((e) => e.status === "approved" && new Date(e.expense_date) >= monthAgo)
    .reduce((s, e) => s + Number(e.amount), 0);

  const topCategoryThisWeek = (() => {
    const start = mondayOf(new Date());
    const map: Record<string, number> = {};
    expenses.filter((e) => e.week_start_date === start && e.status === "approved")
      .forEach((e) => { map[e.category] = (map[e.category] || 0) + Number(e.amount); });
    const arr = Object.entries(map).sort((a, b) => b[1] - a[1]);
    return arr[0] ? `${CAT_LBL[arr[0][0] as Category]} (${fmtNum(arr[0][1], 0)})` : "—";
  })();

  const counts = {
    pending: expenses.filter((e) => e.status === "pending_review").length,
    clarif: expenses.filter((e) => e.status === "clarification_needed").length,
    rejected: expenses.filter((e) => e.status === "rejected").length,
    overLimit: expenses.filter((e) => e.status === "over_limit_pending").length,
  };

  const recentComments = comments.slice(0, 5);
  const recent10 = expenses.slice(0, 10);

  function exportExcel() {
    const rows = visibleExpenses.map((e) => ({
      التاريخ: e.expense_date, البند: CAT_LBL[e.category], الوصف: e.description,
      المبلغ: e.amount, "طريقة الدفع": PM_LBL[e.payment_method],
      المستفيد: e.beneficiary || "", "فاتورة؟": e.has_invoice ? "نعم" : "لا",
      الحالة: ST_LBL[e.status], "سبب الرفض": e.rejection_reason || "",
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "expenses");
    XLSX.writeFile(wb, `slaughterhouse-custody-${today()}.xlsx`);
  }

  function printInventory() {
    const html = `
      <div style="text-align:center"><h2>محضر جرد خزنة عهدة المجزر</h2>
      <div>التاريخ: ${escapeHtml(fmtDate(new Date().toISOString()))}</div>
      <div>المسؤول: محمد شعلة</div></div>
      <table style="width:100%;border-collapse:collapse;margin-top:20px"><tbody>
        <tr><th>الرصيد الافتتاحي المعتمد</th><td>${fmtNum(balance?.total_opening || 0, 2)}</td></tr>
        <tr><th>إجمالي المصروفات المعتمدة</th><td>${fmtNum(balance?.total_approved_expenses || 0, 2)}</td></tr>
        <tr><th>الرصيد الحالي</th><td><b>${fmtNum(currentBalance, 2)}</b></td></tr>
        <tr><th>الحد الأسبوعي الحالي</th><td>${fmtNum(limitAmt, 2)}</td></tr>
        <tr><th>المصروف المعتمد هذا الأسبوع</th><td>${fmtNum(approvedThisWeek, 2)}</td></tr>
        <tr><th>المتبقي من الحد</th><td>${fmtNum(remaining, 2)}</td></tr>
      </tbody></table>
      <div style="margin-top:60px;display:flex;justify-content:space-between">
        <div>توقيع المسؤول (محمد شعلة): ____________________</div>
        <div>توقيع المدير / المحاسب: ____________________</div>
      </div>`;
    openPrintWindow("محضر جرد عهدة المجزر", html);
  }

  // Permissions: keeper can't see audit tab/limit panel
  return (
    <DashboardLayout>
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Beef className="w-6 h-6 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">خزنة عهدة المجزر — محمد شعلة</h1>
              <div className="text-sm text-muted-foreground">{profile?.full_name}</div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={printInventory}><Printer className="w-4 h-4 ml-1" />محضر جرد</Button>
            <Button variant="outline" size="sm" onClick={exportExcel}><FileSpreadsheet className="w-4 h-4 ml-1" />تصدير Excel</Button>
          </div>
        </div>

        <Alert>
          <ShieldAlert className="w-4 h-4" />
          <AlertTitle>خزنة منفصلة تمامًا</AlertTitle>
          <AlertDescription className="text-xs">
            هذه خزنة عهدة المجزر للمصروفات اليومية فقط. <b>منفصلة تمامًا</b> عن خزنة المعمل والحضانات وعن تحصيلات محمد شعلة الخاصة بالمعمل. لا يتم احتساب أي مصروف ضمن الرصيد إلا بعد <b>اعتمادها</b>.
          </AlertDescription>
        </Alert>

        <Tabs defaultValue="dashboard">
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="dashboard">لوحة الخزنة</TabsTrigger>
            <TabsTrigger value="add">إضافة مصروف</TabsTrigger>
            <TabsTrigger value="expenses">المصروفات</TabsTrigger>
            {isManager && <TabsTrigger value="limit">الحد الأسبوعي</TabsTrigger>}
            {isManager && <TabsTrigger value="openings">رصيد افتتاحي</TabsTrigger>}
            {isManager && <TabsTrigger value="audit">سجل التدقيق</TabsTrigger>}
          </TabsList>

          {/* ===== Dashboard ===== */}
          <TabsContent value="dashboard" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard icon={<Wallet />} title="رصيد العهدة الحالي" value={fmtNum(currentBalance, 2)} accent />
              <StatCard icon={<ShieldAlert />} title="الحد الأسبوعي" value={fmtNum(limitAmt, 2)} sub={weekUsage ? `${weekUsage.week_start_date} → ${weekUsage.week_end_date}` : ""} />
              <StatCard icon={<CheckCircle2 />} title="المعتمد هذا الأسبوع" value={fmtNum(approvedThisWeek, 2)} />
              <StatCard icon={<AlertTriangle />} title="بانتظار المراجعة (الأسبوع)" value={fmtNum(pendingThisWeek, 2)} />
            </div>

            {limitAmt > 0 && (
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span>استهلاك الحد الأسبوعي</span>
                    <b className="font-mono">{usagePct.toFixed(1)}% — المتبقي {fmtNum(remaining, 2)}</b>
                  </div>
                  <Progress value={usagePct} className={usagePct >= 100 ? "[&>div]:bg-destructive" : usagePct >= 80 ? "[&>div]:bg-orange-500" : ""} />
                  {usagePct >= 100 && <div className="text-xs text-destructive mt-2">⚠ تم تجاوز الحد الأسبوعي — أي مصروف جديد يتطلب موافقة الإدارة</div>}
                  {usagePct >= 80 && usagePct < 100 && <div className="text-xs text-orange-600 mt-2">⚠ اقتربت من الحد الأسبوعي (80%+)</div>}
                </CardContent>
              </Card>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard icon={<AlertTriangle />} title="بانتظار المراجعة (إجمالي)" value={String(counts.pending)} />
              <StatCard icon={<MessageSquare />} title="مطلوب توضيح" value={String(counts.clarif)} />
              <StatCard icon={<XCircle />} title="المرفوضة" value={String(counts.rejected)} />
              <StatCard icon={<ShieldAlert />} title="تجاوزات بانتظار الموافقة" value={String(counts.overLimit)} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <StatCard icon={<ScrollText />} title="إجمالي مصروفات الشهر (معتمد)" value={fmtNum(monthExpensesTotal, 2)} />
              <StatCard icon={<Beef />} title="أعلى بند هذا الأسبوع" value={topCategoryThisWeek} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <Card>
                <CardHeader><CardTitle className="text-base">آخر 10 حركات</CardTitle></CardHeader>
                <CardContent className="overflow-x-auto p-0">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>التاريخ</TableHead><TableHead>البند</TableHead>
                      <TableHead>المبلغ</TableHead><TableHead>الحالة</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {recent10.map((e) => (
                        <TableRow key={e.id}>
                          <TableCell>{e.expense_date}</TableCell>
                          <TableCell className="text-xs">{CAT_LBL[e.category]}</TableCell>
                          <TableCell className="font-mono">{fmtNum(e.amount, 2)}</TableCell>
                          <TableCell><Badge variant={e.status === "approved" ? "default" : e.status === "rejected" ? "destructive" : "secondary"}>{ST_LBL[e.status]}</Badge></TableCell>
                        </TableRow>
                      ))}
                      {!recent10.length && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">لا توجد حركات</TableCell></TableRow>}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-base">آخر تعليقات الإدارة</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {recentComments.map((c) => {
                    const exp = expenses.find((e) => e.id === c.expense_id);
                    return (
                      <div key={c.id} className="text-xs p-2 bg-muted/50 rounded">
                        <div className="flex justify-between text-muted-foreground">
                          <span>{c.is_clarification_request ? "🔔 طلب توضيح" : "💬 تعليق"}</span>
                          <span>{new Date(c.created_at).toLocaleString("ar-EG")}</span>
                        </div>
                        <div className="mt-1">{c.body}</div>
                        {exp && <div className="text-muted-foreground mt-1">على المصروف: {CAT_LBL[exp.category]} — {fmtNum(exp.amount, 2)}</div>}
                      </div>
                    );
                  })}
                  {!recentComments.length && <div className="text-xs text-muted-foreground text-center py-4">لا توجد تعليقات</div>}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ===== Add Expense ===== */}
          <TabsContent value="add">
            <Card>
              <CardHeader><CardTitle>إضافة مصروف جديد</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                <div><Label>التاريخ</Label><Input type="date" value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} /></div>
                <div><Label>بند المصروف</Label>
                  <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v as Category })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{(Object.keys(CAT_LBL) as Category[]).map((k) => <SelectItem key={k} value={k}>{CAT_LBL[k]}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>المبلغ *</Label><Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
                <div><Label>طريقة الدفع</Label>
                  <Select value={form.payment_method} onValueChange={(v) => setForm({ ...form, payment_method: v as PM })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{(Object.keys(PM_LBL) as PM[]).map((k) => <SelectItem key={k} value={k}>{PM_LBL[k]}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>الجهة / المستفيد</Label><Input value={form.beneficiary} onChange={(e) => setForm({ ...form, beneficiary: e.target.value })} /></div>
                <div className="flex items-end gap-2"><Label className="flex items-center gap-2"><input type="checkbox" checked={form.has_invoice} onChange={(e) => setForm({ ...form, has_invoice: e.target.checked })} />يوجد فاتورة / إيصال</Label></div>
                <div className="md:col-span-2 lg:col-span-3"><Label>الوصف التفصيلي {form.category === "other" && <span className="text-destructive">*</span>}</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder={form.category === "other" ? "إجباري — اشرح المصروف بالتفصيل" : "اختياري"} /></div>
                <div><Label>صورة الفاتورة / الإيصال</Label><Input type="file" accept="image/*,application/pdf" onChange={(e) => setReceiptFile(e.target.files?.[0] || null)} /></div>
                <div className="md:col-span-2"><Label>ملاحظات</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
                <div className="md:col-span-2 lg:col-span-3">
                  <Button onClick={submitExpense} className="gap-2"><Plus className="w-4 h-4" />تسجيل المصروف</Button>
                  <span className="text-xs text-muted-foreground mr-3">الحالة الافتراضية: بانتظار المراجعة. لو المبلغ تجاوز الحد الأسبوعي ستتحول الحالة تلقائيًا إلى "تجاوز حد — بانتظار الموافقة".</span>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ===== Expenses List ===== */}
          <TabsContent value="expenses" className="space-y-3">
            <div className="flex gap-2 flex-wrap">
              <Select value={fStatus} onValueChange={setFStatus}>
                <SelectTrigger className="w-56"><SelectValue placeholder="كل الحالات" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الحالات</SelectItem>
                  {(Object.keys(ST_LBL) as Status[]).map((k) => <SelectItem key={k} value={k}>{ST_LBL[k]}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={fCat} onValueChange={setFCat}>
                <SelectTrigger className="w-56"><SelectValue placeholder="كل البنود" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل البنود</SelectItem>
                  {(Object.keys(CAT_LBL) as Category[]).map((k) => <SelectItem key={k} value={k}>{CAT_LBL[k]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <Card><CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>التاريخ</TableHead><TableHead>البند</TableHead><TableHead>الوصف</TableHead>
                  <TableHead>المبلغ</TableHead><TableHead>الدفع</TableHead><TableHead>الحالة</TableHead>
                  <TableHead>إجراء</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {visibleExpenses.map((e) => {
                    const expComments = comments.filter((c) => c.expense_id === e.id);
                    return (
                      <TableRow key={e.id} className={e.over_limit ? "bg-orange-50 dark:bg-orange-950/20" : ""}>
                        <TableCell>{e.expense_date}</TableCell>
                        <TableCell className="text-xs">{CAT_LBL[e.category]}</TableCell>
                        <TableCell className="text-xs max-w-xs truncate" title={e.description}>{e.description}</TableCell>
                        <TableCell className="font-mono">{fmtNum(e.amount, 2)}</TableCell>
                        <TableCell className="text-xs">{PM_LBL[e.payment_method]}</TableCell>
                        <TableCell>
                          <Badge variant={e.status === "approved" ? "default" : e.status === "rejected" ? "destructive" : "secondary"}>{ST_LBL[e.status]}</Badge>
                          {e.rejection_reason && <div className="text-[10px] text-destructive mt-1">{e.rejection_reason}</div>}
                          {!!expComments.length && <div className="text-[10px] text-muted-foreground mt-1">{expComments.length} تعليق</div>}
                        </TableCell>
                        <TableCell className="space-x-1 space-x-reverse">
                          {isManager && (e.status === "pending_review" || e.status === "clarification_needed") && (
                            <>
                              <Button size="sm" variant="default" onClick={() => setReviewDlg({ open: true, exp: e, action: "approve", reason: "" })}><CheckCircle2 className="w-3 h-3" /></Button>
                              <Button size="sm" variant="destructive" onClick={() => setReviewDlg({ open: true, exp: e, action: "reject", reason: "" })}><XCircle className="w-3 h-3" /></Button>
                              <Button size="sm" variant="outline" onClick={() => setReviewDlg({ open: true, exp: e, action: "clarify", reason: "" })}><MessageSquare className="w-3 h-3" /></Button>
                            </>
                          )}
                          {isManager && e.status === "over_limit_pending" && (
                            <>
                              <Button size="sm" variant="default" onClick={() => setReviewDlg({ open: true, exp: e, action: "approve_over", reason: "" })}>اعتماد تجاوز</Button>
                              <Button size="sm" variant="destructive" onClick={() => setReviewDlg({ open: true, exp: e, action: "reject", reason: "" })}><XCircle className="w-3 h-3" /></Button>
                            </>
                          )}
                          {isKeeper && e.status === "clarification_needed" && (
                            <Button size="sm" variant="outline" onClick={() => setCommentDlg({ open: true, exp: e, body: "" })}><MessageSquare className="w-3 h-3 ml-1" />رد</Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {!visibleExpenses.length && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">لا توجد مصروفات</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent></Card>
          </TabsContent>

          {/* ===== Weekly Limit (manager) ===== */}
          {isManager && (
            <TabsContent value="limit" className="space-y-3">
              <Card>
                <CardHeader><CardTitle>تحديد / تعديل الحد الأسبوعي</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div><Label>بداية الأسبوع (الإثنين)</Label><Input type="date" value={limitForm.week_start_date} onChange={(e) => setLimitForm({ ...limitForm, week_start_date: e.target.value })} /></div>
                  <div><Label>الحد (ج.م)</Label><Input type="number" step="0.01" value={limitForm.limit_amount} onChange={(e) => setLimitForm({ ...limitForm, limit_amount: e.target.value })} /></div>
                  <div><Label>ملاحظات</Label><Input value={limitForm.notes} onChange={(e) => setLimitForm({ ...limitForm, notes: e.target.value })} /></div>
                  <div className="md:col-span-3"><Button onClick={submitLimit}>حفظ الحد</Button></div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-base">حدود الأسابيع السابقة</CardTitle></CardHeader>
                <CardContent className="p-0 overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow><TableHead>الأسبوع</TableHead><TableHead>الحد</TableHead><TableHead>ملاحظات</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {limits.map((l) => (
                        <TableRow key={l.id}><TableCell>{l.week_start_date} → {l.week_end_date}</TableCell><TableCell className="font-mono">{fmtNum(l.limit_amount, 2)}</TableCell><TableCell>{l.notes || "—"}</TableCell></TableRow>
                      ))}
                      {!limits.length && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">لم يتم تحديد حدود</TableCell></TableRow>}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>
          )}

          {/* ===== Openings (manager) ===== */}
          {isManager && (
            <TabsContent value="openings" className="space-y-3">
              <Card>
                <CardHeader><CardTitle>تسجيل رصيد افتتاحي للعهدة</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div><Label>التاريخ</Label><Input type="date" value={openForm.as_of_date} onChange={(e) => setOpenForm({ ...openForm, as_of_date: e.target.value })} /></div>
                  <div><Label>إجمالي *</Label><Input type="number" step="0.01" value={openForm.total_amount} onChange={(e) => setOpenForm({ ...openForm, total_amount: e.target.value })} /></div>
                  <div><Label>نقدي</Label><Input type="number" step="0.01" value={openForm.cash_amount} onChange={(e) => setOpenForm({ ...openForm, cash_amount: e.target.value })} /></div>
                  <div><Label>فودافون كاش</Label><Input type="number" step="0.01" value={openForm.vodafone_cash_amount} onChange={(e) => setOpenForm({ ...openForm, vodafone_cash_amount: e.target.value })} /></div>
                  <div><Label>إنستا باي</Label><Input type="number" step="0.01" value={openForm.instapay_amount} onChange={(e) => setOpenForm({ ...openForm, instapay_amount: e.target.value })} /></div>
                  <div><Label>تحويل بنكي</Label><Input type="number" step="0.01" value={openForm.bank_transfer_amount} onChange={(e) => setOpenForm({ ...openForm, bank_transfer_amount: e.target.value })} /></div>
                  <div className="md:col-span-3"><Label>ملاحظات</Label><Textarea value={openForm.notes} onChange={(e) => setOpenForm({ ...openForm, notes: e.target.value })} /></div>
                  <div className="md:col-span-3"><Button onClick={submitOpening}>اعتماد الرصيد الافتتاحي</Button></div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-base">الأرصدة الافتتاحية المعتمدة</CardTitle></CardHeader>
                <CardContent className="p-0 overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow><TableHead>التاريخ</TableHead><TableHead>الإجمالي</TableHead><TableHead>الحالة</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {openings.map((o) => <TableRow key={o.id}><TableCell>{o.as_of_date}</TableCell><TableCell className="font-mono">{fmtNum(o.total_amount, 2)}</TableCell><TableCell><Badge>{ST_LBL[o.status]}</Badge></TableCell></TableRow>)}
                      {!openings.length && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">لا يوجد</TableCell></TableRow>}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>
          )}

          {/* ===== Audit (manager) ===== */}
          {isManager && (
            <TabsContent value="audit">
              <Card><CardContent className="p-0 overflow-x-auto">
                <Table>
                  <TableHeader><TableRow><TableHead>التاريخ</TableHead><TableHead>العملية</TableHead><TableHead>الجدول</TableHead><TableHead>المعرّف</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {audit.map((a) => <TableRow key={a.id}><TableCell className="text-xs">{new Date(a.created_at).toLocaleString("ar-EG")}</TableCell><TableCell><Badge variant="outline">{a.action}</Badge></TableCell><TableCell className="text-xs">{a.entity}</TableCell><TableCell className="text-[10px] font-mono">{a.entity_id?.slice(0, 8)}</TableCell></TableRow>)}
                    {!audit.length && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">لا توجد سجلات</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </CardContent></Card>
            </TabsContent>
          )}
        </Tabs>

        {/* Review dialog */}
        <Dialog open={reviewDlg.open} onOpenChange={(o) => setReviewDlg({ ...reviewDlg, open: o })}>
          <DialogContent>
            <DialogHeader><DialogTitle>
              {reviewDlg.action === "approve" && "اعتماد المصروف"}
              {reviewDlg.action === "approve_over" && "اعتماد تجاوز الحد الأسبوعي"}
              {reviewDlg.action === "reject" && "رفض المصروف"}
              {reviewDlg.action === "clarify" && "طلب توضيح"}
            </DialogTitle></DialogHeader>
            {(reviewDlg.action === "reject" || reviewDlg.action === "clarify") && (
              <div><Label>{reviewDlg.action === "reject" ? "سبب الرفض *" : "نص طلب التوضيح *"}</Label>
                <Textarea value={reviewDlg.reason} onChange={(e) => setReviewDlg({ ...reviewDlg, reason: e.target.value })} /></div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setReviewDlg({ ...reviewDlg, open: false })}>إلغاء</Button>
              <Button onClick={applyReview}>تأكيد</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Comment reply dialog (keeper) */}
        <Dialog open={commentDlg.open} onOpenChange={(o) => setCommentDlg({ ...commentDlg, open: o })}>
          <DialogContent>
            <DialogHeader><DialogTitle>الرد على طلب التوضيح</DialogTitle></DialogHeader>
            <div><Label>التوضيح / الرد</Label>
              <Textarea value={commentDlg.body} onChange={(e) => setCommentDlg({ ...commentDlg, body: e.target.value })} /></div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCommentDlg({ ...commentDlg, open: false })}>إلغاء</Button>
              <Button onClick={submitComment}>إرسال</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
