import { useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Truck, Phone, MapPin, Coins, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useMyAssignedOrders, type MyAssignedOrder } from "@/hooks/usePrivateCourierData";
import { CourierStatusBadge } from "@/components/private-courier/StatusBadge";
import {
  COURIER_STATUS_LABEL, COLLECTION_STATUS_LABEL, FAILED_REASON_LABEL, NEXT_ACTION_LABEL,
  type CourierStatus, type CollectionStatus, type FailedReason, type NextAction,
} from "@/lib/privateCourier/constants";

const NEXT_STATUSES: CourierStatus[] = [
  "ready_for_pickup_from_main_warehouse", "picked_up_by_courier",
  "out_for_delivery", "delivered", "returned_to_warehouse",
];

export default function PCMyDeliveries() {
  const { user } = useAuth();
  const { data, loading, refetch } = useMyAssignedOrders();
  const [search, setSearch] = useState("");
  const [collectOpen, setCollectOpen] = useState<MyAssignedOrder | null>(null);
  const [failOpen, setFailOpen] = useState<MyAssignedOrder | null>(null);
  const [collect, setCollect] = useState({ amount: "", status: "cash_collected" as CollectionStatus, notes: "" });
  const [fail, setFail] = useState({ reason: "customer_unavailable" as FailedReason, notes: "", next_action: "reschedule" as NextAction });
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data;
    return data.filter(o =>
      o.order_number?.toLowerCase().includes(q) ||
      o.customer_name?.toLowerCase().includes(q) ||
      o.customer_phone?.toLowerCase().includes(q)
    );
  }, [data, search]);

  const setStatus = async (order: MyAssignedOrder, status: CourierStatus) => {
    const patch: any = { courier_status: status, last_updated_by: user?.id };
    if (status === "delivered") patch.delivered_at = new Date().toISOString();
    const { error } = await (supabase as any).from("pc_order_tracking").update(patch).eq("order_id", order.id);
    if (error) { toast.error(error.message); return; }
    toast.success("تم تحديث الحالة");
    refetch();
  };

  const saveCollection = async () => {
    if (!collectOpen) return;
    const amt = Number(collect.amount || 0);
    if (Number.isNaN(amt)) { toast.error("مبلغ غير صالح"); return; }
    setSaving(true);
    const payload: any = {
      order_id: collectOpen.id,
      amount_due: Number(collectOpen.total || 0),
      amount_collected: amt,
      status: collect.status,
      notes: collect.notes || null,
      collected_at: new Date().toISOString(),
      collected_by: user?.id,
    };
    const { error } = await (supabase as any).from("pc_collections").upsert(payload, { onConflict: "order_id" });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("تم تسجيل التحصيل");
    setCollectOpen(null); refetch();
  };

  const saveFail = async () => {
    if (!failOpen) return;
    if (!fail.notes.trim()) { toast.error("الملاحظات مطلوبة"); return; }
    setSaving(true);
    const { error } = await (supabase as any).from("pc_failed_attempts").insert({
      order_id: failOpen.id, reason: fail.reason, notes: fail.notes, next_action: fail.next_action,
      created_by: user?.id,
    });
    if (!error) {
      await (supabase as any).from("pc_order_tracking").update({
        courier_status: "failed_delivery", last_updated_by: user?.id,
      }).eq("order_id", failOpen.id);
    }
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("تم تسجيل محاولة الفشل");
    setFailOpen(null); refetch();
  };

  return (
    <DashboardLayout>
      <div className="container mx-auto p-4 space-y-3 max-w-3xl">
        <div className="flex items-center gap-2">
          <Truck className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">طلباتي</h1>
        </div>
        <Input placeholder="بحث…" value={search} onChange={e => setSearch(e.target.value)} />

        {loading ? <div className="text-center py-12 text-muted-foreground">جاري التحميل…</div> :
          filtered.length === 0 ? <Card><CardContent className="py-12 text-center text-muted-foreground">لا توجد طلبات مُعيَّنة لك</CardContent></Card> :
            <div className="space-y-3">
              {filtered.map(o => (
                <Card key={o.id} className="border-r-4 border-r-primary">
                  <CardContent className="p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs">{o.order_number}</span>
                          <CourierStatusBadge status={o.tracking_status} />
                          {o.route_name && <Badge variant="outline" className="text-xs">{o.route_name}</Badge>}
                        </div>
                        <p className="font-bold">{o.customer_name}</p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1"><Phone className="h-3 w-3" />
                          <a href={`tel:${o.customer_phone}`} className="underline">{o.customer_phone}</a>
                        </p>
                        <p className="text-xs flex items-center gap-1"><MapPin className="h-3 w-3" />{o.customer_governorate} — {o.delivery_address}</p>
                        {o.notes && <p className="text-xs text-amber-700 bg-amber-50 p-1 rounded">ملاحظات: {o.notes}</p>}
                      </div>
                      <div className="text-left">
                        <p className="text-xl font-bold text-primary">{Number(o.total).toLocaleString("ar-EG")} ج.م</p>
                        <p className="text-xs text-muted-foreground">{o.payment_method}</p>
                        {o.collection_status && <Badge variant="outline" className="text-xs mt-1">{COLLECTION_STATUS_LABEL[o.collection_status]}</Badge>}
                      </div>
                    </div>
                    <div className="flex gap-2 flex-wrap pt-1 border-t">
                      <Select value={o.tracking_status || ""} onValueChange={(v: CourierStatus) => setStatus(o, v)}>
                        <SelectTrigger className="w-44 h-8 text-xs"><SelectValue placeholder="تحديث الحالة" /></SelectTrigger>
                        <SelectContent>
                          {NEXT_STATUSES.map(s => <SelectItem key={s} value={s}>{COURIER_STATUS_LABEL[s]}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Button size="sm" variant="outline" onClick={() => { setCollectOpen(o); setCollect({ amount: String(o.total || 0), status: "cash_collected", notes: "" }); }}>
                        <Coins className="h-3 w-3 ml-1" />تحصيل
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => { setFailOpen(o); setFail({ reason: "customer_unavailable", notes: "", next_action: "reschedule" }); }}>
                        <AlertTriangle className="h-3 w-3 ml-1" />فشل توصيل
                      </Button>
                      <Button size="sm" onClick={() => setStatus(o, "delivered")}>
                        <CheckCircle2 className="h-3 w-3 ml-1" />تم التوصيل
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>}

        {/* Collection dialog */}
        <Dialog open={!!collectOpen} onOpenChange={(v) => !v && setCollectOpen(null)}>
          <DialogContent dir="rtl">
            <DialogHeader><DialogTitle>تسجيل التحصيل — {collectOpen?.order_number}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">المستحق: {Number(collectOpen?.total || 0).toLocaleString("ar-EG")} ج.م</div>
              <div><Label>المبلغ المحصَّل</Label><Input type="number" value={collect.amount} onChange={e => setCollect({ ...collect, amount: e.target.value })} /></div>
              <div>
                <Label>حالة التحصيل</Label>
                <Select value={collect.status} onValueChange={(v: CollectionStatus) => setCollect({ ...collect, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(COLLECTION_STATUS_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>ملاحظات</Label><Textarea value={collect.notes} onChange={e => setCollect({ ...collect, notes: e.target.value })} /></div>
              <Button onClick={saveCollection} disabled={saving} className="w-full">{saving ? "جاري الحفظ…" : "حفظ"}</Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Failed delivery dialog */}
        <Dialog open={!!failOpen} onOpenChange={(v) => !v && setFailOpen(null)}>
          <DialogContent dir="rtl">
            <DialogHeader><DialogTitle>فشل التوصيل — {failOpen?.order_number}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>السبب</Label>
                <Select value={fail.reason} onValueChange={(v: FailedReason) => setFail({ ...fail, reason: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(FAILED_REASON_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>ملاحظات (إجباري)</Label><Textarea value={fail.notes} onChange={e => setFail({ ...fail, notes: e.target.value })} /></div>
              <div>
                <Label>الإجراء التالي</Label>
                <Select value={fail.next_action} onValueChange={(v: NextAction) => setFail({ ...fail, next_action: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(NEXT_ACTION_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <Button onClick={saveFail} disabled={saving} variant="destructive" className="w-full">{saving ? "جاري الحفظ…" : "حفظ"}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
