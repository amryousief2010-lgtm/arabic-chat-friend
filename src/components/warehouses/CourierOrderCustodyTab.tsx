import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
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
import { Truck, Package2, Coins, RotateCcw, CheckCircle2, Eye, ClipboardList, Trophy, ChevronDown, ChevronLeft, Printer, FileSpreadsheet, Wrench, ListChecks } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
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

const normalizeDigits = (value: string) => value
  .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
  .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));

const parseBosttaSheetNetAmount = (filename?: string | null) => {
  const base = normalizeDigits(String(filename || "").replace(/\.[^.]+$/, ""));
  const matches = Array.from(base.matchAll(/(?:^|\D)(\d{4,8})(?=\D|$)/g)).map((m) => Number(m[1]));
  return matches.length ? matches[matches.length - 1] : null;
};

const extractBosttaOrderNumbers = (summary: any) => {
  const nums = new Set<string>();
  ["updated", "already_delivered"].forEach((key) => {
    const rows = Array.isArray(summary?.[key]) ? summary[key] : [];
    rows.forEach((row: any) => {
      if (row?.order_number) nums.add(String(row.order_number));
    });
  });
  return Array.from(nums);
};

const isGiftAssignment = (
  a: { notes?: string | null; order_id?: string } | null | undefined,
  order?: { update_status_marker?: string | null; collection_method?: string | null } | null,
) => {
  if (order && (order.update_status_marker === "gift" || order.collection_method === "none")) return true;
  return !!(a?.notes && /هدية مجانية|مجاني/.test(a.notes));
};

// Transfer (Vodafone Cash / InstaPay) — customer pays directly, courier holds no cash.
const isTransferAssignment = (
  a: { notes?: string | null } | null | undefined,
  order?: { collection_method?: string | null } | null,
) => {
  if (order?.collection_method === "transfer") return true;
  return !!(a?.notes && /فودافون كاش|انستا ?باى|انستا ?باي|instapay/i.test(a.notes));
};

// Any assignment that should NOT count against the courier's cash-due.
const isNonCashAssignment = (
  a: { notes?: string | null; order_id?: string } | null | undefined,
  order?: { update_status_marker?: string | null; collection_method?: string | null } | null,
) => isGiftAssignment(a, order) || isTransferAssignment(a, order);



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
  update_status_marker?: string | null;
  collection_method?: string | null;
  courier_cash_due?: number | null;
  vodafone_cash_amount?: number | null;
  instapay_amount?: number | null;
  bank_transfer_amount?: number | null;
  other_amount?: number | null;
  transfer_reference?: string | null;
  free_amount?: number | null;
  delivery_fee?: number | null;
  collection_note?: string | null;
};

type Tracking = { order_id: string; courier_status: string | null };
type Collection = { id: string; order_id: string; amount_due: number; amount_collected: number; status: string; collected_at: string };
type FailedAttempt = { id: string; order_id: string; reason: string; notes: string | null; created_at: string };
type BosttaUploadNet = { id: string; filename: string; netAmount: number; orderNumbers: string[]; created_at: string };

import { MAIN_WAREHOUSE_ID as DEFAULT_MAIN_WAREHOUSE_ID } from "@/lib/warehouseItemFilters";

interface CourierOrderCustodyTabProps {
  warehouseId?: string;
}

const AGOUZA_WAREHOUSE_ID = "a970d469-37df-40e1-b99f-a49195a3778e";

