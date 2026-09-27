import { useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type ReconRow = {
  check_code: string;
  warehouse_id: string | null;
  item_id: string | null;
  source_ref: string | null;
  detail: string | null;
  expected_qty: number | null;
  actual_qty: number | null;
};

type FailRow = {
  order_id: string;
  product_id: string | null;
  order_item_id: string | null;
  quantity: number | null;
  reason: string | null;
  created_at: string;
};

const LABELS: Record<string, string> = {
  stock_mismatch: "فرق رصيد",
  no_baseline: "بدون جرد أساس",
  delivered_without_dispatch: "تسليم بدون صرف",
  dispatch_without_delivered_order: "صرف بدون تسليم",
  duplicate_source_key: "مفتاح مكرر",
  negative_stock: "رصيد سالب",
  movement_without_snapshot: "حركة بلا لقطة",
  transfer_in_transit: "تحويل لم يُستلم",
};

export default function InventoryReconciliation() {
  const [rows, setRows] = useState<ReconRow[]>([]);
  const [fails, setFails] = useState<FailRow[]>([]);
  const [dupes, setDupes] = useState<any[]>([]);
  const [egex, setEgex] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const load = async () => {
    setLoading(true);
    try {
      const [recon, failed, duplicates, staging] = await Promise.all([
        (supabase as any).rpc("inventory_reconciliation_check", { p_in_transit_days: 3 }),
        supabase.from("order_deduction_lines").select("order_id, product_id, order_item_id, quantity, reason, created_at").eq("status", "failed").order("created_at", { ascending: false }).limit(200),
        (supabase as any).rpc("report_duplicate_inventory_cards"),
        (supabase as any).rpc("inventory_egex_staging_compare"),
      ]);
      if (recon.error) throw recon.error;
      if (failed.error) throw failed.error;
      if (duplicates.error) throw duplicates.error;
      if (staging.error) throw staging.error;
      setRows((recon.data || []) as ReconRow[]);
      setFails((failed.data || []) as FailRow[]);
      setDupes(duplicates.data || []);
      setEgex(staging.data || []);
      setPage(0);
    } catch (e: any) {
      toast.error(e?.message || "تعذّر تحميل المطابقة");
    } finally {
      setLoading(false);
    }
  };

  const slice = rows.slice(page * pageSize, (page + 1) * pageSize);

  return (
    <DashboardLayout>
      <div className="space-y-4 p-4" dir="rtl">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl font-semibold">مطابقة دفتر المخزون</h1>
          <Button onClick={load} disabled={loading}>{loading ? "جارٍ التحميل" : "تحديث"}</Button>
        </div>
        <Card>
          <CardHeader><CardTitle>نتيجة الفحص</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الفحص</TableHead>
                  <TableHead>المرجع</TableHead>
                  <TableHead>التفصيل</TableHead>
                  <TableHead>المتوقع</TableHead>
                  <TableHead>الفعلي</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {slice.map((r, i) => (
                  <TableRow key={`${r.check_code}-${r.item_id}-${i}`}>
                    <TableCell>{LABELS[r.check_code] || r.check_code}</TableCell>
                    <TableCell>{r.source_ref || r.item_id || r.warehouse_id || "—"}</TableCell>
                    <TableCell>{r.detail}</TableCell>
                    <TableCell>{r.expected_qty ?? "—"}</TableCell>
                    <TableCell>{r.actual_qty ?? "—"}</TableCell>
                  </TableRow>
                ))}
                {slice.length === 0 && (
                  <TableRow><TableCell colSpan={5}>اضغط تحديث. قبل جرد 30 سبتمبر تظهر المخازن «بدون جرد أساس» وهذا ليس فرقاً.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
            <div className="mt-3 flex gap-2">
              <Button variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>السابق</Button>
              <Button variant="outline" disabled={(page + 1) * pageSize >= rows.length} onClick={() => setPage((p) => p + 1)}>التالي</Button>
              <span className="text-sm text-muted-foreground">{rows.length} صف</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>بنود أوردر لم تُخصم</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الأوردر</TableHead>
                  <TableHead>البند</TableHead>
                  <TableHead>الكمية</TableHead>
                  <TableHead>السبب</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fails.map((f) => (
                  <TableRow key={`${f.order_id}-${f.order_item_id}`}>
                    <TableCell>{f.order_id}</TableCell>
                    <TableCell>{f.order_item_id || f.product_id || "—"}</TableCell>
                    <TableCell>{f.quantity ?? "—"}</TableCell>
                    <TableCell>{f.reason}</TableCell>
                  </TableRow>
                ))}
                {fails.length === 0 && <TableRow><TableCell colSpan={4}>لا توجد بنود فاشلة في آخر 200 سجل.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>بطاقات مكررة (تقرير فقط — الدمج لا يُنفَّذ)</CardTitle></CardHeader>
          <CardContent>
            {dupes.length === 0 ? "لا توجد بطاقات مكررة لنفس المنتج في نفس المخزن." : dupes.map((d) => (
              <div key={`${d.warehouse_id}-${d.product_id}`} className="border-b py-2 text-sm">
                {d.warehouse_name} — {d.product_name} — {d.card_count} بطاقات
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>مقارنة إيجكس (قراءة فقط)</CardTitle></CardHeader>
          <CardContent>
            {egex.slice(0, 20).map((e, i) => (
              <div key={i} className="text-sm">{e.note || `${e.store_key} / ${e.item_key}: التطبيق ${e.app_qty} — إيجكس ${e.egex_qty}`}</div>
            ))}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
