import { useMemo, useState } from "react";
import { useNavigate, useParams, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, ArrowRight, ShoppingCart, TrendingUp, CalendarDays, Trash2, Search, ShieldCheck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { findModeratorBySlug, isOrderForModerator } from "@/constants/moderators";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

const statusLabels: Record<string, string> = {
  pending: "قيد الانتظار",
  processing: "جاري التجهيز",
  shipped: "تم الشحن",
  delivered: "تم التوصيل",
  cancelled: "ملغي",
};

const statusColors: Record<string, string> = {
  pending: "bg-warning text-warning-foreground",
  processing: "bg-primary text-primary-foreground",
  shipped: "bg-chart-4 text-primary-foreground",
  delivered: "bg-success text-success-foreground",
  cancelled: "bg-destructive text-destructive-foreground",
};

const ModeratorOrdersLog = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { canDeleteOrders } = useAuth();
  const moderator = findModeratorBySlug(slug);
  const [period, setPeriod] = useState<"today" | "month" | "year">("month");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  if (!moderator) return <Navigate to="/orders" replace />;

  const range = useMemo(() => {
    const now = new Date();
    if (period === "today") {
      const s = new Date(now); s.setHours(0, 0, 0, 0);
      return { from: s, to: now };
    }
    if (period === "year") {
      return { from: new Date(now.getFullYear(), 0, 1), to: now };
    }
    return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: now };
  }, [period]);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["moderator-log", moderator.slug, period],
    queryFn: async () => {
      const { data: orders, error } = await supabase
        .from("orders")
        .select("id, order_number, total, status, created_at, moderator, created_by, customers(name)")
        .gte("created_at", range.from.toISOString())
        .lte("created_at", range.to.toISOString())
        .order("created_at", { ascending: false });
      if (error) throw error;

      const userIds = Array.from(
        new Set((orders || []).map((o: any) => o.created_by).filter(Boolean)),
      ) as string[];
      let profileMap = new Map<string, string>();
      if (userIds.length) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", userIds);
        profileMap = new Map((profiles || []).map((p: any) => [p.id, p.full_name as string]));
      }

      const filtered = (orders || []).filter((o: any) =>
        isOrderForModerator(moderator, o.moderator, o.created_by ? profileMap.get(o.created_by) || null : null),
      );
      return filtered;
    },
  });

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data || []).filter((o: any) => {
      if (statusFilter !== "all" && o.status !== statusFilter) return false;
      if (!q) return true;
      return (
        (o.order_number || "").toLowerCase().includes(q) ||
        (o.customers?.name || "").toLowerCase().includes(q)
      );
    });
  }, [data, search, statusFilter]);

  const stats = useMemo(() => {
    const list = visible;
    const total = list.reduce((s: number, o: any) => s + Number(o.total || 0), 0);
    const delivered = list.filter((o: any) => o.status === "delivered").length;
    const cancelled = list.filter((o: any) => o.status === "cancelled").length;
    return { count: list.length, total, delivered, cancelled };
  }, [visible]);

  const dailyBreakdown = useMemo(() => {
    const map = new Map<string, { date: string; count: number; total: number }>();
    (data || []).forEach((o: any) => {
      const d = o.created_at.slice(0, 10);
      const existing = map.get(d) || { date: d, count: 0, total: 0 };
      existing.count += 1;
      existing.total += Number(o.total || 0);
      map.set(d, existing);
    });
    return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
  }, [data]);

  const handleDelete = async (id: string, orderNumber: string) => {
    if (!confirm(`هل أنت متأكد من حذف الطلب ${orderNumber}؟`)) return;
    try {
      await supabase.from("order_items").delete().eq("order_id", id);
      const { error } = await supabase.from("orders").delete().eq("id", id);
      if (error) throw error;
      toast.success("تم حذف الطلب");
      refetch();
    } catch (e: any) {
      toast.error(e.message || "تعذّر حذف الطلب");
    }
  };

  return (
    <DashboardLayout>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <Header
          title={`سجل ${moderator.displayName}`}
          subtitle="سجل يومي وشهري للطلبات الخاصة بكِ — يتم تجميعها تلقائياً في صفحة الطلبات الرئيسية"
        />
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate("/orders")}>
            <ArrowRight className="w-4 h-4 ml-1" /> العودة للطلبات
          </Button>
          <Button size="sm" onClick={() => navigate(`/orders/new?moderator=${moderator.slug}`)}>
            <Plus className="w-4 h-4 ml-1" /> تسجيل طلب جديد
          </Button>
        </div>
      </div>

      {/* Period filter */}
      <div className="flex items-center gap-2 mb-4">
        <Button size="sm" variant={period === "today" ? "default" : "outline"} onClick={() => setPeriod("today")}>اليوم</Button>
        <Button size="sm" variant={period === "month" ? "default" : "outline"} onClick={() => setPeriod("month")}>هذا الشهر</Button>
        <Button size="sm" variant={period === "year" ? "default" : "outline"} onClick={() => setPeriod("year")}>هذه السنة</Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Card className="glass-card"><CardContent className="p-4">
          <div className="flex items-center justify-between"><p className="text-xs text-muted-foreground">عدد الطلبات</p><ShoppingCart className="w-4 h-4 text-primary" /></div>
          <p className="text-2xl font-bold mt-2">{isLoading ? "…" : stats.count}</p>
        </CardContent></Card>
        <Card className="glass-card"><CardContent className="p-4">
          <div className="flex items-center justify-between"><p className="text-xs text-muted-foreground">إجمالي المبيعات</p><TrendingUp className="w-4 h-4 text-success" /></div>
          <p className="text-2xl font-bold mt-2 text-success">{isLoading ? "…" : `${stats.total.toLocaleString()} ج.م`}</p>
        </CardContent></Card>
        <Card className="glass-card"><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">طلبات مكتملة</p>
          <p className="text-2xl font-bold mt-2 text-success">{isLoading ? "…" : stats.delivered}</p>
        </CardContent></Card>
        <Card className="glass-card"><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">طلبات ملغاة</p>
          <p className="text-2xl font-bold mt-2 text-destructive">{isLoading ? "…" : stats.cancelled}</p>
        </CardContent></Card>
      </div>

      {/* Daily breakdown */}
      <Card className="glass-card mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarDays className="w-5 h-5 text-secondary" /> ملخص يومي
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? <Skeleton className="h-32 w-full" /> : dailyBreakdown.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-6">لا توجد طلبات في هذه الفترة</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
              {dailyBreakdown.map((d) => (
                <div key={d.date} className="rounded-lg border border-border p-2 text-center bg-muted/30">
                  <p className="text-[10px] text-muted-foreground">{new Date(d.date).toLocaleDateString("ar-EG", { weekday: "short", day: "numeric", month: "short" })}</p>
                  <p className="text-lg font-bold">{d.count}</p>
                  <p className="text-[10px] text-success">{d.total.toLocaleString()} ج.م</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Orders list */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-base">تفاصيل الطلبات</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? <Skeleton className="h-64 w-full" /> : (data || []).length === 0 ? (
            <div className="text-center py-10">
              <p className="text-muted-foreground mb-3">لا توجد طلبات بعد في هذه الفترة</p>
              <Button onClick={() => navigate(`/orders/new?moderator=${moderator.slug}`)}>
                <Plus className="w-4 h-4 ml-1" /> سجّلي أول طلب
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground text-xs">
                    <th className="text-right py-2 px-2 font-medium">رقم الطلب</th>
                    <th className="text-right py-2 px-2 font-medium">العميل</th>
                    <th className="text-right py-2 px-2 font-medium">التاريخ</th>
                    <th className="text-right py-2 px-2 font-medium">الإجمالي</th>
                    <th className="text-right py-2 px-2 font-medium">الحالة</th>
                    <th className="text-right py-2 px-2 font-medium">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {(data || []).map((o: any) => (
                    <tr key={o.id} className="border-b hover:bg-muted/40 transition-colors">
                      <td className="py-2 px-2 font-mono text-xs">{o.order_number}</td>
                      <td className="py-2 px-2">{o.customers?.name || "-"}</td>
                      <td className="py-2 px-2 text-xs text-muted-foreground">
                        {new Date(o.created_at).toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" })}
                      </td>
                      <td className="py-2 px-2 font-bold">{Number(o.total).toLocaleString()} ج.م</td>
                      <td className="py-2 px-2"><Badge className={statusColors[o.status] || ""}>{statusLabels[o.status] || o.status}</Badge></td>
                      <td className="py-2 px-2">
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => navigate(`/orders/${o.id}`)}>عرض</Button>
                          {canDeleteOrders && (
                            <Button size="sm" variant="ghost" className="h-7 text-destructive" onClick={() => handleDelete(o.id, o.order_number)}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </DashboardLayout>
  );
};

export default ModeratorOrdersLog;
