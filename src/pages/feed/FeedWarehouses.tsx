import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Warehouse, Package, ShoppingCart, Banknote, Plus, Trash2, AlertTriangle, Pencil } from "lucide-react";
import { toast } from "sonner";

type Line = { id: string; ref_id: string; qty: number; price: number };
const newLine = (): Line => ({ id: crypto.randomUUID(), ref_id: "", qty: 0, price: 0 });
const fmt = (n: number) => n.toLocaleString("ar-EG", { maximumFractionDigits: 2 });

export default function FeedWarehouses() {
  const qc = useQueryClient();
  const { roles } = useAuth();
  // التعديل المباشر للمخزون مسموح للمدير العام/التنفيذي/مشرف المخزن/مدير الإنتاج فقط. مدير المصنع (العنازى) يقدر يعمل فواتير بس.
  const canEditStock = roles.some((r) => ["general_manager","executive_manager","warehouse_supervisor","production_manager"].includes(r));
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [saleOpen, setSaleOpen] = useState(false);
  const [editRaw, setEditRaw] = useState<any | null>(null);
  const [editProd, setEditProd] = useState<any | null>(null);

  const rawQ = useQuery({
    queryKey: ["feed-raw-materials"],
    queryFn: async () => {
      const { data, error } = await supabase.from("feed_raw_materials").select("*").eq("is_active", true).order("name");
      if (error) throw error; return data || [];
    },
  });
  const prodQ = useQuery({
    queryKey: ["feed-products"],
    queryFn: async () => {
      const { data, error } = await supabase.from("feed_products").select("*").order("name");
      if (error) throw error; return data || [];
    },
  });
  const purQ = useQuery({
    queryKey: ["feed-purchases"],
    queryFn: async () => {
      const { data, error } = await supabase.from("feed_raw_purchases").select("*, feed_raw_purchase_items(*, feed_raw_materials(name,unit))").order("purchase_date", { ascending: false }).limit(100);
      if (error) throw error; return data || [];
    },
  });
  const salesQ = useQuery({
    queryKey: ["feed-sales"],
    queryFn: async () => {
      const { data, error } = await supabase.from("feed_sales").select("*, feed_sale_items(*, feed_products(name))").order("sale_date", { ascending: false }).limit(100);
      if (error) throw error; return data || [];
    },
  });

  const rawValue = useMemo(() => (rawQ.data || []).reduce((s: number, r: any) => s + Number(r.stock || 0) * Number(r.unit_cost || 0), 0), [rawQ.data]);
  const finishedValue = useMemo(() => (prodQ.data || []).reduce((s: number, p: any) => s + Number(p.current_stock || 0) * Number(p.latest_unit_cost || 0), 0), [prodQ.data]);

  return (
    <DashboardLayout>
      <div dir="rtl" className="p-4 md:p-6 space-y-4">
        <div className="flex items-center gap-3">
          <Warehouse className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">مخازن مصنع الأعلاف</h1>
            <p className="text-sm text-muted-foreground">المواد الخام، العلف الجاهز، المشتريات والمبيعات</p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">قيمة مخزن الخامات</div><div className="text-2xl font-bold text-primary">{fmt(rawValue)} ج.م</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">قيمة العلف الجاهز</div><div className="text-2xl font-bold text-secondary">{fmt(finishedValue)} ج.م</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">أصناف خامات</div><div className="text-2xl font-bold">{rawQ.data?.length || 0}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">أصناف علف جاهز</div><div className="text-2xl font-bold">{prodQ.data?.length || 0}</div></CardContent></Card>
        </div>

        <Tabs defaultValue="raw" dir="rtl">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="raw"><Package className="h-4 w-4 ml-1" />مخزن الخامات</TabsTrigger>
            <TabsTrigger value="finished"><Warehouse className="h-4 w-4 ml-1" />العلف الجاهز</TabsTrigger>
            <TabsTrigger value="purchases"><ShoppingCart className="h-4 w-4 ml-1" />المشتريات</TabsTrigger>
            <TabsTrigger value="sales"><Banknote className="h-4 w-4 ml-1" />المبيعات</TabsTrigger>
          </TabsList>

          {/* RAW STOCK */}
          <TabsContent value="raw">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div><CardTitle>المواد الخام تحت التصنيع</CardTitle><CardDescription>الرصيد الحالي ومتوسط تكلفة كل خامة</CardDescription></div>
                {canEditStock && <Button onClick={() => setEditRaw({})}><Plus className="h-4 w-4 ml-1" />إضافة خامة</Button>}
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow><TableHead>الصنف</TableHead><TableHead>الرصيد</TableHead><TableHead>الوحدة</TableHead><TableHead>متوسط التكلفة</TableHead><TableHead>القيمة الإجمالية</TableHead><TableHead>المورد</TableHead>{canEditStock && <TableHead></TableHead>}</TableRow></TableHeader>
                  <TableBody>
                    {(rawQ.data || []).map((r: any) => {
                      const low = Number(r.stock) <= Number(r.low_stock_threshold || 0);
                      return (
                        <TableRow key={r.id}>
                          <TableCell className="font-medium">{r.name} {low && <AlertTriangle className="inline h-3 w-3 text-destructive" />}</TableCell>
                          <TableCell className={low ? "text-destructive font-bold" : ""}>{fmt(Number(r.stock))}</TableCell>
                          <TableCell>{r.unit || "كجم"}</TableCell>
                          <TableCell>{fmt(Number(r.unit_cost))}</TableCell>
                          <TableCell className="font-bold">{fmt(Number(r.stock) * Number(r.unit_cost))}</TableCell>
                          <TableCell className="text-muted-foreground text-xs">{r.supplier || "-"}</TableCell>
                          {canEditStock && <TableCell><Button size="icon" variant="ghost" onClick={() => setEditRaw(r)}><Pencil className="h-4 w-4" /></Button></TableCell>}
                        </TableRow>
                      );
                    })}
                    {!rawQ.data?.length && <TableRow><TableCell colSpan={canEditStock ? 7 : 6} className="text-center text-muted-foreground py-6">لا توجد خامات</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>


          {/* FINISHED STOCK */}
          <TabsContent value="finished">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div><CardTitle>العلف الجاهز للبيع</CardTitle><CardDescription>الرصيد بالكيلو والشكاير لكل منتج</CardDescription></div>
                {canEditStock && <Button onClick={() => setEditProd({})}><Plus className="h-4 w-4 ml-1" />إضافة منتج</Button>}
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {(prodQ.data || []).map((p: any) => {
                    const bag = Number(p.default_bag_kg || 50);
                    const stock = Number(p.current_stock || 0);
                    const bags = bag > 0 ? stock / bag : 0;
                    const value = stock * Number(p.latest_unit_cost || 0);
                    return (
                      <Card key={p.id} className="border-primary/20">
                        <CardContent className="p-4 space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="font-bold">{p.name}</div>
                            <div className="flex items-center gap-1">
                              <Badge variant="outline">{p.stage}</Badge>
                              {canEditStock && <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditProd(p)}><Pencil className="h-3.5 w-3.5" /></Button>}
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-sm">
                            <div><div className="text-xs text-muted-foreground">الكمية</div><div className="font-bold text-lg text-primary">{fmt(stock)} كجم</div></div>
                            <div><div className="text-xs text-muted-foreground">عدد الشكاير</div><div className="font-bold text-lg text-secondary">{fmt(bags)}</div><div className="text-xs text-muted-foreground">({bag} كجم/شيكارة)</div></div>
                            <div><div className="text-xs text-muted-foreground">متوسط التكلفة</div><div>{fmt(Number(p.latest_unit_cost))} ج/كجم</div></div>
                            <div><div className="text-xs text-muted-foreground">سعر البيع</div><div>{fmt(Number(p.selling_price || 0))} ج/كجم</div></div>
                          </div>
                          <div className="pt-2 border-t flex justify-between text-sm"><span className="text-muted-foreground">القيمة الإجمالية</span><span className="font-bold">{fmt(value)} ج.م</span></div>
                        </CardContent>
                      </Card>
                    );
                  })}
                  {!prodQ.data?.length && <div className="text-center text-muted-foreground py-6 col-span-full">لا توجد منتجات</div>}
                </div>
              </CardContent>
            </Card>
          </TabsContent>


          {/* PURCHASES */}
          <TabsContent value="purchases">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div><CardTitle>مشتريات المواد الخام</CardTitle><CardDescription>سجل فواتير الشراء من الموردين</CardDescription></div>
                <Button onClick={() => setPurchaseOpen(true)}><Plus className="h-4 w-4 ml-1" />شراء خامات</Button>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow><TableHead>رقم الفاتورة</TableHead><TableHead>التاريخ</TableHead><TableHead>المورد</TableHead><TableHead>عدد البنود</TableHead><TableHead>الإجمالي</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {(purQ.data || []).map((p: any) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-mono text-xs">{p.purchase_no}</TableCell>
                        <TableCell>{p.purchase_date}</TableCell>
                        <TableCell>{p.supplier || "-"}</TableCell>
                        <TableCell>{p.feed_raw_purchase_items?.length || 0}</TableCell>
                        <TableCell className="font-bold">{fmt(Number(p.total_amount))} ج.م</TableCell>
                      </TableRow>
                    ))}
                    {!purQ.data?.length && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">لا توجد مشتريات</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* SALES */}
          <TabsContent value="sales">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div><CardTitle>مبيعات العلف</CardTitle><CardDescription>سجل المبيعات والأرباح</CardDescription></div>
                <Button onClick={() => setSaleOpen(true)}><Plus className="h-4 w-4 ml-1" />فاتورة بيع</Button>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow><TableHead>رقم البيع</TableHead><TableHead>التاريخ</TableHead><TableHead>العميل</TableHead><TableHead>الإجمالي</TableHead><TableHead>التكلفة</TableHead><TableHead>الربح</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {(salesQ.data || []).map((s: any) => (
                      <TableRow key={s.id}>
                        <TableCell className="font-mono text-xs">{s.sale_no}</TableCell>
                        <TableCell>{s.sale_date}</TableCell>
                        <TableCell>{s.customer || "-"}</TableCell>
                        <TableCell>{fmt(Number(s.total_amount))}</TableCell>
                        <TableCell className="text-muted-foreground">{fmt(Number(s.total_cost))}</TableCell>
                        <TableCell className="font-bold text-success">{fmt(Number(s.profit))}</TableCell>
                      </TableRow>
                    ))}
                    {!salesQ.data?.length && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">لا توجد مبيعات</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <PurchaseDialog open={purchaseOpen} onOpenChange={setPurchaseOpen} materials={rawQ.data || []} onSaved={() => { qc.invalidateQueries({ queryKey: ["feed-raw-materials"] }); qc.invalidateQueries({ queryKey: ["feed-purchases"] }); }} />
        <SaleDialog open={saleOpen} onOpenChange={setSaleOpen} products={prodQ.data || []} onSaved={() => { qc.invalidateQueries({ queryKey: ["feed-products"] }); qc.invalidateQueries({ queryKey: ["feed-sales"] }); }} />
        {canEditStock && <RawMaterialDialog item={editRaw} onClose={() => setEditRaw(null)} onSaved={() => qc.invalidateQueries({ queryKey: ["feed-raw-materials"] })} />}
        {canEditStock && <ProductDialog item={editProd} onClose={() => setEditProd(null)} onSaved={() => qc.invalidateQueries({ queryKey: ["feed-products"] })} />}
      </div>
    </DashboardLayout>
  );
}

function RawMaterialDialog({ item, onClose, onSaved }: { item: any | null; onClose: () => void; onSaved: () => void }) {
  const open = item !== null;
  const isEdit = !!item?.id;
  const [name, setName] = useState(item?.name || "");
  const [unit, setUnit] = useState(item?.unit || "كجم");
  const [stock, setStock] = useState<number>(Number(item?.stock || 0));
  const [unitCost, setUnitCost] = useState<number>(Number(item?.unit_cost || 0));
  const [lowThr, setLowThr] = useState<number>(Number(item?.low_stock_threshold || 0));
  const [supplier, setSupplier] = useState(item?.supplier || "");
  const [saving, setSaving] = useState(false);
  // reset when item changes
  useMemo(() => {
    setName(item?.name || ""); setUnit(item?.unit || "كجم");
    setStock(Number(item?.stock || 0)); setUnitCost(Number(item?.unit_cost || 0));
    setLowThr(Number(item?.low_stock_threshold || 0)); setSupplier(item?.supplier || "");
  }, [item?.id]);

  const save = async () => {
    if (!name.trim()) return toast.error("اكتب اسم الخامة");
    setSaving(true);
    try {
      const payload = { name, unit, stock, unit_cost: unitCost, low_stock_threshold: lowThr, supplier, is_active: true };
      const { error } = isEdit
        ? await supabase.from("feed_raw_materials").update(payload).eq("id", item.id)
        : await supabase.from("feed_raw_materials").insert(payload);
      if (error) throw error;
      toast.success(isEdit ? "تم تحديث الخامة" : "تم إضافة الخامة");
      onClose(); onSaved();
    } catch (e: any) { toast.error(e.message || "فشل الحفظ"); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader><DialogTitle>{isEdit ? "تعديل خامة" : "إضافة خامة جديدة"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><Label>اسم الخامة</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><Label>الوحدة</Label><Input value={unit} onChange={(e) => setUnit(e.target.value)} /></div>
          <div><Label>المورد</Label><Input value={supplier} onChange={(e) => setSupplier(e.target.value)} /></div>
          <div><Label>الرصيد الحالي</Label><Input type="number" value={stock} onChange={(e) => setStock(Number(e.target.value))} /></div>
          <div><Label>متوسط التكلفة</Label><Input type="number" value={unitCost} onChange={(e) => setUnitCost(Number(e.target.value))} /></div>
          <div><Label>حد التنبيه</Label><Input type="number" value={lowThr} onChange={(e) => setLowThr(Number(e.target.value))} /></div>
        </div>
        <DialogFooter><Button onClick={save} disabled={saving}>{saving ? "جاري الحفظ..." : "حفظ"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProductDialog({ item, onClose, onSaved }: { item: any | null; onClose: () => void; onSaved: () => void }) {
  const open = item !== null;
  const isEdit = !!item?.id;
  const [name, setName] = useState(item?.name || "");
  const [stage, setStage] = useState(item?.stage || "تسمين");
  const [feedCode, setFeedCode] = useState(item?.feed_code || "");
  const [bagKg, setBagKg] = useState<number>(Number(item?.default_bag_kg || 50));
  const [stock, setStock] = useState<number>(Number(item?.current_stock || 0));
  const [cost, setCost] = useState<number>(Number(item?.latest_unit_cost || 0));
  const [price, setPrice] = useState<number>(Number(item?.selling_price || 0));
  const [saving, setSaving] = useState(false);
  useMemo(() => {
    setName(item?.name || ""); setStage(item?.stage || "تسمين"); setFeedCode(item?.feed_code || "");
    setBagKg(Number(item?.default_bag_kg || 50)); setStock(Number(item?.current_stock || 0));
    setCost(Number(item?.latest_unit_cost || 0)); setPrice(Number(item?.selling_price || 0));
  }, [item?.id]);

  const save = async () => {
    if (!name.trim() || !feedCode.trim()) return toast.error("اكتب اسم وكود المنتج");
    setSaving(true);
    try {
      const payload: any = { name, stage, feed_code: feedCode, default_bag_kg: bagKg, current_stock: stock, latest_unit_cost: cost, selling_price: price };
      const { error } = isEdit
        ? await supabase.from("feed_products").update(payload).eq("id", item.id)
        : await supabase.from("feed_products").insert(payload);
      if (error) throw error;
      toast.success(isEdit ? "تم تحديث المنتج" : "تم إضافة المنتج");
      onClose(); onSaved();
    } catch (e: any) { toast.error(e.message || "فشل الحفظ"); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader><DialogTitle>{isEdit ? "تعديل منتج علف" : "إضافة منتج علف جاهز"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>اسم المنتج</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><Label>كود المنتج</Label><Input value={feedCode} onChange={(e) => setFeedCode(e.target.value)} /></div>
          <div><Label>المرحلة</Label><Input value={stage} onChange={(e) => setStage(e.target.value)} placeholder="تسمين / بادي / بياض ..." /></div>
          <div><Label>وزن الشيكارة (كجم)</Label><Input type="number" value={bagKg} onChange={(e) => setBagKg(Number(e.target.value))} /></div>
          <div><Label>الرصيد الحالي (كجم)</Label><Input type="number" value={stock} onChange={(e) => setStock(Number(e.target.value))} /></div>
          <div><Label>متوسط التكلفة (ج/كجم)</Label><Input type="number" value={cost} onChange={(e) => setCost(Number(e.target.value))} /></div>
          <div className="col-span-2"><Label>سعر البيع (ج/كجم)</Label><Input type="number" value={price} onChange={(e) => setPrice(Number(e.target.value))} /></div>
        </div>
        <DialogFooter><Button onClick={save} disabled={saving}>{saving ? "جاري الحفظ..." : "حفظ"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


function PurchaseDialog({ open, onOpenChange, materials, onSaved }: any) {
  const [supplier, setSupplier] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [saving, setSaving] = useState(false);
  const total = lines.reduce((s, l) => s + l.qty * l.price, 0);

  const save = async () => {
    const valid = lines.filter((l) => l.ref_id && l.qty > 0 && l.price >= 0);
    if (!valid.length) return toast.error("أضف بنداً واحداً على الأقل");
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: head, error: e1 } = await supabase.from("feed_raw_purchases").insert({
        supplier, supplier_invoice_no: invoiceNo, purchase_date: date, notes, created_by: user?.id,
      }).select("id").single();
      if (e1) throw e1;
      const { error: e2 } = await supabase.from("feed_raw_purchase_items").insert(
        valid.map((l) => ({ purchase_id: head.id, raw_material_id: l.ref_id, quantity: l.qty, unit_price: l.price }))
      );
      if (e2) throw e2;
      toast.success("تم حفظ فاتورة الشراء وتحديث المخزون");
      onOpenChange(false); onSaved();
      setSupplier(""); setInvoiceNo(""); setNotes(""); setLines([newLine()]);
    } catch (err: any) { toast.error(err.message || "فشل الحفظ"); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl" dir="rtl">
        <DialogHeader><DialogTitle>فاتورة شراء مواد خام</DialogTitle></DialogHeader>
        <div className="grid grid-cols-3 gap-3">
          <div><Label>المورد</Label><Input value={supplier} onChange={(e) => setSupplier(e.target.value)} /></div>
          <div><Label>رقم فاتورة المورد</Label><Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} /></div>
          <div><Label>التاريخ</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between"><Label>بنود الشراء</Label><Button size="sm" variant="outline" onClick={() => setLines([...lines, newLine()])}><Plus className="h-3 w-3 ml-1" />بند</Button></div>
          {lines.map((l, i) => (
            <div key={l.id} className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-5"><Select value={l.ref_id} onValueChange={(v) => setLines(lines.map((x) => x.id === l.id ? { ...x, ref_id: v } : x))}><SelectTrigger><SelectValue placeholder="اختر الخامة" /></SelectTrigger><SelectContent>{materials.map((m: any) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="col-span-2"><Input type="number" placeholder="الكمية" value={l.qty || ""} onChange={(e) => setLines(lines.map((x) => x.id === l.id ? { ...x, qty: Number(e.target.value) } : x))} /></div>
              <div className="col-span-2"><Input type="number" placeholder="سعر الوحدة" value={l.price || ""} onChange={(e) => setLines(lines.map((x) => x.id === l.id ? { ...x, price: Number(e.target.value) } : x))} /></div>
              <div className="col-span-2 text-sm font-bold text-left">{fmt(l.qty * l.price)}</div>
              <div className="col-span-1"><Button size="icon" variant="ghost" onClick={() => setLines(lines.filter((x) => x.id !== l.id))}><Trash2 className="h-4 w-4" /></Button></div>
            </div>
          ))}
        </div>
        <div><Label>ملاحظات</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></div>
        <div className="text-left text-xl font-bold">الإجمالي: {fmt(total)} ج.م</div>
        <DialogFooter><Button onClick={save} disabled={saving}>{saving ? "جاري الحفظ..." : "حفظ الفاتورة"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SaleDialog({ open, onOpenChange, products, onSaved }: any) {
  const [customer, setCustomer] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [saving, setSaving] = useState(false);
  const total = lines.reduce((s, l) => s + l.qty * l.price, 0);

  const save = async () => {
    const valid = lines.filter((l) => l.ref_id && l.qty > 0 && l.price >= 0);
    if (!valid.length) return toast.error("أضف بنداً واحداً على الأقل");
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: head, error: e1 } = await supabase.from("feed_sales").insert({
        customer, sale_date: date, notes, created_by: user?.id,
      }).select("id").single();
      if (e1) throw e1;
      // insert items one by one so trigger errors surface clearly
      for (const l of valid) {
        const { error } = await supabase.from("feed_sale_items").insert({ sale_id: head.id, feed_product_id: l.ref_id, quantity: l.qty, unit_price: l.price });
        if (error) throw error;
      }
      toast.success("تم حفظ فاتورة البيع وخصم المخزون");
      onOpenChange(false); onSaved();
      setCustomer(""); setNotes(""); setLines([newLine()]);
    } catch (err: any) { toast.error(err.message || "فشل الحفظ"); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl" dir="rtl">
        <DialogHeader><DialogTitle>فاتورة بيع علف</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>العميل</Label><Input value={customer} onChange={(e) => setCustomer(e.target.value)} /></div>
          <div><Label>التاريخ</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between"><Label>البنود</Label><Button size="sm" variant="outline" onClick={() => setLines([...lines, newLine()])}><Plus className="h-3 w-3 ml-1" />بند</Button></div>
          {lines.map((l) => {
            const p = products.find((x: any) => x.id === l.ref_id);
            return (
              <div key={l.id} className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-5"><Select value={l.ref_id} onValueChange={(v) => {
                  const prod = products.find((x: any) => x.id === v);
                  setLines(lines.map((x) => x.id === l.id ? { ...x, ref_id: v, price: Number(prod?.selling_price || x.price) } : x));
                }}><SelectTrigger><SelectValue placeholder="اختر المنتج" /></SelectTrigger><SelectContent>{products.map((m: any) => <SelectItem key={m.id} value={m.id}>{m.name} (متاح: {fmt(Number(m.current_stock))} كجم)</SelectItem>)}</SelectContent></Select>{p && <div className="text-xs text-muted-foreground mt-1">تكلفة: {fmt(Number(p.latest_unit_cost))}</div>}</div>
                <div className="col-span-2"><Input type="number" placeholder="الكمية كجم" value={l.qty || ""} onChange={(e) => setLines(lines.map((x) => x.id === l.id ? { ...x, qty: Number(e.target.value) } : x))} /></div>
                <div className="col-span-2"><Input type="number" placeholder="سعر الكيلو" value={l.price || ""} onChange={(e) => setLines(lines.map((x) => x.id === l.id ? { ...x, price: Number(e.target.value) } : x))} /></div>
                <div className="col-span-2 text-sm font-bold text-left">{fmt(l.qty * l.price)}</div>
                <div className="col-span-1"><Button size="icon" variant="ghost" onClick={() => setLines(lines.filter((x) => x.id !== l.id))}><Trash2 className="h-4 w-4" /></Button></div>
              </div>
            );
          })}
        </div>
        <div><Label>ملاحظات</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></div>
        <div className="text-left text-xl font-bold">الإجمالي: {fmt(total)} ج.م</div>
        <DialogFooter><Button onClick={save} disabled={saving}>{saving ? "جاري الحفظ..." : "حفظ الفاتورة"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
