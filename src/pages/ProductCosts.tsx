import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Calculator, Save, Search, TrendingUp, Package, Info } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

interface ProductCost {
  id: string;
  name: string;
  category: string | null;
  unit: string;
  price: number;
  cost_price: number | null;
}

const ProductCosts = () => {
  const { role } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  // Edits ONLY contain cost. Sale price is intentionally NOT editable here
  // to keep it fully decoupled from cost/margin changes.
  const [edits, setEdits] = useState<Record<string, string>>({});

  const canEdit =
    role === "accountant" ||
    role === "general_manager" ||
    role === "executive_manager" ||
    role === "financial_manager";

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["products-costs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id,name,category,unit,price,cost_price")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data || []) as ProductCost[];
    },
  });

  useEffect(() => {
    if (products.length === 0) return;
    setEdits((prev) => {
      const next = { ...prev };
      products.forEach((p) => {
        if (next[p.id] === undefined) {
          next[p.id] = p.cost_price != null ? String(p.cost_price) : "";
        }
      });
      return next;
    });
  }, [products]);

  const filtered = useMemo(
    () =>
      products.filter((p) =>
        !search.trim() ? true : p.name.toLowerCase().includes(search.toLowerCase().trim())
      ),
    [products, search]
  );

  const saveMutation = useMutation({
    mutationFn: async (id: string) => {
      const raw = edits[id];
      const cost_price = raw === "" || raw === undefined ? null : parseFloat(raw);
      if (cost_price !== null && (isNaN(cost_price) || cost_price < 0)) {
        throw new Error("التكلفة غير صحيحة");
      }
      const { error } = await supabase
        .from("products")
        .update({ cost_price }) // ⚠️ price intentionally NOT touched
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products-costs"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      toast({ title: "تم حفظ التكلفة (سعر البيع لم يتغير)" });
    },
    onError: (err: Error) => {
      toast({ title: "تعذر الحفظ", description: err.message, variant: "destructive" });
    },
  });

  const saveAllMutation = useMutation({
    mutationFn: async () => {
      const ops = products
        .filter((p) => {
          const raw = edits[p.id];
          if (raw === undefined) return false;
          const cost = raw === "" ? null : parseFloat(raw);
          const current = p.cost_price ?? null;
          return cost !== current && !(cost !== null && isNaN(cost));
        })
        .map((p) => {
          const raw = edits[p.id];
          const cost_price = raw === "" ? null : parseFloat(raw);
          return supabase
            .from("products")
            .update({ cost_price }) // ⚠️ price intentionally NOT touched
            .eq("id", p.id);
        });
      const results = await Promise.all(ops);
      const failed = results.filter((r) => r.error).length;
      if (failed > 0) throw new Error(`${failed} منتج فشل التحديث`);
      return results.length;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["products-costs"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      toast({ title: `تم حفظ ${count} تكلفة (الأسعار لم تتغير)` });
    },
    onError: (err: Error) => {
      toast({ title: "حدث خطأ أثناء الحفظ", description: err.message, variant: "destructive" });
    },
  });

  const stats = useMemo(() => {
    const withCost = products.filter((p) => (p.cost_price ?? 0) > 0);
    const avgMargin =
      withCost.length > 0
        ? withCost.reduce(
            (s, p) => s + ((p.price - (p.cost_price || 0)) / (p.cost_price || 1)) * 100,
            0
          ) / withCost.length
        : 0;
    return {
      total: products.length,
      priced: withCost.length,
      missing: products.length - withCost.length,
      avgMargin,
    };
  }, [products]);

  if (!canEdit) {
    return (
      <DashboardLayout>
        <Header title="تكاليف المنتجات" subtitle="غير مصرح" />
        <Card className="glass-card">
          <CardContent className="py-10 text-center text-muted-foreground">
            هذه الصفحة متاحة للمحاسب والإدارة فقط.
          </CardContent>
        </Card>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <Header
        title="تكاليف المنتجات وهامش الربح"
        subtitle="تسجيل التكلفة الفعلية فقط — سعر البيع يُعدَّل من صفحة المنتجات"
      />

      <Card className="glass-card mb-4 border-warning/40">
        <CardContent className="p-4 flex items-start gap-3">
          <Info className="w-5 h-5 text-warning mt-0.5 shrink-0" />
          <div className="text-sm leading-relaxed">
            <div className="font-semibold mb-1">ملاحظة مهمة</div>
            هذه الصفحة تعدّل <b>التكلفة الفعلية</b> فقط لحساب هامش الربح. <b>سعر البيع</b> لم يعد
            مرتبطًا بالتكلفة أو نسبة الربح، ولا يتغيّر من هنا. لتعديل سعر البيع، استخدم
            صفحة <b>المنتجات</b> مباشرة.
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Card className="glass-card">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs">
              <Package className="w-4 h-4" /> إجمالي المنتجات
            </div>
            <div className="text-2xl font-bold mt-1">{stats.total}</div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs">
              <Calculator className="w-4 h-4" /> مُسعَّرة بتكلفة
            </div>
            <div className="text-2xl font-bold mt-1 text-success">{stats.priced}</div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-4">
            <div className="text-muted-foreground text-xs">بدون تكلفة</div>
            <div className="text-2xl font-bold mt-1 text-warning">{stats.missing}</div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs">
              <TrendingUp className="w-4 h-4" /> متوسط الربح
            </div>
            <div className="text-2xl font-bold mt-1 text-primary">{stats.avgMargin.toFixed(1)}%</div>
          </CardContent>
        </Card>
      </div>

      <Card className="glass-card">
        <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base">قائمة المنتجات ({filtered.length})</CardTitle>
          <div className="flex items-center gap-2">
            <div className="relative w-64">
              <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="بحث باسم المنتج..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pr-9"
              />
            </div>
            <Button
              onClick={() => saveAllMutation.mutate()}
              disabled={saveAllMutation.isPending}
            >
              <Save className="w-4 h-4 ml-1" />
              حفظ كل التكاليف
            </Button>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">جارٍ التحميل...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">المنتج</TableHead>
                  <TableHead className="text-right">الفئة</TableHead>
                  <TableHead className="text-right">التكلفة الفعلية</TableHead>
                  <TableHead className="text-right">سعر البيع (للعرض فقط)</TableHead>
                  <TableHead className="text-right">نسبة الربح %</TableHead>
                  <TableHead className="text-right">صافي الربح</TableHead>
                  <TableHead className="text-right">حفظ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((p) => {
                  const raw = edits[p.id] ?? "";
                  const cost = parseFloat(raw) || 0;
                  const price = p.price || 0;
                  const profit = price - cost;
                  const margin = cost > 0 ? ((price - cost) / cost) * 100 : 0;
                  const hasCost = (p.cost_price ?? 0) > 0;
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          {p.name}
                          {!hasCost && (
                            <Badge variant="outline" className="text-xs">بدون تكلفة</Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">{p.unit}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{p.category || "-"}</Badge>
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="0.01"
                          className="w-28"
                          value={raw}
                          onChange={(ev) =>
                            setEdits((prev) => ({ ...prev, [p.id]: ev.target.value }))
                          }
                          placeholder="0.00"
                        />
                      </TableCell>
                      <TableCell className="font-semibold text-muted-foreground">
                        {price.toFixed(2)} ج
                      </TableCell>
                      <TableCell>
                        {cost > 0 ? (
                          <span className={margin >= 0 ? "text-primary" : "text-destructive"}>
                            {margin.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell
                        className={
                          profit > 0
                            ? "text-success font-semibold"
                            : "text-muted-foreground"
                        }
                      >
                        {profit.toFixed(2)} ج
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => saveMutation.mutate(p.id)}
                          disabled={saveMutation.isPending}
                        >
                          <Save className="w-3 h-3 ml-1" /> حفظ
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </DashboardLayout>
  );
};

export default ProductCosts;
