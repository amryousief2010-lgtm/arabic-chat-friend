import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { PieChart, Package } from "lucide-react";
import { cairoMonthStartUTC, cairoYearStartUTC, currentCairoYearMonth } from "@/lib/cairoDate";

type RangeKey = "month" | "year" | "all";

const RANGES: { value: RangeKey; label: string }[] = [
  { value: "month", label: "هذا الشهر" },
  { value: "year", label: "هذه السنة" },
  { value: "all", label: "كل الفترات" },
];

interface SourceRow {
  source: string;
  count: number;
}

const PAGE = 1000;

const OrdersBySourceCard = () => {
  const queryClient = useQueryClient();
  const [range, setRange] = useState<RangeKey>("month");

  const { data, isLoading } = useQuery({
    queryKey: ["orders-by-source", range],
    staleTime: 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
    queryFn: async (): Promise<{ total: number; rows: SourceRow[] }> => {
      const cur = currentCairoYearMonth();
      let from: string | null = null;
      if (range === "month") from = cairoMonthStartUTC(cur.year, cur.monthIndex0).toISOString();
      if (range === "year") from = cairoYearStartUTC(cur.year).toISOString();

      let all: any[] = [];
      let page = 0;
      while (true) {
        let q = supabase.from("orders").select("source").range(page * PAGE, (page + 1) * PAGE - 1);
        if (from) q = q.gte("created_at", from);
        const { data: chunk, error } = await q;
        if (error) throw error;
        all = all.concat(chunk || []);
        if (!chunk || chunk.length < PAGE) break;
        page++;
      }

      const map = new Map<string, number>();
      for (const o of all) {
        const key = (o.source || "").trim() || "غير محدد";
        map.set(key, (map.get(key) || 0) + 1);
      }
      const rows = Array.from(map.entries())
        .map(([source, count]) => ({ source, count }))
        .sort((a, b) => b.count - a.count);

      return { total: all.length, rows };
    },
  });

  // تحديث مباشر عند تسجيل أوردر جديد أو تعديل مصدره
  useEffect(() => {
    const channel = supabase
      .channel("orders-by-source-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => {
        queryClient.invalidateQueries({ queryKey: ["orders-by-source"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const total = data?.total || 0;

  return (
    <Card className="glass-card mb-6">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <PieChart className="w-5 h-5 text-primary" />
            الطلبات حسب مصدر العميل
          </CardTitle>
          <Select value={range} onValueChange={(v) => setRange(v as RangeKey)}>
            <SelectTrigger className="w-36 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {RANGES.map((r) => (
                <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-lg bg-primary/10 px-3 py-2.5">
              <span className="flex items-center gap-2 font-semibold text-primary">
                <Package className="w-4 h-4" />
                إجمالي عدد الأوردرات
              </span>
              <span className="text-xl font-bold text-primary">{total.toLocaleString()}</span>
            </div>

            {data?.rows.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">لا توجد طلبات في هذه الفترة</p>
            )}

            {data?.rows.map((r) => {
              const pct = total > 0 ? Math.round((r.count / total) * 1000) / 10 : 0;
              return (
                <div key={r.source} className="rounded-lg bg-muted/50 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium truncate">{r.source}</span>
                    <span className="text-sm font-bold tabular-nums">
                      {r.count.toLocaleString()}
                      <span className="text-xs text-muted-foreground font-normal mr-1">({pct}%)</span>
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full rounded-full bg-background overflow-hidden">
                    <div className="h-full rounded-full bg-primary/70" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default OrdersBySourceCard;
