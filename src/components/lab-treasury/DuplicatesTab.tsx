import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, RefreshCw, Shield } from "lucide-react";

interface Pair {
  first_id: string;
  duplicate_id: string;
  movement_type: "income" | "expense";
  amount: number;
  payment_method: string;
  movement_date: string;
  party: string;
  category: string | null;
  first_source_table: string | null;
  duplicate_source_table: string | null;
  first_created_at: string;
  duplicate_created_at: string;
  first_description: string | null;
  duplicate_description: string | null;
}

const PM: Record<string, string> = {
  cash: "نقدي", vodafone_cash: "فودافون كاش", instapay: "انستاباي", bank_transfer: "تحويل بنكي",
};

const fmt = (n: number) => Number(n || 0).toLocaleString("ar-EG", { maximumFractionDigits: 2 });

export default function DuplicatesTab({ isManager }: { isManager: boolean }) {
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("v_lab_treasury_potential_duplicates")
      .select("*")
      .order("movement_date", { ascending: false })
      .limit(500);
    if (error) toast.error(error.message);
    setPairs((data as Pair[]) || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const summary = useMemo(() => {
    const incomeAmount = pairs.filter(p => p.movement_type === "income").reduce((s, p) => s + Number(p.amount), 0);
    const expenseAmount = pairs.filter(p => p.movement_type === "expense").reduce((s, p) => s + Number(p.amount), 0);
    return { count: pairs.length, incomeAmount, expenseAmount };
  }, [pairs]);

  const reverse = async (p: Pair) => {
    const reason = prompt(`سبب اعتبار حركة ${p.movement_type === "income" ? "الإيراد" : "المصروف"} ${fmt(p.amount)} ج (المنشأة ${new Date(p.duplicate_created_at).toLocaleString("ar-EG")}) تكراراً؟`);
    if (!reason || reason.trim().length < 3) return;
    if (!confirm("سيتم إنشاء حركة عكسية بنفس المبلغ لإلغاء الأثر فقط (الحركة الأصلية تبقى للتدقيق). متابعة؟")) return;
    setBusyId(p.duplicate_id);
    const { error } = await supabase.rpc("lab_treasury_reverse_duplicate", {
      p_duplicate_id: p.duplicate_id,
      p_kept_id: p.first_id,
      p_reason: reason.trim(),
    });
    setBusyId(null);
    if (error) { toast.error(error.message); return; }
    toast.success("تم إلغاء أثر الحركة المكررة وتسجيلها في سجل التدقيق");
    load();
  };

  return (
    <div className="space-y-4">
      <Alert>
        <Shield className="w-4 h-4" />
        <AlertTitle>تقرير الحركات المالية المكررة المحتملة</AlertTitle>
        <AlertDescription>
          يعرض أزواج الحركات المعتمدة المتشابهة في النوع، المبلغ، التاريخ، طريقة الدفع، والجهة. لن يتم حذف أي حركة — التصحيح فقط عن طريق إنشاء حركة عكسية باعتماد المدير، مع تسجيل العملية في سجل التدقيق.
        </AlertDescription>
      </Alert>

      <div className="grid grid-cols-3 gap-2">
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">عدد الأزواج المكررة</div><div className="text-lg font-bold">{summary.count}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">إجمالي تكرار الإيرادات</div><div className="text-lg font-bold font-mono text-emerald-700">{fmt(summary.incomeAmount)} ج</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">إجمالي تكرار المصروفات</div><div className="text-lg font-bold font-mono text-rose-700">{fmt(summary.expenseAmount)} ج</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-600" />الأزواج المتطابقة</CardTitle>
          <Button variant="outline" size="sm" onClick={load} className="gap-2"><RefreshCw className="w-3 h-3" />تحديث</Button>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {loading ? <div className="text-center text-muted-foreground py-6">جاري التحميل...</div> :
           pairs.length === 0 ? <div className="text-center text-emerald-700 py-6">لا توجد حركات مكررة محتملة. ✅</div> :
          <Table>
            <TableHeader><TableRow>
              <TableHead>التاريخ</TableHead>
              <TableHead>النوع</TableHead>
              <TableHead>المبلغ</TableHead>
              <TableHead>طريقة الدفع</TableHead>
              <TableHead>الجهة</TableHead>
              <TableHead>الحركة الأولى (تُحفظ)</TableHead>
              <TableHead>الحركة المكررة (تُلغى)</TableHead>
              <TableHead className="text-center">إجراء</TableHead>
            </TableRow></TableHeader>
            <TableBody>{pairs.map(p => (
              <TableRow key={p.duplicate_id}>
                <TableCell className="whitespace-nowrap">{p.movement_date}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={p.movement_type === "income" ? "bg-emerald-500/15 text-emerald-700" : "bg-rose-500/15 text-rose-700"}>
                    {p.movement_type === "income" ? "إيراد" : "مصروف"}
                  </Badge>
                  {p.category && <span className="text-xs text-muted-foreground block mt-1">{p.category}</span>}
                </TableCell>
                <TableCell className="font-mono font-bold">{fmt(Number(p.amount))} ج</TableCell>
                <TableCell>{PM[p.payment_method] || p.payment_method}</TableCell>
                <TableCell className="font-medium">{p.party || "—"}</TableCell>
                <TableCell className="text-xs">
                  <div className="font-mono">#{p.first_id.slice(0, 8)}</div>
                  <div className="text-muted-foreground">{new Date(p.first_created_at).toLocaleString("ar-EG")}</div>
                  {p.first_source_table && <div className="text-blue-700">مصدر: {p.first_source_table}</div>}
                </TableCell>
                <TableCell className="text-xs">
                  <div className="font-mono">#{p.duplicate_id.slice(0, 8)}</div>
                  <div className="text-muted-foreground">{new Date(p.duplicate_created_at).toLocaleString("ar-EG")}</div>
                  {p.duplicate_source_table && <div className="text-blue-700">مصدر: {p.duplicate_source_table}</div>}
                </TableCell>
                <TableCell className="text-center">
                  {isManager ? (
                    <Button size="sm" variant="destructive" onClick={() => reverse(p)} disabled={busyId === p.duplicate_id}>
                      إلغاء أثر النسخة المكررة
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">يلزم اعتماد المدير</span>
                  )}
                </TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>}
        </CardContent>
      </Card>
    </div>
  );
}
