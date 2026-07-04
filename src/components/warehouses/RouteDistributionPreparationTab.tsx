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
import { Truck, Package, Users, CheckCircle2, Loader2, FileText, RefreshCw, Gift, Percent, Coins, Undo2, Plus, AlertTriangle, ListChecks, Printer } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { BulkDeliveryUploadButton } from "@/components/warehouses/BulkDeliveryUploadButton";
import { UnregisteredShipmentsButton } from "@/components/warehouses/UnregisteredShipmentsButton";
import { openPrintWindow, escapeHtml } from "@/lib/printPdf";


import { MAIN_WAREHOUSE_ID as DEFAULT_MAIN_WAREHOUSE_ID } from "@/lib/warehouseItemFilters";

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
  fulfillment_type: string | null;
  source_warehouse_id: string | null;
}

type DeliveryKind = 'kimo' | 'pickup_main' | 'other';
const makeGetDeliveryKind = (warehouseId: string) => (o: Pick<OrderRow, 'fulfillment_type' | 'source_warehouse_id'>): DeliveryKind => {
  const isOwn = o.source_warehouse_id === warehouseId;
  if (isOwn && o.fulfillment_type === 'delivery') return 'kimo';
  if (isOwn && o.fulfillment_type === 'pickup') return 'pickup_main';
  if (o.fulfillment_type === 'delivery_main') return 'kimo';
  if (o.fulfillment_type === 'pickup_main') return 'pickup_main';
  return 'other';
};


