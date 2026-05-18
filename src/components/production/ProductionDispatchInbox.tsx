import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Inbox, RefreshCw, CheckCircle2, Play, X } from "lucide-react";
import { toast } from "sonner";
import { formatDate } from "@/lib/dateFormat";
import { useAuth } from "@/hooks/useAuth";

interface Props {
  destination: "slaughterhouse" | "meat_factory";
  title?: string;
}

interface DispatchOrder {
  id: string;
  product_name: string;
  unit: string;
  required_qty: number;
  current_stock: number;
  pending_qty: number;
  priority: "critical" | "high" | "medium" | "low";
  status: "new" | "accepted" | "in_progress" | "completed" | "cancelled";
  affected_orders: any[];
  notes: string | null;
  created_at: string;
  created_by_name: string | null;
}

const priorityBadge = (p: DispatchOrder["priority"]) => {
  const map: Record<string, { label: string; variant: any }> = {
    critical: { label: "حرجة جدًا", variant: "destructive" },
    high: { label: "عالية", variant: "destructive" },
    medium: { label: "متوسطة", variant: "warning" },
    low: { label: "منخفضة", variant: "secondary" },
  };
  return <Badge variant={map[p].variant}>{map[p].label}</Badge>;
};

const statusLabel: Record<DispatchOrder["status"], string> = {
  new: "جديد", accepted: "مقبول", in_progress: "قيد التنفيذ", completed: "مكتمل", cancelled: "ملغي",
};

export const ProductionDispatchInbox = ({ destination, title }: Props) => {
  const { profile } = useAuth();
  const [rows, setRows] = useState<DispatchOrder[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("production_dispatch_orders")
      .select("*")
      .eq("destination", destination)
      .in("status", ["new", "accepted", "in_progress"])
      .order("created_at", { ascending: false });
    if (error) {
      console.error(error);
      toast.error("تعذر تحميل أوامر الإنتاج الواردة");
    } else {
      setRows(data || []);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [destination]);

  const update = async (id: string, status: DispatchOrder["status"]) => {
    const patch: any = { status };
    if (status === "accepted") { patch.accepted_by = profile?.id ?? null; patch.accepted_at = new Date().toISOString(); }
    if (status === "completed") { patch.completed_by = profile?.id ?? null; patch.completed_at = new Date().toISOString(); }
    const { error } = await (supabase as any)
      .from("production_dispatch_orders")
      .update(patch)
      .eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("تم التحديث");
    load();
  };

  return (
    <Card className="border-primary/30">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Inbox className="w-5 h-5 text-primary" />
          {title || "أوامر إنتاج واردة من المبيعات"}
          {rows.length > 0 && <Badge variant="destructive">{rows.length}</Badge>}
        </CardTitle>
        <Button variant="outline" size="icon" onClick={load} disabled={loading}>
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-center py-6 text-sm text-muted-foreground">جاري التحميل...</div>
        ) : rows.length === 0 ? (
          <div className="text-center py-6 text-sm text-muted-foreground">لا توجد أوامر إنتاج واردة حاليًا</div>
        ) : (
          <div className="space-y-3">
            {rows.map(r => (
              <div key={r.id} className="border rounded-lg p-3 bg-card">
                <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                  <div>
                    <div className="font-semibold">{r.product_name}</div>
                    <div className="text-xs text-muted-foreground">
                      مطلوب: <strong className="text-destructive">{r.required_qty} {r.unit}</strong>
                      {" · "}مخزون وقت الإرسال: {r.current_stock} {r.unit}
                      {" · "}طلبات معلقة: {r.pending_qty} {r.unit}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      أُرسل بواسطة {r.created_by_name || "—"} في {formatDate(r.created_at)}
                    </div>
                    {r.notes && <div className="text-xs mt-1">📝 {r.notes}</div>}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {priorityBadge(r.priority)}
                    <Badge variant="outline">{statusLabel[r.status]}</Badge>
                  </div>
                </div>
                {Array.isArray(r.affected_orders) && r.affected_orders.length > 0 && (
                  <div className="text-xs text-muted-foreground mb-2">
                    الطلبات المرتبطة ({r.affected_orders.length}):{" "}
                    {r.affected_orders.slice(0, 5).map((o: any) => o.order_number).join("، ")}
                    {r.affected_orders.length > 5 && ` +${r.affected_orders.length - 5}`}
                  </div>
                )}
                <div className="flex gap-2 flex-wrap">
                  {r.status === "new" && (
                    <Button size="sm" variant="default" onClick={() => update(r.id, "accepted")}>
                      <CheckCircle2 className="w-4 h-4 ml-1" /> قبول
                    </Button>
                  )}
                  {(r.status === "new" || r.status === "accepted") && (
                    <Button size="sm" variant="outline" onClick={() => update(r.id, "in_progress")}>
                      <Play className="w-4 h-4 ml-1" /> بدء التنفيذ
                    </Button>
                  )}
                  {r.status !== "completed" && (
                    <Button size="sm" variant="outline" className="text-success" onClick={() => update(r.id, "completed")}>
                      <CheckCircle2 className="w-4 h-4 ml-1" /> إكمال
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => update(r.id, "cancelled")}>
                    <X className="w-4 h-4 ml-1" /> إلغاء
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default ProductionDispatchInbox;
