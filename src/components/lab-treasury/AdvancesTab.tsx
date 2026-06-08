import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Plus, Trash2, Wallet, AlertTriangle, CheckCircle2, Receipt, RefreshCw } from "lucide-react";

type PaymentMethod = "cash" | "vodafone_cash" | "instapay" | "bank_transfer";
type ExpenseCat =
  | "electricity" | "maintenance" | "water"
  | "salaries_mother_farm" | "salaries_hatchery" | "salaries_brooding"
  | "medicine" | "feed_supplies" | "tools" | "transport" | "other";
type AdvanceStatus = "open" | "settled" | "closed" | "cancelled";

type AdvanceDebugSnapshot = {
  invoice_total: number;
  paid_amount: number;
};

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cash: "نقدي (كاش)",
  vodafone_cash: "فودافون كاش",
  instapay: "انستاباي",
  bank_transfer: "تحويل بنكي",
};

const normalizePaymentMethod = (value: string | null | undefined): PaymentMethod => {
  switch (value) {
    case "cash":
    case "نقدي":
    case "النقدية (كاش)":
      return "cash";
    case "vodafone_cash":
    case "فودافون كاش":
      return "vodafone_cash";
    case "instapay":
    case "إنستا باي":
    case "انستاباي":
      return "instapay";
    case "bank_transfer":
    case "تحويل بنكي":
    case "التحويل البنكي":
      return "bank_transfer";
    default:
      return "cash";
  }
};

const debugAdvanceAmount = (values: {
  entered_amount: string | number | null;
  expense_amount: number | null;
  advance_amount: number | null;
  invoice_total: number | null;
  paid_amount: number | null;
  amount_sent_to_rpc: number | null;
  payment_method: PaymentMethod;
}) => {
  console.info("[lab-treasury-debug]", { context: "advance_issue", ...values });
};

const EXPENSE_LABELS: Record<ExpenseCat, string> = {
  electricity: "كهرباء", maintenance: "صيانة", water: "مياه",
  salaries_mother_farm: "مرتبات أمهات", salaries_hatchery: "مرتبات معمل",
  salaries_brooding: "مرتبات حضانة", medicine: "أدوية", feed_supplies: "علف/مستلزمات",
  tools: "أدوات", transport: "نقل", other: "أخرى",
};

const STATUS_LABELS: Record<AdvanceStatus, { label: string; tone: string }> = {
  open: { label: "مفتوحة", tone: "bg-amber-500/15 text-amber-700 border-amber-300" },
  settled: { label: "مسواة", tone: "bg-blue-500/15 text-blue-700 border-blue-300" },
  closed: { label: "مغلقة", tone: "bg-emerald-500/15 text-emerald-700 border-emerald-300" },
  cancelled: { label: "ملغية", tone: "bg-rose-500/15 text-rose-700 border-rose-300" },
};

interface Advance {
  id: string;
  recipient_name: string;
  employee_user_id: string | null;
  issued_at: string;
  amount: number;
  payment_method: PaymentMethod;
  purpose: string | null;
  notes: string | null;
  status: AdvanceStatus;
  actual_expense_total: number;
  returned_amount: number;
  pending_employee_amount: number;
  settled_at: string | null;
  created_at: string;
  difference_movement_id: string | null;
}

interface SettlementLine {
  description: string;
  expense_category: ExpenseCat;
  amount: string;
}

const fmt = (n: number) => (n ?? 0).toLocaleString("ar-EG", { maximumFractionDigits: 2 });

