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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Factory, Package, ClipboardList, Boxes, Coins, Layers, Eye, Plus, FileSpreadsheet, FileText, CheckCircle2, XCircle, PlayCircle, History, AlertTriangle, FileDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { formatDate, formatDateTime } from "@/lib/dateFormat";

type Product = { id: string; product_code: string | null; barcode: string | null; name_ar: string; functional_name_ar: string | null; package_qty: number; package_unit: string; base_cost_unit: string | null; cost_per_base_unit: number | null; cost_price: number | null; sale_price: number | null; cost_status: string | null; source_document: string | null; source_date: string | null; notes: string | null; is_active: boolean; };
type RawMaterial = { id: string; material_code: string; name_ar: string; default_unit: string; avg_unit_cost: number; category: string; is_active: boolean; stock: number; low_stock_threshold: number; };
type Invoice = { id: string; invoice_no: number; invoice_date: string | null; source_document: string | null; product_code: string | null; product_name_ar: string | null; output_qty: number | null; output_unit: string | null; unit_cost: number | null; output_total: number | null; input_total: number | null; labor_total: number | null; notes: string | null; };
type Recipe = { id: string; invoice_no: number | null; invoice_date: string | null; product_code: string; product_name_ar: string | null; line_type: string; material_code: string | null; material_name_ar: string | null; quantity: number; unit: string; unit_cost: number | null; line_total: number | null; warehouse: string | null; labor_total_if_output: number | null; };
type Batch = { id: string; batch_number: string; product_code: string; product_name_ar: string | null; planned_qty: number; actual_qty: number | null; unit: string; status: string; quality_status: string; quality_notes: string | null; labor_cost: number; materials_cost: number; total_cost: number; unit_cost: number | null; production_date: string; expiry_date: string | null; source_invoice_no: number | null; notes: string | null; created_at: string; };
type Consumption = { id: string; batch_id: string; material_code: string | null; material_name_ar: string | null; quantity: number; unit: string | null; unit_cost: number; line_total: number; created_at: string; };
type QualityLog = { id: string; batch_id: string; from_status: string | null; to_status: string; actual_qty: number | null; notes: string | null; changed_at: string; };
type PreviewItem = { material_code: string; material_name_ar: string; required_qty: number; unit: string; stock: number; shortage: number; unit_cost: number; line_total: number; sufficient: boolean; };
type PreviewData = { scale: number; materials_cost: number; items: PreviewItem[]; shortages: any[]; can_approve: boolean; };
type AuditEntry = { id: string; batch_id: string; batch_number: string | null; product_name_ar: string | null; planned_qty: number | null; scale: number | null; attempted_by: string | null; attempted_at: string; outcome: string; error_message: string | null; materials_cost: number | null; shortages: any; impact: any; };

