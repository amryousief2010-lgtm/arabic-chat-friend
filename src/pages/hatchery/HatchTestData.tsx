import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, FlaskConical } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

const ALLOWED = ["general_manager", "executive_manager"];

export default function HatchTestData() {
  const { roles } = useAuth();
  const allowed = roles.some((r) => ALLOWED.includes(r));

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["hatch_test_rows"],
    enabled: allowed,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hatch_batches")
        .select("*, hatch_customers(name)")
        .eq("is_test", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  if (!allowed) {
    return (
      <div className="p-8" dir="rtl">
        <Card className="p-6 text-center">
          <AlertTriangle className="w-12 h-12 mx-auto text-amber-600 mb-2" />
          <h2 className="text-xl font-bold">صفحة محظورة</h2>
          <p className="text-muted-foreground">هذه الصفحة متاحة فقط للمدير العام والمدير التنفيذي.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4" dir="rtl">
      <div className="flex items-center gap-2">
        <FlaskConical className="w-6 h-6 text-amber-600" />
        <h1 className="text-2xl font-bold">بيانات تجريبية / TEST</h1>
        <Badge variant="outline" className="mr-2">{rows.length} صف</Badge>
      </div>

      <Card className="p-3 bg-amber-50 border-amber-200 text-sm">
        ⚠️ هذه الصفوف مستبعدة من جميع التقارير والحسابات التشغيلية والمالية. تعرض هنا للمراجعة فقط.
        لا يتم حذفها تلقائيًا.
      </Card>

      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>رقم الدفعة</TableHead>
              <TableHead>الدفعة التشغيلية</TableHead>
              <TableHead>تاريخ الدخول</TableHead>
              <TableHead>الماكينة</TableHead>
              <TableHead>العميل</TableHead>
              <TableHead>البيض</TableHead>
              <TableHead>الصافي</TableHead>
              <TableHead>كتاكيت</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead>ملاحظات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={10} className="text-center py-8">جاري التحميل...</TableCell></TableRow>}
            {!isLoading && rows.length === 0 && (
              <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">لا توجد صفوف TEST</TableCell></TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="text-xs font-mono">{r.batch_number || "—"}</TableCell>
                <TableCell className="text-xs font-mono">{r.operational_batch_no || "—"}</TableCell>
                <TableCell className="text-xs">{r.entry_date || "—"}</TableCell>
                <TableCell className="text-xs">{r.machine || "—"}</TableCell>
                <TableCell className="text-xs">{r.hatch_customers?.name || "—"}</TableCell>
                <TableCell>{r.received_eggs || 0}</TableCell>
                <TableCell>{r.net_eggs || 0}</TableCell>
                <TableCell>{r.hatched_chicks || 0}</TableCell>
                <TableCell><Badge variant="outline">{r.status}</Badge></TableCell>
                <TableCell className="text-xs max-w-xs truncate">{r.notes || "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
