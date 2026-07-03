import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Package } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTopOfferBoxesLast3Days } from "@/hooks/useSalesAnalytics";

type RangeDays = 1 | 3 | 7 | 30;

const RANGE_META: Record<RangeDays, { label: string; qs: string }> = {
  1:  { label: "آخر يوم",     qs: "1d" },
  3:  { label: "آخر 3 أيام",  qs: "3d" },
  7:  { label: "آخر 7 أيام",  qs: "7d" },
  30: { label: "آخر 30 يوم",  qs: "30d" },
};

export default function TopOfferBoxes3DaysCard() {
  const navigate = useNavigate();
  const [days, setDays] = useState<RangeDays>(3);
  const { data, isLoading } = useTopOfferBoxesLast3Days(5, days);

  const openOffer = (name: string) => {
    const qs = new URLSearchParams({ range: RANGE_META[days].qs, offer_name: name });
    navigate(`/orders?${qs.toString()}`);
  };

  return (
    <Card className="glass-card mb-6">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="flex items-center gap-2 text-base">
            <Package className="w-5 h-5 text-primary" />
            بوكسات العروض الأكثر مبيعًا خلال {RANGE_META[days].label}
          </CardTitle>
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v) as RangeDays)}>
            <SelectTrigger className="w-auto min-w-[140px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(RANGE_META) as unknown as RangeDays[]).map((k) => (
                <SelectItem key={k} value={String(k)}>{RANGE_META[k as RangeDays].label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="pt-2">
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : !data || data.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            لا توجد بوكسات مباعة خلال {RANGE_META[days].label}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border/40">
                  <th className="text-right py-2 px-2 font-normal w-10">#</th>
                  <th className="text-right py-2 px-2 font-normal">البوكس</th>
                  <th className="text-right py-2 px-2 font-normal">الأوردرات</th>
                  <th className="text-right py-2 px-2 font-normal">المبيعات</th>
                </tr>
              </thead>
              <tbody>
                {data.map((b, i) => (
                  <tr key={b.offer_name + i} className="border-b border-border/20 hover:bg-muted/30 transition-colors">
                    <td className="py-2 px-2 text-muted-foreground">{i + 1}</td>
                    <td className="py-2 px-2">
                      <button
                        type="button"
                        onClick={() => openOffer(b.offer_name)}
                        className="text-primary hover:underline font-medium text-right"
                      >
                        {b.offer_name}
                      </button>
                    </td>
                    <td className="py-2 px-2">{b.orders_count} أوردر</td>
                    <td className="py-2 px-2 font-semibold text-success">
                      {b.total_sales.toLocaleString()} ج.م
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
