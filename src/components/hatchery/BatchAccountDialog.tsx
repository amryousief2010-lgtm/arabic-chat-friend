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
  const { roles } = useAuth();
  const canDiscount = ["general_manager","executive_manager","hatchery_manager","accountant"]
    .some(r => roles?.includes(r as any));

  const [creating, setCreating] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<string>("cash");
  const [notes, setNotes] = useState("");
  const [paying, setPaying] = useState(false);
  const [remainderAction, setRemainderAction] = useState<"keep" | "carryover" | "discount">("keep");
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receiptDate, setReceiptDate] = useState(new Date().toISOString().slice(0, 10));
  const [savingReceipt, setSavingReceipt] = useState(false);
  const [hatchEditOpen, setHatchEditOpen] = useState(false);
  const [hatchDate, setHatchDate] = useState("");
  const [savingHatch, setSavingHatch] = useState(false);

  // Discount state
  const [discOpen, setDiscOpen] = useState(false);
  const [discAmount, setDiscAmount] = useState("");
  const [discReason, setDiscReason] = useState("");
  const [discNotes, setDiscNotes] = useState("");
  const [savingDisc, setSavingDisc] = useState(false);
  const [applyingCarry, setApplyingCarry] = useState<string | null>(null);


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

  const { data: discounts = [], refetch: refetchDiscounts } = useQuery({
    queryKey: ["batch_account_discounts", invoice?.id],
    enabled: !!invoice?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hatchery_invoice_discounts" as any)
        .select("*")
        .eq("invoice_id", invoice!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  // Carryover forwarded FROM this invoice (out)
  const { data: outCarryover, refetch: refetchOutCarry } = useQuery({
    queryKey: ["batch_account_out_carry", invoice?.id],
    enabled: !!invoice?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hatchery_invoice_carryovers" as any)
        .select("*")
        .eq("source_invoice_id", invoice!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  // Open carryovers for the same client coming from OTHER invoices
  const { data: incomingCarryovers = [], refetch: refetchInCarry } = useQuery({
    queryKey: ["batch_account_in_carry", invoice?.client_id, invoice?.id],
    enabled: !!invoice?.client_id && !!invoice?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hatchery_invoice_carryovers" as any)
        .select("*, source_invoice:hatchery_client_invoices!source_invoice_id(invoice_no)")
        .eq("client_id", invoice!.client_id)
        .eq("status", "open")
        .neq("source_invoice_id", invoice!.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  // Carryovers already applied to this invoice (in)
  const { data: appliedToThis = [], refetch: refetchAppliedThis } = useQuery({
    queryKey: ["batch_account_applied_this", invoice?.id],
    enabled: !!invoice?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hatchery_invoice_carryovers" as any)
        .select("*, source_invoice:hatchery_client_invoices!source_invoice_id(invoice_no)")
        .eq("applied_to_invoice_id", invoice!.id)
        .eq("status", "applied")
        .order("applied_at", { ascending: false });
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  const refreshAll = () => {
    refetchLot(); refetchInvoice(); refetchPayments(); refetchDiscounts();
    refetchOutCarry(); refetchInCarry(); refetchAppliedThis();
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
    if (paying) return;
    const amt = +amount;
    if (!invoice) return;
    if (!amt || amt <= 0) return toast.error("أدخل مبلغًا صحيحًا");

    const remaining = num(invoice.remaining_amount);
    if (amt > remaining + 0.01) return toast.error(`المبلغ يتجاوز المتبقي (${fmtMoney(remaining)})`);
    const leftover = +(remaining - amt).toFixed(2);
    setPaying(true);
    const uid = (await supabase.auth.getUser()).data.user?.id;
    const ref = `hatch_invoice_payment_${invoice.id}_${Date.now()}`;
    const { error } = await supabase.from("hatchery_invoice_payments" as any).insert({
      invoice_id: invoice.id, amount: amt, method, notes: notes ? `${notes} • ref:${ref}` : `ref:${ref}`, received_by: uid,
    });
    if (error) { setPaying(false); return toast.error(error.message); }

    // Handle remainder action when this is a partial payment
    if (leftover > 0.001 && remainderAction === "carryover") {
      // Prevent duplicate open carryover
      const { data: existingOpen } = await supabase
        .from("hatchery_invoice_carryovers" as any)
        .select("id")
        .eq("source_invoice_id", invoice.id)
        .eq("status", "open")
        .maybeSingle();
      if (!existingOpen) {
        const { error: cErr } = await supabase.from("hatchery_invoice_carryovers" as any).insert({
          source_invoice_id: invoice.id,
          client_id: invoice.client_id,
          amount: leftover,
          status: "open",
          reason: "ترحيل متبقي بعد تحصيل جزئي",
          notes: notes || null,
          created_by: uid,
        });
        if (cErr) {
          setPaying(false);
          return toast.error(`تم التحصيل، لكن فشل ترحيل المتبقي: ${cErr.message}`);
        }
        toast.success(`تم التحصيل وترحيل ${fmtMoney(leftover)} كمتبقي مرحّل لفاتورة قادمة`);
      } else {
        toast.warning("تم التحصيل — يوجد متبقٍ مرحّل مفتوح بالفعل لهذه الفاتورة");
      }
    } else if (leftover > 0.001 && remainderAction === "discount") {
      toast.success("تم التحصيل — افتح فورم الخصم لاعتماد المتبقي");
      // Pre-fill discount dialog with leftover
      setDiscAmount(String(leftover));
      setDiscReason("");
      setDiscNotes("");
      setTimeout(() => setDiscOpen(true), 200);
    } else {
      toast.success(
        method === "credit_balance"
          ? "تم تسجيل التحصيل من رصيد سابق (بدون حركة خزنة)"
          : "تم التحصيل وتسجيل توريد تفريخ في خزنة المعمل"
      );
    }
    setPaying(false);
    setPayOpen(false); setAmount(""); setNotes(""); setRemainderAction("keep");
    refreshAll();
  };

  const applyCarryover = async (carryoverId: string) => {
    if (!invoice) return;
    setApplyingCarry(carryoverId);
    const uid = (await supabase.auth.getUser()).data.user?.id;
    const { error } = await supabase.from("hatchery_invoice_carryovers" as any)
      .update({
        status: "applied",
        applied_to_invoice_id: invoice.id,
        applied_by: uid,
        applied_at: new Date().toISOString(),
      })
      .eq("id", carryoverId)
      .eq("status", "open");
    setApplyingCarry(null);
    if (error) return toast.error(error.message);
    toast.success("تم إضافة المتبقي المرحل لهذه الفاتورة");
    refreshAll();
  };

  const cancelCarryover = async (carryoverId: string) => {
    if (!canDiscount) return toast.error("لا تملك صلاحية إلغاء الترحيل");
    if (!confirm("تأكيد إلغاء هذا الترحيل؟")) return;
    const uid = (await supabase.auth.getUser()).data.user?.id;
    const { error } = await supabase.from("hatchery_invoice_carryovers" as any)
      .update({ status: "cancelled", cancelled_by: uid, cancelled_at: new Date().toISOString() })
      .eq("id", carryoverId);
    if (error) return toast.error(error.message);
    toast.success("تم إلغاء الترحيل");
    refreshAll();
  };

  const addDiscount = async () => {
    if (savingDisc) return;
    if (!invoice) return;
    if (!canDiscount) return toast.error("لا تملك صلاحية اعتماد خصم على الفاتورة");
    const amt = +discAmount;
    if (!amt || amt <= 0) return toast.error("أدخل مبلغ خصم صحيح");
    if (!discReason.trim()) return toast.error("أدخل سبب الخصم");

    const remaining = num(invoice.remaining_amount);
    if (amt > remaining + 0.01) return toast.error(`الخصم يتجاوز المتبقي (${fmtMoney(remaining)})`);
    setSavingDisc(true);
    const uid = (await supabase.auth.getUser()).data.user?.id;
    const reference_id = `hatch_invoice_discount_${invoice.id}_${Date.now()}`;
    const { error } = await supabase.from("hatchery_invoice_discounts" as any).insert({
      invoice_id: invoice.id,
      amount: amt,
      reason: discReason.trim(),
      notes: discNotes || null,
      approved_by: uid,
      created_by: uid,
      reference_id,
    });
    setSavingDisc(false);
    if (error) return toast.error(error.message);
    toast.success("تم تسجيل الخصم (بدون أي حركة خزنة)");
    setDiscOpen(false); setDiscAmount(""); setDiscReason(""); setDiscNotes("");
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
        <tr><th>رسوم نافق الهاتش (${fmt(i.hatch_mortality_count)} × ${fmt(i.hatch_mortality_unit_price)})</th><td>${fmtMoney(i.hatch_mortality_amount)}</td></tr>
        <tr><th>إجمالي المستحق</th><td><b>${fmtMoney(i.total_amount)}</b></td></tr>
        <tr><th>إجمالي الخصومات</th><td>${fmtMoney(i.discount_amount)}</td></tr>
        <tr><th>إجمالي المدفوع</th><td>${fmtMoney(i.paid_amount)}</td></tr>
        <tr><th>المتبقي</th><td><b>${fmtMoney(i.remaining_amount)}</b></td></tr>
        <tr><th>الحالة</th><td>${statusLabels[i.payment_status] || i.payment_status}${num(i.discount_amount) > 0 ? " • بها خصم" : ""}</td></tr>
      </table>

      <h3>كشف الحساب</h3>
      <table>
        <thead><tr><th>التاريخ</th><th>البيان</th><th>مدين</th><th>دائن</th></tr></thead>
        <tbody>
          <tr><td>${i.issued_at?.slice(0,10) || "—"}</td><td>فاتورة ${i.invoice_no}</td><td>${fmtMoney(i.total_amount)}</td><td>—</td></tr>
          ${[...payments, ...discounts.map((d:any)=>({...d, _isDisc:true}))]
            .sort((a:any,b:any)=> (a.paid_at||a.created_at).localeCompare(b.paid_at||b.created_at))
            .map((row:any) => row._isDisc
              ? `<tr><td>${row.created_at?.slice(0,10)}</td><td>خصم / تسوية — ${row.reason||""}</td><td>—</td><td>${fmtMoney(row.amount)}</td></tr>`
              : `<tr><td>${row.paid_at?.slice(0,10)}</td><td>تحصيل (${methodLabels[row.method] || row.method || "—"})</td><td>—</td><td>${fmtMoney(row.amount)}</td></tr>`
            ).join("")}
        </tbody>
      </table>` : `<p><i>لم يتم إنشاء فاتورة بعد.</i></p>`}
    `;
    openPrintWindow(`حساب دفعة — ${customerName}`, html);
  };

  const printReceipt = (p: any) => {
    if (!invoice) return;
    const html = `
      <h1>إيصال تحصيل</h1>
      <table>
        <tr><th>اسم العميل</th><td>${customerName}</td></tr>
        <tr><th>رقم الفاتورة</th><td>${invoice.invoice_no}</td></tr>
        <tr><th>رقم الدفعة</th><td>${lot?.batch?.batch_number || "—"}</td></tr>
        <tr><th>المبلغ المدفوع</th><td><b>${fmtMoney(p.amount)}</b></td></tr>
        <tr><th>طريقة الدفع</th><td>${methodLabels[p.method] || p.method || "—"}</td></tr>
        <tr><th>تاريخ التحصيل</th><td>${p.paid_at?.slice(0,16).replace("T"," ") || "—"}</td></tr>
        <tr><th>المتبقي بعد التحصيل</th><td>${fmtMoney(invoice.remaining_amount)}</td></tr>
      </table>
      <div style="margin-top:60px;display:grid;grid-template-columns:1fr 1fr;gap:24px;text-align:center;">
        <div style="border-top:1px solid #555;padding-top:6px;">توقيع المستلم</div>
        <div style="border-top:1px solid #555;padding-top:6px;">توقيع المسؤول</div>
      </div>`;
    openPrintWindow(`إيصال تحصيل — ${customerName}`, html);
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
            <Info label="نافق الهاتش" value={fmt(Math.max(0, (num(lot.transferred_count) || num(lot.fertile_eggs) || Math.max(0, num(lot.eggs_in) - num(lot.infertile_eggs))) - num(lot.chicks_hatched) - num(lot.completed_unhatched)))} />
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
            const transferred = num(lot.transferred_count) || num(lot.fertile_eggs) || Math.max(0, num(lot.eggs_in) - infertile);
            const hatchMort = Math.max(0, transferred - chicks - unhatched);
            const infPrice = num(pricing.infertile_egg_price);
            const chPrice = num(pricing.chick_price);
            const unPrice = num(pricing.completed_unhatched_price);
            const dailyPrice = num(pricing.daily_brooding_price);
            const hmPrice = num((pricing as any).hatch_mortality_price) || 100;
            const infAmt = infertile * infPrice;
            const unAmt = unhatched * unPrice;
            const chAmt = chicks * chPrice;
            const brAmt = chicks * days * dailyPrice;
            const hmAmt = hatchMort * hmPrice;
            const total = infAmt + unAmt + chAmt + brAmt + hmAmt;
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
                  <Info label={`رسوم نافق الهاتش (${hatchMort} × ${hmPrice})`} value={fmtMoney(hmAmt)} />
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
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-muted-foreground">رقم الفاتورة:</span>
                  <span className="font-mono font-bold">{invoice.invoice_no}</span>
                  <Badge className={`${statusColors[invoice.payment_status]} text-white`}>{statusLabels[invoice.payment_status]}</Badge>
                  {num(invoice.discount_amount) > 0 && (
                    <Badge className="bg-purple-600 text-white">بها خصم</Badge>
                  )}
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Button variant="outline" size="sm" onClick={printAccount}><Printer className="w-4 h-4 ml-1" />طباعة</Button>
                  {num(invoice.remaining_amount) > 0 && canDiscount && (
                    <Button variant="outline" size="sm"
                      className="border-purple-400 text-purple-700 hover:bg-purple-50"
                      onClick={() => { setDiscAmount(""); setDiscReason(""); setDiscNotes(""); setDiscOpen(true); }}>
                      <Percent className="w-4 h-4 ml-1" />خصم / تسوية
                    </Button>
                  )}
                  {num(invoice.remaining_amount) > 0 && (
                    <Button size="sm" onClick={() => { setAmount(""); setRemainderAction("keep"); setPayOpen(true); }}>
                      <Wallet className="w-4 h-4 ml-1" />تحصيل
                    </Button>
                  )}
                </div>
              </div>
              {/* Incoming carryovers alert: other open carryovers for the same client */}
              {incomingCarryovers.length > 0 && (
                <div className="rounded-lg border-2 border-amber-500 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-2">
                  <p className="font-semibold text-amber-800 dark:text-amber-200 text-sm">
                    🔔 يوجد متبقي مرحّل لهذا العميل من فاتورة سابقة
                  </p>
                  <div className="space-y-1">
                    {incomingCarryovers.map((c: any) => (
                      <div key={c.id} className="flex items-center justify-between gap-2 text-xs bg-background rounded border p-2">
                        <div>
                          متبقي مرحّل من فاتورة <b className="font-mono">{c.source_invoice?.invoice_no || c.source_invoice_id?.slice(0,8)}</b>
                          <span className="mx-2">—</span>
                          <b className="text-primary">{fmtMoney(c.amount)}</b>
                        </div>
                        <div className="flex gap-1">
                          <Button size="sm" className="h-7 text-xs"
                            disabled={applyingCarry === c.id}
                            onClick={() => applyCarryover(c.id)}>
                            {applyingCarry === c.id ? "..." : "إضافة لهذه الفاتورة"}
                          </Button>
                          {canDiscount && (
                            <Button size="sm" variant="ghost" className="h-7 text-xs"
                              onClick={() => cancelCarryover(c.id)}>إلغاء</Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Carryover summary on this invoice */}
              {(num(invoice.carryover_out_amount) > 0 || num(invoice.carryover_in_amount) > 0) && (
                <div className="rounded border bg-blue-50 dark:bg-blue-950/30 p-2 text-xs space-y-1">
                  {num(invoice.carryover_in_amount) > 0 && (
                    <div className="flex items-center justify-between">
                      <span>متبقي مرحّل وارد (أُضيف من فواتير سابقة):</span>
                      <b className="text-blue-700">{fmtMoney(invoice.carryover_in_amount)}</b>
                    </div>
                  )}
                  {num(invoice.carryover_out_amount) > 0 && (
                    <div className="flex items-center justify-between">
                      <span>متبقي مرحّل صادر (تم ترحيله لفاتورة لاحقة):</span>
                      <b className="text-amber-700">{fmtMoney(invoice.carryover_out_amount)}</b>
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                <Info label="رسوم اللايح" value={fmtMoney(invoice.infertile_amount)} />
                <Info label="رسوم الكشف الثاني" value={fmtMoney(invoice.completed_unhatched_amount)} />
                <Info label="رسوم الكتاكيت" value={fmtMoney(invoice.chicks_amount)} />
                <Info label={`رسوم التحضين (${invoice.brooding_days} يوم)`} value={fmtMoney(invoice.brooding_amount)} />
                <Info label={`رسوم نافق الهاتش (${fmt(invoice.hatch_mortality_count)} × ${fmt(invoice.hatch_mortality_unit_price)})`} value={fmtMoney(invoice.hatch_mortality_amount)} />
                <Info label="إجمالي المستحق" value={fmtMoney(invoice.total_amount)} highlight />
                <Info label="إجمالي الخصومات" value={fmtMoney(invoice.discount_amount)} />
                <Info label="إجمالي المدفوع" value={fmtMoney(invoice.paid_amount)} />
                <Info label="المتبقي" value={fmtMoney(invoice.remaining_amount)} highlight />
              </div>

              <div>
                <h4 className="font-semibold text-sm mb-2">كشف حساب الفاتورة (تحصيلات + خصومات)</h4>
                <div className="rounded border overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>التاريخ</TableHead><TableHead>البيان</TableHead>
                      <TableHead>المبلغ</TableHead><TableHead>طريقة الدفع / السبب</TableHead>
                      <TableHead>ملاحظات</TableHead><TableHead></TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {(payments.length + discounts.length) === 0 ? (
                        <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-3">لا توجد حركات بعد</TableCell></TableRow>
                      ) : (
                        [
                          ...payments.map((p:any) => ({ ...p, _type: "payment", _date: p.paid_at })),
                          ...discounts.map((d:any) => ({ ...d, _type: "discount", _date: d.created_at })),
                        ].sort((a:any,b:any) => (b._date||"").localeCompare(a._date||"")).map((row:any) => (
                          <TableRow key={`${row._type}-${row.id}`} className={row._type === "discount" ? "bg-purple-50/50" : ""}>
                            <TableCell className="text-xs">{row._date?.slice(0,16).replace("T"," ")}</TableCell>
                            <TableCell className="text-xs font-medium">
                              {row._type === "discount" ? "خصم / تسوية على الفاتورة" : "تحصيل"}
                            </TableCell>
                            <TableCell className={`font-bold ${row._type === "discount" ? "text-purple-700" : "text-green-600"}`}>
                              {fmtMoney(row.amount)}
                            </TableCell>
                            <TableCell className="text-xs">
                              {row._type === "discount" ? (row.reason || "—") : (methodLabels[row.method] || row.method || "—")}
                            </TableCell>
                            <TableCell className="text-xs">{row.notes || "—"}</TableCell>
                            <TableCell>
                              {row._type === "payment" && (
                                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs"
                                  onClick={() => printReceipt(row)}>
                                  <ReceiptIcon className="w-3 h-3 ml-1" />إيصال
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
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
              <div className="rounded border bg-muted/30 p-3 text-sm space-y-1">
                <div className="flex justify-between"><span className="text-muted-foreground">إجمالي الفاتورة</span><b>{fmtMoney(invoice?.total_amount)}</b></div>
                <div className="flex justify-between"><span className="text-muted-foreground">المدفوع سابقًا</span><b className="text-green-600">{fmtMoney(invoice?.paid_amount)}</b></div>
                {num(invoice?.discount_amount) > 0 && (
                  <div className="flex justify-between"><span className="text-muted-foreground">الخصومات</span><b className="text-purple-700">{fmtMoney(invoice?.discount_amount)}</b></div>
                )}
                <div className="flex justify-between border-t pt-1 mt-1"><span className="text-muted-foreground">المتبقي الحالي</span><b className="text-primary text-base">{fmtMoney(invoice?.remaining_amount)}</b></div>
              </div>
              <div>
                <Label>المبلغ المدفوع الآن</Label>
                <Input type="number" step="0.01" placeholder="أدخل المبلغ (يمكن أن يكون جزئيًا)" value={amount} onChange={(e) => setAmount(e.target.value)} />
                <div className="flex gap-2 mt-1">
                  <Button type="button" size="sm" variant="outline" className="text-xs h-7"
                    onClick={() => setAmount(String(num(invoice?.remaining_amount)))}>
                    سداد المتبقي كامل ({fmtMoney(invoice?.remaining_amount)})
                  </Button>
                </div>
                {amount && Number(amount) > 0 && Number(amount) < num(invoice?.remaining_amount) && (
                  <div className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                    تحصيل جزئي — سيتبقى {fmtMoney(num(invoice?.remaining_amount) - Number(amount))} على العميل.
                  </div>
                )}
              </div>

              {/* Remainder action: only when partial */}
              {amount && Number(amount) > 0 && Number(amount) < num(invoice?.remaining_amount) && (
                <div className="rounded border-2 border-amber-300 bg-amber-50/60 dark:bg-amber-950/20 p-3 space-y-2">
                  <Label className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                    التعامل مع المتبقي ({fmtMoney(num(invoice?.remaining_amount) - Number(amount))})
                  </Label>
                  <div className="space-y-1 text-sm">
                    <label className="flex items-start gap-2 cursor-pointer p-2 rounded hover:bg-background/60">
                      <input type="radio" name="remainder" className="mt-1"
                        checked={remainderAction === "keep"}
                        onChange={() => setRemainderAction("keep")} />
                      <div>
                        <div className="font-medium">إبقاء المتبقي للتحصيل لاحقًا</div>
                        <div className="text-xs text-muted-foreground">يظل المتبقي مفتوحًا على نفس الفاتورة ويمكن تحصيله لاحقًا.</div>
                      </div>
                    </label>
                    <label className="flex items-start gap-2 cursor-pointer p-2 rounded hover:bg-background/60">
                      <input type="radio" name="remainder" className="mt-1"
                        checked={remainderAction === "carryover"}
                        onChange={() => setRemainderAction("carryover")} />
                      <div>
                        <div className="font-medium">ترحيل المتبقي للفاتورة القادمة</div>
                        <div className="text-xs text-muted-foreground">يُغلق المتبقي على هذه الفاتورة ويظهر تنبيه عند فتح فاتورة جديدة للعميل لإضافته إليها.</div>
                      </div>
                    </label>
                    <label className={`flex items-start gap-2 p-2 rounded hover:bg-background/60 ${canDiscount ? "cursor-pointer" : "opacity-50 cursor-not-allowed"}`}>
                      <input type="radio" name="remainder" className="mt-1"
                        disabled={!canDiscount}
                        checked={remainderAction === "discount"}
                        onChange={() => setRemainderAction("discount")} />
                      <div>
                        <div className="font-medium">خصم المتبقي بخصم معتمد {!canDiscount && <span className="text-xs text-red-600">(يتطلب صلاحية)</span>}</div>
                        <div className="text-xs text-muted-foreground">سيُفتح فورم الخصم بعد التحصيل لإدخال السبب واعتماده.</div>
                      </div>
                    </label>
                  </div>
                </div>
              )}
              <div>
                <Label>طريقة الدفع</Label>
                <Select value={method} onValueChange={setMethod}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">نقدي</SelectItem>
                    <SelectItem value="instapay">إنستاباي</SelectItem>
                    <SelectItem value="vodafone_cash">فودافون كاش</SelectItem>
                    <SelectItem value="bank_transfer">تحويل بنكي</SelectItem>
                    <SelectItem value="credit_balance">خصم من رصيد سابق (بدون خزنة)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>ملاحظات</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
              <p className="text-xs text-muted-foreground">
                {method === "credit_balance"
                  ? "لن يتم إنشاء أي حركة في خزنة المعمل — يُعتبر تحصيلًا من رصيد سابق فقط."
                  : "حركة الخزنة ستكون بالمبلغ المدفوع فعليًا فقط، وأي متبقٍ يظل مفتوحًا على الفاتورة لتحصيله لاحقًا."}
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPayOpen(false)} disabled={paying}>إلغاء</Button>
              <Button onClick={addPayment} disabled={paying}>{paying ? "جارٍ..." : "تأكيد التحصيل"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Discount dialog */}
        <Dialog open={discOpen} onOpenChange={setDiscOpen}>
          <DialogContent dir="rtl" className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Percent className="w-4 h-4 text-purple-600" />
                خصم / تسوية على فاتورة {invoice?.invoice_no}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="text-sm rounded bg-muted/40 p-2 space-y-1">
                <div>إجمالي الفاتورة: <b>{fmtMoney(invoice?.total_amount)}</b></div>
                <div>المدفوع: <b>{fmtMoney(invoice?.paid_amount)}</b> • الخصم الحالي: <b>{fmtMoney(invoice?.discount_amount)}</b></div>
                <div>المتبقي: <b className="text-primary">{fmtMoney(invoice?.remaining_amount)}</b></div>
              </div>
              <div>
                <Label>مبلغ الخصم</Label>
                <Input type="number" value={discAmount} onChange={(e) => setDiscAmount(e.target.value)} />
              </div>
              <div>
                <Label>سبب الخصم</Label>
                <Select value={discReason} onValueChange={setDiscReason}>
                  <SelectTrigger><SelectValue placeholder="اختر السبب..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="عميل دائم">عميل دائم</SelectItem>
                    <SelectItem value="مشكلة في الفقس">مشكلة في الفقس</SelectItem>
                    <SelectItem value="تسوية حساب">تسوية حساب</SelectItem>
                    <SelectItem value="عرض ترويجي">عرض ترويجي</SelectItem>
                    <SelectItem value="موافقة الإدارة">موافقة الإدارة</SelectItem>
                    <SelectItem value="أخرى">أخرى</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>ملاحظات</Label><Input value={discNotes} onChange={(e) => setDiscNotes(e.target.value)} /></div>
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                الخصم لا يؤثر على خزنة المعمل ولا يعتبر تحصيلًا. يحتاج صلاحية اعتماد خصومات.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDiscOpen(false)} disabled={savingDisc}>إلغاء</Button>
              <Button onClick={addDiscount} disabled={savingDisc || !canDiscount}>
                {savingDisc ? "جارٍ..." : "تأكيد الخصم"}
              </Button>
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
