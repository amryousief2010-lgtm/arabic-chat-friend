import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Truck, Package2, Coins, RotateCcw, CheckCircle2, Eye, ClipboardList, Trophy, ChevronDown, ChevronLeft, Printer, FileSpreadsheet, Wrench } from "lucide-react";
import { fetchCourierStatementLines, printCourierStatement, exportCourierStatementExcel } from "@/lib/courierStatement";
import { openPrintWindow } from "@/lib/printPdf";
import { Switch } from "@/components/ui/switch";

/**
 * Order-based custody layer (طبقة عهدة الأوردرات للمندوب) — built on top of:
 *  - public.orders                      (المصدر — الأوردر نفسه)
 *  - public.courier_goods_custodies     (عهدة المندوب المفتوحة)
 *  - public.courier_order_assignments   (الربط بين الأوردر والعهدة)
 *  - public.pc_order_tracking           (حالة دورة المندوب لكل أوردر)
 *  - public.pc_collections              (التحصيلات المرتبطة بالأوردر)
 *  - public.pc_failed_attempts          (المرتجعات/الفشل المرتبطة بالأوردر)
 *
 * لا يلغي طبقة "صرف أصناف" الحالية — يضيف فوقها واجهة تعتمد على الأوردرات.
 */

const COURIER_STATUS_LABEL: Record<string, string> = {
  approved_by_marketing: "معتمد من التسويق",
  prepared_by_warehouse: "مجهز بالمخزن",
  ready_for_pickup_from_main_warehouse: "جاهز للاستلام",
  assigned_to_courier: "مُعيَّن لمندوب",
  picked_up_by_courier: "تم تسليمه للمندوب",
  out_for_delivery: "قيد التوزيع",
  delivered: "تم التسليم للعميل",
  collected: "تم التحصيل",
  completed: "مكتمل",
  failed_delivery: "فشل توصيل",
  partially_returned: "مرتجع جزئي",
  fully_returned: "مرتجع كامل",
  returned_to_warehouse: "عاد للمخزن",
  cancelled: "ملغي",
};

const STATUS_COLOR: Record<string, string> = {
  approved_by_marketing: "bg-blue-500 text-white border border-blue-600",
  prepared_by_warehouse: "bg-indigo-500 text-white border border-indigo-600",
  assigned_to_courier: "bg-violet-500 text-white border border-violet-600",
  picked_up_by_courier: "bg-purple-500 text-white border border-purple-600",
  out_for_delivery: "bg-violet-600 text-white border border-violet-700",
  delivered: "bg-teal-500 text-white border border-teal-600",
  collected: "bg-emerald-500 text-white border border-emerald-600",
  completed: "bg-emerald-600 text-white border border-emerald-700",
  partially_returned: "bg-orange-500 text-white border border-orange-600",
  fully_returned: "bg-rose-500 text-white border border-rose-600",
  failed_delivery: "bg-rose-500 text-white border border-rose-600",
  cancelled: "bg-slate-500 text-white border border-slate-600",
  returned_to_warehouse: "bg-rose-400 text-white border border-rose-500",
  ready_for_pickup_from_main_warehouse: "bg-cyan-500 text-white border border-cyan-600",
};

const STATUS_ICON: Record<string, string> = {
  approved_by_marketing: "✅",
  prepared_by_warehouse: "📦",
  assigned_to_courier: "🧾",
  picked_up_by_courier: "🚚",
  out_for_delivery: "🚚",
  delivered: "✅",
  collected: "💵",
  completed: "🏁",
  partially_returned: "↩️",
  fully_returned: "↩️",
  failed_delivery: "⚠️",
  cancelled: "❌",
  returned_to_warehouse: "🏬",
  ready_for_pickup_from_main_warehouse: "📦",
};

const fmt = (n: number) => new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 2 }).format(n || 0);

type Custody = { id: string; courier_name: string; status: string; opened_at: string };
type Assignment = {
  id: string; custody_id: string; order_id: string; courier_name: string;
  status: string; assigned_at: string; delivered_at: string | null;
  collected_at: string | null; returned_at: string | null; notes: string | null;
};
type Order = {
  id: string; order_number: string; status: string; total: number;
  customer_id?: string | null;
  customer_name?: string | null; created_at: string;
  customers?: { name: string | null; phone: string | null } | null;
};
type Tracking = { order_id: string; courier_status: string | null };
type Collection = { id: string; order_id: string; amount_due: number; amount_collected: number; status: string; collected_at: string };
type FailedAttempt = { id: string; order_id: string; reason: string; notes: string | null; created_at: string };