interface OrderItemRow {
  id: string;
  order_id: string;
  product_id: string | null;
  product_name: string;
  quantity: number;
  unit_price: number;
  unit?: string | null;
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

interface RouteDistributionPreparationTabProps {
  warehouseId?: string;
  warehouseLabel?: string;
}

export default function RouteDistributionPreparationTab({ warehouseId = DEFAULT_MAIN_WAREHOUSE_ID, warehouseLabel }: RouteDistributionPreparationTabProps = {}) {
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
  const [deliveryFilter, setDeliveryFilter] = useState<'all' | DeliveryKind>('all');
  const [fromDate, setFromDate] = useState<string>('2026-07-01');
  const [openNewCustody, setOpenNewCustody] = useState(false);
  const [newCourierName, setNewCourierName] = useState("");
  const [newCustodyNotes, setNewCustodyNotes] = useState("");
  const [creatingCustody, setCreatingCustody] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState<string>("");
  const [lastDispatch, setLastDispatch] = useState<{ courierName: string; ordersCount: number; customersCount: number; itemsCount: number; at: string; reference: string; movementsCreated: number; unresolved: string[] } | null>(null);

  const getDeliveryKind = useMemo(() => makeGetDeliveryKind(warehouseId), [warehouseId]);

  const isMainWarehouse = warehouseId === DEFAULT_MAIN_WAREHOUSE_ID;
  const courierGroupLabel = isMainWarehouse ? "🛵 كيمو (توصيل رئيسي)" : "🛵 مناديب مخزن العجوزة";
  const courierBadgeLabel = isMainWarehouse ? "🛵 كيمو" : "🛵 مندوب العجوزة";
  const pickupGroupLabel = isMainWarehouse ? "🏬 استلام من الرئيسي" : "🏬 استلام من العجوزة";
  const pickupBadgeLabel = isMainWarehouse ? "🏬 استلام رئيسي" : "🏬 استلام عجوزة";
  const statementTabLabel = isMainWarehouse ? "كشف كيمو حسب العميل" : "كشف المندوب حسب العميل";
  const statementCardTitle = isMainWarehouse ? "كشف كيمو — مفصل حسب العميل" : "كشف مندوب العجوزة — مفصل حسب العميل";
  const courierNamePlaceholder = isMainWarehouse ? "مثال: كيمو" : "مثال: مندوب العجوزة";


  const chunkArray = <T,>(arr: T[], size: number) => {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
    return chunks;
  };

  const createCustody = async () => {
    const name = newCourierName.trim();
    if (!name) { toast.error("اكتب اسم المندوب"); return; }
    setCreatingCustody(true);
    try {
      const { data, error } = await (supabase as any)
        .from("courier_goods_custodies")
        .insert({ courier_name: name, notes: newCustodyNotes.trim() || null, opened_by: user?.id ?? null, status: "open", warehouse_id: warehouseId })
        .select("id, courier_name, status, opened_at")
        .single();
      if (error) throw error;
      toast.success("تم فتح عهدة جديدة لـ " + name);
      setCustodies(prev => [data, ...prev]);
      setSelectedCustodyId(data.id);
      setOpenNewCustody(false);
      setNewCourierName("");
      setNewCustodyNotes("");
    } catch (e: any) {
      toast.error(e.message || "تعذر فتح العهدة");
    } finally {
      setCreatingCustody(false);
    }
  };

  const [debug, setDebug] = useState<{ raw: number; filtered: number; statuses: Record<string, number>; assignedExcluded: number; error?: string }>({ raw: 0, filtered: 0, statuses: {}, assignedExcluded: 0 });

  const loadData = async () => {
    setLoading(true);
    try {
      const [rawOrdersRes, custodiesRes, assignmentsRes] = await Promise.all([
        (supabase as any)
          .from("orders")
          .select("id, order_number, status, total, customer_id, delivery_address, created_at, fulfillment_type, source_warehouse_id, customers(name, phone)")
          .in("status", ["pending", "processing", "shipped", "confirmed"])
          .eq("source_warehouse_id", warehouseId)
          .order("created_at", { ascending: false })
          .limit(500),
        (supabase as any)
          .from("courier_goods_custodies")
          .select("id, courier_name, status, opened_at")
          .eq("status", "open")
          .eq("warehouse_id", warehouseId)
          .order("opened_at", { ascending: false }),
        (supabase as any)
          .from("courier_order_assignments")
          .select("order_id, status")
          .eq("warehouse_id", warehouseId),
      ]);
      if (rawOrdersRes.error) toast.error("خطأ قراءة الطلبات: " + rawOrdersRes.error.message);


      const rawOrders: any[] = rawOrdersRes.data ?? [];
      const assignedIds = new Set<string>(
        (assignmentsRes.data ?? [])
          .filter((a: any) => !["fully_returned", "cancelled"].includes(a.status))
          .map((a: any) => a.order_id)
      );

      const ordersData: OrderRow[] = rawOrders
        .filter(o => !assignedIds.has(o.id))
        .map(o => ({
          id: o.id,
          order_number: o.order_number,
          status: o.status,
          total: o.total,
          customer_id: o.customer_id,
          customer_name: o.customers?.name ?? null,
          customer_phone: o.customers?.phone ?? null,
          delivery_address: o.delivery_address,
          created_at: o.created_at,
          fulfillment_type: o.fulfillment_type ?? null,
          source_warehouse_id: o.source_warehouse_id ?? null,
        }));

      const statusCounts: Record<string, number> = {};
      for (const o of rawOrders) statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;
      setDebug({
        raw: rawOrders.length,
        filtered: ordersData.length,
        statuses: statusCounts,
        assignedExcluded: rawOrders.length - ordersData.length,
        error: rawOrdersRes.error?.message,
      });


      setOrders(ordersData);
      setCustodies(custodiesRes.data ?? []);

      if (!selectedCustodyId && custodiesRes.data?.length) {
        setSelectedCustodyId(custodiesRes.data[0].id);
      }

      if (ordersData.length) {
        const orderIds = ordersData.map(o => o.id);
        const itemChunks = await Promise.all(
          chunkArray(orderIds, 80).map(ids =>
            (supabase as any)
              .from("order_items")
              .select("id, order_id, product_id, product_name, quantity, unit_price")
              .in("order_id", ids)
          )
        );
        const itemError = itemChunks.find(res => res.error)?.error;
        if (itemError) throw new Error("خطأ قراءة أصناف الطلبات: " + itemError.message);
        setItems(itemChunks.flatMap(res => res.data ?? []).map((it: any) => ({ ...it, unit: it.unit ?? null })));
      } else {
        setItems([]);
      }
    } catch (e: any) {
      toast.error(e.message || "خطأ في التحميل");
      setDebug(d => ({ ...d, error: e.message }));
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

  const fromDateMs = useMemo(() => (fromDate ? new Date(fromDate + 'T00:00:00').getTime() : 0), [fromDate]);

  const dateScopedOrders = useMemo(
    () => orders.filter(o => !fromDateMs || new Date(o.created_at).getTime() >= fromDateMs),
    [orders, fromDateMs]
  );

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    return dateScopedOrders.filter(o => {
      if (deliveryFilter !== 'all' && getDeliveryKind(o) !== deliveryFilter) return false;
      if (!q) return true;
      return (
        o.order_number?.toLowerCase().includes(q) ||
        o.customer_name?.toLowerCase().includes(q) ||
        o.customer_phone?.toLowerCase().includes(q)
      );
    });
  }, [dateScopedOrders, search, deliveryFilter]);

  const deliveryCounts = useMemo(() => {
    const c = { kimo: 0, pickup_main: 0, other: 0 };
    for (const o of dateScopedOrders) c[getDeliveryKind(o)]++;
    return c;
  }, [dateScopedOrders]);

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
    if (saving) return; // hard guard against double-click
    if (!selectedCustodyId) { toast.error("اختر عهدة مفتوحة أولاً"); return; }
    if (selectedOrders.length === 0) { toast.error("اختر طلبات أولاً"); return; }
    setSaving(true);
    // Stable idempotency key: generated once per confirm-dialog open; survives retries within the same click cycle.
    const idem = idempotencyKey || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${selectedCustodyId.slice(0, 6)}`;
    if (!idempotencyKey) setIdempotencyKey(idem);
    try {
      const courierName = custodies.find(c => c.id === selectedCustodyId)?.courier_name || "المندوب";
      const orderIds = Array.from(new Set(selectedOrders.map(o => o.id)));

      const { data, error } = await (supabase as any).rpc("approve_distribution_dispatch", {
        p_custody_id: selectedCustodyId,
        p_warehouse_id: warehouseId,
        p_order_ids: orderIds,
        p_idempotency_key: idem,
      });
      if (error) throw error;

      const result = data as { reference: string; movement_ids: string[]; orders_count: number; items_count: number; unresolved: string[]; idempotent_hit: boolean };
      const unresolved: string[] = Array.isArray(result?.unresolved) ? result.unresolved : [];

      setLastDispatch({
        courierName,
        ordersCount: selectedOrders.length,
        customersCount: customerGroups.length,
        itemsCount: result?.items_count ?? selectedItems.length,
        at: new Date().toISOString(),
        reference: result?.reference,
        movementsCreated: Array.isArray(result?.movement_ids) ? result.movement_ids.length : (result?.items_count ?? 0),
        unresolved,
      });
      if (result?.idempotent_hit) {
        toast.info(`تم استدعاء التجهيز السابق نفسه (${result.reference}) — لم يتم تكرار الصرف`);
      } else if (unresolved.length > 0) {
        toast.warning(`تم التجهيز مع ${unresolved.length} صنف بدون حركة مخزون (غير مرتبط بالمخزن الرئيسي)`);
      } else {
        toast.success(`تم تجهيز خط التوزيع ${result?.reference} — ${result?.items_count ?? 0} صنف`);
      }
      setSelectedOrderIds(new Set());
      setIdempotencyKey(""); // reset for next dispatch
      setConfirmOpen(false);
      await loadCustodyLines(selectedCustodyId);
      await loadData();
    } catch (e: any) {
      toast.error(e.message || "تعذر اعتماد الصرف");
    } finally {
      setSaving(false);
    }
  };


  const selectedCustody = custodies.find(c => c.id === selectedCustodyId) || null;
  const canApprove = !!selectedCustodyId && selectedOrders.length > 0 && productTotals.length > 0 && productTotals.every(p => p.quantity > 0);

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
              <SelectContent className="z-[60]">
                {custodies.length === 0 ? (
                  <div className="px-2 py-3 text-xs text-muted-foreground text-center">لا توجد عهد مفتوحة — استخدم «فتح عهدة جديدة»</div>
                ) : custodies.map(c => (
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
          <Dialog open={openNewCustody} onOpenChange={setOpenNewCustody}>
            <DialogTrigger asChild>
              <Button size="sm" className="bg-purple-600 hover:bg-purple-700 text-white">
                <Plus className="h-3 w-3 ml-1" /> فتح عهدة جديدة
              </Button>
            </DialogTrigger>
            <DialogContent dir="rtl">
              <DialogHeader>
                <DialogTitle>فتح عهدة مندوب جديدة</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>اسم المندوب *</Label>
                  <Input value={newCourierName} onChange={(e) => setNewCourierName(e.target.value)} placeholder={courierNamePlaceholder} />
                </div>
                <div>
                  <Label>ملاحظات (اختياري)</Label>
                  <Input value={newCustodyNotes} onChange={(e) => setNewCustodyNotes(e.target.value)} placeholder="خط التوزيع / المنطقة..." />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpenNewCustody(false)}>إلغاء</Button>
                <Button onClick={createCustody} disabled={creatingCustody} className="bg-purple-600 hover:bg-purple-700 text-white">
                  {creatingCustody ? <Loader2 className="h-3 w-3 ml-1 animate-spin" /> : <Plus className="h-3 w-3 ml-1" />}
                  فتح العهدة
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <div className="mr-auto flex items-center gap-2 flex-wrap">
            <Badge className="bg-purple-600">متاح: {orders.length} طلب</Badge>
            <Badge className="bg-orange-500">{new Set(orders.map(o => o.customer_id || o.customer_name)).size} عميل</Badge>
            <Badge className="bg-blue-600">{new Set(items.map(i => i.product_id || i.product_name)).size} صنف</Badge>
            <span className="w-px h-5 bg-border mx-1" />
            <Badge variant="outline" className="bg-white">{selectedOrders.length} محدد</Badge>
            <Badge variant="outline" className="bg-white">{customerGroups.length} عميل محدد</Badge>
            <Badge variant="outline" className="bg-white">{productTotals.length} صنف محدد</Badge>
          </div>
        </CardContent>
      </Card>

      {/* Debug panel */}
      <Card className="border-dashed border-amber-300 bg-amber-50/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            🛠️ تشخيص (Debug) — لقراءة الطلبات من قاعدة البيانات
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs space-y-1">
          <div>الجدول المستخدم: <code>orders</code> + <code>order_items</code> + <code>customers</code> + <code>courier_order_assignments</code></div>
          <div>الفلتر: <code>status IN (pending, processing, shipped, confirmed)</code></div>
          <div>إجمالي مقروء من DB: <b>{debug.raw}</b> — بعد استبعاد المسلَّم لمندوب: <b>{debug.filtered}</b> — مستبعد بسبب assignment: <b>{debug.assignedExcluded}</b></div>
          <div>توزيع الحالات: {Object.entries(debug.statuses).map(([s, n]) => <Badge key={s} variant="outline" className="ml-1">{s}: {n}</Badge>)}</div>
          {debug.error && <div className="text-red-600 font-bold">خطأ: {debug.error}</div>}
        </CardContent>
      </Card>

      <Tabs defaultValue="prepare">
        <TabsList>
          <TabsTrigger value="prepare"><Package className="h-4 w-4 ml-1" />تجهيز الخط</TabsTrigger>
          <TabsTrigger value="summary"><FileText className="h-4 w-4 ml-1" />ملخص الصرف</TabsTrigger>
          <TabsTrigger value="statement"><Users className="h-4 w-4 ml-1" />{statementTabLabel}</TabsTrigger>
        </TabsList>

        {/* Prepare tab */}
        <TabsContent value="prepare" className="space-y-3">
          {/* Workflow guide */}
          <Card className="border-purple-200 bg-white">
            <CardContent className="py-3">
              <div className="flex items-start gap-2 mb-2">
                <ListChecks className="h-4 w-4 text-purple-600 mt-0.5" />
                <div className="text-sm font-bold">سير العمل</div>
              </div>
              <ol className="grid md:grid-cols-5 gap-2 text-xs">
                {[
                  { n: 1, t: "اختر عهدة مفتوحة", done: !!selectedCustodyId },
                  { n: 2, t: "حدّد الطلبات", done: selectedOrders.length > 0 },
                  { n: 3, t: "راجع الأصناف والكميات", done: productTotals.length > 0 },
                  { n: 4, t: "اعتمد الصرف للعهدة", done: !!lastDispatch },
                  { n: 5, t: "طباعة + متابعة عودة المندوب", done: false },
                ].map(s => (
                  <li key={s.n} className={`rounded-md border p-2 flex items-center gap-2 ${s.done ? "bg-emerald-50 border-emerald-300" : "bg-muted/40"}`}>
                    <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${s.done ? "bg-emerald-600 text-white" : "bg-white border"}`}>
                      {s.done ? "✓" : s.n}
                    </span>
                    <span>{s.t}</span>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>

