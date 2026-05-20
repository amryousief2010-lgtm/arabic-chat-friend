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
import { Calculator, Save, Search, TrendingUp, Package } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

interface ProductCost {
  id: string;
  name: string;
  category: string | null;
  unit: string;
  price: number;
  cost_price: number | null;
}

interface RowEdit {
  cost: string;
  margin: string;
  price: string;
}

const ProductCosts = () => {
  const { role } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [edits, setEdits] = useState<Record<string, RowEdit>>({});
  const [globalMargin, setGlobalMargin] = useState<string>("");

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

  // Initialize edits when data loads
  useEffect(() => {
    if (products.length === 0) return;
    setEdits((prev) => {
      const next = { ...prev };
      products.forEach((p) => {
        if (!next[p.id]) {
          const cost = p.cost_price ?? 0;
          const margin = cost > 0 ? ((p.price - cost) / cost) * 100 : 0;
          next[p.id] = {
            cost: cost ? String(cost) : "",
            margin: cost > 0 ? margin.toFixed(1) : "",
            price: String(p.price ?? ""),
          };
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

  const updateRow = (id: string, patch: Partial<RowEdit>) => {
    setEdits((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  };

  const onCostChange = (id: string, v: string) => {
    const cost = parseFloat(v) || 0;
    const margin = parseFloat(edits[id]?.margin || "0") || 0;
    const newPrice = cost > 0 && margin >= 0 ? cost * (1 + margin / 100) : parseFloat(edits[id]?.price || "0");
    updateRow(id, { cost: v, price: newPrice ? newPrice.toFixed(2) : edits[id]?.price || "" });
  };

  const onMarginChange = (id: string, v: string) => {
    const cost = parseFloat(edits[id]?.cost || "0") || 0;
    const margin = parseFloat(v) || 0;
    const newPrice = cost > 0 ? cost * (1 + margin / 100) : parseFloat(edits[id]?.price || "0");
    updateRow(id, { margin: v, price: newPrice ? newPrice.toFixed(2) : edits[id]?.price || "" });
  };

  const onPriceChange = (id: string, v: string) => {
    const cost = parseFloat(edits[id]?.cost || "0") || 0;
    const price = parseFloat(v) || 0;
    const newMargin = cost > 0 ? ((price - cost) / cost) * 100 : 0;
    updateRow(id, { price: v, margin: cost > 0 ? newMargin.toFixed(1) : "" });
  };

  const applyGlobalMargin = () => {
    const m = parseFloat(globalMargin);
    if (isNaN(m) || m < 0) {
      toast({ title: "أدخل نسبة ربح صحيحة", variant: "destructive" });
      return;
    }
    setEdits((prev) => {
      const next = { ...prev };
      products.forEach((p) => {
        const cost = parseFloat(next[p.id]?.cost || "0") || 0;
        if (cost > 0) {
          next[p.id] = {
            ...next[p.id],
            margin: m.toFixed(1),
            price: (cost * (1 + m / 100)).toFixed(2),
          };
        }
      });
      return next;
    });
    toast({ title: `تم تطبيق هامش ربح ${m}% على كل المنتجات التي لها تكلفة` });
  };

  const saveMutation = useMutation({
    mutationFn: async (id: string) => {
      const e = edits[id];
      const cost_price = parseFloat(e.cost);
      const price = parseFloat(e.price);
      if (isNaN(price) || price < 0) throw new Error("سعر البيع غير صحيح");
      const { error } = await supabase
        .from("products")
        .update({
          cost_price: isNaN(cost_price) ? null : cost_price,
          price,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products-costs"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      toast({ title: "تم الحفظ" });
    },
    onError: (err: Error) => {
      toast({ title: "تعذر الحفظ", description: err.message, variant: "destructive" });
    },
  });

  const saveAllMutation = useMutation({
    mutationFn: async () => {
      const ops = products
        .filter((p) => {
          const e = edits[p.id];
          if (!e) return false;
          const cost = parseFloat(e.cost);
          const price = parseFloat(e.price);
          return (
            (!isNaN(cost) && cost !== (p.cost_price ?? -1)) ||
            (!isNaN(price) && price !== p.price)
          );
        })
        .map((p) => {
          const e = edits[p.id];
          const cost_price = parseFloat(e.cost);
          const price = parseFloat(e.price);
          return supabase
            .from("products")
            .update({
              cost_price: isNaN(cost_price) ? null : cost_price,
              price: isNaN(price) ? p.price : price,
            })
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
      toast({ title: `تم حفظ ${count} منتج بنجاح` });
    },
    onError: (err: Error) => {
      toast({ title: "حدث خطأ أثناء الحفظ الجماعي", description: err.message, variant: "destructive" });
    },
  });

  // Stats
  const stats = useMemo(() => {
    const withCost = products.filter((p) => (p.cost_price ?? 0) > 0);
    const totalCost = withCost.reduce((s, p) => s + (p.cost_price || 0), 0);
    const totalPrice = withCost.reduce((s, p) => s + p.price, 0);
    const avgMargin =
      withCost.length > 0
        ? withCost.reduce((s, p) => s + ((p.price - (p.cost_price || 0)) / (p.cost_price || 1)) * 100, 0) /
          withCost.length
        : 0;
    return {
      total: products.length,
      priced: withCost.length,
      missing: products.length - withCost.length,
      avgMargin,
      totalCost,
      totalPrice,
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
        subtitle="تحديد التكلفة الفعلية ونسبة الربح وسعر البيع"
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Card className="glass-card">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs"><Package className="w-4 h-4" /> إجمالي المنتجات</div>
            <div className="text-2xl font-bold mt-1">{stats.total}</div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs"><Calculator className="w-4 h-4" /> مُسعَّرة بتكلفة</div>
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
            <div className="flex items-center gap-2 text-muted-foreground text-xs"><TrendingUp className="w-4 h-4" /> متوسط الربح</div>
            <div className="text-2xl font-bold mt-1 text-primary">{stats.avgMargin.toFixed(1)}%</div>
          </CardContent>
        </Card>
      </div>

      <Card className="glass-card mb-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Calculator className="w-5 h-5 text-primary" /> تطبيق نسبة ربح موحدة
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <label className="text-sm text-muted-foreground">نسبة الربح (%)</label>
            <Input
              type="number"
              placeholder="مثال: 30"
              value={globalMargin}
              onChange={(e) => setGlobalMargin(e.target.value)}
            />
          </div>
          <Button onClick={applyGlobalMargin}>تطبيق على كل المنتجات</Button>
          <Button
            variant="default"
            onClick={() => saveAllMutation.mutate()}
            disabled={saveAllMutation.isPending}
          >
            <Save className="w-4 h-4 ml-1" />
            حفظ جميع التغييرات
          </Button>
        </CardContent>
      </Card>

      <Card className="glass-card">
        <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base">قائمة المنتجات ({filtered.length})</CardTitle>
          <div className="relative w-64">
            <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="بحث باسم المنتج..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pr-9"
            />
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
                  <TableHead className="text-right">نسبة الربح %</TableHead>
                  <TableHead className="text-right">سعر البيع</TableHead>
                  <TableHead className="text-right">صافي الربح</TableHead>
                  <TableHead className="text-right">حفظ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((p) => {
                  const e = edits[p.id] || { cost: "", margin: "", price: String(p.price) };
                  const cost = parseFloat(e.cost) || 0;
                  const price = parseFloat(e.price) || 0;
                  const profit = price - cost;
                  const hasCost = (p.cost_price ?? 0) > 0;
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          {p.name}
                          {!hasCost && <Badge variant="outline" className="text-xs">بدون تكلفة</Badge>}
                        </div>
                        <div className="text-xs text-muted-foreground">{p.unit}</div>
                      </TableCell>
                      <TableCell><Badge variant="secondary">{p.category || "-"}</Badge></TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="0.01"
                          className="w-28"
                          value={e.cost}
                          onChange={(ev) => onCostChange(p.id, ev.target.value)}
                          placeholder="0.00"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="0.1"
                          className="w-24"
                          value={e.margin}
                          onChange={(ev) => onMarginChange(p.id, ev.target.value)}
                          placeholder="0"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="0.01"
                          className="w-28 font-semibold"
                          value={e.price}
                          onChange={(ev) => onPriceChange(p.id, ev.target.value)}
                        />
                      </TableCell>
                      <TableCell className={profit > 0 ? "text-success font-semibold" : "text-muted-foreground"}>
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