export default function AdvancesTab({ isManager, debugSnapshot }: { isManager: boolean; debugSnapshot?: AdvanceDebugSnapshot }) {
  const { user } = useAuth();
  const [advances, setAdvances] = useState<Advance[]>([]);
  const [loading, setLoading] = useState(true);
  const [balanceByMethod, setBalanceByMethod] = useState<Record<PaymentMethod, number>>({
    cash: 0, vodafone_cash: 0, instapay: 0, bank_transfer: 0,
  });

  // Issue form
  const [issueForm, setIssueForm] = useState({
    recipient_name: "",
    employee_user_id: "",
    amount: "",
    payment_method: "cash" as PaymentMethod,
    purpose: "",
    notes: "",
    issued_at: new Date().toISOString().slice(0, 10),
  });
  const [submitting, setSubmitting] = useState(false);

  // Settle dialog
  const [settleOpen, setSettleOpen] = useState(false);
  const [activeAdvance, setActiveAdvance] = useState<Advance | null>(null);
  const [lines, setLines] = useState<SettlementLine[]>([{ description: "", expense_category: "other", amount: "" }]);
  const [returnedAmount, setReturnedAmount] = useState("");

  const load = async () => {
    setLoading(true);
    const [{ data: adv, error: e1 }, { data: mv, error: e2 }] = await Promise.all([
      supabase.from("lab_treasury_advances").select("*").order("created_at", { ascending: false }).limit(500),
      supabase.from("lab_treasury_movements").select("payment_method, movement_type, amount, status").eq("status", "approved"),
    ]);
    if (e1) toast.error(e1.message);
    if (e2) toast.error(e2.message);
    setAdvances((adv as Advance[]) || []);
    const bal: Record<PaymentMethod, number> = { cash: 0, vodafone_cash: 0, instapay: 0, bank_transfer: 0 };
    (mv || []).forEach((m: any) => {
      const sign = m.movement_type === "income" ? 1 : -1;
      bal[m.payment_method as PaymentMethod] += sign * Number(m.amount);
    });
    setBalanceByMethod(bal);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const open = useMemo(() => advances.filter(a => a.status === "open"), [advances]);
  const settled = useMemo(() => advances.filter(a => a.status !== "open"), [advances]);
  const totals = useMemo(() => {
    const issued = advances.reduce((s, a) => s + Number(a.amount), 0);
    const actual = advances.reduce((s, a) => s + Number(a.actual_expense_total || 0), 0);
    const returned = advances.reduce((s, a) => s + Number(a.returned_amount || 0), 0);
    const pending = advances.filter(a => !a.difference_movement_id).reduce((s, a) => s + Number(a.pending_employee_amount || 0), 0);
    return { issued, actual, returned, pending, openCount: open.length, settledCount: settled.length };
  }, [advances, open.length, settled.length]);

  const normalizedIssuePaymentMethod = normalizePaymentMethod(issueForm.payment_method);
  const issueAmountRaw = String(issueForm.amount ?? "").trim();
  const issueAmountNum = Number(issueAmountRaw) || 0;
  const expAvailable = balanceByMethod[normalizedIssuePaymentMethod] || 0;
  const issueExceeds = issueAmountNum > expAvailable;

  const submitIssue = async () => {
    if (!issueForm.recipient_name.trim()) { toast.error("اسم المستلم مطلوب"); return; }
    if (issueAmountNum <= 0) { toast.error("المبلغ يجب أن يكون أكبر من صفر"); return; }
    debugAdvanceAmount({
      entered_amount: issueAmountRaw || null,
      expense_amount: null,
      advance_amount: issueAmountNum,
      invoice_total: debugSnapshot?.invoice_total ?? null,
      paid_amount: debugSnapshot?.paid_amount ?? null,
      amount_sent_to_rpc: issueAmountNum,
      payment_method: normalizedIssuePaymentMethod,
    });
    if (issueExceeds && !isManager) {
      toast.error(`الرصيد المتاح في ${PAYMENT_LABELS[normalizedIssuePaymentMethod]} ${fmt(expAvailable)} ج فقط، لا يمكن صرف ${fmt(issueAmountNum)} ج. صحح المبلغ أو اطلب اعتماد المدير.`);
      return;
    }
    setSubmitting(true);
    const { data, error } = await supabase.rpc("lab_treasury_issue_advance", {
      p_recipient_name: issueForm.recipient_name.trim(),
      p_employee_user_id: issueForm.employee_user_id || null,
      p_amount: issueAmountNum,
      p_payment_method: normalizedIssuePaymentMethod,
      p_purpose: issueForm.purpose || null,
      p_notes: issueForm.notes || null,
      p_issued_at: issueForm.issued_at,
    });
    setSubmitting(false);
    if (error) { toast.error(error.message); return; }
    toast.success("تم صرف العهدة وإنشاء سجل عهدة مفتوحة");
    setIssueForm({ ...issueForm, recipient_name: "", amount: "", purpose: "", notes: "" });
    load();
  };

  const openSettle = (a: Advance) => {
    setActiveAdvance(a);
    setLines([{ description: "", expense_category: "other", amount: "" }]);
    setReturnedAmount("");
    setSettleOpen(true);
  };

  const linesTotal = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const returnedNum = Number(returnedAmount) || 0;
  const diffEmployee = activeAdvance ? Math.max(0, linesTotal - Number(activeAdvance.amount)) : 0;
  const diffTreasury = activeAdvance ? Math.max(0, Number(activeAdvance.amount) - linesTotal - returnedNum) : 0;

  const submitSettle = async () => {
    if (!activeAdvance) return;
    const validLines = lines.filter(l => Number(l.amount) > 0 && l.description.trim());
    if (validLines.length === 0) { toast.error("أدخل بنود المصروف الفعلي"); return; }
    if (returnedNum > 0 && linesTotal > Number(activeAdvance.amount)) {
      toast.error("لا يمكن أن يكون هناك مرتجع ومصروف فعلي أكبر من العهدة في نفس الوقت"); return;
    }
    setSubmitting(true);
    const { error } = await supabase.rpc("lab_treasury_settle_advance", {
      p_advance_id: activeAdvance.id,
      p_lines: validLines.map(l => ({
        description: l.description.trim(),
        expense_category: l.expense_category,
        amount: Number(l.amount),
      })),
      p_returned_amount: returnedNum,
    });
    setSubmitting(false);
    if (error) { toast.error(error.message); return; }
    toast.success("تمت تسوية العهدة");
    setSettleOpen(false);
    setActiveAdvance(null);
    load();
  };

  const approveDifference = async (id: string) => {
    if (!confirm("اعتماد صرف الفرق المستحق للموظف من الخزنة؟")) return;
    const { error } = await supabase.rpc("lab_treasury_approve_advance_difference", { p_advance_id: id });
    if (error) { toast.error(error.message); return; }
    toast.success("تم صرف الفرق المستحق للموظف");
    load();
  };

  const cancelAdvance = async (a: Advance) => {
    const reason = prompt("سبب إلغاء العهدة:");
    if (!reason || reason.trim().length < 3) return;
    const { error } = await supabase.rpc("lab_treasury_cancel_advance", { p_advance_id: a.id, p_reason: reason.trim() });
    if (error) { toast.error(error.message); return; }
    toast.success("تم إلغاء العهدة");
    load();
  };

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">إجمالي العهد المصروفة</div><div className="text-lg font-bold font-mono">{fmt(totals.issued)} ج</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">مصروف فعلي (مسوى)</div><div className="text-lg font-bold font-mono">{fmt(totals.actual)} ج</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">مرتجع للخزنة</div><div className="text-lg font-bold font-mono">{fmt(totals.returned)} ج</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">فروق مستحقة للموظفين</div><div className="text-lg font-bold font-mono text-amber-700">{fmt(totals.pending)} ج</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">عهد مفتوحة</div><div className="text-lg font-bold">{totals.openCount}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">عهد مسواة/مغلقة</div><div className="text-lg font-bold">{totals.settledCount}</div></CardContent></Card>
      </div>

      {/* Issue form */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2"><Wallet className="w-4 h-4" /> صرف عهدة جديدة</CardTitle>
          <Button variant="outline" size="sm" onClick={load} className="gap-2"><RefreshCw className="w-3 h-3" />تحديث</Button>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <div className="space-y-1"><Label>اسم المستلم *</Label><Input value={issueForm.recipient_name} onChange={e => setIssueForm({ ...issueForm, recipient_name: e.target.value })} /></div>
          <div className="space-y-1"><Label>التاريخ</Label><Input type="date" value={issueForm.issued_at} onChange={e => setIssueForm({ ...issueForm, issued_at: e.target.value })} /></div>
          <div className="space-y-1"><Label>المبلغ *</Label>
            <Input type="number" value={issueForm.amount} onChange={e => setIssueForm({ ...issueForm, amount: e.target.value })} />
          </div>
          <div className="space-y-1"><Label>طريقة الدفع</Label>
            <Select value={issueForm.payment_method} onValueChange={(v) => setIssueForm({ ...issueForm, payment_method: v as PaymentMethod })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(PAYMENT_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1 md:col-span-2"><Label>الغرض</Label><Input value={issueForm.purpose} onChange={e => setIssueForm({ ...issueForm, purpose: e.target.value })} placeholder="مثال: شراء مستلزمات صيانة" /></div>
          <div className="space-y-1 lg:col-span-3"><Label>ملاحظات</Label><Textarea value={issueForm.notes} onChange={e => setIssueForm({ ...issueForm, notes: e.target.value })} /></div>

          <div className="lg:col-span-3 space-y-2">
            <div className="text-sm text-muted-foreground">
              الرصيد المتاح في {PAYMENT_LABELS[issueForm.payment_method]}: <span className="font-mono font-semibold">{fmt(expAvailable)} ج</span>
            </div>
            {issueExceeds && (
              <Alert variant="destructive">
                <AlertTriangle className="w-4 h-4" />
                <AlertTitle>المبلغ المُدخل ({fmt(issueAmountNum)} ج) يتجاوز الرصيد المتاح ({fmt(expAvailable)} ج)</AlertTitle>
                <AlertDescription>
                  راجع الرقم — تأكد أنك لم تُدخل خانات إضافية بالخطأ. {isManager ? "بصلاحيتك يمكنك المتابعة." : "لا يمكن الحفظ — يلزم اعتماد المدير العام أو التنفيذي."}
                </AlertDescription>
              </Alert>
            )}
            <Button onClick={submitIssue} disabled={submitting || (issueExceeds && !isManager)} className="gap-2">
              <Plus className="w-4 h-4" />صرف العهدة
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Open advances */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Receipt className="w-4 h-4" />العُهد المفتوحة ({open.length})</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {loading ? <div className="text-center text-muted-foreground py-4">جاري التحميل...</div> :
           open.length === 0 ? <div className="text-center text-muted-foreground py-4">لا توجد عهد مفتوحة</div> :
          <Table>
            <TableHeader><TableRow>
              <TableHead>التاريخ</TableHead>
              <TableHead>المستلم</TableHead>
              <TableHead>المبلغ</TableHead>
              <TableHead>طريقة الدفع</TableHead>
              <TableHead>الغرض</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead className="text-center">إجراءات</TableHead>
            </TableRow></TableHeader>
            <TableBody>{open.map(a => (
              <TableRow key={a.id}>
                <TableCell className="whitespace-nowrap">{a.issued_at}</TableCell>
                <TableCell className="font-medium">{a.recipient_name}</TableCell>
                <TableCell className="font-mono">{fmt(Number(a.amount))} ج</TableCell>
                <TableCell>{PAYMENT_LABELS[a.payment_method]}</TableCell>
                <TableCell className="max-w-[200px] truncate" title={a.purpose || ""}>{a.purpose || "—"}</TableCell>
                <TableCell><Badge variant="outline" className={STATUS_LABELS[a.status].tone}>{STATUS_LABELS[a.status].label}</Badge></TableCell>
                <TableCell className="text-center space-x-1 space-x-reverse">
                  <Button size="sm" onClick={() => openSettle(a)} className="gap-1"><CheckCircle2 className="w-3 h-3" />تسوية</Button>
                  {isManager && <Button size="sm" variant="outline" onClick={() => cancelAdvance(a)} className="gap-1 text-rose-600">إلغاء</Button>}
                </TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>}
        </CardContent>
      </Card>

      {/* Settled / closed */}
      <Card>
        <CardHeader><CardTitle>سجل العُهد المسواة والمغلقة ({settled.length})</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {settled.length === 0 ? <div className="text-center text-muted-foreground py-4">لا يوجد سجلات</div> :
          <Table>
            <TableHeader><TableRow>
              <TableHead>التاريخ</TableHead>
              <TableHead>المستلم</TableHead>
              <TableHead>العهدة</TableHead>
              <TableHead>مصروف فعلي</TableHead>
              <TableHead>مرتجع</TableHead>
              <TableHead>فرق مستحق</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead>إجراء</TableHead>
            </TableRow></TableHeader>
            <TableBody>{settled.map(a => (
              <TableRow key={a.id}>
                <TableCell className="whitespace-nowrap">{a.issued_at}</TableCell>
                <TableCell className="font-medium">{a.recipient_name}</TableCell>
                <TableCell className="font-mono">{fmt(Number(a.amount))}</TableCell>
                <TableCell className="font-mono">{fmt(Number(a.actual_expense_total))}</TableCell>
                <TableCell className="font-mono text-emerald-700">{fmt(Number(a.returned_amount))}</TableCell>
                <TableCell className="font-mono text-amber-700">{fmt(Number(a.pending_employee_amount))}</TableCell>
                <TableCell><Badge variant="outline" className={STATUS_LABELS[a.status].tone}>{STATUS_LABELS[a.status].label}</Badge></TableCell>
                <TableCell>
                  {a.pending_employee_amount > 0 && !a.difference_movement_id && isManager && (
                    <Button size="sm" variant="outline" onClick={() => approveDifference(a.id)}>اعتماد الفرق</Button>
                  )}
                  {a.pending_employee_amount > 0 && !a.difference_movement_id && !isManager && (
                    <span className="text-xs text-muted-foreground">بانتظار اعتماد المدير</span>
                  )}
                </TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>}
        </CardContent>
      </Card>

      {/* Settle dialog */}
      <Dialog open={settleOpen} onOpenChange={setSettleOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>تسوية عهدة — {activeAdvance?.recipient_name} ({fmt(Number(activeAdvance?.amount || 0))} ج)</DialogTitle>
            <div className="sr-only">تفاصيل تسوية العهدة وتسجيل المصروف الفعلي والمبلغ المرتجع.</div>
          </DialogHeader>

          <div className="space-y-3">
            <div className="text-sm">أدخل بنود المصروف الفعلي الذي صرفه الموظف:</div>
            <Table>
              <TableHeader><TableRow>
                <TableHead>الوصف</TableHead>
                <TableHead>الفئة</TableHead>
                <TableHead>المبلغ</TableHead>
                <TableHead></TableHead>
              </TableRow></TableHeader>
              <TableBody>{lines.map((l, i) => (
                <TableRow key={i}>
                  <TableCell><Input value={l.description} onChange={e => { const n = [...lines]; n[i].description = e.target.value; setLines(n); }} /></TableCell>
                  <TableCell>
                    <Select value={l.expense_category} onValueChange={v => { const n = [...lines]; n[i].expense_category = v as ExpenseCat; setLines(n); }}>
                      <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                      <SelectContent>{Object.entries(EXPENSE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell><Input type="number" value={l.amount} onChange={e => { const n = [...lines]; n[i].amount = e.target.value; setLines(n); }} className="w-28" /></TableCell>
                  <TableCell><Button variant="ghost" size="icon" onClick={() => setLines(lines.filter((_, j) => j !== i))} disabled={lines.length === 1}><Trash2 className="w-3 h-3" /></Button></TableCell>
                </TableRow>
              ))}</TableBody>
            </Table>
            <Button variant="outline" size="sm" onClick={() => setLines([...lines, { description: "", expense_category: "other", amount: "" }])} className="gap-1"><Plus className="w-3 h-3" />إضافة بند</Button>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
              <div className="space-y-1">
                <Label>المبلغ المرتجع للخزنة</Label>
                <Input type="number" value={returnedAmount} onChange={e => setReturnedAmount(e.target.value)} />
              </div>
              <div className="space-y-1 text-sm bg-muted/30 rounded p-3">
                <div className="flex justify-between"><span>إجمالي البنود:</span><span className="font-mono font-bold">{fmt(linesTotal)} ج</span></div>
                <div className="flex justify-between"><span>المرتجع للخزنة:</span><span className="font-mono">{fmt(returnedNum)} ج</span></div>
                {diffTreasury > 0 && <div className="flex justify-between text-rose-700"><span>غير مُسوّى:</span><span className="font-mono">{fmt(diffTreasury)} ج</span></div>}
                {diffEmployee > 0 && <div className="flex justify-between text-amber-700"><span>فرق مستحق للموظف:</span><span className="font-mono">{fmt(diffEmployee)} ج</span></div>}
              </div>
            </div>

            {diffEmployee > 0 && (
              <Alert>
                <AlertTriangle className="w-4 h-4" />
                <AlertDescription>المصروف الفعلي أكبر من العهدة بمقدار {fmt(diffEmployee)} ج. سيتم تسجيل الفرق كمستحق للموظف وينتظر اعتماد المدير قبل الصرف.</AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSettleOpen(false)}>إلغاء</Button>
            <Button onClick={submitSettle} disabled={submitting}>حفظ التسوية</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
