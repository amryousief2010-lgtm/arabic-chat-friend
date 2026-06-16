import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Plus, Printer, Undo2 } from "lucide-react";
import { toast } from "sonner";

const fmt = (n: any) => Number(n || 0).toLocaleString("ar-EG", { maximumFractionDigits: 2 });
const esc = (s: any) => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

const EXPENSE_TYPES = [
  { v: "transport", l: "نقل علف", k: "transport_expense" },
  { v: "tobacco", l: "دخان تنزيل علف", k: "tobacco_expense" },
  { v: "loading_labor", l: "عمالة تحميل", k: "general_expense" },
  { v: "car_rent", l: "أجرة سيارة", k: "transport_expense" },
  { v: "electricity", l: "كهرباء تشغيل", k: "general_expense" },
  { v: "maintenance", l: "صيانة مرتبطة بالتصنيع", k: "general_expense" },
  { v: "other", l: "مصروفات أخرى", k: "other" },
];

export function printInvoice(inv: any, items: any[], expenses: any[]) {
  const itemsRows = items.map((it: any) => `<tr>
    <td>${esc(it.feed_raw_materials?.name || "-")}</td>
    <td>${fmt(it.quantity)} ${esc(it.feed_raw_materials?.unit || "كجم")}</td>
    <td>${fmt(it.unit_cost)}</td>
    <td>${fmt(it.line_cost)}</td></tr>`).join("");
  const expRows = expenses.filter(e=>e.status==='active').map(e => `<tr>
    <td>${esc(EXPENSE_TYPES.find(t=>t.v===e.expense_type)?.l || e.expense_type)}</td>
    <td>${esc(e.description||'-')}</td>
    <td>${fmt(e.amount)}</td>
    <td>${e.paid_from_treasury ? 'نعم' : 'لا'}</td>
    <td>${esc(e.expense_date)}</td></tr>`).join("");
  const itemsTotal = items.reduce((s, i) => s + Number(i.line_cost || 0), 0);
  const expTotal = expenses.filter(e=>e.status==='active').reduce((s, e) => s + Number(e.amount || 0), 0);
  const labor = Number(inv.labor_cost || 0);
  const total = itemsTotal + expTotal + labor;
  const perKg = inv.qty_produced > 0 ? total / Number(inv.qty_produced) : 0;

  const html = `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"/>
  <title>فاتورة تصنيع ${esc(inv.prod_no)}</title>
  <style>
    *{box-sizing:border-box;font-family:'Cairo','Tajawal',Arial,sans-serif}
    body{padding:20px;color:#111}
    .header{display:flex;justify-content:space-between;border-bottom:2px solid #7c3aed;padding-bottom:10px;margin-bottom:14px}
    .brand{color:#7c3aed;font-weight:bold;font-size:22px}
    table{width:100%;border-collapse:collapse;margin:8px 0 14px}
    th,td{border:1px solid #ccc;padding:6px 8px;font-size:13px;text-align:right}
    th{background:#f3f0ff}
    tfoot td{font-weight:bold;background:#fafafa}
    h3{margin:12px 0 4px;color:#7c3aed;font-size:15px}
    .totals{margin-top:12px;border:2px solid #7c3aed;padding:10px;border-radius:6px}
    .totals div{display:flex;justify-content:space-between;padding:4px 0}
    .totals .grand{font-size:16px;font-weight:bold;border-top:1px dashed #999;margin-top:6px;padding-top:6px}
    .sig{margin-top:36px;display:flex;justify-content:space-between;font-size:13px}
    @media print{button{display:none}}
  </style></head><body>
    <div class="header">
      <div><div class="brand">نعام العاصمة</div><div>فاتورة تصنيع أعلاف</div></div>
      <div style="text-align:left">
        <div><b>رقم:</b> ${esc(inv.prod_no)}</div>
        <div><b>التاريخ:</b> ${esc(inv.prod_date)}</div>
        <div><b>المنتج:</b> ${esc(inv.feed_products?.name || '-')}</div>
        <div><b>الكمية:</b> ${fmt(inv.qty_produced)} كجم</div>
      </div>
    </div>

    <h3>خامات التصنيع</h3>
    <table><thead><tr><th>الخامة</th><th>الكمية</th><th>سعر الوحدة</th><th>إجمالي</th></tr></thead>
    <tbody>${itemsRows || '<tr><td colspan="4" style="text-align:center">لا توجد خامات</td></tr>'}</tbody>
    <tfoot><tr><td colspan="3">إجمالي الخامات</td><td>${fmt(itemsTotal)} ج.م</td></tr></tfoot></table>

    <h3>مصروفات التصنيع الإضافية</h3>
    <table><thead><tr><th>النوع</th><th>البيان</th><th>المبلغ</th><th>من خزنة؟</th><th>التاريخ</th></tr></thead>
    <tbody>${expRows || '<tr><td colspan="5" style="text-align:center">لا توجد مصروفات إضافية</td></tr>'}</tbody>
    <tfoot><tr><td colspan="2">إجمالي المصروفات</td><td colspan="3">${fmt(expTotal)} ج.م</td></tr></tfoot></table>

    <div class="totals">
      <div><span>إجمالي الخامات</span><b>${fmt(itemsTotal)} ج.م</b></div>
      <div><span>أجرة التصنيع</span><b>${fmt(labor)} ج.م</b></div>
      <div><span>إجمالي المصروفات الإضافية</span><b>${fmt(expTotal)} ج.م</b></div>
      <div class="grand"><span>إجمالي تكلفة التصنيع</span><b>${fmt(total)} ج.م</b></div>
      <div class="grand"><span>تكلفة الكيلو</span><b>${fmt(perKg)} ج/كجم</b></div>
    </div>

    ${inv.notes ? `<div style="margin-top:10px"><b>ملاحظات:</b> ${esc(inv.notes)}</div>` : ''}

    <div class="sig">
      <div>توقيع مسؤول مصنع العلف: ____________</div>
      <div>توقيع الحسابات: ____________</div>
      <div>توقيع المدير المعتمد: ____________</div>
    </div>
    <div style="text-align:center;margin-top:18px"><button onclick="window.print()" style="padding:8px 22px;background:#7c3aed;color:#fff;border:0;border-radius:6px;cursor:pointer">طباعة</button></div>
  </body></html>`;
  const w = window.open("", "_blank", "width=900,height=700");
  if (!w) return toast.error("فعّل النوافذ المنبثقة للطباعة");
  w.document.write(html);
  w.document.close();
}

