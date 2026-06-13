import { useEffect, useMemo, useState } from "react";
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
import { Plus, Building2, FileDown, Printer, Paperclip, Wallet, Banknote, Receipt, RefreshCw, ArrowRightLeft } from "lucide-react";
import { openPrintWindow, escapeHtml, fmtNum, fmtDate } from "@/lib/printPdf";
import * as XLSX from "xlsx";
import DragDropUpload from "./DragDropUpload";

type Account = { id: string; name: string; account_type: "cash"|"bank"|"wallet"; bank_name: string|null; account_number: string|null; opening_balance: number; is_active: boolean };
type Balance = { account_id: string; name: string; account_type: string; bank_name: string|null; opening_balance: number; current_balance: number; pending_amount: number; pending_count: number };
type BankCategory = { id: string; code: string; label: string; requires_attachment: boolean; is_active: boolean; sort_order: number };
type Txn = {
  id: string; reference_no: string; account_id: string; txn_type: string; amount: number; txn_date: string;
  category_id: string | null; bank_category_id: string | null; loan_number: string | null; bank_account_number: string | null;
  payment_method: string | null; counterparty: string | null; description: string; status: string;
  attachment_url: string | null; created_at: string; created_by: string; rejection_reason: string | null;
  incoming_source: string | null; attachment_name: string | null; attachment_mime: string | null;
  attachment_size: number | null; attachment_uploaded_by: string | null; attachment_uploaded_at: string | null;
};

const INCOMING_SOURCES = [
  { value: "hyper_healthy", label: "هايبر هيلثي تيست", attachmentRequired: false },
  { value: "carrefour", label: "كارفور", attachmentRequired: false },
  { value: "external_customer", label: "عميل خارجي", attachmentRequired: false },
  { value: "direct_customer", label: "عميل مباشر", attachmentRequired: false },
  { value: "other", label: "جهة أخرى", attachmentRequired: false },
];
const SOURCE_LBL: Record<string,string> = Object.fromEntries(INCOMING_SOURCES.map(s => [s.value, s.label]));

const BANK_TXN_TYPES: { value: string; label: string; direction: "in"|"out"|"neutral" }[] = [
  { value: "bank_deposit", label: "إيداع بنكي", direction: "in" },
  { value: "bank_withdrawal", label: "سحب بنكي", direction: "out" },
  { value: "expense", label: "مصروف بنكي", direction: "out" },
  { value: "loan_installment", label: "قسط قرض", direction: "out" },
  { value: "bank_fees", label: "رسوم بنكية", direction: "out" },
  { value: "transfer_from_custody", label: "تحويل من النقدية إلى البنك", direction: "in" },
  { value: "transfer_to_custody", label: "تحويل من البنك إلى النقدية", direction: "out" },
  { value: "transfer_to_sub_treasury", label: "تحويل من البنك إلى خزنة فرعية", direction: "out" },
  { value: "settlement", label: "تسوية بنكية", direction: "in" },
  { value: "balance_correction", label: "تصحيح رصيد (اعتماد الإدارة)", direction: "neutral" },
];
const TYPE_LBL: Record<string,string> = Object.fromEntries(BANK_TXN_TYPES.map(t => [t.value, t.label]));
const STATUS_LBL: Record<string,string> = {
  draft: "مسودة", pending_approval: "بانتظار الاعتماد", approved: "معتمد جزئياً",
  posted: "مُرحَّل", rejected: "مرفوض", reversed: "معكوس",
};
const STATUS_TONE: Record<string, "default"|"secondary"|"destructive"|"outline"> = {
  draft: "outline", pending_approval: "secondary", approved: "secondary",
  posted: "default", rejected: "destructive", reversed: "outline",
};
const PAYMENT_METHODS = [
  { value: "direct_debit", label: "خصم مباشر من البنك" },
  { value: "transfer", label: "تحويل" },
  { value: "cheque", label: "شيك" },
  { value: "other", label: "أخرى" },
];

const today = () => new Date().toISOString().slice(0,10);
const monthStart = () => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0,10); };