          {/* Alerts */}
          {!selectedCustodyId && (
            <Alert variant="destructive" className="border-orange-300 bg-orange-50 text-orange-900">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>اختر عهدة مفتوحة أولًا</AlertTitle>
              <AlertDescription>
                لا يمكن اعتماد الصرف قبل اختيار عهدة مندوب مفتوحة. استخدم زر «فتح عهدة جديدة» في الأعلى أو اختر من القائمة.
              </AlertDescription>
            </Alert>
          )}
          {selectedCustodyId && selectedOrders.length === 0 && (
            <Alert className="border-purple-200 bg-purple-50 text-purple-900">
              <Package className="h-4 w-4" />
              <AlertTitle>حدّد طلبًا واحدًا على الأقل</AlertTitle>
              <AlertDescription>
                العهدة المختارة: <b>{selectedCustody?.courier_name}</b>. اختر الطلبات من الجدول لتجميع الكميات تلقائيًا.
              </AlertDescription>
            </Alert>
          )}

          {/* Selection summary banner */}
          {selectedOrders.length > 0 && (
            <Card className="border-purple-300 bg-gradient-to-l from-purple-50 to-orange-50">
              <CardContent className="py-3 grid grid-cols-2 md:grid-cols-5 gap-3 text-center">
                <div><div className="text-2xl font-bold text-purple-700">{selectedOrders.length}</div><div className="text-xs text-muted-foreground">طلب محدد</div></div>
                <div><div className="text-2xl font-bold text-purple-700">{customerGroups.length}</div><div className="text-xs text-muted-foreground">عميل</div></div>
                <div><div className="text-2xl font-bold text-orange-700">{productTotals.length}</div><div className="text-xs text-muted-foreground">صنف مختلف</div></div>
                <div><div className="text-2xl font-bold text-orange-700">{productTotals.reduce((s, p) => s + p.quantity, 0).toLocaleString("ar-EG")}</div><div className="text-xs text-muted-foreground">إجمالي الكميات</div></div>
                <div><div className="text-sm font-bold text-emerald-700 truncate">{selectedCustody?.courier_name || "—"}</div><div className="text-xs text-muted-foreground">العهدة المختارة</div></div>
              </CardContent>
            </Card>
          )}

