import { useState, useEffect } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Plus, Wheat, Trash2, Edit, Play, CheckCircle2, XCircle, Package2, Eye } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

interface RawMaterial {
  id: string;
  name: string;
  unit: string;
  stock: number;
  unit_cost: number;
  low_stock_threshold: number;
  supplier: string | null;
  is_active: boolean;
}

interface Recipe {
  id: string;
  name: string;
  feed_type: string;
  batch_size: number;
  unit: string;
  description: string | null;
  is_active: boolean;
  items?: RecipeItem[];
}

interface RecipeItem {
  id: string;
  recipe_id: string;
  raw_material_id: string;
  quantity: number;
  raw_material?: RawMaterial;
}

interface Batch {
  id: string;
  batch_number: string;
  recipe_id: string;
  target_quantity: number;
  actual_quantity: number;
  status: string;
  total_cost: number;
  started_at: string | null;
  completed_at: string | null;
  notes: string | null;
  created_at: string;
  recipe?: { name: string; feed_type: string };
}

const statusLabels: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  planned: { label: "مخططة", variant: "secondary" },
  in_progress: { label: "قيد التنفيذ", variant: "default" },
  completed: { label: "مكتملة", variant: "outline" },
  cancelled: { label: "ملغاة", variant: "destructive" },
};

