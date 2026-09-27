import { useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Row = {
  output_id: string;
  batch_number: string | null;
  cut_name_ar: string;
  destination: string;
  actual_weight_kg: number;
  received_status: string;
  age_days: number | null;
};

type Unmapped = { cut_name_ar: string; occurrences: number };

export default function UnreceivedSlaughterOutputs() {
  const [rows, setRows] = useState<Row[]>([]);
  const [unmapped, setUnmapped] = useState<Unmapped[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    const [pending, names] = await Promise.all([
      (supabase as any).rpc("list_unreceived_slaughter_outputs"),
      (supabase as any).rpc("list_unmapped_slaughter_outputs"),
    ]);
    setLoading(false);
    if (pending.error) {
      toast.error(pending.error.message || "تعذّر تحميل المخرجات");
      return;
    }
    if (names.error) toast.error(names.error.message);
    setRows((pending.data || []) as Row[]);
    setUnmapped((names.data || []) as Unmapped[]);
  };

  return (
    <DashboardLayout>
      <div className="space-y-4 p-4" dir="rtl">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold">مخرجات مجزر لم تُستلم</h1>
            <p className="text-sm text-muted-foreground">كل مخرج يُستلم مرة واحدة في وجهته: المخزن أو مصنع اللحوم. الاسم غير المربوط بمنتج يُرفض.</p>
          </div>
          <Button onClick={load} disabled={loading}>{loading ? "جارٍ التحميل" : "تحديث"}</Button>
        </div>
        {unmapped.length > 0 && (
          <p className="text-sm text-destructive">
            أسماء بلا خريطة منتج: {unmapped.map((u) => `${u.cut_name_ar} (${u.occurrences})`).join("، ")}
          </p>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>الدفعة</TableHead>
              <TableHead>القطعية</TableHead>
              <TableHead>الوجهة</TableHead>
              <TableHead>الوزن</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead>العمر</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.output_id}>
                <TableCell>{r.batch_number || "—"}</TableCell>
                <TableCell>{r.cut_name_ar}</TableCell>
                <TableCell>{r.destination}</TableCell>
                <TableCell>{r.actual_weight_kg}</TableCell>
                <TableCell>{r.received_status}</TableCell>
                <TableCell>{r.age_days ?? "—"}</TableCell>
              </TableRow>
            ))}
            {!rows.length && (
              <TableRow><TableCell colSpan={6}>اضغط تحديث لعرض المخرجات التي لم تُستلم.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </DashboardLayout>
  );
}
