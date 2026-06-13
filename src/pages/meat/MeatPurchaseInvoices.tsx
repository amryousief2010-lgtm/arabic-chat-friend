import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ShoppingCart, Plus, Trash2, CheckCircle2, XCircle, Printer, Loader2, Eye } from "lucide-react";

type Kind = "raw" | "spice" | "packaging";
type Item = { id: string; name: string; unit: string; current_stock: number; avg_cost: number; kind: Kind; is_active: boolean };
type Line = { tmp: string; raw_item_id: string; raw_item_name: string; kind: Kind; unit: string; quantity: number; unit_price: number; line_total: number; expiry_date: string | null; notes: string | null };
type Purchase = {
  id: string; invoice_no: string | null; purchase_date: string; supplier: string | null;
  invoice_type: string; payment_method: string; receipt_no: string | null;
  attachment_url: string | null; total_amount: number; status: string;
  notes: string | null; created_by: string | null; approved_by: string | null; approved_at: string | null;
  created_at: string;
};

const KIND_LABEL: Record<Kind,string> = { raw: "خامات", spice: "بهارات", packaging: "تغليف" };
const PAY_LABEL: Record<string,string> = { cash: "نقدي", credit: "آجل", transfer: "تحويل", other: "أخرى" };
const newLine = (): Line => ({ tmp: crypto.randomUUID(), raw_item_id: "", raw_item_name: "", kind: "raw", unit: "كجم", quantity: 0, unit_price: 0, line_total: 0, expiry_date: null, notes: null });
const esc = (s: any) => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
const fmt = (n: number) => Number(n || 0).toLocaleString("ar-EG", { maximumFractionDigits: 2 });

