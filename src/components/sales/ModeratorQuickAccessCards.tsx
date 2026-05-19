import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ShoppingCart, Plus, FileText, UserRound, Beef, Drumstick, Flame } from "lucide-react";
import { MODERATORS, isOrderForModerator, ModeratorConfig, findModeratorByName } from "@/constants/moderators";
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

type Category = "meat" | "bone" | "processed" | "other";

const classify = (productName: string, category: string | null): Category => {
  const name = (productName || "").trim();
  const cat = (category || "").trim();
  if (/بالعظم|عظم/.test(name)) return "bone";
  if (cat === "لحوم مصنعة") return "processed";
  if (/برجر|سجق|كفتة|حواوشي|شاورما|شيش|طرب|شغت|مفروم|فرم|تصنيع/.test(name)) return "processed";
  if (cat === "لحوم" || cat === "لحوم طازجة") return "meat";
  return "other";
};

const emptyW = () => ({ meat: 0, bone: 0, processed: 0 });

interface Props {
  /**
   * When true, only count orders whose shipping_company is "مندوب خاص".
   */
  privateDeliveryOnly?: boolean;
}

const ModeratorQuickAccessCards = ({ privateDeliveryOnly = false }: Props) => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["moderator-quick-access-v2", privateDeliveryOnly],
    refetchInterval: 60_000,
    queryFn: async () => {
      const now = new Date();
      const startOfMonth = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0),
      );
      const startOfNextMonth = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0),
      );

      let q = supabase
        .from("orders")
        .select("id, total, status, moderator, created_by, created_at, shipping_company")
        .gte("created_at", startOfMonth.toISOString())
        .lt("created_at", startOfNextMonth.toISOString());
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

      // Attribute each order to a moderator (if any)
      const orderToMod = new Map<string, ModeratorConfig>();
      (orders as OrderRow[]).forEach((o) => {
        const creatorName = o.created_by ? profileMap.get(o.created_by) || null : null;
        const m = MODERATORS.find((mod) => isOrderForModerator(mod, o.moderator, creatorName));
        if (m) orderToMod.set(o.id, m);
      });

      // Fetch items for those orders (paged)
      const ids = Array.from(orderToMod.keys());
      let items: any[] = [];
      for (let i = 0; i < ids.length; i += 300) {
        const slice = ids.slice(i, i + 300);
        let from = 0;
        const PAGE = 1000;
        while (true) {
          const { data: chunk } = await supabase
            .from("order_items")
            .select("order_id, product_id, product_name, quantity")
            .in("order_id", slice)
            .range(from, from + PAGE - 1);
          if (!chunk || chunk.length === 0) break;
          items = items.concat(chunk);
          if (chunk.length < PAGE) break;
          from += PAGE;
        }
      }

      // Resolve product categories
      const productIds = Array.from(new Set(items.map((it) => it.product_id).filter(Boolean))) as string[];
      const productCat = new Map<string, string | null>();
      if (productIds.length) {
        const { data: products } = await supabase
          .from("products")
          .select("id, category")
          .in("id", productIds);
        (products || []).forEach((p: any) => productCat.set(p.id, p.category ?? null));
      }

      const todayStr = new Date().toISOString().slice(0, 10);
      const orderById = new Map<string, OrderRow>(
        (orders as OrderRow[]).map((o) => [o.id, o]),
      );

      return MODERATORS.map((m) => {
        const filtered = (orders as OrderRow[]).filter((o) => orderToMod.get(o.id)?.slug === m.slug);
        const today = filtered.filter((o) => o.created_at.slice(0, 10) === todayStr);
        const monthTotal = filtered.reduce((s, o) => s + Number(o.total || 0), 0);
        const todayTotal = today.reduce((s, o) => s + Number(o.total || 0), 0);

        const monthW = emptyW();
        const todayW = emptyW();
        const orderIdSet = new Set(filtered.map((o) => o.id));
        for (const it of items) {
          if (!orderIdSet.has(it.order_id)) continue;
          const cat = classify(it.product_name, it.product_id ? productCat.get(it.product_id) ?? null : null);
          if (cat === "other") continue;
          const qty = Number(it.quantity || 0);
          monthW[cat] += qty;
          const o = orderById.get(it.order_id);
          if (o && o.created_at.slice(0, 10) === todayStr) todayW[cat] += qty;
        }

        return {
          slug: m.slug,
          displayName: m.displayName,
          gradient: m.gradient,
          iconBg: m.iconBg,
          monthOrders: filtered.length,
          monthTotal,
          todayOrders: today.length,
          todayTotal,
          monthW,
          todayW,
        };
      });
    },
  });

  const fmt = (n: number) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 1 });

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
              {new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {privateDeliveryOnly
              ? "عدد الطلبات المسجلة لكل مسوقة والمخصصة للمندوب الخاص — اضغط «السجل» لمعرفة بيانات العميل والتواصل مع المسوقة عند الحاجة."
              : "كل بنت تسجّل طلبها هنا، ويتم تجميع كل الطلبات وكميات اللحوم واللحوم بالعظم والمصنعات تلقائياً وتُحدَّث مع كل طلب."}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {(data || MODERATORS.map((m) => ({
            slug: m.slug, displayName: m.displayName, gradient: m.gradient, iconBg: m.iconBg,
            monthOrders: 0, monthTotal: 0, todayOrders: 0, todayTotal: 0,
            monthW: emptyW(), todayW: emptyW(),
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

              <div className="grid grid-cols-2 gap-2 text-xs mb-2">
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

              {/* Weights breakdown — Today */}
              <div className="bg-white/10 rounded-lg p-2 mb-2">
                <p className="text-[10px] opacity-80 mb-1.5 font-medium">كميات اليوم (كجم)</p>
                <div className="grid grid-cols-3 gap-1.5 text-[11px]">
                  <div className="bg-white/15 rounded p-1.5 text-center">
                    <div className="flex items-center justify-center gap-1 opacity-80">
                      <Beef className="w-3 h-3" /> لحوم
                    </div>
                    <p className="font-bold mt-0.5">{isLoading ? "…" : fmt(row.todayW.meat)}</p>
                  </div>
                  <div className="bg-white/15 rounded p-1.5 text-center">
                    <div className="flex items-center justify-center gap-1 opacity-80">
                      <Drumstick className="w-3 h-3" /> بالعظم
                    </div>
                    <p className="font-bold mt-0.5">{isLoading ? "…" : fmt(row.todayW.bone)}</p>
                  </div>
                  <div className="bg-white/15 rounded p-1.5 text-center">
                    <div className="flex items-center justify-center gap-1 opacity-80">
                      <Flame className="w-3 h-3" /> مصنعات
                    </div>
                    <p className="font-bold mt-0.5">{isLoading ? "…" : fmt(row.todayW.processed)}</p>
                  </div>
                </div>
              </div>

              {/* Weights breakdown — Month */}
              <div className="bg-white/10 rounded-lg p-2 mb-3">
                <p className="text-[10px] opacity-80 mb-1.5 font-medium">كميات الشهر (كجم)</p>
                <div className="grid grid-cols-3 gap-1.5 text-[11px]">
                  <div className="bg-white/15 rounded p-1.5 text-center">
                    <div className="flex items-center justify-center gap-1 opacity-80">
                      <Beef className="w-3 h-3" /> لحوم
                    </div>
                    <p className="font-bold mt-0.5">{isLoading ? "…" : fmt(row.monthW.meat)}</p>
                  </div>
                  <div className="bg-white/15 rounded p-1.5 text-center">
                    <div className="flex items-center justify-center gap-1 opacity-80">
                      <Drumstick className="w-3 h-3" /> بالعظم
                    </div>
                    <p className="font-bold mt-0.5">{isLoading ? "…" : fmt(row.monthW.bone)}</p>
                  </div>
                  <div className="bg-white/15 rounded p-1.5 text-center">
                    <div className="flex items-center justify-center gap-1 opacity-80">
                      <Flame className="w-3 h-3" /> مصنعات
                    </div>
                    <p className="font-bold mt-0.5">{isLoading ? "…" : fmt(row.monthW.processed)}</p>
                  </div>
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
