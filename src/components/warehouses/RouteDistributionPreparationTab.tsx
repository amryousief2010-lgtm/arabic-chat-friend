import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Truck, Package, Users, CheckCircle2, Loader2, FileText, RefreshCw, Gift, Percent, Coins, Undo2 } from "lucide-react";
import { toast } from "sonner";

interface OrderRow {
  id: string;
  order_number: string;
  status: string;
  total: number;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  delivery_address: string | null;
  created_at: string;
}

interface OrderItemRow {
  id: string;
  order_id: string;
  product_id: string | null;
  product_name: string;
  quantity: number;
  unit_price: number;
  unit: string | null;
}

interface CustodyRow {
  id: string;
  courier_name: string;
  status: string;
  opened_at: string;
}

interface CustodyLineRow {
  id: string;
  custody_id: string;
  line_type: string;
  customer_id: string | null;
  customer_name: string | null;
  order_id: string | null;
  product_name: string;
  quantity: number;
  unit: string | null;
  unit_price: number;
  total_value: number;
  cash_collected: number;
  discount_amount: number;
  performed_at: string;
}

const LINE_TYPE_META: Record<string, { label: string; icon: any; color: string }> = {
  out: { label: "صرف", icon: Package, color: "bg-blue-100 text-blue-700" },
  sale: { label: "بيع/تسليم", icon: CheckCircle2, color: "bg-emerald-100 text-emerald-700" },
  return: { label: "مرتجع", icon: Undo2, color: "bg-orange-100 text-orange-700" },
  bonus: { label: "مجاني", icon: Gift, color: "bg-pink-100 text-pink-700" },
  discount: { label: "خصم", icon: Percent, color: "bg-amber-100 text-amber-700" },
  collection: { label: "تحصيل", icon: Coins, color: "bg-green-100 text-green-700" },
};

