import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Wallet, Plus, Printer, CheckCircle2, XCircle, ArrowDownToLine, ArrowUpFromLine, Send, ShieldCheck, AlertTriangle, Banknote, Building2, Smartphone, FileDown, History } from "lucide-react";
import { openPrintWindow, escapeHtml, fmtNum, fmtDate } from "@/lib/printPdf";
import * as XLSX from "xlsx";
import BankAccountPanel from "@/components/main-treasury/BankAccountPanel";
import MainExpenseAnalytics from "@/components/treasury/MainExpenseAnalytics";
import IncomingLabCustodyTransfers from "@/components/treasury/IncomingLabCustodyTransfers";

type Account = { id: string; name: string; account_type: "cash"|"bank"|"wallet"; bank_name: string|null; opening_balance: number; is_active: boolean };
type Balance = { account_id: string; name: string; account_type: string; bank_name: string|null; opening_balance: number; current_balance: number; pending_amount: number; pending_count: number };
type Category = { id: string; code: string; label: string };
type Txn = {
  id: string; reference_no: string; account_id: string; txn_type: string; amount: number; txn_date: string;
  category_id: string | null; counterparty: string | null; description: string; status: string;
  requires_dual_approval: boolean; rejection_reason: string | null; created_at: string; created_by: string;
  approver_1_id: string | null; approver_1_at: string | null; approver_2_id: string | null; posted_at: string | null;
  payment_method: string | null;
};
type CustodyTransfer = { id: string; main_txn_id: string; custody_keeper_id: string; amount: number; transfer_date: string; status: string; received_at: string|null };

const TYPE_LBL: Record<string,string> = {
  deposit: "إيداع", withdrawal: "سحب", expense: "مصروف",
  transfer_to_custody: "تحويل لخزنة العهدة", adjustment: "تسوية",
  bank_deposit: "إيداع بنكي", bank_withdrawal: "سحب بنكي",
  loan_installment: "قسط قرض", bank_fees: "رسوم بنكية",
  transfer_to_bank: "تحويل من النقدية إلى البنك",
  transfer_from_custody: "تحويل واصل من النقدية", transfer_to_sub_treasury: "تحويل لخزنة فرعية",
  settlement: "تسوية بنكية", balance_correction: "تصحيح رصيد",
};
const STATUS_LBL: Record<string,string> = {
  draft: "مسودة", pending_approval: "بانتظار الاعتماد", approved: "معتمد جزئياً",
  posted: "مُرحَّل", rejected: "مرفوض", reversed: "معكوس",
};
const STATUS_TONE: Record<string, "default"|"secondary"|"destructive"|"outline"> = {
  draft: "outline", pending_approval: "secondary", approved: "secondary",
  posted: "default", rejected: "destructive", reversed: "outline",
};

const today = () => new Date().toISOString().slice(0,10);

