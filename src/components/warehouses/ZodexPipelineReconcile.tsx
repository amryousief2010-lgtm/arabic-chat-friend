import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

// Keys we consider "closed" on Mega side — everything else counts as in-progress.
const CLOSED_KEYWORDS = ["تسليم ناجح", "مرتجع", "مسترجع", "ملغ", "مقفول", "closed", "delivered", "returned"];

function isClosedStatus(key: string): boolean {
  const k = (key || "").trim();
  return CLOSED_KEYWORDS.some((w) => k.includes(w));
}

interface Props {
  localInFlightCount: number;
  localBreakdown?: { warehouse: number; withCourier: number };
}

export function ZodexPipelineReconcile({ localInFlightCount, localBreakdown }: Props) {
  const [loading, setLoading] = useState(true);
  const [pipelineCounts, setPipelineCounts] = useState<Record<string, { count: number; total: number }> | null>(null);
  const [finishedAt, setFinishedAt] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("zodex_sync_runs")
      .select("pipeline_counts, finished_at")
      .eq("status", "success")
      .not("pipeline_counts", "is", null)
      .order("finished_at", { ascending: false })
      .limit(1);
    const row = (data || [])[0] as any;
    setPipelineCounts(row?.pipeline_counts || null);
    setFinishedAt(row?.finished_at || null);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const int = setInterval(load, 60_000);
    return () => clearInterval(int);
  }, []);

  const triggerSync = async () => {
    setSyncing(true);
    try {
      await supabase.functions.invoke("sync-zodex-deliveries", { body: { trigger_source: "reconcile_banner" } });
      await load();
    } finally {
      setSyncing(false);
    }
  };

  const entries = pipelineCounts ? Object.entries(pipelineCounts) : [];
  const inProgress = entries.filter(([k]) => !isClosedStatus(k));
  const megaInFlight = inProgress.reduce((s, [, v]) => s + Number(v.count || 0), 0);
  const diff = megaInFlight - localInFlightCount;
  const match = diff === 0;

  return (
    <Card className={`border-2 ${match ? "border-emerald-300 bg-emerald-50/40" : "border-amber-300 bg-amber-50/40"}`}>
      <CardContent className="p-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : match ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-700" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-amber-700" />
            )}
            <span className="text-sm font-bold">
              مطابقة ميجا (قيد التشغيل):
            </span>
            <Badge variant="outline" className="text-xs bg-white">
              على ميجا: <b className="mx-1">{pipelineCounts ? megaInFlight : "—"}</b>
            </Badge>
            <Badge variant="outline" className="text-xs bg-white">
              عندنا: <b className="mx-1">{localInFlightCount}</b>
            </Badge>
            {pipelineCounts && (
              <Badge className={`text-xs ${match ? "bg-emerald-600" : "bg-amber-600"} text-white`}>
                {match ? "مطابق" : diff > 0 ? `ناقص عندنا ${diff}` : `زايد عندنا ${Math.abs(diff)}`}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs">
            {finishedAt && (
              <span className="text-muted-foreground">
                آخر مزامنة: {new Date(finishedAt).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
            <Button size="sm" variant="ghost" className="h-7" onClick={triggerSync} disabled={syncing}>
              {syncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              <span className="mr-1">مزامنة الآن</span>
            </Button>
          </div>
        </div>

        {pipelineCounts && inProgress.length > 0 && (
          <div className="mt-2 flex items-center gap-1.5 flex-wrap">
            {inProgress
              .sort((a, b) => Number(b[1].count || 0) - Number(a[1].count || 0))
              .map(([k, v]) => (
                <Badge key={k} variant="secondary" className="text-[10px] font-normal">
                  {k}: <b className="mx-1">{v.count}</b>
                </Badge>
              ))}
          </div>
        )}
        {!loading && !pipelineCounts && (
          <div className="mt-2 text-xs text-muted-foreground">
            لسه مفيش نتيجة مزامنة ناجحة. اضغط «مزامنة الآن» عشان نجيب أعداد الشحنات من ميجا.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