const FeedFactory = () => {
  const { canManageFeedFactory, user } = useAuth();
  const { toast } = useToast();
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);

  // Material dialog
  const [matDialog, setMatDialog] = useState(false);
  const [editMat, setEditMat] = useState<RawMaterial | null>(null);
  const [matForm, setMatForm] = useState({ name: "", unit: "كجم", stock: 0, unit_cost: 0, low_stock_threshold: 100, supplier: "" });

  // Recipe dialog
  const [recipeDialog, setRecipeDialog] = useState(false);
  const [editRecipe, setEditRecipe] = useState<Recipe | null>(null);
  const [recipeForm, setRecipeForm] = useState({ name: "", feed_type: "بادئ", batch_size: 1000, description: "" });
  const [recipeItems, setRecipeItems] = useState<{ raw_material_id: string; quantity: number }[]>([]);

  // Batch dialog
  const [batchDialog, setBatchDialog] = useState(false);
  const [batchForm, setBatchForm] = useState({ recipe_id: "", target_quantity: 1000, notes: "" });

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<{ type: "material" | "recipe" | "batch"; id: string; name: string } | null>(null);

  const fetchAll = async () => {
    setLoading(true);
    const [m, r, b] = await Promise.all([
      supabase.from("feed_raw_materials").select("*").order("name"),
      supabase.from("feed_recipes").select("*, items:feed_recipe_items(*, raw_material:feed_raw_materials(*))").order("created_at", { ascending: false }),
      supabase.from("feed_production_batches").select("*, recipe:feed_recipes(name, feed_type)").order("created_at", { ascending: false }).limit(100),
    ]);
    if (m.data) setMaterials(m.data as RawMaterial[]);
    if (r.data) setRecipes(r.data as Recipe[]);
    if (b.data) setBatches(b.data as Batch[]);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  // ============ Materials CRUD ============
  const openMaterialDialog = (m?: RawMaterial) => {
    if (m) {
      setEditMat(m);
      setMatForm({ name: m.name, unit: m.unit, stock: m.stock, unit_cost: m.unit_cost, low_stock_threshold: m.low_stock_threshold, supplier: m.supplier || "" });
    } else {
      setEditMat(null);
      setMatForm({ name: "", unit: "كجم", stock: 0, unit_cost: 0, low_stock_threshold: 100, supplier: "" });
    }
    setMatDialog(true);
  };

  const saveMaterial = async () => {
    if (!matForm.name.trim()) {
      toast({ title: "خطأ", description: "أدخل اسم المادة", variant: "destructive" });
      return;
    }
    const payload = { ...matForm, supplier: matForm.supplier || null };
    const res = editMat
      ? await supabase.from("feed_raw_materials").update(payload).eq("id", editMat.id)
      : await supabase.from("feed_raw_materials").insert(payload);
    if (res.error) {
      toast({ title: "خطأ", description: res.error.message, variant: "destructive" });
    } else {
      toast({ title: editMat ? "تم التعديل" : "تمت الإضافة" });
      setMatDialog(false);
      fetchAll();
    }
  };

  // ============ Recipes CRUD ============
  const openRecipeDialog = (r?: Recipe) => {
    if (r) {
      setEditRecipe(r);
      setRecipeForm({ name: r.name, feed_type: r.feed_type, batch_size: r.batch_size, description: r.description || "" });
      setRecipeItems((r.items || []).map(i => ({ raw_material_id: i.raw_material_id, quantity: i.quantity })));
    } else {
      setEditRecipe(null);
      setRecipeForm({ name: "", feed_type: "بادئ", batch_size: 1000, description: "" });
      setRecipeItems([]);
    }
    setRecipeDialog(true);
  };

  const saveRecipe = async () => {
    if (!recipeForm.name.trim() || recipeItems.length === 0) {
      toast({ title: "خطأ", description: "أدخل اسم الوصفة وعنصراً واحداً على الأقل", variant: "destructive" });
      return;
    }
    const payload = { ...recipeForm, description: recipeForm.description || null, created_by: user?.id };
    let recipeId = editRecipe?.id;
    if (editRecipe) {
      const { error } = await supabase.from("feed_recipes").update(payload).eq("id", editRecipe.id);
      if (error) { toast({ title: "خطأ", description: error.message, variant: "destructive" }); return; }
      await supabase.from("feed_recipe_items").delete().eq("recipe_id", editRecipe.id);
    } else {
      const { data, error } = await supabase.from("feed_recipes").insert(payload).select().single();
      if (error || !data) { toast({ title: "خطأ", description: error?.message, variant: "destructive" }); return; }
      recipeId = data.id;
    }
    if (recipeId) {
      const items = recipeItems.filter(i => i.raw_material_id && i.quantity > 0).map(i => ({ ...i, recipe_id: recipeId }));
      if (items.length) await supabase.from("feed_recipe_items").insert(items);
    }
    toast({ title: editRecipe ? "تم تعديل الوصفة" : "تمت إضافة الوصفة" });
    setRecipeDialog(false);
    fetchAll();
  };

  // ============ Batch CRUD ============
  const createBatch = async () => {
    if (!batchForm.recipe_id || batchForm.target_quantity <= 0) {
      toast({ title: "خطأ", description: "اختر الوصفة وحدد الكمية", variant: "destructive" });
      return;
    }
    const batchNumber = `FB-${new Date().toISOString().slice(0,10).replace(/-/g,"")}-${Math.floor(Math.random()*9000+1000)}`;
    const { error } = await supabase.from("feed_production_batches").insert({
      batch_number: batchNumber,
      recipe_id: batchForm.recipe_id,
      target_quantity: batchForm.target_quantity,
      notes: batchForm.notes || null,
      status: "planned",
      created_by: user?.id,
    });
    if (error) {
      toast({ title: "خطأ", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "تم إنشاء الدفعة", description: `رقم الدفعة: ${batchNumber}` });
      setBatchDialog(false);
      setBatchForm({ recipe_id: "", target_quantity: 1000, notes: "" });
      fetchAll();
    }
  };

  const startBatch = async (batch: Batch) => {
    const recipe = recipes.find(r => r.id === batch.recipe_id);
    if (!recipe || !recipe.items?.length) {
      toast({ title: "خطأ", description: "الوصفة لا تحتوي على بنود", variant: "destructive" });
      return;
    }
    // scale items proportional to target_quantity
    const scale = batch.target_quantity / recipe.batch_size;
    let totalCost = 0;
    const consumption = recipe.items.map(i => {
      const qty = i.quantity * scale;
      const cost = qty * (i.raw_material?.unit_cost || 0);
      totalCost += cost;
      return {
        batch_id: batch.id,
        raw_material_id: i.raw_material_id,
        quantity: qty,
        unit_cost: i.raw_material?.unit_cost || 0,
        total_cost: cost,
      };
    });
    // check stock availability
    for (const c of consumption) {
      const mat = materials.find(m => m.id === c.raw_material_id);
      if (!mat || mat.stock < c.quantity) {
        toast({ title: "مخزون غير كافٍ", description: `المادة ${mat?.name} متاح ${mat?.stock || 0} ${mat?.unit}، المطلوب ${c.quantity.toFixed(2)}`, variant: "destructive" });
        return;
      }
    }
    // insert consumption + deduct stock + update batch
    await supabase.from("feed_batch_consumption").insert(consumption);
    for (const c of consumption) {
      const mat = materials.find(m => m.id === c.raw_material_id);
      if (mat) {
        await supabase.from("feed_raw_materials").update({ stock: mat.stock - c.quantity }).eq("id", mat.id);
      }
    }
    await supabase.from("feed_production_batches").update({
      status: "in_progress",
      started_at: new Date().toISOString(),
      total_cost: totalCost,
    }).eq("id", batch.id);
    toast({ title: "تم بدء الإنتاج", description: `التكلفة الإجمالية: ${totalCost.toFixed(2)}` });
    fetchAll();
  };

  const completeBatch = async (batch: Batch) => {
    const actual = window.prompt("أدخل الكمية الفعلية المنتجة:", String(batch.target_quantity));
    if (!actual) return;
    const actualQty = Number(actual);
    if (isNaN(actualQty) || actualQty <= 0) return;
    await supabase.from("feed_production_batches").update({
      status: "completed",
      actual_quantity: actualQty,
      completed_at: new Date().toISOString(),
    }).eq("id", batch.id);
    toast({ title: "تم إكمال الدفعة" });
    fetchAll();
  };

  const cancelBatch = async (batch: Batch) => {
    await supabase.from("feed_production_batches").update({ status: "cancelled" }).eq("id", batch.id);
    toast({ title: "تم إلغاء الدفعة" });
    fetchAll();
  };

  const performDelete = async () => {
    if (!deleteTarget) return;
    const tableMap = {
      material: "feed_raw_materials",
      recipe: "feed_recipes",
      batch: "feed_production_batches",
    } as const;
    const { error } = await supabase.from(tableMap[deleteTarget.type]).delete().eq("id", deleteTarget.id);
    if (error) {
      toast({ title: "خطأ", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "تم الحذف" });
      fetchAll();
    }
    setDeleteTarget(null);
  };

  const lowStockCount = materials.filter(m => m.stock <= m.low_stock_threshold).length;
  const activeBatches = batches.filter(b => b.status === "in_progress").length;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Wheat className="w-7 h-7 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-foreground">مصنع الأعلاف</h1>
              <p className="text-muted-foreground mt-1">إدارة الوصفات ودفعات الإنتاج والمواد الخام</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/modules/feed-factory/dashboard">
              <Button variant="outline" size="sm">لوحة الملخص</Button>
            </Link>
            {!canManageFeedFactory && (
              <Badge variant="outline">عرض فقط — لا تملك صلاحية الإدارة</Badge>
            )}
          </div>
        </div>

        {/* KPIs */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2"><CardDescription>المواد الخام</CardDescription><CardTitle className="text-3xl">{materials.length}</CardTitle></CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardDescription>الوصفات النشطة</CardDescription><CardTitle className="text-3xl">{recipes.filter(r => r.is_active).length}</CardTitle></CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardDescription>دفعات قيد التنفيذ</CardDescription><CardTitle className="text-3xl">{activeBatches}</CardTitle></CardHeader>
          </Card>
          <Card className={lowStockCount > 0 ? "border-destructive" : ""}>
            <CardHeader className="pb-2"><CardDescription>مواد منخفضة</CardDescription><CardTitle className={`text-3xl ${lowStockCount > 0 ? "text-destructive" : ""}`}>{lowStockCount}</CardTitle></CardHeader>
          </Card>
        </div>

        <Tabs defaultValue="batches">
          <TabsList>
            <TabsTrigger value="batches">دفعات الإنتاج</TabsTrigger>
            <TabsTrigger value="recipes">الوصفات (BOM)</TabsTrigger>
            <TabsTrigger value="materials">المواد الخام</TabsTrigger>
          </TabsList>

          {/* BATCHES */}
          <TabsContent value="batches" className="space-y-4">
            <div className="flex justify-end">
              {canManageFeedFactory && (
                <Button onClick={() => setBatchDialog(true)}><Plus className="w-4 h-4 ml-2" />دفعة إنتاج جديدة</Button>
              )}
            </div>
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>رقم الدفعة</TableHead>
                      <TableHead>الوصفة</TableHead>
                      <TableHead>المستهدف</TableHead>
                      <TableHead>الفعلي</TableHead>
                      <TableHead>التكلفة</TableHead>
                      <TableHead>الحالة</TableHead>
                      <TableHead>التاريخ</TableHead>
                      <TableHead>إجراءات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">جارٍ التحميل...</TableCell></TableRow>
                    ) : batches.length === 0 ? (
                      <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">لا توجد دفعات</TableCell></TableRow>
                    ) : batches.map(b => (
                      <TableRow key={b.id}>
                        <TableCell className="font-mono text-sm">{b.batch_number}</TableCell>
                        <TableCell>{b.recipe?.name || "—"}</TableCell>
                        <TableCell>{b.target_quantity}</TableCell>
                        <TableCell>{b.actual_quantity || "—"}</TableCell>
                        <TableCell>{b.total_cost > 0 ? b.total_cost.toFixed(2) : "—"}</TableCell>
                        <TableCell><Badge variant={statusLabels[b.status]?.variant || "outline"}>{statusLabels[b.status]?.label || b.status}</Badge></TableCell>
                        <TableCell className="text-xs text-muted-foreground">{new Date(b.created_at).toLocaleDateString("ar-EG")}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Link to={`/modules/feed-factory/batches/${b.id}`}><Button size="sm" variant="ghost" title="تفاصيل"><Eye className="w-4 h-4" /></Button></Link>
                            {canManageFeedFactory && (
                              <>
                                {b.status === "planned" && (
                                  <>
                                    <Button size="sm" variant="ghost" onClick={() => startBatch(b)} title="بدء الإنتاج"><Play className="w-4 h-4" /></Button>
                                    <Button size="sm" variant="ghost" onClick={() => cancelBatch(b)} title="إلغاء"><XCircle className="w-4 h-4" /></Button>
                                  </>
                                )}
                                {b.status === "in_progress" && (
                                  <Button size="sm" variant="ghost" onClick={() => completeBatch(b)} title="إكمال"><CheckCircle2 className="w-4 h-4 text-success" /></Button>
                                )}
                                <Button size="sm" variant="ghost" onClick={() => setDeleteTarget({ type: "batch", id: b.id, name: b.batch_number })}><Trash2 className="w-4 h-4 text-destructive" /></Button>
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

          {/* RECIPES */}
          <TabsContent value="recipes" className="space-y-4">
            <div className="flex justify-end">
              {canManageFeedFactory && (
                <Button onClick={() => openRecipeDialog()}><Plus className="w-4 h-4 ml-2" />وصفة جديدة</Button>
              )}
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {recipes.length === 0 ? (
                <Card className="md:col-span-2 lg:col-span-3"><CardContent className="py-8 text-center text-muted-foreground">لا توجد وصفات</CardContent></Card>
              ) : recipes.map(r => (
                <Card key={r.id}>
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-lg">{r.name}</CardTitle>
                        <CardDescription>{r.feed_type} • دفعة {r.batch_size} {r.unit}</CardDescription>
                      </div>
                      <div className="flex gap-1">
                        <Link to={`/modules/feed-factory/recipes/${r.id}`}><Button size="sm" variant="ghost" title="عرض BOM"><Eye className="w-4 h-4" /></Button></Link>
                        {canManageFeedFactory && (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => openRecipeDialog(r)}><Edit className="w-4 h-4" /></Button>
                            <Button size="sm" variant="ghost" onClick={() => setDeleteTarget({ type: "recipe", id: r.id, name: r.name })}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                          </>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-1 text-sm">
                      {(r.items || []).map(i => (
                        <div key={i.id} className="flex justify-between border-b border-border/50 pb-1">
                          <span>{i.raw_material?.name || "—"}</span>
                          <span className="text-muted-foreground">{i.quantity} {i.raw_material?.unit}</span>
                        </div>
                      ))}
                      {(!r.items || r.items.length === 0) && <p className="text-muted-foreground text-xs">لا توجد بنود</p>}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* MATERIALS */}
          <TabsContent value="materials" className="space-y-4">
            <div className="flex justify-end">
              {canManageFeedFactory && (
                <Button onClick={() => openMaterialDialog()}><Plus className="w-4 h-4 ml-2" />مادة خام</Button>
              )}
            </div>
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الاسم</TableHead>
                      <TableHead>المخزون</TableHead>
                      <TableHead>الوحدة</TableHead>
                      <TableHead>تكلفة الوحدة</TableHead>
                      <TableHead>الحد الأدنى</TableHead>
                      <TableHead>المورد</TableHead>
                      <TableHead>إجراءات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {materials.length === 0 ? (
                      <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">لا توجد مواد</TableCell></TableRow>
                    ) : materials.map(m => (
                      <TableRow key={m.id} className={m.stock <= m.low_stock_threshold ? "bg-destructive/5" : ""}>
                        <TableCell className="font-medium flex items-center gap-2"><Package2 className="w-4 h-4 text-muted-foreground" />{m.name}</TableCell>
                        <TableCell className={m.stock <= m.low_stock_threshold ? "text-destructive font-bold" : ""}>{m.stock}</TableCell>
                        <TableCell>{m.unit}</TableCell>
                        <TableCell>{m.unit_cost.toFixed(2)}</TableCell>
                        <TableCell>{m.low_stock_threshold}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{m.supplier || "—"}</TableCell>
                        <TableCell>
                          {canManageFeedFactory && (
                            <div className="flex gap-1">
                              <Button size="sm" variant="ghost" onClick={() => openMaterialDialog(m)}><Edit className="w-4 h-4" /></Button>
                              <Button size="sm" variant="ghost" onClick={() => setDeleteTarget({ type: "material", id: m.id, name: m.name })}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                            </div>
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
      </div>

      {/* Material Dialog */}
      <Dialog open={matDialog} onOpenChange={setMatDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editMat ? "تعديل المادة الخام" : "إضافة مادة خام"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>الاسم</Label><Input value={matForm.name} onChange={e => setMatForm({ ...matForm, name: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>الوحدة</Label><Input value={matForm.unit} onChange={e => setMatForm({ ...matForm, unit: e.target.value })} /></div>
              <div><Label>المخزون</Label><Input type="number" value={matForm.stock} onChange={e => setMatForm({ ...matForm, stock: Number(e.target.value) })} /></div>
              <div><Label>تكلفة الوحدة</Label><Input type="number" step="0.01" value={matForm.unit_cost} onChange={e => setMatForm({ ...matForm, unit_cost: Number(e.target.value) })} /></div>
              <div><Label>الحد الأدنى</Label><Input type="number" value={matForm.low_stock_threshold} onChange={e => setMatForm({ ...matForm, low_stock_threshold: Number(e.target.value) })} /></div>
            </div>
            <div><Label>المورد</Label><Input value={matForm.supplier} onChange={e => setMatForm({ ...matForm, supplier: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMatDialog(false)}>إلغاء</Button>
            <Button onClick={saveMaterial}>حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Recipe Dialog */}
      <Dialog open={recipeDialog} onOpenChange={setRecipeDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editRecipe ? "تعديل الوصفة" : "وصفة جديدة"}</DialogTitle>
            <DialogDescription>الكميات نسبية لحجم الدفعة المعياري — يتم تكبيرها/تصغيرها تلقائياً عند الإنتاج</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>اسم الوصفة</Label><Input value={recipeForm.name} onChange={e => setRecipeForm({ ...recipeForm, name: e.target.value })} /></div>
              <div>
                <Label>نوع العلف</Label>
                <Select value={recipeForm.feed_type} onValueChange={v => setRecipeForm({ ...recipeForm, feed_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="بادئ">بادئ</SelectItem>
                    <SelectItem value="نامي">نامي</SelectItem>
                    <SelectItem value="ناهي">ناهي</SelectItem>
                    <SelectItem value="بياض">بياض</SelectItem>
                    <SelectItem value="أمهات">أمهات</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>حجم الدفعة (كجم)</Label><Input type="number" value={recipeForm.batch_size} onChange={e => setRecipeForm({ ...recipeForm, batch_size: Number(e.target.value) })} /></div>
            </div>
            <div><Label>الوصف</Label><Textarea value={recipeForm.description} onChange={e => setRecipeForm({ ...recipeForm, description: e.target.value })} /></div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <Label>المكونات</Label>
                <Button size="sm" variant="outline" onClick={() => setRecipeItems([...recipeItems, { raw_material_id: "", quantity: 0 }])}>
                  <Plus className="w-3 h-3 ml-1" />إضافة مكون
                </Button>
              </div>
              <div className="space-y-2">
                {recipeItems.map((item, idx) => (
                  <div key={idx} className="flex gap-2">
                    <Select value={item.raw_material_id} onValueChange={v => {
                      const next = [...recipeItems]; next[idx].raw_material_id = v; setRecipeItems(next);
                    }}>
                      <SelectTrigger className="flex-1"><SelectValue placeholder="اختر مادة" /></SelectTrigger>
                      <SelectContent>
                        {materials.map(m => <SelectItem key={m.id} value={m.id}>{m.name} ({m.unit})</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Input type="number" step="0.01" placeholder="الكمية" className="w-32" value={item.quantity} onChange={e => {
                      const next = [...recipeItems]; next[idx].quantity = Number(e.target.value); setRecipeItems(next);
                    }} />
                    <Button size="icon" variant="ghost" onClick={() => setRecipeItems(recipeItems.filter((_, i) => i !== idx))}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                ))}
                {recipeItems.length === 0 && <p className="text-sm text-muted-foreground">لم تُضاف مكونات بعد</p>}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecipeDialog(false)}>إلغاء</Button>
            <Button onClick={saveRecipe}>حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Batch Dialog */}
      <Dialog open={batchDialog} onOpenChange={setBatchDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>دفعة إنتاج جديدة</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>الوصفة</Label>
              <Select value={batchForm.recipe_id} onValueChange={v => setBatchForm({ ...batchForm, recipe_id: v })}>
                <SelectTrigger><SelectValue placeholder="اختر وصفة" /></SelectTrigger>
                <SelectContent>
                  {recipes.filter(r => r.is_active).map(r => <SelectItem key={r.id} value={r.id}>{r.name} — {r.feed_type}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>الكمية المستهدفة (كجم)</Label>
              <Input type="number" value={batchForm.target_quantity} onChange={e => setBatchForm({ ...batchForm, target_quantity: Number(e.target.value) })} />
            </div>
            <div><Label>ملاحظات</Label><Textarea value={batchForm.notes} onChange={e => setBatchForm({ ...batchForm, notes: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBatchDialog(false)}>إلغاء</Button>
            <Button onClick={createBatch}>إنشاء</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد الحذف</AlertDialogTitle>
            <AlertDialogDescription>هل أنت متأكد من حذف "{deleteTarget?.name}"؟ لا يمكن التراجع.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={performDelete} className="bg-destructive text-destructive-foreground">حذف</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
};

export default FeedFactory;
