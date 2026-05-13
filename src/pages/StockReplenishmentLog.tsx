import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { History, RefreshCw, Search, FileDown, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

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
  created_at: string;
}

const StockReplenishmentLog = () => {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from("stock_replenishment_log")
        .select("id, product_name, previous_stock, quantity_added, new_stock, unit_price, supplier_reference, performed_by_name, notes, created_at")
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      setRows((data || []) as LogRow[]);
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || "تعذر تحميل السجل");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

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
    </DashboardLayout>
  );
};

export default StockReplenishmentLog;
