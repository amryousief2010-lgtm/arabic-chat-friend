import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Factory, Package, ClipboardList, Boxes, TrendingUp, Coins, Layers, Eye } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Product = { id: string; product_code: string | null; barcode: string | null; name_ar: string; functional_name_ar: string | null; package_qty: number; package_unit: string; base_cost_unit: string | null; cost_per_base_unit: number | null; cost_price: number | null; sale_price: number | null; cost_status: string | null; source_document: string | null; source_date: string | null; notes: string | null; is_active: boolean; };
type RawMaterial = { id: string; material_code: string; name_ar: string; default_unit: string; avg_unit_cost: number; category: string; is_active: boolean; };
type Invoice = { id: string; invoice_no: number; invoice_date: string | null; source_document: string | null; product_code: string | null; product_name_ar: string | null; output_qty: number | null; output_unit: string | null; unit_cost: number | null; output_total: number | null; input_total: number | null; labor_total: number | null; notes: string | null; };
type Recipe = { id: string; invoice_no: number | null; invoice_date: string | null; product_code: string; product_name_ar: string | null; line_type: string; material_code: string | null; material_name_ar: string | null; quantity: number; unit: string; unit_cost: number | null; line_total: number | null; warehouse: string | null; labor_total_if_output: number | null; };

const fmt = (v: number | null | undefined, digits = 2) =>
  v == null ? "—" : Number(v).toLocaleString("ar-EG", { minimumFractionDigits: digits, maximumFractionDigits: digits });

const categoryLabels: Record<string, string> = {
  spice: "بهارات", meat: "لحوم", feed: "أعلاف", packaging: "تعبئة", other: "أخرى",
};

