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
import { FileText, Wallet, Printer, Percent, Receipt as ReceiptIcon } from "lucide-react";
import { openPrintWindow } from "@/lib/printPdf";
import { useAuth } from "@/hooks/useAuth";

const num = (v: any) => (v == null || isNaN(Number(v)) ? 0 : Number(v));
const fmt = (v: any) => num(v).toLocaleString("ar-EG");
const fmtMoney = (v: any) => `${num(v).toLocaleString("ar-EG", { maximumFractionDigits: 2 })} ج.م`;

const statusLabels: Record<string, string> = { unpaid: "غير مدفوعة", partial: "مدفوعة جزئيًا", paid: "مدفوعة" };
const statusColors: Record<string, string> = { unpaid: "bg-red-500", partial: "bg-amber-500", paid: "bg-emerald-600" };

const methodLabels: Record<string, string> = {
  cash: "نقدي",
  instapay: "إنستاباي",
  vodafone_cash: "فودافون كاش",
  bank_transfer: "تحويل بنكي",
  credit_balance: "خصم من رصيد سابق",
};

export default function BatchAccountDialog({
  lotId, customerName, onClose,
}: { lotId: string; customerName: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<string>("cash");
  const [notes, setNotes] = useState("");
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receiptDate, setReceiptDate] = useState(new Date().toISOString().slice(0, 10));
  const [savingReceipt, setSavingReceipt] = useState(false);
  const [hatchEditOpen, setHatchEditOpen] = useState(false);
  const [hatchDate, setHatchDate] = useState("");
  const [savingHatch, setSavingHatch] = useState(false);


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

  const { data: pricing } = useQuery({
    queryKey: ["hatchery_pricing_settings_active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hatchery_pricing_settings" as any)
        .select("*")
        .order("updated_at", { ascending: false })
        .limit(1)
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
    if (!lot?.hatcher_out_at) {
      toast.error("يجب تسجيل تاريخ الفقس أولًا لحساب رسوم التحضين");
      return;
    }
    if (!lot?.brooding_out_at) {
      toast.error("يجب تسجيل تاريخ استلام الكتاكيت أولًا حتى يتم حساب التحضين وإنشاء الفاتورة");
      return;
    }
    setCreating(true);
    const { error } = await supabase.rpc("compute_hatchery_invoice" as any, { _lot_id: lotId });
    setCreating(false);
    if (error) return toast.error(error.message);
    toast.success("تم إنشاء الفاتورة (بدون أي تأثير على خزنة المعمل)");
    refreshAll();
  };

  const saveReceiptDate = async () => {
    if (!receiptDate) return toast.error("اختر تاريخ الاستلام");
    if (lot?.hatcher_out_at && new Date(receiptDate) < new Date(lot.hatcher_out_at.slice(0, 10))) {
      return toast.error("تاريخ الاستلام لا يمكن أن يكون قبل تاريخ الفقس");
    }
    setSavingReceipt(true);
    const { error } = await supabase.from("hatchery_batch_lots" as any)
      .update({ brooding_out_at: new Date(receiptDate + "T12:00:00").toISOString() } as any)
      .eq("id", lotId);
    setSavingReceipt(false);
    if (error) return toast.error(error.message);
    toast.success("تم تسجيل تاريخ الاستلام");
    setReceiptOpen(false);
    // Recompute the invoice if it already exists (before any collection)
    if (invoice && num(invoice.paid_amount) === 0) {
      await supabase.rpc("compute_hatchery_invoice" as any, { _lot_id: lotId });
    }
    refreshAll();
  };

  const saveHatchDate = async () => {
    if (!hatchDate) return toast.error("اختر تاريخ الفقس");
    setSavingHatch(true);
    const { error } = await supabase.from("hatchery_batch_lots" as any)
      .update({ hatcher_out_at: new Date(hatchDate + "T08:00:00").toISOString() } as any)
      .eq("id", lotId);
    setSavingHatch(false);
    if (error) return toast.error(error.message);
    toast.success("تم تحديث تاريخ الفقس");
    setHatchEditOpen(false);
    // If invoice already exists, recompute it
    if (invoice) {
      await supabase.rpc("compute_hatchery_invoice" as any, { _lot_id: lotId });
    }
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
            <Info label="تاريخ الفقس" value={
              <span className="inline-flex items-center gap-1">
                {lot.hatcher_out_at?.slice(0,10) || "—"}
                <button
                  type="button"
                  className="text-[10px] text-primary underline"
                  onClick={() => { setHatchDate(lot.hatcher_out_at?.slice(0,10) || new Date().toISOString().slice(0,10)); setHatchEditOpen(true); }}
                >تعديل</button>
              </span>
            } />
            <Info label="تاريخ الاستلام" value={lot.brooding_out_at?.slice(0,10) || "لم يستلم بعد"} />
            <Info label="عدد البيض" value={fmt(lot.eggs_in)} />
            <Info label="عدد اللايح" value={fmt(lot.infertile_eggs)} />
            <Info label="الكشف الثاني" value={fmt(lot.completed_unhatched)} />
            <Info label="عدد الكتاكيت" value={fmt(lot.chicks_hatched)} />
            <Info label="أيام التحضين" value={fmt(lot.brooding_days)} />
          </div>

          {/* Projected brooding when customer hasn't received chicks yet */}
          {!lot.brooding_out_at && num(lot.chicks_hatched) > 0 && lot.hatcher_out_at && (() => {
            const start = new Date(lot.hatcher_out_at.slice(0, 10));
            const today = new Date(new Date().toISOString().slice(0, 10));
            const days = Math.max(1, Math.round((today.getTime() - start.getTime()) / 86400000) + 1);
            const chicks = num(lot.chicks_hatched);
            const proj = days * chicks * 10;
            return (
              <div className="rounded border p-3 bg-blue-50 dark:bg-blue-950/30 text-sm flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <Badge variant="outline" className="ml-2">تحضين تقديري حتى اليوم</Badge>
                  <span>{chicks} كتكوت × {days} يوم × 10 ج.م = <b>{fmtMoney(proj)}</b></span>
                  <p className="text-xs text-muted-foreground mt-1">يتم تثبيت الرسوم النهائية عند تسجيل تاريخ الاستلام.</p>
                </div>
                <Button size="sm" onClick={() => setReceiptOpen(true)}>
                  تسجيل تاريخ الاستلام
                </Button>
              </div>
            );
          })()}

          {/* Full account summary before invoice creation — review BEFORE generating invoice */}
          {!invoice && lot.hatcher_out_at && lot.brooding_out_at && pricing && (() => {
            const start = new Date(lot.hatcher_out_at.slice(0, 10));
            const end = new Date(lot.brooding_out_at.slice(0, 10));
            const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
            const chicks = num(lot.chicks_hatched);
            const infertile = num(lot.infertile_eggs);
            const unhatched = num(lot.completed_unhatched);
            const infPrice = num(pricing.infertile_egg_price);
            const chPrice = num(pricing.chick_price);
            const unPrice = num(pricing.completed_unhatched_price);
            const dailyPrice = num(pricing.daily_brooding_price);
            const infAmt = infertile * infPrice;
            const unAmt = unhatched * unPrice;
            const chAmt = chicks * chPrice;
            const brAmt = chicks * days * dailyPrice;
            const total = infAmt + unAmt + chAmt + brAmt;
            const paid = 0; const remaining = total - paid;
            return (
              <div className="rounded-lg border-2 border-emerald-500 p-4 bg-emerald-50 dark:bg-emerald-950/30 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h3 className="font-bold text-emerald-700 dark:text-emerald-300">
                    📋 ملخص حساب العميل — للمراجعة قبل إنشاء الفاتورة
                  </h3>
                  <Badge variant="outline">لم يتم الإنشاء بعد</Badge>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                  <Info label="أيام التحضين" value={`${days} يوم`} />
                  <Info label={`رسوم اللايح (${infertile} × ${infPrice})`} value={fmtMoney(infAmt)} />
                  <Info label={`رسوم الكشف الثاني (${unhatched} × ${unPrice})`} value={fmtMoney(unAmt)} />
                  <Info label={`رسوم الكتاكيت (${chicks} × ${chPrice})`} value={fmtMoney(chAmt)} />
                  <Info label={`رسوم التحضين (${chicks} × ${days} × ${dailyPrice})`} value={fmtMoney(brAmt)} />
                  <Info label="إجمالي المستحق" value={fmtMoney(total)} highlight />
                  <Info label="المدفوع" value={fmtMoney(paid)} />
                  <Info label="المتبقي" value={fmtMoney(remaining)} highlight />
                </div>
                <div className="flex items-center justify-between gap-2 pt-2 border-t">
                  <p className="text-xs text-muted-foreground">
                    راجع الأرقام جيدًا. إنشاء الفاتورة لا يُحرّك الخزنة — الخزنة لا تتأثر إلا عند التحصيل.
                  </p>
                  <Button onClick={createInvoice} disabled={creating} size="lg">
                    <FileText className="w-4 h-4 ml-1" />
                    {creating ? "جارٍ الإنشاء..." : "إنشاء فاتورة"}
                  </Button>
                </div>
              </div>
            );
          })()}

          {!invoice && (!lot.hatcher_out_at || !lot.brooding_out_at) && (
            <div className="rounded border p-4 bg-amber-50 dark:bg-amber-950/30 flex items-center justify-between gap-3">
              <div className="text-sm">
                <p className="font-semibold">لم يتم إنشاء فاتورة لهذه الدفعة بعد.</p>
                <p className="text-xs text-muted-foreground">
                  {!lot.hatcher_out_at
                    ? "يجب تسجيل تاريخ الفقس أولًا لحساب رسوم التحضين."
                    : "سجّل تاريخ استلام الكتاكيت أولًا لعرض ملخص الحساب للمراجعة قبل إنشاء الفاتورة."}
                </p>
              </div>
              <Button onClick={() => !lot.hatcher_out_at ? setHatchEditOpen(true) : setReceiptOpen(true)}>
                {!lot.hatcher_out_at ? "تسجيل تاريخ الفقس" : "تسجيل تاريخ الاستلام"}
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

        {/* Receipt-date dialog */}
        <Dialog open={receiptOpen} onOpenChange={setReceiptOpen}>
          <DialogContent dir="rtl" className="max-w-md">
            <DialogHeader><DialogTitle>تسجيل تاريخ استلام الكتاكيت</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="text-xs text-muted-foreground">
                تاريخ الفقس: <b>{lot.hatcher_out_at?.slice(0, 10) || "—"}</b>
              </div>
              <div>
                <Label>تاريخ الاستلام</Label>
                <Input type="date" value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)} />
              </div>
              <p className="text-xs text-muted-foreground">
                أيام التحضين = (تاريخ الاستلام − تاريخ الفقس) + 1، ورسوم التحضين = الأيام × عدد الكتاكيت × 10 ج.م.
                تسجيل التاريخ لا يؤثر على خزنة المعمل.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setReceiptOpen(false)}>إلغاء</Button>
              <Button onClick={saveReceiptDate} disabled={savingReceipt}>
                {savingReceipt ? "جارٍ..." : "حفظ"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Hatch-date edit dialog */}
        <Dialog open={hatchEditOpen} onOpenChange={setHatchEditOpen}>
          <DialogContent dir="rtl" className="max-w-md">
            <DialogHeader><DialogTitle>تعديل تاريخ الفقس لهذا العميل</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>تاريخ الفقس</Label>
                <Input type="date" value={hatchDate} onChange={(e) => setHatchDate(e.target.value)} />
              </div>
              <p className="text-xs text-muted-foreground">
                التعديل يطبَّق على هذا العميل فقط داخل الدفعة. سيتم إعادة حساب رسوم التحضين تلقائيًا لو الفاتورة موجودة.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setHatchEditOpen(false)}>إلغاء</Button>
              <Button onClick={saveHatchDate} disabled={savingHatch}>
                {savingHatch ? "جارٍ..." : "حفظ"}
              </Button>
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
