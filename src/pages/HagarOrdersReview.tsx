import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Eye, Search, ShoppingCart, TrendingUp } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { findModeratorByName, matchesModeratorGroup } from "@/constants/moderators";
import {
  cairoTodayStartUTC,
  cairoMonthStartUTC,
  cairoYearStartUTC,
  currentCairoYearMonth,
  toCairoDateString,
} from "@/lib/cairoDate";
import { formatDate } from "@/lib/dateFormat";

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

// شاشة مراجعة فقط (Read-only) لأوردرات هاجر — مخصّصة لحساب نورا.
// ممنوع أي تعديل أو حذف من هنا؛ العرض فقط لأغراض المراجعة،
// ولا تختلط بأوردرات نورا نفسها (الفلترة على المسوقة "هاجر"/"منال").
const HagarOrdersReview = () => {
  const { profile, user, isGeneralManager, isExecutiveManager } = useAuth();
  const [period, setPeriod] = useState<"today" | "month" | "year">("month");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const isNoura =
    findModeratorByName(profile?.full_name)?.slug === "noura" ||
    (user?.email || "").toLowerCase().startsWith("noura");
  const allowed = isNoura || isGeneralManager || isExecutiveManager;

  const range = useMemo(() => {
    const now = new Date();
    if (period === "today") return { from: cairoTodayStartUTC(now), to: now };
    if (period === "year") {
      const [y] = toCairoDateString(now).split("-").map(Number);
      return { from: cairoYearStartUTC(y), to: now };
    }
    const { year, monthIndex0 } = currentCairoYearMonth(now);
    return { from: cairoMonthStartUTC(year, monthIndex0), to: now };
  }, [period]);

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["hagar-orders-review", period],
    enabled: allowed,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("id, order_number, total, status, created_at, moderator, customers(name, phone)")
        .gte("created_at", range.from.toISOString())
        .lte("created_at", range.to.toISOString())
        .order("created_at", { ascending: false });
      if (error) throw error;
      // احتياطي على مستوى الواجهة: أوردرات هاجر فقط (وتشمل المسجلة سابقاً باسم منال)
      return (data || []).filter((o: any) => matchesModeratorGroup(o.moderator, "هاجر"));
    },
  });

  if (!allowed) return <Navigate to="/orders" replace />;

  const visible = orders.filter((o: any) => {
    if (statusFilter !== "all" && o.status !== statusFilter) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      (o.order_number || "").toLowerCase().includes(q) ||
      (o.customers?.name || "").toLowerCase().includes(q) ||
      (o.customers?.phone || "").includes(q)
    );
  });

  const totalValue = visible.reduce((s: number, o: any) => s + Number(o.total || 0), 0);

  return (
    <DashboardLayout>
      <Header title="مراجعة أوردرات هاجر" subtitle="عرض للمراجعة فقط — لا يمكن التعديل أو الحذف" />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground flex items-center gap-2"><ShoppingCart className="w-4 h-4" /> عدد الأوردرات</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold">{visible.length}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground flex items-center gap-2"><TrendingUp className="w-4 h-4" /> إجمالي القيمة</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold text-primary">{totalValue.toLocaleString()} ج.م</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground flex items-center gap-2"><Eye className="w-4 h-4" /> صلاحية</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground pt-1">مراجعة فقط (بدون تعديل)</CardContent>
        </Card>
      </div>

      <Card className="mb-4">
        <CardContent className="p-4 flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute top-3 start-3 text-muted-foreground" />
            <Input className="ps-9" placeholder="بحث برقم الأوردر أو اسم/رقم العميل" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={period} onValueChange={(v) => setPeriod(v as any)}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="today">اليوم</SelectItem>
              <SelectItem value="month">هذا الشهر</SelectItem>
              <SelectItem value="year">هذه السنة</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الحالات</SelectItem>
              {Object.entries(statusLabels).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {isLoading ? (
            <div className="p-4 space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : visible.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">لا توجد أوردرات لهاجر في هذه الفترة</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-3 text-start">رقم الأوردر</th>
                  <th className="p-3 text-start">العميل</th>
                  <th className="p-3 text-start">الهاتف</th>
                  <th className="p-3 text-start">الإجمالي</th>
                  <th className="p-3 text-start">الحالة</th>
                  <th className="p-3 text-start">التاريخ</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((o: any) => (
                  <tr key={o.id} className="border-t">
                    <td className="p-3 font-mono text-xs">{o.order_number}</td>
                    <td className="p-3 font-semibold">{o.customers?.name || "—"}</td>
                    <td className="p-3 font-mono text-xs">{o.customers?.phone || "—"}</td>
                    <td className="p-3 font-bold text-primary">{Number(o.total || 0).toLocaleString()}</td>
                    <td className="p-3"><Badge className={statusColors[o.status] || ""}>{statusLabels[o.status] || o.status}</Badge></td>
                    <td className="p-3 text-xs text-muted-foreground">{formatDate(o.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </DashboardLayout>
  );
};

export default HagarOrdersReview;