          {/* Success banner after dispatch */}
          {lastDispatch && (
            <Alert className="border-emerald-300 bg-emerald-50 text-emerald-900">
              <CheckCircle2 className="h-4 w-4" />
              <AlertTitle>تم تجهيز خط التوزيع بنجاح — رقم الحركة: <span className="font-mono">{lastDispatch.reference}</span></AlertTitle>
              <AlertDescription className="space-y-2 mt-1">
                <div>
                  المندوب: <b>{lastDispatch.courierName}</b> — {lastDispatch.ordersCount} طلب / {lastDispatch.customersCount} عميل / {lastDispatch.itemsCount} صنف.
                  {" "}تم خصم <b>{lastDispatch.movementsCreated}</b> صنف من المخزن الرئيسي تلقائيًا.
                </div>
                {lastDispatch.unresolved.length > 0 && (
                  <div className="text-amber-800 bg-amber-50 border border-amber-200 rounded p-2 text-xs">
                    تنبيه: لم يتم خصم الأصناف التالية (غير مرتبطة بالمخزن الرئيسي): {lastDispatch.unresolved.join("، ")}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => window.print()}>
                    <Printer className="h-3 w-3 ml-1" /> طباعة خط التوزيع
                  </Button>
                  <Button size="sm" className="bg-purple-600 hover:bg-purple-700 text-white" onClick={() => {
                    window.dispatchEvent(new CustomEvent("warehouses:switch-tab", { detail: "wh-daily-recon" }));
                  }}>
                    <Truck className="h-3 w-3 ml-1" /> متابعة عودة المندوب
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setLastDispatch(null)}>إغلاق</Button>
                </div>
              </AlertDescription>
            </Alert>
          )}

