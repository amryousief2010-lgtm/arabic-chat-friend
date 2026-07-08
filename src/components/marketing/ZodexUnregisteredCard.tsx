import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw, ExternalLink, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

interface Failure {
  bill_no: string;
  phones: string[];
  cod: number;
  reason: string;
}

/**
 * يعرض البوالص اللي اتسجلت على زودكس بس ملهاش أوردر مطابق عندنا
 * (reason = no_matching_phone من آخر مزامنة ناجحة).
 */
export function ZodexUnregisteredCard() {
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [items, setItems] = useState<Failure[]>([]);
  const [lastSync, setLastSync] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("zodex_sync_runs")
      .select("summary, started_at")
      .in("status", ["success", "completed_with_errors"])
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const failures: Failure[] =
      ((data as any)?.summary?.link_failures || []).filter(
        (f: any) => f.reason === "no_matching_phone",
      );
    setItems(failures);
    setLastSync((data as any)?.started_at || null);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const runSync = async () => {
    setSyncing(true);
    try {
      const { error } = await supabase.functions.invoke("sync-zodex-shipments", {
        body: { max_pages: 3 },
      });
      if (error) throw error;
      toast({ title: "تمت المزامنة", description: "تم تحديث بيانات زودكس." });
      await load();
    } catch (e: any) {
      toast({
        title: "فشل المزامنة",
        description: String(e?.message || e),
        variant: "destructive",
      });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Card className="border-amber-200">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            بوالص على زودكس بدون تسجيل عندنا
            <Badge variant="secondary" className="mr-2">
              {items.length}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={runSync}
              disabled={syncing}
            >
              {syncing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              <span className="ms-1">مزامنة</span>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                window.open("/modules/warehouses/zodex-review", "_blank")
              }
            >
              <ExternalLink className="h-4 w-4" />
              <span className="ms-1">التفاصيل</span>
            </Button>
          </div>
        </CardTitle>
        {lastSync && (
          <p className="text-xs text-muted-foreground">
            آخر مزامنة: {new Date(lastSync).toLocaleString("ar-EG")}
          </p>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            جاري التحميل...
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-green-700">
            ممتاز — كل البوالص على زودكس مربوطة بأوردر عندنا.
          </p>
        ) : (
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="text-right text-xs text-muted-foreground border-b">
                <tr>
                  <th className="py-2 px-2">رقم البوليصة</th>
                  <th className="py-2 px-2">موبايل العميل</th>
                  <th className="py-2 px-2">قيمة التحصيل</th>
                </tr>
              </thead>
              <tbody>
                {items.map((f) => (
                  <tr key={f.bill_no} className="border-b hover:bg-amber-50">
                    <td className="py-2 px-2 font-mono">{f.bill_no}</td>
                    <td className="py-2 px-2">
                      {(f.phones || []).map((p) => (
                        <div key={p} dir="ltr" className="text-start">
                          {p}
                        </div>
                      ))}
                    </td>
                    <td className="py-2 px-2">
                      {Number(f.cod || 0).toLocaleString("ar-EG")} ج.م
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-muted-foreground">
              دي بوالص الموظف سجّلها على زودكس بس مفيش أوردر بنفس رقم الموبايل
              عندنا. راجع صفحة «أوردرات زودكس غير مكتملة» للربط اليدوي.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
