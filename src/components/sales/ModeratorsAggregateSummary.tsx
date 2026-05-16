import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  TrendingUp,
  ShoppingBag,
  Drumstick,
  Beef,
  Flame,
} from "lucide-react";
import { MODERATORS, isOrderForModerator } from "@/constants/moderators";

type Category = "meat" | "bone" | "processed" | "other";

// Classify a product into one of: meat (boneless fresh meat),
// bone (bone-in meat), processed (manufactured meat products).
const classify = (productName: string, category: string | null): Category => {
  const name = (productName || "").trim();
  const cat = (category || "").trim();

  // Bone-in always wins (it overrides the "fresh meat" category)
  if (/بالعظم|عظم/.test(name)) return "bone";

  // Processed / manufactured
  if (cat === "لحوم مصنعة") return "processed";
  if (
    /برجر|سجق|كفتة|حواوشي|شاورما|شيش|طرب|شغت|مفروم|فرم|تصنيع/.test(name)
  )
    return "processed";

  // Boneless fresh meat
  if (cat === "لحوم" || cat === "لحوم طازجة") return "meat";

  return "other";
};

interface AggRow {
  sales: number;
  orders: number;
  weight: { meat: number; bone: number; processed: number };
}

const emptyAgg = (): AggRow => ({
  sales: 0,
  orders: 0,
  weight: { meat: 0, bone: 0, processed: 0 },
});

