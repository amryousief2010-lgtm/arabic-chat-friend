import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

const SESSION_KEY = "dup_order_approvals_dismissed";

type Row = {
  id: string;
  created_at: string;
  requested_by: string;
  note: string | null;
  customer_id: string;
};

/**
 * تنبيه فوري لم. آلاء (مديرة التسويق) بأي طلبات موافقة على أوردرات مكررة
 * معلّقة، يظهر تلقائياً أول ما تفتح التطبيق.
 */
export default function DuplicateApprovalsAlert() {
  const { roles, isGeneralManager } = useAuth();
  const navigate = useNavigate();
  const canApprove = (roles || []).includes("marketing_sales_manager") || isGeneralManager;
  const [rows, setRows] = useState<Row[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    if (!canApprove) return;
    const { data } = await supabase
      .from("duplicate_order_approvals")
      .select("id, created_at, requested_by, note, customer_id")
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });
    const list = (data || []) as Row[];
    setRows(list);
    if (list.length > 0) {
      const ids = Array.from(new Set(list.map((r) => r.requested_by).filter(Boolean)));
      const { data: profs } = await supabase.from("profile_directory").select("id, full_name").in("id", ids);
      setNames(Object.fromEntries((profs || []).map((p: any) => [p.id, p.full_name])));
      if (sessionStorage.getItem(SESSION_KEY) !== "1") setOpen(true);
    }
  }, [canApprove]);

  useEffect(() => {
    load();
    if (!canApprove) return;
    const ch = supabase
      .channel("dup-approvals-alert")
      .on("postgres_changes", { event: "*", schema: "public", table: "duplicate_order_approvals" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [canApprove, load]);

  if (!canApprove || rows.length === 0) return null;

  const dismiss = () => {
    sessionStorage.setItem(SESSION_KEY, "1");
    setOpen(false);
  };

  return (
    <>
      {/* زر عائم يفضل ظاهر طول ما في طلبات معلّقة */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-24 md:bottom-6 start-4 z-50 flex items-center gap-2 rounded-full bg-destructive px-4 py-2 text-destructive-foreground shadow-lg animate-pulse"
      >
        <ShieldAlert className="h-4 w-4" />
        <span className="text-sm font-bold">طلبات أوردرات مكررة ({rows.length})</span>
      </button>

      <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : dismiss())}>
        <DialogContent className="max-w-lg" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-destructive" />
              طلبات موافقة على أوردرات مكررة
            </DialogTitle>
            <DialogDescription>
              في {rows.length} طلب بانتظار موافقتك (موافقتك وحدها كافية لتسجيل الأوردر).
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-72 space-y-2 overflow-auto">
            {rows.slice(0, 8).map((r) => (
              <div key={r.id} className="rounded-md border bg-amber-50 p-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{names[r.requested_by] || "موظفة"}</span>
                  <Badge variant="secondary">
                    {new Date(r.created_at).toLocaleString("ar-EG", { timeZone: "Africa/Cairo", dateStyle: "short", timeStyle: "short" })}
                  </Badge>
                </div>
                {r.note && <div className="text-xs text-muted-foreground mt-1">{r.note}</div>}
              </div>
            ))}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={dismiss}>لاحقاً</Button>
            <Button onClick={() => { setOpen(false); navigate("/duplicate-order-approvals"); }}>
              مراجعة الطلبات الآن
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
