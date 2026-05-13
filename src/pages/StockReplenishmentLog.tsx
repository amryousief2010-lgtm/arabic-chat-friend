import { useEffect, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { History, RefreshCw, Search, Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import * as XLSX from "xlsx";

interface LogRow {
  id: string;
  product_name: string;
  previous_stock: number;
  quantity_added: number;
  new_stock: number;
  performed_by_name: string | null;
  notes: string | null;
  created_at: string;
}

const StockReplenishmentLog = () => {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("stock_replenishment_log")
        .select("id, product_name, previous_stock, quantity_added, new_stock, performed_by_name, notes, created_at")
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

  const filtered = rows.filter(r =>
    r.product_name.toLowerCase().includes(search.toLowerCase()) ||
    (r.performed_by_name || "").toLowerCase().includes(search.toLowerCase())
  );

  const exportExcel = () => {
    if (filtered.length === 0) { toast.error("لا توجد بيانات"); return; }
    const data = filtered.map(r => ({
      "التاريخ": new Date(r.created_at).toLocaleString("ar-EG"),
      "الصنف": r.product_name,
      "المخزون قبل": r.previous_stock,
      "الكمية المضافة": r.quantity_added,
      "المخزون بعد": r.new_stock,
      "بواسطة": r.performed_by_name || "-",
      "ملاحظات": r.notes || "",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "سجل تزويد المخزون");
    XLSX.writeFile(wb, `سجل-تزويد-المخزون-${new Date().toISOString().split("T")[0]}.xlsx`);
    toast.success("تم التصدير");
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <Header title="سجل تزويد المخزون" subtitle={`${rows.length} عملية تزويد مسجلة`} />

        <Card className="glass-card">
          <CardHeader>
            <div className="flex flex-col sm:flex-row gap-3 justify-between">
              <CardTitle className="flex items-center gap-2">
                <History className="w-5 h-5 text-primary" />
                السجل الكامل
              </CardTitle>
              <div className="flex gap-2">
                <div className="relative">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="بحث صنف أو مستخدم..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="pr-9 w-64"
                  />
                </div>
                <Button variant="outline" size="icon" onClick={load} disabled={loading}>
                  <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                </Button>
                <Button variant="outline" onClick={exportExcel} disabled={filtered.length === 0} className="gap-2">
                  <Download className="w-4 h-4" /> تصدير
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center h-32">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">لا توجد عمليات تزويد بعد</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">التاريخ</TableHead>
                      <TableHead className="text-right">الصنف</TableHead>
                      <TableHead className="text-center">قبل</TableHead>
                      <TableHead className="text-center">الكمية المضافة</TableHead>
                      <TableHead className="text-center">بعد</TableHead>
                      <TableHead className="text-right">بواسطة</TableHead>
                      <TableHead className="text-right">ملاحظات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map(r => (
                      <TableRow key={r.id}>
                        <TableCell className="text-xs">
                          {new Date(r.created_at).toLocaleString("ar-EG")}
                        </TableCell>
                        <TableCell className="font-medium">{r.product_name}</TableCell>
                        <TableCell className="text-center">{r.previous_stock}</TableCell>
                        <TableCell className="text-center font-bold text-success">+{r.quantity_added}</TableCell>
                        <TableCell className="text-center">{r.new_stock}</TableCell>
                        <TableCell>{r.performed_by_name || "-"}</TableCell>
                        <TableCell className="text-muted-foreground text-xs">{r.notes || "-"}</TableCell>
                      </TableRow>
                    ))}
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
