import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  approximateRoas,
  fetchMetaAdsSection,
  META_ADS_ACCOUNT_ID,
  type DateRange,
  type SocialAdsCampaignSnapshot,
} from "@/lib/socialMediaAnalytics";
import { Info, Loader2, Megaphone } from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const fmt = (n: number) => n.toLocaleString("ar-EG", { maximumFractionDigits: 0 });
const fmtMoney = (n: number) =>
  `${n.toLocaleString("ar-EG", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ج.م`;
const fmtMaybe = (n: number | null | undefined, digits = 0) => {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("ar-EG", { maximumFractionDigits: digits });
};
const fmtRoas = (value: number | null) =>
  value === null ? "—" : value.toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function statusLabel(status: string | null): string {
  const key = (status || "").trim().toLowerCase();
  if (key === "active") return "نشطة";
  if (key === "inactive") return "متوقفة";
  return status || "—";
}

export function MetaAdsMtdSection({ range }: { range: DateRange }) {
  const query = useQuery({
    queryKey: ["mkt-ads-mtd", range.from, range.to],
    queryFn: () => fetchMetaAdsSection(range),
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const data = query.data;
  const roas = data ? approximateRoas(data.sales.netSales, data.rollup.spend) : null;
  const showPeriodNote = !!data && data.rollup.mode !== "none" && (
    data.rollup.periods.length !== 1
    || data.rollup.periods[0].start !== data.fromDate
    || data.rollup.periods[0].end !== data.toDate
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base md:text-lg">
          <Megaphone className="h-5 w-5 text-purple-600" />
          إعلانات Meta / Ads MTD
          {query.isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>ROAS تقريبي</AlertTitle>
          <AlertDescription>
            ROAS تقريبي — مش attribution دقيق. الدمج عبر orders.source (مجموعة السوشيال) مقابل إنفاق الحساب {META_ADS_ACCOUNT_ID}. Reach غير deduped.
          </AlertDescription>
        </Alert>

        {query.isLoading && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        )}

        {query.isError && (
          <Alert className="border-red-300">
            <AlertTitle>تعذر تحميل قسم الإعلانات</AlertTitle>
            <AlertDescription>باقي لوحة التسويق تفضل شغالة. أعد فتح الصفحة لو استمر الخطأ.</AlertDescription>
          </Alert>
        )}

        {data && (
          <>
            {(data.weeklyError || data.ordersError || data.campaignError || data.dailyError) && (
              <Alert className="border-amber-500 bg-amber-50">
                <AlertTitle className="text-amber-800">جزء من بيانات الإعلانات لم يتحمّل</AlertTitle>
                <AlertDescription className="text-amber-800">
                  {data.weeklyError && <div>لقطات الإنفاق: {data.weeklyError}</div>}
                  {data.ordersError && <div>مبيعات السوشيال: {data.ordersError}</div>}
                  {data.campaignError && <div>الحملات: {data.campaignError}</div>}
                  {data.dailyError && <div>اللقطات اليومية: {data.dailyError}</div>}
                </AlertDescription>
              </Alert>
            )}

            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>الحساب {META_ADS_ACCOUNT_ID}</span>
              <span>·</span>
              <span>فلتر المبيعات: {data.fromDate} → {data.toDate}</span>
              <span>·</span>
              <span>فترة الإنفاق: {data.rollup.periodLabel}</span>
              {data.rollup.currency && <Badge variant="outline">{data.rollup.currency}</Badge>}
            </div>
            {showPeriodNote && (
              <p className="text-xs text-muted-foreground">
                لقطة الإنفاق مش مقصوصة على يوم اليوم. لو فيه أكتر من فترة متداخلة بنختار الصف اللي يغطي الفترة أو نجمع الفترات غير المتداخلة فقط.
              </p>
            )}
            {data.rollup.mode === "none" && !data.weeklyError && (
              <p className="text-sm text-muted-foreground">لا توجد لقطة إنفاق متداخلة مع الفترة المختارة.</p>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <MiniKpi title="إنفاق الإعلانات" value={fmtMoney(data.rollup.spend)} />
              <MiniKpi title="الظهور" value={fmt(data.rollup.impressions)} />
              <MiniKpi title="نتائج المراسلة" value={fmtMaybe(data.rollup.messagingResults)} />
              <MiniKpi title="مشتريات Meta" value={fmtMaybe(data.rollup.metaPurchases)} />
              <MiniKpi title="نقرات الرابط" value={fmt(data.rollup.linkClicks)} />
              <MiniKpi title="صافي مبيعات السوشيال" value={fmtMoney(data.sales.netSales)} />
              <MiniKpi
                title="طلبات السوشيال (بدون الملغي)"
                value={fmt(data.sales.orderCount)}
                sub={data.sales.giftOrdersExcludedFromRevenue > 0
                  ? `بدون ${fmt(data.sales.giftOrdersExcludedFromRevenue)} هدية من الصافي`
                  : undefined}
              />
              <MiniKpi title="ROAS تقريبي" value={fmtRoas(roas)} sub="صافي السوشيال ÷ الإنفاق" />
            </div>

            <div>
              <div className="font-semibold mb-2">الحملات</div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الحملة</TableHead>
                      <TableHead>الحالة</TableHead>
                      <TableHead className="text-center">الإنفاق</TableHead>
                      <TableHead className="text-center">الظهور</TableHead>
                      <TableHead className="text-center">نتائج المراسلة</TableHead>
                      <TableHead className="text-center">نوع النتيجة</TableHead>
                      <TableHead className="text-center">تكلفة النتيجة</TableHead>
                      <TableHead className="text-center">نقرات الرابط</TableHead>
                      <TableHead className="text-center">مشتريات Meta</TableHead>
                      <TableHead className="text-center">الوصول</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.campaigns.map((row) => (
                      <CampaignRow key={row.id || `${row.campaign_name}-${row.period_start}-${row.spend_egp}`} row={row} />
                    ))}
                    {data.campaigns.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={10} className="text-center text-muted-foreground">
                          لا توجد حملات في الفترة
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div>
              <div className="font-semibold mb-2">الإنفاق اليومي مقابل صافي مبيعات السوشيال</div>
              {data.daily.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  {data.dailyError
                    ? "تعذر تحميل اللقطات اليومية."
                    : "لم تُستورد لقطات يومية بعد — بوت السوشيال هيرفع JSON قريبًا"}
                </p>
              ) : (
                <div style={{ height: 300 }}>
                  <ResponsiveContainer>
                    <LineChart data={data.series}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                      <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
                      <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} />
                      <Tooltip formatter={(value: number, name: string) => [fmtMoney(Number(value) || 0), name]} />
                      <Legend />
                      <Line yAxisId="left" type="monotone" dataKey="ads_spend" stroke="#f97316" name="إنفاق الإعلانات" dot={false} isAnimationActive={false} />
                      <Line yAxisId="right" type="monotone" dataKey="social_net_sales" stroke="#8b5cf6" name="صافي مبيعات السوشيال" dot={false} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function MiniKpi({ title, value, sub }: { title: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border p-3 bg-muted/30">
      <div className="text-xs text-muted-foreground">{title}</div>
      <div className="text-lg font-bold mt-1 break-words">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

function CampaignRow({ row }: { row: SocialAdsCampaignSnapshot }) {
  return (
    <TableRow>
      <TableCell className="font-medium whitespace-nowrap">{row.campaign_name || "—"}</TableCell>
      <TableCell className="whitespace-nowrap">{statusLabel(row.status)}</TableCell>
      <TableCell className="text-center whitespace-nowrap">{fmtMoney(Number(row.spend_egp || 0))}</TableCell>
      <TableCell className="text-center">{fmtMaybe(row.impressions)}</TableCell>
      <TableCell className="text-center">{fmtMaybe(row.results)}</TableCell>
      <TableCell className="text-center whitespace-nowrap">{row.result_type || "—"}</TableCell>
      <TableCell className="text-center">{fmtMaybe(row.cost_per_result, 2)}</TableCell>
      <TableCell className="text-center">{fmtMaybe(row.link_clicks)}</TableCell>
      <TableCell className="text-center">{fmtMaybe(row.purchases)}</TableCell>
      <TableCell className="text-center">{fmtMaybe(row.reach)}</TableCell>
    </TableRow>
  );
}
