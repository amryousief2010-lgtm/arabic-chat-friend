import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import * as XLSX from "xlsx";
import {
  cairoMonthStartUTC,
  currentCairoYearMonth,
} from "@/lib/cairoDate";
import { toast } from "sonner";

interface Row {
  id: string;
  order_number: string;
  total: number;
  status: string;
  payment_method: string;
  payment_status: string;
  moderator: string | null;
  created_at: string;
  customers: { name: string | null } | null;
}

const MONTH_AR = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];
const statusAR: Record<string, string> = {
  pending: "قيد الانتظار", processing: "جاري التجهيز", shipped: "تم الشحن",
  delivered: "تم التوصيل", cancelled: "ملغي",
};

export default function MonthOrdersDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  const { year, monthIndex0 } = currentCairoYearMonth();
  const monthLabel = `${MONTH_AR[monthIndex0]} ${year}`;

  useEffect(() => {
    if (!open) return;
    (async () => {
      setLoading(true);
      const start = cairoMonthStartUTC(year, monthIndex0).toISOString();
      const end = cairoMonthStartUTC(year, monthIndex0 + 1).toISOString();
      let all: Row[] = [];
      let page = 0;
      const size = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("orders")
          .select("id, order_number, total, status, payment_method, payment_status, moderator, created_at, customers(name)")
          .gte("created_at", start)
          .lt("created_at", end)
          .order("created_at", { ascending: false })
          .range(page * size, (page + 1) * size - 1);
        if (error) { toast.error(error.message); break; }
        all = all.concat((data || []) as any);
        if (!data || data.length < size) break;
        page++;
      }
      setRows(all);
      setLoading(false);
    })();
  }, [open, year, monthIndex0]);

  const totalSum = rows.reduce((s, r) => s + Number(r.total || 0), 0);

  const exportExcel = () => {
    const data = rows.map((r) => ({
      "رقم الطلب": r.order_number,
      "العميل": r.customers?.name || "-",
      "الموديريتور": r.moderator || "-",
      "الإجمالي": Number(r.total),
      "طريقة الدفع": r.payment_method === "cash" ? "نقدي" : "إلكتروني",
      "حالة الدفع": r.payment_status,
      "الحالة": statusAR[r.status] || r.status,
      "تاريخ الإنشاء": new Date(r.created_at).toLocaleString("ar-EG"),
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "طلبات الشهر");
    XLSX.writeFile(wb, `طلبات-${monthLabel}.xlsx`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-4">
            <span>طلبات {monthLabel} — {rows.length} طلب</span>
            <Button size="sm" onClick={exportExcel} disabled={loading || rows.length === 0} className="gap-2">
              <FileSpreadsheet className="w-4 h-4" /> تصدير Excel
            </Button>
          </DialogTitle>
        </DialogHeader>

        <div className="text-sm text-muted-foreground">
          إجمالي المبيعات: <span className="font-bold text-primary">{totalSum.toLocaleString()} ج.م</span>
        </div>

        <div className="flex-1 overflow-auto border rounded-lg">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> جارٍ التحميل...
            </div>
          ) : (
            <Table>
              <TableHeader className="sticky top-0 bg-background z-10">
                <TableRow>
                  <TableHead>رقم الطلب</TableHead>
                  <TableHead>العميل</TableHead>
                  <TableHead>الموديريتور</TableHead>
                  <TableHead>الإجمالي</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>التاريخ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground">لا توجد طلبات</TableCell></TableRow>
                ) : rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.order_number}</TableCell>
                    <TableCell>{r.customers?.name || "-"}</TableCell>
                    <TableCell>{r.moderator || "-"}</TableCell>
                    <TableCell className="font-semibold text-primary">{Number(r.total).toLocaleString()} ج.م</TableCell>
                    <TableCell>{statusAR[r.status] || r.status}</TableCell>
                    <TableCell className="text-xs">{new Date(r.created_at).toLocaleString("ar-EG")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
