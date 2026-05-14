import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Pencil, Trash2, Sparkles, ChefHat, Calculator } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Product { id: string; name: string; description: string | null; image_url: string | null; kitchen_section: string; category: string | null; unit: string; computed_cost: number; sale_price: number; market_price_low: number | null; market_price_avg: number | null; market_price_high: number | null; ai_suggested_price: number | null; ai_reasoning: string | null; is_active: boolean; }
interface RawMaterial { id: string; name: string; unit: string; unit_cost: number; }
interface RecipeItem { id?: string; raw_material_id: string; quantity: number; }

const SECTIONS: Record<string, string> = { pastry: "معجنات", dessert: "حلا", hot: "سخن", salad: "سلطات" };
const empty = { name: "", description: "", image_url: "", kitchen_section: "pastry", category: "", unit: "قطعة", sale_price: 0 };

const CateringProducts = () => {
  const [rows, setRows] = useState<Product[]>([]);
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState(empty);
  const [recipe, setRecipe] = useState<RecipeItem[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<{ market_low?: number; market_avg?: number; market_high?: number; suggested_price?: number; suggested_margin_pct?: number; reasoning?: string } | null>(null);

  const computedCost = useMemo(() => {
    return recipe.reduce((sum, r) => {
      const m = materials.find((x) => x.id === r.raw_material_id);
      return sum + (m ? Number(m.unit_cost) * Number(r.quantity || 0) : 0);
    }, 0);
  }, [recipe, materials]);

  const load = async () => {
    const [p, m] = await Promise.all([
      supabase.from("catering_products").select("*").order("created_at", { ascending: false }),
      supabase.from("catering_raw_materials").select("id, name, unit, unit_cost").eq("is_active", true).order("name"),
    ]);
    if (p.error) return toast.error(p.error.message);
    setRows((p.data || []) as Product[]);
    setMaterials((m.data || []) as RawMaterial[]);
  };
  useEffect(() => { load(); }, []);

  const startNew = () => { setEditing(null); setForm(empty); setRecipe([]); setAiResult(null); setOpen(true); };
  const startEdit = async (p: Product) => {
    setEditing(p);
    setForm({ name: p.name, description: p.description || "", image_url: p.image_url || "", kitchen_section: p.kitchen_section, category: p.category || "", unit: p.unit, sale_price: Number(p.sale_price) });
    setAiResult(p.ai_suggested_price ? { market_low: p.market_price_low ?? undefined, market_avg: p.market_price_avg ?? undefined, market_high: p.market_price_high ?? undefined, suggested_price: p.ai_suggested_price, reasoning: p.ai_reasoning || undefined } : null);
    const { data } = await supabase.from("catering_product_recipe_items").select("*").eq("product_id", p.id);
    setRecipe(((data || []) as RecipeItem[]).map((r) => ({ id: r.id, raw_material_id: r.raw_material_id, quantity: Number(r.quantity) })));
    setOpen(true);
  };

  const addRecipeRow = () => setRecipe((r) => [...r, { raw_material_id: "", quantity: 0 }]);
  const updateRecipe = (i: number, patch: Partial<RecipeItem>) => setRecipe((r) => r.map((x, idx) => idx === i ? { ...x, ...patch } : x));
  const removeRecipe = (i: number) => setRecipe((r) => r.filter((_, idx) => idx !== i));

  const suggestPrice = async () => {
    if (!form.name.trim()) return toast.error("أدخل اسم المنتج أولًا");
    setAiLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("suggest-product-price", {
        body: { name: form.name, description: form.description, category: form.category, unit: form.unit, computed_cost: computedCost },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setAiResult(data);
      if (data?.suggested_price) setForm((f) => ({ ...f, sale_price: Number(data.suggested_price) }));
      toast.success("تم اقتراح السعر");
    } catch (e) {
      toast.error((e as Error).message || "فشل الاقتراح");
    } finally { setAiLoading(false); }
  };

  const save = async () => {
    if (!form.name.trim()) return toast.error("الاسم مطلوب");
    const payload = {
      ...form,
      image_url: form.image_url || null,
      computed_cost: computedCost,
      market_price_low: aiResult?.market_low ?? null,
      market_price_avg: aiResult?.market_avg ?? null,
      market_price_high: aiResult?.market_high ?? null,
      ai_suggested_price: aiResult?.suggested_price ?? null,
      ai_reasoning: aiResult?.reasoning ?? null,
    };
    let productId = editing?.id;
    if (editing) {
      const { error } = await supabase.from("catering_products").update(payload).eq("id", editing.id);
      if (error) return toast.error(error.message);
    } else {
      const { data, error } = await supabase.from("catering_products").insert(payload).select("id").single();
      if (error) return toast.error(error.message);
      productId = data.id;
    }
    if (productId) {
      await supabase.from("catering_product_recipe_items").delete().eq("product_id", productId);
      const items = recipe.filter((r) => r.raw_material_id && r.quantity > 0).map((r) => ({ product_id: productId!, raw_material_id: r.raw_material_id, quantity: r.quantity }));
      if (items.length) {
        const { error } = await supabase.from("catering_product_recipe_items").insert(items);
        if (error) return toast.error(error.message);
      }
    }
    toast.success("تم الحفظ"); setOpen(false); load();
  };

  const remove = async (id: string) => {
    if (!confirm("حذف المنتج؟")) return;
    const { error } = await supabase.from("catering_products").delete().eq("id", id);
    if (error) return toast.error(error.message);
    load();
  };

  return (
    <DashboardLayout>
      <Header title="منتجات Sugar in Space" subtitle="مع وصفات BOM واقتراح السعر بالذكاء الاصطناعي" />
      <div className="mb-4">
        <Button onClick={startNew} className="bg-gradient-to-r from-primary to-accent gap-2"><Plus className="w-4 h-4" /> منتج جديد</Button>
      </div>

      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>صورة</TableHead><TableHead>الاسم</TableHead><TableHead>القسم</TableHead>
            <TableHead>الوحدة</TableHead><TableHead>التكلفة</TableHead><TableHead>سعر البيع</TableHead>
            <TableHead className="text-end">إجراءات</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.length === 0 ? <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">لا توجد منتجات بعد</TableCell></TableRow>
              : rows.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{p.image_url ? <img src={p.image_url} alt={p.name} className="w-12 h-12 rounded object-cover" /> : <div className="w-12 h-12 rounded bg-muted flex items-center justify-center"><ChefHat className="w-5 h-5 text-muted-foreground" /></div>}</TableCell>
                  <TableCell className="font-semibold">{p.name}</TableCell>
                  <TableCell><Badge variant="secondary">{SECTIONS[p.kitchen_section] || p.kitchen_section}</Badge></TableCell>
                  <TableCell>{p.unit}</TableCell>
                  <TableCell>{Number(p.computed_cost).toLocaleString()} ر.س</TableCell>
                  <TableCell className="font-bold text-primary">{Number(p.sale_price).toLocaleString()} ر.س</TableCell>
                  <TableCell className="text-end">
                    <Button variant="ghost" size="icon" onClick={() => startEdit(p)}><Pencil className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => remove(p.id)} className="text-destructive"><Trash2 className="w-4 h-4" /></Button>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </CardContent></Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "تعديل منتج" : "منتج جديد"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Label>الاسم *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="col-span-2"><Label>الوصف</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <div className="col-span-2"><Label>رابط الصورة</Label><Input value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })} dir="ltr" placeholder="https://..." /></div>
            <div><Label>قسم المطبخ *</Label>
              <Select value={form.kitchen_section} onValueChange={(v) => setForm({ ...form, kitchen_section: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(SECTIONS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>الفئة</Label><Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></div>
            <div><Label>الوحدة</Label><Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></div>
            <div><Label>سعر البيع (ر.س)</Label><Input type="number" step="0.01" value={form.sale_price} onChange={(e) => setForm({ ...form, sale_price: Number(e.target.value) })} /></div>
          </div>

          <div className="border rounded-lg p-3 bg-muted/30">
            <div className="flex items-center justify-between mb-2">
              <p className="font-bold flex items-center gap-2"><Calculator className="w-4 h-4" /> الوصفة (BOM)</p>
              <Button variant="outline" size="sm" onClick={addRecipeRow}><Plus className="w-3 h-3 me-1" /> إضافة</Button>
            </div>
            {recipe.length === 0 ? <p className="text-sm text-muted-foreground py-3 text-center">أضف المواد الخام المكوّنة لهذا المنتج</p> : (
              <div className="space-y-2">
                {recipe.map((r, i) => {
                  const m = materials.find((x) => x.id === r.raw_material_id);
                  return (
                    <div key={i} className="grid grid-cols-12 gap-2 items-center">
                      <div className="col-span-6">
                        <Select value={r.raw_material_id} onValueChange={(v) => updateRecipe(i, { raw_material_id: v })}>
                          <SelectTrigger><SelectValue placeholder="اختر مادة" /></SelectTrigger>
                          <SelectContent>{materials.map((mm) => <SelectItem key={mm.id} value={mm.id}>{mm.name} ({mm.unit})</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <Input className="col-span-3" type="number" step="0.001" value={r.quantity} onChange={(e) => updateRecipe(i, { quantity: Number(e.target.value) })} placeholder="الكمية" />
                      <span className="col-span-2 text-sm text-muted-foreground">{m ? `${(Number(m.unit_cost) * r.quantity).toFixed(2)} ر.س` : "-"}</span>
                      <Button variant="ghost" size="icon" className="col-span-1 text-destructive" onClick={() => removeRecipe(i)}><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  );
                })}
                <div className="flex justify-between pt-2 border-t font-bold">
                  <span>التكلفة المحسوبة:</span>
                  <span className="text-primary">{computedCost.toFixed(2)} ر.س</span>
                </div>
              </div>
            )}
          </div>

          <div className="border rounded-lg p-3 bg-gradient-to-br from-accent/10 to-primary/10">
            <div className="flex items-center justify-between mb-2">
              <p className="font-bold flex items-center gap-2"><Sparkles className="w-4 h-4 text-accent" /> اقتراح السعر بالذكاء الاصطناعي</p>
              <Button variant="default" size="sm" onClick={suggestPrice} disabled={aiLoading} className="bg-gradient-to-r from-primary to-accent gap-2">
                <Sparkles className="w-3 h-3" /> {aiLoading ? "جارِ الاقتراح..." : "اقترح السعر"}
              </Button>
            </div>
            {aiResult ? (
              <div className="text-sm space-y-1">
                <div className="grid grid-cols-3 gap-2">
                  <div className="text-center p-2 rounded bg-card"><p className="text-xs text-muted-foreground">سوق منخفض</p><p className="font-bold">{aiResult.market_low ?? "-"} ر.س</p></div>
                  <div className="text-center p-2 rounded bg-card"><p className="text-xs text-muted-foreground">سوق متوسط</p><p className="font-bold">{aiResult.market_avg ?? "-"} ر.س</p></div>
                  <div className="text-center p-2 rounded bg-card"><p className="text-xs text-muted-foreground">سوق مرتفع</p><p className="font-bold">{aiResult.market_high ?? "-"} ر.س</p></div>
                </div>
                <p><span className="text-muted-foreground">السعر المقترح:</span> <strong className="text-primary">{aiResult.suggested_price} ر.س</strong> (هامش {aiResult.suggested_margin_pct}%)</p>
                {aiResult.reasoning && <p className="text-muted-foreground italic">{aiResult.reasoning}</p>}
              </div>
            ) : <p className="text-sm text-muted-foreground">سيقوم الذكاء الاصطناعي بتقدير سعر السوق السعودي والهامش المناسب.</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button onClick={save} className="bg-gradient-to-r from-primary to-accent">حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};
export default CateringProducts;
