import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Plus, CheckCircle2, XCircle, FileText } from "lucide-react";

type Status = "draft" | "approved" | "cancelled";

interface Return {
  id: string;
  return_no: string;
  return_date: string;
  customer: string;
  original_sale_id: string | null;
  original_sale_no: string | null;
  feed_product_id: string;
  quantity_kg: number;
  unit_price: number;
  total_amount: number;
  reason: string | null;
  notes: string | null;
  treasury_account: string;
  status: Status;
  approved_at: string | null;
  approved_by: string | null;
  created_by: string | null;
  created_at: string;
}

const statusBadge = (s: Status) => {
  if (s === "approved") return <Badge className="bg-green-600">معتمد</Badge>;
  if (s === "cancelled") return <Badge variant="destructive">ملغي</Badge>;
  return <Badge variant="secondary">مسودة</Badge>;
};

const fmt = (n: number) => new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 2 }).format(n || 0);

export default function FeedSalesReturns() {
  const { roles, role } = useAuth();
  const userRoles = roles?.length ? roles : (role ? [role] : []);
  const isManager = userRoles.includes("general_manager") || userRoles.includes("executive_manager");

  const [rows, setRows] = useState<Return[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [sales, setSales] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [openForm, setOpenForm] = useState(false);
  const [editing, setEditing] = useState<Return | null>(null);

  // filters
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");
  const [fCustomer, setFCustomer] = useState("");
  const [fProduct, setFProduct] = useState("all");
  const [fStatus, setFStatus] = useState<"all" | Status>("all");

  const load = async () => {
    setLoading(true);
    const [r, p, s] = await Promise.all([
      (supabase as any).from("feed_sales_returns").select("*").order("return_date", { ascending: false }).order("created_at", { ascending: false }).limit(500),
      supabase.from("feed_products").select("id,name,selling_price,current_stock,default_bag_kg").order("name"),
      supabase.from("feed_sales").select("id,sale_no,customer,sale_date").order("sale_date", { ascending: false }).limit(200),
    ]);
    if (r.error) toast.error(r.error.message); else setRows(r.data || []);
    if (!p.error) setProducts(p.data || []);
    if (!s.error) setSales(s.data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => rows.filter((r) => {
    if (fFrom && r.return_date < fFrom) return false;
    if (fTo && r.return_date > fTo) return false;
    if (fCustomer && !r.customer?.toLowerCase().includes(fCustomer.toLowerCase())) return false;
    if (fProduct !== "all" && r.feed_product_id !== fProduct) return false;
    if (fStatus !== "all" && r.status !== fStatus) return false;
    return true;
  }), [rows, fFrom, fTo, fCustomer, fProduct, fStatus]);

  const totals = useMemo(() => {
    const t = { count: filtered.length, qty: 0, amount: 0, approved: 0 };
    filtered.forEach(r => {
      t.qty += Number(r.quantity_kg || 0);
      t.amount += Number(r.total_amount || 0);
      if (r.status === "approved") t.approved += 1;
    });
    return t;
  }, [filtered]);

  const approve = async (id: string) => {
    if (!confirm("تأكيد اعتماد المرتجع؟ سيتم زيادة المخزون وخصم الخزنة.")) return;
    const { error } = await (supabase as any).rpc("approve_feed_sales_return", { p_return_id: id });
    if (error) return toast.error(error.message);
    toast.success("تم اعتماد المرتجع وتحديث المخزون والخزنة");
    load();
  };

  const cancel = async (id: string) => {
    if (!confirm("تأكيد إلغاء المرتجع؟ سيتم عكس حركة المخزون والخزنة.")) return;
    const { error } = await (supabase as any).rpc("cancel_feed_sales_return", { p_return_id: id });
    if (error) return toast.error(error.message);
    toast.success("تم إلغاء المرتجع");
    load();
  };

  const productName = (id: string) => products.find(p => p.id === id)?.name || "—";

  return (
    <DashboardLayout>
      <div className="space-y-4" dir="rtl">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-2xl font-bold">مرتجع مبيعات أعلاف</h1>
            <p className="text-sm text-muted-foreground">تسجيل واعتماد مرتجعات العملاء — يزيد المخزون ويخصم الخزنة تلقائيًا.</p>
          </div>
          <Button onClick={() => { setEditing(null); setOpenForm(true); }}><Plus className="ml-2 h-4 w-4" />مرتجع جديد</Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">عدد المرتجعات</div><div className="text-xl font-bold">{totals.count}</div></CardContent></Card>
          <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">المعتمد</div><div className="text-xl font-bold">{totals.approved}</div></CardContent></Card>
          <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">إجمالي الكمية (كجم)</div><div className="text-xl font-bold">{fmt(totals.qty)}</div></CardContent></Card>
          <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">إجمالي القيمة</div><div className="text-xl font-bold">{fmt(totals.amount)}</div></CardContent></Card>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><FileText className="h-4 w-4" />تقرير المرتجعات</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3">
              <div><Label>من تاريخ</Label><Input type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} /></div>
              <div><Label>إلى تاريخ</Label><Input type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} /></div>
              <div><Label>العميل</Label><Input value={fCustomer} onChange={(e) => setFCustomer(e.target.value)} placeholder="بحث..." /></div>
              <div>
                <Label>نوع العلف</Label>
                <Select value={fProduct} onValueChange={setFProduct}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">الكل</SelectItem>
                    {products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>الحالة</Label>
                <Select value={fStatus} onValueChange={(v: any) => setFStatus(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">الكل</SelectItem>
                    <SelectItem value="draft">مسودة</SelectItem>
                    <SelectItem value="approved">معتمد</SelectItem>
                    <SelectItem value="cancelled">ملغي</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>التاريخ</TableHead>
                    <TableHead>رقم المرتجع</TableHead>
                    <TableHead>العميل</TableHead>
                    <TableHead>فاتورة أصلية</TableHead>
                    <TableHead>نوع العلف</TableHead>
                    <TableHead>الكمية</TableHead>
                    <TableHead>سعر الوحدة</TableHead>
                    <TableHead>الإجمالي</TableHead>
                    <TableHead>الخزنة</TableHead>
                    <TableHead>السبب</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead>إجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? <TableRow><TableCell colSpan={12} className="text-center text-muted-foreground">جاري التحميل...</TableCell></TableRow> :
                   filtered.length === 0 ? <TableRow><TableCell colSpan={12} className="text-center text-muted-foreground">لا توجد مرتجعات</TableCell></TableRow> :
                   filtered.map(r => (
                    <TableRow key={r.id}>
                      <TableCell>{r.return_date}</TableCell>
                      <TableCell className="font-mono text-xs">{r.return_no}</TableCell>
                      <TableCell>{r.customer}</TableCell>
                      <TableCell className="text-xs">{r.original_sale_no || "—"}</TableCell>
                      <TableCell>{productName(r.feed_product_id)}</TableCell>
                      <TableCell>{fmt(r.quantity_kg)}</TableCell>
                      <TableCell>{fmt(r.unit_price)}</TableCell>
                      <TableCell className="font-bold">{fmt(r.total_amount)}</TableCell>
                      <TableCell>{r.treasury_account}</TableCell>
                      <TableCell className="text-xs">{r.reason || "—"}</TableCell>
                      <TableCell>{statusBadge(r.status)}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {r.status === "draft" && (
                            <>
                              <Button size="sm" variant="outline" onClick={() => { setEditing(r); setOpenForm(true); }}>تعديل</Button>
                              <Button size="sm" onClick={() => approve(r.id)}><CheckCircle2 className="h-3 w-3 ml-1" />اعتماد</Button>
                            </>
                          )}
                          {r.status === "approved" && isManager && (
                            <Button size="sm" variant="destructive" onClick={() => cancel(r.id)}><XCircle className="h-3 w-3 ml-1" />إلغاء</Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <ReturnFormDialog
          open={openForm}
          onOpenChange={(o) => { setOpenForm(o); if (!o) setEditing(null); }}
          editing={editing}
          products={products}
          sales={sales}
          onSaved={load}
        />
      </div>
    </DashboardLayout>
  );
}

function ReturnFormDialog({ open, onOpenChange, editing, products, sales, onSaved }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: Return | null;
  products: any[];
  sales: any[];
  onSaved: () => void;
}) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [customer, setCustomer] = useState("");
  const [saleId, setSaleId] = useState<string>("none");
  const [productId, setProductId] = useState<string>("");
  const [qty, setQty] = useState<number>(0);
  const [price, setPrice] = useState<number>(0);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [treasury, setTreasury] = useState("main");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editing) {
      setDate(editing.return_date);
      setCustomer(editing.customer);
      setSaleId(editing.original_sale_id || "none");
      setProductId(editing.feed_product_id);
      setQty(Number(editing.quantity_kg));
      setPrice(Number(editing.unit_price));
      setReason(editing.reason || "");
      setNotes(editing.notes || "");
      setTreasury(editing.treasury_account || "main");
    } else if (open) {
      setDate(new Date().toISOString().slice(0, 10));
      setCustomer(""); setSaleId("none"); setProductId(""); setQty(0); setPrice(0); setReason(""); setNotes(""); setTreasury("main");
    }
  }, [editing?.id, open]);

  // Auto-fill price when product is picked
  useEffect(() => {
    if (productId && !editing && !price) {
      const p = products.find(x => x.id === productId);
      if (p?.selling_price) setPrice(Number(p.selling_price));
    }
  }, [productId]);

  const total = qty * price;

  const save = async (approveAfter: boolean) => {
    if (!customer.trim()) return toast.error("أدخل اسم العميل");
    if (!productId) return toast.error("اختر نوع العلف");
    if (qty <= 0) return toast.error("الكمية يجب أن تكون أكبر من 0");
    if (price < 0) return toast.error("سعر غير صحيح");

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const selectedSale = sales.find(s => s.id === saleId);
      const payload: any = {
        return_date: date,
        customer: customer.trim(),
        original_sale_id: saleId !== "none" ? saleId : null,
        original_sale_no: selectedSale?.sale_no || null,
        feed_product_id: productId,
        quantity_kg: qty,
        unit_price: price,
        reason: reason || null,
        notes: notes || null,
        treasury_account: treasury || "main",
      };

      let id = editing?.id;
      if (editing) {
        const { error } = await (supabase as any).from("feed_sales_returns").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        payload.created_by = user?.id;
        const { data, error } = await (supabase as any).from("feed_sales_returns").insert(payload).select("id").single();
        if (error) throw error;
        id = data.id;
      }

      if (approveAfter && id) {
        const { error } = await (supabase as any).rpc("approve_feed_sales_return", { p_return_id: id });
        if (error) throw error;
        toast.success("تم الحفظ والاعتماد — تحديث المخزون والخزنة");
      } else {
        toast.success("تم حفظ المرتجع كمسودة");
      }
      onOpenChange(false);
      onSaved();
    } catch (e: any) {
      toast.error(e.message || "فشل الحفظ");
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl" dir="rtl">
        <DialogHeader><DialogTitle>{editing ? `تعديل مرتجع ${editing.return_no}` : "مرتجع مبيعات أعلاف جديد"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div><Label>تاريخ المرتجع</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="md:col-span-2"><Label>اسم العميل</Label><Input value={customer} onChange={(e) => setCustomer(e.target.value)} /></div>

          <div className="md:col-span-2">
            <Label>رقم فاتورة البيع الأصلية (اختياري)</Label>
            <Select value={saleId} onValueChange={(v) => {
              setSaleId(v);
              if (v !== "none") {
                const s = sales.find(x => x.id === v);
                if (s?.customer && !customer) setCustomer(s.customer);
              }
            }}>
              <SelectTrigger><SelectValue placeholder="بدون فاتورة" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">بدون فاتورة</SelectItem>
                {sales.map(s => <SelectItem key={s.id} value={s.id}>{s.sale_no} — {s.customer || ""} ({s.sale_date})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>الخزنة</Label>
            <Input value={treasury} onChange={(e) => setTreasury(e.target.value)} placeholder="main" />
          </div>

          <div className="md:col-span-3">
            <Label>نوع العلف المرتجع</Label>
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger><SelectValue placeholder="اختر العلف" /></SelectTrigger>
              <SelectContent>
                {products.map(p => <SelectItem key={p.id} value={p.id}>{p.name} (الرصيد: {fmt(Number(p.current_stock || 0))} كجم)</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div><Label>الكمية المرتجعة (كجم)</Label><Input type="number" value={qty || ""} onChange={(e) => setQty(Number(e.target.value))} /></div>
          <div><Label>سعر الوحدة</Label><Input type="number" value={price || ""} onChange={(e) => setPrice(Number(e.target.value))} /></div>
          <div><Label>إجمالي المرتجع</Label><Input value={fmt(total)} readOnly className="font-bold" /></div>

          <div className="md:col-span-3"><Label>سبب المرتجع</Label><Input value={reason} onChange={(e) => setReason(e.target.value)} /></div>
          <div className="md:col-span-3"><Label>ملاحظات</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>إلغاء</Button>
          <Button variant="secondary" onClick={() => save(false)} disabled={saving}>حفظ كمسودة</Button>
          <Button onClick={() => save(true)} disabled={saving}><CheckCircle2 className="h-4 w-4 ml-1" />حفظ واعتماد</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
