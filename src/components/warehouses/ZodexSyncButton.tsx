import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";

export function ZodexSyncButton() {
  const [loading, setLoading] = useState(false);
  const [missingCount, setMissingCount] = useState(0);

  const loadMissingCount = async () => {
    const { count } = await supabase
      .from("zodex_missing_orders")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");
    setMissingCount(count || 0);
  };

  useEffect(() => { loadMissingCount(); }, []);

  const sync = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("sync-zodex-deliveries", {
        body: { lookback_days: 14, max_pages: 5 },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "فشلت المزامنة");
      toast.success(
        `تمت المزامنة: ${data.delivered_matched} تسليم • ${data.returned_matched} مرتجع • ${data.missing_created} مفقود`,
      );
      loadMissingCount();
    } catch (e: any) {
      toast.error(`فشلت المزامنة: ${e.message || e}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="outline" className="h-8 gap-1" onClick={sync} disabled={loading}>
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        مزامنة زودكس
      </Button>
      {missingCount > 0 && (
        <Button asChild size="sm" variant="destructive" className="h-8">
          <Link to="/modules/warehouses/zodex-missing">
            {missingCount} أوردر مفقود
          </Link>
        </Button>
      )}
    </div>
  );
}
