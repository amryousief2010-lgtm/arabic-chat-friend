import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { History, RefreshCw, Search, FileDown, FileText, Plus, Check, ChevronsUpDown, Package } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { cn } from "@/lib/utils";

interface LogRow {
  id: string;
  product_name: string;
  previous_stock: number;
  quantity_added: number;
  new_stock: number;
  unit_price: number | null;
  supplier_reference: string | null;
  performed_by_name: string | null;
  notes: string | null;
  half_kg_bags: number | null;
  kg_bags: number | null;
  created_at: string;
}

interface Product {
  id: string;
  name: string;
  unit: string;
  stock: number;
  category: string | null;
}

const isKgUnit = (u: string) =>
  /^(كجم|كيلو|كيلوجرام|كيلوغرام|كغم|كغ|kg|kgs|kilogram|kilogramme|kilo)$/i.test((u || "").trim());

const StockReplenishmentLog = () => {
  const { canManageStock, profile } = useAuth();
  const [rows, setRows] = useState<LogRow[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");

  // Add dialog state
  const [open, setOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [halfKgBags, setHalfKgBags] = useState<string>("0");
  const [kgBags, setKgBags] = useState<string>("0");
  const [genericQty, setGenericQty] = useState<string>("");
  const [unitPrice, setUnitPrice] = useState<string>("");
  const [supplierRef, setSupplierRef] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [logRes, prodRes] = await Promise.all([
        (supabase as any)
          .from("stock_replenishment_log")
          .select("id, product_name, previous_stock, quantity_added, new_stock, unit_price, supplier_reference, performed_by_name, notes, half_kg_bags, kg_bags, created_at")
          .order("created_at", { ascending: false })
          .limit(1000),
        supabase
          .from("products")
          .select("id, name, unit, stock, category")
          .eq("is_active", true)
          .order("name"),
      ]);
      if (logRes.error) throw logRes.error;
      if (prodRes.error) throw prodRes.error;
      setRows((logRes.data || []) as LogRow[]);
      setProducts((prodRes.data || []) as Product[]);
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || "تعذر تحميل البيانات");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const productsByCategory = useMemo(() => {
    const groups: Record<string, Product[]> = {};
    products.forEach(p => {
      const k = p.category || "بدون تصنيف";
      (groups[k] ||= []).push(p);
    });
    return groups;
  }, [products]);

  const filtered = useMemo(() => {
    return rows.filter(r => {
      const matchSearch = r.product_name.toLowerCase().includes(search.toLowerCase()) ||
        (r.performed_by_name || "").toLowerCase().includes(search.toLowerCase()) ||
        (r.supplier_reference || "").toLowerCase().includes(search.toLowerCase());
      if (!matchSearch) return false;
      const d = r.created_at.split("T")[0];
      if (fromDate && d < fromDate) return false;
      if (toDate && d > toDate) return false;
      return true;
    });
  }, [rows, search, fromDate, toDate]);

  const totals = useMemo(() => ({
    count: filtered.length,
    qty: filtered.reduce((s, r) => s + Number(r.quantity_added || 0), 0),
    cost: filtered.reduce((s, r) => s + Number(r.quantity_added || 0) * Number(r.unit_price || 0), 0),
  }), [filtered]);

  const isKg = selectedProduct ? isKgUnit(selectedProduct.unit) : false;
  const totalBags = isKg
    ? (Number(halfKgBags || 0) + Number(kgBags || 0))
    : Number(genericQty || 0);
  const totalKgEquivalent = isKg
    ? Number(halfKgBags || 0) * 0.5 + Number(kgBags || 0) * 1
    : 0;

  const resetForm = () => {
    setSelectedProduct(null);
    setHalfKgBags("0"); setKgBags("0"); setGenericQty("");
    setUnitPrice(""); setSupplierRef(""); setNotes("");
  };

  const submit = async () => {
    if (!selectedProduct) { toast.error("اختر الصنف"); return; }
    if (totalBags <= 0) { toast.error("أدخل الكمية"); return; }
    setSubmitting(true);
    try {
      const newStock = selectedProduct.stock + totalBags;
      const { error: upErr } = await supabase
        .from("products")
        .update({ stock: newStock })
        .eq("id", selectedProduct.id);
      if (upErr) throw upErr;

      let breakdown = "";
      if (isKg) {
        const parts: string[] = [];
        if (Number(halfKgBags) > 0) parts.push(`${halfKgBags} كيس نصف كيلو`);
        if (Number(kgBags) > 0) parts.push(`${kgBags} كيس كيلو`);
        breakdown = parts.join(" + ") + ` (≈ ${totalKgEquivalent} كجم)`;
      }
      const finalNotes = [breakdown, notes].filter(Boolean).join(" | ");

      const { error: logErr } = await (supabase as any).from("stock_replenishment_log").insert({
        product_id: selectedProduct.id,
        product_name: selectedProduct.name,
        previous_stock: selectedProduct.stock,
        quantity_added: totalBags,
        new_stock: newStock,
        unit_price: Number(unitPrice || 0),
        supplier_reference: supplierRef || null,
        performed_by: profile?.id ?? null,
        performed_by_name: profile?.full_name ?? null,
        notes: finalNotes || null,
      });
      if (logErr) throw logErr;

      toast.success(`تم تزويد ${selectedProduct.name} بـ ${totalBags} كيس`);
      setOpen(false);
      resetForm();
      await load();
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || "فشل تسجيل التزويد");
    } finally {
      setSubmitting(false);
    }
  };

  const exportCsv = () => {
    if (filtered.length === 0) { toast.error("لا توجد بيانات"); return; }
    const header = ["التاريخ","الصنف","قبل","الكمية المضافة","بعد","سعر الوحدة","الإجمالي","مرجع التوريد","بواسطة","ملاحظات"];
    const lines = [header.join(",")];
    filtered.forEach(r => {
      const cost = Number(r.quantity_added || 0) * Number(r.unit_price || 0);
      lines.push([
        new Date(r.created_at).toLocaleString("ar-EG"),
        `"${r.product_name}"`,
        r.previous_stock, r.quantity_added, r.new_stock,
        r.unit_price ?? 0, cost,
        `"${r.supplier_reference || ""}"`,
        `"${r.performed_by_name || ""}"`,
        `"${(r.notes || "").replace(/"/g,'""')}"`,
      ].join(","));
    });
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `سجل-تزويد-المخزون-${new Date().toISOString().split("T")[0]}.csv`;
    a.click(); URL.revokeObjectURL(url);
    toast.success("تم تصدير CSV");
  };

  const exportPdf = () => {
    if (filtered.length === 0) { toast.error("لا توجد بيانات"); return; }
    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(14);
    const range = (fromDate || toDate) ? ` (${fromDate || "..."} → ${toDate || "..."})` : "";
    doc.text(`Stock Replenishment Log${range}`, 14, 14);
    autoTable(doc, {
      startY: 20,
      head: [["Date","Product","Before","Added","After","Unit Price","Total","Supplier Ref","By","Notes"]],
      body: filtered.map(r => [
        new Date(r.created_at).toLocaleDateString("en-GB"),
        r.product_name, r.previous_stock, r.quantity_added, r.new_stock,
        r.unit_price ?? 0,
        (Number(r.quantity_added || 0) * Number(r.unit_price || 0)).toFixed(2),
        r.supplier_reference || "-",
        r.performed_by_name || "-",
        r.notes || "-",
      ]),
      styles: { fontSize: 7 },
    });
    doc.save(`stock-replenishment-${new Date().toISOString().split("T")[0]}.pdf`);
    toast.success("تم تصدير PDF");
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <Header title="سجل تزويد المخزون" subtitle={`${rows.length} عملية تزويد مسجلة`} />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="glass-card"><CardContent className="p-4">
            <p className="text-sm text-muted-foreground">عدد العمليات</p>
            <p className="text-2xl font-bold">{totals.count}</p>
          </CardContent></Card>
          <Card className="glass-card"><CardContent className="p-4">
            <p className="text-sm text-muted-foreground">إجمالي الكمية</p>
            <p className="text-2xl font-bold text-primary">{totals.qty}</p>
          </CardContent></Card>
          <Card className="glass-card"><CardContent className="p-4">
            <p className="text-sm text-muted-foreground">إجمالي التكلفة</p>
            <p className="text-2xl font-bold text-success">{totals.cost.toFixed(2)}</p>
          </CardContent></Card>
        </div>

        <Card className="glass-card">
          <CardHeader>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col sm:flex-row gap-3 justify-between">
                <CardTitle className="flex items-center gap-2">
                  <History className="w-5 h-5 text-primary" />
                  السجل الكامل
                </CardTitle>
                <div className="flex gap-2 flex-wrap">
                  {canManageStock && (
                    <Button onClick={() => setOpen(true)} className="gap-2">
                      <Plus className="w-4 h-4" /> تسجيل تزويد جديد
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={exportCsv} className="gap-2">
                    <FileDown className="w-4 h-4" /> CSV
                  </Button>
                  <Button variant="outline" size="sm" onClick={exportPdf} className="gap-2">
                    <FileText className="w-4 h-4" /> PDF
                  </Button>
                  <Button variant="outline" size="icon" onClick={load} disabled={loading}>
                    <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 items-end">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input placeholder="بحث صنف / مستخدم / مرجع..." value={search} onChange={e => setSearch(e.target.value)} className="pr-9" />
                </div>
                <div>
                  <Label className="text-xs">من</Label>
                  <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="w-40" />
                </div>
                <div>
                  <Label className="text-xs">إلى</Label>
                  <Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="w-40" />
                </div>
                {(fromDate || toDate) && (
                  <Button variant="ghost" size="sm" onClick={() => { setFromDate(""); setToDate(""); }}>
                    مسح التاريخ
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center h-32">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">لا توجد عمليات مطابقة</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">التاريخ</TableHead>
                      <TableHead className="text-right">الصنف</TableHead>
                      <TableHead className="text-center">قبل</TableHead>
                      <TableHead className="text-center">المضاف</TableHead>
                      <TableHead className="text-center">بعد</TableHead>
                      <TableHead className="text-center">سعر الوحدة</TableHead>
                      <TableHead className="text-center">الإجمالي</TableHead>
                      <TableHead className="text-right">مرجع التوريد</TableHead>
                      <TableHead className="text-right">بواسطة</TableHead>
                      <TableHead className="text-right">ملاحظات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map(r => {
                      const cost = Number(r.quantity_added || 0) * Number(r.unit_price || 0);
                      return (
                        <TableRow key={r.id}>
                          <TableCell className="text-xs">{new Date(r.created_at).toLocaleString("ar-EG")}</TableCell>
                          <TableCell className="font-medium">{r.product_name}</TableCell>
                          <TableCell className="text-center">{r.previous_stock}</TableCell>
                          <TableCell className="text-center font-bold text-success">+{r.quantity_added}</TableCell>
                          <TableCell className="text-center">{r.new_stock}</TableCell>
                          <TableCell className="text-center">{r.unit_price ? Number(r.unit_price).toFixed(2) : "—"}</TableCell>
                          <TableCell className="text-center">{cost > 0 ? cost.toFixed(2) : "—"}</TableCell>
                          <TableCell className="text-xs">{r.supplier_reference || "—"}</TableCell>
                          <TableCell>{r.performed_by_name || "—"}</TableCell>
                          <TableCell className="text-muted-foreground text-xs">{r.notes || "—"}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) resetForm(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="w-5 h-5 text-primary" /> تسجيل تزويد جديد
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Product picker */}
            <div>
              <Label>الصنف *</Label>
              <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" className="w-full justify-between">
                    {selectedProduct ? (
                      <span className="flex items-center gap-2">
                        <span>{selectedProduct.name}</span>
                        <Badge variant="secondary" className="text-xs">{selectedProduct.unit}</Badge>
                        <span className="text-xs text-muted-foreground">المخزون: {selectedProduct.stock}</span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">اختر الصنف من قاعدة المنتجات...</span>
                    )}
                    <ChevronsUpDown className="w-4 h-4 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[480px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="ابحث بالاسم أو التصنيف..." />
                    <CommandList>
                      <CommandEmpty>لا توجد منتجات</CommandEmpty>
                      {Object.entries(productsByCategory).map(([cat, list]) => (
                        <CommandGroup key={cat} heading={cat}>
                          {list.map(p => (
                            <CommandItem
                              key={p.id}
                              value={`${p.name} ${p.category || ""} ${p.unit}`}
                              onSelect={() => {
                                setSelectedProduct(p);
                                setPickerOpen(false);
                                setHalfKgBags("0"); setKgBags("0"); setGenericQty("");
                              }}
                            >
                              <Check className={cn("w-4 h-4 ml-2", selectedProduct?.id === p.id ? "opacity-100" : "opacity-0")} />
                              <div className="flex-1 flex items-center justify-between gap-2">
                                <span>{p.name}</span>
                                <div className="flex items-center gap-2">
                                  <Badge variant="outline" className="text-xs">{p.unit}</Badge>
                                  <span className="text-xs text-muted-foreground">المخزون: {p.stock}</span>
                                </div>
                              </div>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      ))}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {/* Quantity inputs */}
            {selectedProduct && (
              <>
                {isKg ? (
                  <div className="space-y-3 rounded-lg border p-3 bg-muted/30">
                    <div className="text-sm font-medium">الكميات حسب نوع الكيس</div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">عدد أكياس نصف كيلو</Label>
                        <Input type="number" min={0} value={halfKgBags} onChange={e => setHalfKgBags(e.target.value)} />
                      </div>
                      <div>
                        <Label className="text-xs">عدد أكياس كيلو</Label>
                        <Input type="number" min={0} value={kgBags} onChange={e => setKgBags(e.target.value)} />
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-3 text-xs pt-1 border-t">
                      <span>إجمالي الأكياس: <strong className="text-primary">{totalBags}</strong></span>
                      <span>إجمالي الوزن: <strong className="text-success">{totalKgEquivalent} كجم</strong></span>
                    </div>
                  </div>
                ) : (
                  <div>
                    <Label>الكمية المضافة ({selectedProduct.unit}) *</Label>
                    <Input type="number" min={1} value={genericQty} onChange={e => setGenericQty(e.target.value)} />
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>سعر الوحدة (اختياري)</Label>
                    <Input type="number" min={0} step="0.01" value={unitPrice} onChange={e => setUnitPrice(e.target.value)} placeholder="0.00" />
                  </div>
                  <div>
                    <Label>مرجع التوريد</Label>
                    <Input value={supplierRef} onChange={e => setSupplierRef(e.target.value)} placeholder="رقم الفاتورة / المورد" />
                  </div>
                </div>
                <div>
                  <Label>ملاحظات</Label>
                  <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="ملاحظات إضافية..." />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button onClick={submit} disabled={submitting || !selectedProduct || totalBags <= 0}>
              {submitting ? "جاري التسجيل..." : "تأكيد التزويد"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default StockReplenishmentLog;
