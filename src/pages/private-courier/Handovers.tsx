import { useEffect, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Package } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useEligibleOrders } from "@/hooks/usePrivateCourierData";
import { CourierStatusBadge } from "@/components/private-courier/StatusBadge";

interface HandoverRow {
  order_id: string;
  prepared_at: string | null;
  handed_over_at: string | null;
  courier_received_at: string | null;
  checklist_confirmed: boolean;
  notes: string | null;
}

export default function PCHandovers() {
  const { user } = useAuth();
  const { data: orders, loading, refetch } = useEligibleOrders();
  const [handovers, setHandovers] = useState<Record<string, HandoverRow>>({});

  useEffect(() => {
    (async () => {
      const ids = orders.filter(o => o.assigned_route_id).map(o => o.id);
      if (!ids.length) { setHandovers({}); return; }
      const { data } = await (supabase as any).from("pc_handovers").select("*").in("order_id", ids);
      const map: Record<string, HandoverRow> = {};
      (data || []).forEach((h: any) => { map[h.order_id] = h; });
      setHandovers(map);
    })();
  }, [orders]);

  const assigned = orders.filter(o => o.assigned_route_id);

  const update = async (order_id: string, patch: Partial<HandoverRow>) => {
    const existing = handovers[order_id];
    const payload: any = { order_id, ...existing, ...patch };
    delete payload.created_at; delete payload.updated_at; delete payload.id;
    const { error } = await (supabase as any).from("pc_handovers").upsert(payload, { onConflict: "order_id" });
    if (error) { toast.error(error.message); return; }
    setHandovers(h => ({ ...h, [order_id]: { ...existing, ...patch, order_id } as any }));
    toast.success("تم الحفظ");
  };

  const markPrepared = (id: string) => update(id, { prepared_at: new Date().toISOString() } as any);
  const markHandedOver = (id: string) => update(id, { handed_over_at: new Date().toISOString() } as any);

  return (
    <DashboardLayout>
      <div className="container mx-auto p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Package className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">تسليم المخزن للمندوب</h1>
        </div>
        <p className="text-sm text-muted-foreground">يتم هنا تسجيل حالة تجهيز وتسليم الطلبات للمندوب — لا يؤثر على المخزون.</p>

        {loading ? <div className="text-center py-12 text-muted-foreground">جاري التحميل…</div> :
          assigned.length === 0 ? <Card><CardContent className="py-12 text-center text-muted-foreground">لا توجد طلبات معيَّنة</CardContent></Card> :
            <div className="space-y-3">
              {assigned.map(o => {
                const h = handovers[o.id] || {} as HandoverRow;
                return (
                  <Card key={o.id}>
                    <CardContent className="p-3 space-y-2">
                      <div className="flex items-start justify-between flex-wrap gap-2">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-xs">{o.order_number}</span>
                            <CourierStatusBadge status={o.tracking_status} />
                          </div>
                          <p className="font-medium">{o.customer_name} — {o.customer_governorate}</p>
                          <p className="text-xs text-muted-foreground">{o.customer_phone}</p>
                        </div>
                        <div className="text-left text-xs">
                          <p>تم التجهيز: {h.prepared_at ? <Badge variant="outline">{new Date(h.prepared_at).toLocaleString("ar-EG")}</Badge> : "—"}</p>
                          <p>تم التسليم: {h.handed_over_at ? <Badge variant="outline">{new Date(h.handed_over_at).toLocaleString("ar-EG")}</Badge> : "—"}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap text-sm">
                        <label className="flex items-center gap-2">
                          <Checkbox checked={!!h.checklist_confirmed} onCheckedChange={(v) => update(o.id, { checklist_confirmed: !!v } as any)} />
                          <span>تم مراجعة قائمة المنتجات</span>
                        </label>
                        <Button size="sm" variant="outline" onClick={() => markPrepared(o.id)}>تأكيد التجهيز</Button>
                        <Button size="sm" onClick={() => markHandedOver(o.id)}>تأكيد التسليم</Button>
                      </div>
                      <Textarea
                        placeholder="ملاحظات التسليم"
                        defaultValue={h.notes || ""}
                        onBlur={e => { if (e.target.value !== (h.notes || "")) update(o.id, { notes: e.target.value } as any); }}
                        className="text-sm"
                      />
                    </CardContent>
                  </Card>
                );
              })}
            </div>}
      </div>
    </DashboardLayout>
  );
}
