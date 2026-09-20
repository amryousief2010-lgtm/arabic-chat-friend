import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Truck, FileText, AlertTriangle, PackageCheck, RotateCcw, Timer } from "lucide-react";
import type { useZodexReportData } from "@/hooks/useZodexReportData";

type ZodexData = ReturnType<typeof useZodexReportData>;

const egp = (v: number) => `${Math.round(v).toLocaleString("ar-EG")} ج.م`;

export function ZodexSalesTab({ data }: { data: ZodexData }) {
  if (data.isLoading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="glass-card">
            <CardHeader><Skeleton className="h-6 w-40" /></CardHeader>
            <CardContent><Skeleton className="h-40 w-full" /></CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const stats = [
    { label: "شحنات زودكس", value: `${data.shipmentsCount.toLocaleString("ar-EG")} شحنة`, sub: egp(data.shipmentsValue), icon: Truck, color: "bg-primary", fg: "text-primary-foreground" },
    { label: "تم التسليم", value: `${data.deliveredCount.toLocaleString("ar-EG")} (${data.deliveryRate}%)`, sub: egp(data.deliveredValue), icon: PackageCheck, color: "bg-success", fg: "text-success-foreground" },
    { label: "مرتجع / ملغي", value: data.returnedCount.toLocaleString("ar-EG"), sub: egp(data.returnedValue), icon: RotateCcw, color: "bg-destructive", fg: "text-primary-foreground" },
    { label: "قيد الشحن", value: data.inTransitCount.toLocaleString("ar-EG"), sub: egp(data.inTransitValue), icon: Timer, color: "bg-chart-4", fg: "text-primary-foreground" },
  ];

  return (
    <div className="space-y-6">
      {data.isError && (
        <p className="text-sm text-destructive">
          تعذر تحميل بيانات زودكس{data.errorMessage ? `: ${data.errorMessage}` : ""}
        </p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
        {stats.map((s) => (
          <Card key={s.label} className="stat-card">
            <div className="flex items-center gap-4">
              <div className={`w-12 h-12 rounded-xl ${s.color} flex items-center justify-center`}>
                <s.icon className={`w-6 h-6 ${s.fg}`} />
              </div>
              <div>
                <p className="text-muted-foreground text-sm">{s.label}</p>
                <p className="text-xl font-bold">{s.value}</p>
                <p className="text-xs text-muted-foreground">{s.sub}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-success" />
              الفواتير المقفولة والتحصيل
            </CardTitle>
            <CardDescription>
              {data.invoicesCount} فاتورة — إجمالي {egp(data.invoicesTotal)} — مطابق {data.invoiceMatched} من {data.invoiceOrders}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.invoices.length === 0 ? (
              <p className="text-center text-muted-foreground py-10">لا توجد فواتير في هذه الفترة</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">الفاتورة</TableHead>
                    <TableHead className="text-xs">التاريخ</TableHead>
                    <TableHead className="text-xs">الطلبات</TableHead>
                    <TableHead className="text-xs">الحالة</TableHead>
                    <TableHead className="text-xs text-left">الإجمالي</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.invoices.slice(0, 15).map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell className="font-mono text-xs">#{inv.invoice_no}</TableCell>
                      <TableCell className="text-xs">
                        {new Date(inv.first_seen_at).toLocaleDateString("ar-EG", { day: "numeric", month: "short" })}
                      </TableCell>
                      <TableCell className="text-xs">{inv.orders_count}</TableCell>
                      <TableCell className="text-xs">
                        {inv.orders_missing > 0 ? (
                          <Badge variant="destructive" className="text-[10px]">{inv.orders_missing} مفقود</Badge>
                        ) : (
                          <Badge className="bg-success text-[10px]">مطابقة كاملة</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-left font-semibold">{egp(Number(inv.total_amount))}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-destructive" />
              بوالص على زودكس غير مسجلة عندنا
            </CardTitle>
            <CardDescription>
              {data.missingCount} بوليصة بقيمة {egp(data.missingValue)} — تحتاج تسجيل أو ربط
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.missingOrders.length === 0 ? (
              <p className="text-center text-muted-foreground py-10">كل البوالص مرتبطة بطلبات ✅</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">بوليصة</TableHead>
                    <TableHead className="text-xs">العميل</TableHead>
                    <TableHead className="text-xs">الموظفة</TableHead>
                    <TableHead className="text-xs">الحالة</TableHead>
                    <TableHead className="text-xs text-left">المبلغ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.missingOrders.slice(0, 15).map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="font-mono text-xs">{m.bill_no}</TableCell>
                      <TableCell className="text-xs">{m.customer_name || "—"}</TableCell>
                      <TableCell className="text-xs">{m.moderator_name || "—"}</TableCell>
                      <TableCell className="text-xs">{m.zodex_status || "—"}</TableCell>
                      <TableCell className="text-xs text-left">{egp(Number(m.cod_amount))}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-muted-foreground">
        {data.lastRun?.started_at
          ? `آخر مزامنة زودكس: ${new Date(data.lastRun.started_at).toLocaleString("ar-EG")} — ${
              data.lastRun.status === "success" ? "ناجحة" : "غير مكتملة"
            }`
          : "لم تُسجّل أي مزامنة زودكس بعد"}
        {" · "}التقرير يتحدث تلقائيًا فور تغيّر البيانات.
      </p>
    </div>
  );
}
