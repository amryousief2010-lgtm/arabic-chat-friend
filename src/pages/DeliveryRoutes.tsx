import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Plus, Trash2, Pencil, MapPin, Phone, Search, Truck, Package,
  ChevronLeft, ClipboardList, DollarSign, User, Navigation, Route as RouteIcon,
} from "lucide-react";
import { format } from "date-fns";
import DashboardLayout from "@/components/layout/DashboardLayout";

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
  notes?: string | null;
  governorate: string | null;
}

interface OrderItem {
  id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
}

const COLORS = ["#a855f7", "#f97316", "#22c55e", "#3b82f6", "#ec4899", "#eab308", "#06b6d4", "#ef4444"];

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  "قيد المعالجة": "secondary",
  "تم الشحن": "default",
  "تم التسليم": "default",
  "ملغي": "destructive",
};

export default function DeliveryRoutes() {
  const { user, isGeneralManager } = useAuth();
  const canManageRoutes = user?.id === KIMO_USER_ID || isGeneralManager;

  const [routes, setRoutes] = useState<Route[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeRoute, setActiveRoute] = useState<string>("all");
  const [search, setSearch] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRoute, setEditingRoute] = useState<Route | null>(null);
  const [form, setForm] = useState({ name: "", color: COLORS[0], notes: "" });

  const [detailsOrder, setDetailsOrder] = useState<OrderRow | null>(null);
  const [detailsItems, setDetailsItems] = useState<OrderItem[]>([]);
  const [detailsLoading, setDetailsLoading] = useState(false);

  const fetchAll = async () => {
    setLoading(true);
    const [{ data: r }, { data: o }] = await Promise.all([
      supabase.from("delivery_routes").select("*").order("created_at", { ascending: true }),
      supabase
        .from("orders")
        .select("id, order_number, delivery_address, total, status, created_at, route_id, notes, customers(name, phone)")
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
        notes: row.notes,
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
    if (activeRoute === r.id) setActiveRoute("all");
    fetchAll();
  };

  const assignRoute = async (orderId: string, routeId: string | null) => {
    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, route_id: routeId } : o)));
    const { error } = await supabase.from("orders").update({ route_id: routeId }).eq("id", orderId);
    if (error) {
      toast.error(error.message);
      fetchAll();
    } else {
      toast.success("تم تحديث خط السير");
    }
  };

  const openDetails = async (o: OrderRow) => {
    setDetailsOrder(o);
    setDetailsItems([]);
    setDetailsLoading(true);
    const { data } = await supabase
      .from("order_items")
      .select("id, product_name, quantity, unit_price")
      .eq("order_id", o.id);
    setDetailsItems((data as OrderItem[]) || []);
    setDetailsLoading(false);
  };

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: orders.length, unassigned: 0 };
    routes.forEach((r) => (map[r.id] = 0));
    orders.forEach((o) => {
      if (o.route_id && map[o.route_id] !== undefined) map[o.route_id]++;
      else map.unassigned++;
    });
    return map;
  }, [orders, routes]);

  const totals = useMemo(() => {
    const map: Record<string, number> = { all: 0, unassigned: 0 };
    routes.forEach((r) => (map[r.id] = 0));
    orders.forEach((o) => {
      map.all += o.total;
      if (o.route_id && map[o.route_id] !== undefined) map[o.route_id] += o.total;
      else map.unassigned += o.total;
    });
    return map;
  }, [orders, routes]);

  const filteredOrders = useMemo(() => {
    let rows = orders;
    if (activeRoute === "unassigned") rows = rows.filter((o) => !o.route_id);
    else if (activeRoute !== "all") rows = rows.filter((o) => o.route_id === activeRoute);
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((o) =>
        o.order_number.toLowerCase().includes(q) ||
        o.customer_name.toLowerCase().includes(q) ||
        (o.customer_phone || "").includes(q) ||
        (o.delivery_address || "").toLowerCase().includes(q)
      );
    }
    return rows;
  }, [orders, activeRoute, search]);

  const activeRouteMeta = useMemo(() => {
    if (activeRoute === "all") return { name: "كل الطلبات", color: "hsl(var(--primary))", notes: "جميع طلبات المندوب الخاص" };
    if (activeRoute === "unassigned") return { name: "بدون خط سير", color: "hsl(var(--muted-foreground))", notes: "طلبات لم يتم توزيعها على خط بعد" };
    const r = routes.find((x) => x.id === activeRoute);
    return r ? { name: r.name, color: r.color, notes: r.notes } : null;
  }, [activeRoute, routes]);

  return (
    <DashboardLayout>
      <div className="p-4 lg:p-6 space-y-4" dir="rtl">
        {/* Header */}
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl bg-primary/10 flex items-center justify-center">
              <Truck className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">خطوط السير</h1>
              <p className="text-sm text-muted-foreground">
                نظّم طلبات المندوب الخاص حسب المنطقة وتابع تنفيذها
              </p>
            </div>
          </div>
          {canManageRoutes && (
            <Button onClick={openCreate} className="gap-1">
              <Plus className="h-4 w-4" /> خط جديد
            </Button>
          )}
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard icon={ClipboardList} label="إجمالي الطلبات" value={counts.all} tone="primary" />
          <KpiCard icon={RouteIcon} label="عدد الخطوط" value={routes.length} tone="accent" />
          <KpiCard icon={Navigation} label="بدون خط" value={counts.unassigned} tone="warn" />
          <KpiCard
            icon={DollarSign}
            label="قيمة طلبات الخط الحالي"
            value={`${(totals[activeRoute] || 0).toLocaleString("ar-EG", { maximumFractionDigits: 0 })} ج.م`}
            tone="success"
          />
        </div>

        {/* Split workspace */}
        <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4">
          {/* Routes panel */}
          <Card className="h-fit lg:sticky lg:top-4">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <RouteIcon className="h-4 w-4 text-primary" /> الخطوط
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 pt-0">
              <RouteButton
                active={activeRoute === "all"}
                onClick={() => setActiveRoute("all")}
                color="hsl(var(--primary))"
                name="كل الطلبات"
                count={counts.all}
              />
              <RouteButton
                active={activeRoute === "unassigned"}
                onClick={() => setActiveRoute("unassigned")}
                color="hsl(var(--muted-foreground))"
                name="بدون خط سير"
                count={counts.unassigned}
              />
              <Separator className="my-2" />
              {routes.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">
                  لم يتم إنشاء خطوط بعد
                </p>
              )}
              {routes.map((r) => (
                <div key={r.id} className="group flex items-center gap-1">
                  <RouteButton
                    active={activeRoute === r.id}
                    onClick={() => setActiveRoute(r.id)}
                    color={r.color}
                    name={r.name}
                    count={counts[r.id] || 0}
                  />
                  {canManageRoutes && (
                    <div className="flex opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(r)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => deleteRoute(r)}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Orders pane */}
          <Card className="overflow-hidden">
            <CardHeader className="pb-3 border-b">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="h-3 w-3 rounded-full shrink-0"
                    style={{ background: activeRouteMeta?.color }}
                  />
                  <div className="min-w-0">
                    <CardTitle className="text-base truncate">{activeRouteMeta?.name}</CardTitle>
                    {activeRouteMeta?.notes && (
                      <p className="text-xs text-muted-foreground truncate">{activeRouteMeta.notes}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="font-mono">
                    {filteredOrders.length} طلب
                  </Badge>
                </div>
              </div>
              <div className="relative mt-3">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="ابحث برقم الطلب، الاسم، الهاتف، أو العنوان"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pr-9"
                />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="text-center py-16 text-muted-foreground">جاري التحميل...</div>
              ) : filteredOrders.length === 0 ? (
                <div className="text-center py-16">
                  <Package className="h-10 w-10 mx-auto text-muted-foreground/50 mb-2" />
                  <p className="text-sm text-muted-foreground">لا توجد طلبات في هذا الخط</p>
                </div>
              ) : (
                <ScrollArea className="max-h-[calc(100vh-22rem)]">
                  <ul className="divide-y">
                    {filteredOrders.map((o) => {
                      const routeMeta = routes.find((r) => r.id === o.route_id);
                      return (
                        <li
                          key={o.id}
                          className="p-4 hover:bg-muted/40 transition-colors cursor-pointer"
                          onClick={() => openDetails(o)}
                        >
                          <div className="flex items-start gap-3">
                            <span
                              className="mt-1.5 h-2.5 w-2.5 rounded-full shrink-0"
                              style={{ background: routeMeta?.color || "hsl(var(--muted-foreground))" }}
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-mono font-bold text-sm">{o.order_number}</span>
                                <Badge variant={STATUS_VARIANT[o.status] || "outline"} className="text-[10px]">
                                  {o.status}
                                </Badge>
                                <span className="text-[11px] text-muted-foreground">
                                  {format(new Date(o.created_at), "yyyy-MM-dd HH:mm")}
                                </span>
                              </div>
                              <div className="mt-1 font-semibold text-sm flex items-center gap-1.5">
                                <User className="h-3.5 w-3.5 text-muted-foreground" />
                                {o.customer_name}
                              </div>
                              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs text-muted-foreground">
                                {o.customer_phone && (
                                  <a
                                    href={`tel:${o.customer_phone}`}
                                    onClick={(e) => e.stopPropagation()}
                                    className="flex items-center gap-1 hover:text-primary"
                                    dir="ltr"
                                  >
                                    <Phone className="h-3 w-3" /> {o.customer_phone}
                                  </a>
                                )}
                                {o.delivery_address && (
                                  <span className="flex items-start gap-1 max-w-xs">
                                    <MapPin className="h-3 w-3 mt-0.5 shrink-0" />
                                    <span className="line-clamp-1">{o.delivery_address}</span>
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex flex-col items-end gap-2 shrink-0">
                              <div className="font-bold text-primary text-sm">
                                {o.total.toLocaleString("ar-EG", { maximumFractionDigits: 2 })} ج.م
                              </div>
                              {canManageRoutes ? (
                                <Select
                                  value={o.route_id ?? "none"}
                                  onValueChange={(v) => assignRoute(o.id, v === "none" ? null : v)}
                                >
                                  <SelectTrigger
                                    className="h-8 w-40 text-xs"
                                    onClick={(e) => e.stopPropagation()}
                                  >
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
                              ) : routeMeta ? (
                                <Badge variant="outline" className="text-[10px]">{routeMeta.name}</Badge>
                              ) : null}
                              <ChevronLeft className="h-4 w-4 text-muted-foreground" />
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Create / edit route dialog */}
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

        {/* Order details sheet */}
        <Sheet open={!!detailsOrder} onOpenChange={(open) => !open && setDetailsOrder(null)}>
          <SheetContent side="left" className="w-full sm:max-w-lg overflow-y-auto" dir="rtl">
            {detailsOrder && (
              <>
                <SheetHeader className="text-right">
                  <SheetTitle className="flex items-center gap-2">
                    <Package className="h-5 w-5 text-primary" />
                    تفاصيل الطلب {detailsOrder.order_number}
                  </SheetTitle>
                </SheetHeader>
                <div className="mt-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <Badge variant={STATUS_VARIANT[detailsOrder.status] || "outline"}>
                      {detailsOrder.status}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(detailsOrder.created_at), "yyyy-MM-dd HH:mm")}
                    </span>
                  </div>

                  <Card>
                    <CardContent className="p-3 space-y-2 text-sm">
                      <div className="flex items-center gap-2 font-semibold">
                        <User className="h-4 w-4 text-muted-foreground" />
                        {detailsOrder.customer_name}
                      </div>
                      {detailsOrder.customer_phone && (
                        <a
                          href={`tel:${detailsOrder.customer_phone}`}
                          className="flex items-center gap-2 text-muted-foreground hover:text-primary"
                          dir="ltr"
                        >
                          <Phone className="h-4 w-4" /> {detailsOrder.customer_phone}
                        </a>
                      )}
                      {detailsOrder.delivery_address && (
                        <div className="flex items-start gap-2 text-muted-foreground">
                          <MapPin className="h-4 w-4 mt-0.5 shrink-0" />
                          <span>{detailsOrder.delivery_address}</span>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <div>
                    <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                      <Package className="h-4 w-4" /> المنتجات
                    </h3>
                    {detailsLoading ? (
                      <p className="text-sm text-muted-foreground py-4 text-center">جاري التحميل...</p>
                    ) : detailsItems.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-4 text-center">لا توجد منتجات</p>
                    ) : (
                      <div className="border rounded-lg divide-y">
                        {detailsItems.map((it) => (
                          <div key={it.id} className="p-3 flex items-center justify-between gap-2 text-sm">
                            <div className="flex-1 min-w-0">
                              <div className="font-medium truncate">{it.product_name}</div>
                              <div className="text-xs text-muted-foreground">
                                {it.quantity} × {it.unit_price.toFixed(2)} ج.م
                              </div>
                            </div>
                            <div className="font-semibold text-primary">
                              {(it.quantity * it.unit_price).toFixed(2)} ج.م
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {detailsOrder.notes && (
                    <div>
                      <h3 className="text-sm font-semibold mb-1">ملاحظات</h3>
                      <p className="text-sm text-muted-foreground bg-muted/40 p-3 rounded-lg">
                        {detailsOrder.notes}
                      </p>
                    </div>
                  )}

                  <Separator />
                  <div className="flex items-center justify-between text-lg">
                    <span className="font-semibold">الإجمالي</span>
                    <span className="font-bold text-primary">
                      {detailsOrder.total.toLocaleString("ar-EG", { maximumFractionDigits: 2 })} ج.م
                    </span>
                  </div>

                  {canManageRoutes && (
                    <div>
                      <label className="text-sm font-medium block mb-1">خط السير</label>
                      <Select
                        value={detailsOrder.route_id ?? "none"}
                        onValueChange={(v) => {
                          const newId = v === "none" ? null : v;
                          assignRoute(detailsOrder.id, newId);
                          setDetailsOrder({ ...detailsOrder, route_id: newId });
                        }}
                      >
                        <SelectTrigger><SelectValue placeholder="اختر خط" /></SelectTrigger>
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
                    </div>
                  )}
                </div>
              </>
            )}
          </SheetContent>
        </Sheet>
      </div>
    </DashboardLayout>
  );
}

function KpiCard({
  icon: Icon, label, value, tone,
}: {
  icon: any; label: string; value: string | number;
  tone: "primary" | "accent" | "warn" | "success";
}) {
  const toneClass = {
    primary: "bg-primary/10 text-primary",
    accent: "bg-accent/10 text-accent-foreground",
    warn: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
    success: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  }[tone];
  return (
    <Card>
      <CardContent className="p-3 flex items-center gap-3">
        <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${toneClass}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground truncate">{label}</p>
          <p className="text-lg font-bold truncate">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function RouteButton({
  active, onClick, color, name, count,
}: {
  active: boolean; onClick: () => void; color: string; name: string; count: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
        active ? "bg-primary/10 text-primary font-semibold" : "hover:bg-muted text-foreground"
      }`}
    >
      <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: color }} />
      <span className="flex-1 text-right truncate">{name}</span>
      <Badge variant={active ? "default" : "secondary"} className="text-[10px] h-5 px-1.5">
        {count}
      </Badge>
    </button>
  );
}
