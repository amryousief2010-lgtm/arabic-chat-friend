import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

const ISSUE_LABEL: Record<string, string> = {
  no_items: "بدون خامات",
  zero_total_cost: "إجمالي التكلفة = 0",
  zero_unit_cost: "تكلفة الوحدة = 0",
  missing_labor_txn: "بدون حركة خزنة لأجرة التصنيع",
  ok: "سليمة",
};

export default function ProductionOrphanChecker() {
  const q = useQuery({
    queryKey: ["feed_production_orphans"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("v_feed_production_orphan_invoices")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 60_000,
  });

  const rows = q.data || [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-orange-600" />
            تقرير رقابي: فواتير التصنيع الناقصة / اليتيمة
          </CardTitle>
          <CardDescription>
            يعرض أي فاتورة تصنيع بدون خامات، أو تكلفة صفر، أو أجرة بدون حركة خزنة.
          </CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={() => q.refetch()}>
          <RefreshCw className="h-4 w-4 ml-1" /> تحديث
        </Button>
      </CardHeader>
      <CardContent>
        {q.isLoading ? (
          <div className="text-sm text-muted-foreground">جارٍ التحميل...</div>
        ) : rows.length === 0 ? (
          <div className="flex items-center gap-2 text-green-700 bg-green-50 p-3 rounded-md border border-green-200">
            <CheckCircle2 className="h-5 w-5" />
            <span className="text-sm font-medium">لا توجد فواتير تصنيع ناقصة — كل الفواتير سليمة.</span>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>رقم الفاتورة</TableHead>
                <TableHead>التاريخ</TableHead>
                <TableHead>الكمية</TableHead>
                <TableHead>إجمالي التكلفة</TableHead>
                <TableHead>أجرة التصنيع</TableHead>
                <TableHead>عدد الخامات</TableHead>
                <TableHead>حركة خزنة</TableHead>
                <TableHead>المشكلة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.prod_no}</TableCell>
                  <TableCell>{r.prod_date}</TableCell>
                  <TableCell>{r.qty_produced}</TableCell>
                  <TableCell>{Number(r.total_cost).toFixed(2)}</TableCell>
                  <TableCell>{Number(r.labor_cost).toFixed(2)}</TableCell>
                  <TableCell>
                    <Badge variant={r.items_count === 0 ? "destructive" : "secondary"}>
                      {r.items_count}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {r.has_labor_txn ? (
                      <Badge variant="secondary">موجودة</Badge>
                    ) : (
                      <Badge variant="outline">—</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="destructive">{ISSUE_LABEL[r.issue] || r.issue}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
