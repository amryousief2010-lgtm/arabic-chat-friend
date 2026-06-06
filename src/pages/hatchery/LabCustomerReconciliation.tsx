import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, Info, FileSpreadsheet } from "lucide-react";
import data from "@/data/labCustomerReconciliation.json";
import * as XLSX from "xlsx";

type Row = {
  id: string | number;
  customer: string;
  type: string;
  batch_number: number | string;
  receive_date: string | null;
  received_eggs: number;
  net_eggs: number;
  chicks: number;
  charge_brooding: number;
  charge_infertile: number;
  charge_hatcher: number;
  charge_total: number;
  received_money: number;
  remaining: number;
};

const rows = data as Row[];
const fmt = (n: number) => (n || 0).toLocaleString("ar-EG");
const isInternal = (t: string) => t === "داخلي" || /عاصمة|داخل/.test(t);

export default function LabCustomerReconciliation() {
  const [q, setQ] = useState("");

  const grouped = useMemo(() => {
    const map = new Map<string, { customer: string; type: string; batches: Row[] }>();
    for (const r of rows) {
      const key = `${r.customer}__${r.type}`;
      if (!map.has(key)) map.set(key, { customer: r.customer, type: r.type, batches: [] });
      map.get(key)!.batches.push(r);
    }
    return [...map.values()]
      .map((g) => {
        const sum = (k: keyof Row) => g.batches.reduce((s, b) => s + (Number(b[k]) || 0), 0);
        return {
          ...g,
          count: g.batches.length,
          eggs: sum("received_eggs"),
          chicks: sum("chicks"),
          charge: sum("charge_total"),
          received: sum("received_money"),
          remaining: sum("remaining"),
        };
      })
      .sort((a, b) => b.remaining - a.remaining || b.charge - a.charge);
  }, []);

  const filtered = useMemo(
    () => grouped.filter((g) => !q.trim() || g.customer.includes(q.trim())),
    [grouped, q]
  );

  const totals = useMemo(() => {
    const ext = grouped.filter((g) => !isInternal(g.type));
    const int = grouped.filter((g) => isInternal(g.type));
    const sum = (arr: typeof grouped, k: "charge" | "received" | "remaining" | "eggs" | "chicks" | "count") =>
      arr.reduce((s, g) => s + (g[k] as number), 0);
    return {
      all: { batches: rows.length, charge: sum(grouped, "charge"), received: sum(grouped, "received"), remaining: sum(grouped, "remaining") },
      external: { customers: ext.length, batches: sum(ext, "count"), eggs: sum(ext, "eggs"), chicks: sum(ext, "chicks"), charge: sum(ext, "charge"), received: sum(ext, "received"), remaining: sum(ext, "remaining") },
      internal: { customers: int.length, batches: sum(int, "count"), eggs: sum(int, "eggs"), chicks: sum(int, "chicks"), charge: sum(int, "charge"), received: sum(int, "received"), remaining: sum(int, "remaining") },
    };
  }, [grouped]);

  const anomalies = useMemo(() => {
    const list: { customer: string; type: string; issue: string }[] = [];
    for (const g of grouped) {
      const calc = g.charge - g.received;
      if (Math.abs(calc - g.remaining) > 1) {
        list.push({ customer: g.customer, type: g.type, issue: `فرق في المتبقي: المحسوب ${fmt(calc)} ≠ الشيت ${fmt(g.remaining)}` });
      }
      if (!isInternal(g.type) && g.charge === 0 && g.eggs > 0) {
        list.push({ customer: g.customer, type: g.type, issue: "عميل خارجي بدفعات لكن بدون أي حساب" });
      }
    }
    return list;
  }, [grouped]);

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    const summaryRows = filtered.map((g) => ({
      "العميل": g.customer,
      "النوع": g.type,
      "عدد الدفعات": g.count,
      "إجمالي البيض": g.eggs,
      "إجمالي الكتاكيت": g.chicks,
      "إجمالي الحساب": g.charge,
      "المستلم": g.received,
      "المتبقي": g.remaining,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), "ملخص العملاء");
    const detail = rows.map((r) => ({
      "العميل": r.customer,
      "النوع": r.type,
      "رقم الدفعة": r.batch_number,
      "تاريخ الوارد": r.receive_date,
      "البيض الوارد": r.received_eggs,
      "الصافي": r.net_eggs,
      "الكتاكيت": r.chicks,
      "حساب تحضين": r.charge_brooding,
      "حساب غير مخصب": r.charge_infertile,
      "حساب هاتشر": r.charge_hatcher,
      "إجمالي الحساب": r.charge_total,
      "المستلم": r.received_money,
      "المتبقي": r.remaining,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detail), "تفاصيل الدفعات");
    XLSX.writeFile(wb, "تسوية_حسابات_عملاء_المعمل.xlsx");
  };

  return (
    <div dir="rtl" className="container mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            تسوية حسابات عملاء المعمل
            <Badge variant="secondary" className="text-xs">تاريخي للمراجعة فقط</Badge>
          </h1>
          <p className="text-sm text-muted-foreground">
            بيانات مستوردة من الشيت — حسابات تقديرية تاريخية، لا تنشئ أي حركة خزنة ولا تُعتبر مديونية واجبة التحصيل.
          </p>
        </div>
        <Button onClick={exportExcel} variant="outline">
          <FileSpreadsheet className="w-4 h-4 ml-2" />
          تصدير Excel
        </Button>
      </div>

      <Alert className="border-orange-400 bg-orange-50 dark:bg-orange-950/20">
        <AlertTriangle className="w-4 h-4 text-orange-600" />
        <AlertDescription className="space-y-1">
          <div className="font-semibold">قاعدة مالية مهمة</div>
          <ul className="list-disc pr-5 text-xs space-y-0.5">
            <li>هذه الدفعات <b>تاريخية تشغيلية للمراجعة فقط</b> — لا تُنشئ أي حركة في خزنة المعمل.</li>
            <li>حسابات نعام العاصمة = <b>تكلفة تقديرية داخلية</b>، وليست مديونية واجبة التحصيل.</li>
            <li>التحصيل الفعلي يبدأ فقط من <b>الدفعات الحالية/القادمة عند الفقس</b>، ويُسجَّل يدويًا في خزنة المعمل بحسب طريقة الدفع.</li>
            <li>الأعمدة "المستلم" و"المتبقي" المقروءة من الشيت = <b>أرصدة تاريخية تقديرية</b>، وليست تحصيلات خزنة.</li>
          </ul>
        </AlertDescription>
      </Alert>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">إجمالي الدفعات التاريخية</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{fmt(totals.all.batches)}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">حساب تقديري تاريخي</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{fmt(totals.all.charge)}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">واجب التحصيل (دفعات حالية)</CardTitle></CardHeader><CardContent className="text-2xl font-bold text-muted-foreground">0</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">تم تحصيله فعليًا من الخزنة</CardTitle></CardHeader><CardContent className="text-2xl font-bold text-green-600">0</CardContent></Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              عملاء خارجيون
              <Badge variant="outline" className="text-[10px]">حساب تقديري تاريخي</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            <div>عدد العملاء: <b>{totals.external.customers}</b></div>
            <div>عدد الدفعات: <b>{fmt(totals.external.batches)}</b></div>
            <div>إجمالي البيض: <b>{fmt(totals.external.eggs)}</b> · كتاكيت: <b>{fmt(totals.external.chicks)}</b></div>
            <div>الحساب التقديري: <b>{fmt(totals.external.charge)}</b></div>
            <div className="text-xs text-muted-foreground border-t pt-1 mt-1">
              لا تظهر كمديونية واجبة التحصيل. التحصيل يبدأ من الدفعات الحالية عند الفقس فقط.
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              نعام العاصمة / داخلي
              <Badge variant="outline" className="text-[10px]">تكلفة تقديرية داخلية</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            <div>عدد العملاء: <b>{totals.internal.customers}</b></div>
            <div>عدد الدفعات: <b>{fmt(totals.internal.batches)}</b></div>
            <div>إجمالي البيض: <b>{fmt(totals.internal.eggs)}</b> · كتاكيت: <b>{fmt(totals.internal.chicks)}</b></div>
            <div>تكلفة تشغيلية تقديرية: <b>{fmt(totals.internal.charge)}</b></div>
            <div className="text-xs text-muted-foreground border-t pt-1 mt-1">
              لأغراض التحليل والتكلفة فقط — لا مديونية ولا تحصيل.
            </div>
          </CardContent>
        </Card>
      </div>


      {anomalies.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="w-4 h-4" />
          <AlertDescription>
            <div className="font-semibold mb-1">عملاء بفروقات / بيانات ناقصة ({anomalies.length})</div>
            <ul className="list-disc pr-5 space-y-0.5 text-xs max-h-40 overflow-auto">
              {anomalies.map((a, i) => (
                <li key={i}>{a.customer} ({a.type}) — {a.issue}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base">كشف حساب العملاء</CardTitle>
          <Input placeholder="بحث باسم العميل" value={q} onChange={(e) => setQ(e.target.value)} className="w-64" />
        </CardHeader>
        <CardContent className="p-0">
          <Tabs defaultValue="external">
            <TabsList className="mx-3 mt-2">
              <TabsTrigger value="external">خارجي ({grouped.filter(g => !isInternal(g.type)).length})</TabsTrigger>
              <TabsTrigger value="internal">داخلي ({grouped.filter(g => isInternal(g.type)).length})</TabsTrigger>
            </TabsList>
            {(["external", "internal"] as const).map((tab) => (
              <TabsContent key={tab} value={tab} className="m-0">
                <div className="overflow-auto max-h-[60vh]">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-muted">
                      <tr>
                        <th className="p-2 text-right">العميل</th>
                        <th className="p-2">دفعات</th>
                        <th className="p-2">بيض</th>
                        <th className="p-2">كتاكيت</th>
                        <th className="p-2">حساب تقديري تاريخي</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered
                        .filter((g) => (tab === "external" ? !isInternal(g.type) : isInternal(g.type)))
                        .map((g, i) => (
                          <tr key={i} className="border-t hover:bg-muted/40">
                            <td className="p-2 font-medium">
                              {g.customer}{" "}
                              <Badge variant="outline" className="mr-1 text-[10px]">
                                {isInternal(g.type) ? "تكلفة داخلية" : "تاريخي"}
                              </Badge>
                            </td>
                            <td className="p-2 text-center">{g.count}</td>
                            <td className="p-2 text-center">{fmt(g.eggs)}</td>
                            <td className="p-2 text-center">{fmt(g.chicks)}</td>
                            <td className="p-2 text-center">{fmt(g.charge)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>

      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="text-base">دورة التحصيل الفعلي (الدفعات الحالية والقادمة)</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          <ol className="list-decimal pr-5 space-y-1">
            <li>عند فقس دفعة لعميل خارجي → يظهر المبلغ المطلوب على العميل.</li>
            <li>يتم تسجيل التحصيل <b>يدويًا</b> من شاشة خزنة المعمل بحسب طريقة الدفع: نقدي / فودافون كاش / إنستا باي / تحويل.</li>
            <li>لا تُضاف أي فلوس لخزنة المعمل إلا بعد اعتماد التحصيل الفعلي.</li>
            <li>دفعات نعام العاصمة لا تدخل في دورة التحصيل، تظهر كتكلفة تشغيلية فقط.</li>
          </ol>
          <p className="text-xs text-muted-foreground border-t pt-2">
            هذه الصفحة تعرض الأرصدة التاريخية فقط، ولن تُسجَّل في أي جدول مالي. المبالغ الواجبة والمحصَّلة فعليًا ستظهر من سجلات الدفعات الجديدة عند فقسها.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
