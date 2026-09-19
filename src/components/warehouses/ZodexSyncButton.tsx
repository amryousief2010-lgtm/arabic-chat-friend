import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  RefreshCw, Loader2, Package, Truck, Warehouse, Clock, AlertCircle, ListChecks, CheckCircle2, AlertTriangle,
} from "lucide-react";
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

const fmt = (v?: string | null) =>
  v ? new Date(v).toLocaleString("ar-EG", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

interface RunSummary {
  mode: "quick" | "full";
  complete: boolean;
  window_from: string | null;
  window_to: string | null;
  pages: number;
  bills: number;
  orders_compared: number;
  matched: number;
  unmatched: number;
  unresolved: number;
}

export function ZodexSyncButton() {
  const [loading, setLoading] = useState<null | "quick" | "full">(null);
  const [missingCount, setMissingCount] = useState(0);
  const [pipeline, setPipeline] = useState<PipelineCounts | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [lastSuccessAt, setLastSuccessAt] = useState<string | null>(null);
  const [summary, setSummary] = useState<RunSummary | null>(null);

  const loadStatus = async () => {
    const [{ count }, { data: lastRun }, { data: state }] = await Promise.all([
      supabase.from("zodex_missing_orders").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("zodex_sync_runs").select("pipeline_counts, finished_at")
        .eq("status", "success").order("finished_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("zodex_sync_state").select("last_successful_zodex_sync_at").eq("id", true).maybeSingle(),
    ]);
    setMissingCount(count || 0);
    setPipeline((lastRun?.pipeline_counts as PipelineCounts) || null);
    setLastSyncAt(lastRun?.finished_at || null);
    setLastSuccessAt((state as any)?.last_successful_zodex_sync_at || null);
  };

  useEffect(() => { loadStatus(); }, []);

  const sync = async (mode: "quick" | "full") => {
    setLoading(mode);
    try {
      // 1) Shipments sync resolves the incremental window and links waybills.
      const { data: shipData, error: shipErr } = await supabase.functions.invoke("sync-zodex-shipments", {
        body: mode === "full" ? { mode: "full", full_days: 30, max_pages: 20 } : { mode: "quick" },
      });
      if (shipErr) throw shipErr;
      const s = shipData?.stats || {};

      // 2) Deliveries sync reconciles closed rows over the same period.
      let delivered = 0, returned = 0, missingCreated = 0;
      try {
        const { data: delData } = await supabase.functions.invoke("sync-zodex-deliveries", {
          body: { mode, window_from: s.window_from, window_to: s.window_to, max_pages: mode === "full" ? 10 : 5 },
        });
        delivered = delData?.delivered_matched || 0;
        returned = delData?.returned_matched || 0;
        missingCreated = delData?.missing_created || 0;
      } catch (e) {
        console.warn("deliveries sync warning", e);
      }

      setSummary({
        mode: s.sync_mode === "full" ? "full" : "quick",
        complete: !!s.complete,
        window_from: s.window_from || null,
        window_to: s.window_to || null,
        pages: Number(s.pages_fetched || 0),
        bills: Number(s.bills_fetched ?? s.total_rows ?? 0),
        orders_compared: Number(s.orders_compared || 0),
        matched: Number(s.linked || 0) + Number(s.already_linked || 0) + delivered,
        unmatched: Number(s.no_matching_order || 0) + missingCreated,
        unresolved: Number(s.unresolved || 0),
      });

      if (s.complete) {
        toast.success(
          `تمت المزامنة (${mode === "full" ? "شاملة" : "سريعة"}): ${s.bills_fetched || 0} بوليصة • ${s.linked || 0} ربط جديد • ${delivered} تسليم • ${returned + (s.returns_marked || 0)} مرتجع`,
        );
      } else {
        toast.warning("المزامنة غير مكتملة — لم يتم تحديث وقت آخر مزامنة ناجحة.");
      }
      loadStatus();
    } catch (e: any) {
      setSummary(null);
      toast.error(`فشلت المزامنة: ${e.message || e}`);
    } finally {
      setLoading(null);
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
        <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => sync("quick")} disabled={!!loading}>
          {loading === "quick" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          مزامنة سريعة
        </Button>
        <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => sync("full")} disabled={!!loading}>
          {loading === "full" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ListChecks className="h-3.5 w-3.5" />}
          مراجعة شاملة
        </Button>
        <span className="text-[11px] text-muted-foreground">
          آخر مزامنة ناجحة: {fmt(lastSuccessAt || lastSyncAt)} — تلقائي كل 15 دقيقة
        </span>
        {missingCount > 0 && (
          <Button asChild size="sm" variant="destructive" className="h-8">
            <Link to="/modules/warehouses/zodex-review">{missingCount} فرق للمراجعة</Link>
          </Button>
        )}
        <Button asChild size="sm" variant="outline" className="h-8 gap-1">
          <Link to="/modules/warehouses/zodex-review">
            <AlertCircle className="h-3.5 w-3.5" />
            مراجعة زودكس
          </Link>
        </Button>
      </div>

      {summary && (
        <div className={`rounded-lg border p-2 text-xs ${summary.complete ? "bg-emerald-50/60 border-emerald-200" : "bg-amber-50/60 border-amber-200"}`}>
          <div className="flex items-center gap-1.5 font-semibold mb-1.5">
            {summary.complete
              ? <><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> ملخص المزامنة — {summary.mode === "full" ? "مراجعة شاملة" : "مزامنة سريعة"}</>
              : <><AlertTriangle className="h-3.5 w-3.5 text-amber-600" /> المزامنة غير مكتملة — {summary.mode === "full" ? "مراجعة شاملة" : "مزامنة سريعة"}</>}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1">
            <div>الفترة المراجَعة: <b>{fmt(summary.window_from)} ← {fmt(summary.window_to)}</b></div>
            <div>صفحات زودكس: <b>{summary.pages}</b></div>
            <div>بوالص مجلوبة: <b>{summary.bills}</b></div>
            <div>طلبات تمت مقارنتها: <b>{summary.orders_compared}</b></div>
            <div>متطابق: <b>{summary.matched}</b></div>
            <div>غير متطابق: <b>{summary.unmatched}</b></div>
            <div>تعذّر فحصها: <b>{summary.unresolved}</b></div>
            <div>آخر مزامنة ناجحة: <b>{fmt(lastSuccessAt)}</b></div>
          </div>
        </div>
      )}

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
