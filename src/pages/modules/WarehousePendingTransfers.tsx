import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeftRight, AlertTriangle, RefreshCw, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Transfer {
  id: string; transfer_no: string; status: string;
  source_warehouse_id: string; destination_warehouse_id: string;
  created_at: string; sent_at: string | null; received_at: string | null;
  notes: string | null; rejection_reason: string | null;
  items: { item_name: string; unit: string; requested_qty: number; sent_qty: number | null; received_qty: number | null; shortage_qty: number | null; line_status: string | null }[];
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-700",
  sent: "bg-blue-500/15 text-blue-700",
  partially_received: "bg-orange-500/15 text-orange-700",
  needs_manager_review: "bg-rose-500/15 text-rose-700",
  awaiting_approval: "bg-amber-500/15 text-amber-700",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "معلق",
  sent: "تم الإرسال",
  partially_received: "استلام جزئي",
  needs_manager_review: "بحاجة مراجعة مدير",
  awaiting_approval: "بانتظار الاعتماد",
};

export default function WarehousePendingTransfers() {
  const [rows, setRows] = useState<Transfer[]>([]);
  const [warehouses, setWarehouses] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const [{ data: whs }, { data: trs }] = await Promise.all([
      supabase.from("warehouses").select("id, name"),
      supabase
        .from("warehouse_transfers")
        .select("id, transfer_no, status, source_warehouse_id, destination_warehouse_id, created_at, sent_at, received_at, notes, rejection_reason")
        .in("status", ["pending", "sent", "partially_received", "needs_manager_review", "awaiting_approval"])
        .order("created_at", { ascending: false })
        .limit(500),
    ]);
    const whMap: Record<string, string> = {};
    (whs || []).forEach((w: any) => { whMap[w.id] = w.name; });
    setWarehouses(whMap);

    const ids = (trs || []).map((t: any) => t.id);
    const { data: items } = ids.length
      ? await supabase.from("warehouse_transfer_items").select("transfer_id, item_name, unit, requested_qty, sent_qty, received_qty, shortage_qty, line_status").in("transfer_id", ids)
      : { data: [] as any[] };
    const byTr: Record<string, any[]> = {};
    (items || []).forEach((it: any) => { (byTr[it.transfer_id] ||= []).push(it); });
    setRows((trs || []).map((t: any) => ({ ...t, items: byTr[t.id] || [] })));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const needsReview = rows.filter((r) => r.status === "needs_manager_review" || r.status === "partially_received");

  return (
    <DashboardLayout>
      <div className="space-y-4 p-4" dir="rtl">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
            <ArrowLeftRight className="w-6 h-6 text-primary" />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">التحويلات المعلقة بين المخازن</h1>
            <p className="text-sm text-muted-foreground">يعرض التحويلات غير المكتملة. اعتمد أو ارفض من شاشة مركز مراجعة المدير.</p>
          </div>
          <Button variant="outline" onClick={load}><RefreshCw className="w-4 h-4 ml-1" /> تحديث</Button>
        </div>

        {needsReview.length > 0 && (
          <Card className="border-rose-500/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-rose-600 text-base">
                <AlertTriangle className="w-4 h-4" /> تحويلات بحاجة مراجعة مدير ({needsReview.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              يوجد عجز في الكمية المستلمة. افتح "مركز مراجعة المدير" لاعتماد/تسوية التحويل.{" "}
              <Link to="/manager-review" className="text-primary underline">فتح مركز المراجعة</Link>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>رقم التحويل</TableHead>
                    <TableHead>المصدر</TableHead>
                    <TableHead>الوجهة</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead>تاريخ الإنشاء</TableHead>
                    <TableHead>تاريخ الإرسال</TableHead>
                    <TableHead>تاريخ الاستلام</TableHead>
                    <TableHead>عدد الأصناف</TableHead>
                    <TableHead>إجمالي المطلوب</TableHead>
                    <TableHead>إجمالي المستلم</TableHead>
                    <TableHead>عجز</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow><TableCell colSpan={12} className="text-center py-8 text-muted-foreground">جاري التحميل...</TableCell></TableRow>
                  ) : rows.length === 0 ? (
                    <TableRow><TableCell colSpan={12} className="text-center py-8 text-muted-foreground">لا توجد تحويلات معلقة 🎉</TableCell></TableRow>
                  ) : rows.map((t) => {
                    const reqTotal = t.items.reduce((s, i) => s + Number(i.requested_qty || 0), 0);
                    const recvTotal = t.items.reduce((s, i) => s + Number(i.received_qty || 0), 0);
                    const shortTotal = t.items.reduce((s, i) => s + Number(i.shortage_qty || 0), 0);
                    return (
                      <TableRow key={t.id}>
                        <TableCell className="font-mono">{t.transfer_no}</TableCell>
                        <TableCell>{warehouses[t.source_warehouse_id] || "—"}</TableCell>
                        <TableCell>{warehouses[t.destination_warehouse_id] || "—"}</TableCell>
                        <TableCell><Badge className={STATUS_COLORS[t.status] || ""}>{STATUS_LABEL[t.status] || t.status}</Badge></TableCell>
                        <TableCell className="text-xs">{new Date(t.created_at).toLocaleString("ar-EG")}</TableCell>
                        <TableCell className="text-xs">{t.sent_at ? new Date(t.sent_at).toLocaleString("ar-EG") : "—"}</TableCell>
                        <TableCell className="text-xs">{t.received_at ? new Date(t.received_at).toLocaleString("ar-EG") : "—"}</TableCell>
                        <TableCell>{t.items.length}</TableCell>
                        <TableCell className="font-mono">{reqTotal}</TableCell>
                        <TableCell className="font-mono">{recvTotal}</TableCell>
                        <TableCell className={`font-mono ${shortTotal > 0 ? "text-rose-600 font-bold" : ""}`}>{shortTotal}</TableCell>
                        <TableCell>
                          <Button asChild variant="ghost" size="sm">
                            <Link to={`/transfers/${t.id}`}><ExternalLink className="w-3 h-3" /></Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
