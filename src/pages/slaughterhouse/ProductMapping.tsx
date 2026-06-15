import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, Save, Wand2, RefreshCw, Link2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

type Yield = {
  id: string;
  cut_name_ar: string;
  category: string | null;
  is_active: boolean;
  product_id: string | null;
};
type Product = { id: string; name: string; cost_price: number | null };

export default function SlaughterProductMapping() {
  const [yields, setYields] = useState<Yield[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [pending, setPending] = useState<Record<string, string | null>>({});
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [unmappedOutputCount, setUnmappedOutputCount] = useState(0);

  const load = async () => {
    setLoading(true);
    try {
      const [ys, pr, out] = await Promise.all([
        supabase.from("slaughter_yield_standards" as any)
          .select("id,cut_name_ar,category,is_active,product_id")
          .order("display_order", { ascending: true }),
        supabase.from("products").select("id,name,cost_price").eq("is_active", true).order("name"),
        supabase.from("slaughter_batch_outputs" as any)
          .select("id", { count: "exact", head: true }).is("product_id", null),
      ]);
      setYields((ys.data as any[]) ?? []);
      setProducts((pr.data as any[]) ?? []);
      setUnmappedOutputCount((out as any).count ?? 0);
      setPending({});
    } catch (e: any) {
      toast.error("فشل التحميل: " + (e.message || e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return yields;
    return yields.filter(y =>
      y.cut_name_ar.toLowerCase().includes(q) ||
      products.find(p => p.id === (pending[y.id] ?? y.product_id))?.name?.toLowerCase().includes(q),
    );
  }, [yields, search, pending, products]);

  const stats = useMemo(() => {
    const mapped = yields.filter(y => (pending[y.id] !== undefined ? pending[y.id] : y.product_id)).length;
    return { mapped, total: yields.length, unmapped: yields.length - mapped };
  }, [yields, pending]);

  const productMap = useMemo(() =>
    new Map(products.map(p => [p.id, p])), [products]);

  // Auto-suggest by exact name match
  const autoSuggest = () => {
    const byName = new Map(products.map(p => [p.name.trim().toLowerCase(), p.id]));
    const next = { ...pending };
    let n = 0;
    for (const y of yields) {
      if (y.product_id) continue;
      if (pending[y.id]) continue;
      const hit = byName.get(y.cut_name_ar.trim().toLowerCase());
      if (hit) { next[y.id] = hit; n++; }
    }
    setPending(next);
    toast.success(`اقتراح تلقائي: تم إيجاد ${n} ربط مطابق بالاسم — راجع ثم اضغط حفظ`);
  };

  const saveAll = async () => {
    const entries = Object.entries(pending).filter(([id, pid]) => {
      const cur = yields.find(y => y.id === id)?.product_id ?? null;
      return pid !== cur;
    });
    if (entries.length === 0) {
      toast.info("لا توجد تغييرات للحفظ");
      return;
    }
    setSaving(true);
    try {
      for (const [id, pid] of entries) {
        const { error } = await supabase
          .from("slaughter_yield_standards" as any)
          .update({ product_id: pid })
          .eq("id", id);
        if (error) throw error;
      }
      toast.success(`تم حفظ ${entries.length} ربط`);
      await load();
    } catch (e: any) {
      toast.error("فشل الحفظ: " + (e.message || e));
    } finally {
      setSaving(false);
    }
  };

  const backfillHistorical = async () => {
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc(
        "slaughter_outputs_backfill_product_ids" as any,
      );
      if (error) throw error;
      toast.success(`تم تحديث ${data ?? 0} ناتج ذبح سابق`);
      await load();
    } catch (e: any) {
      toast.error("فشل التحديث: " + (e.message || e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="container mx-auto p-4 space-y-4" dir="rtl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Link2 className="h-6 w-6 text-primary" /> ربط نواتج الذبح بالمنتجات
          </h1>
          <p className="text-sm text-muted-foreground">
            عند ربط كل صنف ذبح بمنتج من الكتالوج، يستخدم تقرير الربحية تكلفة الذبح الفعلية بدل cost_price.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load}><RefreshCw className="h-4 w-4" /></Button>
          <Button variant="outline" size="sm" onClick={autoSuggest}>
            <Wand2 className="h-4 w-4 ml-1" /> اقتراح تلقائي
          </Button>
          <Button size="sm" onClick={saveAll} disabled={saving || Object.keys(pending).length === 0}>
            <Save className="h-4 w-4 ml-1" /> حفظ التعديلات
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">إجمالي الأصناف</div>
          <div className="text-2xl font-bold">{stats.total}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">مربوطة</div>
          <div className="text-2xl font-bold text-green-700">{stats.mapped}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">غير مربوطة</div>
          <div className="text-2xl font-bold text-amber-700">{stats.unmapped}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">نواتج ذبح سابقة بدون منتج</div>
          <div className="text-2xl font-bold text-rose-700">{unmappedOutputCount}</div>
          {unmappedOutputCount > 0 && (
            <Button variant="link" size="sm" className="p-0 h-auto mt-1" onClick={backfillHistorical}>
              تحديث النواتج السابقة من الربط الحالي
            </Button>
          )}
        </CardContent></Card>
      </div>

      {unmappedOutputCount > 0 && (
        <div className="rounded-md p-3 bg-amber-50 border border-amber-200 text-sm flex gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <div>
            يوجد {unmappedOutputCount} ناتج ذبح غير مربوط بمنتج، وسيتم استخدام تكلفة ثابتة من cost_price بدل تكلفة الذبح الفعلية.
            بعد ربط الأصناف هنا، اضغط "تحديث النواتج السابقة".
          </div>
        </div>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center justify-between">
            <span>أصناف الذبح</span>
            <Input
              placeholder="بحث..." value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-64"
            />
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {loading ? (
            <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>اسم الناتج</TableHead>
                  <TableHead>الفئة</TableHead>
                  <TableHead className="w-72">المنتج المرتبط</TableHead>
                  <TableHead>cost_price</TableHead>
                  <TableHead>الحالة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(y => {
                  const selected = pending[y.id] !== undefined ? pending[y.id] : y.product_id;
                  const product = selected ? productMap.get(selected) : null;
                  const dirty = pending[y.id] !== undefined && pending[y.id] !== y.product_id;
                  return (
                    <TableRow key={y.id} className={dirty ? "bg-amber-50/50" : ""}>
                      <TableCell className="font-medium">{y.cut_name_ar}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{y.category ?? "—"}</TableCell>
                      <TableCell>
                        <Select
                          value={selected ?? "__none"}
                          onValueChange={(v) =>
                            setPending(prev => ({ ...prev, [y.id]: v === "__none" ? null : v }))
                          }
                        >
                          <SelectTrigger><SelectValue placeholder="اختر منتج..." /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none">— غير مربوط —</SelectItem>
                            {products.map(p => (
                              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {product?.cost_price ? Number(product.cost_price).toLocaleString("ar-EG") : "—"}
                      </TableCell>
                      <TableCell>
                        {selected
                          ? <Badge className="bg-green-600">مربوط{dirty ? " (غير محفوظ)" : ""}</Badge>
                          : <Badge variant="outline" className="text-amber-700 border-amber-300">غير مربوط</Badge>}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {filtered.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">لا توجد نتائج</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
