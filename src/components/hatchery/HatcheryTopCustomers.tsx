import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Trophy, Egg, FileText, Crown } from "lucide-react";
import {
  aggregateByCustomer,
  HatchBatchRow,
  HatchCustomerLite,
  CustomerPaymentLite,
} from "@/lib/hatcheryCustomerStats";

const fmt = (n: number) => Math.round(n || 0).toLocaleString("ar-EG");
const pct = (n: number) => (n || 0).toFixed(1) + "%";

interface Props {
  batches: HatchBatchRow[];
  customers: HatchCustomerLite[];
  payments?: CustomerPaymentLite[];
}

export default function HatcheryTopCustomers({ batches, customers, payments = [] }: Props) {
  const navigate = useNavigate();

  const externalStats = useMemo(
    () => aggregateByCustomer(batches, customers, payments, { includeInternal: false }),
    [batches, customers, payments],
  );
  const internalStats = useMemo(
    () => aggregateByCustomer(batches, customers, payments, { includeInternal: true })
      .filter((s) => s.is_internal),
    [batches, customers, payments],
  );

  const sortedExternal = [...externalStats].sort((a, b) => b.total_eggs - a.total_eggs);
  const top = sortedExternal[0];
  const top10 = sortedExternal.slice(0, 10);
  const internalTotal = internalStats.reduce(
    (acc, s) => ({
      eggs: acc.eggs + s.total_eggs,
      chicks: acc.chicks + s.chicks,
      batches: acc.batches + s.batches,
    }),
    { eggs: 0, chicks: 0, batches: 0 },
  );

  return (
    <section className="space-y-3">
      <h3 className="font-semibold flex items-center gap-2">
        <Trophy className="w-4 h-4 text-amber-500" /> أداء العملاء حسب البيض والدفعات
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Top external customer */}
        <Card className="p-4 border-2 border-amber-400 bg-amber-50/50 dark:bg-amber-950/20">
          <div className="flex items-center gap-2 mb-2">
            <Crown className="w-5 h-5 text-amber-600" />
            <span className="font-semibold text-amber-800 dark:text-amber-200">
              أكثر عميل جاب بيض للمعمل (خارجي)
            </span>
          </div>
          {top ? (
            <>
              <div className="text-2xl font-bold mb-1">{top.name}</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <div>إجمالي البيض: <b>{fmt(top.total_eggs)}</b></div>
                <div>عدد الدفعات: <b>{fmt(top.batches)}</b></div>
                <div>الكتاكيت: <b>{fmt(top.chicks)}</b></div>
                <div>نسبة الفقس: <b>{pct(top.hatch_rate_pct)}</b></div>
                <div className="col-span-2 pt-1 border-t mt-1">
                  الحساب التقديري: <b>{fmt(top.estimated_charge)} ج.م</b>
                  <span className="text-xs text-muted-foreground mr-2">(تقديري — ليس تحصيلًا فعليًا)</span>
                </div>
              </div>
            </>
          ) : (
            <div className="text-sm text-muted-foreground">لا توجد بيانات عملاء خارجيين بعد.</div>
          )}
        </Card>

        {/* Internal capital ostrich aggregate */}
        <Card className="p-4 border-2 border-purple-400 bg-purple-50/40 dark:bg-purple-950/20">
          <div className="flex items-center gap-2 mb-2">
            <Egg className="w-5 h-5 text-purple-600" />
            <span className="font-semibold text-purple-800 dark:text-purple-200">
              تحليل داخلي — نعام العاصمة
            </span>
            <Badge variant="outline" className="mr-auto">داخلي</Badge>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <div>إجمالي البيض: <b>{fmt(internalTotal.eggs)}</b></div>
            <div>عدد الدفعات: <b>{fmt(internalTotal.batches)}</b></div>
            <div>الكتاكيت: <b>{fmt(internalTotal.chicks)}</b></div>
            <div>نسبة الفقس: <b>{pct(
              internalStats.reduce((s, c) => s + c.fertile, 0) > 0
                ? (internalTotal.chicks / internalStats.reduce((s, c) => s + c.fertile, 0)) * 100
                : 0,
            )}</b></div>
            <div className="col-span-2 text-xs text-muted-foreground pt-1 border-t mt-1">
              قيمة داخلية للتحليل فقط، لا تُعتبر مديونية على نعام العاصمة.
            </div>
          </div>
        </Card>
      </div>

      {/* Top 10 */}
      <Card className="p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="font-semibold flex items-center gap-2">
            <Trophy className="w-4 h-4 text-amber-500" />
            أكثر العملاء إدخالًا للبيض (Top 10 خارجي)
          </div>
          <Button size="sm" variant="outline" onClick={() => navigate("/hatchery/customer-statements")}>
            <FileText className="w-4 h-4 ml-1" /> كشف حساب العملاء الكامل
          </Button>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>العميل</TableHead>
                <TableHead className="text-center">الدفعات</TableHead>
                <TableHead className="text-center">إجمالي البيض</TableHead>
                <TableHead className="text-center">الكتاكيت</TableHead>
                <TableHead className="text-center">نسبة الفقس</TableHead>
                <TableHead className="text-center">الحساب التقديري</TableHead>
                <TableHead className="text-center">إجراء</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {top10.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-6">
                    لا توجد بيانات عملاء.
                  </TableCell>
                </TableRow>
              )}
              {top10.map((s, i) => (
                <TableRow key={s.customer_id} className="hover:bg-muted/40">
                  <TableCell className="font-bold">{i + 1}</TableCell>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell className="text-center">{fmt(s.batches)}</TableCell>
                  <TableCell className="text-center font-bold">{fmt(s.total_eggs)}</TableCell>
                  <TableCell className="text-center">{fmt(s.chicks)}</TableCell>
                  <TableCell className="text-center">{pct(s.hatch_rate_pct)}</TableCell>
                  <TableCell className="text-center">{fmt(s.estimated_charge)}</TableCell>
                  <TableCell className="text-center">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        navigate(`/hatchery/customer-statements?customer=${s.customer_id}`)
                      }
                    >
                      <FileText className="w-3 h-3 ml-1" /> كشف
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </section>
  );
}
