import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ShoppingCart, Plus, FileText, UserRound } from "lucide-react";
import { MODERATORS, isOrderForModerator } from "@/constants/moderators";
import { useAuth } from "@/hooks/useAuth";

interface OrderRow {
  id: string;
  total: number;
  status: string;
  moderator: string | null;
  created_by: string | null;
  created_at: string;
  shipping_company: string | null;
}

interface Props {
  /**
   * When true, only count orders whose shipping_company is "مندوب خاص".
   * Used by the private delivery rep view so he sees how many of his
   * delivery orders belong to each marketing employee.
   */
  privateDeliveryOnly?: boolean;
}

const ModeratorQuickAccessCards = ({ privateDeliveryOnly = false }: Props) => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["moderator-quick-access", privateDeliveryOnly],
    refetchInterval: 60_000,
    queryFn: async () => {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      let q = supabase
        .from("orders")
        .select("id, total, status, moderator, created_by, created_at, shipping_company")
        .gte("created_at", startOfMonth.toISOString());
      if (privateDeliveryOnly) q = q.eq("shipping_company", "مندوب خاص");
      const { data: orders, error } = await q;
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

      const todayStr = new Date().toISOString().slice(0, 10);

      return MODERATORS.map((m) => {
        const filtered = (orders as OrderRow[]).filter((o) =>
          isOrderForModerator(m, o.moderator, o.created_by ? profileMap.get(o.created_by) || null : null),
        );
        const today = filtered.filter((o) => o.created_at.slice(0, 10) === todayStr);
        const monthTotal = filtered.reduce((s, o) => s + Number(o.total || 0), 0);
        const todayTotal = today.reduce((s, o) => s + Number(o.total || 0), 0);
        return {
          slug: m.slug,
          displayName: m.displayName,
          gradient: m.gradient,
          iconBg: m.iconBg,
          monthOrders: filtered.length,
          monthTotal,
          todayOrders: today.length,
          todayTotal,
        };
      });
    },
  });

  return (
    <Card className="glass-card mb-6">
      <CardContent className="p-4 md:p-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <UserRound className="w-5 h-5 text-primary" />
            <h3 className="text-base md:text-lg font-bold">
              {privateDeliveryOnly ? "طلبات المسوقات المخصصة للمندوب الخاص" : "سجلات المسوقات"}
            </h3>
            <Badge variant="outline" className="text-[10px]">
              {new Date().toLocaleDateString("ar-EG", { month: "long", year: "numeric" })}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {privateDeliveryOnly
              ? "عدد الطلبات المسجلة لكل مسوقة والمخصصة للمندوب الخاص — اضغط «السجل» لمعرفة بيانات العميل والتواصل مع المسوقة عند الحاجة."
              : "كل بنت تسجّل طلبها هنا، ويتم تجميع كل الطلبات تلقائياً في الجدول العام بالأعلى."}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {(data || MODERATORS.map((m) => ({
            slug: m.slug, displayName: m.displayName, gradient: m.gradient, iconBg: m.iconBg,
            monthOrders: 0, monthTotal: 0, todayOrders: 0, todayTotal: 0,
          }))).map((row) => (
            <div
              key={row.slug}
              className={`relative overflow-hidden rounded-xl bg-gradient-to-br ${row.gradient} p-4 text-primary-foreground shadow-md hover:shadow-xl transition-all`}
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="text-xs opacity-80">المسوقة</p>
                  <h4 className="text-xl font-bold">{row.displayName}</h4>
                </div>
                <div className={`w-10 h-10 rounded-xl ${row.iconBg} ring-2 ring-white/40 flex items-center justify-center`}>
                  <UserRound className="w-5 h-5" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                <div className="bg-white/15 rounded-lg p-2">
                  <p className="opacity-80">طلبات اليوم</p>
                  <p className="font-bold text-base">
                    {isLoading ? "…" : row.todayOrders}
                  </p>
                  <p className="opacity-70 text-[10px]">{Number(row.todayTotal).toLocaleString()} ج.م</p>
                </div>
                <div className="bg-white/15 rounded-lg p-2">
                  <p className="opacity-80">إجمالي الشهر</p>
                  <p className="font-bold text-base">
                    {isLoading ? "…" : row.monthOrders}
                  </p>
                  <p className="opacity-70 text-[10px]">{Number(row.monthTotal).toLocaleString()} ج.م</p>
                </div>
              </div>

              <div className="flex gap-2">
                {!privateDeliveryOnly && (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="flex-1 h-8 text-xs"
                    onClick={() => navigate(`/orders/new?moderator=${row.slug}`)}
                  >
                    <Plus className="w-3.5 h-3.5 ml-1" /> طلب جديد
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 h-8 text-xs bg-white/10 border-white/30 text-primary-foreground hover:bg-white/20"
                  onClick={() => navigate(`/orders/moderator/${row.slug}${privateDeliveryOnly ? '?shipping=private' : ''}`)}
                >
                  <FileText className="w-3.5 h-3.5 ml-1" /> السجل
                </Button>
              </div>

              {user && (
                <ShoppingCart className="absolute -bottom-3 -left-3 w-16 h-16 opacity-10" />
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

export default ModeratorQuickAccessCards;
