import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import ProductsAnalytics from "@/components/dashboard/ProductsAnalytics";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Edit, Trash2, Package, Minus, Printer, ScanLine, Upload, X, FileSpreadsheet, FileText, FileDown } from "lucide-react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { printProductLabel, printProductLabels, validateBarcode } from "@/lib/printProductLabel";
import BarcodeImportDialog from "@/components/products/BarcodeImportDialog";
import { Checkbox } from "@/components/ui/checkbox";
import { toast as sonnerToast } from "sonner";


const categories = ["لحوم طازجة", "لحوم مصنعة", "منتجات أخرى"];

interface Product {
  id: string;
  name: string;
  category: string | null;
  price: number;
  stock: number;
  unit: string;
  image_url: string | null;
  is_active: boolean;
  barcode: string | null;
}

const Products = () => {
  const { role, canManageStock } = useAuth();
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [stockAdjustment, setStockAdjustment] = useState<{ [key: string]: number }>({});
  const [importOpen, setImportOpen] = useState(false);
  const [scanMode, setScanMode] = useState(false);
  const [scanValue, setScanValue] = useState("");
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const scanInputRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const handlePrintSingle = (product: Product) => {
    const reason = validateBarcode(product.barcode);
    if (reason) {
      sonnerToast.error("لا يمكن طباعة الملصق", {
        description: reason,
        action: { label: "تعديل المنتج", onClick: () => handleOpenDialog(product) },
      });
      return;
    }
    printProductLabel({
      name: product.name,
      barcode: product.barcode!,
      unit: product.unit,
      price: canViewFinancials ? product.price : null,
    });
  };

  const handleBulkPrint = () => {
    const selected = products.filter((p) => selectedIds.has(p.id));
    const valid = selected.filter((p) => !validateBarcode(p.barcode));
    const invalid = selected.length - valid.length;
    if (!valid.length) {
      sonnerToast.error("لا يوجد منتج صالح للطباعة", {
        description: "كل المنتجات المحددة بدون باركود أو بأكواد غير صالحة.",
      });
      return;
    }
    printProductLabels(
      valid.map((p) => ({
        name: p.name,
        barcode: p.barcode!,
        unit: p.unit,
        price: canViewFinancials ? p.price : null,
      }))
    );
    sonnerToast.success(
      `تم طباعة ${valid.length} ملصق — تم تخطّي ${invalid} منتج بدون باركود صالح`
    );
  };

  const handleExportExcel = () => {
    if (!filteredProducts.length) {
      sonnerToast.error("لا توجد منتجات للتصدير");
      return;
    }
    const rows = filteredProducts.map((p, i) => ({
      "م": i + 1,
      "الباركود": p.barcode || "",
      "اسم المنتج": p.name,
      "التصنيف": p.category || "",
      "الوحدة": p.unit,
      ...(canViewFinancials ? { "السعر (ج.م)": Number(p.price) || 0 } : {}),
      "الكمية بالمخزون": Number(p.stock) || 0,
      ...(canViewFinancials ? { "إجمالي القيمة (ج.م)": (Number(p.price) || 0) * (Number(p.stock) || 0) } : {}),
      "الحالة": p.is_active ? "نشط" : "غير نشط",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = Object.keys(rows[0]).map((k) => ({
      wch: k === "اسم المنتج" ? 28 : k === "الباركود" ? 18 : 14,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "المنتجات");
    const stamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `products-${stamp}.xlsx`);
    sonnerToast.success(`تم تصدير ${rows.length} منتج`);
  };

  const handleExportCSV = () => {
    if (!filteredProducts.length) {
      sonnerToast.error("لا توجد منتجات للتصدير");
      return;
    }
    const headers = ["م", "الباركود", "اسم المنتج", "التصنيف", "الوحدة",
      ...(canViewFinancials ? ["السعر (ج.م)"] : []),
      "الكمية بالمخزون",
      ...(canViewFinancials ? ["إجمالي القيمة (ج.م)"] : []),
      "الحالة"];
    const escape = (v: any) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.join(",")];
    filteredProducts.forEach((p, i) => {
      const row = [i + 1, p.barcode || "", p.name, p.category || "", p.unit,
        ...(canViewFinancials ? [Number(p.price) || 0] : []),
        Number(p.stock) || 0,
        ...(canViewFinancials ? [(Number(p.price) || 0) * (Number(p.stock) || 0)] : []),
        p.is_active ? "نشط" : "غير نشط"];
      lines.push(row.map(escape).join(","));
    });
    const csv = "\uFEFF" + lines.join("\n"); // BOM for Excel Arabic
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `products-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    sonnerToast.success(`تم تصدير ${filteredProducts.length} منتج CSV`);
  };

  const handleExportInventoryPDF = () => {
    if (!filteredProducts.length) {
      sonnerToast.error("لا توجد منتجات للتصدير");
      return;
    }
    const issueDate = new Date().toLocaleDateString("ar-EG", { year: "numeric", month: "long", day: "numeric" });
    const issueTime = new Date().toLocaleTimeString("ar-EG");
    const totalProducts = filteredProducts.length;
    const activeProducts = filteredProducts.filter(p => p.is_active).length;
    const totalStock = filteredProducts.reduce((s, p) => s + (Number(p.stock) || 0), 0);
    const totalValue = filteredProducts.reduce((s, p) => s + ((Number(p.price) || 0) * (Number(p.stock) || 0)), 0);
    const lowStock = filteredProducts.filter(p => (Number(p.stock) || 0) < 5).length;

    const esc = (s: unknown) =>
      String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
    const rowsHtml = filteredProducts.map((p, i) => {
      const value = (Number(p.price) || 0) * (Number(p.stock) || 0);
      const stockClass = (Number(p.stock) || 0) < 5 ? 'style="color:#b91c1c;font-weight:700"' : '';
      return `<tr>
        <td>${i + 1}</td>
        <td style="font-family:monospace;font-size:10px">${esc(p.barcode || "-")}</td>
        <td style="text-align:right;font-weight:600">${esc(p.name)}</td>
        <td>${esc(p.category || "-")}</td>
        <td>${esc(p.unit)}</td>
        ${canViewFinancials ? `<td>${(Number(p.price) || 0).toFixed(2)}</td>` : ""}
        <td ${stockClass}>${Number(p.stock) || 0}</td>
        ${canViewFinancials ? `<td>${value.toFixed(2)}</td>` : ""}
        <td><span style="padding:2px 6px;border-radius:3px;font-size:10px;background:${p.is_active ? "#d1fae5" : "#fee2e2"};color:${p.is_active ? "#065f46" : "#991b1b"}">${p.is_active ? "نشط" : "غير نشط"}</span></td>
      </tr>`;
    }).join("");


    const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"/>
<title>تقرير المخزون والمنتجات</title>
<style>
  @page { size: A4; margin: 10mm; }
  body { font-family: "Segoe UI", Tahoma, Arial, sans-serif; margin: 0; padding: 12px; color: #111; }
  .header { text-align:center; border-bottom:3px double #7c3aed; padding-bottom:10px; margin-bottom:12px; }
  .header h1 { margin:0; font-size:22px; color:#7c3aed; }
  .header p { margin:3px 0; font-size:11px; color:#555; }
  .report-title { text-align:center; font-size:18px; font-weight:700; background:linear-gradient(90deg,#7c3aed,#f97316); color:white; padding:10px; border-radius:6px; margin-bottom:12px; }
  .meta { display:grid; grid-template-columns:repeat(5,1fr); gap:8px; margin-bottom:14px; }
  .meta div { border:1px solid #e5e7eb; padding:10px; border-radius:6px; background:#f9fafb; text-align:center; }
  .meta strong { color:#7c3aed; display:block; font-size:11px; margin-bottom:4px; }
  .meta span { font-size:16px; font-weight:700; }
  table { width:100%; border-collapse:collapse; font-size:11px; }
  th { background:#7c3aed; color:white; padding:6px 4px; border:1px solid #6d28d9; text-align:center; }
  td { border:1px solid #ddd; padding:5px 4px; text-align:center; }
  tbody tr:nth-child(even) { background:#faf5ff; }
  .footer { margin-top:20px; padding-top:10px; border-top:1px solid #ddd; display:flex; justify-content:space-between; font-size:10px; color:#666; }
  .toolbar { text-align:center; margin-bottom:10px; }
  .toolbar button { padding:8px 18px; background:#7c3aed; color:white; border:none; border-radius:4px; cursor:pointer; font-size:13px; }
  @media print { .toolbar { display:none; } body { padding:0; } }
</style></head>
<body>
  <div class="toolbar"><button onclick="window.print()">🖨️ طباعة / حفظ PDF</button></div>
  <div class="header">
    <h1>شركة نعام العاصمة</h1>
    <p>تقرير شامل لحالة المخزون والمنتجات</p>
  </div>
  <div class="report-title">ملخص المخزون والمنتجات</div>
  <div class="meta">
    <div><strong>إجمالي المنتجات</strong><span>${totalProducts}</span></div>
    <div><strong>المنتجات النشطة</strong><span style="color:#059669">${activeProducts}</span></div>
    <div><strong>إجمالي المخزون</strong><span>${totalStock.toFixed(1)}</span></div>
    ${canViewFinancials ? `<div><strong>إجمالي قيمة المخزون</strong><span style="color:#7c3aed">${totalValue.toLocaleString("ar-EG", { maximumFractionDigits: 0 })} ج.م</span></div>` : '<div></div>'}
    <div><strong>منتجات قاربت النفاد</strong><span style="color:#dc2626">${lowStock}</span></div>
  </div>
  <table>
    <thead><tr>
      <th>م</th><th>الباركود</th><th>اسم المنتج</th><th>التصنيف</th><th>الوحدة</th>
      ${canViewFinancials ? "<th>السعر</th>" : ""}
      <th>الكمية</th>
      ${canViewFinancials ? "<th>القيمة الإجمالية</th>" : ""}
      <th>الحالة</th>
    </tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <div class="footer">
    <span>تاريخ الإصدار: ${issueDate} - ${issueTime}</span>
    <span>شركة نعام العاصمة © ${new Date().getFullYear()}</span>
  </div>
  <script>window.addEventListener('load',()=>setTimeout(()=>window.print(),500));</script>
</body></html>`;

    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) { sonnerToast.error("افتح النوافذ المنبثقة"); return; }
    w.document.open(); w.document.write(html); w.document.close();
    sonnerToast.success("جاري إعداد تقرير PDF...");
  };





  const [formData, setFormData] = useState({
    name: "",
    category: "",
    price: "",
    stock: "",
    unit: "كيلو",
    image_url: "",
    barcode: "",
  });

  // Permission checks
  const canAddProducts = role === 'general_manager' || role === 'executive_manager' || role === 'sales_manager' || role === 'warehouse_supervisor';
  const canEditPrice = role === 'general_manager' || role === 'executive_manager' || role === 'sales_manager' || role === 'accountant' || role === 'warehouse_supervisor' || role === 'marketing_sales_manager';
  const canManageProducts = role === 'general_manager' || role === 'executive_manager' || role === 'sales_manager' || role === 'warehouse_supervisor';
  const isModerator = role === 'sales_moderator';
  const canViewFinancials = !isModerator;

  // Fetch products from Supabase
  const { data: products = [], isLoading } = useQuery({
    queryKey: ['products'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .order('name');
      if (error) throw error;
      return data as Product[];
    },
  });

  // Custom display order grouped by category (exact DB names)
  const PRODUCT_ORDER = [
    // أولاً: اللحوم
    "لحم قطع", "موزة", "استيك", "قطعية الدبوس", "رول", "فراشة", "تربيانكو", "اسكالوب", "قطع كباب",
    // ثانياً: المصنعات
    "كفتة", "برجر", "سجق", "مفروم", "برجر جبنة", "حواوشي", "شاورما", "شيش", "كفتة الرز", "طرب", "ممبار",
    // ثالثاً: القطع الجانبية
    "كبدة", "رقاب", "قلب", "قوانص", "نخاع", "دهن",
    // رابعاً: خامات التصنيع
    "فرم نعام", "شغت نعام", "طرب تصنيع",
    // خامساً: اللحوم بالعظم
    "دبوس بالعظم 6 كيلو", "فخدة  بالعظم", "نعامة صندوق بالعظم",
  ];
  const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
  const orderIndex = (name: string) => {
    const n = normalize(name);
    const idx = PRODUCT_ORDER.findIndex((p) => normalize(p) === n);
    return idx === -1 ? 999 : idx;
  };

  const q = searchQuery.trim();
  const filteredProducts = products
    .filter(
      (product) =>
        !q ||
        product.name.includes(q) ||
        (product.category && product.category.includes(q)) ||
        (product.barcode && product.barcode.includes(q.replace(/\D/g, "")))
    )
    .sort((a, b) => {
      const ai = orderIndex(a.name);
      const bi = orderIndex(b.name);
      if (ai !== bi) return ai - bi;
      return a.name.localeCompare(b.name, "ar");
    });

  useEffect(() => {
    if (scanMode) {
      const t = setTimeout(() => scanInputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [scanMode]);

  const handleScanSubmit = (raw: string) => {
    const code = raw.trim().replace(/\D/g, "");
    if (!code) return;
    const match = products.find((p) => p.barcode === code);
    if (!match) {
      toast({ title: "لم يتم العثور على المنتج", description: `الباركود: ${code}`, variant: "destructive" });
      setScanValue("");
      return;
    }
    setHighlightId(match.id);
    setSearchQuery("");
    setScanValue("");
    toast({ title: "تم تحديد المنتج", description: match.name });
    setTimeout(() => {
      rowRefs.current[match.id]?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
    setTimeout(() => setHighlightId((id) => (id === match.id ? null : id)), 4000);
    setTimeout(() => scanInputRef.current?.focus(), 100);
  };

  const handleOpenDialog = (product?: Product) => {
    if (product) {
      setEditingProduct(product);
      setFormData({
        name: product.name,
        category: product.category || "",
        price: product.price.toString(),
        stock: product.stock.toString(),
        unit: product.unit,
        image_url: product.image_url || "",
        barcode: product.barcode || "",
      });
    } else {
      setEditingProduct(null);
      setFormData({
        name: "",
        category: "",
        price: "",
        stock: "",
        unit: "كيلو",
        image_url: "",
        barcode: "",
      });
    }
    setIsDialogOpen(true);
  };

  // Create product mutation
  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const { error } = await supabase.from('products').insert({
        name: data.name,
        category: data.category || null,
        price: parseFloat(data.price),
        stock: parseInt(data.stock) || 0,
        unit: data.unit,
        image_url: data.image_url || null,
        barcode: data.barcode?.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast({ title: 'تم إضافة المنتج بنجاح' });
      setIsDialogOpen(false);
    },
    onError: () => {
      toast({ title: 'حدث خطأ', variant: 'destructive' });
    },
  });

  // Update product mutation
  const updateMutation = useMutation({
    mutationFn: async (data: { id: string; updates: Partial<Product> }) => {
      const { error } = await supabase
        .from('products')
        .update(data.updates)
        .eq('id', data.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast({ title: 'تم تحديث المنتج بنجاح' });
      setIsDialogOpen(false);
    },
    onError: () => {
      toast({ title: 'حدث خطأ', variant: 'destructive' });
    },
  });

  // Delete product mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('products').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast({ title: 'تم حذف المنتج' });
    },
  });

  // Update stock mutation
  const updateStockMutation = useMutation({
    mutationFn: async (data: { id: string; newStock: number }) => {
      const { error } = await supabase
        .from('products')
        .update({ stock: data.newStock })
        .eq('id', data.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast({ title: 'تم تحديث المخزون بنجاح' });
    },
    onError: () => {
      toast({ title: 'حدث خطأ في تحديث المخزون', variant: 'destructive' });
    },
  });

  // Update price mutation (inline edit from the table)
  const updatePriceMutation = useMutation({
    mutationFn: async (data: { id: string; newPrice: number }) => {
      const { error } = await supabase
        .from('products')
        .update({ price: data.newPrice })
        .eq('id', data.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast({ title: 'تم تحديث السعر بنجاح' });
    },
    onError: () => {
      toast({ title: 'حدث خطأ في تحديث السعر', variant: 'destructive' });
    },
  });

  const [priceAdjustment, setPriceAdjustment] = useState<Record<string, string>>({});

  const handleStockAdjust = (productId: string, currentStock: number, adjustment: number) => {
    const newStock = Math.max(0, currentStock + adjustment);
    updateStockMutation.mutate({ id: productId, newStock });
  };

  const handleSubmit = () => {
    if (!formData.name || !formData.category || !formData.price) {
      toast({
        title: "خطأ",
        description: "يرجى ملء جميع الحقول المطلوبة",
        variant: "destructive",
      });
      return;
    }

    if (editingProduct) {
      const updates: Partial<Product> = {
        name: formData.name,
        category: formData.category,
        stock: parseInt(formData.stock) || 0,
        unit: formData.unit,
        image_url: formData.image_url || null,
        barcode: formData.barcode?.trim() || null,
      };
      // Only include price if user can edit it
      if (canEditPrice) {
        updates.price = parseFloat(formData.price);
      }
      updateMutation.mutate({ id: editingProduct.id, updates });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleDelete = (id: string) => {
    deleteMutation.mutate(id);
  };

  return (
    <DashboardLayout>
      <Header title="المنتجات" subtitle="إدارة منتجات لحوم النعام" />
      
      {canViewFinancials && <ProductsAnalytics products={filteredProducts} />}

      <Card className="glass-card">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Package className="w-5 h-5 text-primary" />
            قائمة المنتجات ({filteredProducts.length})
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="بحث بالاسم أو الباركود..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-64 input-modern"
            />
            <Button
              type="button"
              variant={scanMode ? "default" : "outline"}
              onClick={() => setScanMode((v) => !v)}
              title="وضع مسح الباركود"
            >
              <ScanLine className="w-4 h-4 ml-2" />
              {scanMode ? "إيقاف المسح" : "وضع المسح"}
            </Button>
            <Button type="button" variant="outline" onClick={handleExportExcel} title="تصدير المنتجات إلى Excel" className="text-emerald-600 hover:bg-emerald-50">
              <FileSpreadsheet className="w-4 h-4 ml-2" />
              Excel
            </Button>
            <Button type="button" variant="outline" onClick={handleExportCSV} title="تصدير المنتجات إلى CSV" className="text-blue-600 hover:bg-blue-50">
              <FileDown className="w-4 h-4 ml-2" />
              CSV
            </Button>
            <Button type="button" variant="outline" onClick={handleExportInventoryPDF} title="تقرير PDF لملخص المخزون" className="text-red-600 hover:bg-red-50">
              <FileText className="w-4 h-4 ml-2" />
              تقرير PDF
            </Button>
            {canManageProducts && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setImportOpen(true)}
                title="استيراد باركودات بالجملة"
              >
                <Upload className="w-4 h-4 ml-2" />
                استيراد باركودات
              </Button>
            )}
            {selectedIds.size > 0 && (
              <>
                <Button type="button" variant="default" onClick={handleBulkPrint}>
                  <Printer className="w-4 h-4 ml-2" />
                  طباعة {selectedIds.size} ملصق
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
                  إلغاء التحديد
                </Button>
              </>
            )}
            {canAddProducts && (
              <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogTrigger asChild>
                  <Button
                    className="btn-primary"
                    onClick={() => handleOpenDialog()}
                  >
                    <Plus className="w-4 h-4 ml-2" />
                    إضافة منتج
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>
                      {editingProduct ? "تعديل المنتج" : "إضافة منتج جديد"}
                    </DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label>اسم المنتج *</Label>
                      <Input
                        value={formData.name}
                        onChange={(e) =>
                          setFormData({ ...formData, name: e.target.value })
                        }
                        placeholder="أدخل اسم المنتج"
                        className="input-modern"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>التصنيف *</Label>
                      <Select
                        value={formData.category}
                        onValueChange={(value) =>
                          setFormData({ ...formData, category: value })
                        }
                      >
                        <SelectTrigger className="input-modern">
                          <SelectValue placeholder="اختر التصنيف" />
                        </SelectTrigger>
                        <SelectContent>
                          {categories.map((cat) => (
                            <SelectItem key={cat} value={cat}>
                              {cat}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>السعر (ج.م) *</Label>
                        <Input
                          type="number"
                          value={formData.price}
                          onChange={(e) =>
                            setFormData({ ...formData, price: e.target.value })
                          }
                          placeholder="0"
                          className="input-modern"
                          disabled={editingProduct !== null && !canEditPrice}
                        />
                        {editingProduct && !canEditPrice && (
                          <p className="text-xs text-muted-foreground">
                            تعديل السعر متاح للمديرين والمحاسب فقط
                          </p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label>المخزون</Label>
                        <Input
                          type="number"
                          value={formData.stock}
                          onChange={(e) =>
                            setFormData({ ...formData, stock: e.target.value })
                          }
                          placeholder="0"
                          className="input-modern"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>الوحدة</Label>
                      <Select
                        value={formData.unit}
                        onValueChange={(value) =>
                          setFormData({ ...formData, unit: value })
                        }
                      >
                        <SelectTrigger className="input-modern">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="كيلو">كيلو</SelectItem>
                          <SelectItem value="عبوة">عبوة</SelectItem>
                          <SelectItem value="قطعة">قطعة</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>رابط الصورة</Label>
                      <Input
                        value={formData.image_url}
                        onChange={(e) =>
                          setFormData({ ...formData, image_url: e.target.value })
                        }
                        placeholder="https://..."
                        className="input-modern"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>الباركود الرسمي (GS1)</Label>
                      <Input
                        value={formData.barcode}
                        onChange={(e) =>
                          setFormData({ ...formData, barcode: e.target.value })
                        }
                        placeholder="6224003208XXX"
                        className="input-modern font-mono ltr"
                        dir="ltr"
                        inputMode="numeric"
                      />
                      <p className="text-xs text-muted-foreground">
                        الكود المعتمد المطبوع على استيكر المنتج
                      </p>
                    </div>
                    <Button onClick={handleSubmit} className="w-full btn-primary">
                      {editingProduct ? "حفظ التعديلات" : "إضافة المنتج"}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {scanMode && (
            <div className="mb-4 p-3 rounded-lg border-2 border-primary/40 bg-primary/5">
              <div className="flex items-center gap-2 mb-2">
                <ScanLine className="w-4 h-4 text-primary" />
                <span className="text-sm font-semibold">وضع مسح الباركود مفعّل</span>
                <span className="text-xs text-muted-foreground mr-auto">امسح الكود أو اكتبه واضغط Enter</span>
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setScanMode(false)}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
              <Input
                ref={scanInputRef}
                value={scanValue}
                onChange={(e) => setScanValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleScanSubmit(scanValue);
                  }
                }}
                placeholder="امسح الباركود هنا..."
                className="font-mono text-lg"
                dir="ltr"
                autoFocus
                inputMode="numeric"
              />
            </div>
          )}
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">جاري التحميل...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={
                        filteredProducts.length > 0 &&
                        filteredProducts.every((p) => selectedIds.has(p.id))
                      }
                      onCheckedChange={(v) => {
                        if (v) setSelectedIds(new Set(filteredProducts.map((p) => p.id)));
                        else setSelectedIds(new Set());
                      }}
                      aria-label="تحديد الكل"
                    />
                  </TableHead>
                  <TableHead className="text-right">المنتج</TableHead>
                  <TableHead className="text-right">الباركود</TableHead>
                  <TableHead className="text-right">التصنيف</TableHead>
                  {canViewFinancials && <TableHead className="text-right">السعر</TableHead>}
                  <TableHead className="text-right">المخزون</TableHead>
                  <TableHead className="text-right">الحالة</TableHead>
                  <TableHead className="text-right">الإجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProducts.map((product) => (
                  <TableRow
                    key={product.id}
                    ref={(el) => (rowRefs.current[product.id] = el)}
                    className={`table-row-hover transition-colors ${
                      highlightId === product.id ? "bg-primary/15 ring-2 ring-primary" : ""
                    } ${selectedIds.has(product.id) ? "bg-primary/5" : ""}`}
                  >
                    <TableCell>
                      <Checkbox
                        checked={selectedIds.has(product.id)}
                        onCheckedChange={() => toggleSelect(product.id)}
                        aria-label={`تحديد ${product.name}`}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        {product.image_url && (
                          <img
                            src={product.image_url}
                            alt={product.name}
                            className="w-12 h-12 rounded-lg object-cover"
                          />
                        )}
                        <span className="font-medium">{product.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {product.barcode ? (
                        <span className="font-mono text-xs" dir="ltr">{product.barcode}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{product.category}</Badge>
                    </TableCell>
                    {canViewFinancials && (
                      <TableCell className="font-semibold">
                        <div className="flex items-center gap-2">
                          <span>{product.price} ج.م / {product.unit}</span>
                          {canEditPrice && (
                            <Popover>
                              <PopoverTrigger asChild>
                                <Button variant="outline" size="sm" className="h-7 px-2">
                                  تعديل
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-64" align="start">
                                <div className="space-y-3">
                                  <div className="text-sm font-medium">تعديل سعر {product.name}</div>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    placeholder="السعر الجديد"
                                    value={priceAdjustment[product.id] ?? String(product.price)}
                                    onChange={(e) => setPriceAdjustment({
                                      ...priceAdjustment,
                                      [product.id]: e.target.value,
                                    })}
                                  />
                                  <Button
                                    size="sm"
                                    className="w-full"
                                    onClick={() => {
                                      const v = parseFloat(priceAdjustment[product.id] ?? String(product.price));
                                      if (isNaN(v) || v < 0) {
                                        toast({ title: 'سعر غير صالح', variant: 'destructive' });
                                        return;
                                      }
                                      updatePriceMutation.mutate({ id: product.id, newPrice: v });
                                    }}
                                  >
                                    حفظ السعر
                                  </Button>
                                  <div className="text-xs text-muted-foreground">
                                    السعر الحالي: {product.price} ج.م
                                  </div>
                                </div>
                              </PopoverContent>
                            </Popover>
                          )}
                        </div>
                      </TableCell>
                    )}
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{product.stock} {product.unit}</span>
                        {canManageStock && (
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button variant="outline" size="sm" className="h-7 px-2">
                                تعديل
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-64" align="start">
                              <div className="space-y-3">
                                <div className="text-sm font-medium">تعديل كمية {product.name}</div>
                                <div className="flex items-center gap-2">
                                  <Input
                                    type="number"
                                    placeholder="الكمية"
                                    value={stockAdjustment[product.id] || ''}
                                    onChange={(e) => setStockAdjustment({ 
                                      ...stockAdjustment, 
                                      [product.id]: parseInt(e.target.value) || 0 
                                    })}
                                    className="flex-1"
                                  />
                                </div>
                                <div className="flex gap-2">
                                  <Button
                                    size="sm"
                                    className="flex-1 bg-success hover:bg-success/90"
                                    onClick={() => {
                                      handleStockAdjust(product.id, product.stock, stockAdjustment[product.id] || 0);
                                      setStockAdjustment({ ...stockAdjustment, [product.id]: 0 });
                                    }}
                                  >
                                    <Plus className="w-3 h-3 ml-1" />
                                    إضافة
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="destructive"
                                    className="flex-1"
                                    onClick={() => {
                                      handleStockAdjust(product.id, product.stock, -(stockAdjustment[product.id] || 0));
                                      setStockAdjustment({ ...stockAdjustment, [product.id]: 0 });
                                    }}
                                  >
                                    <Minus className="w-3 h-3 ml-1" />
                                    خصم
                                  </Button>
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  الرصيد الحالي: {product.stock} {product.unit}
                                </div>
                              </div>
                            </PopoverContent>
                          </Popover>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={
                          product.stock < 25
                            ? "bg-destructive text-destructive-foreground"
                            : product.stock < 35
                            ? "bg-warning text-warning-foreground"
                            : "bg-success text-success-foreground"
                        }
                      >
                        {product.stock < 25
                          ? "منخفض جداً"
                          : product.stock < 35
                          ? "منخفض"
                          : "متوفر"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          title="طباعة ملصق المنتج"
                          onClick={() => handlePrintSingle(product)}
                          className={!product.barcode ? "text-muted-foreground" : ""}
                        >
                          <Printer className="w-4 h-4" />
                        </Button>
                        {canManageProducts && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleOpenDialog(product)}
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive hover:text-destructive"
                              onClick={() => handleDelete(product.id)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <BarcodeImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        products={products as any}
        onDone={() => queryClient.invalidateQueries({ queryKey: ["products"] })}
      />
    </DashboardLayout>
  );
};

export default Products;
