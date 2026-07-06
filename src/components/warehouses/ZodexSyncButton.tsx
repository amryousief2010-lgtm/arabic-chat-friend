import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw, Loader2, Package, Truck, Warehouse, Clock } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";

type PipelineCounts = Record<string, { count: number; total: number }>;

const STATUS_META: Record<string, { label: string; icon: any; className: string }> = {
  "تم الاستلام في المخزن": { label: "بالمخزن", icon: Warehouse, className: "bg-blue-50 text-blue-700 border-blue-200" },
  "قيد التوصيل": { label: "قيد التوصيل", icon: Truck, className: "bg-orange-50 text-orange-700 border-orange-200" },
  "شحنة مؤجلة": { label: "مؤجلة", icon: Clock, className: "bg-amber-50 text-amber-700 border-amber-200" },
  "بيك أب": { label: "بيك أب", icon: Package, className: "bg-purple-50 text-purple-700 border-purple-200" },
};

export function ZodexSyncButton() {
  const [loading, setLoading] = useState(false);
  const [missingCount, setMissingCount] = useState(0);
  const [pipeline, setPipeline] = useState<PipelineCounts | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);

  const loadStatus = async () => {
    const [{ count }, { data: lastRun }] = await Promise.all([
      supabase.from("zodex_missing_orders").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("zodex_sync_runs").select("pipeline_counts, finished_at").eq("status", "success")
        .order("finished_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    setMissingCount(count || 0);
    setPipeline((lastRun?.pipeline_counts as PipelineCounts) || null);
    setLastSyncAt(lastRun?.finished_at || null);
  };

  useEffect(() => { loadStatus(); }, []);

  const sync = async () => {
    setLoading(true);
    try {
      // 1) Reconcile delivered / returned invoices (closed rows)
      const { data, error } = await supabase.functions.invoke("sync-zodex-deliveries", {
        body: { lookback_days: 14, max_pages: 5 },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "فشلت المزامنة");

      // 2) Link waybill numbers for pending pickups (open rows on shippings.php)
      let linkedBills = 0;
      try {
        const { data: shipData } = await supabase.functions.invoke("sync-zodex-shipments", {
          body: { max_pages: 5 },
        });
        linkedBills = shipData?.stats?.linked || 0;
      } catch (e) {
        console.warn("shipments sync warning", e);
      }

      toast.success(
        `تمت المزامنة: ${data.delivered_matched} تسليم • ${data.returned_matched} مرتجع • ${linkedBills} بوليصة جديدة • ${data.missing_created} مفقود`,
      );
      loadStatus();
    } catch (e: any) {
      toast.error(`فشلت المزامنة: ${e.message || e}`);
    } finally {
      setLoading(false);
    }
  };

  const pipelineEntries = (pipeline ? Object.entries(pipeline) : [])
    .filter(([, v]) => v && typeof v === "object" && ("count" in v || "total" in v))
    .map(([k, v]) => [k, { count: Number((v as any)?.count ?? 0), total: Number((v as any)?.total ?? 0) }] as const);
  const totalCount = pipelineEntries.reduce((s, [, v]) => s + v.count, 0);
  const totalMoney = pipelineEntries.reduce((s, [, v]) => s + v.total, 0);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" variant="outline" className="h-8 gap-1" onClick={sync} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          مزامنة مخزن العجوزة
        </Button>
        {lastSyncAt && (
          <span className="text-[11px] text-muted-foreground">
            آخر مزامنة: {new Date(lastSyncAt).toLocaleString("ar-EG", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}
          </span>
        )}
        {missingCount > 0 && (
          <Button asChild size="sm" variant="destructive" className="h-8">
            <Link to="/modules/warehouses/zodex-missing">
              {missingCount} أوردر مفقود
            </Link>
          </Button>
        )}
      </div>

      {pipelineEntries.length > 0 && (
        <div className="rounded-lg border bg-card p-2">
          <div className="flex items-center justify-between mb-1.5 px-1">
            <span className="text-xs font-semibold text-muted-foreground">حالة الشحن على مخزن العجوزة</span>
            <span className="text-[11px] text-muted-foreground">
              إجمالى: <b>{totalCount}</b> شحنة • <b>{totalMoney.toLocaleString("ar-EG")}</b> ج
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            {pipelineEntries.map(([status, v]) => {
              const meta = STATUS_META[status] || { label: status, icon: Package, className: "bg-muted text-foreground border-border" };
              const Icon = meta.icon;
              return (
                <div key={status} className={`rounded-md border px-2 py-1.5 ${meta.className}`}>
                  <div className="flex items-center gap-1 text-[11px] opacity-80">
                    <Icon className="h-3 w-3" />
                    {meta.label}
                  </div>
                  <div className="flex items-baseline justify-between mt-0.5">
                    <span className="text-base font-bold leading-none">{v.count}</span>
                    <span className="text-[10px] opacity-70">{v.total.toLocaleString("ar-EG")} ج</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
