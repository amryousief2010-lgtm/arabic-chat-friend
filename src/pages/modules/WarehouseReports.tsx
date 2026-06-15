import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart3, Download, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import * as XLSX from "xlsx";

const IN_TYPES = ["in", "purchase_receipt", "opening_balance", "sales_return", "finished_goods_receipt", "return", "stock_in"];
const OUT_TYPES = ["out", "sales_dispatch", "transfer", "waste_loss", "production_consumption", "packaging_consumption", "stock_out"];

interface Stock { id: string; warehouse_id: string; name: string; unit: string; stock: number; reserved_qty: number; blocked_qty: number; unit_cost: number; low_stock_threshold: number }

const exportSheet = (name: string, data: any[]) => {
  if (!data.length) return;
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 30));
  XLSX.writeFile(wb, `${name}.xlsx`);
};

export default function WarehouseReports() {
  const [warehouses, setWarehouses] = useState<{ id: string; name: string }[]>([]);
  const [whFilter, setWhFilter] = useState<string>("all");
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [pending, setPending] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);

  const loadStocks = async () => {
    setLoading(true);
    const [{ data: whs }, q] = await Promise.all([
      supabase.from("warehouses").select("id, name"),
      whFilter === "all"
        ? supabase.from("inventory_items").select("id, warehouse_id, name, unit, stock, reserved_qty, blocked_qty, unit_cost, low_stock_threshold").eq("is_active", true).limit(2000)
        : supabase.from("inventory_items").select("id, warehouse_id, name, unit, stock, reserved_qty, blocked_qty, unit_cost, low_stock_threshold").eq("is_active", true).eq("warehouse_id", whFilter).limit(2000),
    ]);
    setWarehouses((whs || []) as any);
    setStocks((q.data || []) as Stock[]);

    // pending reservations from open orders
    const { data: orders } = await supabase
      .from("orders")
      .select("id, source_warehouse_id, stock_status, status")
      .not("status", "in", "(delivered,cancelled)")
      .or("stock_status.is.null,stock_status.neq.dispatched")
      .limit(1000);
    const orderWh: Record<string, string> = {};
    (orders || []).forEach((o: any) => { orderWh[o.id] = o.source_warehouse_id; });
    const oids = Object.keys(orderWh);
    const pendMap: Record<string, number> = {};
    if (oids.length) {
      const { data: oitems } = await supabase.from("order_items").select("order_id, product_id, quantity").in("order_id", oids);
      // map product->item per warehouse:
      const { data: invByProd } = await supabase.from("inventory_items").select("id, warehouse_id, product_id").not("product_id", "is", null);
      const lookup: Record<string, string> = {};
      (invByProd || []).forEach((r: any) => { lookup[`${r.warehouse_id}|${r.product_id}`] = r.id; });
      (oitems || []).forEach((oi: any) => {
        const wh = orderWh[oi.order_id];
        const itemId = lookup[`${wh}|${oi.product_id}`];
        if (itemId) pendMap[itemId] = (pendMap[itemId] || 0) + Number(oi.quantity || 0);
      });
    }
    setPending(pendMap);
    setLoading(false);
  };

  useEffect(() => { loadStocks(); }, [whFilter]);

  const whName = (id: string) => warehouses.find((w) => w.id === id)?.name || "—";

  // Report 1: current stock
  const currentStockRows = useMemo(() => stocks.map((s) => {
    const avail = Number(s.stock || 0) - Number(s.reserved_qty || 0) - Number(s.blocked_qty || 0);
    const value = Number(s.stock || 0) * Number(s.unit_cost || 0);
    const state = Number(s.stock || 0) <= 0 ? "صفر" : Number(s.stock || 0) <= Number(s.low_stock_threshold || 0) ? "منخفض" : "طبيعي";
    return { ...s, whName: whName(s.warehouse_id), avail, value, state };
  }), [stocks, warehouses]);

  // Report 2: available & reserved (uses pending from open orders)
  const availRows = useMemo(() => stocks.map((s) => {
    const reserved = pending[s.id] || Number(s.reserved_qty || 0);
    const avail = Number(s.stock || 0) - reserved - Number(s.blocked_qty || 0);
    return { whName: whName(s.warehouse_id), name: s.name, unit: s.unit, stock: s.stock, reserved, blocked: s.blocked_qty, avail };
  }), [stocks, pending, warehouses]);

  // Inventory value
  const valueByWh = useMemo(() => {
    const map: Record<string, { name: string; total: number; items: number }> = {};
    stocks.forEach((s) => {
      const k = s.warehouse_id;
      map[k] = map[k] || { name: whName(k), total: 0, items: 0 };
      map[k].total += Number(s.stock || 0) * Number(s.unit_cost || 0);
      map[k].items += 1;
    });
    return Object.values(map);
  }, [stocks, warehouses]);

  return (
    <DashboardLayout>
      <div className="space-y-4 p-4" dir="rtl">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
            <BarChart3 className="w-6 h-6 text-primary" />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">تقارير المخازن</h1>
            <p className="text-sm text-muted-foreground">تقارير قراءة فقط مع تصدير Excel وطباعة.</p>
          </div>
          <div className="flex gap-2 items-end">
            <div>
              <Label className="text-xs">المخزن</Label>
              <Select value={whFilter} onValueChange={setWhFilter}>
                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل المخازن</SelectItem>
                  {warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" onClick={loadStocks} disabled={loading}><RefreshCw className="w-4 h-4 ml-1" /> تحديث</Button>
          </div>
        </div>

        <Tabs defaultValue="current">
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="current">الرصيد الحالي</TabsTrigger>
            <TabsTrigger value="avail">المتاح والمحجوز</TabsTrigger>
            <TabsTrigger value="movement">حركة صنف</TabsTrigger>
            <TabsTrigger value="inbound">الوارد</TabsTrigger>
            <TabsTrigger value="outbound">الصادر</TabsTrigger>
            <TabsTrigger value="transfers">التحويلات</TabsTrigger>
            <TabsTrigger value="adjustments">الجرد والتسويات</TabsTrigger>
            <TabsTrigger value="value">قيمة المخزون</TabsTrigger>
          </TabsList>

          {/* Current stock */}
          <TabsContent value="current">
            <Card>
              <CardHeader className="flex flex-row justify-between items-center">
                <CardTitle className="text-base">الرصيد الحالي ({currentStockRows.length})</CardTitle>
                <Button size="sm" variant="outline" onClick={() => exportSheet("الرصيد_الحالي", currentStockRows.map((r) => ({
                  المخزن: r.whName, الصنف: r.name, الفعلي: r.stock, المحجوز: r.reserved_qty, المحظور: r.blocked_qty, المتاح: r.avail, التكلفة: r.unit_cost, القيمة: r.value, الحالة: r.state,
                })))}><Download className="w-4 h-4 ml-1" /> Excel</Button>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>المخزن</TableHead><TableHead>الصنف</TableHead><TableHead>الفعلي</TableHead>
                      <TableHead>المحجوز</TableHead><TableHead>المحظور</TableHead><TableHead>المتاح</TableHead>
                      <TableHead>التكلفة</TableHead><TableHead>القيمة</TableHead><TableHead>الحالة</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {currentStockRows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-xs">{r.whName}</TableCell>
                        <TableCell>{r.name}</TableCell>
                        <TableCell className="font-mono">{Number(r.stock).toLocaleString("ar-EG")}</TableCell>
                        <TableCell className="font-mono">{Number(r.reserved_qty).toLocaleString("ar-EG")}</TableCell>
                        <TableCell className="font-mono">{Number(r.blocked_qty).toLocaleString("ar-EG")}</TableCell>
                        <TableCell className={`font-mono ${r.avail < 0 ? "text-rose-600" : ""}`}>{r.avail.toLocaleString("ar-EG")}</TableCell>
                        <TableCell className="font-mono">{Number(r.unit_cost).toLocaleString("ar-EG")}</TableCell>
                        <TableCell className="font-mono">{r.value.toLocaleString("ar-EG", { maximumFractionDigits: 2 })}</TableCell>
                        <TableCell>
                          <Badge className={r.state === "صفر" ? "bg-rose-500/15 text-rose-700" : r.state === "منخفض" ? "bg-amber-500/15 text-amber-700" : "bg-emerald-500/15 text-emerald-700"}>{r.state}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Available & reserved */}
          <TabsContent value="avail">
            <Card>
              <CardHeader className="flex flex-row justify-between items-center">
                <CardTitle className="text-base">المتاح والمحجوز ({availRows.length})</CardTitle>
                <Button size="sm" variant="outline" onClick={() => exportSheet("المتاح_والمحجوز", availRows)}><Download className="w-4 h-4 ml-1" /> Excel</Button>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>المخزن</TableHead><TableHead>الصنف</TableHead><TableHead>الوحدة</TableHead>
                    <TableHead>الفعلي</TableHead><TableHead>المحجوز</TableHead><TableHead>المحظور</TableHead><TableHead>المتاح للبيع</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {availRows.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs">{r.whName}</TableCell>
                        <TableCell>{r.name}</TableCell><TableCell>{r.unit}</TableCell>
                        <TableCell className="font-mono">{r.stock}</TableCell>
                        <TableCell className="font-mono text-amber-600">{r.reserved}</TableCell>
                        <TableCell className="font-mono">{r.blocked}</TableCell>
                        <TableCell className={`font-mono font-bold ${r.avail < 0 ? "text-rose-600" : "text-emerald-600"}`}>{r.avail}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Item movement */}
          <TabsContent value="movement">
            <ItemMovementReport whFilter={whFilter} warehouses={warehouses} />
          </TabsContent>

          {/* Inbound */}
          <TabsContent value="inbound">
            <MovementsByTypeReport title="الوارد" types={IN_TYPES} whFilter={whFilter} warehouses={warehouses} />
          </TabsContent>

          {/* Outbound */}
          <TabsContent value="outbound">
            <MovementsByTypeReport title="الصادر" types={OUT_TYPES} whFilter={whFilter} warehouses={warehouses} />
          </TabsContent>

          {/* Transfers */}
          <TabsContent value="transfers">
            <TransfersReport warehouses={warehouses} />
          </TabsContent>

          {/* Adjustments */}
          <TabsContent value="adjustments">
            <MovementsByTypeReport title="الجرد_والتسويات" types={["adjustment", "reconciliation"]} whFilter={whFilter} warehouses={warehouses} showReason />
          </TabsContent>

          {/* Inventory value */}
          <TabsContent value="value">
            <Card>
              <CardHeader className="flex flex-row justify-between items-center">
                <CardTitle className="text-base">قيمة المخزون</CardTitle>
                <Button size="sm" variant="outline" onClick={() => exportSheet("قيمة_المخزون", valueByWh)}><Download className="w-4 h-4 ml-1" /> Excel</Button>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>المخزن</TableHead><TableHead>عدد الأصناف</TableHead><TableHead>إجمالي القيمة (ج.م)</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {valueByWh.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell>{r.name}</TableCell>
                        <TableCell>{r.items}</TableCell>
                        <TableCell className="font-mono font-bold">{r.total.toLocaleString("ar-EG", { maximumFractionDigits: 2 })}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-primary/5">
                      <TableCell className="font-bold">الإجمالي العام</TableCell>
                      <TableCell className="font-bold">{valueByWh.reduce((s, r) => s + r.items, 0)}</TableCell>
                      <TableCell className="font-mono font-bold text-primary">{valueByWh.reduce((s, r) => s + r.total, 0).toLocaleString("ar-EG", { maximumFractionDigits: 2 })}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

// ---------- subcomponents ----------

function MovementsByTypeReport({ title, types, whFilter, warehouses, showReason }: { title: string; types: string[]; whFilter: string; warehouses: { id: string; name: string }[]; showReason?: boolean }) {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [rows, setRows] = useState<any[]>([]);
  const [items, setItems] = useState<Record<string, { name: string; unit: string }>>({});
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    let q = supabase.from("inventory_movements")
      .select("id, movement_no, performed_at, warehouse_id, item_id, movement_type, quantity, reference_id, reason, performed_by")
      .in("movement_type", types)
      .gte("performed_at", from + "T00:00:00").lte("performed_at", to + "T23:59:59")
      .order("performed_at", { ascending: false }).limit(1000);
    if (whFilter !== "all") q = q.eq("warehouse_id", whFilter);
    const { data } = await q;
    const list = (data || []) as any[];
    const ids = Array.from(new Set(list.map((m) => m.item_id)));
    if (ids.length) {
      const { data: its } = await supabase.from("inventory_items").select("id, name, unit").in("id", ids);
      const im: Record<string, any> = {};
      (its || []).forEach((it: any) => { im[it.id] = it; });
      setItems(im);
    }
    setRows(list);
    setLoading(false);
  };

  useEffect(() => { load(); }, [whFilter, types.join(",")]);

  const whName = (id: string) => warehouses.find((w) => w.id === id)?.name || "—";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex justify-between items-center">
          <span>{title} ({rows.length})</span>
          <Button size="sm" variant="outline" onClick={() => exportSheet(title, rows.map((r) => ({
            رقم: r.movement_no, التاريخ: new Date(r.performed_at).toLocaleString("ar-EG"), المخزن: whName(r.warehouse_id),
            الصنف: items[r.item_id]?.name || "", النوع: r.movement_type, الكمية: r.quantity, Reference: r.reference_id, السبب: r.reason || "",
          })))}><Download className="w-4 h-4 ml-1" /> Excel</Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2 items-end">
          <div><Label className="text-xs">من</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label className="text-xs">إلى</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <Button size="sm" onClick={load} disabled={loading}><RefreshCw className="w-4 h-4 ml-1" /> تحديث</Button>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>التاريخ</TableHead><TableHead>المخزن</TableHead><TableHead>الصنف</TableHead>
              <TableHead>النوع</TableHead><TableHead>الكمية</TableHead><TableHead>Reference</TableHead>
              {showReason && <TableHead>السبب</TableHead>}
            </TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs">{new Date(r.performed_at).toLocaleString("ar-EG")}</TableCell>
                  <TableCell className="text-xs">{whName(r.warehouse_id)}</TableCell>
                  <TableCell>{items[r.item_id]?.name || "—"}</TableCell>
                  <TableCell><Badge variant="outline">{r.movement_type}</Badge></TableCell>
                  <TableCell className="font-mono">{r.quantity}</TableCell>
                  <TableCell className="font-mono text-xs max-w-[200px] truncate" title={r.reference_id || ""}>{r.reference_id || "—"}</TableCell>
                  {showReason && <TableCell className="text-xs">{r.reason || "—"}</TableCell>}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function ItemMovementReport({ whFilter, warehouses }: { whFilter: string; warehouses: { id: string; name: string }[] }) {
  const [items, setItems] = useState<{ id: string; name: string; unit: string; warehouse_id: string }[]>([]);
  const [itemId, setItemId] = useState<string>("");
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let q = supabase.from("inventory_items").select("id, name, unit, warehouse_id").eq("is_active", true).order("name").limit(2000);
    if (whFilter !== "all") q = q.eq("warehouse_id", whFilter);
    q.then(({ data }) => setItems((data || []) as any));
  }, [whFilter]);

  const load = async () => {
    if (!itemId) return;
    setLoading(true);
    const { data } = await supabase.from("inventory_movements")
      .select("id, performed_at, movement_type, quantity, reference_id, reference_type, notes, reason")
      .eq("item_id", itemId).order("performed_at", { ascending: false }).limit(500);
    let running = 0;
    const sorted = (data || []).slice().reverse();
    const enriched: any[] = sorted.map((m: any) => {
      const before = running;
      if (["in", "purchase_receipt", "opening_balance", "sales_return", "finished_goods_receipt", "return"].includes(m.movement_type)) running += Number(m.quantity);
      else if (["out", "sales_dispatch", "transfer", "waste_loss", "production_consumption", "packaging_consumption"].includes(m.movement_type)) running -= Number(m.quantity);
      else if (["adjustment", "reconciliation"].includes(m.movement_type)) running = Number(m.quantity);
      return { ...m, before, after: running };
    });
    setRows(enriched.reverse());
    setLoading(false);
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">حركة صنف</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2 items-end">
          <div className="min-w-[260px]">
            <Label className="text-xs">الصنف</Label>
            <Select value={itemId} onValueChange={setItemId}>
              <SelectTrigger><SelectValue placeholder="اختر صنفًا" /></SelectTrigger>
              <SelectContent>
                {items.map((it) => <SelectItem key={it.id} value={it.id}>{it.name} — {warehouses.find((w) => w.id === it.warehouse_id)?.name || ""}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={load} disabled={!itemId || loading}><RefreshCw className="w-4 h-4 ml-1" /> عرض</Button>
          <Button variant="outline" onClick={() => exportSheet("حركة_صنف", rows)} disabled={!rows.length}><Download className="w-4 h-4 ml-1" /> Excel</Button>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>التاريخ</TableHead><TableHead>النوع</TableHead><TableHead>قبل</TableHead><TableHead>الكمية</TableHead><TableHead>بعد</TableHead><TableHead>Reference</TableHead><TableHead>السبب/ملاحظات</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rows.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="text-xs">{new Date(m.performed_at).toLocaleString("ar-EG")}</TableCell>
                  <TableCell><Badge variant="outline">{m.movement_type}</Badge></TableCell>
                  <TableCell className="font-mono">{Number(m.before).toFixed(2)}</TableCell>
                  <TableCell className="font-mono">{m.quantity}</TableCell>
                  <TableCell className="font-mono font-bold">{Number(m.after).toFixed(2)}</TableCell>
                  <TableCell className="font-mono text-xs max-w-[200px] truncate">{m.reference_id || "—"}</TableCell>
                  <TableCell className="text-xs">{m.reason || m.notes || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function TransfersReport({ warehouses }: { warehouses: { id: string; name: string }[] }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("warehouse_transfers")
      .select("id, transfer_no, status, source_warehouse_id, destination_warehouse_id, sent_at, received_at, created_by, received_by, sent_by")
      .order("created_at", { ascending: false }).limit(500);
    const tids = (data || []).map((t: any) => t.id);
    const { data: items } = tids.length ? await supabase.from("warehouse_transfer_items").select("transfer_id, requested_qty, sent_qty, received_qty, shortage_qty").in("transfer_id", tids) : { data: [] as any[] };
    const agg: Record<string, { sent: number; recv: number; short: number }> = {};
    (items || []).forEach((it: any) => {
      const a = agg[it.transfer_id] ||= { sent: 0, recv: 0, short: 0 };
      a.sent += Number(it.sent_qty || it.requested_qty || 0);
      a.recv += Number(it.received_qty || 0);
      a.short += Number(it.shortage_qty || 0);
    });
    setRows((data || []).map((t: any) => ({ ...t, ...(agg[t.id] || { sent: 0, recv: 0, short: 0 }) })));
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const whName = (id: string) => warehouses.find((w) => w.id === id)?.name || "—";

  return (
    <Card>
      <CardHeader className="flex flex-row justify-between items-center">
        <CardTitle className="text-base">التحويلات ({rows.length})</CardTitle>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}><RefreshCw className="w-4 h-4 ml-1" /> تحديث</Button>
          <Button variant="outline" size="sm" onClick={() => exportSheet("التحويلات", rows.map((r) => ({
            رقم: r.transfer_no, الحالة: r.status, المصدر: whName(r.source_warehouse_id), الوجهة: whName(r.destination_warehouse_id),
            إرسال: r.sent_at, استلام: r.received_at, مرسل: r.sent, مستلم: r.recv, عجز: r.short,
          })))}><Download className="w-4 h-4 ml-1" /> Excel</Button>
        </div>
      </CardHeader>
      <CardContent className="p-0 overflow-x-auto">
        <Table>
          <TableHeader><TableRow>
            <TableHead>رقم</TableHead><TableHead>المصدر</TableHead><TableHead>الوجهة</TableHead><TableHead>الحالة</TableHead>
            <TableHead>إرسال</TableHead><TableHead>استلام</TableHead><TableHead>مرسل</TableHead><TableHead>مستلم</TableHead><TableHead>عجز</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="font-mono text-xs">{t.transfer_no}</TableCell>
                <TableCell className="text-xs">{whName(t.source_warehouse_id)}</TableCell>
                <TableCell className="text-xs">{whName(t.destination_warehouse_id)}</TableCell>
                <TableCell><Badge variant="outline">{t.status}</Badge></TableCell>
                <TableCell className="text-xs">{t.sent_at ? new Date(t.sent_at).toLocaleDateString("ar-EG") : "—"}</TableCell>
                <TableCell className="text-xs">{t.received_at ? new Date(t.received_at).toLocaleDateString("ar-EG") : "—"}</TableCell>
                <TableCell className="font-mono">{t.sent}</TableCell>
                <TableCell className="font-mono">{t.recv}</TableCell>
                <TableCell className={`font-mono ${t.short > 0 ? "text-rose-600 font-bold" : ""}`}>{t.short}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