export default function MeatPurchaseInvoices() {
  const { user, roles } = useAuth();
  const isApprover = roles?.some(r => r === "general_manager" || r === "executive_manager");
  const [tab, setTab] = useState("new");
  const [items, setItems] = useState<Item[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(false);

  // form
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().slice(0,10));
  const [supplier, setSupplier] = useState("");
  const [invoiceType, setInvoiceType] = useState("mixed");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [receiptNo, setReceiptNo] = useState("");
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [saving, setSaving] = useState(false);
  const [purchaseUuid, setPurchaseUuid] = useState<string>(() => crypto.randomUUID());

  // view & actions
  const [viewing, setViewing] = useState<Purchase | null>(null);
  const [viewLines, setViewLines] = useState<any[]>([]);
  const [actLoading, setActLoading] = useState(false);

  // filters
  const [fStatus, setFStatus] = useState<string>("all");
  const [fSupplier, setFSupplier] = useState("");

  // new-item dialog (add a new raw item from inside the purchase invoice)
  const [newItemDlg, setNewItemDlg] = useState<{ open: boolean; lineTmp: string | null }>({ open: false, lineTmp: null });
  const [newItem, setNewItem] = useState({
    name: "", kind: "raw" as Kind, unit: "كجم", avg_cost: 0,
    low_stock_threshold: 0, expiry_date: "", notes: "",
  });
  const [savingItem, setSavingItem] = useState(false);

  const openNewItemDlg = (lineTmp: string) => {
    setNewItem({ name: "", kind: "raw", unit: "كجم", avg_cost: 0, low_stock_threshold: 0, expiry_date: "", notes: "" });
    setNewItemDlg({ open: true, lineTmp });
  };

  const saveNewItem = async () => {
    const name = newItem.name.trim();
    if (!name) { toast.error("أدخل اسم الصنف"); return; }
    const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
    const { data: existing } = await supabase
      .from("meat_factory_raw_items" as any)
      .select("id,name,unit,current_stock,avg_cost,kind,is_active")
      .eq("kind", newItem.kind);
    const dup = (existing as any[] | null)?.find(r => norm(r.name) === norm(name));
    if (dup) {
      const useExisting = window.confirm("هذا الصنف موجود بالفعل في مخزن خامات مصنع اللحوم.\nهل تريد استخدام الصنف الموجود؟");
      if (useExisting && newItemDlg.lineTmp) {
        setItems(prev => prev.some(p => p.id === dup.id) ? prev : [...prev, dup as Item]);
        updateLine(newItemDlg.lineTmp, { raw_item_id: dup.id });
        setNewItemDlg({ open: false, lineTmp: null });
      }
      return;
    }
    setSavingItem(true);
    try {
      const { data, error } = await supabase
        .from("meat_factory_raw_items" as any)
        .insert({
          name, kind: newItem.kind, unit: newItem.unit,
          avg_cost: Number(newItem.avg_cost || 0),
          low_stock_threshold: Number(newItem.low_stock_threshold || 0),
          notes: newItem.notes || null, is_active: true, current_stock: 0,
        } as any)
        .select("id,name,unit,current_stock,avg_cost,kind,is_active")
        .single();
      if (error) throw error;
      const created = data as any as Item;
      await supabase.from("meat_factory_audit_log" as any).insert({
        table_name: "meat_factory_raw_items",
        row_id: created.id,
        action: "create_from_purchase_invoice",
        new_value: {
          name: created.name, kind: created.kind, unit: created.unit,
          avg_cost: created.avg_cost, low_stock_threshold: newItem.low_stock_threshold,
          expiry_date: newItem.expiry_date || null, notes: newItem.notes || null,
          source: "meat_factory_purchase_invoice",
        },
        performed_by: user?.id || null,
      } as any);
      setItems(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name, "ar")));
      if (newItemDlg.lineTmp) updateLine(newItemDlg.lineTmp, { raw_item_id: created.id });
      toast.success("تم إضافة الصنف بنجاح");
      setNewItemDlg({ open: false, lineTmp: null });
    } catch (e: any) {
      toast.error(e.message || "فشل إضافة الصنف");
    } finally {
      setSavingItem(false);
    }
  };


  const refresh = async () => {
    setLoading(true);
    const [it, pr] = await Promise.all([
      supabase.from("meat_factory_raw_items" as any).select("id,name,unit,current_stock,avg_cost,kind,is_active").eq("is_active", true).order("name"),
      supabase.from("meat_factory_purchases" as any).select("*").order("created_at", { ascending: false }).limit(200),
    ]);
    if (it.data) setItems(it.data as any);
    if (pr.data) setPurchases(pr.data as any);
    setLoading(false);
  };
  useEffect(() => { refresh(); }, []);

  const itemsByKind = useMemo(() => items, [items]);

  const updateLine = (tmp: string, patch: Partial<Line>) => {
    setLines(ls => ls.map(l => {
      if (l.tmp !== tmp) return l;
      const m = { ...l, ...patch };
      if (patch.raw_item_id) {
        const it = items.find(x => x.id === patch.raw_item_id);
        if (it) { m.raw_item_name = it.name; m.unit = it.unit; m.kind = it.kind; if (!m.unit_price) m.unit_price = Number(it.avg_cost || 0); }
      }
      m.line_total = Number((Number(m.quantity || 0) * Number(m.unit_price || 0)).toFixed(3));
      return m;
    }));
  };
  const addLine = () => setLines(ls => [...ls, newLine()]);
  const removeLine = (tmp: string) => setLines(ls => ls.filter(l => l.tmp !== tmp));

  const total = useMemo(() => lines.reduce((s,l) => s + Number(l.line_total || 0), 0), [lines]);

  const resetForm = () => {
    setLines([newLine()]); setSupplier(""); setReceiptNo(""); setAttachmentUrl(""); setNotes("");
    setInvoiceType("mixed"); setPaymentMethod("cash"); setPurchaseUuid(crypto.randomUUID());
    setPurchaseDate(new Date().toISOString().slice(0,10));
  };

  const submit = async () => {
    const valid = lines.filter(l => l.raw_item_id && l.quantity > 0 && l.unit_price >= 0);
    if (valid.length === 0) { toast.error("أضف على الأقل سطر واحد بصنف وكمية"); return; }
    if (!supplier.trim()) { toast.error("أدخل اسم المورد"); return; }
    setSaving(true);
    try {
      // Idempotency: if a purchase with same purchaseUuid already exists, fetch it instead of inserting twice
      const existing = await supabase.from("meat_factory_purchases" as any).select("id, invoice_no, status").eq("purchase_invoice_uuid", purchaseUuid).maybeSingle();
      if (existing.data) {
        toast.info("الفاتورة محفوظة بالفعل");
        await refresh();
        resetForm();
        setTab("list");
        return;
      }
      const { data: p, error } = await supabase.from("meat_factory_purchases" as any).insert({
        purchase_date: purchaseDate,
        supplier: supplier.trim(),
        invoice_type: invoiceType,
        payment_method: paymentMethod,
        receipt_no: receiptNo || null,
        attachment_url: attachmentUrl || null,
        notes: notes || null,
        total_amount: total,
        status: "draft",
        purchase_invoice_uuid: purchaseUuid,
        created_by: user?.id || null,
      } as any).select("id").single();
      if (error) throw error;
      const purchaseId = (p as any).id;
      const { error: lErr } = await supabase.from("meat_factory_purchase_lines" as any).insert(
        valid.map(l => ({
          purchase_id: purchaseId,
          raw_item_id: l.raw_item_id,
          raw_item_name: l.raw_item_name,
          kind: l.kind,
          unit: l.unit,
          quantity: l.quantity,
          unit_price: l.unit_price,
          line_total: l.line_total,
          expiry_date: l.expiry_date,
          notes: l.notes,
        })) as any
      );
      if (lErr) throw lErr;
      toast.success("تم حفظ الفاتورة بحالة 'مسودة' بانتظار اعتماد المدير");
      resetForm();
      await refresh();
      setTab("list");
    } catch (e: any) {
      toast.error(e.message || "فشل الحفظ");
    } finally {
      setSaving(false);
    }
  };

  const openView = async (p: Purchase) => {
    setViewing(p);
    const { data } = await supabase.from("meat_factory_purchase_lines" as any).select("*").eq("purchase_id", p.id).order("created_at");
    setViewLines(data || []);
  };

  const approve = async (id: string) => {
    if (!isApprover) { toast.error("الاعتماد متاح للمدير العام أو التنفيذي فقط"); return; }
    setActLoading(true);
    const { error } = await supabase.rpc("approve_meat_purchase" as any, { p_purchase_id: id });
    setActLoading(false);
    if (error) { toast.error(error.message); return; }
    toast.success("تم اعتماد الفاتورة وزيادة المخزون");
    setViewing(null);
    await refresh();
  };

  const reject = async (id: string) => {
    if (!isApprover) { toast.error("الرفض متاح للمدير العام أو التنفيذي فقط"); return; }
    const reason = window.prompt("سبب الرفض؟");
    if (reason === null) return;
    setActLoading(true);
    const { error } = await supabase.rpc("reject_meat_purchase" as any, { p_purchase_id: id, p_reason: reason });
    setActLoading(false);
    if (error) { toast.error(error.message); return; }
    toast.success("تم رفض الفاتورة");
    setViewing(null);
    await refresh();
  };

  const printInvoice = async (p: Purchase) => {
    const { data: ls } = await supabase.from("meat_factory_purchase_lines" as any).select("*").eq("purchase_id", p.id).order("created_at");
    const rows = (ls || []).map((l: any) => `
      <tr>
        <td>${esc(l.raw_item_name)}</td>
        <td>${esc(KIND_LABEL[(l.kind as Kind) || "raw"])}</td>
        <td>${esc(l.unit || "")}</td>
        <td>${fmt(l.quantity)}</td>
        <td>${fmt(l.unit_price)}</td>
        <td>${fmt(l.line_total)}</td>
        <td>${l.expiry_date ? esc(l.expiry_date) : "—"}</td>
      </tr>`).join("");
    const total = (ls || []).reduce((s: number, x: any) => s + Number(x.line_total || 0), 0);
    const w = window.open("", "_blank", "width=950,height=720");
    if (!w) return toast.error("فعّل النوافذ المنبثقة للطباعة");
    w.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"/><title>فاتورة مشتريات ${esc(p.invoice_no || "")}</title>
      <style>*{box-sizing:border-box;font-family:'Cairo','Tajawal',Arial,sans-serif}body{padding:24px;color:#111}
      h1{margin:0 0 4px;font-size:20px}.meta{color:#555;font-size:13px;margin-bottom:14px}
      table{width:100%;border-collapse:collapse;margin-top:10px}
      th,td{border:1px solid #ccc;padding:6px 8px;font-size:13px;text-align:right}
      th{background:#fee2e2}tfoot td{font-weight:bold;background:#fafafa}
      .header{display:flex;justify-content:space-between;border-bottom:2px solid #dc2626;padding-bottom:10px;margin-bottom:14px}
      .brand{color:#dc2626;font-weight:bold;font-size:22px}
      .signs{display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px;margin-top:60px;text-align:center}
      .signs div{border-top:1px solid #999;padding-top:6px;font-size:13px}
      @media print{button{display:none}}</style></head><body>
      <div class="header"><div class="brand">نعام العاصمة</div><div>فاتورة مشتريات مصنع اللحوم</div></div>
      <div class="meta">
        <div><b>رقم الفاتورة:</b> ${esc(p.invoice_no || "— لم تُعتمد —")}</div>
        <div><b>التاريخ:</b> ${esc(p.purchase_date)}</div>
        <div><b>المورد:</b> ${esc(p.supplier || "")}</div>
        <div><b>نوع الفاتورة:</b> ${esc(KIND_LABEL[(p.invoice_type as Kind)] || p.invoice_type)}</div>
        <div><b>طريقة الدفع:</b> ${esc(PAY_LABEL[p.payment_method] || p.payment_method)}</div>
        <div><b>رقم الإيصال:</b> ${esc(p.receipt_no || "—")}</div>
        <div><b>الحالة:</b> ${esc(p.status)}</div>
      </div>
      <table><thead><tr><th>الصنف</th><th>القسم</th><th>الوحدة</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th><th>الصلاحية</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="5">الإجمالي</td><td colspan="2">${fmt(total)} جنيه</td></tr></tfoot></table>
      ${p.notes ? `<div style="margin-top:14px"><b>ملاحظات:</b> ${esc(p.notes)}</div>` : ""}
      <div class="signs"><div>مسؤول مصنع اللحوم</div><div>مشرف المخزن</div><div>المدير المعتمد</div></div>
      <div style="text-align:center;margin-top:18px"><button onclick="window.print()" style="padding:8px 22px;background:#dc2626;color:#fff;border:0;border-radius:6px;cursor:pointer">طباعة</button></div>
      </body></html>`);
    w.document.close();
  };

  const filtered = useMemo(() => purchases.filter(p =>
    (fStatus === "all" || p.status === fStatus) &&
    (!fSupplier || (p.supplier || "").includes(fSupplier))
  ), [purchases, fStatus, fSupplier]);

  const statusBadge = (s: string) => {
    if (s === "draft") return <Badge variant="outline">مسودة</Badge>;
    if (s === "approved") return <Badge className="bg-emerald-600">معتمدة</Badge>;
    if (s === "rejected") return <Badge variant="destructive">مرفوضة</Badge>;
    if (s === "cancelled") return <Badge variant="secondary">ملغاة</Badge>;
    return <Badge>{s}</Badge>;
  };

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-4" dir="rtl">
        <div className="flex items-center gap-3">
          <ShoppingCart className="w-7 h-7 text-red-600" />
          <div>
            <h1 className="text-2xl font-bold">فاتورة مشتريات مصنع اللحوم</h1>
            <p className="text-sm text-muted-foreground">شراء الخامات والبهارات وخامات التغليف. المخزون لا يزيد إلا بعد اعتماد المدير العام أو التنفيذي.</p>
          </div>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="new">فاتورة جديدة</TabsTrigger>
            <TabsTrigger value="list">سجل الفواتير ({purchases.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="new" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">بيانات الفاتورة</CardTitle>
                <CardDescription>الحفظ ينشئ فاتورة بحالة "مسودة" — لا تؤثر على المخزون إلا بعد الاعتماد.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div><Label>التاريخ</Label><Input type="date" value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)} /></div>
                  <div><Label>المورد</Label><Input value={supplier} onChange={e => setSupplier(e.target.value)} placeholder="اسم المورد" /></div>
                  <div>
                    <Label>نوع الفاتورة</Label>
                    <Select value={invoiceType} onValueChange={setInvoiceType}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="raw">خامات تصنيع</SelectItem>
                        <SelectItem value="spice">بهارات</SelectItem>
                        <SelectItem value="packaging">خامات تغليف</SelectItem>
                        <SelectItem value="mixed">مختلطة</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>طريقة الدفع</Label>
                    <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cash">نقدي</SelectItem>
                        <SelectItem value="credit">آجل</SelectItem>
                        <SelectItem value="transfer">تحويل</SelectItem>
                        <SelectItem value="other">أخرى</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>رقم الإيصال</Label><Input value={receiptNo} onChange={e => setReceiptNo(e.target.value)} /></div>
                  <div className="md:col-span-3"><Label>رابط مرفق صورة الفاتورة</Label><Input value={attachmentUrl} onChange={e => setAttachmentUrl(e.target.value)} placeholder="https://…" /></div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">أصناف الفاتورة</h3>
                    <Button onClick={addLine} size="sm" variant="outline"><Plus className="w-4 h-4 ml-1" /> إضافة سطر</Button>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>الصنف</TableHead>
                        <TableHead>القسم</TableHead>
                        <TableHead>الوحدة</TableHead>
                        <TableHead>الكمية</TableHead>
                        <TableHead>سعر الوحدة</TableHead>
                        <TableHead>الإجمالي</TableHead>
                        <TableHead>الصلاحية</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lines.map(l => {
                        const it = items.find(x => x.id === l.raw_item_id);
                        return (
                          <TableRow key={l.tmp}>
                            <TableCell className="min-w-[220px]">
                              <Select value={l.raw_item_id} onValueChange={v => updateLine(l.tmp, { raw_item_id: v })}>
                                <SelectTrigger><SelectValue placeholder="اختر صنف" /></SelectTrigger>
                                <SelectContent className="max-h-80">
                                  {itemsByKind.map(r => (
                                    <SelectItem key={r.id} value={r.id}>
                                      <span className="text-xs text-muted-foreground ml-2">[{KIND_LABEL[r.kind]}]</span>
                                      {r.name} ({r.unit})
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell><Badge variant="outline">{KIND_LABEL[l.kind]}</Badge></TableCell>
                            <TableCell>{l.unit}</TableCell>
                            <TableCell><Input type="number" step="0.01" className="w-24" value={l.quantity || ""} onChange={e => updateLine(l.tmp, { quantity: Number(e.target.value) })} /></TableCell>
                            <TableCell><Input type="number" step="0.01" className="w-28" value={l.unit_price || ""} onChange={e => updateLine(l.tmp, { unit_price: Number(e.target.value) })} /></TableCell>
                            <TableCell className="font-medium">{fmt(l.line_total)}</TableCell>
                            <TableCell><Input type="date" className="w-36" value={l.expiry_date || ""} onChange={e => updateLine(l.tmp, { expiry_date: e.target.value || null })} /></TableCell>
                            <TableCell><Button size="icon" variant="ghost" onClick={() => removeLine(l.tmp)}><Trash2 className="w-4 h-4 text-red-600" /></Button></TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                  <div className="text-left text-sm">
                    <span className="text-muted-foreground">إجمالي الفاتورة: </span>
                    <span className="font-bold text-lg">{fmt(total)} جنيه</span>
                  </div>
                </div>

                <div><Label>ملاحظات</Label><Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="اختياري" /></div>

                <div className="flex justify-end">
                  <Button onClick={submit} disabled={saving} className="bg-red-600 hover:bg-red-700">
                    {saving ? <Loader2 className="w-4 h-4 ml-1 animate-spin" /> : <CheckCircle2 className="w-4 h-4 ml-1" />}
                    حفظ الفاتورة (مسودة)
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="list" className="space-y-3">
            <Card>
              <CardContent className="pt-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                  <div>
                    <Label>الحالة</Label>
                    <Select value={fStatus} onValueChange={setFStatus}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">الكل</SelectItem>
                        <SelectItem value="draft">مسودة</SelectItem>
                        <SelectItem value="approved">معتمدة</SelectItem>
                        <SelectItem value="rejected">مرفوضة</SelectItem>
                        <SelectItem value="cancelled">ملغاة</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>المورد</Label><Input value={fSupplier} onChange={e => setFSupplier(e.target.value)} placeholder="بحث" /></div>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>رقم الفاتورة</TableHead>
                      <TableHead>التاريخ</TableHead>
                      <TableHead>المورد</TableHead>
                      <TableHead>النوع</TableHead>
                      <TableHead>الدفع</TableHead>
                      <TableHead>الإجمالي</TableHead>
                      <TableHead>الحالة</TableHead>
                      <TableHead>إجراءات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.length === 0 ? (
                      <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">لا توجد فواتير</TableCell></TableRow>
                    ) : filtered.map(p => (
                      <TableRow key={p.id}>
                        <TableCell className="font-mono text-xs">{p.invoice_no || "—"}</TableCell>
                        <TableCell>{p.purchase_date}</TableCell>
                        <TableCell>{p.supplier}</TableCell>
                        <TableCell>{KIND_LABEL[p.invoice_type as Kind] || p.invoice_type}</TableCell>
                        <TableCell>{PAY_LABEL[p.payment_method] || p.payment_method}</TableCell>
                        <TableCell className="font-medium">{fmt(p.total_amount)}</TableCell>
                        <TableCell>{statusBadge(p.status)}</TableCell>
                        <TableCell className="space-x-1 space-x-reverse">
                          <Button size="sm" variant="outline" onClick={() => openView(p)}><Eye className="w-3 h-3 ml-1" />عرض</Button>
                          <Button size="sm" variant="outline" onClick={() => printInvoice(p)}><Printer className="w-3 h-3 ml-1" />طباعة</Button>
                          {isApprover && p.status === "draft" && (
                            <>
                              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => approve(p.id)}><CheckCircle2 className="w-3 h-3 ml-1" />اعتماد</Button>
                              <Button size="sm" variant="destructive" onClick={() => reject(p.id)}><XCircle className="w-3 h-3 ml-1" />رفض</Button>
                            </>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Dialog open={!!viewing} onOpenChange={(v) => !v && setViewing(null)}>
          <DialogContent className="max-w-3xl" dir="rtl">
            <DialogHeader>
              <DialogTitle>تفاصيل فاتورة {viewing?.invoice_no || "—"}</DialogTitle>
            </DialogHeader>
            {viewing && (
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-3 gap-2">
                  <div><b>التاريخ:</b> {viewing.purchase_date}</div>
                  <div><b>المورد:</b> {viewing.supplier}</div>
                  <div><b>النوع:</b> {KIND_LABEL[viewing.invoice_type as Kind] || viewing.invoice_type}</div>
                  <div><b>الدفع:</b> {PAY_LABEL[viewing.payment_method] || viewing.payment_method}</div>
                  <div><b>الإيصال:</b> {viewing.receipt_no || "—"}</div>
                  <div><b>الحالة:</b> {statusBadge(viewing.status)}</div>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>الصنف</TableHead><TableHead>القسم</TableHead><TableHead>الوحدة</TableHead><TableHead>الكمية</TableHead><TableHead>السعر</TableHead><TableHead>الإجمالي</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {viewLines.map((l: any) => (
                      <TableRow key={l.id}>
                        <TableCell>{l.raw_item_name}</TableCell>
                        <TableCell>{KIND_LABEL[(l.kind as Kind) || "raw"]}</TableCell>
                        <TableCell>{l.unit}</TableCell>
                        <TableCell>{fmt(l.quantity)}</TableCell>
                        <TableCell>{fmt(l.unit_price)}</TableCell>
                        <TableCell>{fmt(l.line_total)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="text-left"><b>الإجمالي:</b> {fmt(viewing.total_amount)} جنيه</div>
                {viewing.notes && <div><b>ملاحظات:</b> {viewing.notes}</div>}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => viewing && printInvoice(viewing)}><Printer className="w-4 h-4 ml-1" />طباعة</Button>
              {isApprover && viewing?.status === "draft" && (
                <>
                  <Button variant="destructive" onClick={() => viewing && reject(viewing.id)} disabled={actLoading}><XCircle className="w-4 h-4 ml-1" />رفض</Button>
                  <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => viewing && approve(viewing.id)} disabled={actLoading}>{actLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4 ml-1" />}اعتماد</Button>
                </>
              )}
              <Button variant="outline" onClick={() => setViewing(null)}>إغلاق</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
