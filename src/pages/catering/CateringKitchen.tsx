import { useEffect, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ChefHat, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface KitchenItem {
  id: string; order_id: string; product_name: string; product_image: string | null;
  kitchen_section: string; quantity: number; prep_status: string; notes: string | null;
  catering_orders: { order_number: string; customer_name_snapshot: string; delivery_date: string | null; delivery_time: string | null; kitchen_out_time: string | null; status: string };
}

const SECTIONS: Array<{ key: string; label: string; color: string }> = [
  { key: "pastry", label: "معجنات", color: "from-amber-500 to-amber-400" },
  { key: "dessert", label: "حلا", color: "from-pink-500 to-pink-400" },
  { key: "hot", label: "سخن", color: "from-rose-500 to-rose-400" },
  { key: "salad", label: "سلطات", color: "from-emerald-500 to-emerald-400" },
];
const STATUSES = ["pending", "preparing", "ready"];
const STATUS_LABEL: Record<string, string> = { pending: "قيد الانتظار", preparing: "قيد التحضير", ready: "جاهز" };
const STATUS_COLOR: Record<string, string> = { pending: "bg-muted text-foreground", preparing: "bg-amber-500 text-white", ready: "bg-emerald-500 text-white" };

const CateringKitchen = () => {
  const [tab, setTab] = useState("pastry");
  const [items, setItems] = useState<KitchenItem[]>([]);

  const load = async () => {
    const { data, error } = await supabase
      .from("catering_order_items")
      .select("*, catering_orders!inner(order_number, customer_name_snapshot, delivery_date, delivery_time, kitchen_out_time, status)")
      .neq("catering_orders.status", "cancelled")
      .neq("catering_orders.status", "delivered")
      .order("created_at", { ascending: false });
    if (error) return toast.error(error.message);
    setItems((data || []) as unknown as KitchenItem[]);
  };
  useEffect(() => { load(); }, []);

  const updateStatus = async (id: string, prep_status: string) => {
    const { error } = await supabase.from("catering_order_items").update({ prep_status }).eq("id", id);
    if (error) return toast.error(error.message);
    load();
  };

  return (
    <DashboardLayout>
      <Header title="المطبخ المركزي" subtitle="بطاقات الإنتاج موزعة على الأقسام" />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          {SECTIONS.map((s) => <TabsTrigger key={s.key} value={s.key}>{s.label}</TabsTrigger>)}
        </TabsList>
        {SECTIONS.map((s) => (
          <TabsContent key={s.key} value={s.key}>
            <div className="grid md:grid-cols-3 gap-4">
              {STATUSES.map((status) => {
                const list = items.filter((i) => i.kitchen_section === s.key && i.prep_status === status);
                return (
                  <Card key={status}>
                    <CardContent className="p-3">
                      <div className={`bg-gradient-to-r ${s.color} text-white rounded-lg px-3 py-2 mb-3 flex items-center justify-between`}>
                        <span className="font-bold">{STATUS_LABEL[status]}</span>
                        <Badge variant="secondary">{list.length}</Badge>
                      </div>
                      <div className="space-y-2">
                        {list.length === 0 ? <p className="text-center text-muted-foreground text-sm py-4">لا يوجد</p>
                          : list.map((it) => (
                            <div key={it.id} className="border rounded-lg p-3 bg-card hover:shadow-md transition-shadow">
                              <div className="flex gap-2 mb-2">
                                {it.product_image ? <img src={it.product_image} alt={it.product_name} className="w-16 h-16 rounded object-cover" /> : <div className="w-16 h-16 rounded bg-muted flex items-center justify-center"><ChefHat className="w-6 h-6" /></div>}
                                <div className="flex-1">
                                  <p className="font-bold">{it.product_name}</p>
                                  <p className="text-xs text-muted-foreground">الكمية: <strong>{it.quantity}</strong></p>
                                  <p className="text-xs text-muted-foreground">{it.catering_orders.customer_name_snapshot}</p>
                                </div>
                              </div>
                              <div className="flex items-center justify-between text-xs text-muted-foreground">
                                <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{it.catering_orders.delivery_time?.slice(0, 5) || "-"}</span>
                                <span className="font-mono">{it.catering_orders.order_number}</span>
                              </div>
                              {it.notes && <p className="text-xs italic mt-1 text-muted-foreground">📝 {it.notes}</p>}
                              <div className="flex gap-1 mt-2">
                                {STATUSES.filter((st) => st !== status).map((st) => (
                                  <Button key={st} variant="outline" size="sm" className="flex-1 text-xs" onClick={() => updateStatus(it.id, st)}>
                                    → {STATUS_LABEL[st]}
                                  </Button>
                                ))}
                              </div>
                            </div>
                          ))}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </DashboardLayout>
  );
};
export default CateringKitchen;