const MeatFactory = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);

  const [productSearch, setProductSearch] = useState("");
  const [materialSearch, setMaterialSearch] = useState("");
  const [invoiceSearch, setInvoiceSearch] = useState("");

  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);

  const fetchAll = async () => {
    setLoading(true);
    const [p, m, i, r] = await Promise.all([
      supabase.from("meat_factory_products" as any).select("*").order("name_ar"),
      supabase.from("meat_factory_raw_materials" as any).select("*").order("category").order("name_ar"),
      supabase.from("meat_factory_invoices" as any).select("*").order("invoice_date", { ascending: false }),
      supabase.from("meat_factory_recipes" as any).select("*").order("invoice_no", { ascending: false }),
    ]);
    if (p.error) toast.error("تعذر تحميل المنتجات: " + p.error.message);
    setProducts((p.data as any) || []);
    setMaterials((m.data as any) || []);
    setInvoices((i.data as any) || []);
    setRecipes((r.data as any) || []);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  // KPIs
  const totalProducts = products.length;
  const pricedProducts = products.filter(p => p.cost_price != null).length;
  const totalMaterials = materials.length;
  const totalInvoices = invoices.length;
  const totalOutputKg = invoices.reduce((s, i) => s + Number(i.output_qty || 0), 0);
  const totalInputCost = invoices.reduce((s, i) => s + Number(i.input_total || 0), 0);
  const totalLaborCost = invoices.reduce((s, i) => s + Number(i.labor_total || 0), 0);
  const avgCostPerKg = totalOutputKg > 0 ? (totalInputCost + totalLaborCost) / totalOutputKg : 0;

  const materialsByCat = useMemo(() => {
    const map: Record<string, number> = {};
    materials.forEach(m => { map[m.category] = (map[m.category] || 0) + 1; });
    return map;
  }, [materials]);

  const filteredProducts = products.filter(p => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return true;
    return (p.name_ar || "").toLowerCase().includes(q)
      || (p.barcode || "").includes(q)
      || (p.product_code || "").includes(q)
      || (p.functional_name_ar || "").toLowerCase().includes(q);
  });

  const filteredMaterials = materials.filter(m => {
    const q = materialSearch.trim().toLowerCase();
    if (!q) return true;
    return (m.name_ar || "").toLowerCase().includes(q) || (m.material_code || "").includes(q);
  });

  const filteredInvoices = invoices.filter(i => {
    const q = invoiceSearch.trim().toLowerCase();
    if (!q) return true;
    return (i.product_name_ar || "").toLowerCase().includes(q)
      || String(i.invoice_no).includes(q)
      || (i.source_document || "").toLowerCase().includes(q);
  });

  const invoiceRecipes = useMemo(() => {
    if (!selectedInvoice) return [];
    return recipes.filter(r => r.invoice_no === selectedInvoice.invoice_no && r.product_code === selectedInvoice.product_code);
  }, [recipes, selectedInvoice]);

  const KPI = ({ icon: Icon, label, value, hint, color }: any) => (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${color}`}>
          <Icon className="w-6 h-6" />
        </div>
        <div className="flex-1">
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-2xl font-bold">{value}</div>
          {hint && <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>}
        </div>
      </CardContent>
    </Card>
  );

  return (
    <DashboardLayout>
      <Header title="مصنع اللحوم" subtitle="تصنيع المنتجات المصنعة من النعام" />

      <div className="p-4 space-y-4">
        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPI icon={Package} label="إجمالي المنتجات" value={totalProducts}
               hint={`${pricedProducts} لها تكلفة معتمدة`} color="bg-primary/10 text-primary" />
          <KPI icon={Boxes} label="المواد الخام" value={totalMaterials}
               hint={`${materialsByCat['meat'] || 0} لحوم · ${materialsByCat['spice'] || 0} بهارات`}
               color="bg-orange-500/10 text-orange-600" />
          <KPI icon={ClipboardList} label="فواتير التصنيع" value={totalInvoices}
               hint={`${fmt(totalOutputKg, 0)} كجم إنتاج`} color="bg-green-500/10 text-green-600" />
          <KPI icon={Coins} label="متوسط التكلفة/كجم" value={fmt(avgCostPerKg)}
               hint={`عمالة: ${fmt(totalLaborCost, 0)} ج`} color="bg-purple-500/10 text-purple-600" />
        </div>

        <Tabs defaultValue="products" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="products"><Package className="w-4 h-4 ml-1" />المنتجات</TabsTrigger>
            <TabsTrigger value="materials"><Boxes className="w-4 h-4 ml-1" />المواد الخام</TabsTrigger>
            <TabsTrigger value="invoices"><ClipboardList className="w-4 h-4 ml-1" />فواتير التصنيع</TabsTrigger>
            <TabsTrigger value="recipes"><Layers className="w-4 h-4 ml-1" />الوصفات (BOM)</TabsTrigger>
          </TabsList>

          {/* PRODUCTS */}
          <TabsContent value="products">
            <Card>
              <CardHeader className="flex-row items-center justify-between gap-2">
                <CardTitle className="text-base">المنتجات المصنعة ({filteredProducts.length})</CardTitle>
                <Input placeholder="بحث بالاسم / الباركود / الكود..." className="max-w-sm"
                       value={productSearch} onChange={e => setProductSearch(e.target.value)} />
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {loading ? <div className="text-center py-8 text-muted-foreground">جاري التحميل...</div> : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>الكود</TableHead>
                        <TableHead>الباركود</TableHead>
                        <TableHead>الاسم</TableHead>
                        <TableHead>العبوة</TableHead>
                        <TableHead>تكلفة الكيلو</TableHead>
                        <TableHead>تكلفة العبوة</TableHead>
                        <TableHead>الحالة</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredProducts.map(p => (
                        <TableRow key={p.id}>
                          <TableCell className="font-mono text-xs">{p.product_code || "—"}</TableCell>
                          <TableCell className="font-mono text-xs">{p.barcode || "—"}</TableCell>
                          <TableCell className="font-medium">
                            <div>{p.name_ar}</div>
                            {p.functional_name_ar && <div className="text-xs text-muted-foreground">{p.functional_name_ar}</div>}
                          </TableCell>
                          <TableCell>{fmt(p.package_qty, 1)} {p.package_unit}</TableCell>
                          <TableCell>{p.cost_per_base_unit != null ? `${fmt(p.cost_per_base_unit)} ج/${p.base_cost_unit}` : "—"}</TableCell>
                          <TableCell className="font-semibold">{p.cost_price != null ? `${fmt(p.cost_price)} ج` : <Badge variant="outline">بحاجة تسعير</Badge>}</TableCell>
                          <TableCell>
                            {p.cost_status === "تم التحديث"
                              ? <Badge className="bg-green-500/10 text-green-700 border-green-300">محدّث</Badge>
                              : <Badge variant="secondary">{p.cost_status || "—"}</Badge>}
                          </TableCell>
                        </TableRow>
                      ))}
                      {!filteredProducts.length && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">لا توجد منتجات مطابقة</TableCell></TableRow>}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* MATERIALS */}
          <TabsContent value="materials">
            <Card>
              <CardHeader className="flex-row items-center justify-between gap-2">
                <CardTitle className="text-base">المواد الخام ({filteredMaterials.length})</CardTitle>
                <Input placeholder="بحث..." className="max-w-sm"
                       value={materialSearch} onChange={e => setMaterialSearch(e.target.value)} />
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الكود</TableHead>
                      <TableHead>الاسم</TableHead>
                      <TableHead>التصنيف</TableHead>
                      <TableHead>الوحدة</TableHead>
                      <TableHead>متوسط التكلفة</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredMaterials.map(m => (
                      <TableRow key={m.id}>
                        <TableCell className="font-mono text-xs">{m.material_code}</TableCell>
                        <TableCell className="font-medium">{m.name_ar}</TableCell>
                        <TableCell><Badge variant="outline">{categoryLabels[m.category] || m.category}</Badge></TableCell>
                        <TableCell>{m.default_unit}</TableCell>
                        <TableCell>{m.avg_unit_cost > 0 ? `${fmt(m.avg_unit_cost)} ج` : "—"}</TableCell>
                      </TableRow>
                    ))}
                    {!filteredMaterials.length && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">لا توجد مواد</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* INVOICES */}
          <TabsContent value="invoices">
            <Card>
              <CardHeader className="flex-row items-center justify-between gap-2">
                <CardTitle className="text-base">فواتير التصنيع التاريخية ({filteredInvoices.length})</CardTitle>
                <Input placeholder="بحث..." className="max-w-sm"
                       value={invoiceSearch} onChange={e => setInvoiceSearch(e.target.value)} />
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>رقم الفاتورة</TableHead>
                      <TableHead>التاريخ</TableHead>
                      <TableHead>المنتج</TableHead>
                      <TableHead>الكمية</TableHead>
                      <TableHead>تكلفة المواد</TableHead>
                      <TableHead>عمالة</TableHead>
                      <TableHead>إجمالي/كجم</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredInvoices.map(i => (
                      <TableRow key={i.id}>
                        <TableCell className="font-mono">{i.invoice_no}</TableCell>
                        <TableCell>{i.invoice_date || "—"}</TableCell>
                        <TableCell className="font-medium">{i.product_name_ar}</TableCell>
                        <TableCell>{fmt(i.output_qty, 1)} {i.output_unit}</TableCell>
                        <TableCell>{fmt(i.input_total, 0)} ج</TableCell>
                        <TableCell>{fmt(i.labor_total, 0)} ج</TableCell>
                        <TableCell className="font-semibold text-primary">{fmt(i.unit_cost)} ج</TableCell>
                        <TableCell>
                          <Button size="sm" variant="ghost" onClick={() => setSelectedInvoice(i)}>
                            <Eye className="w-4 h-4 ml-1" />تفاصيل
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!filteredInvoices.length && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">لا توجد فواتير</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* RECIPES / BOM */}
          <TabsContent value="recipes">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">قوائم المواد (BOM) — {recipes.length} سطر من {new Set(recipes.map(r => r.product_code)).size} منتج</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>فاتورة</TableHead>
                      <TableHead>المنتج</TableHead>
                      <TableHead>النوع</TableHead>
                      <TableHead>كود المادة</TableHead>
                      <TableHead>المادة</TableHead>
                      <TableHead>الكمية</TableHead>
                      <TableHead>التكلفة</TableHead>
                      <TableHead>الإجمالي</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recipes.slice(0, 500).map(r => (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono text-xs">{r.invoice_no}</TableCell>
                        <TableCell className="font-medium">{r.product_name_ar}</TableCell>
                        <TableCell>
                          {r.line_type === "Output"
                            ? <Badge className="bg-green-500/10 text-green-700 border-green-300">ناتج</Badge>
                            : <Badge variant="outline">مدخل</Badge>}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{r.material_code || "—"}</TableCell>
                        <TableCell>{r.material_name_ar}</TableCell>
                        <TableCell>{fmt(r.quantity, 2)} {r.unit}</TableCell>
                        <TableCell>{fmt(r.unit_cost)}</TableCell>
                        <TableCell className="font-semibold">{fmt(r.line_total, 2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Invoice details dialog */}
      <Dialog open={!!selectedInvoice} onOpenChange={(o) => !o && setSelectedInvoice(null)}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>تفاصيل فاتورة #{selectedInvoice?.invoice_no} — {selectedInvoice?.product_name_ar}</DialogTitle>
          </DialogHeader>
          {selectedInvoice && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div><div className="text-muted-foreground">التاريخ</div><div className="font-semibold">{selectedInvoice.invoice_date}</div></div>
                <div><div className="text-muted-foreground">الإنتاج</div><div className="font-semibold">{fmt(selectedInvoice.output_qty, 1)} {selectedInvoice.output_unit}</div></div>
                <div><div className="text-muted-foreground">تكلفة المواد</div><div className="font-semibold">{fmt(selectedInvoice.input_total, 0)} ج</div></div>
                <div><div className="text-muted-foreground">عمالة</div><div className="font-semibold">{fmt(selectedInvoice.labor_total, 0)} ج</div></div>
                <div><div className="text-muted-foreground">إجمالي التكلفة</div><div className="font-semibold">{fmt(selectedInvoice.output_total, 0)} ج</div></div>
                <div><div className="text-muted-foreground">التكلفة/كجم</div><div className="font-semibold text-primary">{fmt(selectedInvoice.unit_cost)} ج</div></div>
                <div className="col-span-2"><div className="text-muted-foreground">المستند</div><div className="font-semibold">{selectedInvoice.source_document}</div></div>
              </div>
              <div>
                <div className="font-semibold mb-2 flex items-center gap-2"><Layers className="w-4 h-4" />تفاصيل المكونات ({invoiceRecipes.length})</div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>النوع</TableHead>
                      <TableHead>المادة</TableHead>
                      <TableHead>الكمية</TableHead>
                      <TableHead>التكلفة</TableHead>
                      <TableHead>الإجمالي</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoiceRecipes.map(r => (
                      <TableRow key={r.id}>
                        <TableCell>
                          {r.line_type === "Output"
                            ? <Badge className="bg-green-500/10 text-green-700 border-green-300">ناتج</Badge>
                            : <Badge variant="outline">مدخل</Badge>}
                        </TableCell>
                        <TableCell className="font-medium">{r.material_name_ar} <span className="font-mono text-xs text-muted-foreground">{r.material_code}</span></TableCell>
                        <TableCell>{fmt(r.quantity, 2)} {r.unit}</TableCell>
                        <TableCell>{fmt(r.unit_cost)}</TableCell>
                        <TableCell className="font-semibold">{fmt(r.line_total, 2)} ج</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default MeatFactory;