export default function CourierOrderCustodyTab() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [custodies, setCustodies] = useState<Custody[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [tracking, setTracking] = useState<Record<string, string>>({});
  const [collections, setCollections] = useState<Collection[]>([]);
  const [failures, setFailures] = useState<FailedAttempt[]>([]);

  const [selectedCustody, setSelectedCustody] = useState<string>("");
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignOrderIds, setAssignOrderIds] = useState<string[]>([]);

  const [detailsOrder, setDetailsOrder] = useState<Order | null>(null);
  const [collectOpen, setCollectOpen] = useState<Order | null>(null);
  const [returnOpen, setReturnOpen] = useState<Order | null>(null);
  const [collectAmt, setCollectAmt] = useState("");
  const [collectNotes, setCollectNotes] = useState("");
  const [returnReason, setReturnReason] = useState("customer_refused");
  const [returnNotes, setReturnNotes] = useState("");
  const [returnKind, setReturnKind] = useState<"partial" | "full">("partial");
  const [groupByDay, setGroupByDay] = useState(true);
  const [expandedDays, setExpandedDays] = useState<Record<string, boolean>>({});
  const [correctOpen, setCorrectOpen] = useState<{ assignment: Assignment; order?: Order } | null>(null);
  const [correctAction, setCorrectAction] = useState<"edit_collection_amount" | "reverse_collection" | "reverse_return">("edit_collection_amount");
  const [correctReason, setCorrectReason] = useState("");
  const [correctAmount, setCorrectAmount] = useState("");
  const [correctBusy, setCorrectBusy] = useState(false);
  const [handoverOpen, setHandoverOpen] = useState(false);
  const [handoverAmt, setHandoverAmt] = useState("");
  const [handoverNotes, setHandoverNotes] = useState("");
  const [handoverBusy, setHandoverBusy] = useState(false);

  const printStatement = async (fmt: "pdf" | "xlsx") => {
    if (!selectedCustody) return;
    const cust = custodies.find((c) => c.id === selectedCustody);
    const name = cust?.courier_name || "—";
    try {
      const lines = await fetchCourierStatementLines(selectedCustody);
      if (fmt === "pdf") printCourierStatement(name, selectedCustody, lines);
      else exportCourierStatementExcel(name, lines);
    } catch (e: any) {
      toast({ title: "تعذّر إعداد الكشف", description: e?.message || "", variant: "destructive" });
    }
  };


  const load = async () => {
    setLoading(true);
    const [cstRes, asnRes] = await Promise.all([
      (supabase as any).from("courier_goods_custodies").select("*").eq("status", "open").order("opened_at", { ascending: false }),
      (supabase as any).from("courier_order_assignments").select("*").order("assigned_at", { ascending: false }).limit(2000),
    ]);
    const cst: Custody[] = cstRes.data || [];
    const asn: Assignment[] = asnRes.data || [];
    setCustodies(cst);
    setAssignments(asn);
    if (!selectedCustody && cst.length) setSelectedCustody(cst[0].id);

    // Pull orders that are: (a) prepared/ready for assignment, (b) currently assigned
    const assignedOrderIds = asn.map((a) => a.order_id);
    const [readyOrdersRes, assignedOrdersRes] = await Promise.all([
      (supabase as any).from("orders")
        .select("id, order_number, status, total, customer_id, created_at, customers!orders_customer_id_fkey(name, phone)")
        .in("status", ["pending", "processing", "shipped"])
        .order("created_at", { ascending: false })
        .limit(500),
      assignedOrderIds.length
        ? (supabase as any).from("orders")
            .select("id, order_number, status, total, customer_id, created_at, customers!orders_customer_id_fkey(name, phone)")
            .in("id", assignedOrderIds)
        : Promise.resolve({ data: [] as Order[] }),
    ]);
    const enrich = (o: any): Order => ({ ...o, customer_name: o?.customers?.name ?? null });
    const mergedMap = new Map<string, Order>();
    (readyOrdersRes.data || []).forEach((o: any) => mergedMap.set(o.id, enrich(o)));
    (assignedOrdersRes.data || []).forEach((o: any) => mergedMap.set(o.id, enrich(o)));
    setOrders(Array.from(mergedMap.values()));

    const ids = Array.from(mergedMap.keys());
    if (ids.length) {
      const [trkRes, colRes, failRes] = await Promise.all([
        (supabase as any).from("pc_order_tracking").select("order_id, courier_status").in("order_id", ids),
        (supabase as any).from("pc_collections").select("*").in("order_id", ids),
        (supabase as any).from("pc_failed_attempts").select("*").in("order_id", ids),
      ]);
      const trkMap: Record<string, string> = {};
      (trkRes.data || []).forEach((t: Tracking) => { if (t.courier_status) trkMap[t.order_id] = t.courier_status; });
      setTracking(trkMap);
      setCollections(colRes.data || []);
      setFailures(failRes.data || []);
    } else {
      setTracking({}); setCollections([]); setFailures([]);
    }
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  // ── Eligible orders for assignment: prepared/ready and not already assigned
  const assignedOrderIdSet = useMemo(() => new Set(assignments.map((a) => a.order_id)), [assignments]);
  const eligibleOrders = useMemo(() =>
    orders.filter((o) => !assignedOrderIdSet.has(o.id) && !["delivered", "cancelled", "completed"].includes(o.status)),
  [orders, assignedOrderIdSet]);

  // ── Per-custody analytics (this courier)
  const custodyAnalytics = useMemo(() => {
    return custodies.map((c) => {
      const myAsn = assignments.filter((a) => a.custody_id === c.id);
      const myOrderIds = new Set(myAsn.map((a) => a.order_id));
      const myOrders = orders.filter((o) => myOrderIds.has(o.id));
      const totalValue = myOrders.reduce((s, o) => s + Number(o.total || 0), 0);
      const myCols = collections.filter((cl) => myOrderIds.has(cl.order_id));
      const collected = myCols.reduce((s, cl) => s + Number(cl.amount_collected || 0), 0);
      const delivered = myAsn.filter((a) => ["delivered", "collected", "completed"].includes(a.status)).length;
      const undelivered = myAsn.filter((a) => a.status === "with_courier").length;
      const uncollected = myOrders.filter((o) => !myCols.find((cl) => cl.order_id === o.id)).length;
      const returns = myAsn.filter((a) => ["partially_returned", "fully_returned"].includes(a.status)).length;
      return {
        ...c,
        ordersCount: myAsn.length,
        totalValue,
        collected,
        remaining: Math.max(0, totalValue - collected),
        delivered,
        undelivered,
        uncollected,
        returns,
      };
    });
  }, [custodies, assignments, orders, collections]);

  const dashboard = useMemo(() => {
    const totals = custodyAnalytics.reduce(
      (acc, c) => ({
        orders: acc.orders + c.ordersCount,
        value: acc.value + c.totalValue,
        collected: acc.collected + c.collected,
        returns: acc.returns + c.returns,
        remaining: acc.remaining + c.remaining,
      }),
      { orders: 0, value: 0, collected: 0, returns: 0, remaining: 0 }
    );
    const topDelivery = [...custodyAnalytics].sort((a, b) => b.delivered - a.delivered)[0];
    const topCollect = [...custodyAnalytics].sort((a, b) => b.collected - a.collected)[0];
    return { ...totals, topDelivery, topCollect };
  }, [custodyAnalytics]);

  const current = custodyAnalytics.find((c) => c.id === selectedCustody);
  const currentAssignments = useMemo(
    () => assignments.filter((a) => a.custody_id === selectedCustody),
    [assignments, selectedCustody]
  );

  // Group by assignment date (YYYY-MM-DD)
  const groupedByDay = useMemo(() => {
    const map = new Map<string, Assignment[]>();
    currentAssignments.forEach((a) => {
      const day = (a.assigned_at || "").slice(0, 10);
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push(a);
    });
    return Array.from(map.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([day, items]) => {
        const totalValue = items.reduce((s, a) => {
          const o = orders.find((x) => x.id === a.order_id);
          return s + Number(o?.total || 0);
        }, 0);
        const collected = items.reduce((s, a) => {
          const c = collections.find((cl) => cl.order_id === a.order_id);
          return s + Number(c?.amount_collected || 0);
        }, 0);
        const delivered = items.filter((a) => ["delivered", "collected", "completed"].includes(a.status)).length;
        const returns = items.filter((a) => ["partially_returned", "fully_returned"].includes(a.status)).length;
        return { day, items, totalValue, collected, delivered, returns, remaining: Math.max(0, totalValue - collected) };
      });
  }, [currentAssignments, orders, collections]);

  // ── Actions ─────────────────────────────────────────────────────────────
  const handleAssign = async () => {
    if (!selectedCustody || assignOrderIds.length === 0) return;
    const courier = custodies.find((c) => c.id === selectedCustody)?.courier_name || "";
    try {
      const rows = assignOrderIds.map((order_id) => ({
        custody_id: selectedCustody,
        order_id,
        courier_name: courier,
        assigned_by: user?.id ?? null,
        status: "with_courier",
      }));
      const { error: asnErr } = await (supabase as any).from("courier_order_assignments").insert(rows);
      if (asnErr) throw asnErr;
      // Set tracking status to picked_up_by_courier
      for (const order_id of assignOrderIds) {
        await (supabase as any)
          .from("pc_order_tracking")
          .upsert(
            { order_id, courier_status: "picked_up_by_courier", last_updated_by: user?.id },
            { onConflict: "order_id" }
          );
      }
      toast({ title: "تم تسليم الأوردرات للمندوب", description: `${assignOrderIds.length} أوردر إلى ${courier}` });
      setAssignOpen(false);
      setAssignOrderIds([]);
      load();
    } catch (e: any) {
      toast({ title: "خطأ", description: e.message, variant: "destructive" });
    }
  };

  const updateAssignmentStatus = async (assignmentId: string, orderId: string, status: string, trackingStatus?: string) => {
    const patch: any = { status };
    if (status === "delivered") patch.delivered_at = new Date().toISOString();
    if (status === "collected" || status === "completed") patch.collected_at = new Date().toISOString();
    if (status === "partially_returned" || status === "fully_returned") patch.returned_at = new Date().toISOString();
    const { error } = await (supabase as any).from("courier_order_assignments").update(patch).eq("id", assignmentId);
    if (error) { toast({ title: "خطأ", description: error.message, variant: "destructive" }); return; }
    if (trackingStatus) {
      await (supabase as any).from("pc_order_tracking").upsert(
        { order_id: orderId, courier_status: trackingStatus, last_updated_by: user?.id },
        { onConflict: "order_id" }
      );
    }
    toast({ title: "تم تحديث الحالة" });
    load();
  };

  // Atomic RPC: تسليم + تحصيل (ينشئ سطر sale + يحدث pc_collections + assignment + tracking + orders.status)
  const recordDeliveryAndCollection = async (
    orderId: string,
    amount: number | null,
    notes?: string
  ): Promise<boolean> => {
    const asn = assignments.find((a) => a.order_id === orderId);
    if (!asn) {
      toast({ title: "لا يوجد تعيين لهذا الأوردر", variant: "destructive" });
      return false;
    }
    const idem = `${asn.id}-${Date.now()}`;
    const { error } = await (supabase as any).rpc("record_courier_delivery_and_collection", {
      p_assignment_id: asn.id,
      p_amount_collected: amount,
      p_notes: notes || null,
      p_idempotency_key: idem,
    });
    if (error) {
      toast({ title: "تعذّر حفظ التسليم", description: error.message, variant: "destructive" });
      return false;
    }
    return true;
  };

  const saveCollection = async () => {
    if (!collectOpen) return;
    const amt = Number(collectAmt || 0);
    if (Number.isNaN(amt) || amt < 0) { toast({ title: "مبلغ غير صالح", variant: "destructive" }); return; }
    const ok = await recordDeliveryAndCollection(collectOpen.id, amt, collectNotes);
    if (!ok) return;
    toast({ title: "تم تسجيل التسليم والتحصيل", description: `${fmt(amt)} ج.م` });
    setCollectOpen(null); setCollectAmt(""); setCollectNotes("");
    load();
  };

  const saveReturn = async () => {
    if (!returnOpen) return;
    if (!returnNotes.trim()) { toast({ title: "الملاحظات مطلوبة", variant: "destructive" }); return; }
    await (supabase as any).from("pc_failed_attempts").insert({
      order_id: returnOpen.id,
      reason: returnReason,
      notes: returnNotes,
      next_action: returnKind === "full" ? "return_to_warehouse" : "manager_review",
      created_by: user?.id,
    });
    const asn = assignments.find((a) => a.order_id === returnOpen.id);
    if (returnKind === "full" && asn) {
      const idem = `${asn.id}-${Date.now()}`;
      const { error } = await (supabase as any).rpc("record_courier_return", {
        p_assignment_id: asn.id,
        p_reason: returnReason,
        p_notes: returnNotes,
        p_idempotency_key: idem,
      });
      if (error) { toast({ title: "تعذّر تسجيل المرتجع", description: error.message, variant: "destructive" }); return; }
    } else if (asn) {
      await updateAssignmentStatus(asn.id, returnOpen.id, "partially_returned", "partially_returned");
    }
    await load();
    toast({ title: "تم تسجيل المرتجع وإرجاع البضاعة للمخزن" });
    setReturnOpen(null); setReturnNotes(""); setReturnReason("customer_refused");
  };

  const submitHandover = async () => {
    if (!selectedCustody) return;
    const amt = Number(handoverAmt);
    if (Number.isNaN(amt) || amt <= 0) { toast({ title: "أدخل مبلغ صالح", variant: "destructive" }); return; }
    setHandoverBusy(true);
    try {
      const idem = `${selectedCustody}-${Date.now()}`;
      const { data, error } = await (supabase as any).rpc("submit_courier_cash_handover", {
        p_custody_id: selectedCustody,
        p_amount: amt,
        p_notes: handoverNotes.trim() || null,
        p_idempotency_key: idem,
      });
      if (error) throw error;
      toast({
        title: "تم إرسال التوريد للاعتماد",
        description: `بانتظار محمد شعلة — ${data?.reference || ""}`,
      });
      setHandoverOpen(false); setHandoverAmt(""); setHandoverNotes("");
      await load();
    } catch (e: any) {
      toast({ title: "تعذّر إرسال التوريد", description: e?.message || "", variant: "destructive" });
    } finally { setHandoverBusy(false); }
  };

  const submitCorrection = async () => {
    if (!correctOpen) return;
    if (!correctReason.trim()) { toast({ title: "السبب مطلوب", variant: "destructive" }); return; }
    setCorrectBusy(true);
    try {
      const { error } = await (supabase as any).rpc("correct_courier_assignment", {
        p_assignment_id: correctOpen.assignment.id,
        p_action: correctAction,
        p_reason: correctReason.trim(),
        p_new_amount: correctAction === "edit_collection_amount" ? Number(correctAmount || 0) : null,
      });
      if (error) throw error;
      toast({ title: "تم التصحيح وتسجيله في السجل" });
      setCorrectOpen(null); setCorrectReason(""); setCorrectAmount("");
      await load();
    } catch (e: any) {
      toast({ title: "تعذّر التصحيح", description: e?.message || "", variant: "destructive" });
    } finally { setCorrectBusy(false); }
  };

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4" dir="rtl">
      {/* Dashboard */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card><CardContent className="p-3 text-center">
          <div className="text-xs text-muted-foreground">أوردرات لدى المندوبين</div>
          <div className="text-2xl font-bold text-primary">{dashboard.orders}</div>
        </CardContent></Card>
        <Card><CardContent className="p-3 text-center">
          <div className="text-xs text-muted-foreground">قيمة الأوردرات</div>
          <div className="text-xl font-bold font-mono">{fmt(dashboard.value)}</div>
        </CardContent></Card>
        <Card><CardContent className="p-3 text-center">
          <div className="text-xs text-muted-foreground">إجمالي التحصيلات</div>
          <div className="text-xl font-bold font-mono text-emerald-700">{fmt(dashboard.collected)}</div>
        </CardContent></Card>
        <Card><CardContent className="p-3 text-center">
          <div className="text-xs text-muted-foreground">متبقي للتحصيل</div>
          <div className="text-xl font-bold font-mono text-amber-700">{fmt(dashboard.remaining)}</div>
        </CardContent></Card>
        <Card><CardContent className="p-3 text-center">
          <div className="text-xs text-muted-foreground">مرتجعات</div>
          <div className="text-xl font-bold font-mono text-rose-700">{dashboard.returns}</div>
        </CardContent></Card>
      </div>

      {(dashboard.topDelivery || dashboard.topCollect) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {dashboard.topDelivery && (
            <Card className="bg-purple-50/40 border-purple-200">
              <CardContent className="p-3 flex items-center gap-3">
                <Trophy className="w-7 h-7 text-purple-600" />
                <div>
                  <div className="text-xs text-muted-foreground">أعلى مندوب تسليم</div>
                  <div className="font-bold">{dashboard.topDelivery.courier_name}</div>
                  <div className="text-xs">{dashboard.topDelivery.delivered} أوردر مُسلَّم</div>
                </div>
              </CardContent>
            </Card>
          )}
          {dashboard.topCollect && (
            <Card className="bg-emerald-50/40 border-emerald-200">
              <CardContent className="p-3 flex items-center gap-3">
                <Coins className="w-7 h-7 text-emerald-600" />
                <div>
                  <div className="text-xs text-muted-foreground">أعلى مندوب تحصيل</div>
                  <div className="font-bold">{dashboard.topCollect.courier_name}</div>
                  <div className="text-xs font-mono">{fmt(dashboard.topCollect.collected)} ج.م</div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Custody selector + assignment */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Truck className="w-5 h-5 text-primary" />
            عهدة أوردرات المندوب
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? <div className="text-center py-6 text-muted-foreground">جاري التحميل…</div> :
           custodies.length === 0 ? <div className="text-center py-6 text-muted-foreground">لا توجد عهدة مفتوحة. افتح عهدة من تبويب «خزينة المخزن الرئيسي» أولاً.</div> : (
            <>
              <div className="flex items-center gap-3 flex-wrap">
                <Label className="text-sm">المندوب:</Label>
                <Select value={selectedCustody} onValueChange={setSelectedCustody}>
                  <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {custodies.map((c) => <SelectItem key={c.id} value={c.id}>{c.courier_name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button onClick={() => setAssignOpen(true)} disabled={!selectedCustody}>
                  <Package2 className="w-4 h-4 ml-1" /> تسليم أوردرات للمندوب
                </Button>
                <Button
                  variant="outline"
                  className="border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                  onClick={() => setHandoverOpen(true)}
                  disabled={!selectedCustody || !current || current.collected <= 0}
                  title="توريد نقدية المندوب للخزينة الرئيسية بانتظار الاعتماد"
                >
                  <Coins className="w-4 h-4 ml-1" /> توريد نقدية ({fmt(current?.collected || 0)} ج.م)
                </Button>
                <Button variant="outline" disabled={!selectedCustody} onClick={() => printStatement("pdf")} title="طباعة كشف حساب المندوب (PDF/A4)">
                  <Printer className="w-4 h-4 ml-1" /> طباعة كشف
                </Button>
                <Button variant="outline" disabled={!selectedCustody} onClick={() => printStatement("xlsx")} title="تصدير كشف حساب المندوب Excel">
                  <FileSpreadsheet className="w-4 h-4 ml-1" /> Excel
                </Button>
              </div>

              {current && (
                <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-xs">
                  <div className="bg-muted/40 rounded p-2"><div className="text-muted-foreground">عدد الأوردرات</div><div className="font-bold">{current.ordersCount}</div></div>
                  <div className="bg-muted/40 rounded p-2"><div className="text-muted-foreground">قيمتها</div><div className="font-bold font-mono">{fmt(current.totalValue)}</div></div>
                  <div className="bg-emerald-50 rounded p-2"><div className="text-muted-foreground">المُحصَّل</div><div className="font-bold font-mono text-emerald-700">{fmt(current.collected)}</div></div>
                  <div className="bg-amber-50 rounded p-2"><div className="text-muted-foreground">المتبقي</div><div className="font-bold font-mono text-amber-700">{fmt(current.remaining)}</div></div>
                  <div className="bg-blue-50 rounded p-2"><div className="text-muted-foreground">غير المسلمة</div><div className="font-bold">{current.undelivered}</div></div>
                  <div className="bg-rose-50 rounded p-2"><div className="text-muted-foreground">مرتجعات</div><div className="font-bold text-rose-700">{current.returns}</div></div>
                </div>
              )}

              {/* Group toggle */}
              <div className="flex items-center justify-end gap-2 text-xs">
                <Label className="text-xs cursor-pointer">تجميع حسب اليوم</Label>
                <Switch checked={groupByDay} onCheckedChange={setGroupByDay} />
              </div>

              {/* Assignments table */}
              <div className="border rounded-md overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>رقم الأوردر</TableHead>
                      <TableHead>العميل</TableHead>
                      <TableHead>القيمة</TableHead>
                      <TableHead>حالة التحديث</TableHead>
                      <TableHead>التحصيل</TableHead>
                      <TableHead>تاريخ التسليم للمندوب</TableHead>
                      <TableHead>إجراءات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {currentAssignments.length === 0 ? (
                      <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">لا توجد أوردرات في عهدة هذا المندوب بعد.</TableCell></TableRow>
                    ) : (() => {
                      const renderOrderRow = (a: Assignment, indent = false) => {
                        const o = orders.find((x) => x.id === a.order_id);
                        const trk = tracking[a.order_id];
                        const col = collections.find((c) => c.order_id === a.order_id);
                        const dueAmt = Number(o?.total || 0);
                        const colAmt = Number(col?.amount_collected || 0);
                        const remain = Math.max(0, dueAmt - colAmt);
                        const stClass = STATUS_COLOR[a.status] || STATUS_COLOR[trk || ""] || "bg-gray-100 text-gray-800";
                        return (
                          <TableRow key={a.id} className={indent ? "bg-muted/20" : ""}>
                            <TableCell className={`font-mono ${indent ? "pr-8" : ""}`}>{o?.order_number ?? a.order_id.slice(0, 8)}</TableCell>
                            <TableCell>{o?.customer_name ?? "—"}</TableCell>
                            <TableCell className="font-mono">{fmt(dueAmt)}</TableCell>
                            <TableCell>
                              <Badge className={stClass}>{COURIER_STATUS_LABEL[trk || a.status] || a.status}</Badge>
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {col ? <>
                                <span className="text-emerald-700">{fmt(colAmt)}</span>
                                {remain > 0 && <span className="text-amber-700"> / متبقي {fmt(remain)}</span>}
                              </> : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell className="text-xs">{new Date(a.assigned_at).toLocaleDateString("ar-EG")}</TableCell>
                            <TableCell className="min-w-[280px]">
                              <div className="flex gap-1 flex-wrap">
                                <Button size="sm" variant="outline" className="h-7 px-1.5 gap-1 text-[10px]" onClick={() => setDetailsOrder(o ?? null)} disabled={!o} title="تفاصيل الأوردر">
                                  <Eye className="w-3 h-3" /> تفاصيل
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 px-1.5 gap-1 text-[10px]" title="قيد التوزيع"
                                  onClick={() => updateAssignmentStatus(a.id, a.order_id, "with_courier", "out_for_delivery")}>
                                  <Truck className="w-3 h-3" /> توزيع
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 px-1.5 gap-1 text-[10px] text-teal-700" title="تم التسليم للعميل (آجل بدون تحصيل)"
                                  onClick={async () => { if (await recordDeliveryAndCollection(a.order_id, 0)) { toast({ title: "تم التسليم (آجل)" }); load(); } }}>
                                  <CheckCircle2 className="w-3 h-3" /> تسليم
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 px-1.5 gap-1 text-[10px] border-emerald-300 hover:bg-emerald-50 text-emerald-700" title="تحصيل نقدي"
                                  onClick={() => {
                                    const ord = o ?? ({ id: a.order_id, order_number: a.order_id.slice(0, 8), total: dueAmt, customer_name: "—", status: a.status, created_at: a.assigned_at } as Order);
                                    setCollectOpen(ord);
                                    setCollectAmt(String(Math.max(0, dueAmt - colAmt)));
                                    setCollectNotes("");
                                  }}>
                                  <Coins className="w-3 h-3" /> كاش
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 px-1.5 gap-1 text-[10px] border-rose-300 hover:bg-rose-50 text-rose-700" title="تسجيل مرتجع"
                                  onClick={() => {
                                    const ord = o ?? ({ id: a.order_id, order_number: a.order_id.slice(0, 8), total: dueAmt, customer_name: "—", status: a.status, created_at: a.assigned_at } as Order);
                                    setReturnOpen(ord);
                                    setReturnReason("customer_refused");
                                    setReturnNotes("");
                                    setReturnKind("partial");
                                  }}>
                                  <RotateCcw className="w-3 h-3" /> مرتجع
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 px-1.5 gap-1 text-[10px] border-pink-300 hover:bg-pink-50 text-pink-700" title="هدية / مجاني (بدون تحصيل)"
                                  onClick={async () => {
                                    if (!confirm(`تأكيد: تسليم الأوردر ${o?.order_number ?? ""} كهدية مجانية بدون تحصيل؟`)) return;
                                    if (await recordDeliveryAndCollection(a.order_id, 0, "هدية مجانية - تم التسليم بدون تحصيل")) {
                                      toast({ title: "تم التسليم كهدية مجانية" }); load();
                                    }
                                  }}>
                                  🎁 مجاني
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 px-1.5 gap-1 text-[10px] border-gray-400 hover:bg-gray-50 text-gray-700" title="ألغاه العميل (إرجاع البضاعة)"
                                  onClick={() => {
                                    const ord = o ?? ({ id: a.order_id, order_number: a.order_id.slice(0, 8), total: dueAmt, customer_name: "—", status: a.status, created_at: a.assigned_at } as Order);
                                    setReturnOpen(ord);
                                    setReturnReason("customer_cancelled");
                                    setReturnNotes("ألغى العميل الأوردر — إرجاع كامل");
                                    setReturnKind("full");
                                  }}>
                                  ❌ إلغاء
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 px-1.5 gap-1 text-[10px] border-amber-300 hover:bg-amber-50 text-amber-700" title="تصحيح/تعديل"
                                  onClick={() => {
                                    setCorrectOpen({ assignment: a, order: o });
                                    setCorrectAction(col ? "edit_collection_amount" : a.returned_at ? "reverse_return" : "reverse_collection");
                                    setCorrectReason("");
                                    setCorrectAmount(col ? String(colAmt) : "");
                                  }}>
                                  <Wrench className="w-3 h-3" /> تصحيح
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      };

                      if (!groupByDay) return currentAssignments.map((a) => renderOrderRow(a));

                      return groupedByDay.flatMap((grp) => {
                        const isOpen = expandedDays[grp.day] ?? false;
                        const courierName = custodies.find((c) => c.id === selectedCustody)?.courier_name || "—";
                        const printDay = (e: React.MouseEvent) => {
                          e.stopPropagation();
                          const dayLabel = new Date(grp.day).toLocaleDateString("ar-EG", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
                          const rows = grp.items.map((a, i) => {
                            const o = orders.find((x) => x.id === a.order_id);
                            const col = collections.find((c) => c.order_id === a.order_id);
                            const due = Number(o?.total || 0);
                            const colAmt = Number(col?.amount_collected || 0);
                            const trk = tracking[a.order_id];
                            const statusLabel = COURIER_STATUS_LABEL[trk || a.status] || a.status;
                            return `<tr>
                              <td>${i + 1}</td>
                              <td>${o?.order_number ?? a.order_id.slice(0, 8)}</td>
                              <td>${o?.customer_name ?? "—"}</td>
                              <td>${statusLabel}</td>
                              <td style="text-align:left;font-family:monospace">${fmt(due)}</td>
                              <td style="text-align:left;font-family:monospace">${fmt(colAmt)}</td>
                              <td style="text-align:left;font-family:monospace">${fmt(Math.max(0, due - colAmt))}</td>
                            </tr>`;
                          }).join("");
                          const body = `
                            <div class="meta">
                              <div><strong>المندوب:</strong> ${courierName}</div>
                              <div><strong>اليوم:</strong> ${dayLabel}</div>
                              <div><strong>عدد الأوردرات:</strong> ${grp.items.length}</div>
                            </div>
                            <table>
                              <thead>
                                <tr><th>#</th><th>رقم الأوردر</th><th>العميل</th><th>الحالة</th><th>القيمة</th><th>المُحصَّل</th><th>المتبقي</th></tr>
                              </thead>
                              <tbody>${rows}</tbody>
                              <tfoot>
                                <tr>
                                  <th colspan="4">الإجمالي</th>
                                  <th style="text-align:left;font-family:monospace">${fmt(grp.totalValue)}</th>
                                  <th style="text-align:left;font-family:monospace">${fmt(grp.collected)}</th>
                                  <th style="text-align:left;font-family:monospace">${fmt(grp.remaining)}</th>
                                </tr>
                              </tfoot>
                            </table>`;
                          const css = `
                            .meta { display:flex; gap:24px; margin-bottom:12px; font-size:13px; }
                            table { width:100%; border-collapse:collapse; font-size:12px; }
                            th, td { border:1px solid #ccc; padding:6px 8px; text-align:right; }
                            thead th { background:#f3f4f6; }
                            tfoot th { background:#fef3c7; }
                          `;
                          openPrintWindow(`عهدة ${courierName} — ${dayLabel}`, body, css);
                        };
                        const rows: JSX.Element[] = [
                          <TableRow key={`day-${grp.day}`} className="bg-primary/5 hover:bg-primary/10 cursor-pointer font-medium"
                            onClick={() => setExpandedDays((s) => ({ ...s, [grp.day]: !isOpen }))}>
                            <TableCell className="font-bold">
                              <div className="flex items-center gap-2">
                                {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
                                <span>{new Date(grp.day).toLocaleDateString("ar-EG", { weekday: "long", day: "numeric", month: "long" })}</span>
                                <Badge variant="secondary" className="text-xs">{grp.items.length} أوردر</Badge>
                              </div>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">—</TableCell>
                            <TableCell className="font-mono font-bold">{fmt(grp.totalValue)}</TableCell>
                            <TableCell className="text-xs">
                              <span className="text-emerald-700">مُسلَّم: {grp.delivered}</span>
                              {grp.returns > 0 && <span className="text-rose-700"> · مرتجع: {grp.returns}</span>}
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              <span className="text-emerald-700">{fmt(grp.collected)}</span>
                              {grp.remaining > 0 && <span className="text-amber-700"> / متبقي {fmt(grp.remaining)}</span>}
                            </TableCell>
                            <TableCell className="text-xs">{new Date(grp.day).toLocaleDateString("ar-EG")}</TableCell>
                            <TableCell className="text-xs">
                              <div className="flex items-center gap-2">
                                <Button size="sm" variant="outline" className="h-7 px-2 gap-1" onClick={printDay} title="طباعة أوردرات اليوم">
                                  <Printer className="w-3 h-3" /> <span className="text-xs">طباعة</span>
                                </Button>
                                <span className="text-muted-foreground">{isOpen ? "إخفاء" : "عرض الأوردرات"}</span>
                              </div>
                            </TableCell>
                          </TableRow>
                        ];
                        if (isOpen) grp.items.forEach((a) => rows.push(renderOrderRow(a, true)));
                        return rows;
                      });
                    })()}
                  </TableBody>
                </Table>

              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Assignment dialog — pick from eligible orders */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent dir="rtl" className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardList className="w-5 h-5" /> تسليم أوردرات جاهزة للمندوب
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">يظهر هنا الأوردرات الجاهزة (pending / processing / shipped) غير المُعيَّنة لمندوب آخر.</div>
            <div className="border rounded-md max-h-[55vh] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead>رقم الأوردر</TableHead>
                    <TableHead>العميل</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead>القيمة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {eligibleOrders.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">لا توجد أوردرات جاهزة للتسليم.</TableCell></TableRow>
                  ) : eligibleOrders.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell>
                        <input type="checkbox" checked={assignOrderIds.includes(o.id)}
                          onChange={(e) => setAssignOrderIds((cur) => e.target.checked ? [...cur, o.id] : cur.filter((x) => x !== o.id))} />
                      </TableCell>
                      <TableCell className="font-mono">{o.order_number}</TableCell>
                      <TableCell>{o.customer_name ?? "—"}</TableCell>
                      <TableCell><Badge variant="outline">{o.status}</Badge></TableCell>
                      <TableCell className="font-mono">{fmt(Number(o.total || 0))}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)}>إلغاء</Button>
            <Button onClick={handleAssign} disabled={assignOrderIds.length === 0}>
              تسليم {assignOrderIds.length > 0 ? `(${assignOrderIds.length})` : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Order details dialog */}
      <Dialog open={!!detailsOrder} onOpenChange={(v) => !v && setDetailsOrder(null)}>
        <DialogContent dir="rtl" className="max-w-2xl">
          <DialogHeader><DialogTitle>تفاصيل {detailsOrder?.order_number}</DialogTitle></DialogHeader>
          <OrderDetailsBody order={detailsOrder} />
        </DialogContent>
      </Dialog>

      {/* Collection dialog */}
      <Dialog open={!!collectOpen} onOpenChange={(v) => !v && setCollectOpen(null)}>
        <DialogContent dir="rtl">
          <DialogHeader><DialogTitle>تسجيل تحصيل — {collectOpen?.order_number}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">قيمة الأوردر: <span className="font-mono">{fmt(Number(collectOpen?.total || 0))}</span> ج.م</div>
            <div><Label>المبلغ المُحصَّل</Label><Input type="number" value={collectAmt} onChange={(e) => setCollectAmt(e.target.value)} /></div>
            <div><Label>ملاحظات</Label><Textarea value={collectNotes} onChange={(e) => setCollectNotes(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCollectOpen(null)}>إلغاء</Button>
            <Button onClick={saveCollection}>حفظ التحصيل</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Return dialog */}
      <Dialog open={!!returnOpen} onOpenChange={(v) => !v && setReturnOpen(null)}>
        <DialogContent dir="rtl">
          <DialogHeader><DialogTitle>تسجيل مرتجع — {returnOpen?.order_number}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>نوع المرتجع</Label>
              <Select value={returnKind} onValueChange={(v: "partial" | "full") => setReturnKind(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="partial">مرتجع جزئي</SelectItem>
                  <SelectItem value="full">مرتجع كامل</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>السبب</Label>
              <Select value={returnReason} onValueChange={setReturnReason}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="customer_refused">العميل رفض</SelectItem>
                  <SelectItem value="customer_cancelled">ألغى العميل الأوردر</SelectItem>
                  <SelectItem value="customer_unavailable">العميل غير متاح</SelectItem>
                  <SelectItem value="product_unsuitable">المنتج غير مناسب</SelectItem>
                  <SelectItem value="address_unclear">العنوان غير واضح</SelectItem>
                  <SelectItem value="other">أخرى</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>الملاحظات (إجباري)</Label><Textarea value={returnNotes} onChange={(e) => setReturnNotes(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReturnOpen(null)}>إلغاء</Button>
            <Button variant="destructive" onClick={saveReturn}>حفظ المرتجع</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cash handover dialog */}
      <Dialog open={handoverOpen} onOpenChange={(o) => !o && setHandoverOpen(false)}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>توريد نقدية المندوب للخزينة الرئيسية</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {current && (
              <div className="bg-emerald-50 border border-emerald-200 rounded p-3 text-sm">
                <div className="flex justify-between"><span>المندوب:</span><span className="font-bold">{current.courier_name}</span></div>
                <div className="flex justify-between mt-1"><span>إجمالي المُحصَّل في العهدة:</span><span className="font-mono font-bold text-emerald-700">{fmt(current.collected)} ج.م</span></div>
              </div>
            )}
            <div>
              <Label>المبلغ المطلوب توريده (ج.م)</Label>
              <Input type="number" inputMode="decimal" value={handoverAmt} onChange={(e) => setHandoverAmt(e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <Label>ملاحظة (اختياري)</Label>
              <Textarea value={handoverNotes} onChange={(e) => setHandoverNotes(e.target.value)} placeholder="مثال: توريد دفعة الصباح" />
            </div>
            <div className="text-xs text-muted-foreground">
              سيتم إرسال التوريد إلى خزينة المخزن الرئيسي بحالة «بانتظار الاعتماد» ويتم خصمه من صافي نقدية العهدة فور إرساله. الاعتماد النهائي يتم من محمد شعلة.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHandoverOpen(false)} disabled={handoverBusy}>إلغاء</Button>
            <Button onClick={submitHandover} disabled={handoverBusy} className="bg-emerald-600 hover:bg-emerald-700">
              {handoverBusy ? "جاري الإرسال…" : "إرسال للاعتماد"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Correction dialog */}
      <Dialog open={!!correctOpen} onOpenChange={(o) => !o && setCorrectOpen(null)}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wrench className="w-5 h-5 text-amber-600" /> تصحيح/تعديل أوردر — {correctOpen?.order?.order_number}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="bg-amber-50 border border-amber-200 rounded p-2 text-xs text-amber-900">
              يُسجَّل التصحيح في سجل تدقيق دائم (اسم المستخدم، الوقت، السبب، قبل/بعد) ولا يُسمح به بعد إقفال يوم العهدة.
            </div>
            <div>
              <Label>نوع التصحيح</Label>
              <Select value={correctAction} onValueChange={(v: any) => setCorrectAction(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="edit_collection_amount">تعديل قيمة التحصيل</SelectItem>
                  <SelectItem value="reverse_collection">إلغاء التحصيل (إرجاع الأوردر لحالة «مُسلَّم»)</SelectItem>
                  <SelectItem value="reverse_return">إلغاء المرتجع (إعادة فتح للتوزيع)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {correctAction === "edit_collection_amount" && (
              <div>
                <Label>القيمة الجديدة (ج.م)</Label>
                <Input type="number" inputMode="decimal" value={correctAmount} onChange={(e) => setCorrectAmount(e.target.value)} />
              </div>
            )}
            <div>
              <Label>سبب التصحيح (إجباري)</Label>
              <Textarea value={correctReason} onChange={(e) => setCorrectReason(e.target.value)} placeholder="مثال: خطأ إدخال — المبلغ الفعلي كان مختلفًا" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCorrectOpen(null)} disabled={correctBusy}>إلغاء</Button>
            <Button onClick={submitCorrection} disabled={correctBusy} className="bg-amber-600 hover:bg-amber-700">
              {correctBusy ? "جاري الحفظ…" : "حفظ التصحيح"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function OrderDetailsBody({ order }: { order: Order | null }) {
  const [items, setItems] = useState<any[]>([]);
  const [bonuses, setBonuses] = useState<any[]>([]);
  useEffect(() => {
    if (!order) return;
    (async () => {
      const [itRes, bonRes] = await Promise.all([
        (supabase as any).from("order_items").select("*").eq("order_id", order.id),
        (supabase as any).from("courier_goods_custody_lines").select("*").eq("order_id", order.id).in("line_type", ["bonus", "sale"]),
      ]);
      setItems(itRes.data || []);
      setBonuses(bonRes.data || []);
    })();
  }, [order]);
  if (!order) return null;
  return (
    <div className="space-y-3 text-sm">
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div><span className="text-muted-foreground">رقم الأوردر:</span> <span className="font-mono">{order.order_number}</span></div>
        <div><span className="text-muted-foreground">العميل:</span> {order.customer_name ?? "—"}</div>
        <div><span className="text-muted-foreground">القيمة:</span> <span className="font-mono">{fmt(Number(order.total || 0))} ج.م</span></div>
        <div><span className="text-muted-foreground">التاريخ:</span> {new Date(order.created_at).toLocaleString("ar-EG")}</div>
      </div>
      <div>
        <div className="font-semibold mb-1">الأصناف</div>
        <Table>
          <TableHeader><TableRow><TableHead>الصنف</TableHead><TableHead>الكمية</TableHead><TableHead>السعر</TableHead></TableRow></TableHeader>
          <TableBody>
            {items.length === 0 ? <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">—</TableCell></TableRow> :
             items.map((it) => (
              <TableRow key={it.id}>
                <TableCell>{it.product_name}</TableCell>
                <TableCell className="font-mono">{fmt(Number(it.quantity || 0))}</TableCell>
                <TableCell className="font-mono">{fmt(Number(it.price || 0))}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {bonuses.length > 0 && (
        <div>
          <div className="font-semibold mb-1">🎁 مجانيات/خصومات مرتبطة بالأوردر</div>
          <Table>
            <TableHeader><TableRow><TableHead>النوع</TableHead><TableHead>الصنف</TableHead><TableHead>الكمية</TableHead><TableHead>السبب</TableHead></TableRow></TableHeader>
            <TableBody>
              {bonuses.map((b) => (
                <TableRow key={b.id}>
                  <TableCell>{b.line_type === "bonus" ? "مجاني" : b.discount_amount ? "خصم" : "بيع"}</TableCell>
                  <TableCell>{b.product_name}</TableCell>
                  <TableCell className="font-mono">{fmt(Number(b.quantity || 0))}</TableCell>
                  <TableCell className="text-xs">{b.bonus_reason || b.discount_reason || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