          <div className="grid lg:grid-cols-3 gap-3">
            {/* Orders list */}
            <Card className="lg:col-span-2">
              <CardHeader className="pb-3 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <CardTitle className="text-base">طلبات قسم التسويق</CardTitle>
                    <BulkDeliveryUploadButton />
                    <UnregisteredShipmentsButton />
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex items-center gap-1">
                      <Label className="text-xs whitespace-nowrap">من تاريخ:</Label>
                      <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="w-40 h-8 text-xs" />
                      {fromDate && (
                        <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => setFromDate('')}>مسح</Button>
                      )}
                    </div>
                    <Input
                      placeholder="بحث برقم الطلب / العميل / الجوال…"
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      className="w-64"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {([
                    { k: 'all' as const, label: 'الكل', count: dateScopedOrders.length, cls: 'bg-slate-100 text-slate-700 border-slate-300' },
                    { k: 'kimo' as const, label: courierGroupLabel, count: deliveryCounts.kimo, cls: 'bg-purple-100 text-purple-700 border-purple-300' },
                    { k: 'pickup_main' as const, label: pickupGroupLabel, count: deliveryCounts.pickup_main, cls: 'bg-orange-100 text-orange-700 border-orange-300' },
                    { k: 'other' as const, label: 'غير ذلك', count: deliveryCounts.other, cls: 'bg-slate-50 text-slate-600 border-slate-200' },
                  ]).map(t => (
                    <button
                      key={t.k}
                      type="button"
                      onClick={() => setDeliveryFilter(t.k)}
                      className={`text-xs px-2.5 py-1 rounded-full border transition ${deliveryFilter === t.k ? `${t.cls} font-bold ring-2 ring-offset-1 ring-current/30` : 'bg-white text-muted-foreground border-slate-200 hover:bg-slate-50'}`}
                    >
                      {t.label} <span className="mx-1 opacity-70">({t.count})</span>
                    </button>
                  ))}
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
                          <TableHead>التسليم</TableHead>
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
                                {(() => {
                                  const k = getDeliveryKind(o);
                                  if (k === 'kimo') return <Badge className="bg-purple-100 text-purple-700 border border-purple-300 text-[10px]">{courierBadgeLabel}</Badge>;
                                  if (k === 'pickup_main') return <Badge className="bg-orange-100 text-orange-700 border border-orange-300 text-[10px]">{pickupBadgeLabel}</Badge>;
                                  return <Badge variant="outline" className="text-[10px]">—</Badge>;
                                })()}
                              </TableCell>
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
                  disabled={saving}
                  onClick={() => {
                    if (!selectedCustodyId) { toast.error("اختر عهدة مفتوحة أولًا (أو افتح عهدة جديدة من الأعلى)"); return; }
                    if (selectedOrders.length === 0) { toast.error("حدّد طلبًا واحدًا على الأقل من قائمة طلبات قسم التسويق"); return; }
                    if (selectedItems.length === 0) { toast.warning("الطلب محدد فعلاً، لكن أصنافه لم تتحمّل بعد. اضغط تحديث أو انتظر لحظة ثم أعد المحاولة."); return; }
                    if (!productTotals.every(p => p.quantity > 0)) { toast.error("بعض الأصناف بكمية صفر — راجع الكميات"); return; }
                    setConfirmOpen(true);
                  }}
                >
                  <CheckCircle2 className="h-4 w-4 ml-1" />
                  {selectedCustodyId && selectedOrders.length > 0 ? "تجهيز خط التوزيع / اعتماد الصرف" : "اعتماد الصرف للمندوب"}
                </Button>
                {!canApprove && (
                  <div className="text-[11px] text-muted-foreground mt-2 text-center">
                    {!selectedCustodyId
                      ? "اختر عهدة مفتوحة"
                      : selectedOrders.length === 0
                        ? "حدّد طلبًا واحدًا على الأقل"
                        : productTotals.length === 0
                          ? "الطلب محدد — جاري/تعذر تحميل الأصناف، اضغط تحديث"
                          : "راجع كميات الأصناف"}
                  </div>
                )}
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
            <CardHeader><CardTitle className="text-base">{statementCardTitle}</CardTitle></CardHeader>
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

      {/* Confirmation dialog */}
      <Dialog open={confirmOpen} onOpenChange={(o) => !saving && setConfirmOpen(o)}>
        <DialogContent dir="rtl" className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-purple-600" /> تأكيد اعتماد الصرف للعهدة
            </DialogTitle>
            <DialogDescription>
              سيتم صرف هذه الكميات على عهدة المندوب وربطها بالطلبات المحددة. هل تريد المتابعة؟
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-md border bg-purple-50/60 p-2">
              <div className="text-xs text-muted-foreground">المندوب / العهدة</div>
              <div className="font-bold">{selectedCustody?.courier_name || "—"}</div>
            </div>
            <div className="rounded-md border bg-orange-50/60 p-2">
              <div className="text-xs text-muted-foreground">المخزن المصدر</div>
              <div className="font-bold">المخزن الرئيسي</div>
            </div>
            <div className="rounded-md border p-2"><div className="text-xs text-muted-foreground">عدد الطلبات</div><div className="font-bold">{selectedOrders.length}</div></div>
            <div className="rounded-md border p-2"><div className="text-xs text-muted-foreground">عدد العملاء</div><div className="font-bold">{customerGroups.length}</div></div>
            <div className="rounded-md border p-2"><div className="text-xs text-muted-foreground">عدد الأصناف</div><div className="font-bold">{productTotals.length}</div></div>
            <div className="rounded-md border p-2"><div className="text-xs text-muted-foreground">إجمالي الكميات</div><div className="font-bold">{productTotals.reduce((s, p) => s + p.quantity, 0).toLocaleString("ar-EG")}</div></div>
          </div>
          <div className="max-h-56 overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الصنف</TableHead>
                  <TableHead>الكمية</TableHead>
                  <TableHead>عملاء</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {productTotals.map((p, i) => (
                  <TableRow key={i}>
                    <TableCell>{p.product_name}</TableCell>
                    <TableCell className="font-mono">{p.quantity} {p.unit}</TableCell>
                    <TableCell>{p.customers}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={saving}>إلغاء</Button>
            <Button onClick={approveDispatch} disabled={saving || !canApprove} className="bg-purple-600 hover:bg-purple-700">
              {saving ? <><Loader2 className="h-4 w-4 ml-1 animate-spin" />جاري التنفيذ…</> : <><CheckCircle2 className="h-4 w-4 ml-1" />نعم، اعتمد الصرف</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
