import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Factory, Package, ClipboardList, Boxes, Coins, Layers, Eye, Plus, FileSpreadsheet, FileText, CheckCircle2, XCircle, PlayCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

type Product = { id: string; product_code: string | null; barcode: string | null; name_ar: string; functional_name_ar: string | null; package_qty: number; package_unit: string; base_cost_unit: string | null; cost_per_base_unit: number | null; cost_price: number | null; sale_price: number | null; cost_status: string | null; source_document: string | null; source_date: string | null; notes: string | null; is_active: boolean; };
type RawMaterial = { id: string; material_code: string; name_ar: string; default_unit: string; avg_unit_cost: number; category: string; is_active: boolean; stock: number; low_stock_threshold: number; };
type Invoice = { id: string; invoice_no: number; invoice_date: string | null; source_document: string | null; product_code: string | null; product_name_ar: string | null; output_qty: number | null; output_unit: string | null; unit_cost: number | null; output_total: number | null; input_total: number | null; labor_total: number | null; notes: string | null; };
type Recipe = { id: string; invoice_no: number | null; invoice_date: string | null; product_code: string; product_name_ar: string | null; line_type: string; material_code: string | null; material_name_ar: string | null; quantity: number; unit: string; unit_cost: number | null; line_total: number | null; warehouse: string | null; labor_total_if_output: number | null; };
type Batch = { id: string; batch_number: string; product_code: string; product_name_ar: string | null; planned_qty: number; actual_qty: number | null; unit: string; status: string; quality_status: string; quality_notes: string | null; labor_cost: number; materials_cost: number; total_cost: number; unit_cost: number | null; production_date: string; expiry_date: string | null; source_invoice_no: number | null; notes: string | null; created_at: string; };

const fmt = (v: number | null | undefined, digits = 2) =>
  v == null ? "—" : Number(v).toLocaleString("ar-EG", { minimumFractionDigits: digits, maximumFractionDigits: digits });

const categoryLabels: Record<string, string> = { spice: "بهارات", meat: "لحوم", feed: "أعلاف", packaging: "تعبئة", other: "أخرى" };

const statusLabels: Record<string, { label: string; cls: string }> = {
  planned: { label: "مخطط", cls: "bg-blue-500/10 text-blue-700 border-blue-300" },
  in_progress: { label: "قيد التنفيذ", cls: "bg-orange-500/10 text-orange-700 border-orange-300" },
  completed: { label: "مكتمل", cls: "bg-green-500/10 text-green-700 border-green-300" },
  cancelled: { label: "ملغي", cls: "bg-red-500/10 text-red-700 border-red-300" },
};
const qualityLabels: Record<string, { label: string; cls: string }> = {
  pending: { label: "بانتظار الفحص", cls: "bg-yellow-500/10 text-yellow-700 border-yellow-300" },
  passed: { label: "مطابق", cls: "bg-green-500/10 text-green-700 border-green-300" },
  failed: { label: "غير مطابق", cls: "bg-red-500/10 text-red-700 border-red-300" },
};

