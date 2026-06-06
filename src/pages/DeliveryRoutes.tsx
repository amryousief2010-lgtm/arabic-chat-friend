import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, MapPin, Phone } from "lucide-react";
import { format } from "date-fns";

const KIMO_USER_ID = "63f77f84-eb84-4e88-9d7d-468e2ca981b8";

interface Route {
  id: string;
  name: string;
  color: string;
  notes: string | null;
}

interface OrderRow {
  id: string;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  delivery_address: string | null;
  total: number;
  status: string;
  created_at: string;
  route_id: string | null;
}

const COLORS = ["#a855f7", "#f97316", "#22c55e", "#3b82f6", "#ec4899", "#eab308", "#06b6d4", "#ef4444"];

export default function DeliveryRoutes() {
  const { user, isGeneralManager } = useAuth();
  const canManageRoutes = user?.id === KIMO_USER_ID || isGeneralManager;

  const [routes, setRoutes] = useState<Route[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>("unassigned");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRoute, setEditingRoute] = useState<Route | null>(null);
  const [form, setForm] = useState({ name: "", color: COLORS[0], notes: "" });

  const fetchAll = async () => {
    setLoading(true);
    const [{ data: r }, { data: o }] = await Promise.all([
      supabase.from("delivery_routes").select("*").order("created_at", { ascending: true }),
      supabase
        .from("orders")
        .select("id, order_number, delivery_address, total, status, created_at, route_id, customers(name, phone)")
        .eq("shipping_company", "مندوب خاص")
        .order("created_at", { ascending: false })
        .limit(1000),
    ]);
    setRoutes((r as Route[]) || []);
    setOrders(
      ((o as any[]) || []).map((row) => ({
        id: row.id,
        order_number: row.order_number,
        customer_name: row.customers?.name || "—",
        customer_phone: row.customers?.phone || "",
        delivery_address: row.delivery_address,
        total: Number(row.total || 0),
        status: row.status,
        created_at: row.created_at,
        route_id: row.route_id,
      }))
    );
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  const openCreate = () => {
    setEditingRoute(null);
    setForm({ name: "", color: COLORS[routes.length % COLORS.length], notes: "" });
    setDialogOpen(true);
  };
  const openEdit = (r: Route) => {
    setEditingRoute(r);
    setForm({ name: r.name, color: r.color, notes: r.notes || "" });
    setDialogOpen(true);
  };

  const saveRoute = async () => {
    if (!form.name.trim()) { toast.error("اكتب اسم الخط"); return; }
    if (editingRoute) {
      const { error } = await supabase
        .from("delivery_routes")
        .update({ name: form.name.trim(), color: form.color, notes: form.notes || null })
        .eq("id", editingRoute.id);
      if (error) { toast.error(error.message); return; }
      toast.success("تم تحديث الخط");
    } else {
      const { error } = await supabase
        .from("delivery_routes")
        .insert({ name: form.name.trim(), color: form.color, notes: form.notes || null, created_by: user?.id });
      if (error) { toast.error(error.message); return; }
      toast.success("تم إنشاء الخط");
    }
    setDialogOpen(false);
    fetchAll();
  };

  const deleteRoute = async (r: Route) => {
    if (!confirm(`حذف الخط "${r.name}"؟ الطلبات المرتبطة به ستصبح بدون خط.`)) return;
    const { error } = await supabase.from("delivery_routes").delete().eq("id", r.id);
    if (error) { toast.error(error.message); return; }
    toast.success("تم الحذف");
    if (activeTab === r.id) setActiveTab("unassigned");
    fetchAll();
  };

  const assignRoute = async (orderId: string, routeId: string | null) => {
    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, route_id: routeId } : o)));
    const { error } = await supabase.from("orders").update({ route_id: routeId }).eq("id", orderId);
    if (error) {
      toast.error(error.message);
      fetchAll();
    }
  };

  const groupedOrders = useMemo(() => {
    const map: Record<string, OrderRow[]> = { unassigned: [] };
    routes.forEach((r) => (map[r.id] = []));
    orders.forEach((o) => {
      if (o.route_id && map[o.route_id]) map[o.route_id].push(o);
      else map.unassigned.push(o);
    });
    return map;
  }, [orders, routes]);

  const renderOrdersTable = (rows: OrderRow[]) => {
    if (rows.length === 0) {
      return <div className="text-center text-muted-foreground py-8">لا توجد طلبات</div>;
    }
    return (
      <div className="space-y-2">
        {rows.map((o) => (
          <Card key={o.id} className="p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex-1 min-w-[200px]">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono font-bold text-sm">{o.order_number}</span>
                  <Badge variant="outline">{o.status}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(o.created_at), "yyyy-MM-dd HH:mm")}
                  </span>
                </div>
                <div className="mt-1 font-semibold">{o.customer_name}</div>
                {o.customer_phone && (
                  <div className="flex items-center gap-1 text-sm text-muted-foreground" dir="ltr">
                    <Phone className="h-3 w-3" />
                    <a href={`tel:${o.customer_phone}`} className="hover:underline">{o.customer_phone}</a>
                  </div>
                )}
                {o.delivery_address && (
                  <div className="flex items-start gap-1 text-xs text-muted-foreground mt-1">
                    <MapPin className="h-3 w-3 mt-0.5 shrink-0" />
                    <span>{o.delivery_address}</span>
                  </div>
                )}
              </div>
              <div className="flex flex-col items-end gap-2">
                <div className="font-bold text-primary">{o.total.toFixed(2)} ج.م</div>
                {canManageRoutes && (
                  <Select
                    value={o.route_id ?? "none"}
                    onValueChange={(v) => assignRoute(o.id, v === "none" ? null : v)}
                  >
                    <SelectTrigger className="w-44">
                      <SelectValue placeholder="اختر خط" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">بدون خط</SelectItem>
                      {routes.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          <span className="inline-flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full" style={{ background: r.color }} />
                            {r.name}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
    );
  };

  return (
    <div className="container mx-auto p-4 space-y-4" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">خطوط السير</h1>
          <p className="text-sm text-muted-foreground">قسّم طلبات المندوب الخاص حسب المنطقة</p>
        </div>
        {canManageRoutes && (
          <Button onClick={openCreate}>
            <Plus className="ml-1 h-4 w-4" /> خط جديد
          </Button>
        )}
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">جاري التحميل...</div>
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="flex flex-wrap h-auto gap-1">
            <TabsTrigger value="unassigned">
              بدون خط
              <Badge variant="secondary" className="mr-2">{groupedOrders.unassigned.length}</Badge>
            </TabsTrigger>
            {routes.map((r) => (
              <TabsTrigger key={r.id} value={r.id} className="gap-2">
                <span className="h-2 w-2 rounded-full" style={{ background: r.color }} />
                {r.name}
                <Badge variant="secondary" className="mr-1">{groupedOrders[r.id]?.length || 0}</Badge>
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="unassigned">
            <Card>
              <CardHeader><CardTitle className="text-base">طلبات بدون خط سير</CardTitle></CardHeader>
              <CardContent>{renderOrdersTable(groupedOrders.unassigned)}</CardContent>
            </Card>
          </TabsContent>

          {routes.map((r) => (
            <TabsContent key={r.id} value={r.id}>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full" style={{ background: r.color }} />
                      {r.name}
                    </CardTitle>
                    {r.notes && <p className="text-xs text-muted-foreground mt-1">{r.notes}</p>}
                  </div>
                  {canManageRoutes && (
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => openEdit(r)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => deleteRoute(r)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  )}
                </CardHeader>
                <CardContent>{renderOrdersTable(groupedOrders[r.id] || [])}</CardContent>
              </Card>
            </TabsContent>
          ))}
        </Tabs>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>{editingRoute ? "تعديل خط" : "خط جديد"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">اسم الخط</label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="مثال: اوردرات اسكندرية"
              />
            </div>
            <div>
              <label className="text-sm font-medium">اللون</label>
              <div className="flex gap-2 flex-wrap mt-1">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setForm({ ...form, color: c })}
                    className={`h-8 w-8 rounded-full border-2 ${form.color === c ? "border-foreground" : "border-transparent"}`}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">ملاحظات (اختياري)</label>
              <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>إلغاء</Button>
            <Button onClick={saveRoute}>حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
