import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Wheat, Plus, Edit, Trash2, ArrowLeft, RefreshCw, Printer, FileText } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { openPrintWindow } from "@/lib/printPdf";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

interface Material { id: string; name: string; unit: string; unit_cost: number; stock: number; }
interface Item { raw_material_id: string; quantity: number; }
interface Recipe {
  id: string; name: string; feed_type: string; batch_size: number; unit: string;
  description: string | null; is_active: boolean; feed_product_id: string | null;
  labor_total_cost?: number | null; other_expenses_total?: number | null;
  items?: { id: string; raw_material_id: string; quantity: number; raw_material?: Material }[];
  feed_product?: { id: string; name: string; feed_code: string } | null;
}
interface Product { id: string; name: string; feed_code: string; }

const fmt = (n: number, d = 2) => (Number.isFinite(n) ? n : 0).toLocaleString("en-GB", { maximumFractionDigits: d });

export default function Recipes() {
  const { canManageFeedFactory, user } = useAuth();
  const { toast } = useToast();
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [showInactive, setShowInactive] = useState(false);

  const [dialog, setDialog] = useState(false);
  const [editing, setEditing] = useState<Recipe | null>(null);
  const [form, setForm] = useState({
    name: "", feed_type: "تسمين", batch_size: 1000, unit: "كجم",
    description: "", feed_product_id: "" as string,
    labor_total_cost: 0, other_expenses_total: 0,
  });
  const [items, setItems] = useState<Item[]>([]);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [detailRecipe, setDetailRecipe] = useState<Recipe | null>(null);

  const fetchAll = async () => {
    setLoading(true);
    const [r, m, p] = await Promise.all([
      supabase.from("feed_recipes").select("*, feed_product:feed_products(id,name,feed_code), items:feed_recipe_items(id, raw_material_id, quantity, raw_material:feed_raw_materials(id, name, unit, unit_cost, stock))").order("created_at", { ascending: false }),
      supabase.from("feed_raw_materials").select("id, name, unit, unit_cost, stock").eq("is_active", true).order("name"),
      supabase.from("feed_products").select("id, name, feed_code").is("archived_at", null).order("name"),
    ]);
    if (r.error || m.error || p.error) {
      toast({ title: "خطأ", description: r.error?.message || m.error?.message || p.error?.message, variant: "destructive" });
    }
    setRecipes((r.data || []) as any);
    setMaterials((m.data || []) as Material[]);
    setProducts((p.data || []) as Product[]);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  const visible = useMemo(
    () => recipes.filter(r => showInactive || r.is_active),
    [recipes, showInactive]
  );

  const openDialog = (r?: Recipe) => {
    if (r) {
      setEditing(r);
      setForm({
        name: r.name, feed_type: r.feed_type, batch_size: Number(r.batch_size), unit: r.unit,
        description: r.description || "", feed_product_id: r.feed_product_id || "",
        labor_total_cost: Number(r.labor_total_cost || 0),
        other_expenses_total: Number(r.other_expenses_total || 0),
      });
      setItems((r.items || []).map(i => ({ raw_material_id: i.raw_material_id, quantity: Number(i.quantity) })));
    } else {
      setEditing(null);
      setForm({ name: "", feed_type: "تسمين", batch_size: 1000, unit: "كجم", description: "", feed_product_id: "", labor_total_cost: 0, other_expenses_total: 0 });
      setItems([]);
    }
    setDialog(true);
  };

  const addItem = () => setItems([...items, { raw_material_id: "", quantity: 0 }]);
  const removeItem = (i: number) => setItems(items.filter((_, idx) => idx !== i));
  const updateItem = (i: number, patch: Partial<Item>) =>
    setItems(items.map((it, idx) => idx === i ? { ...it, ...patch } : it));

  // computed: totals & per-item cost
  const itemTotals = items.map(it => {
    const mat = materials.find(m => m.id === it.raw_material_id);
    const cost = it.quantity * (mat?.unit_cost || 0);
    const pct = form.batch_size > 0 ? (it.quantity / form.batch_size) * 100 : 0;
    return { mat, cost, pct };
  });
  const totalQty = items.reduce((s, it) => s + Number(it.quantity || 0), 0);
  const totalCost = itemTotals.reduce((s, t) => s + t.cost, 0);
  const unitCost = form.batch_size > 0 ? totalCost / form.batch_size : 0;

  const save = async () => {
    if (!form.name.trim() || items.length === 0) {
      toast({ title: "بيانات ناقصة", description: "اسم الوصفة وعنصر واحد على الأقل مطلوبان", variant: "destructive" });
      return;
    }
    if (items.some(i => !i.raw_material_id || i.quantity <= 0)) {
      toast({ title: "بنود غير صالحة", description: "تأكد من اختيار مادة وكمية > 0 لكل بند", variant: "destructive" });
      return;
    }
    const payload = {
      name: form.name.trim(),
      feed_type: form.feed_type,
      batch_size: form.batch_size,
      unit: form.unit,
      description: form.description || null,
      feed_product_id: form.feed_product_id || null,
      labor_total_cost: form.labor_total_cost || 0,
      other_expenses_total: form.other_expenses_total || 0,
      created_by: user?.id,
    };
    let recipeId = editing?.id;
    if (editing) {
      const { error } = await supabase.from("feed_recipes").update(payload).eq("id", editing.id);
      if (error) { toast({ title: "خطأ", description: error.message, variant: "destructive" }); return; }
      await supabase.from("feed_recipe_items").delete().eq("recipe_id", editing.id);
    } else {
      const { data, error } = await supabase.from("feed_recipes").insert(payload).select().single();
      if (error || !data) { toast({ title: "خطأ", description: error?.message, variant: "destructive" }); return; }
      recipeId = data.id;
    }
    if (recipeId) {
      const rows = items.map(it => {
        const mat = materials.find(m => m.id === it.raw_material_id);
        return {
          recipe_id: recipeId!,
          raw_material_id: it.raw_material_id,
          quantity: it.quantity,
          unit: mat?.unit || "كجم",
          unit_cost: mat?.unit_cost || 0,
          inclusion_rate_pct: form.batch_size > 0 ? (it.quantity / form.batch_size) * 100 : null,
        };
      });
      const ins = await supabase.from("feed_recipe_items").insert(rows);
      if (ins.error) { toast({ title: "خطأ في البنود", description: ins.error.message, variant: "destructive" }); return; }
    }
    toast({ title: editing ? "تم تعديل الوصفة" : "تمت إضافة الوصفة" });
    setDialog(false);
    fetchAll();
  };

  const toggleActive = async (r: Recipe) => {
    const { error } = await supabase.from("feed_recipes").update({ is_active: !r.is_active }).eq("id", r.id);
    if (error) toast({ title: "خطأ", description: error.message, variant: "destructive" });
    else fetchAll();
  };

  const doDelete = async () => {
    if (!deleteId) return;
    const { error } = await supabase.from("feed_recipes").delete().eq("id", deleteId);
    if (error) toast({ title: "خطأ", description: error.message, variant: "destructive" });
    else { toast({ title: "تم الحذف" }); fetchAll(); }
    setDeleteId(null);
  };

  const computeTotals = (r: Recipe) => {
    const matCost = (r.items || []).reduce((s, it) => s + Number(it.quantity) * (Number(it.raw_material?.unit_cost) || 0), 0);
    const labor = Number(r.labor_total_cost || 0);
    const other = Number(r.other_expenses_total || 0);
    const total = matCost + labor + other;
    const perKg = r.batch_size > 0 ? total / r.batch_size : 0;
    return { matCost, labor, other, total, perKg };
  };

  const printRecipe = (r: Recipe) => {
    const t = computeTotals(r);
    const itemsRows = (r.items || []).map(it => {
      const cost = Number(it.quantity) * (Number(it.raw_material?.unit_cost) || 0);
      return `<tr><td>${it.raw_material?.name || "—"}</td><td>${fmt(Number(it.quantity), 2)}</td><td>${it.raw_material?.unit || "كجم"}</td><td>${fmt(Number(it.raw_material?.unit_cost) || 0, 3)}</td><td>${fmt(cost, 2)}</td></tr>`;
    }).join("");
    const html = `
      <div style="text-align:center;margin-bottom:16px"><h2 style="margin:0">نعام العاصمة</h2><h3 style="margin:4px 0">تركيبة علف — ${r.name}</h3></div>
      <table style="width:100%;margin-bottom:12px"><tr><td><b>المنتج النهائي:</b> ${r.feed_product ? `${r.feed_product.feed_code} — ${r.feed_product.name}` : "—"}</td><td><b>النوع:</b> ${r.feed_type}</td><td><b>الكمية القياسية:</b> ${fmt(r.batch_size, 0)} ${r.unit}</td></tr></table>
      <h4>الخامات</h4>
      <table border="1" style="width:100%;border-collapse:collapse" cellpadding="6">
        <thead><tr><th>الخامة</th><th>الكمية</th><th>الوحدة</th><th>سعر التكلفة</th><th>الإجمالي</th></tr></thead>
        <tbody>${itemsRows || `<tr><td colspan="5" style="text-align:center">لا توجد بنود</td></tr>`}</tbody>
      </table>
      <h4 style="margin-top:16px">ملخص التكلفة</h4>
      <table border="1" style="width:100%;border-collapse:collapse" cellpadding="6">
        <tr><td>إجمالي الخامات</td><td>${fmt(t.matCost, 2)}</td></tr>
        <tr><td>إجمالي الأجور</td><td>${fmt(t.labor, 2)}</td></tr>
        <tr><td>إجمالي المصاريف الأخرى</td><td>${fmt(t.other, 2)}</td></tr>
        <tr><td><b>إجمالي تكلفة التصنيع</b></td><td><b>${fmt(t.total, 2)}</b></td></tr>
        <tr><td><b>تكلفة الكيلو</b></td><td><b>${fmt(t.perKg, 3)}</b></td></tr>
      </table>
      <div style="margin-top:24px;font-size:12px"><div>تاريخ الطباعة: ${new Date().toLocaleString("ar-EG")}</div></div>
      <div style="display:flex;justify-content:space-between;margin-top:48px"><div>توقيع مسؤول مصنع العلف: ____________</div><div>توقيع المدير المعتمد: ____________</div></div>`;
    openPrintWindow(`تركيبة علف — ${r.name}`, html);
  };


  return (
    <DashboardLayout>
      <div className="space-y-6" dir="rtl">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Wheat className="w-7 h-7 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-foreground">وصفات الأعلاف (BOM)</h1>
              <p className="text-muted-foreground mt-1">إدارة بنود الوصفات وحساب التكلفة لكل كجم تلقائيًا</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowInactive(s => !s)}>
              {showInactive ? "إظهار النشطة فقط" : "إظهار غير النشطة أيضًا"}
            </Button>
            <Button variant="outline" size="sm" onClick={fetchAll} disabled={loading}>
              <RefreshCw className={`w-4 h-4 ml-2 ${loading ? "animate-spin" : ""}`} />تحديث
            </Button>
            <Link to="/modules/feed-factory">
              <Button size="sm" variant="ghost"><ArrowLeft className="w-4 h-4 ml-2" />رجوع</Button>
            </Link>
            {canManageFeedFactory && (
              <Button size="sm" onClick={() => openDialog()}><Plus className="w-4 h-4 ml-2" />وصفة جديدة</Button>
            )}
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الاسم</TableHead>
                  <TableHead>المنتج النهائي</TableHead>
                  <TableHead>النوع</TableHead>
                  <TableHead>الكمية القياسية</TableHead>
                  <TableHead>تكلفة الخامات</TableHead>
                  <TableHead>الأجور</TableHead>
                  <TableHead>مصاريف أخرى</TableHead>
                  <TableHead>إجمالي التصنيع</TableHead>
                  <TableHead>تكلفة الكيلو</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead className="text-left">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={11} className="text-center py-8 text-muted-foreground">جارٍ التحميل...</TableCell></TableRow>
                ) : visible.length === 0 ? (
                  <TableRow><TableCell colSpan={11} className="text-center py-8 text-muted-foreground">لا توجد وصفات</TableCell></TableRow>
                ) : visible.map(r => {
                  const matCost = (r.items || []).reduce((s, it) => s + Number(it.quantity) * (Number(it.raw_material?.unit_cost) || 0), 0);
                  const labor = Number(r.labor_total_cost || 0);
                  const other = Number(r.other_expenses_total || 0);
                  const totalCost = matCost + labor + other;
                  const perKg = r.batch_size > 0 ? totalCost / r.batch_size : 0;
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="text-xs">{r.feed_product ? `${r.feed_product.feed_code} — ${r.feed_product.name}` : "—"}</TableCell>
                      <TableCell><Badge variant="outline">{r.feed_type}</Badge></TableCell>
                      <TableCell>{fmt(r.batch_size, 0)} {r.unit}</TableCell>
                      <TableCell>{fmt(matCost, 2)}</TableCell>
                      <TableCell>{fmt(labor, 2)}</TableCell>
                      <TableCell>{fmt(other, 2)}</TableCell>
                      <TableCell className="font-semibold">{fmt(totalCost, 2)}</TableCell>
                      <TableCell className="text-primary font-semibold">{fmt(perKg, 3)}</TableCell>
                      <TableCell>
                        <Badge variant={r.is_active ? "default" : "secondary"}>
                          {r.is_active ? "نشطة" : "موقوفة"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 justify-start flex-wrap">
                          <Button size="sm" variant="ghost" onClick={() => setDetailRecipe(r)} title="عرض التفاصيل"><FileText className="w-4 h-4" /></Button>
                          <Button size="sm" variant="ghost" onClick={() => printRecipe(r)} title="طباعة"><Printer className="w-4 h-4" /></Button>
                          <Button size="sm" variant="outline" onClick={() => nav(`/feed-factory/batches/new?recipe=${r.id}`)} title="استخدام في فاتورة تصنيع">استخدام</Button>
                          {canManageFeedFactory && (
                            <>
                              <Button size="sm" variant="ghost" onClick={() => openDialog(r)} title="تعديل"><Edit className="w-4 h-4" /></Button>
                              <Button size="sm" variant="ghost" onClick={() => toggleActive(r)} title={r.is_active ? "إيقاف" : "تفعيل"}>
                                <Badge variant="outline" className="text-xs">{r.is_active ? "إيقاف" : "تفعيل"}</Badge>
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setDeleteId(r.id)} title="حذف"><Trash2 className="w-4 h-4 text-destructive" /></Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Recipe dialog */}
        <Dialog open={dialog} onOpenChange={setDialog}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" dir="rtl">
            <DialogHeader>
              <DialogTitle>{editing ? "تعديل الوصفة" : "وصفة جديدة"}</DialogTitle>
              <DialogDescription>الكميات لكل دفعة قياسية حجمها {fmt(form.batch_size, 0)} {form.unit}</DialogDescription>
            </DialogHeader>

            <div className="grid gap-3 md:grid-cols-2">
              <div><Label>الاسم *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
              <div>
                <Label>النوع</Label>
                <Select value={form.feed_type} onValueChange={v => setForm({ ...form, feed_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="بادئ">بادئ (كتاكيت)</SelectItem>
                    <SelectItem value="تسمين">تسمين</SelectItem>
                    <SelectItem value="بياض">بياض</SelectItem>
                    <SelectItem value="أمهات">أمهات</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>حجم الدفعة</Label><Input type="number" value={form.batch_size} onChange={e => setForm({ ...form, batch_size: Number(e.target.value) })} /></div>
              <div><Label>إجمالي الأجور</Label><Input type="number" step="0.01" value={form.labor_total_cost} onChange={e => setForm({ ...form, labor_total_cost: Number(e.target.value) })} /></div>
              <div><Label>إجمالي المصاريف الأخرى</Label><Input type="number" step="0.01" value={form.other_expenses_total} onChange={e => setForm({ ...form, other_expenses_total: Number(e.target.value) })} /></div>
              <div>
                <Label>الوحدة</Label>
                <Select value={form.unit} onValueChange={v => setForm({ ...form, unit: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="كجم">كجم</SelectItem>
                    <SelectItem value="طن">طن</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-2">
                <Label>المنتج المرتبط (اختياري)</Label>
                <Select value={form.feed_product_id || "none"} onValueChange={v => setForm({ ...form, feed_product_id: v === "none" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— بدون ربط —</SelectItem>
                    {products.map(p => <SelectItem key={p.id} value={p.id}>{p.feed_code} — {p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-2"><Label>ملاحظات</Label><Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2} /></div>
            </div>

            <div className="space-y-2 mt-4">
              <div className="flex items-center justify-between">
                <Label className="text-base">البنود ({items.length})</Label>
                <Button size="sm" variant="outline" onClick={addItem}><Plus className="w-4 h-4 ml-1" />إضافة بند</Button>
              </div>
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>المادة الخام</TableHead>
                        <TableHead>الكمية</TableHead>
                        <TableHead>الوحدة</TableHead>
                        <TableHead>تكلفة/وحدة</TableHead>
                        <TableHead>إجمالي</TableHead>
                        <TableHead>%</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.length === 0 ? (
                        <TableRow><TableCell colSpan={7} className="text-center py-4 text-muted-foreground text-sm">لا توجد بنود — اضغط "إضافة بند"</TableCell></TableRow>
                      ) : items.map((it, i) => {
                        const t = itemTotals[i];
                        return (
                          <TableRow key={i}>
                            <TableCell className="min-w-[180px]">
                              <Select value={it.raw_material_id || ""} onValueChange={v => updateItem(i, { raw_material_id: v })}>
                                <SelectTrigger><SelectValue placeholder="اختر مادة" /></SelectTrigger>
                                <SelectContent>
                                  {materials.map(m => <SelectItem key={m.id} value={m.id}>{m.name} ({fmt(m.stock, 0)} {m.unit})</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell><Input type="number" step="0.01" value={it.quantity} onChange={e => updateItem(i, { quantity: Number(e.target.value) })} className="w-24" /></TableCell>
                            <TableCell className="text-xs text-muted-foreground">{t.mat?.unit || "—"}</TableCell>
                            <TableCell className="text-xs">{fmt(t.mat?.unit_cost || 0, 3)}</TableCell>
                            <TableCell className="text-xs font-medium">{fmt(t.cost, 2)}</TableCell>
                            <TableCell className="text-xs">{fmt(t.pct, 1)}%</TableCell>
                            <TableCell><Button size="sm" variant="ghost" onClick={() => removeItem(i)}><Trash2 className="w-4 h-4 text-destructive" /></Button></TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
              <div className="grid gap-3 md:grid-cols-3">
                <Card><CardHeader className="pb-2"><CardDescription>إجمالي الكميات</CardDescription><CardTitle className="text-xl">{fmt(totalQty, 2)} {form.unit}</CardTitle></CardHeader></Card>
                <Card><CardHeader className="pb-2"><CardDescription>إجمالي التكلفة</CardDescription><CardTitle className="text-xl">{fmt(totalCost, 2)}</CardTitle></CardHeader></Card>
                <Card><CardHeader className="pb-2"><CardDescription>تكلفة الكجم</CardDescription><CardTitle className="text-xl text-primary">{fmt(unitCost, 3)}</CardTitle></CardHeader></Card>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setDialog(false)}>إلغاء</Button>
              <Button onClick={save}>{editing ? "حفظ التعديلات" : "إنشاء الوصفة"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Detail dialog */}
        <Dialog open={!!detailRecipe} onOpenChange={(o) => !o && setDetailRecipe(null)}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" dir="rtl">
            {detailRecipe && (() => {
              const t = computeTotals(detailRecipe);
              return (
                <>
                  <DialogHeader>
                    <DialogTitle>تفاصيل التركيبة — {detailRecipe.name}</DialogTitle>
                    <DialogDescription>
                      {detailRecipe.feed_product ? `${detailRecipe.feed_product.feed_code} — ${detailRecipe.feed_product.name}` : "بدون منتج مرتبط"} • النوع: {detailRecipe.feed_type} • الكمية القياسية: {fmt(detailRecipe.batch_size, 0)} {detailRecipe.unit}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <Card>
                      <CardHeader className="pb-2"><CardTitle className="text-base">الخامات المستخدمة</CardTitle></CardHeader>
                      <CardContent className="p-0">
                        <Table>
                          <TableHeader><TableRow><TableHead>الخامة</TableHead><TableHead>الكمية</TableHead><TableHead>الوحدة</TableHead><TableHead>سعر التكلفة</TableHead><TableHead>الإجمالي</TableHead></TableRow></TableHeader>
                          <TableBody>
                            {(detailRecipe.items || []).map(it => {
                              const cost = Number(it.quantity) * (Number(it.raw_material?.unit_cost) || 0);
                              return (<TableRow key={it.id}>
                                <TableCell>{it.raw_material?.name || "—"}</TableCell>
                                <TableCell>{fmt(Number(it.quantity), 2)}</TableCell>
                                <TableCell>{it.raw_material?.unit || "كجم"}</TableCell>
                                <TableCell>{fmt(Number(it.raw_material?.unit_cost) || 0, 3)}</TableCell>
                                <TableCell className="font-medium">{fmt(cost, 2)}</TableCell>
                              </TableRow>);
                            })}
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>
                    <div className="grid gap-3 md:grid-cols-5">
                      <Card><CardHeader className="pb-2"><CardDescription>إجمالي الخامات</CardDescription><CardTitle className="text-lg">{fmt(t.matCost, 2)}</CardTitle></CardHeader></Card>
                      <Card><CardHeader className="pb-2"><CardDescription>إجمالي الأجور</CardDescription><CardTitle className="text-lg">{fmt(t.labor, 2)}</CardTitle></CardHeader></Card>
                      <Card><CardHeader className="pb-2"><CardDescription>مصاريف أخرى</CardDescription><CardTitle className="text-lg">{fmt(t.other, 2)}</CardTitle></CardHeader></Card>
                      <Card><CardHeader className="pb-2"><CardDescription>إجمالي التصنيع</CardDescription><CardTitle className="text-lg">{fmt(t.total, 2)}</CardTitle></CardHeader></Card>
                      <Card><CardHeader className="pb-2"><CardDescription>تكلفة الكيلو</CardDescription><CardTitle className="text-lg text-primary">{fmt(t.perKg, 3)}</CardTitle></CardHeader></Card>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => printRecipe(detailRecipe)}><Printer className="w-4 h-4 ml-2" />طباعة</Button>
                    <Button onClick={() => { const id = detailRecipe.id; setDetailRecipe(null); nav(`/feed-factory/batches/new?recipe=${id}`); }}>استخدام في فاتورة تصنيع</Button>
                  </DialogFooter>
                </>
              );
            })()}
          </DialogContent>
        </Dialog>


        {/* Delete confirm */}
        <Dialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
          <DialogContent dir="rtl">
            <DialogHeader>
              <DialogTitle>تأكيد الحذف</DialogTitle>
              <DialogDescription>سيتم حذف الوصفة وبنودها. لا يمكن التراجع.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteId(null)}>إلغاء</Button>
              <Button variant="destructive" onClick={doDelete}>حذف</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