const MeatFactory = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);

  const [productSearch, setProductSearch] = useState("");
  const [materialSearch, setMaterialSearch] = useState("");
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);

  // Batch creation
  const [newBatchOpen, setNewBatchOpen] = useState(false);
  const [batchForm, setBatchForm] = useState({
    source_invoice_no: "",
    planned_qty: 0,
    production_date: new Date().toISOString().slice(0, 10),
    expiry_date: "",
    labor_cost: 0,
    notes: "",
  });
  const [savingBatch, setSavingBatch] = useState(false);

  // QC dialog
  const [qcBatch, setQcBatch] = useState<Batch | null>(null);
  const [qcForm, setQcForm] = useState({ quality_status: "passed", quality_notes: "", actual_qty: 0 });

  const fetchAll = async () => {
    setLoading(true);
    const [p, m, i, r, b] = await Promise.all([
      supabase.from("meat_factory_products" as any).select("*").order("name_ar"),
      supabase.from("meat_factory_raw_materials" as any).select("*").order("category").order("name_ar"),
      supabase.from("meat_factory_invoices" as any).select("*").order("invoice_date", { ascending: false }),
      supabase.from("meat_factory_recipes" as any).select("*").order("invoice_no", { ascending: false }),
      supabase.from("meat_factory_batches" as any).select("*").order("production_date", { ascending: false }),
    ]);
    setProducts((p.data as any) || []);
    setMaterials((m.data as any) || []);
    setInvoices((i.data as any) || []);
    setRecipes((r.data as any) || []);
    setBatches((b.data as any) || []);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  // KPIs
  const totalProducts = products.length;
  const pricedProducts = products.filter(p => p.cost_price != null).length;
  const totalMaterials = materials.length;
  const lowStockCount = materials.filter(m => m.stock <= m.low_stock_threshold).length;
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
    return (p.name_ar || "").toLowerCase().includes(q) || (p.barcode || "").includes(q)
      || (p.product_code || "").includes(q) || (p.functional_name_ar || "").toLowerCase().includes(q);
  });
  const filteredMaterials = materials.filter(m => {
    const q = materialSearch.trim().toLowerCase();
    if (!q) return true;
    return (m.name_ar || "").toLowerCase().includes(q) || (m.material_code || "").includes(q);
  });
  const filteredInvoices = invoices.filter(i => {
    const q = invoiceSearch.trim().toLowerCase();
    if (!q) return true;
    return (i.product_name_ar || "").toLowerCase().includes(q) || String(i.invoice_no).includes(q) || (i.source_document || "").toLowerCase().includes(q);
  });

  const invoiceRecipes = useMemo(() => {
    if (!selectedInvoice) return [];
    return recipes.filter(r => r.invoice_no === selectedInvoice.invoice_no && r.product_code === selectedInvoice.product_code);
  }, [recipes, selectedInvoice]);

  // ============ EXPORTS ============
  const exportInvoicesExcel = () => {
    const wb = XLSX.utils.book_new();
    const invSheet = XLSX.utils.json_to_sheet(invoices.map(i => ({
      "رقم الفاتورة": i.invoice_no, "التاريخ": i.invoice_date, "المستند": i.source_document,
      "كود المنتج": i.product_code, "المنتج": i.product_name_ar,
      "الكمية المنتجة": i.output_qty, "الوحدة": i.output_unit,
      "تكلفة المواد": i.input_total, "عمالة": i.labor_total, "إجمالي": i.output_total, "تكلفة/وحدة": i.unit_cost,
    })));
    XLSX.utils.book_append_sheet(wb, invSheet, "الفواتير");
    const bomSheet = XLSX.utils.json_to_sheet(recipes.map(r => ({
      "رقم الفاتورة": r.invoice_no, "التاريخ": r.invoice_date, "المنتج": r.product_name_ar,
      "النوع": r.line_type === "Output" ? "ناتج" : "مدخل",
      "كود المادة": r.material_code, "المادة": r.material_name_ar,
      "الكمية": r.quantity, "الوحدة": r.unit, "تكلفة الوحدة": r.unit_cost, "الإجمالي": r.line_total,
    })));
    XLSX.utils.book_append_sheet(wb, bomSheet, "الوصفات BOM");
    XLSX.writeFile(wb, `meat-factory-report-${new Date().toISOString().slice(0,10)}.xlsx`);
    toast.success("تم تصدير ملف Excel");
  };

  const exportInvoicesPDF = () => {
    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(14);
    doc.text("Meat Factory Manufacturing Invoices", 14, 14);
    autoTable(doc, {
      startY: 20,
      head: [["Invoice#", "Date", "Product Code", "Product", "Qty", "Unit", "Materials", "Labor", "Total", "Cost/Unit"]],
      body: invoices.map(i => [
        i.invoice_no, i.invoice_date || "", i.product_code || "", i.product_name_ar || "",
        fmt(i.output_qty, 1), i.output_unit || "", fmt(i.input_total, 0), fmt(i.labor_total, 0),
        fmt(i.output_total, 0), fmt(i.unit_cost),
      ]),
      styles: { fontSize: 8 }, headStyles: { fillColor: [120, 50, 200] },
    });
    doc.addPage("landscape");
    doc.setFontSize(14);
    doc.text("BOM Recipe Lines", 14, 14);
    autoTable(doc, {
      startY: 20,
      head: [["Inv#", "Product", "Type", "Mat Code", "Material", "Qty", "Unit", "Unit Cost", "Total"]],
      body: recipes.map(r => [
        r.invoice_no, r.product_name_ar || "", r.line_type, r.material_code || "",
        r.material_name_ar || "", fmt(r.quantity, 2), r.unit, fmt(r.unit_cost), fmt(r.line_total, 2),
      ]),
      styles: { fontSize: 7 }, headStyles: { fillColor: [255, 120, 0] },
    });
    doc.save(`meat-factory-report-${new Date().toISOString().slice(0,10)}.pdf`);
    toast.success("تم تصدير ملف PDF");
  };

  const exportBatchesExcel = () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(batches.map(b => ({
      "رقم الدفعة": b.batch_number, "المنتج": b.product_name_ar, "تاريخ الإنتاج": b.production_date,
      "الكمية المخططة": b.planned_qty, "الفعلية": b.actual_qty, "الوحدة": b.unit,
      "الحالة": statusLabels[b.status]?.label, "الجودة": qualityLabels[b.quality_status]?.label,
      "تكلفة المواد": b.materials_cost, "عمالة": b.labor_cost, "إجمالي": b.total_cost, "تكلفة/وحدة": b.unit_cost,
      "فاتورة المصدر": b.source_invoice_no, "ملاحظات": b.notes,
    })));
    XLSX.utils.book_append_sheet(wb, ws, "دفعات الإنتاج");
    XLSX.writeFile(wb, `production-batches-${new Date().toISOString().slice(0,10)}.xlsx`);
    toast.success("تم تصدير الدفعات");
  };

  // ============ CREATE BATCH ============
  const openCreateBatch = () => {
    setBatchForm({ source_invoice_no: "", planned_qty: 0, production_date: new Date().toISOString().slice(0,10), expiry_date: "", labor_cost: 0, notes: "" });
    setNewBatchOpen(true);
  };

  const saveBatch = async () => {
    if (!batchForm.source_invoice_no || !batchForm.planned_qty) {
      toast.error("يجب اختيار قالب فاتورة وكمية");
      return;
    }
    const inv = invoices.find(i => String(i.invoice_no) === batchForm.source_invoice_no);
    if (!inv) { toast.error("فاتورة غير صالحة"); return; }

    setSavingBatch(true);
    const batchNumber = `MFB-${new Date().toISOString().slice(0,10).replace(/-/g,"")}-${String(Math.floor(Math.random()*9999)).padStart(4,"0")}`;
    const { data: userData } = await supabase.auth.getUser();

    const { error } = await supabase.from("meat_factory_batches" as any).insert({
      batch_number: batchNumber,
      product_code: inv.product_code!,
      product_name_ar: inv.product_name_ar,
      planned_qty: Number(batchForm.planned_qty),
      unit: inv.output_unit || "كيلو",
      status: "planned",
      labor_cost: Number(batchForm.labor_cost) || 0,
      production_date: batchForm.production_date,
      expiry_date: batchForm.expiry_date || null,
      source_invoice_no: inv.invoice_no,
      notes: batchForm.notes || null,
      created_by: userData?.user?.id || null,
    });
    setSavingBatch(false);
    if (error) { toast.error("فشل الحفظ: " + error.message); return; }
    toast.success(`تم إنشاء أمر الإنتاج ${batchNumber}`);
    setNewBatchOpen(false);
    fetchAll();
  };

  // ============ APPROVE BATCH ============
  const approveBatch = async (batch: Batch) => {
    if (!confirm(`اعتماد الدفعة ${batch.batch_number} سيخصم المواد الخام تلقائيًا. متابعة؟`)) return;
    const { data, error } = await supabase.rpc("approve_meat_factory_batch" as any, { p_batch_id: batch.id });
    if (error) { toast.error("فشل الاعتماد: " + error.message); return; }
    toast.success(`تم اعتماد الدفعة. تكلفة المواد: ${fmt((data as any)?.materials_cost, 0)} ج`);
    fetchAll();
  };

  // ============ QC ============
  const openQc = (batch: Batch) => {
    setQcBatch(batch);
    setQcForm({ quality_status: batch.quality_status || "passed", quality_notes: batch.quality_notes || "", actual_qty: batch.actual_qty || batch.planned_qty });
  };
  const saveQc = async () => {
    if (!qcBatch) return;
    const newStatus = qcForm.quality_status === "failed" ? "cancelled" : "completed";
    const { error } = await supabase.from("meat_factory_batches" as any).update({
      quality_status: qcForm.quality_status, quality_notes: qcForm.quality_notes,
      actual_qty: Number(qcForm.actual_qty), status: newStatus, completed_at: new Date().toISOString(),
    }).eq("id", qcBatch.id);
    if (error) { toast.error(error.message); return; }
    toast.success("تم تحديث حالة الجودة");
    setQcBatch(null);
    fetchAll();
  };

  // ============ UI HELPERS ============
  const KPI = ({ icon: Icon, label, value, hint, color }: any) => (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${color}`}><Icon className="w-6 h-6" /></div>
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
          <KPI icon={Package} label="إجمالي المنتجات" value={totalProducts} hint={`${pricedProducts} لها تكلفة معتمدة`} color="bg-primary/10 text-primary" />
          <KPI icon={Boxes} label="المواد الخام" value={totalMaterials} hint={`${lowStockCount} مادة منخفضة المخزون`} color="bg-orange-500/10 text-orange-600" />
          <KPI icon={ClipboardList} label="فواتير التصنيع" value={totalInvoices} hint={`${fmt(totalOutputKg, 0)} كجم إنتاج`} color="bg-green-500/10 text-green-600" />
          <KPI icon={Coins} label="متوسط التكلفة/كجم" value={fmt(avgCostPerKg)} hint={`عمالة: ${fmt(totalLaborCost, 0)} ج`} color="bg-purple-500/10 text-purple-600" />
        </div>

        {/* Action bar */}
        <div className="flex flex-wrap items-center gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={exportInvoicesExcel}><FileSpreadsheet className="w-4 h-4 ml-1" />Excel</Button>
          <Button variant="outline" size="sm" onClick={exportInvoicesPDF}><FileText className="w-4 h-4 ml-1" />PDF</Button>
          <Button size="sm" onClick={openCreateBatch}><Plus className="w-4 h-4 ml-1" />أمر إنتاج جديد</Button>
        </div>

        <Tabs defaultValue="batches" className="w-full">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="batches"><Factory className="w-4 h-4 ml-1" />دفعات الإنتاج</TabsTrigger>
            <TabsTrigger value="products"><Package className="w-4 h-4 ml-1" />المنتجات</TabsTrigger>
            <TabsTrigger value="materials"><Boxes className="w-4 h-4 ml-1" />المواد الخام</TabsTrigger>
            <TabsTrigger value="invoices"><ClipboardList className="w-4 h-4 ml-1" />الفواتير</TabsTrigger>
            <TabsTrigger value="recipes"><Layers className="w-4 h-4 ml-1" />الوصفات</TabsTrigger>
          </TabsList>

          {/* BATCHES */}
          <TabsContent value="batches">
            <Card>
              <CardHeader className="flex-row items-center justify-between gap-2">
                <CardTitle className="text-base">دفعات الإنتاج ({batches.length})</CardTitle>
                <Button size="sm" variant="outline" onClick={exportBatchesExcel}><FileSpreadsheet className="w-4 h-4 ml-1" />تصدير</Button>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>رقم الدفعة</TableHead>
                      <TableHead>المنتج</TableHead>
                      <TableHead>تاريخ الإنتاج</TableHead>
                      <TableHead>المخطط/الفعلي</TableHead>
                      <TableHead>تكلفة المواد</TableHead>
                      <TableHead>إجمالي</TableHead>
                      <TableHead>الحالة</TableHead>
                      <TableHead>الجودة</TableHead>
                      <TableHead>إجراءات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {batches.map(b => (
                      <TableRow key={b.id}>
                        <TableCell className="font-mono text-xs">{b.batch_number}</TableCell>
                        <TableCell className="font-medium">{b.product_name_ar}</TableCell>
                        <TableCell>{b.production_date}</TableCell>
                        <TableCell>{fmt(b.planned_qty, 1)} / {b.actual_qty != null ? fmt(b.actual_qty, 1) : "—"} {b.unit}</TableCell>
                        <TableCell>{fmt(b.materials_cost, 0)} ج</TableCell>
                        <TableCell className="font-semibold">{fmt(b.total_cost, 0)} ج</TableCell>
                        <TableCell><Badge variant="outline" className={statusLabels[b.status]?.cls}>{statusLabels[b.status]?.label || b.status}</Badge></TableCell>
                        <TableCell><Badge variant="outline" className={qualityLabels[b.quality_status]?.cls}>{qualityLabels[b.quality_status]?.label || b.quality_status}</Badge></TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            {b.status === "planned" && (
                              <Button size="sm" variant="ghost" onClick={() => approveBatch(b)} title="اعتماد وخصم المواد">
                                <PlayCircle className="w-4 h-4 text-green-600" />
                              </Button>
                            )}
                            {b.status === "in_progress" && (
                              <Button size="sm" variant="ghost" onClick={() => openQc(b)} title="فحص جودة وإغلاق">
                                <CheckCircle2 className="w-4 h-4 text-primary" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!batches.length && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-6">لا توجد دفعات. أنشئ "أمر إنتاج جديد" للبدء.</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* PRODUCTS */}
          <TabsContent value="products">
            <Card>
              <CardHeader className="flex-row items-center justify-between gap-2">
                <CardTitle className="text-base">المنتجات ({filteredProducts.length})</CardTitle>
                <Input placeholder="بحث..." className="max-w-sm" value={productSearch} onChange={e => setProductSearch(e.target.value)} />
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {loading ? <div className="text-center py-8 text-muted-foreground">جاري التحميل...</div> : (
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>الكود</TableHead><TableHead>الباركود</TableHead><TableHead>الاسم</TableHead>
                      <TableHead>العبوة</TableHead><TableHead>تكلفة/كيلو</TableHead><TableHead>تكلفة العبوة</TableHead><TableHead>الحالة</TableHead>
                    </TableRow></TableHeader>
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
                          <TableCell>{p.cost_status === "تم التحديث" ? <Badge className="bg-green-500/10 text-green-700 border-green-300">محدّث</Badge> : <Badge variant="secondary">{p.cost_status || "—"}</Badge>}</TableCell>
                        </TableRow>
                      ))}
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
                <Input placeholder="بحث..." className="max-w-sm" value={materialSearch} onChange={e => setMaterialSearch(e.target.value)} />
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>الكود</TableHead><TableHead>الاسم</TableHead><TableHead>التصنيف</TableHead>
                    <TableHead>الوحدة</TableHead><TableHead>المخزون</TableHead><TableHead>الحد الأدنى</TableHead><TableHead>تكلفة الوحدة</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {filteredMaterials.map(m => {
                      const low = m.stock <= m.low_stock_threshold;
                      return (
                        <TableRow key={m.id} className={low ? "bg-red-500/5" : ""}>
                          <TableCell className="font-mono text-xs">{m.material_code}</TableCell>
                          <TableCell className="font-medium">{m.name_ar}</TableCell>
                          <TableCell><Badge variant="outline">{categoryLabels[m.category] || m.category}</Badge></TableCell>
                          <TableCell>{m.default_unit}</TableCell>
                          <TableCell className={low ? "text-red-600 font-bold" : "font-semibold"}>{fmt(m.stock, 2)}</TableCell>
                          <TableCell>{fmt(m.low_stock_threshold, 0)}</TableCell>
                          <TableCell>{m.avg_unit_cost > 0 ? `${fmt(m.avg_unit_cost)} ج` : "—"}</TableCell>
                        </TableRow>
                      );
                    })}
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
                <Input placeholder="بحث..." className="max-w-sm" value={invoiceSearch} onChange={e => setInvoiceSearch(e.target.value)} />
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>رقم</TableHead><TableHead>التاريخ</TableHead><TableHead>المنتج</TableHead>
                    <TableHead>الكمية</TableHead><TableHead>المواد</TableHead><TableHead>عمالة</TableHead><TableHead>إجمالي/كجم</TableHead><TableHead></TableHead>
                  </TableRow></TableHeader>
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
                        <TableCell><Button size="sm" variant="ghost" onClick={() => setSelectedInvoice(i)}><Eye className="w-4 h-4 ml-1" />تفاصيل</Button></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* RECIPES */}
          <TabsContent value="recipes">
            <Card>
              <CardHeader><CardTitle className="text-base">قوائم المواد (BOM) — {recipes.length} سطر من {new Set(recipes.map(r => r.product_code)).size} منتج</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>فاتورة</TableHead><TableHead>المنتج</TableHead><TableHead>النوع</TableHead>
                    <TableHead>كود المادة</TableHead><TableHead>المادة</TableHead><TableHead>الكمية</TableHead><TableHead>التكلفة</TableHead><TableHead>الإجمالي</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {recipes.slice(0, 500).map(r => (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono text-xs">{r.invoice_no}</TableCell>
                        <TableCell className="font-medium">{r.product_name_ar}</TableCell>
                        <TableCell>{r.line_type === "Output" ? <Badge className="bg-green-500/10 text-green-700 border-green-300">ناتج</Badge> : <Badge variant="outline">مدخل</Badge>}</TableCell>
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

      {/* ============ NEW BATCH DIALOG ============ */}
      <Dialog open={newBatchOpen} onOpenChange={setNewBatchOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>أمر إنتاج جديد</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>قالب الوصفة (فاتورة)</Label>
              <Select value={batchForm.source_invoice_no} onValueChange={(v) => setBatchForm(f => ({ ...f, source_invoice_no: v }))}>
                <SelectTrigger><SelectValue placeholder="اختر فاتورة مرجعية..." /></SelectTrigger>
                <SelectContent>
                  {invoices.map(i => (
                    <SelectItem key={i.id} value={String(i.invoice_no)}>
                      #{i.invoice_no} — {i.product_name_ar} ({fmt(i.output_qty,1)} {i.output_unit})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>الكمية المخططة</Label>
                <Input type="number" min={0} step={0.1} value={batchForm.planned_qty}
                  onChange={e => setBatchForm(f => ({ ...f, planned_qty: parseFloat(e.target.value) || 0 }))} />
              </div>
              <div>
                <Label>تكلفة العمالة</Label>
                <Input type="number" min={0} value={batchForm.labor_cost}
                  onChange={e => setBatchForm(f => ({ ...f, labor_cost: parseFloat(e.target.value) || 0 }))} />
              </div>
              <div>
                <Label>تاريخ الإنتاج</Label>
                <Input type="date" value={batchForm.production_date}
                  onChange={e => setBatchForm(f => ({ ...f, production_date: e.target.value }))} />
              </div>
              <div>
                <Label>تاريخ الصلاحية</Label>
                <Input type="date" value={batchForm.expiry_date}
                  onChange={e => setBatchForm(f => ({ ...f, expiry_date: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>ملاحظات</Label>
              <Textarea rows={2} value={batchForm.notes} onChange={e => setBatchForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
            <div className="text-xs text-muted-foreground">
              ستُحفظ الدفعة بحالة "مخطط". اضغط على زر التشغيل في الجدول لاعتمادها وخصم المواد تلقائيًا.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewBatchOpen(false)}>إلغاء</Button>
            <Button onClick={saveBatch} disabled={savingBatch}>{savingBatch ? "جاري الحفظ..." : "حفظ"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============ QC DIALOG ============ */}
      <Dialog open={!!qcBatch} onOpenChange={(o) => !o && setQcBatch(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>فحص الجودة وإغلاق الدفعة {qcBatch?.batch_number}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>الكمية الفعلية المنتجة ({qcBatch?.unit})</Label>
              <Input type="number" min={0} step={0.1} value={qcForm.actual_qty}
                onChange={e => setQcForm(f => ({ ...f, actual_qty: parseFloat(e.target.value) || 0 }))} />
            </div>
            <div>
              <Label>حالة الجودة</Label>
              <Select value={qcForm.quality_status} onValueChange={(v) => setQcForm(f => ({ ...f, quality_status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="passed">مطابق ✓</SelectItem>
                  <SelectItem value="failed">غير مطابق ✗</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>ملاحظات الفحص</Label>
              <Textarea rows={3} value={qcForm.quality_notes} onChange={e => setQcForm(f => ({ ...f, quality_notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQcBatch(null)}>إلغاء</Button>
            <Button onClick={saveQc}>
              {qcForm.quality_status === "failed" ? <><XCircle className="w-4 h-4 ml-1" />رفض وإلغاء</> : <><CheckCircle2 className="w-4 h-4 ml-1" />اعتماد وإغلاق</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============ INVOICE DETAILS DIALOG ============ */}
      <Dialog open={!!selectedInvoice} onOpenChange={(o) => !o && setSelectedInvoice(null)}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>تفاصيل فاتورة #{selectedInvoice?.invoice_no} — {selectedInvoice?.product_name_ar}</DialogTitle></DialogHeader>
          {selectedInvoice && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div><div className="text-muted-foreground">التاريخ</div><div className="font-semibold">{selectedInvoice.invoice_date}</div></div>
                <div><div className="text-muted-foreground">الإنتاج</div><div className="font-semibold">{fmt(selectedInvoice.output_qty, 1)} {selectedInvoice.output_unit}</div></div>
                <div><div className="text-muted-foreground">تكلفة المواد</div><div className="font-semibold">{fmt(selectedInvoice.input_total, 0)} ج</div></div>
                <div><div className="text-muted-foreground">عمالة</div><div className="font-semibold">{fmt(selectedInvoice.labor_total, 0)} ج</div></div>
                <div><div className="text-muted-foreground">إجمالي</div><div className="font-semibold">{fmt(selectedInvoice.output_total, 0)} ج</div></div>
                <div><div className="text-muted-foreground">التكلفة/كجم</div><div className="font-semibold text-primary">{fmt(selectedInvoice.unit_cost)} ج</div></div>
              </div>
              <Table>
                <TableHeader><TableRow><TableHead>النوع</TableHead><TableHead>المادة</TableHead><TableHead>الكمية</TableHead><TableHead>التكلفة</TableHead><TableHead>الإجمالي</TableHead></TableRow></TableHeader>
                <TableBody>
                  {invoiceRecipes.map(r => (
                    <TableRow key={r.id}>
                      <TableCell>{r.line_type === "Output" ? <Badge className="bg-green-500/10 text-green-700 border-green-300">ناتج</Badge> : <Badge variant="outline">مدخل</Badge>}</TableCell>
                      <TableCell className="font-medium">{r.material_name_ar} <span className="font-mono text-xs text-muted-foreground">{r.material_code}</span></TableCell>
                      <TableCell>{fmt(r.quantity, 2)} {r.unit}</TableCell>
                      <TableCell>{fmt(r.unit_cost)}</TableCell>
                      <TableCell className="font-semibold">{fmt(r.line_total, 2)} ج</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default MeatFactory;