export default function RouteDistributionPreparationTab() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [items, setItems] = useState<OrderItemRow[]>([]);
  const [custodies, setCustodies] = useState<CustodyRow[]>([]);
  const [custodyLines, setCustodyLines] = useState<CustodyLineRow[]>([]);

  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
  const [selectedCustodyId, setSelectedCustodyId] = useState<string>("");
  const [search, setSearch] = useState("");

  const loadData = async () => {
    setLoading(true);
    try {
      const [ordersRes, custodiesRes] = await Promise.all([
        (supabase as any)
          .from("orders")
          .select("id, order_number, status, total, customer_id, customer_name, customer_phone, delivery_address, created_at")
          .in("status", ["pending", "processing", "shipped", "confirmed"])
          .order("created_at", { ascending: false })
          .limit(500),
        (supabase as any)
          .from("courier_goods_custodies")
          .select("id, courier_name, status, opened_at")
          .eq("status", "open")
          .order("opened_at", { ascending: false }),
      ]);

      const ordersData: OrderRow[] = ordersRes.data ?? [];
      setOrders(ordersData);
      setCustodies(custodiesRes.data ?? []);

      if (!selectedCustodyId && custodiesRes.data?.length) {
        setSelectedCustodyId(custodiesRes.data[0].id);
      }

      if (ordersData.length) {
        const { data: itemsData } = await (supabase as any)
          .from("order_items")
          .select("id, order_id, product_id, product_name, quantity, unit_price, unit")
          .in("order_id", ordersData.map(o => o.id));
        setItems(itemsData ?? []);
      } else {
        setItems([]);
      }
    } catch (e: any) {
      toast.error(e.message || "خطأ في التحميل");
    } finally {
      setLoading(false);
    }
  };

  const loadCustodyLines = async (custodyId: string) => {
    if (!custodyId) { setCustodyLines([]); return; }
    const { data } = await (supabase as any)
      .from("courier_goods_custody_lines")
      .select("id, custody_id, line_type, customer_id, customer_name, order_id, product_name, quantity, unit, unit_price, total_value, cash_collected, discount_amount, performed_at")
      .eq("custody_id", custodyId)
      .order("performed_at", { ascending: false });
    setCustodyLines(data ?? []);
  };

  useEffect(() => { loadData(); }, []);
  useEffect(() => { loadCustodyLines(selectedCustodyId); }, [selectedCustodyId]);

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter(o =>
      o.order_number?.toLowerCase().includes(q) ||
      o.customer_name?.toLowerCase().includes(q) ||
      o.customer_phone?.toLowerCase().includes(q)
    );
  }, [orders, search]);

  const selectedOrders = useMemo(
    () => orders.filter(o => selectedOrderIds.has(o.id)),
    [orders, selectedOrderIds]
  );
  const selectedItems = useMemo(
    () => items.filter(it => selectedOrderIds.has(it.order_id)),
    [items, selectedOrderIds]
  );

  // Aggregate by product
  const productTotals = useMemo(() => {
    const map = new Map<string, { product_name: string; unit: string; quantity: number; customers: number }>();
    for (const it of selectedItems) {
      const key = (it.product_id || it.product_name || "").toString() + "|" + (it.unit || "");
      const ex = map.get(key);
      if (ex) {
        ex.quantity += Number(it.quantity || 0);
      } else {
        map.set(key, {
          product_name: it.product_name,
          unit: it.unit || "وحدة",
          quantity: Number(it.quantity || 0),
          customers: 0,
        });
      }
    }
    // count customers per product
    for (const [key, val] of map) {
      const customerSet = new Set<string>();
      for (const it of selectedItems) {
        const k = (it.product_id || it.product_name || "").toString() + "|" + (it.unit || "");
        if (k === key) {
          const ord = orders.find(o => o.id === it.order_id);
          if (ord?.customer_id) customerSet.add(ord.customer_id);
          else if (ord?.customer_name) customerSet.add(ord.customer_name);
        }
      }
      val.customers = customerSet.size;
    }
    return Array.from(map.values()).sort((a, b) => b.quantity - a.quantity);
  }, [selectedItems, orders]);

  // Group items by customer for preview
  const customerGroups = useMemo(() => {
    const map = new Map<string, { customer_id: string | null; customer_name: string; phone: string | null; orders: OrderRow[]; items: OrderItemRow[] }>();
    for (const ord of selectedOrders) {
      const key = ord.customer_id || ord.customer_name || ord.id;
      const ex = map.get(key);
      const myItems = items.filter(it => it.order_id === ord.id);
      if (ex) {
        ex.orders.push(ord);
        ex.items.push(...myItems);
      } else {
        map.set(key, {
          customer_id: ord.customer_id,
          customer_name: ord.customer_name || "عميل غير محدد",
          phone: ord.customer_phone,
          orders: [ord],
          items: myItems,
        });
      }
    }
    return Array.from(map.values());
  }, [selectedOrders, items]);

  const toggleOrder = (id: string) => {
    const next = new Set(selectedOrderIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedOrderIds(next);
  };
  const toggleAll = () => {
    if (selectedOrderIds.size === filteredOrders.length) setSelectedOrderIds(new Set());
    else setSelectedOrderIds(new Set(filteredOrders.map(o => o.id)));
  };

  const approveDispatch = async () => {
    if (!selectedCustodyId) { toast.error("اختر عهدة مفتوحة أولاً"); return; }
    if (selectedItems.length === 0) { toast.error("اختر طلبات أولاً"); return; }
    setSaving(true);
    try {
      // Build custody lines (one per order_item) + assignments per order
      const linesPayload = selectedItems.map(it => {
        const ord = orders.find(o => o.id === it.order_id)!;
        return {
          custody_id: selectedCustodyId,
          line_type: "out",
          customer_id: ord.customer_id,
          customer_name: ord.customer_name,
          order_id: it.order_id,
          inventory_item_id: null,
          product_name: it.product_name,
          quantity: Number(it.quantity || 0),
          unit: it.unit || "وحدة",
          unit_price: Number(it.unit_price || 0),
          total_value: Number(it.quantity || 0) * Number(it.unit_price || 0),
          cash_collected: 0,
          performed_at: new Date().toISOString(),
          performed_by: user?.id ?? null,
          notes: `صرف خط — ${ord.order_number}`,
        };
      });

      const { error: linesErr } = await (supabase as any)
        .from("courier_goods_custody_lines")
        .insert(linesPayload);
      if (linesErr) throw linesErr;

      const courierName = custodies.find(c => c.id === selectedCustodyId)?.courier_name || "كيمو";
      const assignPayload = selectedOrders.map(ord => ({
        custody_id: selectedCustodyId,
        order_id: ord.id,
        courier_name: courierName,
        assigned_at: new Date().toISOString(),
        assigned_by: user?.id ?? null,
        status: "assigned",
      }));
      // upsert per order_id to avoid duplicates if re-dispatch
      await (supabase as any)
        .from("courier_order_assignments")
        .upsert(assignPayload, { onConflict: "order_id" });

      toast.success(`تم اعتماد صرف ${selectedItems.length} صنف لـ ${customerGroups.length} عميل`);
      setSelectedOrderIds(new Set());
      await loadCustodyLines(selectedCustodyId);
    } catch (e: any) {
      toast.error(e.message || "تعذر اعتماد الصرف");
    } finally {
      setSaving(false);
    }
  };

  // Kimo statement grouped by customer (from custody lines)
  const customerStatement = useMemo(() => {
    const map = new Map<string, { customer_name: string; out: number; delivered: number; bonus: number; discount: number; collected: number; returned: number; lines: CustodyLineRow[] }>();
    for (const l of custodyLines) {
      const key = l.customer_id || l.customer_name || "—";
      let ex = map.get(key);
      if (!ex) {
        ex = { customer_name: l.customer_name || "غير محدد", out: 0, delivered: 0, bonus: 0, discount: 0, collected: 0, returned: 0, lines: [] };
        map.set(key, ex);
      }
      ex.lines.push(l);
      const q = Number(l.quantity || 0);
      const v = Number(l.total_value || 0);
      if (l.line_type === "out") ex.out += v;
      else if (l.line_type === "sale") ex.delivered += v;
      else if (l.line_type === "bonus") ex.bonus += v;
      else if (l.line_type === "discount") ex.discount += Number(l.discount_amount || v);
      else if (l.line_type === "collection") ex.collected += Number(l.cash_collected || v);
      else if (l.line_type === "return") ex.returned += v;
    }
    return Array.from(map.values()).sort((a, b) => b.out - a.out);
  }, [custodyLines]);

  return (
    <div className="space-y-4" dir="rtl">
      {/* Header */}
      <Card className="border-purple-200 bg-gradient-to-l from-purple-50/60 to-orange-50/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Truck className="h-5 w-5 text-purple-600" />
            تجهيز خط التوزيع
          </CardTitle>
          <CardDescription>
            اختر طلبات قسم التسويق → اجمع الكميات → اعتمد الصرف لعهدة المندوب مع ربط كل صنف بالعميل
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">العهدة المفتوحة:</span>
            <Select value={selectedCustodyId} onValueChange={setSelectedCustodyId}>
              <SelectTrigger className="w-60"><SelectValue placeholder="اختر عهدة" /></SelectTrigger>
              <SelectContent>
                {custodies.map(c => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.courier_name} — {new Date(c.opened_at).toLocaleDateString("ar-EG")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" variant="outline" onClick={loadData} disabled={loading}>
            <RefreshCw className={`h-3 w-3 ml-1 ${loading ? "animate-spin" : ""}`} />تحديث
          </Button>
          <div className="mr-auto flex items-center gap-2">
            <Badge variant="outline" className="bg-white">{selectedOrders.length} طلب محدد</Badge>
            <Badge variant="outline" className="bg-white">{customerGroups.length} عميل</Badge>
            <Badge variant="outline" className="bg-white">{productTotals.length} صنف</Badge>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="prepare">
        <TabsList>
          <TabsTrigger value="prepare"><Package className="h-4 w-4 ml-1" />تجهيز الخط</TabsTrigger>
          <TabsTrigger value="summary"><FileText className="h-4 w-4 ml-1" />ملخص الصرف</TabsTrigger>
          <TabsTrigger value="statement"><Users className="h-4 w-4 ml-1" />كشف كيمو حسب العميل</TabsTrigger>
        </TabsList>

        {/* Prepare tab */}
        <TabsContent value="prepare" className="space-y-3">
          <div className="grid lg:grid-cols-3 gap-3">
            {/* Orders list */}
            <Card className="lg:col-span-2">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <CardTitle className="text-base">طلبات قسم التسويق</CardTitle>
                  <Input
                    placeholder="بحث برقم الطلب / العميل / الجوال…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="w-64"
                  />
                </div>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="text-center py-10 text-muted-foreground"><Loader2 className="inline animate-spin ml-2" />جاري التحميل…</div>
                ) : filteredOrders.length === 0 ? (
                  <div className="text-center py-10 text-muted-foreground">لا توجد طلبات حالياً</div>
                ) : (
                  <div className="overflow-auto max-h-[480px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10">
                            <Checkbox
                              checked={selectedOrderIds.size === filteredOrders.length && filteredOrders.length > 0}
                              onCheckedChange={toggleAll}
                            />
                          </TableHead>
                          <TableHead>الطلب</TableHead>
                          <TableHead>العميل</TableHead>
                          <TableHead>الأصناف</TableHead>
                          <TableHead>القيمة</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredOrders.map(o => {
                          const oItems = items.filter(i => i.order_id === o.id);
                          return (
                            <TableRow key={o.id} className={selectedOrderIds.has(o.id) ? "bg-purple-50/60" : ""}>
                              <TableCell><Checkbox checked={selectedOrderIds.has(o.id)} onCheckedChange={() => toggleOrder(o.id)} /></TableCell>
                              <TableCell className="font-mono text-xs">{o.order_number}</TableCell>
                              <TableCell>
                                <div className="font-medium">{o.customer_name || "—"}</div>
                                <div className="text-xs text-muted-foreground">{o.customer_phone}</div>
                              </TableCell>
                              <TableCell className="text-xs">
                                {oItems.slice(0, 3).map(i => (
                                  <div key={i.id}>{i.product_name} — {i.quantity}{i.unit || ""}</div>
                                ))}
                                {oItems.length > 3 && <div className="text-muted-foreground">+{oItems.length - 3}</div>}
                              </TableCell>
                              <TableCell className="font-bold">{Number(o.total || 0).toLocaleString("ar-EG")}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Aggregated totals */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Package className="h-4 w-4 text-orange-600" />إجمالي ما يجب صرفه
                </CardTitle>
              </CardHeader>
              <CardContent>
                {productTotals.length === 0 ? (
                  <div className="text-center py-8 text-sm text-muted-foreground">حدد طلبات لتجميع الكميات</div>
                ) : (
                  <div className="space-y-2 max-h-[420px] overflow-auto">
                    {productTotals.map((p, idx) => (
                      <div key={idx} className="flex items-center justify-between rounded-md border bg-orange-50/40 p-2">
                        <div>
                          <div className="font-medium text-sm">{p.product_name}</div>
                          <div className="text-xs text-muted-foreground">{p.customers} عميل</div>
                        </div>
                        <Badge className="bg-orange-600 text-white text-sm">{p.quantity} {p.unit}</Badge>
                      </div>
                    ))}
                  </div>
                )}
                <Button
                  className="w-full mt-3 bg-purple-600 hover:bg-purple-700"
                  disabled={saving || selectedItems.length === 0 || !selectedCustodyId}
                  onClick={approveDispatch}
                >
                  {saving ? <><Loader2 className="h-4 w-4 ml-1 animate-spin" />جاري الاعتماد…</> : <><CheckCircle2 className="h-4 w-4 ml-1" />اعتماد الصرف للمندوب</>}
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Per-customer preview */}
          {customerGroups.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="h-4 w-4 text-purple-600" />تفصيل التسليم لكل عميل
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {customerGroups.map((g, i) => (
                    <div key={i} className="rounded-lg border bg-card p-3">
                      <div className="font-bold text-sm mb-1">{g.customer_name}</div>
                      <div className="text-xs text-muted-foreground mb-2">{g.phone || ""}</div>
                      <ul className="text-xs space-y-1">
                        {g.items.map((it, j) => (
                          <li key={j} className="flex justify-between">
                            <span>{it.product_name}</span>
                            <span className="font-mono">{it.quantity} {it.unit || ""}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Summary tab */}
        <TabsContent value="summary">
          <Card>
            <CardHeader><CardTitle className="text-base">ملخص الصرف الحالي للعهدة</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>التاريخ</TableHead>
                    <TableHead>النوع</TableHead>
                    <TableHead>العميل</TableHead>
                    <TableHead>الصنف</TableHead>
                    <TableHead>الكمية</TableHead>
                    <TableHead>القيمة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {custodyLines.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">لا توجد حركات بعد</TableCell></TableRow>
                  ) : custodyLines.map(l => {
                    const meta = LINE_TYPE_META[l.line_type] || { label: l.line_type, icon: Package, color: "bg-gray-100" };
                    const Icon = meta.icon;
                    return (
                      <TableRow key={l.id}>
                        <TableCell className="text-xs">{new Date(l.performed_at).toLocaleString("ar-EG")}</TableCell>
                        <TableCell><Badge className={meta.color + " border-0"}><Icon className="h-3 w-3 ml-1 inline" />{meta.label}</Badge></TableCell>
                        <TableCell>{l.customer_name || "—"}</TableCell>
                        <TableCell>{l.product_name}</TableCell>
                        <TableCell className="font-mono">{l.quantity} {l.unit || ""}</TableCell>
                        <TableCell className="font-bold">{Number(l.total_value || 0).toLocaleString("ar-EG")}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Customer statement tab */}
        <TabsContent value="statement">
          <Card>
            <CardHeader><CardTitle className="text-base">كشف كيمو — مفصل حسب العميل</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>العميل</TableHead>
                    <TableHead>المصروف</TableHead>
                    <TableHead>المسلَّم</TableHead>
                    <TableHead>المرتجع</TableHead>
                    <TableHead>المجانيات</TableHead>
                    <TableHead>الخصومات</TableHead>
                    <TableHead>المحصَّل</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customerStatement.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">لا توجد بيانات</TableCell></TableRow>
                  ) : customerStatement.map((c, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{c.customer_name}</TableCell>
                      <TableCell className="font-mono">{c.out.toLocaleString("ar-EG")}</TableCell>
                      <TableCell className="font-mono text-emerald-700">{c.delivered.toLocaleString("ar-EG")}</TableCell>
                      <TableCell className="font-mono text-orange-700">{c.returned.toLocaleString("ar-EG")}</TableCell>
                      <TableCell className="font-mono text-pink-700">{c.bonus.toLocaleString("ar-EG")}</TableCell>
                      <TableCell className="font-mono text-amber-700">{c.discount.toLocaleString("ar-EG")}</TableCell>
                      <TableCell className="font-mono text-green-700 font-bold">{c.collected.toLocaleString("ar-EG")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
