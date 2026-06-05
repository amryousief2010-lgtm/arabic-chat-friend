import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Package, Warehouse, Factory, ArrowRightCircle, Plus, Trash2, Loader2, Pencil, History, Scale } from "lucide-react";
import { Switch } from "@/components/ui/switch";

interface RawRow {
  id: string;
  material_code: string;
  name_ar: string;
  default_unit: string;
  stock: number;
  avg_unit_cost: number;
  is_active: boolean;
  notes: string | null;
  category: string;
}
interface FinishedRow { id: string; name_ar: string; current_stock: number; latest_unit_cost: number; sale_price: number | null; }
interface ProdItem { raw_material_id: string; quantity: string; }
interface InvoiceRow { id: string; prod_no: string; prod_date: string; product_id: string; qty_produced: number; total_cost: number; unit_cost: number; transferred_to_main_qty: number; notes: string | null; created_at: string; }
interface TransferRow { id: string; transfer_no: string; product_id: string; quantity: number; unit_cost: number; total_cost: number; notes: string | null; created_at: string; }

export default function MeatProductionWarehouses() {
  const { user, isGeneralManager, isExecutiveManager, canManageMeatFactory, isWarehouseSupervisor } = useAuth();
  const qc = useQueryClient();
  const canManage = true; // RLS handles the real guard
  const canDelete = isGeneralManager || isExecutiveManager;
  const canManageRaw = isGeneralManager || isExecutiveManager || canManageMeatFactory || isWarehouseSupervisor;

  const [search, setSearch] = useState("");
  const [prodOpen, setProdOpen] = useState(false);
  const [transferTarget, setTransferTarget] = useState<FinishedRow | null>(null);
  const [editRaw, setEditRaw] = useState<RawRow | null>(null);
  const [addRawOpen, setAddRawOpen] = useState(false);
  const [adjustRaw, setAdjustRaw] = useState<RawRow | null>(null);
  const [movementsRaw, setMovementsRaw] = useState<RawRow | null>(null);

  const rawQ = useQuery({
    queryKey: ["meat-raw-materials"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meat_factory_raw_materials")
        .select("id,material_code,name_ar,default_unit,stock,avg_unit_cost,is_active,notes,category")
        .order("is_active", { ascending: false })
        .order("name_ar");
      if (error) throw error;
      return (data || []) as RawRow[];
    },
  });

  const finishedQ = useQuery({
    queryKey: ["meat-finished-products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meat_factory_products")
        .select("id,name_ar,current_stock,latest_unit_cost,sale_price")
        .eq("is_active", true)
        .order("name_ar");
      if (error) throw error;
      return (data || []) as FinishedRow[];
    },
  });

  const invoicesQ = useQuery({
    queryKey: ["meat-prod-invoices"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meat_production_invoices")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data || []) as InvoiceRow[];
    },
  });

  const transfersQ = useQuery({
    queryKey: ["meat-prod-transfers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meat_production_transfers")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data || []) as TransferRow[];
    },
  });

  const productById = useMemo(() => {
    const m = new Map<string, FinishedRow>();
    (finishedQ.data || []).forEach((p) => m.set(p.id, p));
    return m;
  }, [finishedQ.data]);

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["meat-raw-materials"] });
    qc.invalidateQueries({ queryKey: ["meat-finished-products"] });
    qc.invalidateQueries({ queryKey: ["meat-prod-invoices"] });
    qc.invalidateQueries({ queryKey: ["meat-prod-transfers"] });
  };

  const filteredRaw = useMemo(() => {
    const q = search.trim();
    return (rawQ.data || []).filter((r) => !q || r.name_ar.includes(q));
  }, [rawQ.data, search]);
  const filteredFinished = useMemo(() => {
    const q = search.trim();
    return (finishedQ.data || []).filter((p) => !q || p.name_ar.includes(q));
  }, [finishedQ.data, search]);

  const deleteInvoice = async (id: string) => {
    if (!window.confirm("حذف فاتورة التصنيع؟ سيتم إرجاع الخامات المستهلكة (لكن لن يُخصم المنتج التام تلقائياً).")) return;
    const { error } = await supabase.from("meat_production_invoices").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("تم حذف الفاتورة");
    refreshAll();
  };

  return (
    <DashboardLayout>
      <Header title="مصنع اللحوم — التصنيع والمنتج التام" subtitle="مواد جاهزة للتصنيع، فواتير التصنيع، المنتج التام، والتحويل للمخزن الرئيسي" />

      <div className="p-4 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input placeholder="بحث باسم الصنف..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
          <Button variant="outline" onClick={refreshAll}>تحديث</Button>
        </div>

        <Tabs defaultValue="raw" className="w-full">
          <TabsList className="flex-wrap">
            <TabsTrigger value="raw"><Package className="h-4 w-4 ml-1" />مواد جاهزة للتصنيع</TabsTrigger>
            <TabsTrigger value="finished"><Warehouse className="h-4 w-4 ml-1" />منتج تام</TabsTrigger>
            <TabsTrigger value="invoices"><Factory className="h-4 w-4 ml-1" />فواتير التصنيع</TabsTrigger>
            <TabsTrigger value="transfers"><ArrowRightCircle className="h-4 w-4 ml-1" />تحويلات للرئيسي</TabsTrigger>
          </TabsList>

          {/* Raw Materials */}
          <TabsContent value="raw">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2">
                <CardTitle className="text-base">المواد الخام بمصنع اللحوم</CardTitle>
                {canManageRaw && (
                  <Button size="sm" className="gap-1" onClick={() => setAddRawOpen(true)}>
                    <Plus className="w-4 h-4" /> إضافة خامة
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الصنف</TableHead>
                      <TableHead>الوحدة</TableHead>
                      <TableHead className="text-left">الرصيد</TableHead>
                      <TableHead className="text-left">متوسط السعر</TableHead>
                      <TableHead className="text-left">قيمة المخزون</TableHead>
                      <TableHead>الحالة</TableHead>
                      <TableHead className="text-center">إجراءات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRaw.length === 0 ? (
                      <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">لا توجد بيانات</TableCell></TableRow>
                    ) : filteredRaw.map((r) => (
                      <TableRow key={r.id} className={!r.is_active ? "opacity-60" : ""}>
                        <TableCell>
                          <div className="font-medium">{r.name_ar}</div>
                          {r.notes && <div className="text-xs text-muted-foreground">{r.notes}</div>}
                        </TableCell>
                        <TableCell>{r.default_unit}</TableCell>
                        <TableCell className="text-left font-semibold">
                          <Badge variant={Number(r.stock) <= 0 ? "destructive" : "outline"}>
                            {Number(r.stock).toLocaleString("ar-EG", { maximumFractionDigits: 3 })}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-left">{Number(r.avg_unit_cost).toLocaleString("ar-EG", { maximumFractionDigits: 2 })}</TableCell>
                        <TableCell className="text-left">{(Number(r.stock) * Number(r.avg_unit_cost)).toLocaleString("ar-EG", { maximumFractionDigits: 2 })}</TableCell>
                        <TableCell>
                          <Badge variant={r.is_active ? "default" : "secondary"}>
                            {r.is_active ? "نشطة" : "غير نشطة"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-center gap-1">
                            <Button size="sm" variant="ghost" title="سجل الحركات" onClick={() => setMovementsRaw(r)}>
                              <History className="w-4 h-4" />
                            </Button>
                            {canManageRaw && (
                              <>
                                <Button size="sm" variant="ghost" title="تسوية رصيد" onClick={() => setAdjustRaw(r)}>
                                  <Scale className="w-4 h-4" />
                                </Button>
                                <Button size="sm" variant="ghost" title="تعديل" onClick={() => setEditRaw(r)}>
                                  <Pencil className="w-4 h-4" />
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Finished Products */}
          <TabsContent value="finished">
            <Card>
              <CardHeader><CardTitle className="text-base">المنتج التام الجاهز للبيع / التحويل</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>المنتج</TableHead>
                      <TableHead className="text-left">الرصيد بالمصنع</TableHead>
                      <TableHead className="text-left">تكلفة الوحدة</TableHead>
                      <TableHead className="text-left">سعر البيع</TableHead>
                      <TableHead className="text-left">تحويل للرئيسي</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredFinished.length === 0 ? (
                      <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">لا توجد منتجات</TableCell></TableRow>
                    ) : filteredFinished.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell>{p.name_ar}</TableCell>
                        <TableCell className="text-left">
                          <Badge variant={Number(p.current_stock) <= 0 ? "destructive" : "default"}>
                            {Number(p.current_stock).toLocaleString("ar-EG", { maximumFractionDigits: 3 })}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-left">{Number(p.latest_unit_cost).toLocaleString("ar-EG", { maximumFractionDigits: 2 })}</TableCell>
                        <TableCell className="text-left">{p.sale_price ? Number(p.sale_price).toLocaleString("ar-EG") : "—"}</TableCell>
                        <TableCell className="text-left">
                          <Button size="sm" variant="outline" disabled={Number(p.current_stock) <= 0} onClick={() => setTransferTarget(p)}>
                            <ArrowRightCircle className="w-4 h-4 ml-1" />تحويل
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Production Invoices */}
          <TabsContent value="invoices">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">فواتير التصنيع</CardTitle>
                <Dialog open={prodOpen} onOpenChange={setProdOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" className="gap-1"><Plus className="w-4 h-4" />فاتورة تصنيع جديدة</Button>
                  </DialogTrigger>
                  <ProductionDialog
                    open={prodOpen}
                    onOpenChange={setProdOpen}
                    rawMaterials={(rawQ.data || []).filter((r) => r.is_active)}
                    products={finishedQ.data || []}
                    onSaved={refreshAll}
                  />
                </Dialog>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>رقم الفاتورة</TableHead>
                      <TableHead>التاريخ</TableHead>
                      <TableHead>المنتج</TableHead>
                      <TableHead className="text-left">الكمية المنتجة</TableHead>
                      <TableHead className="text-left">إجمالى التكلفة</TableHead>
                      <TableHead className="text-left">تكلفة الكيلو</TableHead>
                      <TableHead className="text-left">المحول للرئيسي</TableHead>
                      <TableHead>ملاحظات</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(invoicesQ.data || []).length === 0 ? (
                      <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground">لا توجد فواتير بعد</TableCell></TableRow>
                    ) : (invoicesQ.data || []).map((inv) => (
                      <TableRow key={inv.id}>
                        <TableCell className="font-mono text-xs">{inv.prod_no}</TableCell>
                        <TableCell>{inv.prod_date}</TableCell>
                        <TableCell>{productById.get(inv.product_id)?.name_ar || "—"}</TableCell>
                        <TableCell className="text-left">{Number(inv.qty_produced).toLocaleString("ar-EG", { maximumFractionDigits: 3 })}</TableCell>
                        <TableCell className="text-left">{Number(inv.total_cost).toLocaleString("ar-EG", { maximumFractionDigits: 2 })}</TableCell>
                        <TableCell className="text-left">{Number(inv.unit_cost).toLocaleString("ar-EG", { maximumFractionDigits: 2 })}</TableCell>
                        <TableCell className="text-left">{Number(inv.transferred_to_main_qty).toLocaleString("ar-EG", { maximumFractionDigits: 3 })}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{inv.notes || "—"}</TableCell>
                        <TableCell>
                          {canDelete && (
                            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => deleteInvoice(inv.id)}>
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Transfers Log */}
          <TabsContent value="transfers">
            <Card>
              <CardHeader><CardTitle className="text-base">سجل تحويل المنتج التام للمخزن الرئيسي</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>رقم التحويل</TableHead>
                      <TableHead>التاريخ</TableHead>
                      <TableHead>المنتج</TableHead>
                      <TableHead className="text-left">الكمية</TableHead>
                      <TableHead className="text-left">تكلفة الوحدة</TableHead>
                      <TableHead className="text-left">الإجمالى</TableHead>
                      <TableHead>ملاحظات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(transfersQ.data || []).length === 0 ? (
                      <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">لا توجد تحويلات بعد</TableCell></TableRow>
                    ) : (transfersQ.data || []).map((t) => (
                      <TableRow key={t.id}>
                        <TableCell className="font-mono text-xs">{t.transfer_no}</TableCell>
                        <TableCell>{new Date(t.created_at).toLocaleDateString("ar-EG")}</TableCell>
                        <TableCell>{productById.get(t.product_id)?.name_ar || "—"}</TableCell>
                        <TableCell className="text-left">{Number(t.quantity).toLocaleString("ar-EG", { maximumFractionDigits: 3 })}</TableCell>
                        <TableCell className="text-left">{Number(t.unit_cost).toLocaleString("ar-EG", { maximumFractionDigits: 2 })}</TableCell>
                        <TableCell className="text-left">{Number(t.total_cost).toLocaleString("ar-EG", { maximumFractionDigits: 2 })}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{t.notes || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <TransferDialog
        target={transferTarget}
        onClose={() => setTransferTarget(null)}
        onSaved={refreshAll}
      />

      <RawMaterialEditDialog
        mode="add"
        open={addRawOpen}
        onOpenChange={setAddRawOpen}
        onSaved={refreshAll}
      />
      <RawMaterialEditDialog
        mode="edit"
        target={editRaw}
        open={!!editRaw}
        onOpenChange={(o) => !o && setEditRaw(null)}
        onSaved={refreshAll}
      />
      <RawAdjustStockDialog
        target={adjustRaw}
        onClose={() => setAdjustRaw(null)}
        onSaved={refreshAll}
      />
      <RawMovementsDialog
        target={movementsRaw}
        onClose={() => setMovementsRaw(null)}
      />
    </DashboardLayout>
  );
}

function ProductionDialog({ open, onOpenChange, rawMaterials, products, onSaved }: any) {
  const [productId, setProductId] = useState("");
  const [qtyProduced, setQtyProduced] = useState("");
  const [prodDate, setProdDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<ProdItem[]>([{ raw_material_id: "", quantity: "" }]);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setProductId(""); setQtyProduced(""); setNotes("");
    setProdDate(new Date().toISOString().slice(0, 10));
    setItems([{ raw_material_id: "", quantity: "" }]);
  };

  const addLine = () => setItems((s) => [...s, { raw_material_id: "", quantity: "" }]);
  const removeLine = (i: number) => setItems((s) => s.filter((_, idx) => idx !== i));
  const updateLine = (i: number, patch: Partial<ProdItem>) =>
    setItems((s) => s.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));

  const totalPreview = useMemo(() => {
    let total = 0;
    items.forEach((li) => {
      const raw = rawMaterials.find((r: RawRow) => r.id === li.raw_material_id);
      const q = Number(li.quantity);
      if (raw && !isNaN(q) && q > 0) total += q * Number(raw.avg_unit_cost || 0);
    });
    return total;
  }, [items, rawMaterials]);

  const save = async () => {
    if (!productId) { toast.error("اختر المنتج التام"); return; }
    const qty = Number(qtyProduced);
    if (!qty || qty <= 0) { toast.error("ادخل كمية إنتاج صحيحة"); return; }
    const valid = items.filter((li) => li.raw_material_id && Number(li.quantity) > 0);
    if (valid.length === 0) { toast.error("ادخل خامة واحدة على الأقل"); return; }

    setSaving(true);
    try {
      const { data: head, error: e1 } = await supabase
        .from("meat_production_invoices")
        .insert({
          product_id: productId,
          qty_produced: qty,
          prod_date: prodDate,
          notes: notes || null,
        })
        .select("id")
        .single();
      if (e1) throw e1;

      const rows = valid.map((li) => ({
        invoice_id: head!.id,
        raw_material_id: li.raw_material_id,
        quantity: Number(li.quantity),
      }));
      const { error: e2 } = await supabase.from("meat_production_invoice_items").insert(rows);
      if (e2) throw e2;

      const { error: e3 } = await (supabase as any).rpc("finalize_meat_production", { _invoice_id: head!.id });
      if (e3) throw e3;

      toast.success("تم حفظ فاتورة التصنيع وتحديث المخزون");
      reset();
      onOpenChange(false);
      onSaved?.();
    } catch (e: any) {
      toast.error(e.message || "تعذّر الحفظ");
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogContent className="max-w-3xl">
      <DialogHeader>
        <DialogTitle>فاتورة تصنيع جديدة</DialogTitle>
        <DialogDescription>اختر المنتج التام والكمية المنتجة، ثم حدّد الخامات المستهلكة.</DialogDescription>
      </DialogHeader>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <Label>المنتج التام</Label>
          <Select value={productId} onValueChange={setProductId}>
            <SelectTrigger><SelectValue placeholder="اختر منتج" /></SelectTrigger>
            <SelectContent>
              {products.map((p: FinishedRow) => (
                <SelectItem key={p.id} value={p.id}>{p.name_ar}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>الكمية المنتجة (كجم)</Label>
          <Input type="number" min="0" step="0.001" value={qtyProduced} onChange={(e) => setQtyProduced(e.target.value)} />
        </div>
        <div>
          <Label>التاريخ</Label>
          <Input type="date" value={prodDate} onChange={(e) => setProdDate(e.target.value)} />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>الخامات المستهلكة</Label>
          <Button type="button" size="sm" variant="outline" onClick={addLine}><Plus className="w-4 h-4 ml-1" />سطر</Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>الخامة</TableHead>
              <TableHead>المتاح</TableHead>
              <TableHead>الكمية</TableHead>
              <TableHead className="text-left">تكلفة السطر</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((li, i) => {
              const raw = rawMaterials.find((r: RawRow) => r.id === li.raw_material_id);
              const q = Number(li.quantity);
              const lineCost = raw && q > 0 ? q * Number(raw.avg_unit_cost || 0) : 0;
              return (
                <TableRow key={i}>
                  <TableCell className="min-w-[200px]">
                    <Select value={li.raw_material_id} onValueChange={(v) => updateLine(i, { raw_material_id: v })}>
                      <SelectTrigger className="h-8"><SelectValue placeholder="اختر خامة" /></SelectTrigger>
                      <SelectContent>
                        {rawMaterials.map((r: RawRow) => (
                          <SelectItem key={r.id} value={r.id}>{r.name_ar} ({Number(r.stock).toLocaleString("ar-EG", { maximumFractionDigits: 2 })})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {raw ? `${Number(raw.stock).toLocaleString("ar-EG", { maximumFractionDigits: 3 })} ${raw.default_unit}` : "—"}
                  </TableCell>
                  <TableCell>
                    <Input type="number" min="0" step="0.001" className="h-8 w-24" value={li.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} />
                  </TableCell>
                  <TableCell className="text-left">{lineCost.toLocaleString("ar-EG", { maximumFractionDigits: 2 })}</TableCell>
                  <TableCell>
                    {items.length > 1 && (
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => removeLine(i)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <div className="text-sm text-muted-foreground text-left">
          إجمالى تكلفة الخامات: <span className="font-semibold text-foreground">{totalPreview.toLocaleString("ar-EG", { maximumFractionDigits: 2 })}</span>
        </div>
      </div>

      <div>
        <Label>ملاحظات</Label>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
        <Button onClick={save} disabled={saving}>
          {saving && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
          حفظ الفاتورة
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function TransferDialog({ target, onClose, onSaved }: { target: FinishedRow | null; onClose: () => void; onSaved: () => void }) {
  const [qty, setQty] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!target) return;
    const q = Number(qty);
    if (!q || q <= 0) { toast.error("ادخل كمية صحيحة"); return; }
    if (q > Number(target.current_stock)) { toast.error("الكمية أكبر من المتاح"); return; }
    setSaving(true);
    try {
      const { error } = await (supabase as any).rpc("meat_production_transfer_to_main", {
        _product_id: target.id,
        _qty: q,
        _invoice_id: null,
        _notes: notes || null,
      });
      if (error) throw error;
      toast.success("تم تحويل الكمية للمخزن الرئيسي");
      setQty(""); setNotes("");
      onClose();
      onSaved();
    } catch (e: any) {
      toast.error(e.message || "فشل التحويل");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>تحويل للمخزن الرئيسي</DialogTitle>
          <DialogDescription>
            {target?.name_ar} — المتاح: {Number(target?.current_stock || 0).toLocaleString("ar-EG", { maximumFractionDigits: 3 })} كجم
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>الكمية</Label>
            <Input type="number" min="0" step="0.001" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus />
          </div>
          <div>
            <Label>ملاحظات (اختياري)</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
            تأكيد التحويل
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Raw material management dialogs (add / edit / adjust stock / movements log)
// ============================================================================

function RawMaterialEditDialog({
  mode,
  target,
  open,
  onOpenChange,
  onSaved,
}: {
  mode: "add" | "edit";
  target?: RawRow | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("كيلو");
  const [cost, setCost] = useState("");
  const [active, setActive] = useState(true);
  const [notes, setNotes] = useState("");
  const [initialStock, setInitialStock] = useState("");
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (open) {
      if (mode === "edit" && target) {
        setName(target.name_ar);
        setUnit(target.default_unit || "كيلو");
        setCost(String(target.avg_unit_cost ?? ""));
        setActive(!!target.is_active);
        setNotes(target.notes || "");
        setInitialStock("");
      } else {
        setName(""); setUnit("كيلو"); setCost(""); setActive(true);
        setNotes(""); setInitialStock("");
      }
    }
  }, [open, mode, target]);

  const save = async () => {
    if (!name.trim()) { toast.error("ادخل اسم الخامة"); return; }
    if (!unit.trim()) { toast.error("ادخل الوحدة"); return; }
    const costN = Number(cost) || 0;
    setSaving(true);
    try {
      if (mode === "add") {
        const initN = Number(initialStock) || 0;
        const code = "RAW-" + Date.now().toString(36).toUpperCase();
        const { data: newRow, error } = await (supabase as any)
          .from("meat_factory_raw_materials")
          .insert({
            material_code: code,
            name_ar: name.trim(),
            default_unit: unit.trim(),
            avg_unit_cost: costN,
            is_active: active,
            notes: notes.trim() || null,
            stock: initN,
            category: "meat",
          })
          .select("id")
          .single();
        if (error) throw error;
        if (initN > 0) {
          await supabase.from("meat_factory_inventory_moves").insert({
            item_kind: "raw",
            item_id: newRow.id,
            item_name: name.trim(),
            direction: "IN",
            quantity: initN,
            unit_cost: costN,
            reason: `رصيد افتتاحي — الكمية قبل: 0 — الكمية بعد: ${initN} — الفرق: +${initN} — إضافة خامة جديدة`,
          });
        }
        toast.success("تمت إضافة الخامة");
      } else if (target) {
        const { error } = await (supabase as any)
          .from("meat_factory_raw_materials")
          .update({
            name_ar: name.trim(),
            default_unit: unit.trim(),
            avg_unit_cost: costN,
            is_active: active,
            notes: notes.trim() || null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", target.id);
        if (error) throw error;
        toast.success("تم تحديث الخامة");
      }
      onOpenChange(false);
      onSaved();
    } catch (e: any) {
      toast.error(e.message || "تعذّر الحفظ");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "add" ? "إضافة خامة جديدة" : "تعديل بيانات الخامة"}</DialogTitle>
          <DialogDescription>
            {mode === "add"
              ? "ادخل بيانات الخامة. لتعديل الرصيد لاحقاً استخدم زر تسوية الرصيد."
              : "لتعديل الرصيد استخدم زر تسوية الرصيد لتسجيل حركة واضحة."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="md:col-span-2">
            <Label>اسم الخامة</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </div>
          <div>
            <Label>الوحدة</Label>
            <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="كيلو / قطعة / عبوة" maxLength={20} />
          </div>
          <div>
            <Label>سعر تكلفة الوحدة</Label>
            <Input type="number" min="0" step="0.001" value={cost} onChange={(e) => setCost(e.target.value)} />
          </div>
          {mode === "add" && (
            <div>
              <Label>الرصيد الافتتاحي</Label>
              <Input type="number" min="0" step="0.001" value={initialStock} onChange={(e) => setInitialStock(e.target.value)} />
            </div>
          )}
          <div className="flex items-end gap-2">
            <Switch checked={active} onCheckedChange={setActive} />
            <Label className="!mb-0">{active ? "نشطة" : "غير نشطة"}</Label>
          </div>
          <div className="md:col-span-2">
            <Label>ملاحظات</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
            حفظ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RawAdjustStockDialog({
  target,
  onClose,
  onSaved,
}: {
  target: RawRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [newStock, setNewStock] = useState("");
  const [reason, setReason] = useState("");
  const [reasonType, setReasonType] = useState("تسوية زيادة");
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (target) {
      setNewStock(String(target.stock));
      setReason("");
      setReasonType("تسوية زيادة");
    }
  }, [target]);

  if (!target) return null;

  const oldStock = Number(target.stock);
  const newN = Number(newStock);
  const diff = isFinite(newN) ? newN - oldStock : 0;

  const submit = async () => {
    if (!isFinite(newN) || newN < 0) { toast.error("ادخل رصيد صحيح غير سالب"); return; }
    if (!reason.trim()) { toast.error("ادخل سبب التعديل"); return; }
    if (diff === 0) { toast.error("لا يوجد فرق في الرصيد"); return; }

    setSaving(true);
    try {
      const { error: e1 } = await (supabase as any)
        .from("meat_factory_raw_materials")
        .update({ stock: newN, updated_at: new Date().toISOString() })
        .eq("id", target.id);
      if (e1) throw e1;

      const direction = diff > 0 ? "IN" : "OUT";
      const fullReason = `${reasonType} — الكمية قبل: ${oldStock} — الكمية بعد: ${newN} — الفرق: ${diff > 0 ? "+" : ""}${diff.toFixed(3)} — ${reason.trim()}`;
      const { error: e2 } = await supabase.from("meat_factory_inventory_moves").insert({
        item_kind: "raw",
        item_id: target.id,
        item_name: target.name_ar,
        direction,
        quantity: Math.abs(diff),
        unit_cost: Number(target.avg_unit_cost) || 0,
        reason: fullReason,
      });
      if (e2) throw e2;

      toast.success("تم تعديل الرصيد وتسجيل الحركة");
      onClose();
      onSaved();
    } catch (e: any) {
      toast.error(e.message || "تعذّر تعديل الرصيد");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>تسوية رصيد — {target.name_ar}</DialogTitle>
          <DialogDescription>
            الرصيد الحالي: {oldStock.toLocaleString("ar-EG", { maximumFractionDigits: 3 })} {target.default_unit}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>نوع الحركة</Label>
            <Select value={reasonType} onValueChange={setReasonType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="رصيد افتتاحي">رصيد افتتاحي</SelectItem>
                <SelectItem value="تسوية زيادة">تسوية زيادة</SelectItem>
                <SelectItem value="تسوية نقص">تسوية نقص</SelectItem>
                <SelectItem value="مرتجع من التصنيع">مرتجع من التصنيع</SelectItem>
                <SelectItem value="صرف للتصنيع">صرف للتصنيع</SelectItem>
                <SelectItem value="هالك / تالف">هالك / تالف</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>الرصيد الجديد</Label>
            <Input type="number" min="0" step="0.001" value={newStock} onChange={(e) => setNewStock(e.target.value)} autoFocus />
            {isFinite(newN) && (
              <div className={`text-xs mt-1 ${diff > 0 ? "text-green-600" : diff < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                الفرق: {diff > 0 ? "+" : ""}{diff.toFixed(3)} {target.default_unit}
              </div>
            )}
          </div>
          <div>
            <Label>سبب التعديل (إجباري)</Label>
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
            حفظ التسوية
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RawMovementsDialog({ target, onClose }: { target: RawRow | null; onClose: () => void }) {
  const movesQ = useQuery({
    queryKey: ["meat-raw-moves", target?.id],
    enabled: !!target,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meat_factory_inventory_moves")
        .select("id,direction,quantity,unit_cost,reason,created_at")
        .eq("item_kind", "raw")
        .eq("item_id", target!.id)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data || [];
    },
  });

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>سجل حركات — {target?.name_ar}</DialogTitle>
          <DialogDescription>آخر 200 حركة على هذه الخامة.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>التاريخ</TableHead>
                <TableHead>الحركة</TableHead>
                <TableHead className="text-left">الكمية</TableHead>
                <TableHead className="text-left">سعر الوحدة</TableHead>
                <TableHead>السبب / البيان</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {movesQ.isLoading ? (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">جارٍ التحميل...</TableCell></TableRow>
              ) : (movesQ.data || []).length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">لا توجد حركات</TableCell></TableRow>
              ) : (movesQ.data || []).map((m: any) => (
                <TableRow key={m.id}>
                  <TableCell className="text-xs">{new Date(m.created_at).toLocaleString("ar-EG")}</TableCell>
                  <TableCell>
                    <Badge variant={m.direction === "IN" ? "default" : "destructive"}>
                      {m.direction === "IN" ? "وارد" : "صادر"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-left font-semibold">
                    {Number(m.quantity).toLocaleString("ar-EG", { maximumFractionDigits: 3 })}
                  </TableCell>
                  <TableCell className="text-left">
                    {Number(m.unit_cost).toLocaleString("ar-EG", { maximumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-pre-wrap">{m.reason}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>إغلاق</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
