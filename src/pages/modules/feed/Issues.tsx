import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PackageOpen, Plus, ArrowLeft, RefreshCw, Trash2, FileText, Wand2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { formatDate, formatDateTime } from "@/lib/dateFormat";

const fmt = (n: number, d = 2) => (Number.isFinite(n) ? n : 0).toLocaleString("en-GB", { maximumFractionDigits: d });

interface Material {
  id: string; name: string; unit: string; unit_cost: number; stock: number;
  warehouse_name: string | null; item_code: string | null; is_active: boolean;
}
interface Order {
  id: string; order_no: string; status: string; target_output_kg: number;
  feed_product_id: string; recipe_id: string | null;
  feed_product?: { name: string; feed_code: string };
  recipe?: { id: string; name: string; batch_size: number; items?: { raw_material_id: string; quantity: number; raw_material?: Material }[] };
}
interface Issue {
  id: string; issued_at: string; order_id: string; raw_material_id: string;
  qty: number; unit: string; unit_cost: number; total_cost: number | null;
  raw_material?: Material;
  order?: { order_no: string; feed_product?: { name: string } };
}
interface InvoiceBatch {
  id: string; batch_no: string; invoice_no: string | null; invoice_date: string | null;
  input_qty_weight_kg: number | null; output_qty_kg: number; warehouse_name: string | null;
}

