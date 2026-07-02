import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Flame } from "lucide-react";
import { useTopProductsLast3Days } from "@/hooks/useSalesAnalytics";

export default function TopProducts3DaysCard() {
  const navigate = useNavigate();
  const { data, isLoading } = useTopProductsLast3Days(5);

  const openProduct = (p: { product_id: string | null; product_name: string }) => {
    const qs = new URLSearchParams({ range: "3d" });
    if (p.product_id) qs.set("product_id", p.product_id);
    else qs.set("product_name", p.product_name);
    navigate(`/orders?${qs.toString()}`);
  };

  return (
    <Card className="glass-card mb-6">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Flame className="w-5 h-5 text-orange-500" />
          المنتجات الأكثر طلبًا خلال آخر 3 أيام
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-2">
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : !data || data.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            لا توجد طلبات خلال آخر 3 أيام
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border/40">
                  <th className="text-right py-2 px-2 font-normal w-10">#</th>
                  <th className="text-right py-2 px-2 font-normal">المنتج</th>
                  <th className="text-right py-2 px-2 font-normal">الكمية</th>
                  <th className="text-right py-2 px-2 font-normal">الأوردرات</th>
                  <th className="text-right py-2 px-2 font-normal">المبيعات</th>
                </tr>
              </thead>
              <tbody>
                {data.map((p, i) => (
                  <tr key={(p.product_id || p.product_name) + i} className="border-b border-border/20 hover:bg-muted/30 transition-colors">
                    <td className="py-2 px-2 text-muted-foreground">{i + 1}</td>
                    <td className="py-2 px-2">
                      <button
                        type="button"
                        onClick={() => openProduct(p)}
                        className="text-primary hover:underline font-medium text-right"
                      >
                        {p.product_name}
                      </button>
                    </td>
                    <td className="py-2 px-2 font-semibold">
                      {p.quantity.toLocaleString()} {p.unit || ""}
                    </td>
                    <td className="py-2 px-2">{p.orders_count} أوردر</td>
                    <td className="py-2 px-2 font-semibold text-success">
                      {p.total_sales.toLocaleString()} ج.م
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
