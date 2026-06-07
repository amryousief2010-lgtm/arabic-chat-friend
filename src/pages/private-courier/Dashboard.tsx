import { useMemo } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Truck, Package, CheckCircle2, AlertTriangle, RotateCcw, Clock, Coins, Users } from "lucide-react";
import { useEligibleOrders } from "@/hooks/usePrivateCourierData";
import type { CourierStatus } from "@/lib/privateCourier/constants";

const Stat = ({ icon: Icon, label, value, color = "text-primary" }: any) => (
  <Card className="border-r-4" style={{ borderRightColor: "currentColor" }}>
    <CardContent className="p-4 flex items-center justify-between">
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-2xl font-bold ${color}`}>{value}</p>
      </div>
      <Icon className={`h-8 w-8 ${color} opacity-60`} />
    </CardContent>
  </Card>
);

const fmt = (n: number) => n.toLocaleString("ar-EG");

export default function PCDashboard() {
  const { data, loading } = useEligibleOrders();

  const k = useMemo(() => {
    const by = (s: CourierStatus) => data.filter(d => d.tracking_status === s).length;
    const total = data.length;
    const assigned = data.filter(d => d.assigned_route_id).length;
    const waiting_assignment = total - assigned;
    const total_amount = data.reduce((s, o) => s + Number(o.total || 0), 0);
    return {
      total,
      waiting_assignment,
      assigned,
      ready_pickup: by("ready_for_pickup_from_main_warehouse"),
      picked_up: by("picked_up_by_courier"),
      out: by("out_for_delivery"),
      delivered: by("delivered"),
      failed: by("failed_delivery"),
      returned: by("returned_to_warehouse"),
      total_amount,
    };
  }, [data]);

  return (
    <DashboardLayout>
      <div className="container mx-auto p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Truck className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">المندوب الخاص وخطوط السير</h1>
            <p className="text-sm text-muted-foreground">لوحة متابعة طلبات التوصيل بالمندوب الخاص من المخزن الرئيسي</p>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12 text-muted-foreground">جاري التحميل…</div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              <Stat icon={Package} label="إجمالي الطلبات المؤهلة" value={fmt(k.total)} color="text-primary" />
              <Stat icon={Clock} label="في انتظار التعيين" value={fmt(k.waiting_assignment)} color="text-amber-600" />
              <Stat icon={Users} label="طلبات مُعيَّنة" value={fmt(k.assigned)} color="text-blue-600" />
              <Stat icon={Package} label="جاهز للاستلام" value={fmt(k.ready_pickup)} color="text-amber-600" />
              <Stat icon={Truck} label="تم الاستلام" value={fmt(k.picked_up)} color="text-indigo-600" />
              <Stat icon={Truck} label="خرج للتوصيل" value={fmt(k.out)} color="text-purple-600" />
              <Stat icon={CheckCircle2} label="تم التوصيل" value={fmt(k.delivered)} color="text-green-600" />
              <Stat icon={AlertTriangle} label="فشل التوصيل" value={fmt(k.failed)} color="text-red-600" />
              <Stat icon={RotateCcw} label="مرتجع للمخزن" value={fmt(k.returned)} color="text-orange-600" />
              <Stat icon={Coins} label="إجمالي المبلغ المستحق" value={fmt(k.total_amount) + " ج.م"} color="text-emerald-700" />
            </div>

            <Card>
              <CardHeader><CardTitle className="text-base">روابط سريعة</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-2 text-sm">
                <a href="/private-courier/planning" className="p-3 rounded-md bg-muted/40 hover:bg-muted">تخطيط الخطوط وتعيين الطلبات</a>
                <a href="/private-courier/routes" className="p-3 rounded-md bg-muted/40 hover:bg-muted">إدارة خطوط السير</a>
                <a href="/private-courier/my-deliveries" className="p-3 rounded-md bg-muted/40 hover:bg-muted">طلباتي (للمندوب)</a>
                <a href="/private-courier/handovers" className="p-3 rounded-md bg-muted/40 hover:bg-muted">تسليم المخزن</a>
                <a href="/private-courier/collections" className="p-3 rounded-md bg-muted/40 hover:bg-muted">تقرير التحصيل</a>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
