import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

const TYPE_AR: Record<string, string> = { raw: "خامات تصنيع", spice: "بهارات", packaging: "خامات تغليف", mixed: "مختلطة" };
// نفس صلاحية الإدخال في صفحة الخزنة الرئيسية (canWrite) وسياسة mt_txn_insert
const MT_WRITE_ROLES = ["main_treasury_accountant", "main_treasury_approver", "general_manager", "executive_manager", "financial_manager"];
import { supabase } from "@/integrations/supabase/client";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface MtCandidate {
  id: string; reference_no: string; amount: number; txn_date: string;
  description: string | null; status: string; linked_invoice_no: string | null;
}

/** اختيار حركة الخزنة الرئيسية اللي اتدفعت منها فاتورة شراء المصنع (±50 ج، ±3 أيام). */
export default function MainTreasuryTxnPicker({ amount, date, value, onChange, excludeInvoiceNo, supplier, invoiceType }: {
  amount: number; date: string; value: string | null; onChange: (id: string | null) => void; excludeInvoiceNo?: string | null;
  /** لو اتبعتوا يظهر زر إنشاء المصروف في الرئيسية وربطه (فاتورة جديدة فقط) */
  supplier?: string; invoiceType?: string;
}) {
  const { user, roles } = useAuth();
  const canCreate = (roles as string[] || []).some(r => MT_WRITE_ROLES.includes(r));
  const [created, setCreated] = useState<MtCandidate | null>(null);
  const [dlg, setDlg] = useState(false);
  const [busy, setBusy] = useState(false);
  const [accounts, setAccounts] = useState<{ id: string; name: string; account_type: string }[]>([]);
  const [cats, setCats] = useState<{ id: string; label: string }[]>([]);
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [clientUuid, setClientUuid] = useState(() => crypto.randomUUID());
  // مفتاح جديد لو المبلغ/التاريخ/المورد اتغيروا (غير كده إعادة المحاولة بنفس المفتاح = مفيش تكرار)
  useEffect(() => { setClientUuid(crypto.randomUUID()); }, [amount, date, supplier, invoiceType]);
  const description = `مشتريات مصنع اللحوم — ${(supplier || "").trim()} — ${TYPE_AR[invoiceType || ""] || invoiceType || ""}`;

  async function openDlg() {
    if (!(supplier || "").trim()) { toast.error("أدخل اسم المورد الأول"); return; }
    const [a, c] = await Promise.all([
      (supabase as any).from("main_treasury_accounts").select("id,name,account_type").eq("is_active", true).order("created_at"),
      (supabase as any).from("main_treasury_expense_categories").select("id,label").eq("is_active", true).order("sort_order"),
    ]);
    const accs = (a.data || []) as any[]; const cs = (c.data || []) as any[];
    setAccounts(accs); setCats(cs);
    setAccountId(prev => prev || accs.find(x => x.account_type === "cash")?.id || accs[0]?.id || "");
    const want = invoiceType === "packaging" ? "مشتريات تغليف" : "مستلزمات تصنيع";
    setCategoryId(prev => prev || cs.find(x => String(x.label).includes(want))?.id || "");
    setDlg(true);
  }

  async function createExpense() {
    if (!accountId) { toast.error("اختر الحساب"); return; }
    if (!categoryId) { toast.error("اختر بند المصروف"); return; }
    setBusy(true);
    const cols = "id,reference_no,amount,txn_date,description,status";
    let { data, error } = await (supabase as any).from("main_treasury_transactions").insert({
      account_id: accountId, txn_type: "expense", amount, txn_date: date, category_id: categoryId,
      counterparty: (supplier || "").trim() || null, description, client_uuid: clientUuid, created_by: user!.id,
    }).select(cols).single();
    if (error && (error as any).code === "23505") {
      // اتسجل قبل كده بنفس المفتاح (دبل كليك/إعادة محاولة) — هات نفس الحركة
      ({ data, error } = await (supabase as any).from("main_treasury_transactions").select(cols).eq("client_uuid", clientUuid).single());
    }
    setBusy(false);
    if (error || !data) { toast.error(error?.message || "تعذر تسجيل المصروف"); return; }
    const row = { ...data, linked_invoice_no: null } as MtCandidate;
    setCreated(row); onChange(row.id); setDlg(false); setReloadKey(k => k + 1);
    toast.success(row.status === "pending_approval"
      ? `اتسجل المصروف ${row.reference_no} واتربط — في انتظار الاعتماد`
      : `اتسجل المصروف ${row.reference_no} (${row.status}) واتربط`);
  }
  const [rows, setRows] = useState<MtCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    if (!(amount > 0) || !date) { setRows([]); return; }
    let cancelled = false;
    setLoading(true);
    (supabase.rpc as any)("mt_expense_match_candidates", { p_amount: amount, p_date: date })
      .then(({ data }: any) => { if (!cancelled) setRows((data || []) as MtCandidate[]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [amount, date, reloadKey]);
  const usable0 = rows.filter(r => !r.linked_invoice_no || r.linked_invoice_no === excludeInvoiceNo || r.id === value);
  const usable = created && !usable0.some(r => r.id === created.id) ? [created, ...usable0] : usable0;
  const showEmpty = !loading && amount > 0 && !!date && usable.length === 0;
  return (
    <div>
      <Label>حركة الخزنة الرئيسية</Label>
      <Select value={value || ""} onValueChange={(v) => onChange(v || null)}>
        <SelectTrigger className="whitespace-normal text-start h-auto min-h-10"><SelectValue placeholder={loading ? "جاري التحميل…" : usable.length ? "اختر الحركة" : "مفيش مصروف مطابق (±50 ج، ±3 أيام)"} /></SelectTrigger>
        <SelectContent>
          {usable.map(r => (
            <SelectItem key={r.id} value={r.id}>
              {r.reference_no} — {Number(r.amount).toLocaleString("en-US")} ج — {r.txn_date}{r.description ? ` — ${r.description}` : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {showEmpty && (
        <div className="mt-2 rounded-md border border-amber-400 bg-amber-50 p-2 text-sm text-amber-900">
          <p>لا يوجد مصروف بقيمة {Number(amount).toLocaleString("en-US")} ج في الخزنة الرئيسية (±50 ج، ±3 أيام) — سجّل المصروف في الخزنة الرئيسية أولًا، ثم ارجع واختره.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline"><Link to="/main-treasury" target="_blank" rel="noopener">فتح الخزنة الرئيسية</Link></Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setReloadKey(k => k + 1)}>تحديث القائمة</Button>
            {supplier !== undefined && canCreate && (
              <Button type="button" size="sm" onClick={openDlg}>سجّل المصروف في الخزنة الرئيسية واربطه</Button>
            )}
          </div>
          {supplier !== undefined && !canCreate && (
            <p className="mt-1 text-xs">تسجيل مصروف في الخزنة الرئيسية متاح لمحاسب/معتمد الخزنة الرئيسية والإدارة بس — اطلب منهم يسجّلوه.</p>
          )}
        </div>
      )}
      {created && value === created.id && (
        <p className="mt-1 text-xs text-emerald-700">
          مربوطة بالمصروف {created.reference_no}{created.status === "pending_approval" ? " — في انتظار اعتماد الخزنة الرئيسية" : ""}
        </p>
      )}
      <Dialog open={dlg} onOpenChange={(v) => !busy && setDlg(v)}>
        <DialogContent dir="rtl">
          <DialogHeader><DialogTitle>تأكيد تسجيل مصروف في الخزنة الرئيسية</DialogTitle></DialogHeader>
          <div className="space-y-2 text-sm">
            <p>المبلغ: <b>{Number(amount).toLocaleString("en-US")} ج</b></p>
            <p>التاريخ: <b>{date}</b></p>
            <p>المورد: <b>{(supplier || "").trim()}</b></p>
            <p>الوصف: {description}</p>
            <div>
              <Label>الحساب</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger><SelectValue placeholder="اختر الحساب" /></SelectTrigger>
                <SelectContent>{accounts.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>بند المصروف</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger><SelectValue placeholder="اختر البند" /></SelectTrigger>
                <SelectContent>{cats.map(c => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">بيتسجل بنفس مسار صفحة الخزنة الرئيسية — حسب القيمة ممكن يحتاج اعتماد.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setDlg(false)}>إلغاء</Button>
            <Button disabled={busy} onClick={createExpense}>{busy ? "جاري التسجيل…" : "تأكيد وتسجيل"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <p className="text-xs text-muted-foreground mt-1">الفاتورة دي مش هتسجل خروج من خزنة المصنع لأن الفلوس اتصرفت من الرئيسية.</p>
    </div>
  );
}
