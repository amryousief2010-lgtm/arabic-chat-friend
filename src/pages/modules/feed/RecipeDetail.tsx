import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Save, History, Wheat } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { aggregateByDimension, formatAggregate, toBaseQty, getBaseUnit } from "@/lib/unitConversion";

interface Item {
  id: string;
  raw_material_id: string;
  quantity: number;
  raw_material?: { name: string; unit: string; unit_cost: number; stock: number };
}
interface Recipe {
  id: string;
  name: string;
  feed_type: string;
  unit: string;
  batch_size: number;
  description: string | null;
  items: Item[];
}
interface HistoryRow {
  id: string;
  batch_size: number;
  total_quantity: number;
  total_cost: number;
  created_at: string;
  notes: string | null;
  snapshot: any;
}

const RecipeDetail = () => {
  const { id } = useParams<{ id: string }>();
  const { canManageFeedFactory, user } = useAuth();
  const { toast } = useToast();
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [scale, setScale] = useState<number>(0);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!id) return;
    setLoading(true);
    const [r, h] = await Promise.all([
      supabase.from("feed_recipes").select("*, items:feed_recipe_items(*, raw_material:feed_raw_materials(*))").eq("id", id).single(),
      supabase.from("feed_recipe_history").select("*").eq("recipe_id", id).order("created_at", { ascending: false }).limit(20),
    ]);
    if (r.data) {
      setRecipe(r.data as any);
      setScale((r.data as any).batch_size);
    }
    if (h.data) setHistory(h.data as any);
    setLoading(false);
  };

  useEffect(() => { load(); }, [id]);

  if (loading) return <DashboardLayout><div className="text-center py-16 text-muted-foreground">جارٍ التحميل...</div></DashboardLayout>;
  if (!recipe) return <DashboardLayout><div className="text-center py-16">الوصفة غير موجودة</div></DashboardLayout>;

  const factor = recipe.batch_size > 0 ? scale / recipe.batch_size : 1;
  const rows = recipe.items.map(i => {
    const qty = i.quantity * factor;
    const cost = qty * (i.raw_material?.unit_cost || 0);
    const stockOk = (i.raw_material?.stock || 0) >= qty;
    const unit = i.raw_material?.unit || "";
    const base = toBaseQty(qty, unit);
    return { ...i, computedQty: qty, computedCost: cost, stockOk, baseQty: base.qty, baseUnit: base.unit };
  });
  const totalsByDim = aggregateByDimension(
    rows.map(r => ({ qty: r.computedQty, unit: r.raw_material?.unit || "" }))
  );
  const totalQtyText = totalsByDim.length ? formatAggregate(totalsByDim) : "0";
  const totalCost = rows.reduce((s, r) => s + r.computedCost, 0);
  const allStockOk = rows.every(r => r.stockOk);

  const saveSnapshot = async () => {
    setSaving(true);
    const snapshot = rows.map(r => ({
      raw_material_id: r.raw_material_id,
      name: r.raw_material?.name,
      unit: r.raw_material?.unit,
      quantity: r.computedQty,
      unit_cost: r.raw_material?.unit_cost,
      total_cost: r.computedCost,
    }));
    const { error } = await supabase.from("feed_recipe_history").insert({
      recipe_id: recipe.id,
      batch_size: scale,
      total_quantity: totalQty,
      total_cost: totalCost,
      snapshot,
      created_by: user?.id,
      notes: `حساب على أساس ${scale} ${recipe.unit}`,
    });
    setSaving(false);
    if (error) toast({ title: "خطأ", description: error.message, variant: "destructive" });
    else { toast({ title: "تم حفظ اللقطة في تاريخ الوصفة" }); load(); }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Link to="/modules/feed-factory"><Button variant="ghost" size="sm"><ArrowRight className="w-4 h-4 ml-1" />رجوع</Button></Link>
          <Wheat className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">{recipe.name}</h1>
            <p className="text-sm text-muted-foreground">نوع العلف: {recipe.feed_type} · الدفعة المرجعية: {recipe.batch_size} {recipe.unit}</p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <Card><CardHeader className="pb-2"><CardDescription>عدد البنود</CardDescription><CardTitle className="text-3xl">{rows.length}</CardTitle></CardHeader></Card>
          <Card><CardHeader className="pb-2"><CardDescription>إجمالي الكمية</CardDescription><CardTitle className="text-3xl">{totalQty.toFixed(2)} {recipe.unit}</CardTitle></CardHeader></Card>
          <Card><CardHeader className="pb-2"><CardDescription>إجمالي التكلفة</CardDescription><CardTitle className="text-3xl">{totalCost.toFixed(2)}</CardTitle></CardHeader></Card>
          <Card className={allStockOk ? "" : "border-destructive"}><CardHeader className="pb-2"><CardDescription>المخزون الحالي</CardDescription><CardTitle className={`text-2xl ${allStockOk ? "text-success" : "text-destructive"}`}>{allStockOk ? "كافٍ" : "غير كافٍ"}</CardTitle></CardHeader></Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>حساب BOM لكمية محددة</CardTitle>
            <CardDescription>أدخل الكمية المستهدفة لإعادة حساب البنود تلقائيًا</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-end gap-3 flex-wrap">
              <div>
                <Label>الكمية المستهدفة ({recipe.unit})</Label>
                <Input type="number" min={1} value={scale} onChange={e => setScale(Number(e.target.value) || 0)} className="w-48" />
              </div>
              {canManageFeedFactory && (
                <Button onClick={saveSnapshot} disabled={saving || rows.length === 0}>
                  <Save className="w-4 h-4 ml-2" />حفظ في تاريخ الوصفة
                </Button>
              )}
            </div>
            <Table>
              <TableHeader><TableRow>
                <TableHead>المادة الخام</TableHead>
                <TableHead>الكمية الأصلية</TableHead>
                <TableHead>الكمية المحسوبة</TableHead>
                <TableHead>الوحدة</TableHead>
                <TableHead>سعر الوحدة</TableHead>
                <TableHead>التكلفة</TableHead>
                <TableHead>المتاح</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {rows.map(r => (
                  <TableRow key={r.id} className={r.stockOk ? "" : "bg-destructive/5"}>
                    <TableCell className="font-medium">{r.raw_material?.name}</TableCell>
                    <TableCell>{r.quantity}</TableCell>
                    <TableCell className="font-bold">{r.computedQty.toFixed(2)}</TableCell>
                    <TableCell>{r.raw_material?.unit}</TableCell>
                    <TableCell>{r.raw_material?.unit_cost?.toFixed(2)}</TableCell>
                    <TableCell>{r.computedCost.toFixed(2)}</TableCell>
                    <TableCell className={r.stockOk ? "" : "text-destructive font-bold"}>{r.raw_material?.stock?.toFixed(2)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-bold bg-muted/40">
                  <TableCell colSpan={2}>الإجمالي</TableCell>
                  <TableCell>{totalQty.toFixed(2)}</TableCell>
                  <TableCell>{recipe.unit}</TableCell>
                  <TableCell>—</TableCell>
                  <TableCell>{totalCost.toFixed(2)}</TableCell>
                  <TableCell>—</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><History className="w-5 h-5" />تاريخ الحسابات</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>التاريخ</TableHead>
                <TableHead>الكمية المستهدفة</TableHead>
                <TableHead>إجمالي الكمية</TableHead>
                <TableHead>إجمالي التكلفة</TableHead>
                <TableHead>ملاحظات</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {history.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">لا يوجد تاريخ بعد</TableCell></TableRow>
                ) : history.map(h => (
                  <TableRow key={h.id}>
                    <TableCell className="text-xs">{new Date(h.created_at).toLocaleString("ar-EG")}</TableCell>
                    <TableCell>{h.batch_size}</TableCell>
                    <TableCell>{Number(h.total_quantity).toFixed(2)}</TableCell>
                    <TableCell>{Number(h.total_cost).toFixed(2)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{h.notes || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default RecipeDetail;