export default function Issues() {
  const { canManageFeedFactory, user } = useAuth();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const initialOrder = params.get("order") || "";

  const [loading, setLoading] = useState(true);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [invoiceBatches, setInvoiceBatches] = useState<InvoiceBatch[]>([]);
  const [orderFilter, setOrderFilter] = useState<string>(initialOrder || "all");

  const [dialog, setDialog] = useState(false);
  const [form, setForm] = useState({
    order_id: initialOrder, raw_material_id: "", qty: 0,
  });
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const fetchAll = async () => {
    setLoading(true);
    const [i, o, m, b] = await Promise.all([
      supabase.from("feed_material_issues")
        .select("*, raw_material:feed_raw_materials(id, name, unit, unit_cost, stock, warehouse_name, item_code), order:feed_production_orders(order_no, feed_product:feed_products(name))")
        .order("issued_at", { ascending: false }).limit(500),
      supabase.from("feed_production_orders")
        .select("*, feed_product:feed_products(name, feed_code), recipe:feed_recipes(id, name, batch_size, items:feed_recipe_items(raw_material_id, quantity, raw_material:feed_raw_materials(id, name, unit, unit_cost, stock, warehouse_name, item_code)))")
        .not("status", "in", "(approved,posted,rejected)")
        .order("created_at", { ascending: false }).limit(200),
      supabase.from("feed_raw_materials").select("id, name, unit, unit_cost, stock, warehouse_name, item_code, is_active").eq("is_active", true).order("name"),
      supabase.from("feed_invoice_batches").select("id, batch_no, invoice_no, invoice_date, input_qty_weight_kg, output_qty_kg, warehouse_name, order_id").not("order_id", "is", null),
    ]);
    if (i.error || o.error || m.error || b.error) {
      toast({ title: "خطأ", description: i.error?.message || o.error?.message || m.error?.message || b.error?.message, variant: "destructive" });
    }
    setIssues((i.data || []) as any);
    setOrders((o.data || []) as any);
    setMaterials((m.data || []) as any);
    setInvoiceBatches((b.data || []) as any);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  const visible = orderFilter === "all" ? issues : issues.filter(x => x.order_id === orderFilter);

  // Per-order summary (suggested vs issued)
  const selectedOrder = orders.find(o => o.id === orderFilter);
  const orderSummary = useMemo(() => {
    if (!selectedOrder || !selectedOrder.recipe?.items) return null;
    const scale = selectedOrder.recipe.batch_size > 0
      ? selectedOrder.target_output_kg / selectedOrder.recipe.batch_size : 1;
    const issuedMap: Record<string, number> = {};
    issues.filter(i => i.order_id === selectedOrder.id).forEach(i => {
      issuedMap[i.raw_material_id] = (issuedMap[i.raw_material_id] || 0) + Number(i.qty);
    });
    return selectedOrder.recipe.items.map(it => {
      const required = Number(it.quantity) * scale;
      const issued = issuedMap[it.raw_material_id] || 0;
      return { ...it, required, issued, remaining: Math.max(required - issued, 0) };
    });
  }, [selectedOrder, issues]);

  const orderInvoices = invoiceBatches.filter(b => (b as any).order_id === orderFilter);

  // suggested qty when material chosen inside dialog
  const suggestedQty = useMemo(() => {
    if (!form.order_id || !form.raw_material_id) return 0;
    const ord = orders.find(o => o.id === form.order_id);
    const item = ord?.recipe?.items?.find(i => i.raw_material_id === form.raw_material_id);
    if (!ord?.recipe || !item) return 0;
    const scale = ord.recipe.batch_size > 0 ? ord.target_output_kg / ord.recipe.batch_size : 1;
    const required = Number(item.quantity) * scale;
    const alreadyIssued = issues
      .filter(i => i.order_id === ord.id && i.raw_material_id === form.raw_material_id)
      .reduce((s, i) => s + Number(i.qty), 0);
    return Math.max(required - alreadyIssued, 0);
  }, [form.order_id, form.raw_material_id, orders, issues]);

  const openDialog = (orderId?: string) => {
    setForm({ order_id: orderId || initialOrder || "", raw_material_id: "", qty: 0 });
    setDialog(true);
  };

  const save = async () => {
    if (!form.order_id || !form.raw_material_id || form.qty <= 0) {
      toast({ title: "بيانات ناقصة", description: "اختر الأمر والمادة وأدخل الكمية", variant: "destructive" });
      return;
    }
    const mat = materials.find(m => m.id === form.raw_material_id);
    if (!mat) return;
    if (form.qty > mat.stock) {
      toast({ title: "مخزون غير كافٍ", description: `المتاح ${fmt(mat.stock)} ${mat.unit}`, variant: "destructive" });
      return;
    }
    const total = form.qty * (mat.unit_cost || 0);
    const { error } = await supabase.from("feed_material_issues").insert({
      order_id: form.order_id,
      raw_material_id: form.raw_material_id,
      qty: form.qty,
      unit: mat.unit,
      unit_cost: mat.unit_cost || 0,
      total_cost: total,
      issued_by: user?.id,
    });
    if (error) {
      toast({ title: "خطأ", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "تم تسجيل الصرف", description: `${fmt(form.qty)} ${mat.unit} من ${mat.name}` });
      setDialog(false);
      // bump order to 'issued' if still draft
      const ord = orders.find(o => o.id === form.order_id);
      if (ord && ord.status === "draft") {
        await supabase.from("feed_production_orders").update({ status: "issued" as any }).eq("id", ord.id);
      }
      fetchAll();
    }
  };

  const doDelete = async () => {
    if (!deleteId) return;
    const issue = issues.find(i => i.id === deleteId);
    if (!issue) { setDeleteId(null); return; }
    const { error: delErr } = await supabase.from("feed_material_issues").delete().eq("id", deleteId);
    if (delErr) { toast({ title: "خطأ", description: delErr.message, variant: "destructive" }); setDeleteId(null); return; }
    // restore stock (trigger only fires on insert)
    const mat = materials.find(m => m.id === issue.raw_material_id);
    if (mat) {
      await supabase.from("feed_raw_materials")
        .update({ stock: Number(mat.stock) + Number(issue.qty) })
        .eq("id", mat.id);
    }
    toast({ title: "تم الحذف وإرجاع الكمية للمخزون" });
    setDeleteId(null);
    fetchAll();
  };

  const totalIssuedCost = visible.reduce((s, i) => s + Number(i.total_cost || 0), 0);
  const totalIssuedQty = visible.reduce((s, i) => s + Number(i.qty || 0), 0);

  return (
    <DashboardLayout>
      <div className="space-y-6" dir="rtl">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
              <PackageOpen className="w-7 h-7 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-foreground">صرف الخامات</h1>
              <p className="text-muted-foreground mt-1">تسجيل صرف المواد ومصدرها وربطها بأوامر الإنتاج والفواتير</p>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Select value={orderFilter} onValueChange={(v) => { setOrderFilter(v); setParams(v === "all" ? {} : { order: v }); }}>
              <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الأوامر</SelectItem>
                {orders.map(o => <SelectItem key={o.id} value={o.id}>{o.order_no} — {o.feed_product?.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={fetchAll} disabled={loading}>
              <RefreshCw className={`w-4 h-4 ml-2 ${loading ? "animate-spin" : ""}`} />تحديث
            </Button>
            <Link to="/modules/feed-factory">
              <Button size="sm" variant="ghost"><ArrowLeft className="w-4 h-4 ml-2" />رجوع</Button>
            </Link>
            {canManageFeedFactory && (
              <Button size="sm" onClick={() => openDialog(orderFilter !== "all" ? orderFilter : undefined)}>
                <Plus className="w-4 h-4 ml-2" />تسجيل صرف
              </Button>
            )}
          </div>
        </div>

        {/* KPIs */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card><CardHeader className="pb-2"><CardDescription>عدد عمليات الصرف</CardDescription><CardTitle className="text-2xl">{visible.length}</CardTitle></CardHeader></Card>
          <Card><CardHeader className="pb-2"><CardDescription>إجمالي الكميات</CardDescription><CardTitle className="text-2xl">{fmt(totalIssuedQty, 1)}</CardTitle></CardHeader></Card>
          <Card><CardHeader className="pb-2"><CardDescription>إجمالي التكلفة</CardDescription><CardTitle className="text-2xl text-primary">{fmt(totalIssuedCost, 2)}</CardTitle></CardHeader></Card>
        </div>

        {/* Per-order summary (suggested vs issued) */}
        {selectedOrder && orderSummary && orderSummary.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Wand2 className="w-4 h-4" />ملخص الأمر {selectedOrder.order_no}
              </CardTitle>
              <CardDescription>
                المنتج: {selectedOrder.feed_product?.name} • المستهدف: {fmt(selectedOrder.target_output_kg, 0)} كجم •
                الوصفة: {selectedOrder.recipe?.name}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>المادة</TableHead>
                    <TableHead>المخزن</TableHead>
                    <TableHead>المطلوب</TableHead>
                    <TableHead>تم صرفه</TableHead>
                    <TableHead>المتبقي</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orderSummary.map(it => (
                    <TableRow key={it.raw_material_id}>
                      <TableCell className="font-medium">{it.raw_material?.name || "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{it.raw_material?.warehouse_name || "—"}</TableCell>
                      <TableCell>{fmt(it.required, 2)} {it.raw_material?.unit}</TableCell>
                      <TableCell>{fmt(it.issued, 2)}</TableCell>
                      <TableCell className={it.remaining > 0 ? "text-warning font-medium" : "text-success"}>
                        {fmt(it.remaining, 2)}
                      </TableCell>
                      <TableCell>
                        {canManageFeedFactory && it.remaining > 0 && (
                          <Button size="sm" variant="outline" onClick={() => {
                            setForm({ order_id: selectedOrder.id, raw_material_id: it.raw_material_id, qty: Number(it.remaining.toFixed(3)) });
                            setDialog(true);
                          }}>صرف المتبقي</Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Linked invoice batches */}
        {orderFilter !== "all" && orderInvoices.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="w-4 h-4" />الفواتير/الدفعات المرتبطة
              </CardTitle>
              <CardDescription>{orderInvoices.length} دفعة فاتورة</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>رقم الدفعة</TableHead>
                    <TableHead>رقم الفاتورة</TableHead>
                    <TableHead>التاريخ</TableHead>
                    <TableHead>المخزن</TableHead>
                    <TableHead>وزن داخل</TableHead>
                    <TableHead>كمية خارج</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orderInvoices.map(b => (
                    <TableRow key={b.id}>
                      <TableCell className="font-mono text-xs">{b.batch_no}</TableCell>
                      <TableCell className="text-sm">{b.invoice_no || "—"}</TableCell>
                      <TableCell className="text-xs">{b.invoice_date ? formatDate(b.invoice_date) : "—"}</TableCell>
                      <TableCell className="text-xs">{b.warehouse_name || "—"}</TableCell>
                      <TableCell>{fmt(Number(b.input_qty_weight_kg || 0), 1)}</TableCell>
                      <TableCell>{fmt(Number(b.output_qty_kg), 1)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Issues list */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">سجل عمليات الصرف</CardTitle>
            <CardDescription>أحدث 500 عملية</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>أمر الإنتاج</TableHead>
                  <TableHead>المادة</TableHead>
                  <TableHead>المخزن</TableHead>
                  <TableHead>الكمية</TableHead>
                  <TableHead>تكلفة الوحدة</TableHead>
                  <TableHead>الإجمالي</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">جارٍ التحميل...</TableCell></TableRow>
                ) : visible.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">لا توجد عمليات صرف</TableCell></TableRow>
                ) : visible.map(i => (
                  <TableRow key={i.id}>
                    <TableCell className="text-xs">{formatDateTime(i.issued_at)}</TableCell>
                    <TableCell className="font-mono text-xs">{i.order?.order_no || "—"}</TableCell>
                    <TableCell className="text-sm">
                      <div>{i.raw_material?.name || "—"}</div>
                      {i.raw_material?.item_code && <Badge variant="outline" className="text-xs mt-1">{i.raw_material.item_code}</Badge>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{i.raw_material?.warehouse_name || "—"}</TableCell>
                    <TableCell>{fmt(Number(i.qty), 2)} {i.unit}</TableCell>
                    <TableCell className="text-xs">{fmt(Number(i.unit_cost), 3)}</TableCell>
                    <TableCell className="font-medium">{fmt(Number(i.total_cost || 0), 2)}</TableCell>
                    <TableCell>
                      {canManageFeedFactory && (
                        <Button size="sm" variant="ghost" onClick={() => setDeleteId(i.id)} title="حذف وإرجاع للمخزون">
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Issue dialog */}
        <Dialog open={dialog} onOpenChange={setDialog}>
          <DialogContent dir="rtl">
            <DialogHeader>
              <DialogTitle>تسجيل صرف خامة</DialogTitle>
              <DialogDescription>سيتم خصم الكمية من المخزون تلقائيًا</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>أمر الإنتاج *</Label>
                <Select value={form.order_id} onValueChange={v => setForm({ ...form, order_id: v, raw_material_id: "", qty: 0 })}>
                  <SelectTrigger><SelectValue placeholder="اختر الأمر" /></SelectTrigger>
                  <SelectContent>
                    {orders.map(o => <SelectItem key={o.id} value={o.id}>{o.order_no} — {o.feed_product?.name} ({fmt(o.target_output_kg)} كجم)</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>المادة الخام *</Label>
                <Select value={form.raw_material_id} onValueChange={v => setForm({ ...form, raw_material_id: v })}>
                  <SelectTrigger><SelectValue placeholder="اختر المادة" /></SelectTrigger>
                  <SelectContent>
                    {materials.map(m => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name} — متاح {fmt(m.stock, 1)} {m.unit} {m.warehouse_name ? `(${m.warehouse_name})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <Label>الكمية *</Label>
                  {suggestedQty > 0 && (
                    <Button type="button" size="sm" variant="ghost" className="h-auto py-0 text-xs" onClick={() => setForm({ ...form, qty: Number(suggestedQty.toFixed(3)) })}>
                      <Wand2 className="w-3 h-3 ml-1" />استخدم المقترح ({fmt(suggestedQty, 2)})
                    </Button>
                  )}
                </div>
                <Input type="number" step="0.01" value={form.qty} onChange={e => setForm({ ...form, qty: Number(e.target.value) })} />
                {form.raw_material_id && (() => {
                  const m = materials.find(x => x.id === form.raw_material_id);
                  if (!m) return null;
                  const cost = form.qty * (m.unit_cost || 0);
                  return (
                    <p className="text-xs text-muted-foreground mt-1">
                      تكلفة تقديرية: {fmt(cost, 2)} • المتاح: {fmt(m.stock, 1)} {m.unit}
                    </p>
                  );
                })()}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialog(false)}>إلغاء</Button>
              <Button onClick={save}>تأكيد الصرف</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete confirm */}
        <Dialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
          <DialogContent dir="rtl">
            <DialogHeader>
              <DialogTitle>حذف الصرف</DialogTitle>
              <DialogDescription>سيتم حذف العملية وإرجاع الكمية إلى مخزون المادة.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteId(null)}>إلغاء</Button>
              <Button variant="destructive" onClick={doDelete}>حذف وإرجاع</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
