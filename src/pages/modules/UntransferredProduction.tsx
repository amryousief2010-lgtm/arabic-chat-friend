import { useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LegacyCloseCheckbox, LegacyCloseControls } from "@/components/warehouse/LegacyStocktakeClose";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Row = {
  bucket: string;
  doc_id: string;
  doc_no: string | null;
  product_name: string | null;
  qty: number | null;
  status: string | null;
  approved_at: string | null;
  age_days: number | null;
};

const BUCKET: Record<string, string> = {
  not_sent: "معتمد ولم يُرسل",
  sent_not_received: "أُرسل ولم يُستلم",
};

export default function UntransferredProduction() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  const load = async () => {
    setLoading(true);
    const { data, error } = await (supabase as any).rpc("list_untransferred_production");
    setLoading(false);
    if (error) {
      toast.error(error.message || "تعذّر تحميل الإنتاج غير المنقول");
      return;
    }
    setRows((data || []) as Row[]);
    setSelected([]);
  };

  const invoiceIds = rows.filter((r) => r.bucket === "not_sent").map((r) => r.doc_id);
  const toggle = (id: string, on: boolean) => {
    setSelected((cur) => on ? Array.from(new Set([...cur, id])) : cur.filter((x) => x !== id));
  };

  return (
    <DashboardLayout>
      <div className="space-y-4 p-4" dir="rtl">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold">إنتاج لم يُنقل إلى المخزن الرئيسي</h1>
            <p className="text-sm text-muted-foreground">اعتماد التصنيع يبقي التام في مخزن المصنع. النقل يتم بتحويل ثم استلام.</p>
          </div>
          <div className="flex items-center gap-2">
            <LegacyCloseControls
              docType="meat_manufacturing_invoice"
              selectedIds={selected.filter((id) => invoiceIds.includes(id))}
              onDone={load}
            />
            <Button onClick={load} disabled={loading}>{loading ? "جارٍ التحميل" : "تحديث"}</Button>
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead></TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead>المستند</TableHead>
              <TableHead>الصنف</TableHead>
              <TableHead>الكمية</TableHead>
              <TableHead>العمر بالأيام</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={`${r.bucket}-${r.doc_id}`}>
                <TableCell>
                  {r.bucket === "not_sent" && (
                    <LegacyCloseCheckbox
                      checked={selected.includes(r.doc_id)}
                      onCheckedChange={(on) => toggle(r.doc_id, on)}
                    />
                  )}
                </TableCell>
                <TableCell>{BUCKET[r.bucket] || r.bucket}</TableCell>
                <TableCell>{r.doc_no || r.doc_id}</TableCell>
                <TableCell>{r.product_name || "—"}</TableCell>
                <TableCell>{r.qty ?? "—"}</TableCell>
                <TableCell>{r.age_days ?? "—"}</TableCell>
              </TableRow>
            ))}
            {!rows.length && (
              <TableRow><TableCell colSpan={6}>اضغط تحديث لعرض الفواتير المعتمدة التي لم تصل للمخزن الرئيسي.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </DashboardLayout>
  );
}
