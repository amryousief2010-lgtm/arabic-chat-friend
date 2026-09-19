import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertTriangle, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

type Alert = {
  id: string;
  period: string;
  detected_at: string;
  diff_summary: any;
};

export default function DiscrepancyBanner() {
  const { user, roles, isGeneralManager, isExecutiveManager, isSalesManager, isAccountant } = useAuth();
  const [alert, setAlert] = useState<Alert | null>(null);
  const allowed =
    isGeneralManager ||
    isExecutiveManager ||
    isSalesManager ||
    isAccountant ||
    (roles || []).some((x) => ["financial_manager", "marketing_sales_manager"].includes(x));

  useEffect(() => {
    if (!allowed || !user) return;
    const t = window.setTimeout(async () => {
      const { data } = await supabase
        .from("import_discrepancy_alerts")
        .select("id, period, detected_at, diff_summary")
        .eq("is_resolved", false)
        .order("detected_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) setAlert(data as any);
    }, 2000);
    return () => window.clearTimeout(t);
  }, [allowed, user]);

  async function resolve() {
    if (!alert) return;
    const { data: u } = await supabase.auth.getUser();
    await supabase
      .from("import_discrepancy_alerts")
      .update({ is_resolved: true, resolved_at: new Date().toISOString(), resolved_by: u.user?.id })
      .eq("id", alert.id);
    setAlert(null);
  }

  if (!allowed || !alert) return null;
  const d = alert.diff_summary?.differences || {};
  return (
    <Alert variant="destructive" className="mb-4">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle className="flex items-center justify-between">
        <span>⚠️ تباين بين النظام وملف Excel — {alert.period}</span>
        <Button size="sm" variant="ghost" onClick={resolve}><X className="w-4 h-4 ms-1" /> تجاهل</Button>
      </AlertTitle>
      <AlertDescription className="flex flex-wrap items-center gap-3 mt-1">
        <span>فارق الطلبات: <strong>{d.total_rows ?? 0}</strong></span>
        <span>فارق القيمة: <strong>{Math.round(d.total_value || 0).toLocaleString()} ج.م</strong></span>
        <span>فارق المُسلَّمة: <strong>{d.delivered_count ?? 0}</strong></span>
        <Link to="/reports/excel-comparison" className="underline font-semibold">عرض المقارنة التفصيلية ←</Link>
      </AlertDescription>
    </Alert>
  );
}