const fmt = (v: number | null | undefined, digits = 2) =>
  v == null ? "—" : Number(v).toLocaleString("en-GB", { minimumFractionDigits: digits, maximumFractionDigits: digits });

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
  const [consumption, setConsumption] = useState<Consumption[]>([]);
  const [qualityLogs, setQualityLogs] = useState<QualityLog[]>([]);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [profilesMap, setProfilesMap] = useState<Record<string, string>>({});
  const [failureDetails, setFailureDetails] = useState<{ batch?: Batch; shortages: any[] } | null>(null);
  const [loading, setLoading] = useState(true);

  const [productSearch, setProductSearch] = useState("");
  const [materialSearch, setMaterialSearch] = useState("");
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [consumptionFilter, setConsumptionFilter] = useState("");
  const [consumptionBatchFilter, setConsumptionBatchFilter] = useState("all");
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);

  // Batch creation
  const [newBatchOpen, setNewBatchOpen] = useState(false);
  const [batchForm, setBatchForm] = useState({
    source_invoice_no: "", planned_qty: 0,
    production_date: new Date().toISOString().slice(0, 10),
    expiry_date: "", labor_cost: 0, notes: "",
  });
  const [savingBatch, setSavingBatch] = useState(false);

  // QC dialog
  const [qcBatch, setQcBatch] = useState<Batch | null>(null);
  const [qcForm, setQcForm] = useState({ quality_status: "passed", quality_notes: "", actual_qty: 0 });

  // Preview/approve dialog
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewBatch, setPreviewBatch] = useState<Batch | null>(null);
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [approving, setApproving] = useState(false);

  const fetchAll = async () => {
    setLoading(true);
    const [p, m, i, r, b, c, q, a, prof] = await Promise.all([
      supabase.from("meat_factory_products" as any).select("*").order("name_ar"),
      supabase.from("meat_factory_raw_materials" as any).select("*").order("category").order("name_ar"),
      supabase.from("meat_factory_invoices" as any).select("*").order("invoice_date", { ascending: false }),
      supabase.from("meat_factory_recipes" as any).select("*").order("invoice_no", { ascending: false }),
      supabase.from("meat_factory_batches" as any).select("*").order("production_date", { ascending: false }),
      supabase.from("meat_factory_batch_consumption" as any).select("*").order("created_at", { ascending: false }),
      supabase.from("meat_factory_quality_log" as any).select("*").order("changed_at", { ascending: false }),
      supabase.from("meat_factory_approval_audit" as any).select("*").order("attempted_at", { ascending: false }).limit(500),
      supabase.from("profiles").select("id, full_name"),
    ]);
    setProducts((p.data as any) || []);
    setMaterials((m.data as any) || []);
    setInvoices((i.data as any) || []);
    setRecipes((r.data as any) || []);
    setBatches((b.data as any) || []);
    setConsumption((c.data as any) || []);
    setQualityLogs((q.data as any) || []);
    setAuditLog((a.data as any) || []);
    const map: Record<string, string> = {};
    ((prof.data as any) || []).forEach((u: any) => { map[u.id] = u.full_name || ""; });
    setProfilesMap(map);
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

  const batchMap = useMemo(() => {
    const m = new Map<string, Batch>();
    batches.forEach(b => m.set(b.id, b));
    return m;
  }, [batches]);

  const filteredConsumption = useMemo(() => {
    const q = consumptionFilter.trim().toLowerCase();
    return consumption.filter(c => {
      if (consumptionBatchFilter !== "all" && c.batch_id !== consumptionBatchFilter) return false;
      if (!q) return true;
      const b = batchMap.get(c.batch_id);
      return (c.material_name_ar || "").toLowerCase().includes(q)
        || (c.material_code || "").includes(q)
        || (b?.batch_number || "").toLowerCase().includes(q)
        || (b?.product_name_ar || "").toLowerCase().includes(q);
    });
  }, [consumption, consumptionFilter, consumptionBatchFilter, batchMap]);

  // ============ EXPORTS ============
  const exportInvoicesExcel = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(invoices.map(i => ({
      "رقم الفاتورة": i.invoice_no, "التاريخ": i.invoice_date, "المستند": i.source_document,
      "كود المنتج": i.product_code, "المنتج": i.product_name_ar,
      "الكمية المنتجة": i.output_qty, "الوحدة": i.output_unit,
      "تكلفة المواد": i.input_total, "عمالة": i.labor_total, "إجمالي": i.output_total, "تكلفة/وحدة": i.unit_cost,
    }))), "الفواتير");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(recipes.map(r => ({
      "رقم الفاتورة": r.invoice_no, "التاريخ": r.invoice_date, "المنتج": r.product_name_ar,
      "النوع": r.line_type === "Output" ? "ناتج" : "مدخل",
      "كود المادة": r.material_code, "المادة": r.material_name_ar,
      "الكمية": r.quantity, "الوحدة": r.unit, "تكلفة الوحدة": r.unit_cost, "الإجمالي": r.line_total,
    }))), "الوصفات BOM");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(batches.map(b => ({
      "رقم الدفعة": b.batch_number, "المنتج": b.product_name_ar, "التاريخ": b.production_date,
      "مخطط": b.planned_qty, "فعلي": b.actual_qty, "الحالة": statusLabels[b.status]?.label,
      "الجودة": qualityLabels[b.quality_status]?.label,
      "تكلفة المواد": b.materials_cost, "عمالة": b.labor_cost, "إجمالي": b.total_cost,
    }))), "الدفعات");
    XLSX.writeFile(wb, `meat-factory-report-${new Date().toISOString().slice(0,10)}.xlsx`);
    toast.success("تم تصدير ملف Excel");
  };

  // Comprehensive PDF: invoices, BOM, batches, cost summary
  const exportFullPDF = () => {
    const doc = new jsPDF({ orientation: "landscape" });
    const today = new Date().toISOString().slice(0, 10);

    // Cover / Summary
    doc.setFontSize(16);
    doc.text("Meat Factory Comprehensive Report", 14, 14);
    doc.setFontSize(10);
    doc.text(`Generated: ${today}`, 14, 22);
    autoTable(doc, {
      startY: 28,
      head: [["Metric", "Value"]],
      body: [
        ["Total Products", String(totalProducts)],
        ["Raw Materials", `${totalMaterials} (low stock: ${lowStockCount})`],
        ["Manufacturing Invoices", String(totalInvoices)],
        ["Total Output (kg)", fmt(totalOutputKg, 1)],
        ["Total Material Cost (EGP)", fmt(totalInputCost, 0)],
        ["Total Labor Cost (EGP)", fmt(totalLaborCost, 0)],
        ["Avg Cost / kg (EGP)", fmt(avgCostPerKg)],
        ["Production Batches", String(batches.length)],
        ["Completed Batches", String(batches.filter(b => b.status === 'completed').length)],
      ],
      styles: { fontSize: 10 }, headStyles: { fillColor: [120, 50, 200] },
    });

    // Invoices
    doc.addPage("landscape");
    doc.setFontSize(14);
    doc.text("Manufacturing Invoices", 14, 14);
    autoTable(doc, {
      startY: 20,
      head: [["Inv#", "Date", "Code", "Product", "Qty", "Unit", "Materials", "Labor", "Total", "Cost/U"]],
      body: invoices.map(i => [
        i.invoice_no, i.invoice_date || "", i.product_code || "", i.product_name_ar || "",
        fmt(i.output_qty, 1), i.output_unit || "", fmt(i.input_total, 0), fmt(i.labor_total, 0),
        fmt(i.output_total, 0), fmt(i.unit_cost),
      ]),
      styles: { fontSize: 8 }, headStyles: { fillColor: [120, 50, 200] },
    });

    // BOM
    doc.addPage("landscape");
    doc.setFontSize(14);
    doc.text("BOM / Recipe Lines", 14, 14);
    autoTable(doc, {
      startY: 20,
      head: [["Inv#", "Product", "Type", "Mat Code", "Material", "Qty", "Unit", "Unit Cost", "Total"]],
      body: recipes.map(r => [
        r.invoice_no, r.product_name_ar || "", r.line_type, r.material_code || "",
        r.material_name_ar || "", fmt(r.quantity, 2), r.unit, fmt(r.unit_cost), fmt(r.line_total, 2),
      ]),
      styles: { fontSize: 7 }, headStyles: { fillColor: [255, 120, 0] },
    });

    // Batches summary
    doc.addPage("landscape");
    doc.setFontSize(14);
    doc.text("Production Batches", 14, 14);
    autoTable(doc, {
      startY: 20,
      head: [["Batch#", "Product", "Date", "Planned", "Actual", "Status", "Quality", "Materials", "Labor", "Total", "Cost/U"]],
      body: batches.map(b => [
        b.batch_number, b.product_name_ar || "", b.production_date,
        fmt(b.planned_qty, 1), b.actual_qty != null ? fmt(b.actual_qty, 1) : "—",
        statusLabels[b.status]?.label || b.status, qualityLabels[b.quality_status]?.label || b.quality_status,
        fmt(b.materials_cost, 0), fmt(b.labor_cost, 0), fmt(b.total_cost, 0), fmt(b.unit_cost),
      ]),
      styles: { fontSize: 8 }, headStyles: { fillColor: [40, 130, 60] },
    });

    doc.save(`meat-factory-full-report-${today}.pdf`);
    toast.success("تم تصدير التقرير الشامل PDF");
  };

  // Per-batch detailed PDF: recipe + consumption + quality log + cost summary
  const exportBatchPDF = (batch: Batch) => {
    const doc = new jsPDF({ orientation: "portrait" });
    const recipe = recipes.filter(r => r.invoice_no === batch.source_invoice_no && r.product_code === batch.product_code);
    const cons = consumption.filter(c => c.batch_id === batch.id);
    const logs = qualityLogs.filter(l => l.batch_id === batch.id);

    doc.setFontSize(14);
    doc.text(`Batch Report: ${batch.batch_number}`, 14, 14);
    doc.setFontSize(10);
    doc.text(`Product: ${batch.product_name_ar || batch.product_code}`, 14, 22);
    doc.text(`Production Date: ${batch.production_date}`, 14, 28);

    autoTable(doc, {
      startY: 34,
      head: [["Field", "Value"]],
      body: [
        ["Planned Qty", `${fmt(batch.planned_qty, 2)} ${batch.unit}`],
        ["Actual Qty", batch.actual_qty != null ? `${fmt(batch.actual_qty, 2)} ${batch.unit}` : "—"],
        ["Status", statusLabels[batch.status]?.label || batch.status],
        ["Quality", qualityLabels[batch.quality_status]?.label || batch.quality_status],
        ["Materials Cost", `${fmt(batch.materials_cost, 2)} EGP`],
        ["Labor Cost", `${fmt(batch.labor_cost, 2)} EGP`],
        ["Total Cost", `${fmt(batch.total_cost, 2)} EGP`],
        ["Cost / Unit", batch.unit_cost != null ? `${fmt(batch.unit_cost)} EGP` : "—"],
        ["Source Invoice", batch.source_invoice_no ? `#${batch.source_invoice_no}` : "—"],
      ],
      styles: { fontSize: 9 }, headStyles: { fillColor: [120, 50, 200] },
    });

    // Recipe (template)
    const yAfter1 = (doc as any).lastAutoTable.finalY + 8;
    doc.setFontSize(12);
    doc.text("Recipe Template (BOM)", 14, yAfter1);
    autoTable(doc, {
      startY: yAfter1 + 4,
      head: [["Type", "Mat Code", "Material", "Qty", "Unit", "Unit Cost", "Total"]],
      body: recipe.map(r => [
        r.line_type, r.material_code || "", r.material_name_ar || "",
        fmt(r.quantity, 2), r.unit, fmt(r.unit_cost), fmt(r.line_total, 2),
      ]),
      styles: { fontSize: 8 }, headStyles: { fillColor: [255, 120, 0] },
    });

    // Actual consumption
    const yAfter2 = (doc as any).lastAutoTable.finalY + 8;
    doc.setFontSize(12);
    doc.text("Actual Material Consumption", 14, yAfter2);
    if (cons.length) {
      autoTable(doc, {
        startY: yAfter2 + 4,
        head: [["Mat Code", "Material", "Qty", "Unit", "Unit Cost", "Total"]],
        body: cons.map(c => [
          c.material_code || "", c.material_name_ar || "",
          fmt(c.quantity, 3), c.unit || "", fmt(c.unit_cost), fmt(c.line_total, 2),
        ]),
        foot: [["", "Total", "", "", "", fmt(cons.reduce((s, x) => s + Number(x.line_total || 0), 0), 2)]],
        styles: { fontSize: 8 }, headStyles: { fillColor: [40, 130, 60] },
      });
    } else {
      doc.setFontSize(9);
      doc.text("(No consumption recorded — batch not yet approved)", 14, yAfter2 + 8);
    }

    // Quality log
    const yAfter3 = (doc as any).lastAutoTable?.finalY + 8 || yAfter2 + 20;
    doc.setFontSize(12);
    doc.text("Quality Change Log", 14, yAfter3);
    if (logs.length) {
      autoTable(doc, {
        startY: yAfter3 + 4,
        head: [["When", "From", "To", "Actual Qty", "Notes"]],
        body: logs.map(l => [
          formatDateTime(l.changed_at),
          l.from_status || "—", l.to_status,
          l.actual_qty != null ? fmt(l.actual_qty, 2) : "—",
          l.notes || "",
        ]),
        styles: { fontSize: 8 }, headStyles: { fillColor: [80, 80, 200] },
      });
    } else {
      doc.setFontSize(9);
      doc.text("(No quality transitions recorded)", 14, yAfter3 + 8);
    }

    doc.save(`batch-${batch.batch_number}.pdf`);
    toast.success("تم تصدير تقرير الدفعة");
  };

  const exportConsumptionExcel = () => {
    const ws = XLSX.utils.json_to_sheet(filteredConsumption.map(c => {
      const b = batchMap.get(c.batch_id);
      return {
        "رقم الدفعة": b?.batch_number || "",
        "المنتج": b?.product_name_ar || "",
        "تاريخ الإنتاج": b?.production_date || "",
        "كود المادة": c.material_code,
        "المادة": c.material_name_ar,
        "الكمية المستهلكة": c.quantity,
        "الوحدة": c.unit,
        "تكلفة الوحدة": c.unit_cost,
        "الإجمالي": c.line_total,
        "وقت التسجيل": c.created_at,
      };
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "استهلاك المواد");
    XLSX.writeFile(wb, `material-consumption-${new Date().toISOString().slice(0,10)}.xlsx`);
    toast.success("تم تصدير سجل الاستهلاك");
  };

  // ============ CREATE BATCH ============
  const openCreateBatch = () => {
    setBatchForm({ source_invoice_no: "", planned_qty: 0, production_date: new Date().toISOString().slice(0,10), expiry_date: "", labor_cost: 0, notes: "" });
    setNewBatchOpen(true);
  };

  const saveBatch = async () => {
    if (!batchForm.source_invoice_no || !batchForm.planned_qty) {
      toast.error("يجب اختيار قالب فاتورة وكمية"); return;
    }
    const inv = invoices.find(i => String(i.invoice_no) === batchForm.source_invoice_no);
    if (!inv) { toast.error("فاتورة غير صالحة"); return; }
    setSavingBatch(true);
    const batchNumber = `MFB-${new Date().toISOString().slice(0,10).replace(/-/g,"")}-${String(Math.floor(Math.random()*9999)).padStart(4,"0")}`;
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase.from("meat_factory_batches" as any).insert({
      batch_number: batchNumber, product_code: inv.product_code!, product_name_ar: inv.product_name_ar,
      planned_qty: Number(batchForm.planned_qty), unit: inv.output_unit || "كيلو",
      status: "planned", labor_cost: Number(batchForm.labor_cost) || 0,
      production_date: batchForm.production_date,
      expiry_date: batchForm.expiry_date || null,
      source_invoice_no: inv.invoice_no, notes: batchForm.notes || null,
      created_by: userData?.user?.id || null,
    });
    setSavingBatch(false);
    if (error) { toast.error("فشل الحفظ: " + error.message); return; }
    toast.success(`تم إنشاء أمر الإنتاج ${batchNumber}`);
    setNewBatchOpen(false);
    fetchAll();
  };

  // ============ PREVIEW + APPROVE BATCH ============
  const openPreview = async (batch: Batch) => {
    setPreviewBatch(batch);
    setPreviewData(null);
    setPreviewOpen(true);
    setPreviewLoading(true);
    const { data, error } = await supabase.rpc("preview_meat_factory_batch_requirements" as any, { p_batch_id: batch.id });
    setPreviewLoading(false);
    if (error) { toast.error("تعذر حساب المتطلبات: " + error.message); setPreviewOpen(false); return; }
    setPreviewData(data as any);
  };

  const confirmApprove = async () => {
    if (!previewBatch) return;
    setApproving(true);
    const { data, error } = await supabase.rpc("approve_meat_factory_batch" as any, { p_batch_id: previewBatch.id });
    setApproving(false);
    if (error) {
      const msg = error.message || "";
      // Parse: INSUFFICIENT_STOCK::<count>::<jsonArray>
      const match = msg.match(/INSUFFICIENT_STOCK::(\d+)::(\[.*\])/s);
      if (match) {
        try {
          const shortages = JSON.parse(match[2]);
          setFailureDetails({ batch: previewBatch, shortages });
          setPreviewOpen(false);
        } catch {
          toast.error("مخزون غير كافٍ");
        }
      } else {
        toast.error("فشل الاعتماد: " + msg);
      }
      fetchAll();
      return;
    }
    toast.success(`تم اعتماد الدفعة. تكلفة المواد: ${fmt((data as any)?.materials_cost, 0)} ج`);
    setPreviewOpen(false);
    setPreviewBatch(null);
    fetchAll();
  };

  // ============ QC ============
  const openQc = (batch: Batch) => {
    setQcBatch(batch);
    setQcForm({ quality_status: batch.quality_status === "pending" ? "passed" : batch.quality_status, quality_notes: batch.quality_notes || "", actual_qty: batch.actual_qty || batch.planned_qty });
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
    <Card><CardContent className="p-4 flex items-center gap-3">
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${color}`}><Icon className="w-6 h-6" /></div>
      <div className="flex-1">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-bold">{value}</div>
        {hint && <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>}
      </div>
    </CardContent></Card>
  );

  const batchLogs = (id: string) => qualityLogs.filter(l => l.batch_id === id);

  return (
    <DashboardLayout>
      <Header title="مصنع اللحوم" subtitle="تصنيع المنتجات المصنعة من النعام" />

      <div className="p-4 space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPI icon={Package} label="إجمالي المنتجات" value={totalProducts} hint={`${pricedProducts} لها تكلفة معتمدة`} color="bg-primary/10 text-primary" />
          <KPI icon={Boxes} label="المواد الخام" value={totalMaterials} hint={`${lowStockCount} مادة منخفضة المخزون`} color="bg-orange-500/10 text-orange-600" />
          <KPI icon={ClipboardList} label="فواتير التصنيع" value={totalInvoices} hint={`${fmt(totalOutputKg, 0)} كجم إنتاج`} color="bg-green-500/10 text-green-600" />
          <KPI icon={Coins} label="متوسط التكلفة/كجم" value={fmt(avgCostPerKg)} hint={`عمالة: ${fmt(totalLaborCost, 0)} ج`} color="bg-purple-500/10 text-purple-600" />
        </div>

        <div className="flex flex-wrap items-center gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={exportInvoicesExcel}><FileSpreadsheet className="w-4 h-4 ml-1" />Excel شامل</Button>
          <Button variant="outline" size="sm" onClick={exportFullPDF}><FileText className="w-4 h-4 ml-1" />PDF شامل</Button>
          <Button size="sm" onClick={openCreateBatch}><Plus className="w-4 h-4 ml-1" />أمر إنتاج جديد</Button>
        </div>

        <Tabs defaultValue="batches" className="w-full">
          <TabsList className="grid w-full grid-cols-7">
            <TabsTrigger value="batches"><Factory className="w-4 h-4 ml-1" />الدفعات</TabsTrigger>
            <TabsTrigger value="consumption"><History className="w-4 h-4 ml-1" />الاستهلاك</TabsTrigger>
            <TabsTrigger value="audit"><ClipboardList className="w-4 h-4 ml-1" />سجل الاعتمادات</TabsTrigger>
            <TabsTrigger value="products"><Package className="w-4 h-4 ml-1" />المنتجات</TabsTrigger>
            <TabsTrigger value="materials"><Boxes className="w-4 h-4 ml-1" />المواد الخام</TabsTrigger>
            <TabsTrigger value="invoices"><ClipboardList className="w-4 h-4 ml-1" />الفواتير</TabsTrigger>
            <TabsTrigger value="recipes"><Layers className="w-4 h-4 ml-1" />الوصفات</TabsTrigger>
          </TabsList>

          {/* BATCHES */}
          <TabsContent value="batches">
            <Card>
              <CardHeader><CardTitle className="text-base">دفعات الإنتاج ({batches.length})</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>رقم الدفعة</TableHead><TableHead>المنتج</TableHead><TableHead>التاريخ</TableHead>
                    <TableHead>مخطط/فعلي</TableHead><TableHead>تكلفة المواد</TableHead><TableHead>إجمالي</TableHead>
                    <TableHead>الحالة</TableHead><TableHead>الجودة</TableHead><TableHead>سجل</TableHead><TableHead>إجراءات</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {batches.map(b => {
                      const logs = batchLogs(b.id);
                      return (
                        <TableRow key={b.id}>
                          <TableCell className="font-mono text-xs">{b.batch_number}</TableCell>
                          <TableCell className="font-medium">{b.product_name_ar}</TableCell>
                          <TableCell>{b.production_date}</TableCell>
                          <TableCell>{fmt(b.planned_qty, 1)} / {b.actual_qty != null ? fmt(b.actual_qty, 1) : "—"} {b.unit}</TableCell>
                          <TableCell>{fmt(b.materials_cost, 0)} ج</TableCell>
                          <TableCell className="font-semibold">{fmt(b.total_cost, 0)} ج</TableCell>
                          <TableCell><Badge variant="outline" className={statusLabels[b.status]?.cls}>{statusLabels[b.status]?.label || b.status}</Badge></TableCell>
                          <TableCell><Badge variant="outline" className={qualityLabels[b.quality_status]?.cls}>{qualityLabels[b.quality_status]?.label || b.quality_status}</Badge></TableCell>
                          <TableCell className="text-xs text-muted-foreground">{logs.length ? `${logs.length} تغيير` : "—"}</TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              {b.status === "planned" && (
                                <Button size="sm" variant="ghost" onClick={() => openPreview(b)} title="فحص ثم اعتماد">
                                  <PlayCircle className="w-4 h-4 text-green-600" />
                                </Button>
                              )}
                              {b.status === "in_progress" && (
                                <Button size="sm" variant="ghost" onClick={() => openQc(b)} title="فحص جودة">
                                  <CheckCircle2 className="w-4 h-4 text-primary" />
                                </Button>
                              )}
                              <Button size="sm" variant="ghost" onClick={() => exportBatchPDF(b)} title="تصدير PDF تفصيلي">
                                <FileDown className="w-4 h-4 text-purple-600" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {!batches.length && <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-6">لا توجد دفعات.</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Quality logs for all batches */}
            {qualityLogs.length > 0 && (
              <Card className="mt-4">
                <CardHeader><CardTitle className="text-base flex items-center gap-2"><History className="w-4 h-4" />سجل تغييرات الجودة ({qualityLogs.length})</CardTitle></CardHeader>
                <CardContent className="overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>الدفعة</TableHead><TableHead>المنتج</TableHead><TableHead>من</TableHead><TableHead>إلى</TableHead>
                      <TableHead>الكمية الفعلية</TableHead><TableHead>الملاحظات</TableHead><TableHead>التاريخ</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {qualityLogs.slice(0, 100).map(l => {
                        const b = batchMap.get(l.batch_id);
                        return (
                          <TableRow key={l.id}>
                            <TableCell className="font-mono text-xs">{b?.batch_number || "—"}</TableCell>
                            <TableCell>{b?.product_name_ar || "—"}</TableCell>
                            <TableCell><Badge variant="outline" className={qualityLabels[l.from_status || "pending"]?.cls}>{qualityLabels[l.from_status || "pending"]?.label || l.from_status || "—"}</Badge></TableCell>
                            <TableCell><Badge variant="outline" className={qualityLabels[l.to_status]?.cls}>{qualityLabels[l.to_status]?.label || l.to_status}</Badge></TableCell>
                            <TableCell>{l.actual_qty != null ? fmt(l.actual_qty, 2) : "—"}</TableCell>
                            <TableCell className="max-w-xs truncate">{l.notes || "—"}</TableCell>
                            <TableCell className="text-xs">{formatDateTime(l.changed_at)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* CONSUMPTION */}
          <TabsContent value="consumption">
            <Card>
              <CardHeader className="flex-row items-center justify-between gap-2 flex-wrap">
                <CardTitle className="text-base">سجل استهلاك المواد ({filteredConsumption.length})</CardTitle>
                <div className="flex gap-2 flex-wrap">
                  <Select value={consumptionBatchFilter} onValueChange={setConsumptionBatchFilter}>
                    <SelectTrigger className="w-56"><SelectValue placeholder="فلتر بالدفعة" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">كل الدفعات</SelectItem>
                      {batches.map(b => <SelectItem key={b.id} value={b.id}>{b.batch_number} — {b.product_name_ar}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input placeholder="بحث مادة/منتج/دفعة..." className="w-56" value={consumptionFilter} onChange={e => setConsumptionFilter(e.target.value)} />
                  <Button size="sm" variant="outline" onClick={exportConsumptionExcel}><FileSpreadsheet className="w-4 h-4 ml-1" />تصدير</Button>
                </div>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>الدفعة</TableHead><TableHead>المنتج</TableHead><TableHead>كود المادة</TableHead>
                    <TableHead>المادة</TableHead><TableHead>الكمية</TableHead><TableHead>الوحدة</TableHead>
                    <TableHead>تكلفة الوحدة</TableHead><TableHead>الإجمالي</TableHead><TableHead>التاريخ</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {filteredConsumption.slice(0, 500).map(c => {
                      const b = batchMap.get(c.batch_id);
                      return (
                        <TableRow key={c.id}>
                          <TableCell className="font-mono text-xs">{b?.batch_number || "—"}</TableCell>
                          <TableCell>{b?.product_name_ar || "—"}</TableCell>
                          <TableCell className="font-mono text-xs">{c.material_code}</TableCell>
                          <TableCell className="font-medium">{c.material_name_ar}</TableCell>
                          <TableCell>{fmt(c.quantity, 3)}</TableCell>
                          <TableCell>{c.unit}</TableCell>
                          <TableCell>{fmt(c.unit_cost)}</TableCell>
                          <TableCell className="font-semibold">{fmt(c.line_total, 2)} ج</TableCell>
                          <TableCell className="text-xs">{formatDate(c.created_at)}</TableCell>
                        </TableRow>
                      );
                    })}
                    {!filteredConsumption.length && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-6">لا توجد سجلات استهلاك.</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* AUDIT */}
          <TabsContent value="audit">
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><ClipboardList className="w-4 h-4" />سجل تدقيق اعتماد الدفعات ({auditLog.length})</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>الوقت</TableHead><TableHead>الدفعة</TableHead><TableHead>المنتج</TableHead>
                    <TableHead>الكمية</TableHead><TableHead>المستخدم</TableHead><TableHead>النتيجة</TableHead>
                    <TableHead>تكلفة المواد</TableHead><TableHead>أثر المخزون / السبب</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {auditLog.map(a => {
                      const ok = a.outcome === "success";
                      const impactArr = Array.isArray(a.impact) ? a.impact : [];
                      const shortArr = Array.isArray(a.shortages) ? a.shortages : [];
                      return (
                        <TableRow key={a.id} className={ok ? "" : "bg-red-500/5"}>
                          <TableCell className="text-xs whitespace-nowrap">{formatDateTime(a.attempted_at)}</TableCell>
                          <TableCell className="font-mono text-xs">{a.batch_number}</TableCell>
                          <TableCell className="text-sm">{a.product_name_ar}</TableCell>
                          <TableCell>{fmt(a.planned_qty, 1)}</TableCell>
                          <TableCell className="text-xs">{a.attempted_by ? (profilesMap[a.attempted_by] || a.attempted_by.slice(0, 8)) : "—"}</TableCell>
                          <TableCell>
                            {ok ? <Badge className="bg-green-500/10 text-green-700 border-green-300">نجح</Badge>
                              : <Badge className="bg-red-500/10 text-red-700 border-red-300">{a.outcome === 'insufficient_stock' ? 'مخزون ناقص' : 'فشل'}</Badge>}
                          </TableCell>
                          <TableCell>{a.materials_cost != null ? `${fmt(a.materials_cost, 0)} ج` : "—"}</TableCell>
                          <TableCell className="text-xs max-w-md">
                            {ok && impactArr.length > 0 && (
                              <div className="space-y-0.5">
                                {impactArr.slice(0, 3).map((it: any, idx: number) => (
                                  <div key={idx}>
                                    <span className="font-medium">{it.material_name_ar}</span>: {fmt(it.stock_before, 2)} → <span className="text-orange-600">{fmt(it.stock_after, 2)}</span> (خصم {fmt(it.required, 3)} {it.unit})
                                  </div>
                                ))}
                                {impactArr.length > 3 && <div className="text-muted-foreground">+ {impactArr.length - 3} مادة أخرى…</div>}
                              </div>
                            )}
                            {!ok && shortArr.length > 0 && (
                              <div className="space-y-0.5">
                                {shortArr.map((s: any, idx: number) => (
                                  <div key={idx} className="text-red-700">
                                    <span className="font-medium">{s.material_name_ar}</span>: عجز <strong>{fmt(s.short_by, 3)}</strong> {s.unit} (مطلوب {fmt(s.required, 3)}، متاح {fmt(s.available, 2)})
                                  </div>
                                ))}
                              </div>
                            )}
                            {!ok && shortArr.length === 0 && (a.error_message || "—")}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {!auditLog.length && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">لا توجد عمليات اعتماد بعد.</TableCell></TableRow>}
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

      {/* NEW BATCH DIALOG */}
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
              <div><Label>الكمية المخططة</Label><Input type="number" min={0} step={0.1} value={batchForm.planned_qty} onChange={e => setBatchForm(f => ({ ...f, planned_qty: parseFloat(e.target.value) || 0 }))} /></div>
              <div><Label>تكلفة العمالة</Label><Input type="number" min={0} value={batchForm.labor_cost} onChange={e => setBatchForm(f => ({ ...f, labor_cost: parseFloat(e.target.value) || 0 }))} /></div>
              <div><Label>تاريخ الإنتاج</Label><Input type="date" value={batchForm.production_date} onChange={e => setBatchForm(f => ({ ...f, production_date: e.target.value }))} /></div>
              <div><Label>تاريخ الصلاحية</Label><Input type="date" value={batchForm.expiry_date} onChange={e => setBatchForm(f => ({ ...f, expiry_date: e.target.value }))} /></div>
            </div>
            <div><Label>ملاحظات</Label><Textarea rows={2} value={batchForm.notes} onChange={e => setBatchForm(f => ({ ...f, notes: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewBatchOpen(false)}>إلغاء</Button>
            <Button onClick={saveBatch} disabled={savingBatch}>{savingBatch ? "جاري الحفظ..." : "حفظ"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PREVIEW / APPROVE DIALOG */}
      <Dialog open={previewOpen} onOpenChange={(o) => { if (!o) { setPreviewOpen(false); setPreviewBatch(null); setPreviewData(null); } }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>فحص متطلبات الدفعة {previewBatch?.batch_number}</DialogTitle></DialogHeader>
          {previewLoading && <div className="text-center py-6 text-muted-foreground">جاري حساب المتطلبات...</div>}
          {previewData && (
            <div className="space-y-3">
              {!previewData.can_approve && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>مخزون غير كافٍ</AlertTitle>
                  <AlertDescription>
                    لا يمكن اعتماد الدفعة. {previewData.shortages.length} مادة بمخزون أقل من المطلوب. راجع الأسطر المظللة بالأحمر.
                  </AlertDescription>
                </Alert>
              )}
              {previewData.can_approve && (
                <Alert>
                  <CheckCircle2 className="h-4 w-4" />
                  <AlertTitle>المخزون كافٍ</AlertTitle>
                  <AlertDescription>
                    إجمالي تكلفة المواد المتوقعة: {fmt(previewData.materials_cost, 2)} ج — معامل التكبير: {fmt(previewData.scale, 3)}
                  </AlertDescription>
                </Alert>
              )}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                <div className="p-2 border rounded"><div className="text-xs text-muted-foreground">عدد المواد</div><div className="font-bold">{previewData.items.length}</div></div>
                <div className="p-2 border rounded"><div className="text-xs text-muted-foreground">معامل التكبير</div><div className="font-bold">×{fmt(previewData.scale, 3)}</div></div>
                <div className="p-2 border rounded"><div className="text-xs text-muted-foreground">تكلفة المواد</div><div className="font-bold text-primary">{fmt(previewData.materials_cost, 2)} ج</div></div>
                <div className={`p-2 border rounded ${previewData.shortages.length ? "bg-red-500/10 border-red-300" : "bg-green-500/10 border-green-300"}`}>
                  <div className="text-xs text-muted-foreground">مواد ناقصة</div>
                  <div className={`font-bold ${previewData.shortages.length ? "text-red-600" : "text-green-600"}`}>{previewData.shortages.length}</div>
                </div>
              </div>

              {previewData.shortages.length > 0 && (
                <div className="border border-red-300 bg-red-500/5 rounded p-3 space-y-1">
                  <div className="font-semibold text-red-700 flex items-center gap-1"><AlertTriangle className="w-4 h-4" />المواد الناقصة:</div>
                  {previewData.shortages.map((s: any, i: number) => (
                    <div key={i} className="text-sm flex justify-between">
                      <span className="font-medium">{s.material_name_ar} <span className="font-mono text-xs text-muted-foreground">({s.material_code})</span></span>
                      <span className="text-red-600">عجز <strong>{fmt(s.short_by, 3)}</strong> {s.unit} (مطلوب {fmt(s.required, 3)} — متاح {fmt(s.available, 2)})</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="text-xs text-muted-foreground border-t pt-2">تفاصيل الأثر على المخزون لكل مادة:</div>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>كود</TableHead><TableHead>المادة</TableHead>
                  <TableHead>المطلوب</TableHead><TableHead>المتاح</TableHead>
                  <TableHead>بعد الخصم</TableHead><TableHead>العجز</TableHead>
                  <TableHead>تكلفة الوحدة</TableHead><TableHead>الإجمالي</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {previewData.items.map((it, idx) => {
                    const after = it.stock - it.required_qty;
                    return (
                      <TableRow key={idx} className={!it.sufficient ? "bg-red-500/10" : ""}>
                        <TableCell className="font-mono text-xs">{it.material_code}</TableCell>
                        <TableCell className="font-medium">{it.material_name_ar}</TableCell>
                        <TableCell>{fmt(it.required_qty, 3)} {it.unit}</TableCell>
                        <TableCell className={!it.sufficient ? "text-red-600 font-bold" : ""}>{fmt(it.stock, 2)}</TableCell>
                        <TableCell className={after < 0 ? "text-red-600 font-bold" : "text-green-700 font-semibold"}>{fmt(after, 2)}</TableCell>
                        <TableCell className="text-red-600 font-semibold">{it.shortage > 0 ? fmt(it.shortage, 3) : "—"}</TableCell>
                        <TableCell>{fmt(it.unit_cost)}</TableCell>
                        <TableCell className="font-semibold">{fmt(it.line_total, 2)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              {previewData.can_approve && (
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>تأكيد التنفيذ</AlertTitle>
                  <AlertDescription>
                    عند الاعتماد سيتم خصم المواد أعلاه من المخزون فوراً، وتسجيل استهلاكها، وتحويل حالة الدفعة إلى «قيد التنفيذ». هذا الإجراء لا يمكن التراجع عنه تلقائياً.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewOpen(false)}>إغلاق</Button>
            <Button onClick={confirmApprove} disabled={!previewData?.can_approve || approving}>
              {approving ? "جاري الاعتماد..." : <><PlayCircle className="w-4 h-4 ml-1" />اعتماد وخصم المواد</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* QC DIALOG */}
      <Dialog open={!!qcBatch} onOpenChange={(o) => !o && setQcBatch(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>فحص الجودة وإغلاق الدفعة {qcBatch?.batch_number}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>الكمية الفعلية المنتجة ({qcBatch?.unit})</Label>
              <Input type="number" min={0} step={0.1} value={qcForm.actual_qty} onChange={e => setQcForm(f => ({ ...f, actual_qty: parseFloat(e.target.value) || 0 }))} />
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
            {qcBatch && batchLogs(qcBatch.id).length > 0 && (
              <div className="border-t pt-3">
                <div className="text-xs text-muted-foreground mb-2">سجل التغييرات السابقة:</div>
                <div className="space-y-1 text-xs max-h-32 overflow-y-auto">
                  {batchLogs(qcBatch.id).map(l => (
                    <div key={l.id} className="flex justify-between gap-2 p-1 border rounded">
                      <span>{qualityLabels[l.from_status||"pending"]?.label} → <strong>{qualityLabels[l.to_status]?.label}</strong></span>
                      <span className="text-muted-foreground">{formatDateTime(l.changed_at)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQcBatch(null)}>إلغاء</Button>
            <Button onClick={saveQc}>
              {qcForm.quality_status === "failed" ? <><XCircle className="w-4 h-4 ml-1" />رفض وإلغاء</> : <><CheckCircle2 className="w-4 h-4 ml-1" />اعتماد وإغلاق</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* FAILURE DETAILS DIALOG */}
      <Dialog open={!!failureDetails} onOpenChange={(o) => !o && setFailureDetails(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-red-700 flex items-center gap-2"><AlertTriangle className="w-5 h-5" />تعذر اعتماد الدفعة {failureDetails?.batch?.batch_number}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Alert variant="destructive">
              <AlertTitle>سبب الفشل: مخزون غير كافٍ</AlertTitle>
              <AlertDescription>
                لم يتم خصم أي مواد. {failureDetails?.shortages.length} مادة بمخزون أقل من المطلوب. سُجّلت هذه المحاولة في سجل التدقيق.
              </AlertDescription>
            </Alert>
            <Table>
              <TableHeader><TableRow>
                <TableHead>كود</TableHead><TableHead>المادة</TableHead>
                <TableHead>المطلوب</TableHead><TableHead>المتاح</TableHead><TableHead>العجز</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {failureDetails?.shortages.map((s: any, i: number) => (
                  <TableRow key={i} className="bg-red-500/5">
                    <TableCell className="font-mono text-xs">{s.material_code}</TableCell>
                    <TableCell className="font-medium">{s.material_name_ar}</TableCell>
                    <TableCell>{fmt(s.required, 3)} {s.unit}</TableCell>
                    <TableCell className="text-red-600 font-bold">{fmt(s.available, 2)}</TableCell>
                    <TableCell className="text-red-600 font-bold">{fmt(s.short_by, 3)} {s.unit}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="text-xs text-muted-foreground">قم بإعادة تعبئة المواد الناقصة من تبويب «المواد الخام» أو من خلال أمر شراء، ثم أعد محاولة الاعتماد.</div>
          </div>
          <DialogFooter>
            <Button onClick={() => setFailureDetails(null)}>إغلاق</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* INVOICE DETAILS DIALOG */}
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
                      <TableCell className="font-medium">{r.material_name_ar}</TableCell>
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
