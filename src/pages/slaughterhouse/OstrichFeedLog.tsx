import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Printer, RefreshCw, Wheat } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { openPrintWindow } from "@/lib/printPdf";

const fmt = (n: number) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });

export default function OstrichFeedLog() {
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["sl_ostrich_feed_log"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("slaughter_ostrich_feed_consumption" as any)
        .select("*, live:slaughter_live_receipts!live_batch_id(receipt_number)")
        .order("consumption_date", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data as any[]) || [];
    },
  });

  const rows = q.data || [];
  const totalKg = rows.reduce((s, r) => s + Number(r.quantity_kg || 0), 0);
  const totalCost = rows.reduce((s, r) => s + Number(r.total_cost || 0), 0);

  const print = () => {
    const html = rows.map((r) => `
      <tr>
        <td>${r.consumption_date}</td>
        <td>${r.live?.receipt_number || "—"}</td>
        <td>${r.feed_name}</td>
        <td>${fmt(r.quantity_kg)}</td>
        <td>${fmt(r.unit_cost)}</td>
        <td>${fmt(r.total_cost)}</td>
        <td>${fmt(r.stock_before)}</td>
        <td>${fmt(r.stock_after)}</td>
      </tr>`).join("");
    openPrintWindow("سجل صرف علف نعام المجزر",
      `<h2>سجل صرف علف نعام المجزر</h2>
       <table border="1" cellspacing="0" cellpadding="6" style="width:100%;border-collapse:collapse">
         <thead><tr><th>التاريخ</th><th>الدفعة</th><th>العلف</th><th>الكمية (كجم)</th><th>سعر/كجم</th><th>الإجمالي</th><th>الرصيد قبل</th><th>الرصيد بعد</th></tr></thead>
         <tbody>${html || `<tr><td colspan="8" style="text-align:center">لا توجد حركات</td></tr>`}</tbody>
       </table>`);
  };

  return (
    <DashboardLayout>
      <div dir="rtl" className="p-4 md:p-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <Wheat className="h-7 w-7 text-orange-600" />
            <div>
              <h1 className="text-2xl font-bold">سجل صرف علف نعام المجزر</h1>
              <p className="text-sm text-muted-foreground">كل حركة صرف علف للنعام محمّلة على دفعتها</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => qc.invalidateQueries({ queryKey: ["sl_ostrich_feed_log"] })}>
              <RefreshCw className="h-4 w-4 ml-1" />تحديث
            </Button>
            <Button size="sm" variant="outline" onClick={print}><Printer className="h-4 w-4 ml-1" />طباعة</Button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardHeader className="pb-2"><CardTitle className="text-xs">عدد الحركات</CardTitle></CardHeader>
            <CardContent><div className="text-xl font-bold">{rows.length}</div></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-xs">إجمالي الكمية</CardTitle></CardHeader>
            <CardContent><div className="text-xl font-bold text-orange-700">{fmt(totalKg)} كجم</div></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-xs">إجمالي التكلفة</CardTitle></CardHeader>
            <CardContent><div className="text-xl font-bold text-primary">{fmt(totalCost)} ج.م</div></CardContent></Card>
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>الدفعة</TableHead>
                  <TableHead>نوع العلف</TableHead>
                  <TableHead>الكمية (كجم)</TableHead>
                  <TableHead>سعر/كجم</TableHead>
                  <TableHead>إجمالي التكلفة</TableHead>
                  <TableHead>الرصيد قبل</TableHead>
                  <TableHead>الرصيد بعد</TableHead>
                  <TableHead>الحالة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} className={r.reversed_at ? "opacity-60" : ""}>
                    <TableCell className="text-xs">{r.consumption_date}</TableCell>
                    <TableCell className="text-xs font-medium">{r.live?.receipt_number || "—"}</TableCell>
                    <TableCell>{r.feed_name}</TableCell>
                    <TableCell className="font-bold">{fmt(r.quantity_kg)}</TableCell>
                    <TableCell>{fmt(r.unit_cost)}</TableCell>
                    <TableCell className="font-bold text-orange-700">{fmt(r.total_cost)}</TableCell>
                    <TableCell>{fmt(r.stock_before)}</TableCell>
                    <TableCell className="font-medium">{fmt(r.stock_after)}</TableCell>
                    <TableCell>
                      {r.reversed_at
                        ? <Badge variant="destructive">عكس: {r.reversal_reason}</Badge>
                        : <Badge variant="default">نشطة</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
                {!rows.length && (
                  <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground">لا توجد حركات</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
