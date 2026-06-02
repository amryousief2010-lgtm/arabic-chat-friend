import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
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
import { Factory, Plus, Trash2, CheckCircle2, Send, Loader2 } from "lucide-react";

type Warehouse = { id: string; name: string; type: string };
type Item = { id: string; name: string; unit: string; stock: number; unit_cost: number; category: string | null };
type Line = { item_id: string; item_name: string; unit: string; quantity: number; unit_cost: number; line_total: number };
type Invoice = {
  id: string; invoice_no: string; product_name: string; finished_qty: number; unit: string;
  status: string; materials_total_cost: number; unit_cost: number | null;
  factory_warehouse_id: string; finished_item_id: string | null;
  transfer_no: string | null; created_at: string;
};

const PRODUCT_PRESETS = ["كفتة", "برجر", "سجق", "مفروم", "حواوشي", "نقانق", "كباب"];

export default function ManufacturingInvoices() {
  const { user, isGeneralManager, isExecutiveManager } = useAuth();
  const [tab, setTab] = useState("new");
  const [factoryWarehouses, setFactoryWarehouses] = useState<Warehouse[]>([]);
  const [mainWarehouses, setMainWarehouses] = useState<Warehouse[]>([]);
  const [factoryWarehouseId, setFactoryWarehouseId] = useState<string>("");
  const [items, setItems] = useState<Item[]>([]);
  const [productName, setProductName] = useState("");
  const [productNameOther, setProductNameOther] = useState("");
  const [finishedQty, setFinishedQty] = useState<number>(0);
  const [unit, setUnit] = useState("كجم");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [saving, setSaving] = useState(false);

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [transferInv, setTransferInv] = useState<Invoice | null>(null);
  const [transferDestId, setTransferDestId] = useState<string>("");
  const [transferring, setTransferring] = useState(false);

  const fetchAll = async () => {
    const [whs, inv] = await Promise.all([
      supabase.from("warehouses").select("id, name, type").order("name"),
      supabase.from("meat_manufacturing_invoices" as any).select("*").order("created_at", { ascending: false }).limit(200),
    ]);
    if (whs.data) {
      const factory = whs.data.filter(w => w.name?.includes("مصنع اللحوم"));
      const main = whs.data.filter(w => w.type === "finished_goods" && !w.name?.includes("مصنع"));
      setFactoryWarehouses(factory);
      setMainWarehouses(main);
      if (factory[0]) setFactoryWarehouseId(prev => prev || factory[0].id);
    }
    if (inv.data) setInvoices(inv.data as any);
  };

  const fetchItems = async (whId: string) => {
    if (!whId) { setItems([]); return; }
    const { data } = await supabase.from("inventory_items")
      .select("id, name, unit, stock, unit_cost, category")
      .eq("warehouse_id", whId)
      .order("name");
    setItems((data || []) as any);
  };

  useEffect(() => { fetchAll(); }, []);
  useEffect(() => { fetchItems(factoryWarehouseId); }, [factoryWarehouseId]);

  const rawMaterials = useMemo(() => items.filter(i => i.category !== "منتج تام مصنع اللحوم"), [items]);

  const addLine = () => {
    setLines(ls => [...ls, { item_id: "", item_name: "", unit: "كجم", quantity: 0, unit_cost: 0, line_total: 0 }]);
  };
  const updateLine = (idx: number, patch: Partial<Line>) => {
    setLines(ls => ls.map((l, i) => {
      if (i !== idx) return l;
      const merged = { ...l, ...patch };
      if (patch.item_id) {
        const it = rawMaterials.find(x => x.id === patch.item_id);
        if (it) { merged.item_name = it.name; merged.unit = it.unit; merged.unit_cost = Number(it.unit_cost || 0); }
      }
      merged.line_total = Number((Number(merged.quantity || 0) * Number(merged.unit_cost || 0)).toFixed(3));
      return merged;
    }));
  };
  const removeLine = (idx: number) => setLines(ls => ls.filter((_, i) => i !== idx));

  const totalCost = useMemo(() => lines.reduce((s, l) => s + Number(l.line_total || 0), 0), [lines]);
  const finalProductName = productName === "أخرى" ? productNameOther.trim() : productName;

  const submit = async () => {
    if (!factoryWarehouseId) { toast.error("اختر مخزن مصنع اللحوم"); return; }
    if (!finalProductName) { toast.error("اختر/أدخل اسم المنتج النهائي"); return; }
    if (!finishedQty || finishedQty <= 0) { toast.error("أدخل كمية المنتج التام"); return; }
    const valid = lines.filter(l => l.item_id && l.quantity > 0);
    if (valid.length === 0) { toast.error("أضف خامات للفاتورة"); return; }
    for (const l of valid) {
      const it = rawMaterials.find(x => x.id === l.item_id);
      if (!it) { toast.error(`خامة غير موجودة في المخزن: ${l.item_name}`); return; }
      if (Number(it.stock) < Number(l.quantity)) {
        toast.error(`الرصيد غير كافٍ لـ ${it.name} (المتاح ${it.stock})`); return;
      }
    }

    setSaving(true);
    try {
      const { data: noRes, error: noErr } = await supabase.rpc("gen_meat_invoice_no" as any);
      if (noErr) throw noErr;
      const invoiceNo = noRes as unknown as string;

      const { data: inv, error: insErr } = await supabase.from("meat_manufacturing_invoices" as any).insert({
        invoice_no: invoiceNo,
        product_name: finalProductName,
        finished_qty: finishedQty,
        unit,
        factory_warehouse_id: factoryWarehouseId,
        materials_total_cost: totalCost,
        unit_cost: finishedQty > 0 ? Number((totalCost / finishedQty).toFixed(3)) : 0,
        status: "draft",
        notes: notes || null,
        created_by: user?.id || null,
      } as any).select("id").single();
      if (insErr) throw insErr;

      const { error: linesErr } = await supabase.from("meat_manufacturing_invoice_lines" as any).insert(
        valid.map(l => ({
          invoice_id: (inv as any).id,
          item_id: l.item_id,
          item_name: l.item_name,
          unit: l.unit,
          quantity: l.quantity,
          unit_cost: l.unit_cost,
          line_total: l.line_total,
        })) as any
      );
      if (linesErr) throw linesErr;

      const { error: appErr } = await supabase.rpc("approve_meat_manufacturing_invoice" as any, { p_invoice_id: (inv as any).id });
      if (appErr) throw appErr;

      toast.success(`تم اعتماد الفاتورة ${invoiceNo} وخصم الخامات`);
      setLines([]); setProductName(""); setProductNameOther(""); setFinishedQty(0); setNotes("");
      fetchAll();
      fetchItems(factoryWarehouseId);
      setTab("list");
    } catch (e: any) {
      toast.error(e.message || "فشل حفظ الفاتورة");
    } finally {
      setSaving(false);
    }
  };

  const openTransfer = (inv: Invoice) => {
    setTransferInv(inv);
    setTransferDestId(mainWarehouses[0]?.id || "");
  };
  const submitTransfer = async () => {
    if (!transferInv || !transferDestId) { toast.error("اختر المخزن الرئيسي"); return; }
    setTransferring(true);
    const { data, error } = await supabase.rpc("transfer_meat_invoice_to_warehouse" as any, {
      p_invoice_id: transferInv.id,
      p_destination_warehouse_id: transferDestId,
      p_notes: null,
    });
    setTransferring(false);
    if (error) { toast.error(error.message); return; }
    const r: any = data || {};
    toast.success(`تم إرسال التحويل ${r.transfer_no || ""} — بانتظار موافقة المخزن الرئيسي`);
    setTransferInv(null);
    fetchAll();
  };

  const statusBadge = (s: string) => {
    if (s === "draft") return <Badge variant="outline">مسودة</Badge>;
    if (s === "approved") return <Badge className="bg-emerald-600">معتمدة</Badge>;
    if (s === "transferred") return <Badge className="bg-blue-600">محوّلة للرئيسي</Badge>;
    if (s === "cancelled") return <Badge variant="destructive">ملغاة</Badge>;
    return <Badge>{s}</Badge>;
  };

  return (
    <div className="p-4 md:p-6 space-y-4" dir="rtl">
      <div className="flex items-center gap-3">
        <Factory className="w-7 h-7 text-purple-600" />
        <div>
          <h1 className="text-2xl font-bold">فواتير تصنيع مصنع اللحوم</h1>
          <p className="text-sm text-muted-foreground">خصم الخامات وإنتاج المنتج التام، ثم تحويله للمخزن الرئيسي بموافقة الاستلام.</p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="new">فاتورة جديدة</TabsTrigger>
          <TabsTrigger value="list">سجل الفواتير ({invoices.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="new" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">بيانات الفاتورة</CardTitle>
              <CardDescription>أدخل المنتج النهائي والكمية، ثم أضف الخامات المستخدمة من مخزن مصنع اللحوم.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div>
                  <Label>مخزن مصنع اللحوم</Label>
                  <Select value={factoryWarehouseId} onValueChange={setFactoryWarehouseId}>
                    <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
                    <SelectContent>
                      {factoryWarehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>المنتج النهائي</Label>
                  <Select value={productName} onValueChange={setProductName}>
                    <SelectTrigger><SelectValue placeholder="اختر المنتج" /></SelectTrigger>
                    <SelectContent>
                      {PRODUCT_PRESETS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                      <SelectItem value="أخرى">أخرى (أدخل اسمًا)</SelectItem>
                    </SelectContent>
                  </Select>
                  {productName === "أخرى" && (
                    <Input className="mt-2" placeholder="اسم المنتج" value={productNameOther} onChange={e => setProductNameOther(e.target.value)} />
                  )}
                </div>
                <div>
                  <Label>الكمية النهائية</Label>
                  <Input type="number" step="0.01" value={finishedQty || ""} onChange={e => setFinishedQty(Number(e.target.value))} />
                </div>
                <div>
                  <Label>الوحدة</Label>
                  <Select value={unit} onValueChange={setUnit}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="كجم">كجم</SelectItem>
                      <SelectItem value="عبوة">عبوة</SelectItem>
                      <SelectItem value="قطعة">قطعة</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">الخامات المستخدمة</h3>
                  <Button onClick={addLine} size="sm" variant="outline"><Plus className="w-4 h-4 ml-1" /> إضافة خامة</Button>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الخامة</TableHead>
                      <TableHead>المتاح</TableHead>
                      <TableHead>الكمية</TableHead>
                      <TableHead>سعر الوحدة</TableHead>
                      <TableHead>الإجمالي</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.length === 0 ? (
                      <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">لا توجد خامات — أضف خامة</TableCell></TableRow>
                    ) : lines.map((l, idx) => {
                      const it = rawMaterials.find(x => x.id === l.item_id);
                      return (
                        <TableRow key={idx}>
                          <TableCell className="min-w-[220px]">
                            <Select value={l.item_id} onValueChange={v => updateLine(idx, { item_id: v })}>
                              <SelectTrigger><SelectValue placeholder="اختر خامة" /></SelectTrigger>
                              <SelectContent>
                                {rawMaterials.map(r => (
                                  <SelectItem key={r.id} value={r.id}>{r.name} ({r.unit})</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="text-xs">{it ? `${Number(it.stock).toFixed(2)} ${it.unit}` : "—"}</TableCell>
                          <TableCell>
                            <Input type="number" step="0.01" className="w-24"
                              value={l.quantity || ""}
                              onChange={e => updateLine(idx, { quantity: Number(e.target.value) })} />
                          </TableCell>
                          <TableCell>
                            <Input type="number" step="0.01" className="w-24"
                              value={l.unit_cost || ""}
                              onChange={e => updateLine(idx, { unit_cost: Number(e.target.value) })} />
                          </TableCell>
                          <TableCell className="font-medium">{l.line_total.toFixed(2)}</TableCell>
                          <TableCell>
                            <Button size="icon" variant="ghost" onClick={() => removeLine(idx)}><Trash2 className="w-4 h-4 text-red-600" /></Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                <div className="text-left text-sm">
                  <span className="text-muted-foreground">إجمالي تكلفة الخامات: </span>
                  <span className="font-bold text-lg">{totalCost.toFixed(2)}</span>
                </div>
              </div>

              <div>
                <Label>ملاحظات</Label>
                <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="اختياري" />
              </div>

              <div className="flex justify-end">
                <Button onClick={submit} disabled={saving} className="bg-purple-600 hover:bg-purple-700">
                  {saving ? <Loader2 className="w-4 h-4 ml-1 animate-spin" /> : <CheckCircle2 className="w-4 h-4 ml-1" />}
                  حفظ واعتماد الفاتورة
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="list" className="space-y-3">
          {invoices.length === 0 ? (
            <Card><CardContent className="py-10 text-center text-muted-foreground">لا توجد فواتير</CardContent></Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>رقم الفاتورة</TableHead>
                      <TableHead>المنتج</TableHead>
                      <TableHead>الكمية</TableHead>
                      <TableHead>إجمالي الخامات</TableHead>
                      <TableHead>تكلفة الوحدة</TableHead>
                      <TableHead>الحالة</TableHead>
                      <TableHead>التاريخ</TableHead>
                      <TableHead>إجراءات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoices.map(inv => (
                      <TableRow key={inv.id}>
                        <TableCell className="font-mono text-xs">{inv.invoice_no}</TableCell>
                        <TableCell className="font-medium">{inv.product_name}</TableCell>
                        <TableCell>{Number(inv.finished_qty).toFixed(2)} {inv.unit}</TableCell>
                        <TableCell>{Number(inv.materials_total_cost).toFixed(2)}</TableCell>
                        <TableCell>{inv.unit_cost ? Number(inv.unit_cost).toFixed(2) : "—"}</TableCell>
                        <TableCell>{statusBadge(inv.status)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{new Date(inv.created_at).toLocaleString("ar-EG")}</TableCell>
                        <TableCell>
                          {inv.status === "approved" && (
                            <Button size="sm" onClick={() => openTransfer(inv)} className="bg-blue-600 hover:bg-blue-700">
                              <Send className="w-4 h-4 ml-1" /> تحويل للمخزن الرئيسي
                            </Button>
                          )}
                          {inv.status === "transferred" && inv.transfer_no && (
                            <span className="text-xs text-muted-foreground">تحويل: {inv.transfer_no}</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={!!transferInv} onOpenChange={(v) => !v && setTransferInv(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تحويل {transferInv?.product_name} ({Number(transferInv?.finished_qty || 0).toFixed(2)} {transferInv?.unit}) للمخزن الرئيسي</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">سيتم إرسال التحويل، ولن يزيد رصيد المخزن الرئيسي إلا بعد موافقة مسؤول المخزن الرئيسي على الاستلام.</p>
            <div>
              <Label>المخزن الرئيسي المستلِم</Label>
              <Select value={transferDestId} onValueChange={setTransferDestId}>
                <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
                <SelectContent>
                  {mainWarehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferInv(null)}>إلغاء</Button>
            <Button onClick={submitTransfer} disabled={transferring} className="bg-blue-600 hover:bg-blue-700">
              {transferring ? <Loader2 className="w-4 h-4 ml-1 animate-spin" /> : <Send className="w-4 h-4 ml-1" />}
              إرسال التحويل
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