export default function FeedInvoiceDetailsDialog({
  open, onOpenChange, invoice,
}: { open: boolean; onOpenChange: (v: boolean) => void; invoice: any | null }) {
  const qc = useQueryClient();
  const { roles } = useAuth();
  const canAddExpense = roles.some(r => ["general_manager","executive_manager","feed_factory_manager","warehouse_supervisor","financial_manager","accountant","cost_accountant"].includes(r));
  const canReverse = roles.some(r => ["general_manager","executive_manager"].includes(r));
  const [addOpen, setAddOpen] = useState(false);

  const expQ = useQuery({
    queryKey: ["feed-inv-expenses", invoice?.id],
    enabled: !!invoice?.id && open,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("feed_production_invoice_expenses")
        .select("*").eq("invoice_id", invoice.id).order("created_at", { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });

  // refresh invoice (totals updated by trigger) when expenses change
  const invQ = useQuery({
    queryKey: ["feed-inv-detail", invoice?.id],
    enabled: !!invoice?.id && open,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("feed_production_invoices")
        .select("*, feed_products(name,stage), feed_production_invoice_items(*, feed_raw_materials(name,unit))")
        .eq("id", invoice.id).single();
      if (error) throw error;
      return data;
    },
  });

  const inv = invQ.data || invoice;
  const items = inv?.feed_production_invoice_items || [];
  const expenses = expQ.data || [];

  const itemsTotal = useMemo(() => items.reduce((s: number, i: any) => s + Number(i.line_cost || 0), 0), [items]);
  const expTotal = useMemo(() => expenses.filter((e:any)=>e.status==='active').reduce((s: number, e: any) => s + Number(e.amount || 0), 0), [expenses]);
  const labor = Number(inv?.labor_cost || 0);
  const total = itemsTotal + expTotal + labor;
  const perKg = inv && Number(inv.qty_produced) > 0 ? total / Number(inv.qty_produced) : 0;

  const reverseExp = async (e: any) => {
    const r = window.prompt("سبب عكس المصروف؟");
    if (!r || r.trim().length < 3) return;
    const { error } = await (supabase as any).rpc("reverse_feed_invoice_expense", { p_expense_id: e.id, p_reason: r });
    if (error) return toast.error(error.message);
    toast.success("تم عكس المصروف");
    qc.invalidateQueries({ queryKey: ["feed-inv-expenses", invoice.id] });
    qc.invalidateQueries({ queryKey: ["feed-inv-detail", invoice.id] });
    qc.invalidateQueries({ queryKey: ["feed-prod-invoices"] });
    qc.invalidateQueries({ queryKey: ["feed-treasury"] });
  };

  if (!invoice) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-5xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-2 flex-wrap">
            <span>تفاصيل فاتورة تصنيع — {inv?.prod_no}</span>
            <div className="flex gap-2">
              {canAddExpense && (
                <Button size="sm" onClick={() => setAddOpen(true)}>
                  <Plus className="h-4 w-4 ml-1" />إضافة مصروف على التصنيع
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => printInvoice(inv, items, expenses)}>
                <Printer className="h-4 w-4 ml-1" />طباعة
              </Button>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm bg-muted/40 p-3 rounded">
          <div><b>التاريخ:</b> {inv?.prod_date}</div>
          <div><b>المنتج:</b> {inv?.feed_products?.name} <Badge variant="outline" className="text-[10px] mr-1">{inv?.feed_products?.stage}</Badge></div>
          <div><b>الكمية المنتجة:</b> {fmt(inv?.qty_produced)} كجم</div>
          <div><b>عدد الشكاير:</b> {fmt(inv?.bags)}</div>
          <div><b>أجرة التصنيع:</b> {fmt(labor)} ج.م</div>
          <div className="col-span-2"><b>ملاحظات:</b> {inv?.notes || "—"}</div>
        </div>

        <div>
          <div className="font-bold mb-2">خامات التصنيع</div>
          <Table>
            <TableHeader><TableRow><TableHead>الخامة</TableHead><TableHead>الكمية</TableHead><TableHead>الوحدة</TableHead><TableHead>سعر الوحدة</TableHead><TableHead>الإجمالي</TableHead></TableRow></TableHeader>
            <TableBody>
              {items.map((it: any) => (
                <TableRow key={it.id}>
                  <TableCell>{it.feed_raw_materials?.name}</TableCell>
                  <TableCell>{fmt(it.quantity)}</TableCell>
                  <TableCell>{it.feed_raw_materials?.unit || "كجم"}</TableCell>
                  <TableCell>{fmt(it.unit_cost)}</TableCell>
                  <TableCell className="font-bold">{fmt(it.line_cost)}</TableCell>
                </TableRow>
              ))}
              {!items.length && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">لا توجد خامات</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>

        <div>
          <div className="font-bold mb-2">مصروفات التصنيع الإضافية</div>
          <Table>
            <TableHeader><TableRow><TableHead>النوع</TableHead><TableHead>البيان</TableHead><TableHead>المبلغ</TableHead><TableHead>مدفوع من خزنة؟</TableHead><TableHead>التاريخ</TableHead><TableHead>الحالة</TableHead>{canReverse && <TableHead></TableHead>}</TableRow></TableHeader>
            <TableBody>
              {expenses.map((e: any) => (
                <TableRow key={e.id} className={e.status === 'reversed' ? 'opacity-50 line-through' : ''}>
                  <TableCell>{EXPENSE_TYPES.find(t => t.v === e.expense_type)?.l || e.expense_type}</TableCell>
                  <TableCell>{e.description || "—"}</TableCell>
                  <TableCell className="font-bold">{fmt(e.amount)} ج.م</TableCell>
                  <TableCell>{e.paid_from_treasury ? <Badge>نعم</Badge> : <Badge variant="outline">لا</Badge>}</TableCell>
                  <TableCell>{e.expense_date}</TableCell>
                  <TableCell>{e.status === 'reversed' ? <Badge variant="destructive">معكوس</Badge> : <Badge variant="secondary">نشط</Badge>}</TableCell>
                  {canReverse && <TableCell>{e.status === 'active' && <Button size="sm" variant="ghost" onClick={() => reverseExp(e)}><Undo2 className="h-4 w-4" /></Button>}</TableCell>}
                </TableRow>
              ))}
              {!expenses.length && <TableRow><TableCell colSpan={canReverse ? 7 : 6} className="text-center text-muted-foreground">لا توجد مصروفات</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>

        <div className="border-2 border-primary rounded p-3 space-y-1 text-sm">
          <div className="flex justify-between"><span>إجمالي الخامات</span><b>{fmt(itemsTotal)} ج.م</b></div>
          <div className="flex justify-between"><span>أجرة التصنيع</span><b>{fmt(labor)} ج.م</b></div>
          <div className="flex justify-between"><span>إجمالي المصروفات الإضافية</span><b>{fmt(expTotal)} ج.م</b></div>
          <div className="flex justify-between border-t pt-2 text-base"><span>إجمالي تكلفة التصنيع</span><b>{fmt(total)} ج.م</b></div>
          <div className="flex justify-between text-base"><span>تكلفة الكيلو</span><b>{fmt(perKg)} ج/كجم</b></div>
        </div>

        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>إغلاق</Button></DialogFooter>

        <AddExpenseDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          invoiceId={invoice.id}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["feed-inv-expenses", invoice.id] });
            qc.invalidateQueries({ queryKey: ["feed-inv-detail", invoice.id] });
            qc.invalidateQueries({ queryKey: ["feed-prod-invoices"] });
            qc.invalidateQueries({ queryKey: ["feed-treasury"] });
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function AddExpenseDialog({ open, onOpenChange, invoiceId, onSaved }:
  { open: boolean; onOpenChange: (v: boolean) => void; invoiceId: string; onSaved: () => void }) {
  const [type, setType] = useState("transport");
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState<number>(0);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [payMethod, setPayMethod] = useState("");
  const [fromTreasury, setFromTreasury] = useState(false);
  const [notes, setNotes] = useState("");
  const [receipt, setReceipt] = useState("");
  const [saving, setSaving] = useState(false);

  const reset = () => { setType("transport"); setDesc(""); setAmount(0); setPayMethod(""); setFromTreasury(false); setNotes(""); setReceipt(""); };

  const save = async () => {
    if (!amount || amount <= 0) return toast.error("أدخل مبلغ صحيح");
    setSaving(true);
    try {
      const kind = EXPENSE_TYPES.find(t => t.v === type)?.k || "general_expense";
      const { error } = await (supabase as any).rpc("add_feed_invoice_expense", {
        p_invoice_id: invoiceId,
        p_expense_type: type,
        p_description: desc || null,
        p_amount: amount,
        p_expense_date: date,
        p_payment_method: payMethod || null,
        p_paid_from_treasury: fromTreasury,
        p_treasury_kind: kind,
        p_receipt_url: receipt || null,
        p_notes: notes || null,
        p_reference_id: null,
      });
      if (error) throw error;
      toast.success("تم إضافة المصروف");
      reset(); onSaved(); onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || "فشل الحفظ");
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-xl">
        <DialogHeader><DialogTitle>إضافة مصروف على التصنيع</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><Label>نوع المصروف</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{EXPENSE_TYPES.map(t => <SelectItem key={t.v} value={t.v}>{t.l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="col-span-2"><Label>البيان</Label><Input value={desc} onChange={e => setDesc(e.target.value)} placeholder="مثال: نقل علف من المصنع إلى المجزر" /></div>
          <div><Label>المبلغ (ج.م)</Label><Input type="number" value={amount || ""} onChange={e => setAmount(Number(e.target.value))} /></div>
          <div><Label>التاريخ</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
          <div><Label>طريقة الدفع</Label><Input value={payMethod} onChange={e => setPayMethod(e.target.value)} placeholder="نقدي / تحويل" /></div>
          <div className="flex items-end gap-2"><Switch checked={fromTreasury} onCheckedChange={setFromTreasury} id="ft" /><Label htmlFor="ft">دفع من خزنة مصنع العلف</Label></div>
          <div className="col-span-2"><Label>مرفق إيصال (URL)</Label><Input value={receipt} onChange={e => setReceipt(e.target.value)} placeholder="اختياري" /></div>
          <div className="col-span-2"><Label>ملاحظات</Label><Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button onClick={save} disabled={saving}>{saving ? "..." : "حفظ المصروف"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