export default function CourierOrderCustodyTab({ warehouseId = DEFAULT_MAIN_WAREHOUSE_ID }: CourierOrderCustodyTabProps = {}) {
  const isAgouza = warehouseId === AGOUZA_WAREHOUSE_ID;
  const courierLabel = isAgouza ? "شركة الشحن" : "كيمو";
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
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
  const [dailyDeposits, setDailyDeposits] = useState<Array<{ id: string; custody_id: string; deposit_date: string; amount: number; orders_count: number; treasury_txn_id: string | null; performed_by_name: string | null; created_at: string }>>([]);
  const [bosttaUploadNets, setBosttaUploadNets] = useState<BosttaUploadNet[]>([]);
  const [depositingDay, setDepositingDay] = useState<string | null>(null);
  // Order IDs already accounted for via a closed Mega/Zodex invoice for the selected custody.
  // These are excluded from the per-day courier groups (they show up in the closed-invoices card instead).
  const [zodexClosedOrderIds, setZodexClosedOrderIds] = useState<Set<string>>(new Set());


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
      (supabase as any).from("courier_goods_custodies").select("*").eq("status", "open").eq("warehouse_id", warehouseId).order("opened_at", { ascending: false }),
      (supabase as any).from("courier_order_assignments").select("*").eq("warehouse_id", warehouseId).order("assigned_at", { ascending: false }).limit(2000),
    ]);
    const cst: Custody[] = cstRes.data || [];
    const asn: Assignment[] = asnRes.data || [];
    setCustodies(cst);
    setAssignments(asn);
    if (!selectedCustody && cst.length) setSelectedCustody(cst[0].id);

    // Load daily cash deposits for all open custodies
    if (cst.length) {
      const { data: depRows } = await (supabase as any)
        .from("courier_daily_cash_deposits")
        .select("id, custody_id, deposit_date, amount, orders_count, treasury_txn_id, performed_by_name, created_at")
        .in("custody_id", cst.map((c) => c.id))
        .order("deposit_date", { ascending: false });
      setDailyDeposits(depRows || []);

      // Load order IDs already tied to a closed Mega/Zodex invoice for these custodies.
      // We exclude them from the day-grouping so the "not deposited" count doesn't include
      // orders that are already accounted for as a closed Mega invoice.
      const { data: closedInvs } = await (supabase as any)
        .from("zodex_closed_invoices")
        .select("id")
        .in("custody_id", cst.map((c) => c.id));
      const invIds = (closedInvs || []).map((r: any) => r.id);
      if (invIds.length) {
        const { data: closedOrders } = await (supabase as any)
          .from("zodex_closed_invoice_orders")
          .select("order_id")
          .in("invoice_id", invIds)
          .not("order_id", "is", null);
        setZodexClosedOrderIds(new Set((closedOrders || []).map((r: any) => r.order_id).filter(Boolean)));
      } else {
        setZodexClosedOrderIds(new Set());
      }
    } else {
      setDailyDeposits([]);
      setZodexClosedOrderIds(new Set());
    }

    if (isAgouza) {

      const { data: uploadRows } = await (supabase as any)
        .from("bostta_delivery_uploads")
        .select("id, filename, summary, created_at")
        .order("created_at", { ascending: false })
        .limit(25);
      setBosttaUploadNets((uploadRows || [])
        .map((row: any) => ({
          id: row.id,
          filename: row.filename,
          netAmount: parseBosttaSheetNetAmount(row.filename),
          orderNumbers: extractBosttaOrderNumbers(row.summary),
          created_at: row.created_at,
        }))
        .filter((row: BosttaUploadNet) => Number(row.netAmount) > 0 && row.orderNumbers.length > 0));
    } else {
      setBosttaUploadNets([]);
    }

    // Pull orders that are: (a) prepared/ready for assignment, (b) currently assigned
    const assignedOrderIds = asn.map((a) => a.order_id);
    const [readyOrdersRes, assignedOrdersRes] = await Promise.all([
      (supabase as any).from("orders")
        .select("id, order_number, status, total, customer_id, created_at, update_status_marker, collection_method, courier_cash_due, vodafone_cash_amount, instapay_amount, bank_transfer_amount, other_amount, free_amount, delivery_fee, transfer_reference, collection_note, customers!orders_customer_id_fkey(name, phone)")
        .in("status", ["pending", "processing", "shipped"])
        .eq("source_warehouse_id", warehouseId)
        .order("created_at", { ascending: false })
        .limit(500),
      assignedOrderIds.length
        ? (supabase as any).from("orders")
            .select("id, order_number, status, total, customer_id, created_at, update_status_marker, collection_method, courier_cash_due, vodafone_cash_amount, instapay_amount, bank_transfer_amount, other_amount, free_amount, delivery_fee, transfer_reference, collection_note, customers!orders_customer_id_fkey(name, phone)")
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
      const giftOrderIds = new Set(myAsn.filter((a) => isNonCashAssignment(a, orders.find((o) => o.id === a.order_id) as any)).map((a) => a.order_id));
      const myOrderIds = new Set(myAsn.map((a) => a.order_id));
      const myOrders = orders.filter((o) => myOrderIds.has(o.id));
      let totalValue = myOrders.reduce((s, o) => {
        if (giftOrderIds.has(o.id)) return s;
        if ((o as any).collection_method === 'mixed_payment') return s + Number((o as any).courier_cash_due || 0);
        return s + Number(o.total || 0);
      }, 0);
      if (isAgouza && myOrders.length > 0 && bosttaUploadNets.length > 0) {
        const myOrderNumbers = myOrders.map((o) => o.order_number).filter(Boolean);
        const myOrderNumberSet = new Set(myOrderNumbers);
        const matched = new Set<string>();
        let sheetTotal = 0;
        bosttaUploadNets.forEach((upload) => {
          const uploadInsideThisCustody = upload.orderNumbers.length > 0 && upload.orderNumbers.every((no) => myOrderNumberSet.has(no));
          const overlapsAlreadyMatched = upload.orderNumbers.some((no) => matched.has(no));
          if (!uploadInsideThisCustody || overlapsAlreadyMatched) return;
          upload.orderNumbers.forEach((no) => matched.add(no));
          sheetTotal += Number(upload.netAmount || 0);
        });
        if (matched.size === myOrderNumbers.length && sheetTotal > 0) totalValue = sheetTotal;
      }
      const myCols = collections.filter((cl) => myOrderIds.has(cl.order_id));
      const collected = myCols.reduce((s, cl) => s + Number(cl.amount_collected || 0), 0);
      const delivered = myAsn.filter((a) => ["delivered", "collected", "completed"].includes(a.status)).length;
      const undelivered = myAsn.filter((a) => a.status === "with_courier").length;
      const uncollected = myOrders.filter((o) => !giftOrderIds.has(o.id) && !myCols.find((cl) => cl.order_id === o.id)).length;
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
  }, [custodies, assignments, orders, collections, isAgouza, bosttaUploadNets]);

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

  // ── Transfers breakdown (تحويلات مباشرة للشركة — لا تدخل عهدة المندوب نقديًا)
  // يتأثر بفلتر المندوب (selectedCustody). إذا لم يتم اختيار مندوب يعرض إجمالي كل العهدات.
  const transfersBreakdown = useMemo(() => {
    const scopedAssignments = selectedCustody
      ? assignments.filter((a) => a.custody_id === selectedCustody)
      : assignments;
    const assignedOrderIds = new Set(scopedAssignments.map((a) => a.order_id));
    const relevant = orders.filter((o) => assignedOrderIds.has(o.id));
    const acc = { vodafone: 0, instapay: 0, bank: 0, other: 0, free: 0, cashDue: 0, ordersTotal: 0, missingBreakdown: 0, ordersCount: relevant.length };
    relevant.forEach((o: any) => {
      acc.ordersTotal += Number(o.total || 0);
      acc.cashDue += Number(o.courier_cash_due || 0);
      acc.vodafone += Number(o.vodafone_cash_amount || 0);
      acc.instapay += Number(o.instapay_amount || 0);
      acc.bank += Number(o.bank_transfer_amount || 0);
      acc.other += Number(o.other_amount || 0);
      acc.free += Number(o.free_amount || 0);
      if (o.status === 'delivered' && o.collection_method === 'mixed_payment') {
        const sum = Number(o.courier_cash_due || 0) + Number(o.vodafone_cash_amount || 0) +
          Number(o.instapay_amount || 0) + Number(o.bank_transfer_amount || 0) +
          Number(o.other_amount || 0) + Number(o.free_amount || 0);
        if (Math.abs(sum - Number(o.total || 0)) > 0.01) acc.missingBreakdown += 1;
      }
    });
    if (isAgouza && relevant.length > 0 && bosttaUploadNets.length > 0) {
      const relevantOrderNumbers = relevant.map((o) => o.order_number).filter(Boolean);
      const relevantSet = new Set(relevantOrderNumbers);
      const matched = new Set<string>();
      let sheetTotal = 0;
      bosttaUploadNets.forEach((upload) => {
        const uploadInsideScope = upload.orderNumbers.length > 0 && upload.orderNumbers.every((no) => relevantSet.has(no));
        const overlapsAlreadyMatched = upload.orderNumbers.some((no) => matched.has(no));
        if (!uploadInsideScope || overlapsAlreadyMatched) return;
        upload.orderNumbers.forEach((no) => matched.add(no));
        sheetTotal += Number(upload.netAmount || 0);
      });
      if (matched.size === relevantOrderNumbers.length && sheetTotal > 0) acc.cashDue = sheetTotal;
    }
    return acc;
  }, [orders, assignments, selectedCustody, isAgouza, bosttaUploadNets]);


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
    const depByDay = new Map(dailyDeposits.filter((d) => d.custody_id === selectedCustody).map((d) => [d.deposit_date, d]));
    return Array.from(map.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([day, items]) => {
        let totalValue = 0, cashDue = 0, vodafone = 0, instapay = 0, bank = 0, other = 0, free = 0;
        let missingBreakdown = 0, undelivered = 0;
        const groupOrders: Order[] = [];
        items.forEach((a) => {
          const o: any = orders.find((x) => x.id === a.order_id);
          if (!o) return;
          groupOrders.push(o);
          const deliveredStatus = ["delivered", "collected", "completed"].includes(o.status);
          const nonCash = isAgouza ? false : isNonCashAssignment(a, o);
          if (!nonCash) {
            if (isAgouza) {
              const isGift = isGiftAssignment(a, o);
              // للعجوزة: إجمالي اليوم = مجموع (قيمة الأوردر − مصاريف الشحن) للأوردرات المدفوعة،
              // بينما الهدايا المجانية تُحسب بقيمتها الكاملة (لا يوجد شحن يخصم منها).
              totalValue += isGift ? Number(o.total || 0) : Math.max(0, Number(o.total || 0) - Number(o.delivery_fee || 0));
            } else if (o.collection_method === "mixed_payment") totalValue += Number(o.courier_cash_due || 0);
            else totalValue += Number(o.total || 0);
          }
          vodafone += Number(o.vodafone_cash_amount || 0);
          instapay += Number(o.instapay_amount || 0);
          bank += Number(o.bank_transfer_amount || 0);
          other += Number(o.other_amount || 0);
          free += Number(o.free_amount || 0);
          if (deliveredStatus && !nonCash) {
            if (isAgouza) cashDue += Math.max(0, Number(o.total || 0) - Number(o.delivery_fee || 0));
            else cashDue += o.collection_method === "mixed_payment" ? Number(o.courier_cash_due || 0) : Number(o.total || 0);
          }
          if (deliveredStatus && o.collection_method === "mixed_payment") {
            const sum = Number(o.courier_cash_due || 0) + Number(o.vodafone_cash_amount || 0) + Number(o.instapay_amount || 0) +
                        Number(o.bank_transfer_amount || 0) + Number(o.other_amount || 0) + Number(o.free_amount || 0);
            if (Math.abs(sum - Number(o.total || 0)) > 0.01) missingBreakdown += 1;
          }
          if (!["delivered", "collected", "completed", "cancelled", "partially_returned", "fully_returned"].includes(o.status)) undelivered += 1;
        });

        const groupOrderNumbers = groupOrders.map((o) => o.order_number).filter(Boolean);
        let sheetNetAmount: number | null = null;
        if (isAgouza && groupOrderNumbers.length > 0 && bosttaUploadNets.length > 0) {
          const groupSet = new Set(groupOrderNumbers);
          const matched = new Set<string>();
          let sheetTotal = 0;
          bosttaUploadNets.forEach((upload) => {
            const uploadInsideThisGroup = upload.orderNumbers.length > 0 && upload.orderNumbers.every((no) => groupSet.has(no));
            const overlapsAlreadyMatched = upload.orderNumbers.some((no) => matched.has(no));
            if (!uploadInsideThisGroup || overlapsAlreadyMatched) return;
            upload.orderNumbers.forEach((no) => matched.add(no));
            sheetTotal += Number(upload.netAmount || 0);
          });
          if (matched.size === groupOrderNumbers.length && sheetTotal > 0) sheetNetAmount = sheetTotal;
        }

        const finalTotalValue = sheetNetAmount ?? totalValue;
        const finalCashDue = sheetNetAmount ?? cashDue;
        const collected = items.reduce((s, a) => {
          const c = collections.find((cl) => cl.order_id === a.order_id);
          return s + Number(c?.amount_collected || 0);
        }, 0);
        const delivered = items.filter((a) => ["delivered", "collected", "completed"].includes(a.status)).length;
        const returns = items.filter((a) => ["partially_returned", "fully_returned"].includes(a.status)).length;
        const deposit = depByDay.get(day) || null;
        return {
          day, items, totalValue: finalTotalValue, collected, delivered, returns,
          remaining: Math.max(0, finalTotalValue - collected),
          cashDue: finalCashDue, vodafone, instapay, bank, other, free,
          sheetNetAmount,
          missingBreakdown, undelivered, deposit,
          canDeposit: undelivered === 0 && missingBreakdown === 0 && items.length > 0 && !deposit,
        };
      });
  }, [currentAssignments, orders, collections, dailyDeposits, selectedCustody, isAgouza, bosttaUploadNets]);


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
        warehouse_id: warehouseId,
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

  // Convert an assignment/order into a GIFT (no cash collection required from courier).
  // Preserves original delivery status when already delivered; never re-deducts stock.
  const markOrderAsGift = async (asn: Assignment, ord?: Order): Promise<boolean> => {
    if (!asn) return false;
    const orderRow = ord ?? orders.find((x) => x.id === asn.order_id);
    const wasDelivered = !!asn.delivered_at || ["delivered", "collected", "completed"].includes(asn.status);
    const before = {
      update_status_marker: orderRow?.update_status_marker ?? null,
      collection_method: orderRow?.collection_method ?? null,
      courier_cash_due: orderRow?.courier_cash_due ?? null,
      collection_note: orderRow?.collection_note ?? null,
      assignment_status: asn.status,
      assignment_notes: asn.notes ?? null,
    };
    // 1) If not delivered yet, atomically record a zero-cash delivery (uses existing RPC — no stock double-deduct because it flips delivered).
    if (!wasDelivered) {
      const ok = await recordDeliveryAndCollection(asn.order_id, 0, "هدية مجانية - تم التسليم بدون تحصيل");
      if (!ok) return false;
    }
    // 2) Persist gift markers on orders + zero out cash due (safe whether delivered or not)
    const nowIso = new Date().toISOString();
    const { error: ordErr } = await (supabase as any)
      .from("orders")
      .update({
        update_status_marker: "gift",
        update_status_updated_at: nowIso,
        update_status_updated_by: user?.id ?? null,
        collection_method: "none",
        courier_cash_due: 0,
        collection_note: "أوردر مجاني - لا يوجد تحصيل من المندوب",
        collection_updated_at: nowIso,
        collection_updated_by: user?.id ?? null,
      })
      .eq("id", asn.order_id);
    if (ordErr) {
      toast({ title: "تعذّر تحديث بيانات الأوردر", description: ordErr.message, variant: "destructive" });
      return false;
    }
    // 3) Tag assignment notes so isGiftAssignment fallback also matches
    const mergedNotes = /هدية مجانية|مجاني/.test(asn.notes || "")
      ? asn.notes
      : `${asn.notes ? asn.notes + " | " : ""}هدية مجانية - لا يوجد تحصيل`;
    await (supabase as any)
      .from("courier_order_assignments")
      .update({ notes: mergedNotes })
      .eq("id", asn.id);
    // 4) Audit log
    await (supabase as any).from("courier_assignment_corrections").insert({
      assignment_id: asn.id,
      order_id: asn.order_id,
      courier_name: asn.courier_name,
      action: "mark_as_gift",
      before_snapshot: before,
      after_snapshot: {
        update_status_marker: "gift",
        collection_method: "none",
        courier_cash_due: 0,
        collection_note: "أوردر مجاني - لا يوجد تحصيل من المندوب",
        preserved_delivery: wasDelivered,
      },
      reason: "تحويل الأوردر إلى مجاني من قائمة اختيار الحالة",
      performed_by: user?.id ?? null,
    });
    toast({ title: "تم تحويل الأوردر إلى مجاني 🎁", description: "خرج من إجمالي التحصيل والمطلوب من المندوب." });
    await load();
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

  const depositDayCash = async (day: string, amountPreview: number) => {
    if (!selectedCustody) return;
    const dayLabel = new Date(day).toLocaleDateString("ar-EG", { day: "numeric", month: "long", year: "numeric" });
    if (!confirm(`سيتم توريد ${fmt(amountPreview)} ج.م إلى خزنة المخزن الرئيسي عن يوم ${dayLabel}. متابعة؟`)) return;
    setDepositingDay(day);
    try {
      const { data, error } = await (supabase as any).rpc("deposit_courier_day_cash", {
        p_custody_id: selectedCustody,
        p_day: day,
        p_notes: null,
      });
      if (error) throw error;
      toast({ title: "تم التوريد بنجاح", description: `المبلغ: ${fmt(data?.amount || 0)} ج.م — ${data?.reference || ""}` });
      await load();
    } catch (e: any) {
      toast({ title: "تعذّر التوريد", description: e?.message || "", variant: "destructive" });
    } finally { setDepositingDay(null); }
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

      {/* تفصيل التحصيل — نقدي مطلوب من المندوب vs تحويلات مباشرة للشركة */}
      <Card className="bg-gradient-to-l from-blue-50/60 to-emerald-50/60 border-blue-200">
        <CardContent className="p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-bold">
              تفصيل التحصيل — {selectedCustody ? (custodies.find(c=>c.id===selectedCustody)?.courier_name || 'المندوب') : 'كل العهدات'}
              <span className="text-xs text-muted-foreground font-normal mr-2">({transfersBreakdown.ordersCount} أوردر)</span>
            </div>
            {transfersBreakdown.missingBreakdown > 0 && (
              <span className="text-[11px] bg-amber-100 text-amber-800 border border-amber-300 rounded px-2 py-0.5">
                ⚠️ {transfersBreakdown.missingBreakdown} أوردر مسلّم بدون تفصيل تحصيل مسجل — مراجعة يدوية مطلوبة
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2 text-xs">
            <div className="rounded border bg-white/70 p-2">
              <div className="text-muted-foreground">إجمالي قيمة الأوردرات</div>
              <div className="font-mono font-bold">{fmt(transfersBreakdown.ordersTotal)}</div>
            </div>
            <div className="rounded border bg-emerald-50 border-emerald-300 p-2">
              <div className="text-emerald-800">💵 مطلوب نقدي من المندوب</div>
              <div className="font-mono font-bold text-emerald-800">{fmt(transfersBreakdown.cashDue)}</div>
            </div>
            <div className="rounded border bg-rose-50 border-rose-300 p-2">
              <div className="text-rose-800">📱 فودافون كاش</div>
              <div className="font-mono font-bold text-rose-800">{fmt(transfersBreakdown.vodafone)}</div>
            </div>
            <div className="rounded border bg-indigo-50 border-indigo-300 p-2">
              <div className="text-indigo-800">💳 إنستاباي</div>
              <div className="font-mono font-bold text-indigo-800">{fmt(transfersBreakdown.instapay)}</div>
            </div>
            <div className="rounded border bg-blue-50 border-blue-300 p-2">
              <div className="text-blue-800">🏦 تحويل بنكي</div>
              <div className="font-mono font-bold text-blue-800">{fmt(transfersBreakdown.bank)}</div>
            </div>
            <div className="rounded border bg-zinc-50 border-zinc-300 p-2">
              <div className="text-zinc-800">💠 أخرى</div>
              <div className="font-mono font-bold text-zinc-800">{fmt(transfersBreakdown.other)}</div>
            </div>
            <div className="rounded border bg-slate-50 border-slate-300 p-2">
              <div className="text-slate-800">🎁 مجاني</div>
              <div className="font-mono font-bold text-slate-800">{fmt(transfersBreakdown.free)}</div>
            </div>
          </div>
          <div className="mt-2 text-[11px] text-muted-foreground">
            التحويلات (فودافون / إنستاباي / بنكي / أخرى) دخلت الشركة مباشرةً ولا تُحمَّل على عهدة المندوب نقديًا.
          </div>
        </CardContent>
      </Card>


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
                        const gift = isGiftAssignment(a, o as any);
                        const transfer = !gift && isTransferAssignment(a, o as any);
                        const mixed = !gift && !transfer && o?.collection_method === 'mixed_payment';
                        const nonCash = gift || transfer;
                        // For mixed: cash due comes ONLY from courier_cash_due (electronic + free excluded).
                        // For non-cash: zero. Otherwise full total.
                        const dueAmt = mixed
                          ? Number(o?.courier_cash_due || 0)
                          : nonCash ? 0 : Number(o?.total || 0);
                        const colAmt = Number(col?.amount_collected || 0);
                        const remain = Math.max(0, dueAmt - colAmt);
                        const effectiveStatus = trk || a.status;
                        const stClass = gift
                          ? "bg-pink-500 text-white border border-pink-600"
                          : transfer
                            ? "bg-indigo-500 text-white border border-indigo-600"
                            : mixed
                              ? "bg-amber-500 text-white border border-amber-600"
                              : (STATUS_COLOR[effectiveStatus] || STATUS_COLOR[a.status] || "bg-gray-200 text-gray-800 border border-gray-300");
                        const stIcon = gift ? "🎁" : transfer ? "📲" : mixed ? "🧩" : (STATUS_ICON[effectiveStatus] || STATUS_ICON[a.status] || "•");
                        const stLabel = gift ? "مجاني" : transfer ? "تحويل كاش/انستا" : mixed ? "تحصيل مختلط" : (COURIER_STATUS_LABEL[effectiveStatus] || COURIER_STATUS_LABEL[a.status] || "غير محدد");
                        // Common button styles: always-visible labels, strong colors, no hover-only text.
                        const btnBase = "h-8 px-2 gap-1 text-xs font-semibold border shadow-sm";
                        return (
                          <TableRow key={a.id} className={indent ? "bg-muted/20" : ""}>
                            <TableCell className={`font-mono ${indent ? "pr-8" : ""}`}>
                              <button
                                type="button"
                                className="text-primary underline underline-offset-2 hover:text-primary/80 font-mono"
                                onClick={() => o && navigate(`/orders?mixed=${o.id}`)}
                                disabled={!o}
                                title="فتح شاشة ضبط التحصيل"
                              >
                                {o?.order_number ?? a.order_id.slice(0, 8)}
                              </button>
                            </TableCell>
                            <TableCell>
                              {o ? (
                                <button
                                  type="button"
                                  className="text-primary underline underline-offset-2 hover:text-primary/80"
                                  onClick={() => navigate(`/orders?mixed=${o.id}`)}
                                  title="فتح شاشة ضبط التحصيل"
                                >
                                  {o.customer_name ?? "—"}
                                </button>
                              ) : "—"}
                            </TableCell>
                            <TableCell className="font-mono">
                              <div>{fmt(dueAmt)}</div>
                              {mixed && (
                                <div className="text-[10px] text-amber-700 leading-tight mt-0.5">
                                  إجمالي: {fmt(Number(o?.total || 0))} · 💵 {fmt(Number(o?.courier_cash_due || 0))} · 📱 {fmt(Number(o?.vodafone_cash_amount || 0))} · 💳 {fmt(Number(o?.instapay_amount || 0))} · 🏦 {fmt(Number(o?.bank_transfer_amount || 0))} · 💠 {fmt(Number(o?.other_amount || 0))} · 🎁 {fmt(Number(o?.free_amount || 0))}
                                  {Number(o?.free_amount || 0) > 0 && <> · 🎁 {fmt(Number(o?.free_amount || 0))}</>}
                                </div>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge className={`${stClass} text-xs font-semibold px-2 py-1 whitespace-nowrap`} title={a.status !== effectiveStatus ? `assignment: ${a.status}` : undefined}>
                                <span className="ml-1">{stIcon}</span> {stLabel}
                              </Badge>
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {col ? <>
                                <span className="text-emerald-700">{fmt(colAmt)}</span>
                                {remain > 0 && <span className="text-amber-700"> / متبقي {fmt(remain)}</span>}
                              </> : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell className="text-xs">{new Date(a.assigned_at).toLocaleDateString("ar-EG")}</TableCell>
                            <TableCell className="min-w-[320px]">
                              <div className="flex gap-2 items-center flex-wrap">
                                <Button size="sm" variant="outline" className={`${btnBase} bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-300`} onClick={() => setDetailsOrder(o ?? null)} disabled={!o} title="تفاصيل الأوردر">
                                  <Eye className="w-3.5 h-3.5" /> تفاصيل 👁
                                </Button>

                                {/* شارة الحالة الحالية — واضحة دائمًا */}
                                {effectiveStatus ? (
                                  <Badge className={`${stClass} text-xs font-semibold px-2 py-1 whitespace-nowrap`}>
                                    <span className="ml-1">{stIcon}</span> {stLabel}
                                  </Badge>
                                ) : (
                                  <Badge className="bg-gray-200 text-gray-700 border border-gray-300 text-xs font-semibold px-2 py-1 whitespace-nowrap">
                                    ⚪ لم يتم تحديد الحالة
                                  </Badge>
                                )}

                                {/* قائمة موحّدة لاختيار الحالة */}
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button size="sm" variant="outline" className={`${btnBase} bg-primary text-primary-foreground border-primary hover:bg-primary/90`}>
                                      <ListChecks className="w-3.5 h-3.5" /> اختيار الحالة
                                      <ChevronDown className="w-3.5 h-3.5" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end" className="w-56 bg-popover z-50">
                                    <DropdownMenuLabel>حدّث حالة الأوردر</DropdownMenuLabel>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      onClick={() => updateAssignmentStatus(a.id, a.order_id, "with_courier", "out_for_delivery")}
                                    >
                                      <Truck className="w-4 h-4 ml-2 text-violet-600" /> توزيع للمندوب 🚚
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={async () => { if (await recordDeliveryAndCollection(a.order_id, 0)) { toast({ title: "تم التسليم (آجل)" }); load(); } }}
                                    >
                                      <CheckCircle2 className="w-4 h-4 ml-2 text-sky-600" /> تم التسليم للعميل ✅
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() => {
                                        const ord = o ?? ({ id: a.order_id, order_number: a.order_id.slice(0, 8), total: dueAmt, customer_name: "—", status: a.status, created_at: a.assigned_at } as Order);
                                        setCollectOpen(ord);
                                        setCollectAmt(String(Math.max(0, dueAmt - colAmt)));
                                        setCollectNotes("");
                                      }}
                                    >
                                      <Coins className="w-4 h-4 ml-2 text-emerald-600" /> تحصيل كاش 💵
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={async () => {
                                        const amt = Number(o?.total || 0);
                                        if (!confirm(`تأكيد: تسجيل تحويل فودافون كاش / انستا باى (أحمد الجمل) بمبلغ ${amt.toLocaleString("ar-EG")} ج.م للأوردر ${o?.order_number ?? ""}؟ لن يُطلب أي تحصيل من المندوب.`)) return;
                                        const note = "تحويل فودافون كاش / انستا باى (أحمد الجمل)";
                                        // Mark as delivered without recording cash on the courier (like gift)
                                        const wasDelivered = !!a.delivered_at || ["delivered", "collected", "completed"].includes(a.status);
                                        if (!wasDelivered) {
                                          const ok = await recordDeliveryAndCollection(a.order_id, 0, note);
                                          if (!ok) return;
                                        }
                                        // Persist markers on order + zero the courier cash due
                                        await (supabase as any).from("orders").update({
                                          collection_method: "transfer",
                                          collection_note: note,
                                          courier_cash_due: 0,
                                        }).eq("id", a.order_id);
                                        // Tag the assignment note so the non-cash fallback matches everywhere
                                        const mergedNotes = /فودافون كاش|انستا ?باى|انستا ?باي/.test(a.notes || "")
                                          ? a.notes
                                          : `${a.notes ? a.notes + " | " : ""}${note}`;
                                        await (supabase as any).from("courier_order_assignments").update({ notes: mergedNotes }).eq("id", a.id);
                                        toast({ title: "تم تسجيل التحويل ✅", description: "خرج من مطلوب التحصيل على المندوب." });
                                        load();
                                      }}
                                    >
                                      <span className="ml-2">📲</span> تحويل فودافون كاش / انستا باى (أحمد الجمل)
                                    </DropdownMenuItem>


                                    <DropdownMenuItem
                                      onClick={() => {
                                        const ord = o ?? ({ id: a.order_id, order_number: a.order_id.slice(0, 8), total: dueAmt, customer_name: "—", status: a.status, created_at: a.assigned_at } as Order);
                                        setReturnOpen(ord);
                                        setReturnReason("customer_refused");
                                        setReturnNotes("");
                                        setReturnKind("partial");
                                      }}
                                    >
                                      <RotateCcw className="w-4 h-4 ml-2 text-red-600" /> مرتجع ↩️
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={async () => {
                                        if (!confirm(`تأكيد: تحويل الأوردر ${o?.order_number ?? ""} إلى "مجاني 🎁"؟ لن يُطلب أي تحصيل من المندوب.`)) return;
                                        await markOrderAsGift(a, o);
                                      }}
                                    >
                                      <span className="ml-2">🎁</span> مجاني 🎁
                                    </DropdownMenuItem>

                                    <DropdownMenuItem
                                      onClick={() => {
                                        const ord = o ?? ({ id: a.order_id, order_number: a.order_id.slice(0, 8), total: dueAmt, customer_name: "—", status: a.status, created_at: a.assigned_at } as Order);
                                        setReturnOpen(ord);
                                        setReturnReason("customer_cancelled");
                                        setReturnNotes("ألغى العميل الأوردر — إرجاع كامل");
                                        setReturnKind("full");
                                      }}
                                    >
                                      <span className="ml-2">❌</span> إلغاء
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      onClick={() => {
                                        setCorrectOpen({ assignment: a, order: o });
                                        setCorrectAction(col ? "edit_collection_amount" : a.returned_at ? "reverse_return" : "reverse_collection");
                                        setCorrectReason("");
                                        setCorrectAmount(col ? String(colAmt) : "");
                                      }}
                                    >
                                      <Wrench className="w-4 h-4 ml-2 text-orange-600" /> تصحيح 🔧
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      };

                      if (!groupByDay) return currentAssignments.map((a) => renderOrderRow(a));

                      return groupedByDay.flatMap((grp) => {
                        const isOpen = expandedDays[grp.day] ?? false;
                        const courierName = custodies.find((c) => c.id === selectedCustody)?.courier_name || "—";
                        const printDay = async (e: React.MouseEvent) => {
                          e.stopPropagation();
                          const dayLabel = new Date(grp.day).toLocaleDateString("ar-EG", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
                          const orderIds = grp.items.map((a) => a.order_id);
                          const { data: itemsData } = await (supabase as any)
                            .from("order_items")
                            .select("order_id, product_name, quantity, unit_price, total_price, is_gift, offer_name")
                            .in("order_id", orderIds);
                          const itemsByOrder: Record<string, any[]> = {};
                          (itemsData || []).forEach((it: any) => {
                            (itemsByOrder[it.order_id] = itemsByOrder[it.order_id] || []).push(it);
                          });
                          let sumTotal = 0, sumCash = 0, sumVoda = 0, sumInsta = 0, sumBank = 0, sumOther = 0, sumFree = 0;
                          let cntGift = 0, cntMixed = 0;
                          const blocks = grp.items.map((a, i) => {
                            const o = orders.find((x) => x.id === a.order_id);
                            const cm = o?.collection_method || null;
                            const isGift = o?.update_status_marker === "gift" || cm === "none";
                            const orderTotal = Number(o?.total || 0);
                            const voda = Number(o?.vodafone_cash_amount || 0);
                            const insta = Number(o?.instapay_amount || 0);
                            const bank = Number(o?.bank_transfer_amount || 0);
                            const other = Number(o?.other_amount || 0);
                            const freeAmt = isGift ? orderTotal : Number(o?.free_amount || 0);
                            let cashFromCourier = 0;
                            const shipFee = Number(o?.delivery_fee || 0);
                            if (isAgouza) {
                              // Agouza sheet upload: cash = COD − shipping fee (courier keeps the shipping).
                              cashFromCourier = Math.max(0, orderTotal - shipFee);
                            } else if (isGift) cashFromCourier = 0;
                            else if (cm === "mixed_payment") cashFromCourier = Number(o?.courier_cash_due || 0);
                            else if (cm === "vodafone_cash" || cm === "instapay" || cm === "bank_transfer") cashFromCourier = 0;
                            else cashFromCourier = Math.max(0, orderTotal - voda - insta - bank - other - freeAmt);
                            const remaining = Math.max(0, orderTotal - voda - insta - bank - other - freeAmt - cashFromCourier);
                            sumTotal += orderTotal; sumCash += cashFromCourier; sumVoda += voda; sumInsta += insta; sumBank += bank; sumOther += other; sumFree += freeAmt;
                            if (isGift) cntGift++;
                            if (cm === "mixed_payment") cntMixed++;
                            const trk = tracking[a.order_id];
                            const statusLabel = isGift ? "مجاني 🎁" : (COURIER_STATUS_LABEL[trk || a.status] || a.status);
                            const its = itemsByOrder[a.order_id] || [];
                            const itemsRows = its.map((it) => {
                              const qty = Number(it.quantity || 0);
                              const tp = Number(it.total_price || 0);
                              const up = Number(it.unit_price || 0) > 0 ? Number(it.unit_price) : (qty > 0 ? tp / qty : 0);
                              const name = it.offer_name ? `${it.product_name} <span style="color:#7c3aed">(${it.offer_name})</span>` : it.product_name;
                              return `<tr><td>${name}</td><td style="text-align:center">${qty}</td><td style="text-align:left;font-family:monospace">${fmt(up)}</td><td style="text-align:left;font-family:monospace">${fmt(tp)}</td></tr>`;
                            }).join("") || `<tr><td colspan="4" style="text-align:center;color:#999">لا توجد أصناف</td></tr>`;
                            const cashBg = cashFromCourier > 0 ? "background:#ecfdf5;color:#065f46" : "background:#f3f4f6;color:#666";
                            return `
                              <div class="order-block">
                                <div class="oh">
                                  <div><span class="lbl">#${i + 1}</span> <b>${o?.order_number ?? a.order_id.slice(0, 8)}</b> — ${o?.customer_name ?? "—"} <span class="st">${statusLabel}</span></div>
                                </div>
                                <div class="ol">
                                  <div><span>إجمالي الأوردر:</span> <b>${fmt(orderTotal)}</b></div>
                                  <div style="${cashBg};padding:2px 8px;border-radius:4px"><span>💵 نقدي مطلوب من ${courierLabel}:</span> <b>${fmt(cashFromCourier)}</b></div>
                                  ${voda ? `<div><span>📱 فودافون:</span> <b>${fmt(voda)}</b></div>` : ""}
                                  ${insta ? `<div><span>💳 إنستاباي:</span> <b>${fmt(insta)}</b></div>` : ""}
                                  ${bank ? `<div><span>🏦 بنكي:</span> <b>${fmt(bank)}</b></div>` : ""}
                                  ${other ? `<div><span>💠 أخرى:</span> <b>${fmt(other)}</b></div>` : ""}
                                  ${freeAmt ? `<div><span>🎁 مجاني:</span> <b>${fmt(freeAmt)}</b></div>` : ""}
                                  ${remaining ? `<div style="color:#b45309"><span>⚠️ متبقي:</span> <b>${fmt(remaining)}</b></div>` : ""}
                                </div>
                                <table class="items">
                                  <thead><tr><th>المنتج</th><th style="width:60px">الكمية</th><th style="width:90px">سعر الوحدة</th><th style="width:100px">إجمالي الصنف</th></tr></thead>
                                  <tbody>${itemsRows}</tbody>
                                </table>
                              </div>`;
                          }).join("");
                          const body = `
                            <div class="meta">
                              <div><strong>المندوب:</strong> ${courierName}</div>
                              <div><strong>اليوم:</strong> ${dayLabel}</div>
                              <div><strong>عدد الأوردرات:</strong> ${grp.items.length}</div>
                              <div><strong>مجاني:</strong> ${cntGift}</div>
                              <div><strong>مختلط:</strong> ${cntMixed}</div>
                            </div>
                            ${blocks}
                            <div class="totals">
                              <div class="t-row"><span>إجمالي قيمة الأوردرات (للعرض فقط):</span><b>${fmt(sumTotal)} ج.م</b></div>
                              <div class="t-row"><span>إجمالي فودافون كاش:</span><b>${fmt(sumVoda)} ج.م</b></div>
                              <div class="t-row"><span>إجمالي إنستاباي:</span><b>${fmt(sumInsta)} ج.م</b></div>
                              <div class="t-row"><span>إجمالي تحويل بنكي:</span><b>${fmt(sumBank)} ج.م</b></div>
                              ${sumOther ? `<div class="t-row"><span>إجمالي أخرى:</span><b>${fmt(sumOther)} ج.م</b></div>` : ""}
                              <div class="t-row"><span>إجمالي المجاني / الهدايا:</span><b>${fmt(sumFree)} ج.م</b></div>
                              <div class="t-row highlight"><span>💵 إجمالي النقدية المطلوب استلامها من ${courierLabel}:</span><b>${fmt(sumCash)} ج.م</b></div>
                              <div class="note">ملاحظة: التحويلات (فودافون/إنستاباي/بنكي) والأوردرات المجانية تظهر للإثبات فقط ولا تدخل نقدًا مع المندوب. المبلغ الفعلي الذي يدخل خزنة المخزن الرئيسي = النقدية المطلوبة من ${courierLabel} فقط (مجموع courier_cash_due).</div>
                            </div>`;
                          const css = `
                            .meta { display:flex; gap:20px; flex-wrap:wrap; margin-bottom:12px; font-size:12px; padding:8px; background:#f9fafb; border:1px solid #e5e7eb; border-radius:4px; }
                            .order-block { margin-bottom:14px; border:1px solid #d1d5db; border-radius:6px; padding:8px; page-break-inside: avoid; }
                            .oh { font-size:13px; padding-bottom:6px; border-bottom:1px solid #e5e7eb; margin-bottom:6px; }
                            .oh .lbl { background:#6366f1; color:#fff; padding:1px 6px; border-radius:3px; font-size:11px; }
                            .oh .st { color:#059669; font-size:11px; margin-right:6px; }
                            .ol { display:flex; flex-wrap:wrap; gap:8px 14px; font-size:11px; margin-bottom:6px; }
                            .ol b { font-family:monospace; }
                            table.items { width:100%; border-collapse:collapse; font-size:11px; }
                            table.items th, table.items td { border:1px solid #d1d5db; padding:3px 6px; text-align:right; }
                            table.items thead th { background:#f3f4f6; }
                            .totals { margin-top:14px; font-size:12px; border:2px solid #6366f1; padding:10px; background:#fafafa; border-radius:6px; }
                            .t-row { display:flex; justify-content:space-between; padding:3px 0; border-bottom:1px dashed #ddd; }
                            .t-row.highlight { background:#fef3c7; padding:8px; margin-top:6px; font-size:15px; border:2px solid #f59e0b; border-radius:4px; }
                            .note { margin-top:8px; font-size:10px; color:#555; line-height:1.6; }
                          `;
                          openPrintWindow(`عهدة ${courierName} — ${dayLabel}`, body, css);
                        };

                        const rows: JSX.Element[] = [
                          <TableRow key={`day-${grp.day}`} className="bg-primary/5 hover:bg-primary/10 cursor-pointer font-medium"
                            onClick={() => setExpandedDays((s) => ({ ...s, [grp.day]: !isOpen }))}>
                            <TableCell className="font-bold">
                              <div className="flex flex-col gap-1">
                                <div className="flex items-center gap-2">
                                  {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
                                  <span>{new Date(grp.day).toLocaleDateString("ar-EG", { weekday: "long", day: "numeric", month: "long" })}</span>
                                  <Badge variant="secondary" className="text-xs">{grp.items.length} أوردر</Badge>
                                  {grp.deposit ? (
                                    <Badge className="bg-emerald-600 text-white text-[10px]">✓ تم التوريد {fmt(Number(grp.deposit.amount))} ج.م</Badge>
                                  ) : grp.undelivered > 0 ? (
                                    <Badge className="bg-amber-500 text-white text-[10px]">يحتاج مراجعة ({grp.undelivered} غير مسلّم)</Badge>
                                  ) : grp.missingBreakdown > 0 ? (
                                    <Badge className="bg-orange-500 text-white text-[10px]">breakdown غير مضبوط ({grp.missingBreakdown})</Badge>
                                  ) : (
                                    <Badge variant="outline" className="text-[10px]">لم يتم التوريد</Badge>
                                  )}
                                </div>
                                <div className="text-[10px] text-muted-foreground font-normal flex flex-wrap gap-2">
                                  <span>💵 كاش مع {courierLabel}: <b className="text-emerald-700">{fmt(grp.cashDue)}</b></span>
                                  {grp.vodafone > 0 && <span>📱 فودافون: {fmt(grp.vodafone)}</span>}
                                  {grp.instapay > 0 && <span>💳 إنستاباي: {fmt(grp.instapay)}</span>}
                                  {grp.bank > 0 && <span>🏦 بنكي: {fmt(grp.bank)}</span>}
                                  {grp.other > 0 && <span>💠 أخرى: {fmt(grp.other)}</span>}
                                  {grp.free > 0 && <span>🎁 مجاني: {fmt(grp.free)}</span>}
                                </div>
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
                              <div className="flex items-center gap-2 flex-wrap">
                                <Button size="sm" variant="outline" className="h-7 px-2 gap-1" onClick={printDay} title="طباعة أوردرات اليوم">
                                  <Printer className="w-3 h-3" /> <span className="text-xs">طباعة</span>
                                </Button>
                                {grp.deposit ? (
                                  <Badge variant="outline" className="text-[10px] gap-1">
                                    <CheckCircle2 className="w-3 h-3 text-emerald-600" /> رقم الحركة {grp.deposit.treasury_txn_id?.slice(0, 8) || "—"}
                                  </Badge>
                                ) : (
                                  <Button
                                    size="sm"
                                    className="h-7 px-2 gap-1 bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50"
                                    disabled={!grp.canDeposit || depositingDay === grp.day}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (!grp.canDeposit) {
                                        toast({ title: "لا يمكن التوريد الآن", description: grp.undelivered > 0 ? "لا يمكن التوريد قبل مراجعة تحصيل كل الأوردرات." : grp.missingBreakdown > 0 ? "يوجد أوردر دفع مختلط بدون breakdown مضبوط" : "لا توجد أوردرات لليوم", variant: "destructive" });
                                        return;
                                      }
                                      depositDayCash(grp.day, grp.cashDue);
                                    }}
                                    title="توريد اليوم لخزنة المخزن الرئيسي (حتى لو صفر نقدية)"
                                  >
                                    <Coins className="w-3 h-3" />
                                    <span className="text-xs">{depositingDay === grp.day ? "جاري..." : `توريد ${fmt(grp.cashDue)}`}</span>
                                  </Button>
                                )}
                                <span className="text-muted-foreground text-[10px]">{isOpen ? "إخفاء" : "عرض"}</span>
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
        <DialogContent dir="rtl" className="max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
          <DialogHeader><DialogTitle>تفاصيل {detailsOrder?.order_number}</DialogTitle></DialogHeader>
          <div className="flex-1 overflow-y-auto pr-1">
            <OrderDetailsBody order={detailsOrder} />
          </div>
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
  const navigate = useNavigate();
  const [items, setItems] = useState<any[]>([]);
  const [bonuses, setBonuses] = useState<any[]>([]);
  const [full, setFull] = useState<any | null>(null);
  useEffect(() => {
    if (!order) return;
    (async () => {
      const [itRes, bonRes, ordRes] = await Promise.all([
        (supabase as any).from("order_items").select("*").eq("order_id", order.id),
        (supabase as any).from("courier_goods_custody_lines").select("*").eq("order_id", order.id).in("line_type", ["bonus", "sale"]),
        (supabase as any).from("orders").select("subtotal, discount, delivery_fee, total, collection_method, courier_cash_due, vodafone_cash_amount, instapay_amount, bank_transfer_amount, other_amount, free_amount, transfer_reference, collection_note").eq("id", order.id).maybeSingle(),
      ]);
      setItems(itRes.data || []);
      setBonuses(bonRes.data || []);
      setFull(ordRes.data || null);
    })();
  }, [order]);
  if (!order) return null;

  // Robust price resolution: unit_price → fallback total/qty; never render bare dot/NaN.
  const priceOf = (it: any) => {
    const qty = Number(it.quantity || 0);
    const unit = Number(it.unit_price ?? it.price ?? 0);
    const total = Number(it.total_price ?? it.line_total ?? it.subtotal ?? it.item_total ?? 0);
    const resolvedUnit = unit > 0 ? unit : (total > 0 && qty > 0 ? total / qty : 0);
    const resolvedTotal = total > 0 ? total : (resolvedUnit > 0 ? resolvedUnit * qty : 0);
    const isFree = resolvedUnit === 0 && resolvedTotal === 0 && (it.offer_name || /هدية|مجاني/.test(String(it.product_name || "")) || Number(order.total || 0) > 0);
    return { qty, resolvedUnit, resolvedTotal, isFree };
  };

  const cm = full?.collection_method ?? order.collection_method;
  const collectionRows: Array<[string, number]> = ([
    ["💵 نقدي مع المندوب", Number(full?.courier_cash_due ?? order.courier_cash_due ?? 0)],
    ["📱 فودافون كاش", Number(full?.vodafone_cash_amount ?? order.vodafone_cash_amount ?? 0)],
    ["💳 إنستاباي", Number(full?.instapay_amount ?? order.instapay_amount ?? 0)],
    ["🏦 تحويل بنكي", Number(full?.bank_transfer_amount ?? order.bank_transfer_amount ?? 0)],
    ["💠 أخرى", Number(full?.other_amount ?? order.other_amount ?? 0)],
    ["🎁 مجاني", Number(full?.free_amount ?? order.free_amount ?? 0)],
  ] as Array<[string, number]>).filter(([, v]) => v > 0);

  return (
    <div className="space-y-3 text-sm pb-2">
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div><span className="text-muted-foreground">رقم الأوردر:</span> <span className="font-mono">{order.order_number}</span></div>
        <div><span className="text-muted-foreground">العميل:</span> {order.customer_name ?? "—"}</div>
        <div><span className="text-muted-foreground">القيمة:</span> <span className="font-mono">{fmt(Number(order.total || 0))} ج.م</span></div>
        <div><span className="text-muted-foreground">التاريخ:</span> {new Date(order.created_at).toLocaleString("ar-EG")}</div>
      </div>
      <div>
        <div className="font-semibold mb-1">الأصناف</div>
        <Table>
          <TableHeader><TableRow><TableHead>الصنف</TableHead><TableHead>الكمية</TableHead><TableHead>سعر الوحدة</TableHead><TableHead>إجمالي الصنف</TableHead></TableRow></TableHeader>
          <TableBody>
            {items.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">—</TableCell></TableRow> :
             items.map((it) => {
              const { qty, resolvedUnit, resolvedTotal, isFree } = priceOf(it);
              return (
                <TableRow key={it.id}>
                  <TableCell>
                    {it.product_name}
                    {it.offer_name ? <span className="block text-[10px] text-muted-foreground">ضمن {it.offer_name}</span> : null}
                  </TableCell>
                  <TableCell className="font-mono">{fmt(qty)}</TableCell>
                  <TableCell className="font-mono">
                    {resolvedUnit > 0 ? `${fmt(resolvedUnit)} ج.م`
                      : isFree ? <Badge variant="outline" className="text-[10px]">🎁 مجاني / ضمن عرض — 0 ج.م</Badge>
                      : <span className="text-muted-foreground text-xs">غير محسوب</span>}
                  </TableCell>
                  <TableCell className="font-mono">
                    {resolvedTotal > 0 ? `${fmt(resolvedTotal)} ج.م`
                      : isFree ? "0 ج.م"
                      : <span className="text-muted-foreground text-xs">غير محسوب</span>}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Financial summary */}
      <div className="border rounded-md p-3 bg-muted/30 space-y-1 text-xs">
        <div className="font-semibold mb-1">الملخص المالي</div>
        <div className="flex justify-between"><span>الأصناف:</span><span className="font-mono">{fmt(Number(full?.subtotal ?? 0))} ج.م</span></div>
        <div className="flex justify-between"><span>الخصم:</span><span className="font-mono">{fmt(Number(full?.discount ?? 0))} ج.م</span></div>
        <div className="flex justify-between"><span>الشحن:</span><span className="font-mono">{fmt(Number(full?.delivery_fee ?? 0))} ج.م</span></div>
        <div className="flex justify-between font-bold text-sm border-t pt-1 mt-1"><span>الإجمالي:</span><span className="font-mono">{fmt(Number(full?.total ?? order.total ?? 0))} ج.م</span></div>
      </div>

      {/* Collection breakdown */}
      <div className="border rounded-md p-3 bg-amber-50/50 space-y-1 text-xs">
        <div className="flex items-center justify-between mb-1">
          <div className="font-semibold">تفاصيل التحصيل {cm === "mixed_payment" ? "🧩 (مختلط)" : ""}</div>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => navigate(`/orders?mixed=${order.id}`)}>
            <Coins className="w-3.5 h-3.5" /> ضبط التحصيل
          </Button>
        </div>
        {collectionRows.length === 0 ? (
          <div className="text-muted-foreground">لم يتم تسجيل تفاصيل تحصيل بعد.</div>
        ) : collectionRows.map(([label, v]) => (
          <div key={label} className="flex justify-between"><span>{label}:</span><span className="font-mono">{fmt(v)} ج.م</span></div>
        ))}
        {(full?.transfer_reference || order.transfer_reference) && (
          <div className="flex justify-between"><span>مرجع التحويل:</span><span className="font-mono">{full?.transfer_reference ?? order.transfer_reference}</span></div>
        )}
        {(full?.collection_note || order.collection_note) && (
          <div className="text-muted-foreground">ملاحظات: {full?.collection_note ?? order.collection_note}</div>
        )}
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
