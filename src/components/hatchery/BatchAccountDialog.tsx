import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { FileText, Wallet, Printer } from "lucide-react";
import { openPrintWindow } from "@/lib/printPdf";

const num = (v: any) => (v == null || isNaN(Number(v)) ? 0 : Number(v));
const fmt = (v: any) => num(v).toLocaleString("ar-EG");
const fmtMoney = (v: any) => `${num(v).toLocaleString("ar-EG", { maximumFractionDigits: 2 })} ج.م`;

const statusLabels: Record<string, string> = { unpaid: "غير مدفوعة", partial: "مدفوعة جزئيًا", paid: "مدفوعة" };
const statusColors: Record<string, string> = { unpaid: "bg-red-500", partial: "bg-amber-500", paid: "bg-emerald-600" };

export default function BatchAccountDialog({
  lotId, customerName, onClose,
}: { lotId: string; customerName: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<string>("cash");
  const [notes, setNotes] = useState("");

  const { data: lot, refetch: refetchLot } = useQuery({
    queryKey: ["batch_account_lot", lotId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hatchery_batch_lots" as any)
        .select("*, batch:hatchery_batches(id,batch_number,entry_date,status)")
        .eq("id", lotId)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  const { data: invoice, refetch: refetchInvoice } = useQuery({
    queryKey: ["batch_account_invoice", lotId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hatchery_client_invoices" as any)
        .select("*")
        .eq("lot_id", lotId)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  const { data: payments = [], refetch: refetchPayments } = useQuery({
    queryKey: ["batch_account_payments", invoice?.id],
    enabled: !!invoice?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hatchery_invoice_payments" as any)
        .select("*")
        .eq("invoice_id", invoice!.id)
        .order("paid_at", { ascending: false });
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  const refreshAll = () => {
    refetchLot(); refetchInvoice(); refetchPayments();
    qc.invalidateQueries({ queryKey: ["ecr_"] });
    qc.invalidateQueries({ queryKey: ["hatchery_client_invoices"] });
    qc.invalidateQueries({ queryKey: ["lab_treasury_movements"] });
  };

  const createInvoice = async () => {
    if (invoice) { toast.info("الفاتورة موجودة بالفعل"); return; }
    setCreating(true);
    const { error } = await supabase.rpc("compute_hatchery_invoice" as any, { _lot_id: lotId });
    setCreating(false);
    if (error) return toast.error(error.message);
    toast.success("تم إنشاء الفاتورة (بدون أي تأثير على خزنة المعمل)");
    refreshAll();
  };

  const addPayment = async () => {
    const amt = +amount;
    if (!invoice) return;
    if (!amt || amt <= 0) return toast.error("أدخل مبلغًا صحيحًا");
    const remaining = num(invoice.remaining_amount);
    if (amt > remaining + 0.01) return toast.error(`المبلغ يتجاوز المتبقي (${fmtMoney(remaining)})`);
    const uid = (await supabase.auth.getUser()).data.user?.id;
    const { error } = await supabase.from("hatchery_invoice_payments" as any).insert({
      invoice_id: invoice.id, amount: amt, method, notes: notes || null, received_by: uid,
    });
    if (error) return toast.error(error.message);
    toast.success("تم التحصيل وتسجيل توريد تفريخ في خزنة المعمل");
    setPayOpen(false); setAmount(""); setNotes("");
    refreshAll();
  };

  const printAccount = () => {
    if (!lot) return;
    const i = invoice;
    const html = `
      <h1>حساب دفعة تفريخ — ${customerName}</h1>
      <p>رقم الدفعة: <b>${lot.batch?.batch_number || "—"}</b> &nbsp; | &nbsp; تاريخ الدخول: ${lot.batch?.entry_date || "—"}</p>
      <p>تاريخ الفقس: ${lot.hatcher_out_at?.slice(0,10) || "—"} &nbsp; | &nbsp; تاريخ الاستلام: ${lot.brooding_out_at?.slice(0,10) || "—"}</p>
      <table>
        <tr><th>عدد البيض</th><td>${fmt(lot.eggs_in)}</td><th>عدد اللايح</th><td>${fmt(lot.infertile_eggs)}</td></tr>
        <tr><th>الكشف الثاني (أكمل بدون فقس)</th><td>${fmt(lot.completed_unhatched)}</td><th>عدد الكتاكيت</th><td>${fmt(lot.chicks_hatched)}</td></tr>
      </table>
      ${i ? `
      <h2>الفاتورة ${i.invoice_no}</h2>
      <table>
        <tr><th>رسوم اللايح</th><td>${fmtMoney(i.infertile_amount)}</td></tr>
        <tr><th>رسوم الكشف الثاني</th><td>${fmtMoney(i.completed_unhatched_amount)}</td></tr>
        <tr><th>رسوم الكتاكيت</th><td>${fmtMoney(i.chicks_amount)}</td></tr>
        <tr><th>رسوم التحضين (${i.brooding_days} يوم × ${i.brooding_chicks_count})</th><td>${fmtMoney(i.brooding_amount)}</td></tr>
        <tr><th>إجمالي المستحق</th><td><b>${fmtMoney(i.total_amount)}</b></td></tr>
        <tr><th>المدفوع</th><td>${fmtMoney(i.paid_amount)}</td></tr>
        <tr><th>المتبقي</th><td><b>${fmtMoney(i.remaining_amount)}</b></td></tr>
        <tr><th>الحالة</th><td>${statusLabels[i.payment_status] || i.payment_status}</td></tr>
      </table>` : `<p><i>لم يتم إنشاء فاتورة بعد.</i></p>`}
    `;
    openPrintWindow(`حساب دفعة — ${customerName}`, html);
  };

  if (!lot) return null;
  const b = lot.batch || {};

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent dir="rtl" className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>حساب الدفعة — {customerName} — {b.batch_number}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded border p-3 bg-muted/30 text-sm grid grid-cols-2 md:grid-cols-4 gap-2">
            <Info label="اسم العميل" value={customerName} />
            <Info label="رقم الدفعة" value={b.batch_number || "—"} />
            <Info label="تاريخ الدخول" value={b.entry_date || "—"} />
            <Info label="تاريخ الفقس" value={lot.hatcher_out_at?.slice(0,10) || "—"} />
            <Info label="تاريخ الاستلام" value={lot.brooding_out_at?.slice(0,10) || "لم يستلم بعد"} />
            <Info label="عدد البيض" value={fmt(lot.eggs_in)} />
            <Info label="عدد اللايح" value={fmt(lot.infertile_eggs)} />
            <Info label="الكشف الثاني" value={fmt(lot.completed_unhatched)} />
            <Info label="عدد الكتاكيت" value={fmt(lot.chicks_hatched)} />
            <Info label="أيام التحضين" value={fmt(lot.brooding_days)} />
          </div>

          {!invoice && (
            <div className="rounded border p-4 bg-amber-50 dark:bg-amber-950/30 flex items-center justify-between gap-3">
              <div className="text-sm">
                <p className="font-semibold">لم يتم إنشاء فاتورة لهذه الدفعة بعد.</p>
                <p className="text-xs text-muted-foreground">إنشاء الفاتورة لا يؤثر على خزنة المعمل. الخزنة لا تتغير إلا عند التحصيل.</p>
              </div>
              <Button onClick={createInvoice} disabled={creating}>
                <FileText className="w-4 h-4 ml-1" />
                {creating ? "جارٍ..." : "إنشاء فاتورة استلام كتاكيت"}
              </Button>
            </div>
          )}

          {invoice && (
            <div className="rounded border p-3 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">رقم الفاتورة:</span>
                  <span className="font-mono font-bold">{invoice.invoice_no}</span>
                  <Badge className={`${statusColors[invoice.payment_status]} text-white`}>{statusLabels[invoice.payment_status]}</Badge>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={printAccount}><Printer className="w-4 h-4 ml-1" />طباعة</Button>
                  {num(invoice.remaining_amount) > 0 && (
                    <Button size="sm" onClick={() => { setAmount(String(num(invoice.remaining_amount))); setPayOpen(true); }}>
                      <Wallet className="w-4 h-4 ml-1" />تحصيل
                    </Button>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
                <Info label="رسوم اللايح" value={fmtMoney(invoice.infertile_amount)} />
                <Info label="رسوم الكشف الثاني" value={fmtMoney(invoice.completed_unhatched_amount)} />
                <Info label="رسوم الكتاكيت" value={fmtMoney(invoice.chicks_amount)} />
                <Info label={`رسوم التحضين (${invoice.brooding_days} يوم)`} value={fmtMoney(invoice.brooding_amount)} />
                <Info label="إجمالي المستحق" value={fmtMoney(invoice.total_amount)} highlight />
                <Info label="المدفوع" value={fmtMoney(invoice.paid_amount)} />
                <Info label="المتبقي" value={fmtMoney(invoice.remaining_amount)} highlight />
              </div>

              <div>
                <h4 className="font-semibold text-sm mb-2">سجل التحصيلات (توريد تفريخ)</h4>
                <div className="rounded border overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>التاريخ</TableHead><TableHead>المبلغ</TableHead>
                      <TableHead>طريقة الدفع</TableHead><TableHead>ملاحظات</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {payments.length === 0 ? (
                        <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-3">لا توجد تحصيلات بعد</TableCell></TableRow>
                      ) : payments.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="text-xs">{p.paid_at?.slice(0,16).replace("T"," ")}</TableCell>
                          <TableCell className="font-bold text-green-600">{fmtMoney(p.amount)}</TableCell>
                          <TableCell>{p.method || "—"}</TableCell>
                          <TableCell className="text-xs">{p.notes || "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>إغلاق</Button>
        </DialogFooter>

        {/* Payment dialog */}
        <Dialog open={payOpen} onOpenChange={setPayOpen}>
          <DialogContent dir="rtl" className="max-w-md">
            <DialogHeader><DialogTitle>تحصيل من فاتورة {invoice?.invoice_no}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="text-sm rounded bg-muted/40 p-2">المتبقي: <b>{fmtMoney(invoice?.remaining_amount)}</b></div>
              <div><Label>المبلغ</Label><Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
              <div>
                <Label>طريقة الدفع</Label>
                <Select value={method} onValueChange={setMethod}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">نقدي</SelectItem>
                    <SelectItem value="instapay">إنستاباي</SelectItem>
                    <SelectItem value="vodafone_cash">فودافون كاش</SelectItem>
                    <SelectItem value="bank_transfer">تحويل بنكي</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>ملاحظات</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
              <p className="text-xs text-muted-foreground">
                سيتم تسجيل حركة "توريد تفريخ" في خزنة المعمل تحتوي على العميل ورقم الدفعة ورقم الفاتورة.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPayOpen(false)}>إلغاء</Button>
              <Button onClick={addPayment}>تأكيد التحصيل</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

const Info = ({ label, value, highlight }: { label: string; value: any; highlight?: boolean }) => (
  <div className="p-2 rounded border bg-background">
    <p className="text-[11px] text-muted-foreground">{label}</p>
    <p className={`font-bold ${highlight ? "text-primary" : ""}`}>{value}</p>
  </div>
);
