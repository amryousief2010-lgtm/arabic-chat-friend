import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Wallet, ArrowDownCircle, ArrowUpCircle, Send, CheckCircle2, XCircle, Clock, Loader2, Printer } from "lucide-react";
import { formatDateTime } from "@/lib/dateFormat";
import { openPrintWindow, PRINT_BASE_CSS, COMPANY_AR, COMPANY_EN } from "@/lib/printPdf";

const extractBosttaFilenameFromNotes = (notes?: string | null): string => {
  const m = String(notes || "").match(/كشف بُسطة\s*[—-]\s*([^()]+?)(?:\s*\(|$)/);
  return m ? m[1].trim() : "";
};

async function printBosttaHandoverInvoice(txn: { id: string; txn_no: string | null; txn_date: string; amount: number; notes: string | null }) {
  const filename = extractBosttaFilenameFromNotes(txn.notes);
  if (!filename) {
    alert("لا يوجد كشف بُسطة مرتبط بهذا التوريد.");
    return;
  }
  // Find the matching upload (latest with same filename)
  const { data: uploads } = await supabase
    .from("bostta_delivery_uploads")
    .select("id, filename, summary, created_at")
    .ilike("filename", filename)
    .order("created_at", { ascending: false })
    .limit(1);
  const upload: any = uploads?.[0];
  if (!upload) { alert("لم يتم العثور على كشف بُسطة بالاسم: " + filename); return; }

  // Extract order numbers from summary
  const orderNumbers = new Set<string>();
  ["updated", "already_delivered"].forEach((k) => {
    const rows = Array.isArray(upload.summary?.[k]) ? upload.summary[k] : [];
    rows.forEach((r: any) => { if (r?.order_number) orderNumbers.add(String(r.order_number)); });
  });
  const nums = Array.from(orderNumbers);
  if (!nums.length) { alert("لا توجد أوردرات مرتبطة بهذا الكشف."); return; }

  const { data: orders } = await supabase
    .from("orders")
    .select("id, order_number, total, courier_cash_due, delivery_fee, created_at, customers(name, phone)")
    .in("order_number", nums);
  const list = (orders || []) as any[];
  const grand = list.reduce((s, o) => s + Number(o.courier_cash_due ?? o.total ?? 0), 0);

  const rows = list.map((o, i) => `
    <tr>
      <td class="num">${i + 1}</td>
      <td class="num">${o.order_number || "—"}</td>
      <td>${o.customers?.name || "—"}</td>
      <td class="num">${o.customers?.phone || "—"}</td>
      <td class="num">${Number(o.total || 0).toLocaleString("ar-EG")}</td>
      <td class="num">${Number(o.courier_cash_due ?? o.total ?? 0).toLocaleString("ar-EG")}</td>
    </tr>`).join("");

  const body = `
    <header>
      <div>
        <h1>${COMPANY_AR}</h1>
        <div class="en">${COMPANY_EN}</div>
        <div style="margin-top:6px;font-size:13px;font-weight:bold;">فاتورة توريد نقدية — كشف بُسطة</div>
      </div>
      <div class="meta">
        <div>رقم التوريد: <b>${txn.txn_no || "—"}</b></div>
        <div>التاريخ: ${formatDateTime(txn.txn_date)}</div>
        <div>الكشف: ${filename}</div>
      </div>
    </header>
    <div class="stats">
      <div class="stat"><div class="k">عدد الأوردرات</div><div class="v num">${list.length}</div></div>
      <div class="stat"><div class="k">مبلغ التوريد المسجّل</div><div class="v num">${Number(txn.amount).toLocaleString("ar-EG")} ج.م</div></div>
      <div class="stat"><div class="k">إجمالي مستحق المندوب</div><div class="v num">${grand.toLocaleString("ar-EG")} ج.م</div></div>
      <div class="stat"><div class="k">من ← إلى</div><div class="v" style="font-size:11px;">خزنة العجوزة ← الخزنة الرئيسية</div></div>
    </div>
    <h2>تفاصيل الأوردرات</h2>
    <table>
      <thead><tr>
        <th>#</th><th>رقم الأوردر</th><th>العميل</th><th>الهاتف</th>
        <th>إجمالي الطلب</th><th>المستحق على المندوب</th>
      </tr></thead>
      <tbody>${rows || `<tr><td colspan="6" style="text-align:center;color:#999;">لا توجد بيانات</td></tr>`}</tbody>
    </table>
    <div style="margin-top:16px;display:flex;justify-content:space-between;gap:20px;font-size:11px;">
      <div>المسلِّم (خزنة العجوزة): ................................</div>
      <div>المستلم (أ. محمد شعلة — الخزنة الرئيسية): ................................</div>
    </div>
    <footer>${COMPANY_AR} — ${COMPANY_EN}</footer>`;
  openPrintWindow(`فاتورة توريد ${txn.txn_no || filename}`, body, PRINT_BASE_CSS);
}

type Txn = {
  id: string;
  txn_no: string | null;
  txn_date: string;
  txn_type: string;
  direction: "in" | "out";
  amount: number;
  notes: string | null;
  status: "pending" | "approved" | "rejected" | "posted" | "reversed";
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  reference: string | null;
  main_treasury_txn_id: string | null;
};

const TYPE_LABEL: Record<string, string> = {
  opening_balance: "رصيد افتتاحي",
  sale: "بيع",
  cash_in: "إيراد متنوع",
  cash_out: "صرف نقدي",
  expense: "مصروف",
  handover_to_main: "توريد للخزنة الرئيسية",
  handover_returned: "إرجاع توريد",
  adjustment: "تسوية",
  other: "أخرى",
};

const fmt = (n: number) =>
  new Intl.NumberFormat("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

export default function AgouzaTreasuryTab() {
  const { user, isGeneralManager, isExecutiveManager } = useAuth();
  const { toast } = useToast();
  const canApprove = isGeneralManager || isExecutiveManager;

  const [loading, setLoading] = useState(false);
  const [txns, setTxns] = useState<Txn[]>([]);

  // submit handover dialog
  const [handoverOpen, setHandoverOpen] = useState(false);
  const [handoverAmount, setHandoverAmount] = useState("");
  const [handoverNotes, setHandoverNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [selectedBosttaId, setSelectedBosttaId] = useState<string | null>(null);

  // simple cash movement (income/expense) dialog
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveKind, setMoveKind] = useState<"cash_in" | "expense">("cash_in");
  const [moveAmount, setMoveAmount] = useState("");
  const [moveNotes, setMoveNotes] = useState("");

  // reject dialog
  const [rejectOpen, setRejectOpen] = useState<{ id: string } | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("agouza_warehouse_treasury_txns")
      .select("*")
      .order("txn_date", { ascending: false })
      .limit(500);
    setLoading(false);
    if (error) {
      toast({ title: "خطأ في تحميل الحركات", description: error.message, variant: "destructive" });
      return;
    }
    setTxns((data as any[]) as Txn[]);
  };

  useEffect(() => { load(); }, []);

  // KPIs — only count effective rows (posted/approved) for balance
  const kpis = useMemo(() => {
    let balance = 0, salesIn = 0, expenses = 0, pendingHandover = 0, approvedHandover = 0, rejectedHandover = 0;
    for (const t of txns) {
      const effective = t.status === "posted" || t.status === "approved";
      if (effective) {
        balance += (t.direction === "in" ? 1 : -1) * Number(t.amount || 0);
      }
      if (effective && t.txn_type === "sale") salesIn += Number(t.amount);
      if (effective && (t.txn_type === "expense" || t.txn_type === "cash_out")) expenses += Number(t.amount);
      if (t.txn_type === "handover_to_main") {
        if (t.status === "pending") pendingHandover += Number(t.amount);
        else if (t.status === "approved") approvedHandover += Number(t.amount);
        else if (t.status === "rejected") rejectedHandover += Number(t.amount);
      }
    }
    return { balance, salesIn, expenses, pendingHandover, approvedHandover, rejectedHandover };
  }, [txns]);

  const submitHandover = async () => {
    const amt = Number(handoverAmount);
    if (!amt || amt <= 0) {
      toast({ title: "أدخل مبلغًا صحيحًا", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.rpc("submit_agouza_cash_handover", {
      p_amount: amt,
      p_notes: handoverNotes || null,
    });
    setSubmitting(false);
    if (error) {
      toast({ title: "تعذر تسجيل التوريد", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "تم تسجيل التوريد", description: "بانتظار اعتماد المدير العام / التنفيذي" });
    setHandoverOpen(false);
    setHandoverAmount(""); setHandoverNotes(""); setSelectedBosttaId(null);
    load();
  };

  const submitMove = async () => {
    const amt = Number(moveAmount);
    if (!amt || amt <= 0) {
      toast({ title: "أدخل مبلغًا صحيحًا", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.from("agouza_warehouse_treasury_txns").insert({
      txn_type: moveKind,
      direction: moveKind === "cash_in" ? "in" : "out",
      amount: amt,
      notes: moveNotes || null,
      status: "posted",
      created_by: user?.id ?? null,
    });
    setSubmitting(false);
    if (error) {
      toast({ title: "تعذر حفظ الحركة", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "تم حفظ الحركة" });
    setMoveOpen(false);
    setMoveAmount(""); setMoveNotes("");
    load();
  };

  const approve = async (id: string) => {
    const { error } = await supabase.rpc("approve_agouza_cash_handover", { p_handover_id: id });
    if (error) {
      toast({ title: "تعذر الاعتماد", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "تم اعتماد التوريد ودخوله الخزنة الرئيسية" });
    load();
  };

  const reject = async () => {
    if (!rejectOpen) return;
    if (rejectReason.trim().length < 3) {
      toast({ title: "اكتب سبب الرفض (3 أحرف على الأقل)", variant: "destructive" });
      return;
    }
    const { error } = await supabase.rpc("reject_agouza_cash_handover", {
      p_handover_id: rejectOpen.id,
      p_reason: rejectReason,
    });
    if (error) {
      toast({ title: "تعذر الرفض", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "تم رفض التوريد" });
    setRejectOpen(null); setRejectReason("");
    load();
  };

  const pendingHandovers = txns.filter(t => t.txn_type === "handover_to_main" && t.status === "pending");
  const approvedHandovers = txns.filter(t => t.txn_type === "handover_to_main" && t.status === "approved");
  const rejectedHandovers = txns.filter(t => t.txn_type === "handover_to_main" && t.status === "rejected");

  // Bostta collection sheets not yet handed over to Main — used to prefill the handover dialog
  const pendingBosttaSheets = useMemo(() => {
    const allHandoverNotes = txns
      .filter(t => t.txn_type === "handover_to_main" && ["pending", "approved", "posted"].includes(t.status))
      .map(t => String(t.notes || ""));
    const extractFilename = (n: string) => {
      const m = n.match(/كشف بُسطة\s*[—-]\s*([^()]+?)(?:\s*\(|$)/);
      return m ? m[1].trim() : "";
    };
    return txns
      .filter(t => t.txn_type === "cash_in" && String(t.notes || "").includes("كشف بُسطة") && ["approved", "posted"].includes(t.status))
      .map(t => ({ id: t.id, amount: Number(t.amount || 0), notes: String(t.notes || ""), filename: extractFilename(String(t.notes || "")), created_at: t.txn_date }))
      .filter(row => row.filename && !allHandoverNotes.some(hn => hn.includes(row.filename)));
  }, [txns]);

  return (
    <div className="space-y-6" dir="rtl">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Card className="bg-gradient-to-br from-emerald-50 to-emerald-100/40 border-emerald-200">
          <CardHeader className="pb-2"><CardDescription>رصيد خزنة العجوزة</CardDescription></CardHeader>
          <CardContent><div className="text-2xl font-bold text-emerald-700">{fmt(kpis.balance)}<span className="text-xs mr-1">ج.م</span></div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>إيرادات البيع</CardDescription></CardHeader>
          <CardContent><div className="text-2xl font-bold text-blue-600">{fmt(kpis.salesIn)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>المصروفات</CardDescription></CardHeader>
          <CardContent><div className="text-2xl font-bold text-rose-600">{fmt(kpis.expenses)}</div></CardContent>
        </Card>
        <Card className="border-amber-200 bg-amber-50/40">
          <CardHeader className="pb-2"><CardDescription>توريد معلّق</CardDescription></CardHeader>
          <CardContent><div className="text-2xl font-bold text-amber-700">{fmt(kpis.pendingHandover)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>توريد معتمد</CardDescription></CardHeader>
          <CardContent><div className="text-2xl font-bold text-emerald-700">{fmt(kpis.approvedHandover)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>توريد مرفوض</CardDescription></CardHeader>
          <CardContent><div className="text-2xl font-bold text-zinc-600">{fmt(kpis.rejectedHandover)}</div></CardContent>
        </Card>
      </div>

      {/* Actions */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2"><Wallet className="w-5 h-5" /> إجراءات خزنة العجوزة</CardTitle>
            <CardDescription>تسجيل حركات نقدية أو توريد للخزنة الرئيسية</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { setMoveKind("cash_in"); setMoveOpen(true); }}>
              <ArrowDownCircle className="w-4 h-4 ml-1" /> إيراد متنوع
            </Button>
            <Button variant="outline" onClick={() => { setMoveKind("expense"); setMoveOpen(true); }}>
              <ArrowUpCircle className="w-4 h-4 ml-1" /> مصروف
            </Button>
            <Button onClick={() => setHandoverOpen(true)}>
              <Send className="w-4 h-4 ml-1" /> توريد نقدية للرئيسية
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending"><Clock className="w-4 h-4 ml-1" />معلقة ({pendingHandovers.length})</TabsTrigger>
          <TabsTrigger value="approved"><CheckCircle2 className="w-4 h-4 ml-1" />معتمدة ({approvedHandovers.length})</TabsTrigger>
          <TabsTrigger value="rejected"><XCircle className="w-4 h-4 ml-1" />مرفوضة ({rejectedHandovers.length})</TabsTrigger>
          <TabsTrigger value="all">كل الحركات ({txns.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="mt-4">
          <HandoverTable rows={pendingHandovers} kind="pending" canApprove={canApprove} onApprove={approve} onReject={(id) => setRejectOpen({ id })} />
        </TabsContent>
        <TabsContent value="approved" className="mt-4">
          <HandoverTable rows={approvedHandovers} kind="approved" />
        </TabsContent>
        <TabsContent value="rejected" className="mt-4">
          <HandoverTable rows={rejectedHandovers} kind="rejected" />
        </TabsContent>

        <TabsContent value="all" className="mt-4">
          <Card>
            <CardHeader><CardTitle>سجل حركات خزنة العجوزة</CardTitle></CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground"><Loader2 className="w-4 h-4 ml-2 animate-spin" /> جارٍ التحميل…</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>التاريخ</TableHead>
                      <TableHead>الرقم</TableHead>
                      <TableHead>النوع</TableHead>
                      <TableHead>اتجاه</TableHead>
                      <TableHead>المبلغ</TableHead>
                      <TableHead>الحالة</TableHead>
                      <TableHead>ملاحظات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {txns.map(t => (
                      <TableRow key={t.id}>
                        <TableCell className="whitespace-nowrap text-xs">{formatDateTime(t.txn_date)}</TableCell>
                        <TableCell className="font-mono text-xs">{t.txn_no}</TableCell>
                        <TableCell>{TYPE_LABEL[t.txn_type] || t.txn_type}</TableCell>
                        <TableCell>
                          {t.direction === "in"
                            ? <Badge variant="outline" className="bg-emerald-50 text-emerald-700">وارد</Badge>
                            : <Badge variant="outline" className="bg-rose-50 text-rose-700">صادر</Badge>}
                        </TableCell>
                        <TableCell className="font-bold">{fmt(Number(t.amount))}</TableCell>
                        <TableCell><StatusBadge status={t.status} /></TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[260px] truncate">{t.notes}</TableCell>
                      </TableRow>
                    ))}
                    {txns.length === 0 && (
                      <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">لا توجد حركات</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Submit handover dialog */}
      <Dialog open={handoverOpen} onOpenChange={setHandoverOpen}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>توريد نقدية للخزنة الرئيسية</DialogTitle>
            <DialogDescription>سيتم تسجيل التوريد كـ <b>معلّق</b> ولن يدخل خزنة الرئيسي إلا بعد اعتماد المدير العام / التنفيذي.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {pendingBosttaSheets.length > 0 && (
              <div className="rounded-md border border-sky-200 bg-sky-50/60 p-3 space-y-2">
                <div className="text-xs font-semibold text-sky-900">
                  كشوف بُسطة تم تحصيلها ولم يتم توريدها بعد ({pendingBosttaSheets.length})
                </div>
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {pendingBosttaSheets.map(sheet => (
                    <button
                      key={sheet.id}
                      type="button"
                      onClick={() => {
                        setSelectedBosttaId(sheet.id);
                        setHandoverAmount(String(sheet.amount));
                        setHandoverNotes(`توريد ${sheet.notes}`);
                      }}
                      className={`w-full text-right px-3 py-2 rounded border text-xs transition ${
                        selectedBosttaId === sheet.id
                          ? "bg-sky-600 text-white border-sky-700"
                          : "bg-white border-sky-200 hover:border-sky-400"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate">📄 {sheet.filename}</span>
                        <span className="font-mono font-bold whitespace-nowrap">{sheet.amount.toLocaleString("ar-EG")} ج</span>
                      </div>
                    </button>
                  ))}
                </div>
                <div className="text-[10px] text-sky-800">اضغط على كشف لتعبئة المبلغ والملاحظات تلقائيًا.</div>
              </div>
            )}
            <div>
              <Label>المبلغ (ج.م)</Label>
              <Input type="number" min="0" step="0.01" value={handoverAmount} onChange={e => { setHandoverAmount(e.target.value); setSelectedBosttaId(null); }} />
            </div>
            <div>
              <Label>ملاحظات (اختياري)</Label>
              <Textarea value={handoverNotes} onChange={e => setHandoverNotes(e.target.value)} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHandoverOpen(false)}>إلغاء</Button>
            <Button onClick={submitHandover} disabled={submitting}>
              {submitting && <Loader2 className="w-4 h-4 ml-1 animate-spin" />} تسجيل التوريد
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Simple movement dialog */}
      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>{moveKind === "cash_in" ? "تسجيل إيراد متنوع" : "تسجيل مصروف"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>المبلغ (ج.م)</Label>
              <Input type="number" min="0" step="0.01" value={moveAmount} onChange={e => setMoveAmount(e.target.value)} />
            </div>
            <div>
              <Label>السبب / الملاحظة</Label>
              <Textarea value={moveNotes} onChange={e => setMoveNotes(e.target.value)} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveOpen(false)}>إلغاء</Button>
            <Button onClick={submitMove} disabled={submitting}>
              {submitting && <Loader2 className="w-4 h-4 ml-1 animate-spin" />} حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject dialog */}
      <Dialog open={!!rejectOpen} onOpenChange={(o) => !o && setRejectOpen(null)}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>رفض التوريد</DialogTitle>
            <DialogDescription>سبب الرفض إجباري وسيتم توثيقه في سجل الحركات.</DialogDescription>
          </DialogHeader>
          <Textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={3} placeholder="اكتب سبب الرفض…" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(null)}>إلغاء</Button>
            <Button variant="destructive" onClick={reject}>تأكيد الرفض</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusBadge({ status }: { status: Txn["status"] }) {
  switch (status) {
    case "pending":  return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">معلّق</Badge>;
    case "approved": return <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">معتمد</Badge>;
    case "rejected": return <Badge variant="outline" className="bg-zinc-100 text-zinc-700">مرفوض</Badge>;
    case "reversed": return <Badge variant="outline" className="bg-rose-50 text-rose-700">معكوس</Badge>;
    default:         return <Badge variant="outline">مسجّل</Badge>;
  }
}

function HandoverTable({
  rows, kind, canApprove, onApprove, onReject,
}: {
  rows: Txn[];
  kind: "pending" | "approved" | "rejected";
  canApprove?: boolean;
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
}) {
  return (
    <Card>
      <CardContent className="pt-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>التاريخ</TableHead>
              <TableHead>الرقم</TableHead>
              <TableHead>المبلغ</TableHead>
              <TableHead>الملاحظات</TableHead>
              {kind === "approved" && <TableHead>المعتمد</TableHead>}
              {kind === "rejected" && <TableHead>سبب الرفض</TableHead>}
              <TableHead className="text-left">إجراء</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(t => {
              const hasSheet = !!extractBosttaFilenameFromNotes(t.notes);
              return (
              <TableRow key={t.id}>
                <TableCell className="text-xs whitespace-nowrap">{formatDateTime(t.txn_date)}</TableCell>
                <TableCell className="font-mono text-xs">{t.txn_no}</TableCell>
                <TableCell className="font-bold">{fmt(Number(t.amount))} ج.م</TableCell>
                <TableCell className="text-xs text-muted-foreground max-w-[260px] truncate">{t.notes}</TableCell>
                {kind === "approved" && (
                  <TableCell className="text-xs">{t.approved_at ? formatDateTime(t.approved_at) : "—"}</TableCell>
                )}
                {kind === "rejected" && (
                  <TableCell className="text-xs text-rose-600">{t.rejection_reason}</TableCell>
                )}
                <TableCell className="text-left">
                  <div className="flex gap-2 justify-end flex-wrap">
                    {hasSheet && (
                      <Button size="sm" variant="outline" onClick={() => printBosttaHandoverInvoice(t)} title="طباعة فاتورة التوريد بأوردراتها">
                        <Printer className="w-4 h-4 ml-1" /> طباعة الفاتورة
                      </Button>
                    )}
                    {kind === "pending" && (
                      canApprove ? (
                        <>
                          <Button size="sm" onClick={() => onApprove?.(t.id)}>
                            <CheckCircle2 className="w-4 h-4 ml-1" /> اعتماد
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => onReject?.(t.id)}>
                            <XCircle className="w-4 h-4 ml-1" /> رفض
                          </Button>
                        </>
                      ) : (
                        <Badge variant="outline">بانتظار الإدارة</Badge>
                      )
                    )}
                  </div>
                </TableCell>
              </TableRow>
              );
            })}
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">لا يوجد</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