export default function MainTreasury() {
  const { user, roles } = useAuth();
  const rs = roles as string[];
  const isApprover = rs.some(r => ["main_treasury_approver","general_manager","executive_manager","financial_manager"].includes(r));
  const isAccountant = rs.includes("main_treasury_accountant");
  const canWrite = isApprover || isAccountant;


  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [custodyKeepers, setCustodyKeepers] = useState<Array<{user_id:string; name:string}>>([]);
  const [transfers, setTransfers] = useState<CustodyTransfer[]>([]);
  const [lastTransferUserNames, setLastTransferUserNames] = useState<Record<string,string>>({});
  const [lastDetailOpen, setLastDetailOpen] = useState(false);

  // forms
  const [txnForm, setTxnForm] = useState({
    account_id: "", txn_type: "expense" as Txn["txn_type"], amount: "",
    txn_date: today(), category_id: "", counterparty: "", description: "",
  });
  const [transferForm, setTransferForm] = useState({
    account_id: "", custody_keeper_id: "", amount: "",
    recipient_name: "", reason: "", payment_method: "cash" as "cash"|"transfer"|"other",
    notes: "", txn_date: today(),
  });
  const [transferReceipt, setTransferReceipt] = useState<File|null>(null);
  const [transferDupWarn, setTransferDupWarn] = useState<string>("");
  const [newAccount, setNewAccount] = useState({ name:"", account_type:"cash" as Account["account_type"], bank_name:"", opening_balance:"" });
  const [rejectDlg, setRejectDlg] = useState<{open:boolean; txn?:Txn; reason:string}>({ open:false, reason:"" });
  const [editOpenBal, setEditOpenBal] = useState<{open:boolean; account?:Account; value:string}>({ open:false, value:"" });
  const [logFilter, setLogFilter] = useState({ account_id: "all", txn_type: "all", status: "all", from: "", to: "", search: "" });
  const [busy, setBusy] = useState(false);
  const [txnUuid, setTxnUuid] = useState<string>(() => crypto.randomUUID());
  const [transferUuid, setTransferUuid] = useState<string>(() => crypto.randomUUID());
  const [auditLog, setAuditLog] = useState<Array<{id:string;txn_id:string|null;action:string;old_status:string|null;new_status:string|null;performed_at:string;performed_by:string;details:any}>>([]);

  async function fetchAll() {
    setLoading(true);
    const [a, b, c, t, k, x, al] = await Promise.all([
      (supabase as any).from("main_treasury_accounts").select("*").eq("is_active", true).order("created_at"),
      (supabase as any).from("v_main_treasury_balance").select("*"),
      (supabase as any).from("main_treasury_expense_categories").select("id,code,label").eq("is_active", true).order("sort_order"),
      (supabase as any).from("main_treasury_transactions").select("*").order("created_at", { ascending: false }).limit(500),
      (supabase as any).from("user_roles").select("user_id").eq("role", "slaughterhouse_custody_keeper"),
      (supabase as any).from("main_treasury_to_custody_transfers").select("*").order("created_at", { ascending: false }).limit(200),
      (supabase as any).from("main_treasury_audit_log").select("*").order("performed_at", { ascending: false }).limit(300),
    ]);
    setAuditLog(al.data || []);
    if (a.error) toast.error("حسابات: "+a.error.message);
    setAccounts(a.data || []);
    setBalances(b.data || []);
    setCats(c.data || []);
    setTxns(t.data || []);
    setTransfers(x.data || []);
    const keeperIds = (k.data || []).map((r: any) => r.user_id);
    let nameMap: Record<string, string> = {};
    if (keeperIds.length) {
      const { data: pd } = await (supabase as any).from("profile_directory").select("id, full_name").in("id", keeperIds);
      nameMap = Object.fromEntries((pd || []).map((p: any) => [p.id, p.full_name]));
    }
    const keepers = keeperIds.map((uid: string) => ({ user_id: uid, name: nameMap[uid] || uid.slice(0, 8) }));
    // Sort: محمد شعلة first (default custody keeper)
    keepers.sort((x: any, y: any) => {
      const xs = /شعلة|شعله/.test(x.name) ? 0 : 1;
      const ys = /شعلة|شعله/.test(y.name) ? 0 : 1;
      return xs - ys;
    });
    setCustodyKeepers(keepers);
    const defaultKeeper = keepers.find((kk: any) => /شعلة|شعله/.test(kk.name)) || keepers[0];
    // set default account if none chosen
    if (!txnForm.account_id && a.data?.[0]) {
      setTxnForm(f => ({ ...f, account_id: a.data[0].id }));
      setTransferForm(f => ({ ...f, account_id: a.data[0].id, custody_keeper_id: f.custody_keeper_id || defaultKeeper?.user_id || "" }));
    } else if (defaultKeeper) {
      setTransferForm(f => ({ ...f, custody_keeper_id: f.custody_keeper_id || defaultKeeper.user_id }));
    }
    setLoading(false);
  }
  useEffect(() => { if (user) fetchAll(); /* eslint-disable-next-line */ }, [user?.id]);

  const lastTransferTxn = useMemo(() => {
    const list = txns.filter(t => t.txn_type === "transfer_to_custody")
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return list[0] || null;
  }, [txns]);

  const lastTransferLink = useMemo(() =>
    lastTransferTxn ? (transfers.find(tr => tr.main_txn_id === lastTransferTxn.id) || null) : null,
  [transfers, lastTransferTxn]);

  useEffect(() => {
    if (!lastTransferTxn) return;
    const ids = [lastTransferTxn.created_by, lastTransferTxn.approver_1_id].filter(Boolean) as string[];
    if (!ids.length) return;
    (supabase as any).from("profile_directory").select("id, full_name").in("id", ids).then(({ data }: any) => {
      const m: Record<string, string> = {};
      (data || []).forEach((p: any) => { if (p.full_name) m[p.id] = p.full_name; });
      setLastTransferUserNames(prev => ({ ...prev, ...m }));
    });
  }, [lastTransferTxn?.id]);

  const totalBalance = useMemo(() => balances.reduce((s,b)=>s+Number(b.current_balance||0), 0), [balances]);
  const totalPending = useMemo(() => balances.reduce((s,b)=>s+Number(b.pending_amount||0), 0), [balances]);
  const pendingTxns = useMemo(() => txns.filter(t => t.status === "pending_approval"), [txns]);
  const monthExpenses = useMemo(() => {
    const m = new Date(); m.setDate(1);
    return txns.filter(t => t.status === "posted" && t.txn_type === "expense" && new Date(t.txn_date) >= m)
      .reduce((s,t)=>s+Number(t.amount), 0);
  }, [txns]);
  const monthTransfers = useMemo(() => {
    const m = new Date(); m.setDate(1);
    return txns.filter(t => t.status === "posted" && t.txn_type === "transfer_to_custody" && new Date(t.txn_date) >= m)
      .reduce((s,t)=>s+Number(t.amount), 0);
  }, [txns]);

  async function submitTxn() {
    const amt = Number(txnForm.amount || 0);
    if (!txnForm.account_id) return toast.error("اختر الحساب");
    if (amt <= 0) return toast.error("المبلغ مطلوب");
    if (!txnForm.description.trim()) return toast.error("الوصف مطلوب");
    if (txnForm.txn_type === "expense" && !txnForm.category_id) return toast.error("اختر بند المصروف");
    setBusy(true);
    const { error } = await (supabase as any).from("main_treasury_transactions").insert({
      account_id: txnForm.account_id, txn_type: txnForm.txn_type, amount: amt,
      txn_date: txnForm.txn_date, category_id: txnForm.category_id || null,
      counterparty: txnForm.counterparty || null, description: txnForm.description,
      client_uuid: txnUuid,
      created_by: user!.id,
    });
    setBusy(false);
    if (error) {
      if ((error as any).code === "23505") return toast.error("هذه المعاملة مسجلة بالفعل (تم منع التكرار)");
      return toast.error(error.message);
    }
    toast.success("تم التسجيل — حسب القيمة قد تحتاج اعتماد");
    setTxnForm({ ...txnForm, amount: "", counterparty: "", description: "", category_id: "" });
    setTxnUuid(crypto.randomUUID());
    fetchAll();
  }

  async function submitTransfer() {
    const amt = Number(transferForm.amount || 0);
    if (!transferForm.account_id) return toast.error("اختر الحساب");
    if (!transferForm.custody_keeper_id) return toast.error("اختر أمين العهدة المستلم");
    if (amt <= 0) return toast.error("المبلغ مطلوب");
    if (!transferForm.reason.trim()) return toast.error("سبب التوريد مطلوب");
    const keeperName = custodyKeepers.find(k => k.user_id === transferForm.custody_keeper_id)?.name || "";
    const recipient = (transferForm.recipient_name || keeperName).trim();
    if (!recipient) return toast.error("اسم المستلم في العهدة مطلوب");

    // Duplicate detection: same amount + date + recipient still pending or posted
    const dup = txns.find(t =>
      t.txn_type === "transfer_to_custody" &&
      ["pending_approval","approved","posted"].includes(t.status) &&
      Number(t.amount) === amt &&
      t.txn_date === transferForm.txn_date &&
      (t.counterparty || "").trim() === recipient
    );
    if (dup && !transferDupWarn) {
      setTransferDupWarn(`تنبيه: توجد حركة توريد مسجلة (#${dup.reference_no}) بنفس المبلغ والتاريخ والمستلم. اضغط "تأكيد الإرسال" لتسجيلها رغم ذلك.`);
      return;
    }

    setBusy(true);
    // 1) Upload attachment if provided
    let attachment_url: string | null = null;
    let attachment_name: string | null = null;
    let attachment_mime: string | null = null;
    let attachment_size: number | null = null;
    if (transferReceipt) {
      const path = `transfers/${user!.id}/${Date.now()}_${transferReceipt.name.replace(/[^\w.\-]/g,"_")}`;
      const up = await (supabase as any).storage.from("main-treasury-attachments").upload(path, transferReceipt, { upsert: false });
      if (up.error) { setBusy(false); return toast.error("فشل رفع المرفق: " + up.error.message); }
      attachment_url = path;
      attachment_name = transferReceipt.name;
      attachment_mime = transferReceipt.type;
      attachment_size = transferReceipt.size;
    }

    const desc = `توريد إلى خزنة العهدة — ${transferForm.reason}` +
      (transferForm.notes ? ` — ${transferForm.notes}` : "");
    const { data: t, error: e1 } = await (supabase as any).from("main_treasury_transactions").insert({
      account_id: transferForm.account_id, txn_type: "transfer_to_custody",
      amount: amt, txn_date: transferForm.txn_date,
      counterparty: recipient,
      payment_method: transferForm.payment_method,
      description: desc,
      attachment_url, attachment_name, attachment_mime, attachment_size,
      attachment_uploaded_by: attachment_url ? user!.id : null,
      attachment_uploaded_at: attachment_url ? new Date().toISOString() : null,
      client_uuid: transferUuid,
      created_by: user!.id,
    }).select("*").single();
    if (e1) {
      setBusy(false);
      if ((e1 as any).code === "23505") return toast.error("هذه حركة توريد مسجلة من قبل ولا يمكن تكرارها");
      return toast.error(e1.message);
    }
    const { error: e2 } = await (supabase as any).from("main_treasury_to_custody_transfers").insert({
      main_txn_id: t.id, custody_keeper_id: transferForm.custody_keeper_id,
      amount: amt, transfer_date: transferForm.txn_date, notes: transferForm.notes || null,
    });
    setBusy(false);
    if (e2 && (e2 as any).code !== "23505") return toast.error(e2.message);
    toast.success("تم إنشاء طلب التوريد — بانتظار اعتماد المدير العام/التنفيذي");
    setTransferForm({ ...transferForm, amount: "", notes: "", reason: "", recipient_name: "" });
    setTransferReceipt(null);
    setTransferDupWarn("");
    setTransferUuid(crypto.randomUUID());
    fetchAll();
  }

  async function approve(txn: Txn) {
    setBusy(true);
    const { error } = await (supabase as any).rpc("mt_approve_txn", { p_txn_id: txn.id });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("تم الاعتماد");
    fetchAll();
  }
  async function reject() {
    if (!rejectDlg.txn || !rejectDlg.reason.trim()) return toast.error("سبب الرفض مطلوب");
    setBusy(true);
    const { error } = await (supabase as any).rpc("mt_reject_txn", { p_txn_id: rejectDlg.txn.id, p_reason: rejectDlg.reason });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("تم الرفض");
    setRejectDlg({ open:false, reason:"" });
    fetchAll();
  }
  async function createAccount() {
    if (!newAccount.name.trim()) return toast.error("اسم الحساب مطلوب");
    const { error } = await (supabase as any).from("main_treasury_accounts").insert({
      name: newAccount.name, account_type: newAccount.account_type,
      bank_name: newAccount.bank_name || null,
      opening_balance: Number(newAccount.opening_balance || 0),
      created_by: user!.id,
    });
    if (error) return toast.error(error.message);
    toast.success("تم إنشاء الحساب");
    setNewAccount({ name:"", account_type:"cash", bank_name:"", opening_balance:"" });
    fetchAll();
  }

  async function saveOpeningBalance() {
    if (!editOpenBal.account) return;
    const v = Number(editOpenBal.value);
    if (Number.isNaN(v)) return toast.error("قيمة غير صحيحة");
    setBusy(true);
    const { error } = await (supabase as any).from("main_treasury_accounts")
      .update({ opening_balance: v }).eq("id", editOpenBal.account.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("تم تحديث الرصيد الافتتاحي");
    setEditOpenBal({ open:false, value:"" });
    fetchAll();
  }

  function printVoucher(t: Txn) {
    const acc = accounts.find(a => a.id === t.account_id);
    const cat = cats.find(c => c.id === t.category_id);
    const voucherTitle = t.txn_type === "deposit" ? "سند قبض" : t.txn_type === "transfer_to_custody" ? "إذن تحويل لخزنة العهدة" : "سند صرف";
    const body = `
      <header>
        <div>
          <h1>${escapeHtml(voucherTitle)}</h1>
          <div class="en">Main Treasury Voucher</div>
        </div>
        <div class="meta">
          <div><b>رقم السند:</b> ${escapeHtml(t.reference_no)}</div>
          <div><b>التاريخ:</b> ${escapeHtml(t.txn_date)}</div>
          <div><b>الحالة:</b> ${escapeHtml(STATUS_LBL[t.status] || t.status)}</div>
          <div><b>تاريخ الطباعة:</b> ${fmtDate(new Date().toISOString())}</div>
        </div>
      </header>
      <div class="stats">
        <div class="stat"><div class="k">النوع</div><div class="v">${escapeHtml(TYPE_LBL[t.txn_type] || t.txn_type)}</div></div>
        <div class="stat"><div class="k">المبلغ</div><div class="v">${fmtNum(t.amount, 2)} ج.م</div></div>
        <div class="stat"><div class="k">الحساب</div><div class="v">${escapeHtml(acc?.name || "—")}</div></div>
        <div class="stat"><div class="k">البند</div><div class="v">${escapeHtml(cat?.label || "—")}</div></div>
      </div>
      <h2>التفاصيل</h2>
      <table>
        <tbody>
          <tr><th style="width:30%">المستفيد / الجهة</th><td>${escapeHtml(t.counterparty || "—")}</td></tr>
          <tr><th>الوصف</th><td>${escapeHtml(t.description)}</td></tr>
          ${t.rejection_reason ? `<tr><th>سبب الرفض</th><td>${escapeHtml(t.rejection_reason)}</td></tr>` : ""}
        </tbody>
      </table>
      <h2>التوقيعات</h2>
      <table>
        <thead><tr><th style="width:33%">المحاسب</th><th style="width:33%">المعتمد</th><th style="width:33%">المستلم</th></tr></thead>
        <tbody><tr><td style="height:80px"></td><td></td><td></td></tr></tbody>
      </table>
    `;
    openPrintWindow(`${voucherTitle} — ${t.reference_no}`, body);
  }

  const acctIcon = (type: string) => type === "bank" ? <Building2 className="h-5 w-5"/> : type === "wallet" ? <Smartphone className="h-5 w-5"/> : <Banknote className="h-5 w-5"/>;

  if (!canWrite && roles.length > 0) {
    return (
      <DashboardLayout>
        <Header title="الخزنة الرئيسية للشركة" subtitle="" />
        <Card><CardContent className="p-8 text-center">
          <ShieldCheck className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
          <div className="font-semibold">صلاحياتك لا تشمل الخزنة الرئيسية.</div>
        </CardContent></Card>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <Header title="الخزنة الرئيسية للشركة" subtitle="مجزر — يديرها أ. محمد شعلة • نظام اعتماد مالي رسمي" />

      {/* KPIs */}
      {(() => {
        const cashTotal = balances.filter(b => b.account_type === "cash").reduce((s,b)=>s+Number(b.current_balance||0),0);
        const bankTotal = balances.filter(b => b.account_type === "bank").reduce((s,b)=>s+Number(b.current_balance||0),0);
        const bankPending = balances.filter(b => b.account_type === "bank").reduce((s,b)=>s+Number(b.pending_amount||0),0);
        const m = new Date(); m.setDate(1);
        const monthBankInstallments = txns.filter(t => t.status==="posted" && t.txn_type==="loan_installment" && new Date(t.txn_date) >= m).reduce((s,t)=>s+Number(t.amount),0);
        const monthBankExpenses = txns.filter(t => t.status==="posted" && ["expense","bank_fees"].includes(t.txn_type) && new Date(t.txn_date) >= m).reduce((s,t)=>s+Number(t.amount),0);
        const todayStr = new Date().toISOString().slice(0,10);
        const cashAccIds = new Set(accounts.filter(a => a.account_type === "cash").map(a => a.id));
        const toBankLegs = txns.filter(t => t.txn_type === "transfer_to_bank" && cashAccIds.has(t.account_id));
        const toBankToday = toBankLegs.filter(t => t.status==="posted" && t.txn_date===todayStr).reduce((s,t)=>s+Number(t.amount),0);
        const toBankMonth = toBankLegs.filter(t => t.status==="posted" && new Date(t.txn_date) >= m).reduce((s,t)=>s+Number(t.amount),0);
        const toBankPending = toBankLegs.filter(t => t.status==="pending_approval").reduce((s,t)=>s+Number(t.amount),0);
        const toBankApproved = toBankLegs.filter(t => t.status==="posted").reduce((s,t)=>s+Number(t.amount),0);
        // Custody transfers stats
        const custodyLegs = txns.filter(t => t.txn_type === "transfer_to_custody");
        const custToday = custodyLegs.filter(t => t.status==="posted" && t.txn_date===todayStr).reduce((s,t)=>s+Number(t.amount),0);
        const custMonth = custodyLegs.filter(t => t.status==="posted" && new Date(t.txn_date) >= m).reduce((s,t)=>s+Number(t.amount),0);
        const custPending = custodyLegs.filter(t => t.status==="pending_approval").reduce((s,t)=>s+Number(t.amount),0);
        const custApproved = custodyLegs.filter(t => t.status==="posted").reduce((s,t)=>s+Number(t.amount),0);
        const custRejected = custodyLegs.filter(t => t.status==="rejected").reduce((s,t)=>s+Number(t.amount),0);
        return (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
            <Card className="lg:col-span-2 border-[hsl(142_71%_36%)]/30 bg-[hsl(142_71%_36%)]/5"><CardContent className="p-4">
              <div className="text-sm font-bold flex items-center gap-1"><Send className="h-4 w-4"/>تحويلات إلى البنك</div>
              <div className="grid grid-cols-4 gap-2 mt-2 text-xs">
                <div><div className="text-muted-foreground">اليوم</div><div className="font-mono font-bold text-sm">{fmtNum(toBankToday,0)}</div></div>
                <div><div className="text-muted-foreground">الشهر</div><div className="font-mono font-bold text-sm">{fmtNum(toBankMonth,0)}</div></div>
                <div><div className="text-muted-foreground">معلق</div><div className="font-mono font-bold text-sm text-[hsl(38_92%_50%)]">{fmtNum(toBankPending,0)}</div></div>
                <div><div className="text-muted-foreground">معتمد</div><div className="font-mono font-bold text-sm text-[hsl(142_71%_36%)]">{fmtNum(toBankApproved,0)}</div></div>
              </div>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <div className="text-xs text-muted-foreground">إجمالي الخزنة الرئيسية</div>
              <div className="text-2xl font-bold font-mono text-primary">{fmtNum(totalBalance, 2)} ج</div>
              <div className="text-xs">نقدي + بنك</div>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <div className="text-xs text-muted-foreground">رصيد النقدية</div>
              <div className="text-2xl font-bold font-mono">{fmtNum(cashTotal, 2)}</div>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <div className="text-xs text-muted-foreground">رصيد الحساب البنكي</div>
              <div className="text-2xl font-bold font-mono text-[hsl(217_91%_60%)]">{fmtNum(bankTotal, 2)}</div>
              {bankPending > 0 && <div className="text-xs text-[hsl(38_92%_50%)]">معلق: {fmtNum(bankPending,0)}</div>}
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <div className="text-xs text-muted-foreground">أقساط قرض هذا الشهر</div>
              <div className="text-xl font-bold font-mono">{fmtNum(monthBankInstallments, 2)}</div>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <div className="text-xs text-muted-foreground">مصروفات بنكية الشهر</div>
              <div className="text-xl font-bold font-mono">{fmtNum(monthBankExpenses, 2)}</div>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <div className="text-xs text-muted-foreground">بانتظار الاعتماد</div>
              <div className="text-xl font-bold font-mono text-[hsl(38_92%_50%)]">{fmtNum(totalPending, 2)}</div>
              <div className="text-xs">{pendingTxns.length} معاملة</div>
            </CardContent></Card>
            <Card className="lg:col-span-3 border-[hsl(280_60%_50%)]/30 bg-[hsl(280_60%_50%)]/5"><CardContent className="p-4">
              <div className="text-sm font-bold flex items-center gap-1"><Send className="h-4 w-4"/>توريدات إلى خزنة العهدة</div>
              <div className="grid grid-cols-5 gap-2 mt-2 text-xs">
                <div><div className="text-muted-foreground">اليوم</div><div className="font-mono font-bold text-sm">{fmtNum(custToday,0)}</div></div>
                <div><div className="text-muted-foreground">الشهر</div><div className="font-mono font-bold text-sm">{fmtNum(custMonth,0)}</div></div>
                <div><div className="text-muted-foreground">معلقة</div><div className="font-mono font-bold text-sm text-[hsl(38_92%_50%)]">{fmtNum(custPending,0)}</div></div>
                <div><div className="text-muted-foreground">معتمدة</div><div className="font-mono font-bold text-sm text-[hsl(142_71%_36%)]">{fmtNum(custApproved,0)}</div></div>
                <div><div className="text-muted-foreground">مرفوضة</div><div className="font-mono font-bold text-sm text-destructive">{fmtNum(custRejected,0)}</div></div>
              </div>
            </CardContent></Card>
          </div>
        );
      })()}


      <Tabs defaultValue="dashboard">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="dashboard">لوحة الرصيد</TabsTrigger>
          <TabsTrigger value="bank">الحساب البنكي</TabsTrigger>
          <TabsTrigger value="new">معاملة جديدة</TabsTrigger>
          <TabsTrigger value="transfer">توريد لخزنة العهدة</TabsTrigger>
          {isApprover && <TabsTrigger value="approve">بانتظار الاعتماد {pendingTxns.length>0 && <Badge className="mr-2">{pendingTxns.length}</Badge>}</TabsTrigger>}
          <TabsTrigger value="log">سجل الحركات</TabsTrigger>
          <TabsTrigger value="transfers">سجل التحويلات</TabsTrigger>
          <TabsTrigger value="analytics">تحليل المصروفات</TabsTrigger>
          <TabsTrigger value="audit">Audit Log</TabsTrigger>
          <TabsTrigger value="settings">إعدادات</TabsTrigger>
        </TabsList>

        <TabsContent value="bank" className="mt-4">
          <BankAccountPanel />
        </TabsContent>


        {/* Dashboard */}
        <TabsContent value="dashboard" className="mt-4 space-y-3">
          <IncomingLabCustodyTransfers onReceived={() => { fetchAll?.(); }} />
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
            {balances.length === 0 ? <Card><CardContent className="p-8 text-center text-muted-foreground">لا توجد حسابات بعد — أضف من تبويب "إعدادات"</CardContent></Card> :
              balances.map(b => (
                <Card key={b.account_id}>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-base flex items-center gap-2">{acctIcon(b.account_type)} {b.name}</CardTitle>
                    <Badge variant="outline">{b.account_type === "cash"?"نقدي":b.account_type==="bank"?"بنك":"محفظة"}</Badge>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold font-mono text-primary">{fmtNum(b.current_balance, 2)}</div>
                    <div className="text-xs text-muted-foreground">ج.م — رصيد حالي</div>
                    <div className="mt-2 text-xs flex justify-between border-t pt-2">
                      <span>افتتاحي: <b>{fmtNum(b.opening_balance,0)}</b></span>
                      {b.pending_count > 0 && <span className="text-[hsl(var(--warning,38_92%_50%))]">بانتظار: {fmtNum(b.pending_amount,0)}</span>}
                    </div>
                    {b.bank_name && <div className="text-xs text-muted-foreground mt-1">{b.bank_name}</div>}
                  </CardContent>
                </Card>
              ))}
          </div>
        </TabsContent>

        {/* New Txn */}
        <TabsContent value="new" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Plus className="h-4 w-4"/>تسجيل معاملة جديدة</CardTitle></CardHeader>
            <CardContent className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
              <div><Label>نوع المعاملة</Label>
                <Select value={txnForm.txn_type} onValueChange={v => setTxnForm({...txnForm, txn_type: v as any})}>
                  <SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="deposit"><ArrowDownToLine className="h-4 w-4 inline ml-1"/>إيداع</SelectItem>
                    <SelectItem value="withdrawal"><ArrowUpFromLine className="h-4 w-4 inline ml-1"/>سحب</SelectItem>
                    <SelectItem value="expense">مصروف</SelectItem>
                    <SelectItem value="adjustment">تسوية</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>الحساب</Label>
                <Select value={txnForm.account_id} onValueChange={v => setTxnForm({...txnForm, account_id: v})}>
                  <SelectTrigger><SelectValue placeholder="اختر"/></SelectTrigger>
                  <SelectContent>{accounts.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>المبلغ *</Label><Input type="number" step="0.01" value={txnForm.amount} onChange={e=>setTxnForm({...txnForm, amount: e.target.value})}/></div>
              <div><Label>التاريخ</Label><Input type="date" value={txnForm.txn_date} onChange={e=>setTxnForm({...txnForm, txn_date: e.target.value})}/></div>
              {(txnForm.txn_type === "expense") && (
                <div><Label>بند المصروف *</Label>
                  <Select value={txnForm.category_id} onValueChange={v => setTxnForm({...txnForm, category_id: v})}>
                    <SelectTrigger><SelectValue placeholder="اختر"/></SelectTrigger>
                    <SelectContent>{cats.map(c => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
              <div><Label>المستفيد / الجهة</Label><Input value={txnForm.counterparty} onChange={e=>setTxnForm({...txnForm, counterparty: e.target.value})}/></div>
              <div className="md:col-span-2 lg:col-span-3"><Label>الوصف *</Label><Textarea value={txnForm.description} onChange={e=>setTxnForm({...txnForm, description: e.target.value})}/></div>
              <div className="md:col-span-2 lg:col-span-3">
                <div className="rounded-md border border-[hsl(var(--warning,38_92%_50%))]/40 bg-[hsl(var(--warning,38_92%_50%))]/10 p-3 text-sm mb-3 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0"/>
                  <div>
                    <b>قواعد الاعتماد:</b> أي معاملة ≤ 5,000 ج تُرحَّل تلقائيًا. <br/>
                    من 5,000.01 إلى 50,000 ج تحتاج اعتماد المدير. <br/>
                    أكثر من 50,000 ج تحتاج <b>اعتماد مزدوج</b> من معتمدَين مختلفين.
                  </div>
                </div>
                <Button onClick={submitTxn} disabled={busy} className="gap-2"><Plus className="h-4 w-4"/>تسجيل المعاملة</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Transfer */}
        <TabsContent value="transfer" className="mt-4 space-y-3">
          {/* آخر حركة تحويل إلى خزنة العهدة */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <History className="h-4 w-4 text-[hsl(280_60%_50%)]"/>آخر حركة تحويل إلى خزنة العهدة
              </CardTitle>
            </CardHeader>
            <CardContent>
              {lastTransferTxn ? (() => {
                const keeperName = custodyKeepers.find(k => k.user_id === lastTransferLink?.custody_keeper_id)?.name || "—";
                const reason = lastTransferTxn.description?.replace("توريد إلى خزنة العهدة — ", "") || "—";
                const pm = lastTransferTxn.payment_method === "cash" ? "نقدي" : lastTransferTxn.payment_method === "transfer" ? "تحويل بنكي / محفظة" : lastTransferTxn.payment_method || "—";
                return (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-2 text-sm">
                    <div><span className="text-muted-foreground text-xs">رقم الحركة</span><div className="font-mono font-semibold">{lastTransferTxn.reference_no}</div></div>
                    <div><span className="text-muted-foreground text-xs">التاريخ والوقت</span><div className="font-semibold">{fmtDate(lastTransferTxn.created_at)}</div></div>
                    <div><span className="text-muted-foreground text-xs">المبلغ</span><div className="font-mono font-bold text-primary">{fmtNum(lastTransferTxn.amount,2)} ج.م</div></div>
                    <div><span className="text-muted-foreground text-xs">الخزنة المصدر</span><div className="font-semibold">الخزنة الرئيسية</div></div>
                    <div><span className="text-muted-foreground text-xs">الخزنة المستلمة</span><div className="font-semibold">خزنة العهدة</div></div>
                    <div><span className="text-muted-foreground text-xs">أمين العهدة المستلم</span><div className="font-semibold">{keeperName}</div></div>
                    <div><span className="text-muted-foreground text-xs">سبب التوريد</span><div className="font-semibold">{reason}</div></div>
                    <div><span className="text-muted-foreground text-xs">طريقة التسليم</span><div className="font-semibold">{pm}</div></div>
                    <div><span className="text-muted-foreground text-xs">الحالة</span><div><Badge variant={STATUS_TONE[lastTransferTxn.status]}>{STATUS_LBL[lastTransferTxn.status] || lastTransferTxn.status}</Badge></div></div>
                    <div><span className="text-muted-foreground text-xs">تم التسجيل بواسطة</span><div className="font-semibold">{lastTransferUserNames[lastTransferTxn.created_by] || lastTransferTxn.created_by.slice(0,8)}</div></div>
                    {lastTransferTxn.approver_1_id && (
                      <>
                        <div><span className="text-muted-foreground text-xs">تم الاعتماد بواسطة</span><div className="font-semibold">{lastTransferUserNames[lastTransferTxn.approver_1_id] || lastTransferTxn.approver_1_id.slice(0,8)}</div></div>
                        <div><span className="text-muted-foreground text-xs">تاريخ الاعتماد</span><div className="font-semibold">{fmtDate(lastTransferTxn.approver_1_at)}</div></div>
                      </>
                    )}
                    <div className="md:col-span-3 pt-1">
                      <Button variant="outline" size="sm" onClick={() => setLastDetailOpen(true)}>عرض التفاصيل</Button>
                    </div>
                  </div>
                );
              })() : (
                <div className="text-center text-muted-foreground py-6">لا توجد تحويلات سابقة إلى خزنة العهدة</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Send className="h-4 w-4"/>توريد إلى خزنة العهدة</CardTitle></CardHeader>
            <CardContent className="grid md:grid-cols-2 gap-3">
              <div><Label>التاريخ</Label>
                <Input type="date" value={transferForm.txn_date} onChange={e=>{ setTransferForm({...transferForm, txn_date: e.target.value}); setTransferDupWarn(""); }}/>
              </div>
              <div><Label>المبلغ *</Label>
                <Input type="number" step="0.01" value={transferForm.amount} onChange={e=>{ setTransferForm({...transferForm, amount: e.target.value}); setTransferDupWarn(""); }}/>
              </div>
              <div><Label>الخزنة المصدر (الخزنة الرئيسية)</Label>
                <Select value={transferForm.account_id} onValueChange={v=>setTransferForm({...transferForm, account_id:v})}>
                  <SelectTrigger><SelectValue placeholder="اختر الحساب"/></SelectTrigger>
                  <SelectContent>{accounts.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>الخزنة المستلمة</Label>
                <Input value="خزنة العهدة (المجزر)" disabled readOnly/>
              </div>
              <div><Label>أمين العهدة المستلم *</Label>
                <Select value={transferForm.custody_keeper_id} onValueChange={v=>{ setTransferForm({...transferForm, custody_keeper_id:v}); setTransferDupWarn(""); }}>
                  <SelectTrigger><SelectValue placeholder="اختر"/></SelectTrigger>
                  <SelectContent>{custodyKeepers.map(k => <SelectItem key={k.user_id} value={k.user_id}>{k.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>اسم المستلم (اختياري — يتعبأ تلقائياً)</Label>
                <Input value={transferForm.recipient_name} onChange={e=>{ setTransferForm({...transferForm, recipient_name: e.target.value}); setTransferDupWarn(""); }} placeholder="اتركه فارغاً لاستخدام اسم أمين العهدة"/>
              </div>
              <div><Label>طريقة التسليم</Label>
                <Select value={transferForm.payment_method} onValueChange={v=>setTransferForm({...transferForm, payment_method: v as any})}>
                  <SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">نقدي</SelectItem>
                    <SelectItem value="transfer">تحويل بنكي / محفظة</SelectItem>
                    <SelectItem value="other">أخرى</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>مرفق إيصال (اختياري)</Label>
                <Input type="file" accept="image/*,application/pdf" onChange={e=>setTransferReceipt(e.target.files?.[0] || null)}/>
                {transferReceipt && <div className="text-xs text-muted-foreground mt-1">{transferReceipt.name}</div>}
              </div>
              <div className="md:col-span-2"><Label>سبب التوريد *</Label>
                <Input value={transferForm.reason} onChange={e=>setTransferForm({...transferForm, reason: e.target.value})} placeholder="مثال: مصاريف تشغيل أسبوعية للمجزر"/>
              </div>
              <div className="md:col-span-2"><Label>ملاحظات</Label>
                <Textarea value={transferForm.notes} onChange={e=>setTransferForm({...transferForm, notes: e.target.value})}/>
              </div>
              {transferDupWarn && (
                <div className="md:col-span-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-destructive"/>
                  <div>{transferDupWarn}</div>
                </div>
              )}
              <div className="md:col-span-2 rounded-md border border-[hsl(38_92%_50%)]/40 bg-[hsl(38_92%_50%)]/10 p-3 text-xs flex items-start gap-2">
                <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0"/>
                <div>
                  هذا توريد بين الخزن (ليس مصروفاً). لن يُخصم من الخزنة الرئيسية ولن يُضاف إلى خزنة العهدة إلا بعد <b>اعتماد المدير العام أو التنفيذي</b>.
                  بعد الاعتماد، يُخصم المبلغ تلقائياً من الخزنة الرئيسية ويُضاف بنفس القيمة لخزنة العهدة.
                </div>
              </div>
              <div className="md:col-span-2 flex items-center gap-2 flex-wrap">
                <Button onClick={submitTransfer} disabled={busy} className="gap-2">
                  <Send className="h-4 w-4"/>{transferDupWarn ? "تأكيد الإرسال رغم التحذير" : "إرسال طلب التوريد"}
                </Button>
                {transferDupWarn && (
                  <Button variant="ghost" onClick={()=>setTransferDupWarn("")}>إلغاء</Button>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Approve */}
        {isApprover && (
          <TabsContent value="approve" className="mt-4">
            <Card><CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>المرجع</TableHead><TableHead>التاريخ</TableHead><TableHead>النوع</TableHead>
                  <TableHead>المبلغ</TableHead><TableHead>الوصف</TableHead><TableHead>اعتماد</TableHead><TableHead>إجراء</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {pendingTxns.length === 0 ? <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">لا يوجد معاملات بانتظار الاعتماد</TableCell></TableRow>
                  : pendingTxns.map(t => (
                    <TableRow key={t.id}>
                      <TableCell className="font-mono text-xs">{t.reference_no}</TableCell>
                      <TableCell>{t.txn_date}</TableCell>
                      <TableCell>{TYPE_LBL[t.txn_type]}</TableCell>
                      <TableCell className="font-mono font-bold">{fmtNum(t.amount,2)}</TableCell>
                      <TableCell className="max-w-[300px] truncate">{t.description}</TableCell>
                      <TableCell>{t.requires_dual_approval ? <Badge variant="destructive">مزدوج {t.approver_1_id?"(1/2)":"(0/2)"}</Badge> : <Badge>فردي</Badge>}</TableCell>
                      <TableCell className="flex gap-1">
                        <Button size="sm" variant="default" onClick={()=>approve(t)} disabled={busy}><CheckCircle2 className="h-4 w-4"/></Button>
                        <Button size="sm" variant="destructive" onClick={()=>setRejectDlg({open:true, txn:t, reason:""})} disabled={busy}><XCircle className="h-4 w-4"/></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent></Card>
          </TabsContent>
        )}

        {/* Log */}
        <TabsContent value="log" className="mt-4 space-y-3">
          <Card><CardContent className="p-3 grid grid-cols-2 md:grid-cols-5 gap-2">
            <div><Label className="text-xs">الحساب</Label>
              <Select value={logFilter.account_id} onValueChange={v=>setLogFilter({...logFilter, account_id:v})}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الحسابات</SelectItem>
                  {accounts.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">النوع</Label>
              <Select value={logFilter.txn_type} onValueChange={v=>setLogFilter({...logFilter, txn_type:v})}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {Object.entries(TYPE_LBL).map(([k,v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">الحالة</Label>
              <Select value={logFilter.status} onValueChange={v=>setLogFilter({...logFilter, status:v})}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {Object.entries(STATUS_LBL).map(([k,v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">من تاريخ</Label><Input type="date" value={logFilter.from} onChange={e=>setLogFilter({...logFilter, from:e.target.value})}/></div>
            <div><Label className="text-xs">إلى تاريخ</Label><Input type="date" value={logFilter.to} onChange={e=>setLogFilter({...logFilter, to:e.target.value})}/></div>
            <div className="md:col-span-3"><Label className="text-xs">بحث (مرجع/وصف/مستفيد)</Label><Input value={logFilter.search} onChange={e=>setLogFilter({...logFilter, search:e.target.value})}/></div>
            <div className="md:col-span-2 flex items-end gap-2">
              <Button variant="outline" size="sm" className="gap-1" onClick={()=>{
                const rows = txns.filter(t =>
                  (logFilter.account_id === "all" || t.account_id === logFilter.account_id) &&
                  (logFilter.txn_type === "all" || t.txn_type === logFilter.txn_type) &&
                  (logFilter.status === "all" || t.status === logFilter.status) &&
                  (!logFilter.from || t.txn_date >= logFilter.from) &&
                  (!logFilter.to || t.txn_date <= logFilter.to) &&
                  (!logFilter.search || `${t.reference_no} ${t.description} ${t.counterparty||""}`.toLowerCase().includes(logFilter.search.toLowerCase()))
                ).map(t => ({
                  "المرجع": t.reference_no, "التاريخ": t.txn_date,
                  "النوع": TYPE_LBL[t.txn_type] || t.txn_type,
                  "الحساب": accounts.find(a=>a.id===t.account_id)?.name || "",
                  "المبلغ": Number(t.amount),
                  "البند": cats.find(c=>c.id===t.category_id)?.label || "",
                  "المستفيد": t.counterparty || "", "الوصف": t.description,
                  "الحالة": STATUS_LBL[t.status] || t.status,
                }));
                const ws = XLSX.utils.json_to_sheet(rows);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, "حركات الخزنة");
                XLSX.writeFile(wb, `main-treasury-${today()}.xlsx`);
              }}><FileDown className="h-4 w-4"/>تصدير Excel</Button>
              <Button variant="outline" size="sm" className="gap-1" onClick={()=>setLogFilter({ account_id:"all", txn_type:"all", status:"all", from:"", to:"", search:"" })}>إعادة ضبط الفلاتر</Button>
            </div>
          </CardContent></Card>
          <Card><CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>المرجع</TableHead><TableHead>التاريخ</TableHead><TableHead>النوع</TableHead>
                <TableHead>الحساب</TableHead><TableHead>المبلغ</TableHead><TableHead>البند</TableHead>
                <TableHead>الوصف</TableHead><TableHead>الحالة</TableHead><TableHead>طباعة</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {(() => {
                  const filtered = txns.filter(t =>
                    (logFilter.account_id === "all" || t.account_id === logFilter.account_id) &&
                    (logFilter.txn_type === "all" || t.txn_type === logFilter.txn_type) &&
                    (logFilter.status === "all" || t.status === logFilter.status) &&
                    (!logFilter.from || t.txn_date >= logFilter.from) &&
                    (!logFilter.to || t.txn_date <= logFilter.to) &&
                    (!logFilter.search || `${t.reference_no} ${t.description} ${t.counterparty||""}`.toLowerCase().includes(logFilter.search.toLowerCase()))
                  );
                  if (filtered.length === 0) return <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">لا توجد حركات مطابقة</TableCell></TableRow>;
                  return filtered.map(t => {
                  const acc = accounts.find(a => a.id === t.account_id);
                  const cat = cats.find(c => c.id === t.category_id);
                  return (
                    <TableRow key={t.id}>
                      <TableCell className="font-mono text-xs">{t.reference_no}</TableCell>
                      <TableCell>{t.txn_date}</TableCell>
                      <TableCell>{TYPE_LBL[t.txn_type] || t.txn_type}</TableCell>
                      <TableCell>{acc?.name || "—"}</TableCell>
                      <TableCell className="font-mono font-bold">{fmtNum(t.amount,2)}</TableCell>
                      <TableCell>{cat?.label || "—"}</TableCell>
                      <TableCell className="max-w-[250px] truncate">{t.description}</TableCell>
                      <TableCell><Badge variant={STATUS_TONE[t.status]}>{STATUS_LBL[t.status]}</Badge></TableCell>
                      <TableCell><Button size="sm" variant="ghost" onClick={()=>printVoucher(t)}><Printer className="h-4 w-4"/></Button></TableCell>
                    </TableRow>
                  );
                  });
                })()}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        {/* Transfers Log */}
        <TabsContent value="transfers" className="mt-4">
          <Card><CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>التاريخ</TableHead><TableHead>المبلغ</TableHead><TableHead>المستلم</TableHead>
                <TableHead>الحالة</TableHead><TableHead>وقت الاستلام</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {transfers.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">لا توجد تحويلات</TableCell></TableRow>
                : transfers.map(x => {
                  const k = custodyKeepers.find(c => c.user_id === x.custody_keeper_id);
                  return (
                    <TableRow key={x.id}>
                      <TableCell>{x.transfer_date}</TableCell>
                      <TableCell className="font-mono font-bold">{fmtNum(x.amount,2)}</TableCell>
                      <TableCell>{k?.name || x.custody_keeper_id.slice(0,8)}</TableCell>
                      <TableCell><Badge variant={x.status==="received"?"default":x.status==="rejected"?"destructive":"secondary"}>
                        {x.status==="received"?"مُستلَم":x.status==="rejected"?"مرفوض":"مُرسَل"}
                      </Badge></TableCell>
                      <TableCell>{x.received_at ? fmtDate(x.received_at) : "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        {/* Audit Log */}
        <TabsContent value="audit" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><History className="h-4 w-4"/>سجل التدقيق (Audit Log)</CardTitle></CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>الوقت</TableHead><TableHead>الإجراء</TableHead>
                  <TableHead>من حالة</TableHead><TableHead>إلى حالة</TableHead>
                  <TableHead>المرجع</TableHead><TableHead>تفاصيل</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {auditLog.length === 0
                    ? <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">لا توجد قيود تدقيق</TableCell></TableRow>
                    : auditLog.map(l => {
                        const tx = txns.find(t => t.id === l.txn_id);
                        return <TableRow key={l.id}>
                          <TableCell className="text-xs">{fmtDate(l.performed_at)}</TableCell>
                          <TableCell><Badge variant="outline">{l.action}</Badge></TableCell>
                          <TableCell className="text-xs">{l.old_status ? (STATUS_LBL[l.old_status]||l.old_status) : "—"}</TableCell>
                          <TableCell className="text-xs">{l.new_status ? (STATUS_LBL[l.new_status]||l.new_status) : "—"}</TableCell>
                          <TableCell className="font-mono text-xs">{tx?.reference_no || "—"}</TableCell>
                          <TableCell className="text-xs max-w-[300px] truncate">{l.details ? JSON.stringify(l.details) : "—"}</TableCell>
                        </TableRow>;
                      })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Settings */}
        <TabsContent value="settings" className="mt-4 space-y-4">
          <Card>
            <CardHeader><CardTitle>إضافة حساب جديد</CardTitle></CardHeader>
            <CardContent className="grid md:grid-cols-2 lg:grid-cols-4 gap-3">
              <div><Label>الاسم</Label><Input value={newAccount.name} onChange={e=>setNewAccount({...newAccount, name:e.target.value})}/></div>
              <div><Label>النوع</Label>
                <Select value={newAccount.account_type} onValueChange={v=>setNewAccount({...newAccount, account_type:v as any})}>
                  <SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">نقدي</SelectItem>
                    <SelectItem value="bank">بنك</SelectItem>
                    <SelectItem value="wallet">محفظة إلكترونية</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>اسم البنك / المحفظة</Label><Input value={newAccount.bank_name} onChange={e=>setNewAccount({...newAccount, bank_name:e.target.value})}/></div>
              <div><Label>الرصيد الافتتاحي</Label><Input type="number" step="0.01" value={newAccount.opening_balance} onChange={e=>setNewAccount({...newAccount, opening_balance:e.target.value})}/></div>
              <div className="md:col-span-2 lg:col-span-4"><Button onClick={createAccount}><Plus className="h-4 w-4 ml-1"/>إنشاء الحساب</Button></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>الحسابات الحالية</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>الاسم</TableHead><TableHead>النوع</TableHead><TableHead>البنك</TableHead><TableHead>الافتتاحي</TableHead><TableHead>إجراء</TableHead></TableRow></TableHeader>
                <TableBody>
                  {accounts.map(a => (
                    <TableRow key={a.id}>
                      <TableCell>{a.name}</TableCell><TableCell>{a.account_type}</TableCell>
                      <TableCell>{a.bank_name || "—"}</TableCell>
                      <TableCell className="font-mono">{fmtNum(a.opening_balance,2)}</TableCell>
                      <TableCell><Button size="sm" variant="outline" onClick={()=>setEditOpenBal({open:true, account:a, value:String(a.opening_balance)})}>تعديل الافتتاحي</Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>بنود المصروفات</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {cats.map(c => <Badge key={c.id} variant="outline" className="text-sm py-1 px-3">{c.label}</Badge>)}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="analytics" className="mt-4">
          <MainExpenseAnalytics txns={txns as any} categories={cats} typeLabels={TYPE_LBL} />
        </TabsContent>
      </Tabs>


      <Dialog open={rejectDlg.open} onOpenChange={o => !o && setRejectDlg({open:false, reason:""})}>
        <DialogContent dir="rtl">
          <DialogHeader><DialogTitle>رفض المعاملة</DialogTitle></DialogHeader>
          <Textarea placeholder="سبب الرفض (إجباري)" value={rejectDlg.reason} onChange={e=>setRejectDlg({...rejectDlg, reason:e.target.value})}/>
          <DialogFooter>
            <Button variant="ghost" onClick={()=>setRejectDlg({open:false, reason:""})}>إلغاء</Button>
            <Button variant="destructive" onClick={reject} disabled={busy}>تأكيد الرفض</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpenBal.open} onOpenChange={o => !o && setEditOpenBal({open:false, value:""})}>
        <DialogContent dir="rtl">
          <DialogHeader><DialogTitle>تعديل الرصيد الافتتاحي — {editOpenBal.account?.name}</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>الرصيد الافتتاحي (ج.م)</Label>
            <Input type="number" step="0.01" value={editOpenBal.value} onChange={e=>setEditOpenBal({...editOpenBal, value:e.target.value})}/>
            <div className="text-xs text-muted-foreground">سيتم احتساب الرصيد الحالي = الافتتاحي + كل الحركات المُرحَّلة.</div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={()=>setEditOpenBal({open:false, value:""})}>إلغاء</Button>
            <Button onClick={saveOpeningBalance} disabled={busy}>حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={lastDetailOpen} onOpenChange={setLastDetailOpen}>
        <DialogContent dir="rtl" className="max-w-lg">
          <DialogHeader>
            <DialogTitle>تفاصيل تحويل إلى خزنة العهدة — {lastTransferTxn?.reference_no || "—"}</DialogTitle>
          </DialogHeader>
          {lastTransferTxn ? (() => {
            const keeperName = custodyKeepers.find(k => k.user_id === lastTransferLink?.custody_keeper_id)?.name || "—";
            const reason = lastTransferTxn.description?.replace("توريد إلى خزنة العهدة — ", "") || "—";
            const pm = lastTransferTxn.payment_method === "cash" ? "نقدي" : lastTransferTxn.payment_method === "transfer" ? "تحويل بنكي / محفظة" : lastTransferTxn.payment_method || "—";
            return (
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  <div><span className="text-muted-foreground text-xs block">رقم الحركة</span><span className="font-mono font-semibold">{lastTransferTxn.reference_no}</span></div>
                  <div><span className="text-muted-foreground text-xs block">المبلغ</span><span className="font-mono font-bold text-primary">{fmtNum(lastTransferTxn.amount,2)} ج.م</span></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><span className="text-muted-foreground text-xs block">التاريخ</span><span className="font-semibold">{lastTransferTxn.txn_date}</span></div>
                  <div><span className="text-muted-foreground text-xs block">وقت التسجيل</span><span className="font-semibold">{fmtDate(lastTransferTxn.created_at)}</span></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><span className="text-muted-foreground text-xs block">الخزنة المصدر</span><span className="font-semibold">الخزنة الرئيسية</span></div>
                  <div><span className="text-muted-foreground text-xs block">الخزنة المستلمة</span><span className="font-semibold">خزنة العهدة</span></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><span className="text-muted-foreground text-xs block">أمين العهدة المستلم</span><span className="font-semibold">{keeperName}</span></div>
                  <div><span className="text-muted-foreground text-xs block">طريقة التسليم</span><span className="font-semibold">{pm}</span></div>
                </div>
                <div><span className="text-muted-foreground text-xs block">سبب التوريد</span><span className="font-semibold">{reason}</span></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><span className="text-muted-foreground text-xs block">الحالة</span><Badge variant={STATUS_TONE[lastTransferTxn.status]}>{STATUS_LBL[lastTransferTxn.status] || lastTransferTxn.status}</Badge></div>
                  <div><span className="text-muted-foreground text-xs block">تم التسجيل بواسطة</span><span className="font-semibold">{lastTransferUserNames[lastTransferTxn.created_by] || lastTransferTxn.created_by.slice(0,8)}</span></div>
                </div>
                {lastTransferTxn.approver_1_id && (
                  <div className="grid grid-cols-2 gap-3">
                    <div><span className="text-muted-foreground text-xs block">تم الاعتماد بواسطة</span><span className="font-semibold">{lastTransferUserNames[lastTransferTxn.approver_1_id] || lastTransferTxn.approver_1_id.slice(0,8)}</span></div>
                    <div><span className="text-muted-foreground text-xs block">تاريخ الاعتماد</span><span className="font-semibold">{fmtDate(lastTransferTxn.approver_1_at)}</span></div>
                  </div>
                )}
                {lastTransferTxn.rejection_reason && (
                  <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm">
                    <span className="text-muted-foreground text-xs block">سبب الرفض</span>
                    <span className="text-destructive font-semibold">{lastTransferTxn.rejection_reason}</span>
                  </div>
                )}
              </div>
            );
          })() : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setLastDetailOpen(false)}>إغلاق</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
