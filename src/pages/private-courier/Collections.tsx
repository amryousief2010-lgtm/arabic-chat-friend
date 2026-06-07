import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Coins } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { COLLECTION_STATUS_LABEL, type CollectionStatus } from "@/lib/privateCourier/constants";

interface CollectionRow {
  id: string;
  order_id: string;
  amount_due: number;
  amount_collected: number;
  difference: number;
  status: CollectionStatus;
  notes: string | null;
  collected_at: string | null;
  collected_by: string | null;
}

export default function PCCollections() {
  const [rows, setRows] = useState<CollectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [orderNumbers, setOrderNumbers] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await (supabase as any).from("pc_collections").select("*").order("created_at", { ascending: false }).limit(1000);
      setRows((data as any) || []);
      const ids = (data || []).map((r: any) => r.order_id);
      if (ids.length) {
        const { data: o } = await (supabase as any).from("orders").select("id, order_number").in("id", ids);
        const map: Record<string, string> = {};
        (o || []).forEach((x: any) => { map[x.id] = x.order_number; });
        setOrderNumbers(map);
      }
      setLoading(false);
    })();
  }, []);

  const k = useMemo(() => {
    const due = rows.reduce((s, r) => s + Number(r.amount_due || 0), 0);
    const got = rows.reduce((s, r) => s + Number(r.amount_collected || 0), 0);
    return { due, got, diff: got - due, n: rows.length };
  }, [rows]);

  return (
    <DashboardLayout>
      <div className="container mx-auto p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Coins className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">تقرير التحصيل</h1>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">عدد عمليات التحصيل</p><p className="text-xl font-bold">{k.n.toLocaleString("ar-EG")}</p></CardContent></Card>
          <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">إجمالي المستحق</p><p className="text-xl font-bold text-primary">{k.due.toLocaleString("ar-EG")} ج.م</p></CardContent></Card>
          <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">إجمالي المحصَّل</p><p className="text-xl font-bold text-green-700">{k.got.toLocaleString("ar-EG")} ج.م</p></CardContent></Card>
          <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">الفرق</p><p className={`text-xl font-bold ${k.diff < 0 ? "text-red-700" : "text-emerald-700"}`}>{k.diff.toLocaleString("ar-EG")} ج.م</p></CardContent></Card>
        </div>

        <Card>
          <CardContent className="p-0">
            {loading ? <div className="text-center py-8 text-muted-foreground">جاري التحميل…</div> :
              rows.length === 0 ? <div className="text-center py-8 text-muted-foreground">لا توجد سجلات تحصيل</div> :
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">رقم الطلب</TableHead>
                      <TableHead className="text-right">المستحق</TableHead>
                      <TableHead className="text-right">المحصَّل</TableHead>
                      <TableHead className="text-right">الفرق</TableHead>
                      <TableHead className="text-right">الحالة</TableHead>
                      <TableHead className="text-right">التاريخ</TableHead>
                      <TableHead className="text-right">ملاحظات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map(r => (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono text-xs">{orderNumbers[r.order_id] || r.order_id.slice(0, 8)}</TableCell>
                        <TableCell>{Number(r.amount_due).toLocaleString("ar-EG")}</TableCell>
                        <TableCell>{Number(r.amount_collected).toLocaleString("ar-EG")}</TableCell>
                        <TableCell className={Number(r.difference) < 0 ? "text-red-700" : ""}>{Number(r.difference).toLocaleString("ar-EG")}</TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">{COLLECTION_STATUS_LABEL[r.status]}</Badge></TableCell>
                        <TableCell className="text-xs">{r.collected_at ? new Date(r.collected_at).toLocaleString("ar-EG") : "—"}</TableCell>
                        <TableCell className="text-xs max-w-[200px] truncate">{r.notes || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