export default function BankAccountPanel() {
  const { user, roles } = useAuth();
  const rs = roles as string[];
  const isApprover = rs.some(r => ["main_treasury_approver","general_manager","executive_manager","financial_manager"].includes(r));
  const isAccountant = rs.includes("main_treasury_accountant");
  const canWrite = isApprover || isAccountant;

  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [cats, setCats] = useState<BankCategory[]>([]);
  const [txns, setTxns] = useState<Txn[]>([]);

  // Bank-only filtered
  const bankAccountIds = useMemo(() => new Set(accounts.filter(a => a.account_type === "bank").map(a => a.id)), [accounts]);
  const bankBalances = useMemo(() => balances.filter(b => b.account_type === "bank"), [balances]);
  const bankTxns = useMemo(() => txns.filter(t => bankAccountIds.has(t.account_id)), [txns, bankAccountIds]);

  // Filters
  const [f, setF] = useState({ account_id: "all", txn_type: "all", status: "all", category_id: "all", bank_name: "all", incoming_source: "all", missing_attachment: false, from: "", to: "" });

  // Dialogs
  const [txnDlg, setTxnDlg] = useState(false);
  const [catDlg, setCatDlg] = useState(false);
  const [busy, setBusy] = useState(false);
  const [clientUuid, setClientUuid] = useState("");

  const emptyForm = {
    account_id: "", txn_type: "expense", amount: "", txn_date: today(),
    bank_category_id: "", loan_number: "", bank_account_number: "", payment_method: "transfer",
    counterparty: "", description: "", attachment_url: "" as string | null,
    incoming_source: "" as string,
  };
  const [form, setForm] = useState<typeof emptyForm>(emptyForm);
  const [file, setFile] = useState<File | null>(null);

  // Change-attachment dialog (post-creation)
  const [changeAttachDlg, setChangeAttachDlg] = useState<{open:boolean; txn?:Txn; reason:string; file:File|null}>({ open:false, reason:"", file:null });

  const emptyCat = { code: "", label: "", requires_attachment: false, notes: "" };
  const [catForm, setCatForm] = useState(emptyCat);

  // Cash → Bank transfer dialog
  const [transferDlg, setTransferDlg] = useState(false);
  const emptyTransfer = {
    cash_account_id: "", bank_account_id: "", amount: "", txn_date: today(),
    bank_name: "", bank_account_number: "",
    deposit_purpose: "loan_installment" as "loan_installment"|"bank_fees"|"general"|"other",
    cash_handover_by: "", bank_depositor_by: "",
    description: "", notes: "",
  };
  const [transferForm, setTransferForm] = useState(emptyTransfer);
  const [transferFile, setTransferFile] = useState<File | null>(null);
  const [transferUuid, setTransferUuid] = useState("");

  function openTransferDlg() {
    const cash = accounts.find(a => a.account_type === "cash");
    const bank = accounts.find(a => a.account_type === "bank");
    setTransferForm({ ...emptyTransfer,
      cash_account_id: cash?.id || "", bank_account_id: bank?.id || "",
      bank_name: bank?.bank_name || "", bank_account_number: bank?.account_number || "" });
    setTransferFile(null);
    setTransferUuid(crypto.randomUUID());
    setTransferDlg(true);
  }

  async function submitTransfer() {
    if (!transferForm.cash_account_id || !transferForm.bank_account_id) return toast.error("اختر الخزنة والحساب البنكي");
    const amt = Number(transferForm.amount || 0);
    if (amt <= 0) return toast.error("المبلغ مطلوب");
    if (!transferForm.cash_handover_by.trim() || !transferForm.bank_depositor_by.trim())
      return toast.error("اسم المستلم والمودع مطلوبان");
    setBusy(true);
    let attachmentPath: string | null = null;
    if (transferFile) {
      const ext = transferFile.name.split(".").pop() || "bin";
      const path = `${user!.id}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await (supabase as any).storage.from("main-treasury-attachments")
        .upload(path, transferFile, { cacheControl: "3600", upsert: false });
      if (upErr) { setBusy(false); return toast.error("رفع المرفق: " + upErr.message); }
      attachmentPath = path;
    }
    const purposeLbl: Record<string,string> = {
      loan_installment: "تغطية قسط قرض", bank_fees: "تغطية مصروف بنكي",
      general: "إيداع عام", other: "أخرى",
    };
    const desc = transferForm.description?.trim()
      || `إيداع من الخزنة إلى البنك — ${purposeLbl[transferForm.deposit_purpose]}` + (transferForm.notes ? ` — ${transferForm.notes}` : "");
    const { error } = await (supabase as any).rpc("mt_create_cash_to_bank_transfer", {
      p_cash_account_id: transferForm.cash_account_id,
      p_bank_account_id: transferForm.bank_account_id,
      p_amount: amt,
      p_txn_date: transferForm.txn_date,
      p_bank_name: transferForm.bank_name || null,
      p_bank_account_number: transferForm.bank_account_number || null,
      p_deposit_purpose: transferForm.deposit_purpose,
      p_cash_handover_by: transferForm.cash_handover_by,
      p_bank_depositor_by: transferForm.bank_depositor_by,
      p_attachment_url: attachmentPath,
      p_description: desc,
      p_client_uuid: transferUuid,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("تم تسجيل طلب الإيداع — بانتظار اعتماد المدير");
    setTransferDlg(false);
    fetchAll();
  }

  async function fetchAll(opts?: { silent?: boolean }) {
    setLoading(true);
    const [a, b, c, t] = await Promise.all([
      (supabase as any).from("main_treasury_accounts").select("*").eq("is_active", true).order("created_at"),
      (supabase as any).from("v_main_treasury_balance").select("*"),
      (supabase as any).from("main_treasury_bank_categories").select("*").order("sort_order"),
      (supabase as any).from("main_treasury_transactions").select("*").order("created_at", { ascending: false }).limit(1000),
    ]);
    setAccounts(a.data || []);
    setBalances(b.data || []);
    setCats(c.data || []);
    setTxns(t.data || []);
    setLoading(false);
    if (!opts?.silent) toast.success("تم التحديث بنجاح");
  }
  useEffect(() => { if (user) fetchAll({ silent: true }); /* eslint-disable-next-line */ }, [user?.id]);

  async function toggleCategoryActive(cat: BankCategory) {
    // Block disabling if used in any non-rejected transaction
    if (cat.is_active) {
      const { count } = await (supabase as any)
        .from("main_treasury_transactions")
        .select("id", { count: "exact", head: true })
        .eq("bank_category_id", cat.id)
        .neq("status", "rejected");
      if ((count || 0) > 0 && !isApprover) {
        return toast.error("لا يمكن تعطيل بند مستخدم في حركات — يحتاج صلاحية الإدارة");
      }
    }
    const { error } = await (supabase as any)
      .from("main_treasury_bank_categories")
      .update({ is_active: !cat.is_active })
      .eq("id", cat.id);
    if (error) return toast.error(error.message);
    toast.success(cat.is_active ? "تم تعطيل البند" : "تم تفعيل البند");
    fetchAll({ silent: true });
  }

  function openTxnDlg() {
    setForm({ ...emptyForm, account_id: accounts.find(a => a.account_type === "bank")?.id || "" });
    setFile(null);
    setClientUuid(crypto.randomUUID());
    setTxnDlg(true);
  }

  async function uploadAttachment(): Promise<string | null> {
    if (!file) return null;
    const ext = file.name.split(".").pop() || "bin";
    const path = `${user!.id}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
    const { error } = await (supabase as any).storage.from("main-treasury-attachments").upload(path, file, { cacheControl: "3600", upsert: false });
    if (error) { toast.error("رفع المرفق: " + error.message); return null; }
    return path;
  }

  async function submitTxn() {
    if (!form.account_id) return toast.error("اختر الحساب البنكي");
    const acc = accounts.find(a => a.id === form.account_id);
    if (!acc || acc.account_type !== "bank") return toast.error("الحساب يجب أن يكون من نوع بنك");
    const amt = Number(form.amount || 0);
    if (amt <= 0) return toast.error("المبلغ مطلوب");
    if (!form.description.trim()) return toast.error("الوصف مطلوب");
    const needsCat = ["expense","loan_installment","bank_fees"].includes(form.txn_type);
    if (needsCat && !form.bank_category_id) return toast.error("اختر بند المصروف البنكي");
    if (form.txn_type === "loan_installment" && !form.loan_number.trim()) return toast.error("رقم القرض مطلوب");

    // Incoming transfer: attachment is OPTIONAL — warn but allow save without receipt
    const isIncoming = form.txn_type === "bank_deposit";
    if (isIncoming && !form.incoming_source) return toast.error("اختر مصدر التحويل الوارد");
    const incomingWithoutReceipt = isIncoming && !file;

    setBusy(true);
    let attachmentPath: string | null = null;
    if (file) {
      attachmentPath = await uploadAttachment();
      if (!attachmentPath) { setBusy(false); return; }
    }

    const { error } = await (supabase as any).from("main_treasury_transactions").insert({
      account_id: form.account_id,
      txn_type: form.txn_type,
      amount: amt,
      txn_date: form.txn_date,
      bank_category_id: form.bank_category_id || null,
      loan_number: form.loan_number || null,
      bank_account_number: form.bank_account_number || acc.account_number || null,
      payment_method: form.payment_method || null,
      counterparty: form.counterparty || (acc.bank_name || null),
      description: form.description,
      attachment_url: attachmentPath,
      incoming_source: isIncoming ? form.incoming_source : null,
      attachment_name: file?.name || null,
      attachment_mime: file?.type || null,
      attachment_size: file?.size || null,
      attachment_uploaded_by: attachmentPath ? user!.id : null,
      attachment_uploaded_at: attachmentPath ? new Date().toISOString() : null,
      client_uuid: clientUuid,
      created_by: user!.id,
    });
    setBusy(false);
    if (error) {
      if (error.code === "23505") return toast.error("هذه الحركة مسجلة بالفعل (تم منع التكرار)");
      return toast.error(error.message);
    }
    if (incomingWithoutReceipt) {
      toast.warning("تم حفظ الحركة بدون إيصال تحويل. يمكن رفع الإيصال لاحقًا قبل أو أثناء المراجعة.");
    } else {
      toast.success("تم تسجيل الحركة البنكية — حسب القيمة قد تحتاج اعتماد");
    }
    setTxnDlg(false);
    fetchAll();
  }

  async function submitChangeAttachment() {
    const t = changeAttachDlg.txn;
    if (!t || !changeAttachDlg.file) return toast.error("اختر ملف الصورة الجديد");
    if (!changeAttachDlg.reason.trim() && t.status === "posted") return toast.error("سبب التغيير مطلوب بعد الاعتماد");
    setBusy(true);
    const ext = changeAttachDlg.file.name.split(".").pop() || "bin";
    const path = `${user!.id}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await (supabase as any).storage.from("main-treasury-attachments")
      .upload(path, changeAttachDlg.file, { cacheControl: "3600", upsert: false });
    if (upErr) { setBusy(false); return toast.error("رفع الصورة: " + upErr.message); }
    const { error } = await (supabase as any).from("main_treasury_transactions").update({
      attachment_url: path,
      attachment_name: changeAttachDlg.file.name,
      attachment_mime: changeAttachDlg.file.type,
      attachment_size: changeAttachDlg.file.size,
      attachment_uploaded_by: user!.id,
      attachment_uploaded_at: new Date().toISOString(),
      attachment_change_reason: changeAttachDlg.reason || null,
    }).eq("id", t.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("تم تحديث صورة التحويل");
    setChangeAttachDlg({ open:false, reason:"", file:null });
    fetchAll();
  }

  async function submitCategory() {
    if (!catForm.code.trim() || !catForm.label.trim()) return toast.error("الكود والاسم مطلوبان");
    setBusy(true);
    const { error } = await (supabase as any).from("main_treasury_bank_categories").insert({
      code: catForm.code.trim(), label: catForm.label.trim(),
      requires_attachment: catForm.requires_attachment, notes: catForm.notes || null,
      created_by: user!.id, sort_order: (cats.at(-1)?.sort_order || 0) + 1,
    });
    setBusy(false);
    if (error) return toast.error(error.code === "23505" ? "الكود مستخدم بالفعل" : error.message);
    toast.success("تم إنشاء بند المصروف");
    setCatForm(emptyCat);
    setCatDlg(false);
    fetchAll();
  }

  // KPIs per all bank accounts
  const sumByType = (type: string) => bankTxns.filter(t => t.status === "posted" && t.txn_type === type).reduce((s,t)=>s+Number(t.amount),0);
  const totalBalance = bankBalances.reduce((s,b)=>s+Number(b.current_balance||0), 0);
  const totalOpening = bankBalances.reduce((s,b)=>s+Number(b.opening_balance||0), 0);
  const totalDeposits = sumByType("bank_deposit") + sumByType("transfer_from_custody");
  const totalWithdrawals = sumByType("bank_withdrawal") + sumByType("transfer_to_custody") + sumByType("transfer_to_sub_treasury");
  const totalExpenses = sumByType("expense");
  const totalLoanInstallments = sumByType("loan_installment");
  const totalBankFees = sumByType("bank_fees");
  const pendingCount = bankTxns.filter(t => t.status === "pending_approval").length;
  const pendingAmount = bankTxns.filter(t => t.status === "pending_approval").reduce((s,t)=>{
    const dir = BANK_TXN_TYPES.find(x => x.value === t.txn_type)?.direction;
    return s + (dir === "in" ? Number(t.amount) : dir === "out" ? -Number(t.amount) : 0);
  }, 0);
  const expectedBalance = totalBalance + pendingAmount;

  // Cash → Bank deposits stats (incoming bank legs from internal transfers)
  const inToday = today();
  const inMonthStart = monthStart();
  const cashToBankLegs = bankTxns.filter(t => t.txn_type === "transfer_from_custody");
  const cashToBankTodayTotal = cashToBankLegs.filter(t => t.status==="posted" && t.txn_date === inToday).reduce((s,t)=>s+Number(t.amount),0);
  const cashToBankMonthTotal = cashToBankLegs.filter(t => t.status==="posted" && t.txn_date >= inMonthStart).reduce((s,t)=>s+Number(t.amount),0);
  const cashToBankPending = cashToBankLegs.filter(t => t.status==="pending_approval").reduce((s,t)=>s+Number(t.amount),0);
  const lastCashToBankReceipt = cashToBankLegs.find(t => !!t.attachment_url)?.attachment_url || null;

  // Filtered list for table + reports
  const filtered = useMemo(() => bankTxns.filter(t =>
    (f.account_id === "all" || t.account_id === f.account_id) &&
    (f.txn_type === "all" || t.txn_type === f.txn_type) &&
    (f.status === "all" || t.status === f.status) &&
    (f.category_id === "all" || t.bank_category_id === f.category_id) &&
    (f.bank_name === "all" || (accounts.find(a => a.id === t.account_id)?.bank_name || "") === f.bank_name) &&
    (f.incoming_source === "all" || t.incoming_source === f.incoming_source) &&
    (!f.missing_attachment || (!t.attachment_url && t.txn_type === "bank_deposit")) &&
    (!f.from || t.txn_date >= f.from) &&
    (!f.to || t.txn_date <= f.to)
  ), [bankTxns, f, accounts]);

  const bankNames = useMemo(() => Array.from(new Set(accounts.filter(a => a.account_type==="bank" && a.bank_name).map(a => a.bank_name!))), [accounts]);

  // Export
  function exportExcel() {
    const rows = filtered.map(t => ({
      "المرجع": t.reference_no,
      "التاريخ": t.txn_date,
      "نوع الحركة": TYPE_LBL[t.txn_type] || t.txn_type,
      "الحساب": accounts.find(a => a.id === t.account_id)?.name || "",
      "البنك": accounts.find(a => a.id === t.account_id)?.bank_name || "",
      "بند المصروف": cats.find(c => c.id === t.bank_category_id)?.label || "",
      "المبلغ": Number(t.amount),
      "طريقة الدفع": t.payment_method || "",
      "رقم القرض": t.loan_number || "",
      "الجهة": t.counterparty || "",
      "الوصف": t.description,
      "الحالة": STATUS_LBL[t.status] || t.status,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "حركات البنك");
    XLSX.writeFile(wb, `bank-transactions-${today()}.xlsx`);
  }

  function exportPDF(title: string, rowsHTML: string) {
    const body = `
      <header>
        <div><h1>${escapeHtml(title)}</h1><div class="en">Main Treasury — Bank Account</div></div>
        <div class="meta">
          <div><b>تاريخ الطباعة:</b> ${fmtDate(new Date().toISOString())}</div>
          ${f.from || f.to ? `<div><b>الفترة:</b> ${escapeHtml(f.from||"—")} → ${escapeHtml(f.to||"—")}</div>`:""}
        </div>
      </header>
      <div class="stats">
        <div class="stat"><div class="k">الرصيد الحالي</div><div class="v">${fmtNum(totalBalance,2)} ج</div></div>
        <div class="stat"><div class="k">الإيداعات</div><div class="v">${fmtNum(totalDeposits,2)}</div></div>
        <div class="stat"><div class="k">السحوبات</div><div class="v">${fmtNum(totalWithdrawals,2)}</div></div>
        <div class="stat"><div class="k">المصروفات</div><div class="v">${fmtNum(totalExpenses,2)}</div></div>
        <div class="stat"><div class="k">أقساط القرض</div><div class="v">${fmtNum(totalLoanInstallments,2)}</div></div>
        <div class="stat"><div class="k">رسوم بنكية</div><div class="v">${fmtNum(totalBankFees,2)}</div></div>
      </div>
      <table>
        <thead><tr>
          <th>المرجع</th><th>التاريخ</th><th>النوع</th><th>المصدر</th><th>الحساب</th>
          <th>المبلغ</th><th>البند</th><th>الوصف</th><th>الحالة</th><th>صورة</th>
        </tr></thead>
        <tbody>${rowsHTML}</tbody>
      </table>`;
    openPrintWindow(title, body);
  }

  function buildRowsHTML(list: Txn[]) {
    return list.map(t => {
      const acc = accounts.find(a => a.id === t.account_id);
      const cat = cats.find(c => c.id === t.bank_category_id);
      return `<tr>
        <td class="mono">${escapeHtml(t.reference_no)}</td>
        <td>${escapeHtml(t.txn_date)}</td>
        <td>${escapeHtml(TYPE_LBL[t.txn_type]||t.txn_type)}</td>
        <td>${escapeHtml(t.incoming_source ? (SOURCE_LBL[t.incoming_source]||t.incoming_source) : "—")}</td>
        <td>${escapeHtml(acc?.name||"—")}</td>
        <td class="mono">${fmtNum(t.amount,2)}</td>
        <td>${escapeHtml(cat?.label||"—")}</td>
        <td>${escapeHtml(t.description)}</td>
        <td>${escapeHtml(STATUS_LBL[t.status]||t.status)}</td>
        <td>${t.attachment_url ? "✓ مرفقة" : "—"}</td>
      </tr>`;
    }).join("");
  }
  function pdfAll() { exportPDF("تقرير الحساب البنكي", buildRowsHTML(filtered)); }
  function pdfWith(predicate: (t: Txn) => boolean, title: string) {
    exportPDF(title, buildRowsHTML(bankTxns.filter(predicate)));
  }

  async function getAttachmentUrl(path: string) {
    const { data } = await (supabase as any).storage.from("main-treasury-attachments").createSignedUrl(path, 60 * 10);
    return data?.signedUrl as string | undefined;
  }

  if (!canWrite) {
    return <Card><CardContent className="p-8 text-center text-muted-foreground">لا تملك صلاحية رؤية الحساب البنكي.</CardContent></Card>;
  }

  return (
    <div className="space-y-4" dir="rtl">
      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">الرصيد البنكي الحالي</div>
          <div className="text-2xl font-bold font-mono text-primary">{fmtNum(totalBalance,2)} ج</div>
          <div className="text-xs mt-1">افتتاحي: {fmtNum(totalOpening,0)}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">الرصيد المتوقع (بعد المعلقة)</div>
          <div className="text-2xl font-bold font-mono">{fmtNum(expectedBalance,2)}</div>
          <div className="text-xs mt-1">{pendingCount} حركة معلقة</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">إجمالي الإيداعات</div>
          <div className="text-xl font-bold font-mono text-[hsl(142_71%_36%)]">{fmtNum(totalDeposits,2)}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">إجمالي السحوبات</div>
          <div className="text-xl font-bold font-mono text-destructive">{fmtNum(totalWithdrawals,2)}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">المصروفات البنكية</div>
          <div className="text-xl font-bold font-mono">{fmtNum(totalExpenses,2)}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">أقساط القرض المسددة</div>
          <div className="text-xl font-bold font-mono">{fmtNum(totalLoanInstallments,2)}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">الرسوم والمصاريف البنكية</div>
          <div className="text-xl font-bold font-mono">{fmtNum(totalBankFees,2)}</div>
        </CardContent></Card>
        <Card className="md:col-span-2 lg:col-span-2 border-primary/30 bg-primary/5"><CardContent className="p-4">
          <div className="flex items-center justify-between mb-1">
            <div className="text-sm font-bold flex items-center gap-1"><ArrowRightLeft className="h-4 w-4"/>إيداعات من الخزنة</div>
            {lastCashToBankReceipt && (
              <Button size="sm" variant="ghost" className="h-6 px-2"
                onClick={async ()=>{ const u = await getAttachmentUrl(lastCashToBankReceipt); if (u) window.open(u, "_blank"); }}>
                <Paperclip className="h-3 w-3"/> آخر إيصال
              </Button>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div><div className="text-muted-foreground">اليوم</div><div className="font-mono font-bold text-base">{fmtNum(cashToBankTodayTotal,0)}</div></div>
            <div><div className="text-muted-foreground">الشهر</div><div className="font-mono font-bold text-base">{fmtNum(cashToBankMonthTotal,0)}</div></div>
            <div><div className="text-muted-foreground">معلق</div><div className="font-mono font-bold text-base text-[hsl(38_92%_50%)]">{fmtNum(cashToBankPending,0)}</div></div>
          </div>
        </CardContent></Card>
      </div>

      {/* Per-account cards */}
      {bankBalances.length > 0 && (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          {bankBalances.map(b => (
            <Card key={b.account_id}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-base flex items-center gap-2"><Building2 className="h-5 w-5"/> {b.name}</CardTitle>
                <Badge variant="outline">{b.bank_name || "بنك"}</Badge>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold font-mono text-primary">{fmtNum(b.current_balance,2)}</div>
                <div className="text-xs text-muted-foreground">ج.م — رصيد حالي</div>
                <div className="text-xs flex justify-between border-t pt-2 mt-2">
                  <span>افتتاحي: <b>{fmtNum(b.opening_balance,0)}</b></span>
                  {b.pending_count > 0 && <span className="text-[hsl(38_92%_50%)]">معلق: {fmtNum(b.pending_amount,0)} ({b.pending_count})</span>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {bankBalances.length === 0 && (
        <Card><CardContent className="p-6 text-center text-muted-foreground">
          لا توجد حسابات بنكية بعد — أضف حسابًا من تبويب "إعدادات" بنوع "بنك"
        </CardContent></Card>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <Button onClick={openTxnDlg} className="gap-2" disabled={bankBalances.length===0}><Plus className="h-4 w-4"/>تسجيل حركة بنكية</Button>
        <Button onClick={openTransferDlg} className="gap-2 bg-[hsl(142_71%_36%)] hover:bg-[hsl(142_71%_30%)] text-white" disabled={bankBalances.length===0 || !accounts.some(a=>a.account_type==='cash')}>
          <ArrowRightLeft className="h-4 w-4"/>إيداع من الخزنة إلى البنك
        </Button>
        <Button variant="outline" onClick={()=>setCatDlg(true)} className="gap-2"><Receipt className="h-4 w-4"/>إنشاء بند مصروف</Button>
        <Button variant="outline" onClick={pdfAll} className="gap-2"><Printer className="h-4 w-4"/>تصدير PDF</Button>
        <Button variant="outline" onClick={exportExcel} className="gap-2"><FileDown className="h-4 w-4"/>تصدير Excel</Button>
        <Button variant="ghost" onClick={()=>fetchAll()} className="gap-2"><RefreshCw className="h-4 w-4"/>تحديث</Button>
      </div>

      <Tabs defaultValue="log">
        <TabsList>
          <TabsTrigger value="log">سجل الحركات</TabsTrigger>
          <TabsTrigger value="reports">التقارير</TabsTrigger>
          <TabsTrigger value="categories">بنود المصروف</TabsTrigger>
        </TabsList>

        <TabsContent value="log" className="space-y-3 mt-3">
          {/* Filters */}
          <Card><CardContent className="p-3 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
            <div><Label className="text-xs">الحساب</Label>
              <Select value={f.account_id} onValueChange={v=>setF({...f,account_id:v})}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {accounts.filter(a=>a.account_type==="bank").map(a=><SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">النوع</Label>
              <Select value={f.txn_type} onValueChange={v=>setF({...f,txn_type:v})}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {BANK_TXN_TYPES.map(t=><SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">الحالة</Label>
              <Select value={f.status} onValueChange={v=>setF({...f,status:v})}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {Object.entries(STATUS_LBL).map(([k,v])=><SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">بند المصروف</Label>
              <Select value={f.category_id} onValueChange={v=>setF({...f,category_id:v})}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {cats.map(c=><SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">البنك</Label>
              <Select value={f.bank_name} onValueChange={v=>setF({...f,bank_name:v})}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {bankNames.map(n=><SelectItem key={n} value={n}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">مصدر التحويل الوارد</Label>
              <Select value={f.incoming_source} onValueChange={v=>setF({...f,incoming_source:v})}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {INCOMING_SOURCES.map(s=><SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">من</Label><Input type="date" value={f.from} onChange={e=>setF({...f,from:e.target.value})}/></div>
            <div><Label className="text-xs">إلى</Label><Input type="date" value={f.to} onChange={e=>setF({...f,to:e.target.value})}/></div>
            <div className="flex items-end gap-2 md:col-span-2">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={f.missing_attachment} onChange={e=>setF({...f,missing_attachment:e.target.checked})}/>
                حركات بدون صورة تحويل (إيداعات بنكية)
              </label>
            </div>
          </CardContent></Card>

          <Card><CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>المرجع</TableHead><TableHead>التاريخ</TableHead><TableHead>النوع</TableHead>
                <TableHead>المصدر</TableHead>
                <TableHead>الحساب</TableHead><TableHead>المبلغ</TableHead><TableHead>البند</TableHead>
                <TableHead>طريقة الدفع</TableHead><TableHead>الوصف</TableHead><TableHead>الحالة</TableHead>
                <TableHead>صورة التحويل</TableHead><TableHead>إجراء</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {filtered.length === 0
                  ? <TableRow><TableCell colSpan={12} className="text-center py-8 text-muted-foreground">لا توجد حركات</TableCell></TableRow>
                  : filtered.map(t => {
                      const acc = accounts.find(a=>a.id===t.account_id);
                      const cat = cats.find(c=>c.id===t.bank_category_id);
                      const isPending = t.status === "pending_approval";
                      const isOwn = t.created_by === user?.id;
                      const srcDef = INCOMING_SOURCES.find(s=>s.value===t.incoming_source);
                      const requiresAttach = !!srcDef?.attachmentRequired;
                      const missing = requiresAttach && !t.attachment_url;
                      const canChange = (isPending || isApprover);
                      return <TableRow key={t.id}>
                        <TableCell className="font-mono text-xs">{t.reference_no}</TableCell>
                        <TableCell>{t.txn_date}</TableCell>
                        <TableCell>{TYPE_LBL[t.txn_type]||t.txn_type}</TableCell>
                        <TableCell className="text-xs">{t.incoming_source ? (SOURCE_LBL[t.incoming_source]||t.incoming_source) : "—"}</TableCell>
                        <TableCell>{acc?.name || "—"}</TableCell>
                        <TableCell className="font-mono font-bold">{fmtNum(t.amount,2)}</TableCell>
                        <TableCell>{cat?.label || "—"}</TableCell>
                        <TableCell>{PAYMENT_METHODS.find(p=>p.value===t.payment_method)?.label || "—"}</TableCell>
                        <TableCell className="max-w-[240px] truncate">{t.description}</TableCell>
                        <TableCell><Badge variant={STATUS_TONE[t.status]}>{STATUS_LBL[t.status]}</Badge></TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            {t.attachment_url ? (
                              <Button size="sm" variant="outline" className="h-7 gap-1" onClick={async ()=>{
                                const u = await getAttachmentUrl(t.attachment_url!); if (u) window.open(u, "_blank");
                                else toast.error("تعذر فتح الصورة");
                              }}><Paperclip className="h-3 w-3"/>عرض</Button>
                            ) : (
                              <span className="text-xs text-amber-600 dark:text-amber-400 font-semibold">
                                بدون إيصال
                              </span>
                            )}
                            {canChange && (
                              <Button size="sm" variant="ghost" className="h-6 text-xs px-2"
                                onClick={()=>setChangeAttachDlg({ open:true, txn:t, reason:"", file:null })}>
                                تغيير الصورة
                              </Button>
                            )}
                            {t.attachment_name && <div className="text-[10px] text-muted-foreground truncate max-w-[140px]" title={t.attachment_name}>{t.attachment_name}{t.attachment_size?` · ${Math.round(t.attachment_size/1024)}KB`:""}</div>}
                          </div>
                        </TableCell>
                        <TableCell>
                          {isPending && isApprover && !isOwn ? (
                            <div className="flex gap-1">
                              <Button size="sm" variant="default" disabled={busy} onClick={async ()=>{
                                if (t.txn_type === "bank_deposit" && !t.attachment_url) {
                                  if (!window.confirm("تنبيه: هذه الحركة لا تحتوي على إيصال تحويل مرفق. هل تريد الاعتماد على مسؤوليتك؟")) return;
                                } else if (t.attachment_url) {
                                  const u = await getAttachmentUrl(t.attachment_url); if (u) window.open(u, "_blank");
                                  if (!window.confirm("هل راجعت صورة التحويل وتريد الاعتماد؟")) return;
                                }
                                setBusy(true);
                                const { error } = await (supabase as any).rpc("mt_approve_txn", { p_txn_id: t.id });
                                setBusy(false);
                                if (error) return toast.error(error.message);
                                toast.success("تم الاعتماد");
                                fetchAll();
                              }}>اعتماد</Button>
                              <Button size="sm" variant="destructive" disabled={busy} onClick={async ()=>{
                                const reason = window.prompt("سبب الرفض:");
                                if (!reason?.trim()) return;
                                setBusy(true);
                                const { error } = await (supabase as any).rpc("mt_reject_txn", { p_txn_id: t.id, p_reason: reason });
                                setBusy(false);
                                if (error) return toast.error(error.message);
                                toast.success("تم الرفض");
                                fetchAll();
                              }}>رفض</Button>
                            </div>
                          ) : isPending && isOwn ? <span className="text-xs text-muted-foreground">لا يمكن اعتماد حركتك بنفسك</span>
                          : "—"}
                        </TableCell>
                      </TableRow>;
                    })}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="reports" className="mt-3 grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          <ReportCard title="تقرير يومي" hint="حركات اليوم"
            onPdf={()=>pdfWith(t=>t.txn_date===today(), "تقرير يومي — الحساب البنكي")} />
          <ReportCard title="تقرير شهري" hint="حركات هذا الشهر"
            onPdf={()=>pdfWith(t=>t.txn_date>=monthStart(), "تقرير شهري — الحساب البنكي")} />
          <ReportCard title="تقرير أقساط القرض" hint="كل أقساط القرض المسددة"
            onPdf={()=>pdfWith(t=>t.txn_type==="loan_installment", "تقرير أقساط القرض")} />
          <ReportCard title="تقرير المصروفات البنكية" hint="مصروفات + رسوم بنكية"
            onPdf={()=>pdfWith(t=>["expense","bank_fees"].includes(t.txn_type), "تقرير المصروفات البنكية")} />
          <ReportCard title="تقرير إيداعات الخزنة → البنك" hint="تحويلات داخلية من النقدية"
            onPdf={()=>pdfWith(t=>t.txn_type==="transfer_from_custody", "تقرير إيداعات الخزنة إلى البنك")} />
          <ReportCard title="تقرير الحركات المعلقة" hint="بانتظار الاعتماد"
            onPdf={()=>pdfWith(t=>t.status==="pending_approval", "تقرير الحركات المعلقة — البنك")} />
          <ReportCard title="تقرير حسب الفلاتر الحالية" hint="يستخدم فلاتر سجل الحركات" onPdf={pdfAll}/>
        </TabsContent>

        <TabsContent value="categories" className="mt-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>بنود المصروف البنكي</CardTitle>
              <Button size="sm" onClick={()=>setCatDlg(true)} className="gap-2"><Plus className="h-4 w-4"/>إضافة بند</Button>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>الكود</TableHead><TableHead>الاسم</TableHead><TableHead>يحتاج مرفق</TableHead><TableHead>الحالة</TableHead><TableHead>إجراء</TableHead></TableRow></TableHeader>
                <TableBody>
                  {cats.length === 0
                    ? <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">لا توجد بنود — أضف بندًا جديدًا</TableCell></TableRow>
                    : cats.map(c => (
                    <TableRow key={c.id}>
                      <TableCell className="font-mono text-xs">{c.code}</TableCell>
                      <TableCell>{c.label}</TableCell>
                      <TableCell>{c.requires_attachment ? "نعم" : "—"}</TableCell>
                      <TableCell><Badge variant={c.is_active ? "default" : "outline"}>{c.is_active ? "نشط" : "موقوف"}</Badge></TableCell>
                      <TableCell>
                        <Button size="sm" variant={c.is_active ? "outline" : "default"} onClick={()=>toggleCategoryActive(c)}>
                          {c.is_active ? "تعطيل" : "تفعيل"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Bank Txn Dialog */}
      <Dialog open={txnDlg} onOpenChange={setTxnDlg}>
        <DialogContent dir="rtl" className="max-w-3xl">
          <DialogHeader><DialogTitle>تسجيل حركة بنكية</DialogTitle></DialogHeader>
          <div className="grid md:grid-cols-2 gap-3">
            <div><Label>التاريخ</Label><Input type="date" value={form.txn_date} onChange={e=>setForm({...form,txn_date:e.target.value})}/></div>
            <div><Label>نوع الحركة *</Label>
              <Select value={form.txn_type} onValueChange={v=>setForm({...form,txn_type:v, bank_category_id: ""})}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>{BANK_TXN_TYPES.map(t=><SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>الحساب البنكي *</Label>
              <Select value={form.account_id} onValueChange={v=>{
                const a = accounts.find(x=>x.id===v);
                setForm({...form, account_id: v, bank_account_number: a?.account_number || form.bank_account_number, counterparty: form.counterparty || a?.bank_name || ""});
              }}>
                <SelectTrigger><SelectValue placeholder="اختر"/></SelectTrigger>
                <SelectContent>
                  {accounts.filter(a=>a.account_type==="bank").map(a=><SelectItem key={a.id} value={a.id}>{a.name} {a.bank_name?`— ${a.bank_name}`:""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>المبلغ *</Label><Input type="number" step="0.01" value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})}/></div>

            {["expense","loan_installment","bank_fees"].includes(form.txn_type) && (
              <div><Label>بند المصروف *</Label>
                <Select value={form.bank_category_id} onValueChange={v=>setForm({...form,bank_category_id:v})}>
                  <SelectTrigger><SelectValue placeholder="اختر"/></SelectTrigger>
                  <SelectContent>{cats.filter(c=>c.is_active).map(c=><SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}

            {form.txn_type === "loan_installment" && (
              <div><Label>رقم القرض *</Label><Input value={form.loan_number} onChange={e=>setForm({...form,loan_number:e.target.value})}/></div>
            )}

            {form.txn_type === "bank_deposit" && (
              <div className="md:col-span-2 border rounded p-2 bg-primary/5">
                <Label>مصدر التحويل الوارد *</Label>
                <Select value={form.incoming_source} onValueChange={v=>setForm({...form,incoming_source:v})}>
                  <SelectTrigger><SelectValue placeholder="اختر المصدر"/></SelectTrigger>
                  <SelectContent>{INCOMING_SOURCES.map(s=><SelectItem key={s.value} value={s.value}>{s.label}{s.attachmentRequired?" (صورة إجبارية)":""}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}

            <div><Label>اسم البنك / الجهة</Label><Input value={form.counterparty} onChange={e=>setForm({...form,counterparty:e.target.value})}/></div>
            <div><Label>رقم الحساب البنكي</Label><Input value={form.bank_account_number} onChange={e=>setForm({...form,bank_account_number:e.target.value})}/></div>
            <div><Label>طريقة الدفع / الخصم</Label>
              <Select value={form.payment_method} onValueChange={v=>setForm({...form,payment_method:v})}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>{PAYMENT_METHODS.map(p=><SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2"><Label>الوصف *</Label><Textarea value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></div>
            <div className="md:col-span-2">
              {(() => {
                const srcDef = INCOMING_SOURCES.find(s=>s.value===form.incoming_source);
                const required = form.txn_type === "bank_deposit" && !!srcDef?.attachmentRequired;
                return (
                  <>
                    <Label className="mb-2 block">
                      صورة التحويل / إيصال التحويل{" "}
                      {required && <span className="text-destructive">*</span>}
                    </Label>
                    <DragDropUpload
                      value={file}
                      onChange={setFile}
                      label="اسحب صورة التحويل هنا أو انقر للاختيار"
                      requiredHint={required && !file ? `صورة التحويل إجبارية لـ ${srcDef?.label}` : undefined}
                    />
                  </>
                );
              })()}
            </div>
            <div className="md:col-span-2 text-xs text-muted-foreground border rounded p-2 bg-muted/30">
              ملاحظة: لا تؤثر هذه الحركة على الرصيد إلا بعد الاعتماد. الحركات ≤ 5,000 تُرحَّل تلقائيًا، من 5,000.01 إلى 50,000 اعتماد فردي، أكثر من 50,000 اعتماد مزدوج. <b>إيصال التحويل اختياري</b> — يمكن حفظ الحركة بدونه، ويُمكن رفع الإيصال لاحقًا قبل أو أثناء المراجعة. سيظهر للمدير تنبيه عند اعتماد حركة بدون إيصال.
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={()=>setTxnDlg(false)} disabled={busy}>إلغاء</Button>
            <Button onClick={submitTxn} disabled={busy}>{busy ? "جارٍ الحفظ…" : "حفظ الحركة"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Category Dialog */}
      <Dialog open={catDlg} onOpenChange={setCatDlg}>
        <DialogContent dir="rtl">
          <DialogHeader><DialogTitle>إنشاء بند مصروف بنكي</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div><Label>الكود *</Label><Input placeholder="مثل: custom_fee" value={catForm.code} onChange={e=>setCatForm({...catForm,code:e.target.value})}/></div>
            <div><Label>اسم البند *</Label><Input value={catForm.label} onChange={e=>setCatForm({...catForm,label:e.target.value})}/></div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="ra" checked={catForm.requires_attachment} onChange={e=>setCatForm({...catForm,requires_attachment:e.target.checked})}/>
              <Label htmlFor="ra">يحتاج مرفق إجبارية؟</Label>
            </div>
            <div><Label>ملاحظات</Label><Textarea value={catForm.notes} onChange={e=>setCatForm({...catForm,notes:e.target.value})}/></div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={()=>setCatDlg(false)} disabled={busy}>إلغاء</Button>
            <Button onClick={submitCategory} disabled={busy}>{busy ? "جارٍ الحفظ…" : "إنشاء البند"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cash → Bank Transfer Dialog */}
      <Dialog open={transferDlg} onOpenChange={setTransferDlg}>
        <DialogContent dir="rtl" className="max-w-3xl">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><ArrowRightLeft className="h-5 w-5"/>إيداع من الخزنة النقدية إلى الحساب البنكي</DialogTitle></DialogHeader>
          <div className="grid md:grid-cols-2 gap-3">
            <div><Label>التاريخ *</Label><Input type="date" value={transferForm.txn_date} onChange={e=>setTransferForm({...transferForm,txn_date:e.target.value})}/></div>
            <div><Label>المبلغ *</Label><Input type="number" min="0.01" step="0.01" value={transferForm.amount} onChange={e=>setTransferForm({...transferForm,amount:e.target.value})}/></div>
            <div><Label>الخزنة النقدية المصدر *</Label>
              <Select value={transferForm.cash_account_id} onValueChange={v=>setTransferForm({...transferForm,cash_account_id:v})}>
                <SelectTrigger><SelectValue placeholder="اختر…"/></SelectTrigger>
                <SelectContent>{accounts.filter(a=>a.account_type==="cash").map(a=><SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>الحساب البنكي المستلم *</Label>
              <Select value={transferForm.bank_account_id} onValueChange={v=>{
                const acc = accounts.find(a => a.id === v);
                setTransferForm({...transferForm, bank_account_id:v,
                  bank_name: acc?.bank_name || transferForm.bank_name,
                  bank_account_number: acc?.account_number || transferForm.bank_account_number });
              }}>
                <SelectTrigger><SelectValue placeholder="اختر…"/></SelectTrigger>
                <SelectContent>{accounts.filter(a=>a.account_type==="bank").map(a=><SelectItem key={a.id} value={a.id}>{a.name}{a.bank_name?` — ${a.bank_name}`:""}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>اسم البنك</Label><Input value={transferForm.bank_name} onChange={e=>setTransferForm({...transferForm,bank_name:e.target.value})}/></div>
            <div><Label>رقم الحساب</Label><Input value={transferForm.bank_account_number} onChange={e=>setTransferForm({...transferForm,bank_account_number:e.target.value})}/></div>
            <div><Label>سبب الإيداع *</Label>
              <Select value={transferForm.deposit_purpose} onValueChange={v=>setTransferForm({...transferForm,deposit_purpose:v as any})}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>
                  <SelectItem value="loan_installment">تغطية قسط قرض</SelectItem>
                  <SelectItem value="bank_fees">تغطية مصروف بنكي</SelectItem>
                  <SelectItem value="general">إيداع عام</SelectItem>
                  <SelectItem value="other">أخرى</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>اسم المستلم من الخزنة *</Label><Input value={transferForm.cash_handover_by} onChange={e=>setTransferForm({...transferForm,cash_handover_by:e.target.value})}/></div>
            <div><Label>اسم المودع في البنك *</Label><Input value={transferForm.bank_depositor_by} onChange={e=>setTransferForm({...transferForm,bank_depositor_by:e.target.value})}/></div>
            <div className="md:col-span-2"><Label>ملاحظات</Label><Textarea rows={2} value={transferForm.notes} onChange={e=>setTransferForm({...transferForm,notes:e.target.value})}/></div>
            <div className="md:col-span-2">
              <Label className="mb-2 block">مرفق إيصال الإيداع البنكي</Label>
              <DragDropUpload
                value={transferFile}
                onChange={setTransferFile}
                label="اسحب إيصال الإيداع هنا أو انقر للاختيار"
              />
            </div>
            <div className="md:col-span-2 text-xs text-muted-foreground border rounded p-2 bg-muted/30">
              تسجَّل حركتان مرتبطتان (خروج من النقدية + دخول للبنك) بمعرّف تحويل واحد. لا يُخصم/يضاف إلا بعد اعتماد المدير المختص. لا يمكنك اعتماد طلب سجلته بنفسك. تكرار الضغط محمي تلقائيًا.
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={()=>setTransferDlg(false)} disabled={busy}>إلغاء</Button>
            <Button onClick={submitTransfer} disabled={busy} className="bg-[hsl(142_71%_36%)] hover:bg-[hsl(142_71%_30%)] text-white">
              {busy ? "جارٍ الحفظ…" : "تسجيل طلب الإيداع"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change Attachment Dialog */}
      <Dialog open={changeAttachDlg.open} onOpenChange={o=>!o && setChangeAttachDlg({ open:false, reason:"", file:null })}>
        <DialogContent dir="rtl">
          <DialogHeader><DialogTitle>تغيير صورة التحويل — {changeAttachDlg.txn?.reference_no}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            {changeAttachDlg.txn?.attachment_url && (
              <Button variant="outline" size="sm" className="gap-1" onClick={async ()=>{
                const u = await getAttachmentUrl(changeAttachDlg.txn!.attachment_url!); if (u) window.open(u, "_blank");
              }}><Paperclip className="h-4 w-4"/>عرض الصورة الحالية</Button>
            )}
            <div>
              <Label className="mb-2 block">صورة جديدة (JPG / PNG / PDF) *</Label>
              <DragDropUpload
                value={changeAttachDlg.file}
                onChange={(f) => setChangeAttachDlg({...changeAttachDlg, file: f})}
                label="اسحب الصورة الجديدة هنا أو انقر للاختيار"
              />
            </div>
            {changeAttachDlg.txn?.status === "posted" && (
              <div>
                <Label>سبب التغيير (إجباري بعد الاعتماد) *</Label>
                <Textarea value={changeAttachDlg.reason} onChange={e=>setChangeAttachDlg({...changeAttachDlg, reason:e.target.value})}/>
                <div className="text-xs text-muted-foreground mt-1">سيُسجَّل السبب في Audit Log.</div>
              </div>
            )}
            {changeAttachDlg.txn?.status === "posted" && !isApprover && (
              <div className="text-sm text-destructive border rounded p-2">لا يمكن تغيير صورة حركة معتمدة إلا من قِبل الإدارة.</div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={()=>setChangeAttachDlg({ open:false, reason:"", file:null })} disabled={busy}>إلغاء</Button>
            <Button onClick={submitChangeAttachment}
              disabled={busy || !changeAttachDlg.file || (changeAttachDlg.txn?.status === "posted" && !isApprover)}>
              {busy ? "جارٍ الحفظ…" : "حفظ الصورة الجديدة"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ReportCard({ title, hint, onPdf }: { title: string; hint: string; onPdf: ()=>void }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Wallet className="h-4 w-4"/> {title}</CardTitle></CardHeader>
      <CardContent>
        <div className="text-xs text-muted-foreground mb-3">{hint}</div>
        <Button size="sm" variant="outline" onClick={onPdf} className="gap-2 w-full"><Printer className="h-4 w-4"/>طباعة / PDF</Button>
      </CardContent>
    </Card>
  );
}

// Mark Banknote as used to satisfy ESLint in some configs
void Banknote;
