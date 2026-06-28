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
  const [openNewCustody, setOpenNewCustody] = useState(false);
  const [newCourierName, setNewCourierName] = useState("");
  const [newCustodyNotes, setNewCustodyNotes] = useState("");
  const [creatingCustody, setCreatingCustody] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [lastDispatch, setLastDispatch] = useState<{ courierName: string; ordersCount: number; customersCount: number; itemsCount: number; at: string; reference: string; movementsCreated: number; unresolved: string[] } | null>(null);

const MAIN_WAREHOUSE_ID = "5ec781b5-685b-4806-b59a-83a79ea5662c";

  const createCustody = async () => {
    const name = newCourierName.trim();
    if (!name) { toast.error("اكتب اسم المندوب"); return; }
    setCreatingCustody(true);
    try {
      const { data, error } = await (supabase as any)
        .from("courier_goods_custodies")
        .insert({ courier_name: name, notes: newCustodyNotes.trim() || null, opened_by: user?.id ?? null, status: "open" })
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
      const [ordersRes, custodiesRes, assignmentsRes] = await Promise.all([
        (supabase as any)
          .from("orders")
          .select("id, order_number, status, total, customer_id, delivery_address, created_at, customers(name, phone)")
          .in("status", ["pending", "processing", "shipped", "confirmed"])
          .order("created_at", { ascending: false })
          .limit(500),
        (supabase as any)
          .from("courier_goods_custodies")
          .select("id, courier_name, status, opened_at")
          .eq("status", "open")
          .order("opened_at", { ascending: false }),
        (supabase as any)
          .from("courier_order_assignments")
          .select("order_id, status"),
      ]);

      if (ordersRes.error) {
        toast.error("خطأ قراءة الطلبات: " + ordersRes.error.message);
      }

      const rawOrders: any[] = ordersRes.data ?? [];
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
        }));

      const statusCounts: Record<string, number> = {};
      for (const o of rawOrders) statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;
      setDebug({
        raw: rawOrders.length,
        filtered: ordersData.length,
        statuses: statusCounts,
        assignedExcluded: rawOrders.length - ordersData.length,
        error: ordersRes.error?.message,
      });

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
      const courierName = custodies.find(c => c.id === selectedCustodyId)?.courier_name || "المندوب";
      const reference = `DIST-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}-${selectedCustodyId.slice(0, 6)}`;

      // 1) Resolve inventory_item_id per product from the main warehouse
      const productIds = Array.from(new Set(selectedItems.map(it => it.product_id).filter(Boolean))) as string[];
      const invMap = new Map<string, { id: string; unit_cost: number | null }>();
      if (productIds.length > 0) {
        const { data: invRows, error: invErr } = await (supabase as any)
          .from("inventory_items")
          .select("id, product_id, unit_cost")
          .eq("warehouse_id", MAIN_WAREHOUSE_ID)
          .eq("is_active", true)
          .in("product_id", productIds);
        if (invErr) throw invErr;
        for (const r of (invRows ?? [])) invMap.set(r.product_id, { id: r.id, unit_cost: r.unit_cost });
      }

      // 2) Insert real inventory_movements (type=out) — DB trigger decrements stock & assigns movement_no
      const unresolved: string[] = [];
      const movementsPayload = selectedItems
        .map(it => {
          const inv = it.product_id ? invMap.get(it.product_id) : undefined;
          if (!inv) { unresolved.push(it.product_name); return null; }
          const ord = orders.find(o => o.id === it.order_id)!;
          return {
            item_id: inv.id,
            warehouse_id: MAIN_WAREHOUSE_ID,
            source_warehouse_id: MAIN_WAREHOUSE_ID,
            movement_type: "out",
            quantity: Number(it.quantity || 0),
            unit_cost: inv.unit_cost ?? 0,
            party: `عهدة المندوب — ${courierName}`,
            reference,
            reference_type: "courier_custody",
            reference_id: selectedCustodyId,
            module: "courier_distribution",
            reason: "صرف خط توزيع",
            notes: `${ord.order_number} — ${ord.customer_name || ""}`.trim(),
            performed_by: user?.id ?? null,
            performed_at: new Date().toISOString(),
            product_id: it.product_id,
            order_item_id: it.id,
            approval_status: "posted",
          };
        })
        .filter(Boolean) as any[];

      if (movementsPayload.length === 0) {
        throw new Error(`لا يوجد أي صنف مرتبط بالمخزن الرئيسي. تعذر التجهيز. الأصناف: ${unresolved.join("، ")}`);
      }
      const movementByOrderItem = new Map<string, string>();
      const { data: movRows, error: movErr } = await (supabase as any)
        .from("inventory_movements")
        .insert(movementsPayload)
        .select("id, order_item_id");
      if (movErr) throw movErr;
      for (const m of (movRows ?? [])) if (m.order_item_id) movementByOrderItem.set(m.order_item_id, m.id);

      // 3) Insert custody lines (linked to the inventory_movement when resolved)
      const linesPayload = selectedItems.map(it => {
        const ord = orders.find(o => o.id === it.order_id)!;
        const inv = it.product_id ? invMap.get(it.product_id) : undefined;
        return {
          custody_id: selectedCustodyId,
          line_type: "out",
          customer_id: ord.customer_id,
          customer_name: ord.customer_name,
          order_id: it.order_id,
          inventory_item_id: inv?.id ?? null,
          inventory_movement_id: movementByOrderItem.get(it.id) ?? null,
          product_name: it.product_name,
          quantity: Number(it.quantity || 0),
          unit: it.unit || "وحدة",
          unit_price: Number(it.unit_price || 0),
          total_value: Number(it.quantity || 0) * Number(it.unit_price || 0),
          cash_collected: 0,
          performed_at: new Date().toISOString(),
          performed_by: user?.id ?? null,
          notes: `صرف خط ${reference} — ${ord.order_number}`,
        };
      });

      const { error: linesErr } = await (supabase as any)
        .from("courier_goods_custody_lines")
        .insert(linesPayload);
      if (linesErr) throw linesErr;

      // 4) Link orders to custody (assignments) — upsert prevents duplicate dispatch
      const assignPayload = selectedOrders.map(ord => ({
        custody_id: selectedCustodyId,
        order_id: ord.id,
        courier_name: courierName,
        assigned_at: new Date().toISOString(),
        assigned_by: user?.id ?? null,
        status: "with_courier",
      }));
      const { error: assignErr } = await (supabase as any)
        .from("courier_order_assignments")
        .upsert(assignPayload, { onConflict: "order_id" });
      if (assignErr) throw assignErr;

      // 5) Move order status forward (pending -> processing) so it leaves the prep list
      const pendingIds = selectedOrders.filter(o => o.status === "pending").map(o => o.id);
      if (pendingIds.length > 0) {
        await (supabase as any)
          .from("orders")
          .update({ status: "processing" })
          .in("id", pendingIds);
      }

      setLastDispatch({
        courierName,
        ordersCount: selectedOrders.length,
        customersCount: customerGroups.length,
        itemsCount: selectedItems.length,
        at: new Date().toISOString(),
        reference,
        movementsCreated: movementsPayload.length,
        unresolved,
      });
      if (unresolved.length > 0) {
        toast.warning(`تم التجهيز مع ${unresolved.length} صنف بدون حركة مخزون (غير مرتبط بالمخزن الرئيسي)`);
      } else {
        toast.success(`تم تجهيز خط التوزيع ${reference} — ${selectedItems.length} صنف`);
      }
      setSelectedOrderIds(new Set());
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
  const canApprove = !!selectedCustodyId && selectedItems.length > 0 && productTotals.every(p => p.quantity > 0);

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
                  <Input value={newCourierName} onChange={(e) => setNewCourierName(e.target.value)} placeholder="مثال: كيمو" />
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
          <TabsTrigger value="statement"><Users className="h-4 w-4 ml-1" />كشف كيمو حسب العميل</TabsTrigger>
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
                  disabled={saving || !canApprove}
                  onClick={() => setConfirmOpen(true)}
                  title={!selectedCustodyId ? "اختر عهدة أولًا" : selectedItems.length === 0 ? "حدّد طلبًا أولًا" : ""}
                >
                  <CheckCircle2 className="h-4 w-4 ml-1" />
                  {selectedCustodyId && selectedItems.length > 0 ? "تجهيز خط التوزيع / اعتماد الصرف" : "اعتماد الصرف للمندوب"}
                </Button>
                {!canApprove && (
                  <div className="text-[11px] text-muted-foreground mt-2 text-center">
                    {!selectedCustodyId ? "اختر عهدة مفتوحة" : "حدّد طلبًا واحدًا على الأقل"}
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
