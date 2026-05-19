import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertTriangle, X } from "lucide-react";

type Alert = {
  id: string;
  period: string;
  detected_at: string;
  diff_summary: any;
};

export default function DiscrepancyBanner() {
  const [alert, setAlert] = useState<Alert | null>(null);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", u.user.id);
      const r = (roles || []).map((x: any) => x.role);
      const ok = r.some((x: string) => ["general_manager","executive_manager","sales_manager","accountant","financial_manager","marketing_sales_manager"].includes(x));
      setAllowed(ok);
      if (!ok) return;
      const { data } = await supabase
        .from("import_discrepancy_alerts")
        .select("id, period, detected_at, diff_summary")
        .eq("is_resolved", false)
        .order("detected_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) setAlert(data as any);
    })();
  }, []);

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