const ModeratorsAggregateSummary = () => {
  const { data, isLoading } = useQuery({
    queryKey: ["moderators-aggregate-summary"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const now = new Date();
      const startOfMonth = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0),
      );
      const startOfNextMonth = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0),
      );

      // 1) Orders for this month (UTC boundaries — created_at is UTC)
      const { data: orders, error } = await supabase
        .from("orders")
        .select("id, total, moderator, created_by, created_at")
        .gte("created_at", startOfMonth.toISOString())
        .lt("created_at", startOfNextMonth.toISOString());
      if (error) throw error;

      // 2) Resolve creator profile names to attribute orders to the 4 girls
      const userIds = Array.from(
        new Set((orders || []).map((o: any) => o.created_by).filter(Boolean)),
      ) as string[];
      let profileMap = new Map<string, string>();
      if (userIds.length) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", userIds);
        profileMap = new Map(
          (profiles || []).map((p: any) => [p.id, p.full_name as string]),
        );
      }

      // 3) Keep only orders that belong to ANY of the 4 girls
      const girlsOrders = (orders || []).filter((o: any) =>
        MODERATORS.some((m) =>
          isOrderForModerator(
            m,
            o.moderator,
            o.created_by ? profileMap.get(o.created_by) || null : null,
          ),
        ),
      );

      // 4) Fetch order_items for those orders (paged)
      const ids = girlsOrders.map((o: any) => o.id);
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

      // 5) Resolve product categories
      const productIds = Array.from(
        new Set(items.map((it) => it.product_id).filter(Boolean)),
      ) as string[];
      const productCat = new Map<string, string | null>();
      if (productIds.length) {
        const { data: products } = await supabase
          .from("products")
          .select("id, category")
          .in("id", productIds);
        (products || []).forEach((p: any) =>
          productCat.set(p.id, p.category ?? null),
        );
      }

      // 6) Aggregate
      const todayStr = new Date().toISOString().slice(0, 10);
      const orderById = new Map<string, any>(
        girlsOrders.map((o: any) => [o.id, o]),
      );

      const month = emptyAgg();
      const today = emptyAgg();
      month.orders = girlsOrders.length;
      today.orders = girlsOrders.filter((o: any) =>
        o.created_at.slice(0, 10) === todayStr,
      ).length;
      month.sales = girlsOrders.reduce(
        (s: number, o: any) => s + Number(o.total || 0),
        0,
      );
      today.sales = girlsOrders
        .filter((o: any) => o.created_at.slice(0, 10) === todayStr)
        .reduce((s: number, o: any) => s + Number(o.total || 0), 0);

      for (const it of items) {
        const o = orderById.get(it.order_id);
        if (!o) continue;
        const cat = classify(
          it.product_name,
          it.product_id ? productCat.get(it.product_id) ?? null : null,
        );
        if (cat === "other") continue;
        const qty = Number(it.quantity || 0);
        month.weight[cat] += qty;
        if (o.created_at.slice(0, 10) === todayStr) today.weight[cat] += qty;
      }

      return { month, today };
    },
  });

  const today = data?.today ?? emptyAgg();
  const month = data?.month ?? emptyAgg();
  const fmt = (n: number) =>
    Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

  return (
    <Card className="glass-card mb-6">
      <CardContent className="p-4 md:p-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-primary" />
            <h3 className="text-base md:text-lg font-bold">
              إجمالي مبيعات البنات الأربع (آية، نورا، سارة، منال)
            </h3>
            <Badge variant="outline" className="text-[10px]">
              {new Date().toLocaleDateString("ar-EG", {
                month: "long",
                year: "numeric",
              })}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            ملخّص مجمَّع لطلبات اليوم والشهر مع توزيع الكميات على اللحوم
            واللحوم بالعظم والمصنعات.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Today */}
          <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-primary to-primary/70 p-4 text-primary-foreground shadow-md">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-xs opacity-80">إجمالي اليوم</p>
                <h4 className="text-xl font-bold">
                  {isLoading ? "…" : `${fmt(today.sales)} ج.م`}
                </h4>
                <p className="text-[11px] opacity-80 mt-0.5">
                  {isLoading ? "…" : `${today.orders} طلب`}
                </p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-white/20 ring-2 ring-white/40 flex items-center justify-center">
                <ShoppingBag className="w-5 h-5" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="bg-white/15 rounded-lg p-2">
                <div className="flex items-center gap-1 opacity-80">
                  <Beef className="w-3.5 h-3.5" /> لحوم
                </div>
                <p className="font-bold text-base mt-1">
                  {isLoading ? "…" : `${fmt(today.weight.meat)} كجم`}
                </p>
              </div>
              <div className="bg-white/15 rounded-lg p-2">
                <div className="flex items-center gap-1 opacity-80">
                  <Drumstick className="w-3.5 h-3.5" /> بالعظم
                </div>
                <p className="font-bold text-base mt-1">
                  {isLoading ? "…" : `${fmt(today.weight.bone)} كجم`}
                </p>
              </div>
              <div className="bg-white/15 rounded-lg p-2">
                <div className="flex items-center gap-1 opacity-80">
                  <Flame className="w-3.5 h-3.5" /> مصنعات
                </div>
                <p className="font-bold text-base mt-1">
                  {isLoading ? "…" : `${fmt(today.weight.processed)} كجم`}
                </p>
              </div>
            </div>
          </div>

          {/* Month */}
          <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-secondary to-secondary/70 p-4 text-primary-foreground shadow-md">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-xs opacity-80">إجمالي الشهر</p>
                <h4 className="text-xl font-bold">
                  {isLoading ? "…" : `${fmt(month.sales)} ج.م`}
                </h4>
                <p className="text-[11px] opacity-80 mt-0.5">
                  {isLoading ? "…" : `${month.orders} طلب`}
                </p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-white/20 ring-2 ring-white/40 flex items-center justify-center">
                <TrendingUp className="w-5 h-5" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="bg-white/15 rounded-lg p-2">
                <div className="flex items-center gap-1 opacity-80">
                  <Beef className="w-3.5 h-3.5" /> لحوم
                </div>
                <p className="font-bold text-base mt-1">
                  {isLoading ? "…" : `${fmt(month.weight.meat)} كجم`}
                </p>
              </div>
              <div className="bg-white/15 rounded-lg p-2">
                <div className="flex items-center gap-1 opacity-80">
                  <Drumstick className="w-3.5 h-3.5" /> بالعظم
                </div>
                <p className="font-bold text-base mt-1">
                  {isLoading ? "…" : `${fmt(month.weight.bone)} كجم`}
                </p>
              </div>
              <div className="bg-white/15 rounded-lg p-2">
                <div className="flex items-center gap-1 opacity-80">
                  <Flame className="w-3.5 h-3.5" /> مصنعات
                </div>
                <p className="font-bold text-base mt-1">
                  {isLoading ? "…" : `${fmt(month.weight.processed)} كجم`}
                </p>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default ModeratorsAggregateSummary;
