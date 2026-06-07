import { useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { MapPin, Search, Printer } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useEligibleOrders, usePCRoutes } from "@/hooks/usePrivateCourierData";
import { CourierStatusBadge } from "@/components/private-courier/StatusBadge";
import { openPrintWindow, escapeHtml, fmtNum } from "@/lib/printPdf";
import { normalizeGovernorate, normalizeRegion, PC_REGIONS } from "@/lib/privateCourier/normalize";

export default function PCPlanning() {
  const { data: orders, loading, refetch } = useEligibleOrders();
  const { data: routes } = usePCRoutes();
  const [search, setSearch] = useState("");
  const [govFilter, setGovFilter] = useState<string>("all");
  const [regionFilter, setRegionFilter] = useState<string>("all");
  const [routeFilter, setRouteFilter] = useState<string>("all");
  const [monthFilter, setMonthFilter] = useState<string>("all"); // all | YYYY-MM
  const [assignFilter, setAssignFilter] = useState<string>("all"); // all | assigned | unassigned
  const [bulkRouteByGov, setBulkRouteByGov] = useState<Record<string, string>>({});

  // Decorate each order with normalized fields (display-only — never written back).
  const decorated = useMemo(() => orders.map(o => ({
    ...o,
    _gov: normalizeGovernorate(o.customer_governorate),
    _region: normalizeRegion(o.planning_region),
  })), [orders]);

  const governorates = useMemo(
    () => Array.from(new Set(decorated.map(o => o._gov))).sort(),
    [decorated]
  );
  const regionsInData = useMemo(
    () => Array.from(new Set(decorated.map(o => o._region))).sort(),
    [decorated]
  );

  const months = useMemo(() => {
    const s = new Set<string>();
    decorated.forEach(o => { if (o.created_at) s.add(o.created_at.slice(0, 7)); });
    return Array.from(s).sort().reverse();
  }, [decorated]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return decorated.filter(o => {
      if (govFilter !== "all" && o._gov !== govFilter) return false;
      if (regionFilter !== "all" && o._region !== regionFilter) return false;
      if (routeFilter === "none" && o.assigned_route_id) return false;
      if (routeFilter !== "all" && routeFilter !== "none" && o.assigned_route_id !== routeFilter) return false;
      if (monthFilter !== "all" && (!o.created_at || !o.created_at.startsWith(monthFilter))) return false;
      if (assignFilter === "assigned" && !o.assigned_route_id) return false;
      if (assignFilter === "unassigned" && o.assigned_route_id) return false;
      if (!q) return true;
      return (
        o.order_number?.toLowerCase().includes(q) ||
        o.customer_name?.toLowerCase().includes(q) ||
        o.customer_phone?.toLowerCase().includes(q)
      );
    });
  }, [decorated, search, govFilter, regionFilter, routeFilter, monthFilter, assignFilter]);


  const grouped = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    for (const o of filtered) {
      const g = o._gov;
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(o);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [filtered]);

  const assign = async (orderId: string, routeId: string) => {
    const { error } = await supabase.rpc("pc_assign_order_to_route" as any, {
      p_route_id: routeId, p_order_id: orderId, p_sequence: 0, p_expected_at: null,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("تم تعيين الطلب");
    refetch();
  };

  const bulkAssign = async (gov: string, list: typeof orders, routeId: string) => {
    if (!routeId) return;
    const targets = list.filter(o => !o.assigned_route_id);
    if (!targets.length) { toast.info("جميع الطلبات معينة بالفعل"); return; }
    let ok = 0, fail = 0;
    for (const o of targets) {
      const { error } = await supabase.rpc("pc_assign_order_to_route" as any, {
        p_route_id: routeId, p_order_id: o.id, p_sequence: 0, p_expected_at: null,
      });
      if (error) fail++; else ok++;
    }
    toast.success(`تم تعيين ${ok} طلب${fail ? ` — فشل ${fail}` : ""} (${gov})`);
    refetch();
  };


  const printManifest = (routeId: string) => {
    const route = routes.find(r => r.id === routeId);
    if (!route) return;
    const ords = orders.filter(o => o.assigned_route_id === routeId);
    if (!ords.length) { toast.error("لا توجد طلبات في هذا الخط"); return; }
    const rows = ords.map((o, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(o.order_number)}</td>
        <td>${escapeHtml(o.customer_name)}</td>
        <td>${escapeHtml(o.customer_phone)}</td>
        <td>${escapeHtml(normalizeGovernorate(o.customer_governorate))}</td>
        <td>${escapeHtml(o.delivery_address)}</td>
        <td class="num">${fmtNum(o.total, 2)}</td>
        <td>${escapeHtml(o.payment_method)}</td>
      </tr>`).join("");
    const total = ords.reduce((s, o) => s + Number(o.total || 0), 0);
    const body = `
      <header>
        <div><h1>مانيفست خط السير</h1><div class="en">Route Manifest</div></div>
        <div class="meta">
          <div><b>الخط:</b> ${escapeHtml(route.name)}</div>
          <div><b>التاريخ:</b> ${escapeHtml(route.planned_date || "")}</div>
          <div><b>عدد الطلبات:</b> ${ords.length}</div>
          <div><b>إجمالي المستحق:</b> ${fmtNum(total, 2)} ج.م</div>
        </div>
      </header>
      <table>
        <thead><tr><th>#</th><th>رقم الطلب</th><th>العميل</th><th>الهاتف</th><th>المحافظة</th><th>العنوان</th><th>المستحق</th><th>طريقة الدفع</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    openPrintWindow(`مانيفست ${route.name}`, body);
  };

  return (
    <DashboardLayout>
      <div className="container mx-auto p-4 space-y-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><MapPin className="h-6 w-6 text-primary" />تخطيط الخطوط والتعيين</h1>
          <p className="text-sm text-muted-foreground">الطلبات المؤهلة للمندوب الخاص من المخزن الرئيسي — مجمَّعة حسب المحافظة</p>
        </div>

        <Card>
          <CardContent className="p-3 grid grid-cols-2 md:grid-cols-7 gap-2">
            <div className="relative col-span-2 md:col-span-2">
              <Search className="h-4 w-4 absolute right-3 top-3 text-muted-foreground" />
              <Input className="pr-9" placeholder="بحث برقم الطلب/العميل/الهاتف" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <Select value={monthFilter} onValueChange={setMonthFilter}>
              <SelectTrigger><SelectValue placeholder="الشهر" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الأشهر</SelectItem>
                {months.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={regionFilter} onValueChange={setRegionFilter}>
              <SelectTrigger><SelectValue placeholder="المنطقة" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل المناطق</SelectItem>
                {PC_REGIONS.filter(r => regionsInData.includes(r)).map(r => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={govFilter} onValueChange={setGovFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل المحافظات</SelectItem>
                {governorates.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={assignFilter} onValueChange={setAssignFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                <SelectItem value="unassigned">بدون تعيين</SelectItem>
                <SelectItem value="assigned">معيّن</SelectItem>
              </SelectContent>
            </Select>
            <Select value={routeFilter} onValueChange={setRouteFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الخطوط</SelectItem>
                <SelectItem value="none">بدون خط (في الانتظار)</SelectItem>
                {routes.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {routes.length > 0 && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">طباعة مانيفست لخط</CardTitle></CardHeader>
            <CardContent className="flex gap-2 flex-wrap">
              {routes.map(r => (
                <Button key={r.id} size="sm" variant="outline" onClick={() => printManifest(r.id)}>
                  <Printer className="h-3 w-3 ml-1" />{r.name}
                </Button>
              ))}
            </CardContent>
          </Card>
        )}


        {loading ? <div className="text-center py-12 text-muted-foreground">جاري التحميل…</div> :
          grouped.length === 0 ? <Card><CardContent className="py-12 text-center text-muted-foreground">لا توجد طلبات مطابقة</CardContent></Card> :
            <Accordion type="multiple" defaultValue={grouped.map(([g]) => g).slice(0, 2)} className="space-y-2">
              {grouped.map(([gov, list]) => {
                const total = list.reduce((s, o) => s + Number(o.total || 0), 0);
                return (
                  <AccordionItem key={gov} value={gov} className="border rounded-md">
                    <AccordionTrigger className="px-3 py-2 hover:no-underline">
                      <div className="flex items-center justify-between w-full pl-2">
                        <span className="flex items-center gap-2 font-semibold"><MapPin className="h-4 w-4 text-primary" />{gov}</span>
                        <div className="flex gap-2 items-center">
                          <Badge variant="outline">{list.length} طلب</Badge>
                          <Badge variant="secondary">{total.toLocaleString("ar-EG")} ج.م</Badge>
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="px-3 pb-3 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap bg-muted/40 p-2 rounded-md">
                        <span className="text-xs text-muted-foreground">تعيين جماعي ({list.filter(o=>!o.assigned_route_id).length} بدون تعيين):</span>
                        <Select value={bulkRouteByGov[gov] || ""} onValueChange={(v) => setBulkRouteByGov(p => ({ ...p, [gov]: v }))}>
                          <SelectTrigger className="w-56 h-8 text-xs"><SelectValue placeholder="اختر خط للتعيين الجماعي" /></SelectTrigger>
                          <SelectContent>
                            {routes.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Button size="sm" disabled={!bulkRouteByGov[gov]} onClick={() => bulkAssign(gov, list, bulkRouteByGov[gov])}>تعيين الكل</Button>
                      </div>

                      {list.map(o => (
                        <div key={o.id} className="border rounded-md p-3 bg-card">
                          <div className="flex items-start justify-between gap-2 flex-wrap">
                            <div className="space-y-1 flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-mono text-xs">{o.order_number}</span>
                                <CourierStatusBadge status={o.tracking_status} />
                                <Badge variant="outline" className="text-xs">{o.payment_method}</Badge>
                              </div>
                              <p className="text-sm font-medium">{o.customer_name}</p>
                              <p className="text-xs text-muted-foreground">📞 {o.customer_phone} • {o.delivery_address}</p>
                            </div>
                            <div className="text-left">
                              <p className="font-bold text-primary">{Number(o.total).toLocaleString("ar-EG")} ج.م</p>
                              <Select value={o.assigned_route_id || ""} onValueChange={(v) => assign(o.id, v)}>
                                <SelectTrigger className="w-44 h-8 text-xs"><SelectValue placeholder="اختر خط…" /></SelectTrigger>
                                <SelectContent>
                                  {routes.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        </div>
                      ))}
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>}
      </div>
    </DashboardLayout>
  );
}
