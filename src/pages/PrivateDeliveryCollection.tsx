import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Printer, Wallet, RefreshCw } from "lucide-react";
import { formatDate } from "@/lib/dateFormat";

interface OrderRow {
  id: string;
  order_number: string | null;
  total: number;
  created_at: string;
  delivered_at: string | null;
  payment_method: string | null;
  moderator: string | null;
  customer_name?: string | null;
}

const fmt = (n: number) => Number(n || 0).toLocaleString("en-US");

const PrivateDeliveryCollection = () => {
  const { user, profile, canCollectPrivateDelivery } = useAuth();
  const [loading, setLoading] = useState(true);
  const [mainWhId, setMainWhId] = useState<string | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [activeRep, setActiveRep] = useState<string>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [cashAmount, setCashAmount] = useState("");
  const [vodafoneAmount, setVodafoneAmount] = useState("");
  const [instapayAmount, setInstapayAmount] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"pending" | "history">("pending");
  const [history, setHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data: wh } = await supabase.from("warehouses").select("id, name").eq("is_active", true);
      const main = (wh || []).find((w: any) => w.name?.includes("الرئيسي") || w.name?.includes("المقر"));
      setMainWhId(main?.id ?? null);
      if (!main?.id) { setOrders([]); return; }

      const { data: ords } = await supabase
        .from("orders")
        .select("id, order_number, total, created_at, delivered_at, payment_method, moderator, customer_id")
        .eq("source_warehouse_id", main.id)
        .eq("shipping_company", "مندوب خاص")
        .eq("status", "delivered")
        .neq("payment_status", "paid")
        .order("delivered_at", { ascending: false })
        .limit(1000);

      const list = (ords || []) as any[];
      const ids = Array.from(new Set(list.map((o) => o.customer_id).filter(Boolean)));
      let nameMap: Record<string, string> = {};
      if (ids.length) {
        const { data: cs } = await supabase.from("customers").select("id, name").in("id", ids);
        nameMap = Object.fromEntries((cs || []).map((c: any) => [c.id, c.name]));
      }
      setOrders(list.map((o) => ({ ...o, customer_name: nameMap[o.customer_id] || "-" })));
      setSelected({});
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      const { data } = await supabase
        .from("delivery_collection_batches")
        .select("id, rep_name, expected_total, actual_total, variance_reason, notes, collected_at, collector_id, delivery_collection_batch_orders(order_id, order_total)")
        .order("collected_at", { ascending: false })
        .limit(200);
      const list = (data || []) as any[];
      const collectorIds = Array.from(new Set(list.map((b) => b.collector_id).filter(Boolean)));
      let nameMap: Record<string, string> = {};
      if (collectorIds.length) {
        const { data: ps } = await supabase.from("profiles").select("id, full_name").in("id", collectorIds);
        nameMap = Object.fromEntries((ps || []).map((p: any) => [p.id, p.full_name]));
      }
      setHistory(list.map((b) => ({ ...b, collector_name: nameMap[b.collector_id] || "-" })));
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => { if (tab === "history") loadHistory(); }, [tab]);

  const reps = useMemo(() => {
    const s = new Set<string>();
    orders.forEach((o) => s.add(o.moderator || "غير محدد"));
    return Array.from(s);
  }, [orders]);

  const filtered = useMemo(() => {
    if (activeRep === "all") return orders;
    return orders.filter((o) => (o.moderator || "غير محدد") === activeRep);
  }, [orders, activeRep]);

  const selectedOrders = useMemo(() => filtered.filter((o) => selected[o.id]), [filtered, selected]);
  const expectedTotal = useMemo(() => selectedOrders.reduce((s, o) => s + Number(o.total || 0), 0), [selectedOrders]);

  const openCollect = () => {
    if (selectedOrders.length === 0) { toast.error("اختر طلبات أولاً"); return; }
    setActualAmount(String(expectedTotal));
    setReason("");
    setNotes("");
    setDialogOpen(true);
  };

  const variance = (Number(actualAmount) || 0) - expectedTotal;
  const needsReason = Math.abs(variance) > 0.001;

  const submit = async (doPrint: boolean) => {
    if (!user) return;
    if (needsReason && !reason.trim()) { toast.error("اذكر سبب الفرق"); return; }
    setSaving(true);
    try {
      const repName = activeRep === "all" ? (selectedOrders[0]?.moderator || "غير محدد") : activeRep;
      const { data: batch, error: bErr } = await supabase
        .from("delivery_collection_batches")
        .insert({
          rep_name: repName,
          collector_id: user.id,
          expected_total: expectedTotal,
          actual_total: Number(actualAmount) || 0,
          variance_reason: needsReason ? reason.trim() : null,
          notes: notes.trim() || null,
        })
        .select("id, collected_at")
        .single();
      if (bErr || !batch) throw bErr || new Error("failed");

      const links = selectedOrders.map((o) => ({
        batch_id: batch.id,
        order_id: o.id,
        order_total: Number(o.total || 0),
      }));
      const { error: lErr } = await supabase.from("delivery_collection_batch_orders").insert(links);
      if (lErr) throw lErr;

      const { error: uErr } = await supabase
        .from("orders")
        .update({
          payment_status: "paid",
          collected_by: user.id,
          collected_at: batch.collected_at,
          collection_batch_id: batch.id,
        })
        .in("id", selectedOrders.map((o) => o.id));
      if (uErr) throw uErr;

      toast.success(`تم تحصيل ${selectedOrders.length} أوردر`);
      if (doPrint) printReceipt({
        batchId: batch.id,
        collectedAt: batch.collected_at,
        collector: profile?.full_name || "",
        rep: repName,
        orders: selectedOrders,
        expected: expectedTotal,
        actual: Number(actualAmount) || 0,
        variance,
        reason: needsReason ? reason.trim() : "",
        notes: notes.trim(),
      });
      setDialogOpen(false);
      await load();
    } catch (e: any) {
      toast.error(e.message || "تعذّر الحفظ");
    } finally {
      setSaving(false);
    }
  };

  if (!canCollectPrivateDelivery) {
    return <DashboardLayout><Header title="غير مصرح" subtitle="" /></DashboardLayout>;
  }

  return (
    <DashboardLayout>
      <Header title="تحصيل أوردرات المندوب الخاص" subtitle="تحصيل دفعات نقدية من مناديب الشحن الخاص" />

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="pending">بانتظار التحصيل ({orders.length})</TabsTrigger>
          <TabsTrigger value="history">سجل التحصيلات</TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <CardTitle className="flex items-center gap-2">
                  <Wallet className="w-5 h-5 text-primary" />
                  أوردرات بانتظار التحصيل ({orders.length})
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={load} disabled={loading}>
                    <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                  </Button>
                  <Button size="sm" onClick={openCollect} disabled={selectedOrders.length === 0}>
                    تحصيل دفعة ({selectedOrders.length}) — {fmt(expectedTotal)} ج
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Tabs value={activeRep} onValueChange={(v) => { setActiveRep(v); setSelected({}); }}>
                <TabsList className="flex flex-wrap h-auto">
                  <TabsTrigger value="all">الكل ({orders.length})</TabsTrigger>
                  {reps.map((r) => (
                    <TabsTrigger key={r} value={r}>
                      {r} ({orders.filter((o) => (o.moderator || "غير محدد") === r).length})
                    </TabsTrigger>
                  ))}
                </TabsList>
                <TabsContent value={activeRep} className="mt-4">
                  <div className="border rounded-lg overflow-x-auto">
                    <table className="w-full text-right text-sm">
                      <thead className="bg-muted/60 text-xs">
                        <tr>
                          <th className="p-2 w-10">
                            <Checkbox
                              checked={filtered.length > 0 && filtered.every((o) => selected[o.id])}
                              onCheckedChange={(c) => {
                                const next: Record<string, boolean> = { ...selected };
                                filtered.forEach((o) => { next[o.id] = !!c; });
                                setSelected(next);
                              }}
                            />
                          </th>
                          <th className="p-2">رقم الأوردر</th>
                          <th className="p-2">العميل</th>
                          <th className="p-2">المندوب</th>
                          <th className="p-2">طريقة الدفع</th>
                          <th className="p-2">تاريخ التسليم</th>
                          <th className="p-2">المبلغ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((o) => (
                          <tr key={o.id} className="border-b hover:bg-muted/30">
                            <td className="p-2">
                              <Checkbox
                                checked={!!selected[o.id]}
                                onCheckedChange={(c) => setSelected((s) => ({ ...s, [o.id]: !!c }))}
                              />
                            </td>
                            <td className="p-2 font-mono text-xs">{o.order_number || o.id.slice(0, 8)}</td>
                            <td className="p-2">{o.customer_name}</td>
                            <td className="p-2"><Badge variant="outline">{o.moderator || "—"}</Badge></td>
                            <td className="p-2">{o.payment_method === "cash" ? "نقدي" : "إلكتروني"}</td>
                            <td className="p-2 text-xs">{o.delivered_at ? formatDate(o.delivered_at) : "—"}</td>
                            <td className="p-2 font-semibold">{fmt(o.total)} ج</td>
                          </tr>
                        ))}
                        {filtered.length === 0 && (
                          <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">لا توجد أوردرات بانتظار التحصيل</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Wallet className="w-5 h-5 text-primary" />
                  سجل الدفعات المحصّلة ({history.length})
                </CardTitle>
                <Button size="sm" variant="outline" onClick={loadHistory} disabled={historyLoading}>
                  <RefreshCw className={`w-4 h-4 ${historyLoading ? "animate-spin" : ""}`} />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="border rounded-lg overflow-x-auto">
                <table className="w-full text-right text-sm">
                  <thead className="bg-muted/60 text-xs">
                    <tr>
                      <th className="p-2">التاريخ</th>
                      <th className="p-2">المندوب</th>
                      <th className="p-2">المُحصِّل</th>
                      <th className="p-2">عدد الأوردرات</th>
                      <th className="p-2">المطلوب</th>
                      <th className="p-2">المحصّل</th>
                      <th className="p-2">الفرق / السبب</th>
                      <th className="p-2">ملاحظات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((b) => {
                      const v = Number(b.actual_total) - Number(b.expected_total);
                      return (
                        <tr key={b.id} className="border-b hover:bg-muted/30">
                          <td className="p-2 text-xs">{formatDate(b.collected_at)}</td>
                          <td className="p-2"><Badge variant="outline">{b.rep_name}</Badge></td>
                          <td className="p-2 text-xs">{b.collector_name}</td>
                          <td className="p-2">{b.delivery_collection_batch_orders?.length || 0}</td>
                          <td className="p-2">{fmt(b.expected_total)} ج</td>
                          <td className="p-2 font-semibold">{fmt(b.actual_total)} ج</td>
                          <td className="p-2 text-xs">
                            {Math.abs(v) > 0.001 ? (
                              <span className={v > 0 ? "text-green-700" : "text-orange-700"}>
                                {v > 0 ? `+${fmt(v)}` : fmt(v)} — {b.variance_reason || "-"}
                              </span>
                            ) : "—"}
                          </td>
                          <td className="p-2 text-xs text-muted-foreground">{b.notes || "—"}</td>
                        </tr>
                      );
                    })}
                    {history.length === 0 && (
                      <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">
                        {historyLoading ? "جارٍ التحميل..." : "لا توجد دفعات سابقة"}
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>


      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تحصيل دفعة من المندوب</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between p-3 rounded bg-muted">
              <span>عدد الأوردرات</span>
              <span className="font-bold">{selectedOrders.length}</span>
            </div>
            <div className="flex justify-between p-3 rounded bg-muted">
              <span>المبلغ المطلوب</span>
              <span className="font-bold">{fmt(expectedTotal)} ج</span>
            </div>
            <div>
              <label className="text-xs font-medium">المبلغ الفعلي المحصّل</label>
              <Input
                type="number"
                value={actualAmount}
                onChange={(e) => setActualAmount(e.target.value)}
                className="mt-1"
              />
            </div>
            {needsReason && (
              <div className={`p-2 rounded ${variance > 0 ? "bg-orange-50 border border-orange-200" : "bg-green-50 border border-green-200"}`}>
                <div className="flex justify-between text-xs mb-2">
                  <span>الفرق</span>
                  <span className="font-bold">{variance > 0 ? `نقص ${fmt(variance)} ج` : `زيادة ${fmt(-variance)} ج`}</span>
                </div>
                <label className="text-xs font-medium">سبب الفرق <span className="text-destructive">*</span></label>
                <Input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="مرتجع / خصم / نقص / ..."
                  className="mt-1"
                />
              </div>
            )}
            <div>
              <label className="text-xs font-medium">ملاحظات (اختياري)</label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="mt-1" />
            </div>
          </div>
          <DialogFooter className="gap-2 flex-row">
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>إلغاء</Button>
            <Button variant="secondary" onClick={() => submit(false)} disabled={saving}>حفظ بدون طباعة</Button>
            <Button onClick={() => submit(true)} disabled={saving}>
              <Printer className="w-4 h-4 ml-2" /> حفظ + طباعة
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

interface ReceiptData {
  batchId: string;
  collectedAt: string;
  collector: string;
  rep: string;
  orders: OrderRow[];
  expected: number;
  actual: number;
  variance: number;
  reason: string;
  notes: string;
}

const printReceipt = (d: ReceiptData) => {
  const dt = new Date(d.collectedAt).toLocaleString("ar-EG");
  const rows = d.orders.map((o, i) => `<tr><td>${i + 1}</td><td>${o.order_number || o.id.slice(0, 8)}</td><td>${o.customer_name || "-"}</td><td>${o.delivered_at ? new Date(o.delivered_at).toLocaleDateString("ar-EG") : "-"}</td><td>${Number(o.total).toLocaleString("en-US")}</td></tr>`).join("");
  const variantRow = Math.abs(d.variance) > 0.001
    ? `<div class="row"><span>الفرق (${d.variance > 0 ? "نقص" : "زيادة"})</span><b>${Math.abs(d.variance).toLocaleString("en-US")} ج</b></div><div class="row"><span>السبب</span><b>${d.reason}</b></div>`
    : "";
  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>إيصال تحصيل</title>
  <style>
    @page { size: A4; margin: 12mm; }
    body { font-family: 'Cairo','Tajawal',Arial,sans-serif; direction: rtl; color: #111; }
    .header { display:flex; justify-content:space-between; border-bottom:2px solid #7c3aed; padding-bottom:10px; margin-bottom:14px; }
    .brand { color:#7c3aed; font-size:20px; font-weight:800; }
    .doc-title { background:#f97316; color:#fff; padding:6px 14px; border-radius:6px; font-weight:700; }
    .meta { display:grid; grid-template-columns:1fr 1fr; gap:6px 16px; font-size:13px; margin-bottom:12px; }
    table { width:100%; border-collapse:collapse; font-size:13px; }
    th,td { border:1px solid #d1d5db; padding:6px 8px; text-align:right; }
    thead th { background:#f3f0ff; color:#4c1d95; font-weight:700; }
    .totals { margin-top:12px; width:340px; margin-inline-start:auto; font-size:13px; }
    .row { display:flex; justify-content:space-between; padding:4px 0; border-bottom:1px dashed #e5e7eb; }
    .grand { border-top:2px solid #7c3aed; padding-top:8px; margin-top:6px; font-size:16px; font-weight:800; color:#7c3aed; }
    .sig { margin-top:40px; display:flex; justify-content:space-between; font-size:12px; }
    .sig div { border-top:1px solid #555; padding-top:6px; width:200px; text-align:center; }
  </style></head><body>
  <div class="header">
    <div class="brand">العاصمة للنعام<small style="display:block;color:#555;font-weight:normal;font-size:12px;">Capital Ostrich</small></div>
    <div class="doc-title">إيصال تحصيل من المندوب</div>
  </div>
  <div class="meta">
    <div><b>المندوب:</b> ${d.rep}</div>
    <div><b>المُحصِّل:</b> ${d.collector}</div>
    <div><b>التاريخ:</b> ${dt}</div>
    <div><b>رقم الدفعة:</b> ${d.batchId.slice(0,8)}</div>
  </div>
  <table>
    <thead><tr><th>#</th><th>رقم الأوردر</th><th>العميل</th><th>تاريخ التسليم</th><th>المبلغ</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="totals">
    <div class="row"><span>عدد الأوردرات</span><b>${d.orders.length}</b></div>
    <div class="row"><span>المبلغ المطلوب</span><b>${d.expected.toLocaleString("en-US")} ج</b></div>
    <div class="row"><span>المبلغ المحصّل</span><b>${d.actual.toLocaleString("en-US")} ج</b></div>
    ${variantRow}
    <div class="row grand"><span>الإجمالي المحصّل</span><b>${d.actual.toLocaleString("en-US")} ج</b></div>
  </div>
  ${d.notes ? `<div style="margin-top:14px;padding:8px;background:#fff7ed;border-right:3px solid #f97316;font-size:12px;"><b>ملاحظات:</b> ${d.notes}</div>` : ""}
  <div class="sig">
    <div>توقيع المندوب</div>
    <div>توقيع المُحصِّل</div>
  </div>
  <script>window.addEventListener('load',()=>setTimeout(()=>{window.focus();window.print();},250));</script>
  </body></html>`;
  const w = window.open("", "_blank", "width=900,height=700");
  if (!w) { toast.error("اسمح بالنوافذ المنبثقة"); return; }
  w.document.write(html);
  w.document.close();
};

export default PrivateDeliveryCollection;
