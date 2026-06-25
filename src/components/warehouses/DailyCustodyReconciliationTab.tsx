import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClipboardCheck, RefreshCw, CheckCircle2, AlertTriangle, Package, Wallet, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

/**
 * شاشة رقابية فقط — لا تعدل أي أرصدة أو حركات.
 * تعتمد على البيانات الموجودة في:
 *   - courier_goods_custody_lines (issue / sale / return / bonus / cash_collect + discount_amount)
 *   - courier_order_assignments  (عدد الأوردرات + العملاء)
 *   - main_warehouse_treasury_txns (التوريد لخزينة المخزن — direction=in / category=courier_deposit)
 */

interface Line {
  id: string;
  custody_id: string;
  line_type: string;
  quantity: number;
  unit_price: number;
  total_value: number;
  cash_collected: number;
  discount_amount: number | null;
  customer_id: string | null;
  customer_name: string | null;
  performed_at: string;
}

interface CustodyRow {
  id: string;
  courier_name: string;
  status: string;
}

interface MwTxn {
  amount: number;
  category: string;
  direction: string;
  courier_name: string | null;
  performed_at: string;
}

interface Assignment {
  custody_id: string | null;
  courier_name: string;
  order_id: string;
}

interface CourierSummary {
  courier_name: string;
  custody_ids: string[];
  // Goods
  issuedValue: number;
  soldValue: number;
  returnedValue: number;
  bonusValue: number;
  discountValue: number;
  remainingGoodsValue: number;
  // Cash
  salesValue: number;
  requiredCollect: number;
  collected: number;
  depositedToMW: number;
  cashRemaining: number;
  // Orders
  ordersCount: number;
  customersCount: number;
  // Status
  status: "balanced" | "cash_deficit" | "goods_diff" | "both";
  cashDiff: number; // requiredCollect - collected
  goodsDiff: number; // remainingGoodsValue
}

const todayIsoDate = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
};

const fmt = (n: number) =>
  Number(n || 0).toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function DailyCustodyReconciliationTab() {
  const [date, setDate] = useState<string>(todayIsoDate());
  const [loading, setLoading] = useState(false);
  const [courierFilter, setCourierFilter] = useState<string>("all");

  const [lines, setLines] = useState<Line[]>([]);
  const [custodies, setCustodies] = useState<CustodyRow[]>([]);
  const [mwTxns, setMwTxns] = useState<MwTxn[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);

  const dayStart = useMemo(() => new Date(`${date}T00:00:00`).toISOString(), [date]);
  const dayEnd = useMemo(() => new Date(`${date}T23:59:59.999`).toISOString(), [date]);

  const load = async () => {
    setLoading(true);
    try {
      const [linesRes, custodiesRes, mwRes, asgRes] = await Promise.all([
        (supabase as any)
          .from("courier_goods_custody_lines")
          .select("id, custody_id, line_type, quantity, unit_price, total_value, cash_collected, discount_amount, customer_id, customer_name, performed_at")
          .gte("performed_at", dayStart)
          .lte("performed_at", dayEnd),
        (supabase as any)
          .from("courier_goods_custodies")
          .select("id, courier_name, status"),
        (supabase as any)
          .from("main_warehouse_treasury_txns")
          .select("amount, category, direction, courier_name, performed_at, status")
          .gte("performed_at", dayStart)
          .lte("performed_at", dayEnd),
        (supabase as any)
          .from("courier_order_assignments")
          .select("custody_id, courier_name, order_id, assigned_at")
          .gte("assigned_at", dayStart)
          .lte("assigned_at", dayEnd),
      ]);
      setLines((linesRes.data as Line[]) || []);
      setCustodies((custodiesRes.data as CustodyRow[]) || []);
      setMwTxns(((mwRes.data as any[]) || []).filter((t) => t.status !== "rejected") as MwTxn[]);
      setAssignments((asgRes.data as Assignment[]) || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [date]);

  const summaries: CourierSummary[] = useMemo(() => {
    const custodyMap = new Map(custodies.map((c) => [c.id, c.courier_name]));
    const byCourier = new Map<string, CourierSummary>();

    const ensure = (name: string): CourierSummary => {
      const key = name || "—";
      if (!byCourier.has(key)) {
        byCourier.set(key, {
          courier_name: key, custody_ids: [],
          issuedValue: 0, soldValue: 0, returnedValue: 0, bonusValue: 0, discountValue: 0, remainingGoodsValue: 0,
          salesValue: 0, requiredCollect: 0, collected: 0, depositedToMW: 0, cashRemaining: 0,
          ordersCount: 0, customersCount: 0,
          status: "balanced", cashDiff: 0, goodsDiff: 0,
        });
      }
      return byCourier.get(key)!;
    };

    for (const l of lines) {
      const courierName = custodyMap.get(l.custody_id) || "—";
      const s = ensure(courierName);
      if (!s.custody_ids.includes(l.custody_id)) s.custody_ids.push(l.custody_id);

      const value = Number(l.total_value || 0);
      switch (l.line_type) {
        case "issue":
          s.issuedValue += value;
          break;
        case "sale":
          s.soldValue += value;
          s.salesValue += value;
          s.discountValue += Number(l.discount_amount || 0);
          break;
        case "return":
          s.returnedValue += value;
          break;
        case "bonus":
          s.bonusValue += value;
          break;
        case "cash_collect":
          s.collected += Number(l.cash_collected || 0);
          break;
        default:
          break;
      }
    }

    // Orders & unique customers
    const customerSetByCourier = new Map<string, Set<string>>();
    const orderSetByCourier = new Map<string, Set<string>>();
    for (const a of assignments) {
      const name = a.courier_name || (a.custody_id ? custodyMap.get(a.custody_id) : "—") || "—";
      ensure(name);
      if (!orderSetByCourier.has(name)) orderSetByCourier.set(name, new Set());
      orderSetByCourier.get(name)!.add(a.order_id);
    }
    for (const l of lines) {
      const name = custodyMap.get(l.custody_id) || "—";
      if (!customerSetByCourier.has(name)) customerSetByCourier.set(name, new Set());
      if (l.customer_id) customerSetByCourier.get(name)!.add(l.customer_id);
      else if (l.customer_name) customerSetByCourier.get(name)!.add(`name:${l.customer_name}`);
    }

    // MW deposits by courier
    for (const t of mwTxns) {
      if (t.direction === "in" && t.category === "courier_deposit") {
        const name = t.courier_name || "—";
        const s = ensure(name);
        s.depositedToMW += Number(t.amount || 0);
      }
    }

    // Finalize
    for (const s of byCourier.values()) {
      s.remainingGoodsValue = s.issuedValue - s.soldValue - s.returnedValue - s.bonusValue;
      s.requiredCollect = s.salesValue; // sale total_value already net of discount (سعر بيع فعلي * كمية)
      s.cashRemaining = s.collected - s.depositedToMW;
      s.cashDiff = s.requiredCollect - s.collected;
      s.goodsDiff = s.remainingGoodsValue;
      s.ordersCount = orderSetByCourier.get(s.courier_name)?.size || 0;
      s.customersCount = customerSetByCourier.get(s.courier_name)?.size || 0;

      const cashBad = Math.abs(s.cashDiff) > 0.009;
      const goodsBad = Math.abs(s.goodsDiff) > 0.009;
      s.status = cashBad && goodsBad ? "both" : cashBad ? "cash_deficit" : goodsBad ? "goods_diff" : "balanced";
    }

    return Array.from(byCourier.values()).sort((a, b) => a.courier_name.localeCompare(b.courier_name, "ar"));
  }, [lines, custodies, mwTxns, assignments]);

  const couriers = useMemo(() => summaries.map((s) => s.courier_name), [summaries]);
  const filteredSummaries = useMemo(
    () => (courierFilter === "all" ? summaries : summaries.filter((s) => s.courier_name === courierFilter)),
    [summaries, courierFilter],
  );

  // Aggregated MW totals for the day (informational)
  const mwTransferredToMain = useMemo(
    () =>
      mwTxns
        .filter((t) => t.direction === "out" && (t.category === "transfer_to_main_treasury" || t.category === "transfer_from_main_warehouse_treasury"))
        .reduce((s, t) => s + Number(t.amount || 0), 0),
    [mwTxns],
  );

  const statusBadge = (s: CourierSummary["status"]) => {
    if (s === "balanced") return <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white"><CheckCircle2 className="w-3 h-3 ml-1" />العهدة متزنة</Badge>;
    if (s === "cash_deficit") return <Badge variant="destructive"><AlertTriangle className="w-3 h-3 ml-1" />عجز نقدي</Badge>;
    if (s === "goods_diff") return <Badge variant="destructive"><AlertTriangle className="w-3 h-3 ml-1" />فرق بضائع</Badge>;
    return <Badge variant="destructive"><AlertTriangle className="w-3 h-3 ml-1" />عجز نقدي + فرق بضائع</Badge>;
  };

  return (
    <div className="space-y-4" dir="rtl">
      {/* Header */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-primary" />
            تسوية عهدة المندوب اليومية — شاشة رقابية
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label>التاريخ</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" />
          </div>
          <div className="space-y-1">
            <Label>المندوب</Label>
            <Select value={courierFilter} onValueChange={setCourierFilter}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                {couriers.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ml-1 ${loading ? "animate-spin" : ""}`} />تحديث
          </Button>
          <div className="text-xs text-muted-foreground mr-auto">
            تقرير رقابي فقط — لا يؤثر على أي رصيد أو حركة.
          </div>
        </CardContent>
      </Card>

      {/* Per-courier reconciliation cards */}
      {filteredSummaries.length === 0 && (
        <Card><CardContent className="py-12 text-center text-muted-foreground">لا توجد بيانات لهذا اليوم.</CardContent></Card>
      )}

      {filteredSummaries.map((s) => (
        <Card key={s.courier_name} className="border-r-4 border-r-primary">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" />{s.courier_name}
                <span className="text-xs text-muted-foreground font-normal">
                  ({s.ordersCount} أوردر — {s.customersCount} عميل)
                </span>
              </CardTitle>
              {statusBadge(s.status)}
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            {/* Goods */}
            <div className="rounded-lg border p-3 bg-muted/20">
              <div className="flex items-center gap-2 mb-2 font-semibold"><Package className="w-4 h-4" />ملخص البضاعة</div>
              <Table>
                <TableBody>
                  <TableRow><TableCell>إجمالي البضاعة المصروفة</TableCell><TableCell className="text-left font-mono">{fmt(s.issuedValue)}</TableCell></TableRow>
                  <TableRow><TableCell>إجمالي البضاعة المباعة</TableCell><TableCell className="text-left font-mono">{fmt(s.soldValue)}</TableCell></TableRow>
                  <TableRow><TableCell>إجمالي المرتجعات</TableCell><TableCell className="text-left font-mono">{fmt(s.returnedValue)}</TableCell></TableRow>
                  <TableRow><TableCell>إجمالي المجانيات</TableCell><TableCell className="text-left font-mono">{fmt(s.bonusValue)}</TableCell></TableRow>
                  <TableRow><TableCell>إجمالي الخصومات</TableCell><TableCell className="text-left font-mono">{fmt(s.discountValue)}</TableCell></TableRow>
                  <TableRow className="bg-muted/40 font-bold">
                    <TableCell>البضاعة المتبقية مع المندوب</TableCell>
                    <TableCell className={`text-left font-mono ${Math.abs(s.remainingGoodsValue) > 0.009 ? "text-destructive" : ""}`}>{fmt(s.remainingGoodsValue)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>

            {/* Cash */}
            <div className="rounded-lg border p-3 bg-muted/20">
              <div className="flex items-center gap-2 mb-2 font-semibold"><Wallet className="w-4 h-4" />ملخص النقدية</div>
              <Table>
                <TableBody>
                  <TableRow><TableCell>إجمالي قيمة المبيعات</TableCell><TableCell className="text-left font-mono">{fmt(s.salesValue)}</TableCell></TableRow>
                  <TableRow><TableCell>المطلوب تحصيله</TableCell><TableCell className="text-left font-mono">{fmt(s.requiredCollect)}</TableCell></TableRow>
                  <TableRow><TableCell>ما تم تحصيله</TableCell><TableCell className="text-left font-mono">{fmt(s.collected)}</TableCell></TableRow>
                  <TableRow><TableCell>المورد لخزينة المخزن الرئيسي</TableCell><TableCell className="text-left font-mono">{fmt(s.depositedToMW)}</TableCell></TableRow>
                  <TableRow><TableCell>إجمالي المحول للخزينة الرئيسية (إجمالي اليوم)</TableCell><TableCell className="text-left font-mono text-muted-foreground">{fmt(mwTransferredToMain)}</TableCell></TableRow>
                  <TableRow className="bg-muted/40 font-bold">
                    <TableCell>النقدية المتبقية مع المندوب</TableCell>
                    <TableCell className={`text-left font-mono ${Math.abs(s.cashRemaining) > 0.009 ? "text-amber-700" : ""}`}>{fmt(s.cashRemaining)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>

            {/* Reconciliation details */}
            {(Math.abs(s.cashDiff) > 0.009 || Math.abs(s.goodsDiff) > 0.009) && (
              <div className="md:col-span-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm space-y-1">
                {Math.abs(s.cashDiff) > 0.009 && (
                  <div>🔴 فرق نقدي = المطلوب تحصيله ({fmt(s.requiredCollect)}) − المحصل ({fmt(s.collected)}) = <b>{fmt(s.cashDiff)}</b> ج.م</div>
                )}
                {Math.abs(s.goodsDiff) > 0.009 && (
                  <div>🔴 فرق بضائع (قيمي) = المصروف − (المباع + المرتجع + المجاني) = <b>{fmt(s.goodsDiff)}</b> ج.م</div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      ))}

      {/* Admin daily review table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardCheck className="h-4 w-4 text-primary" />تقرير المراجعة اليومي للإدارة
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>المندوب</TableHead>
                <TableHead>عدد العملاء</TableHead>
                <TableHead>عدد الأوردرات</TableHead>
                <TableHead>المبيعات</TableHead>
                <TableHead>التحصيل</TableHead>
                <TableHead>المرتجعات</TableHead>
                <TableHead>المجانيات</TableHead>
                <TableHead>الخصومات</TableHead>
                <TableHead>الحالة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summaries.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="text-center py-6 text-muted-foreground">لا توجد بيانات.</TableCell></TableRow>
              ) : (
                summaries.map((s) => (
                  <TableRow key={`tbl-${s.courier_name}`}>
                    <TableCell className="font-medium">{s.courier_name}</TableCell>
                    <TableCell>{s.customersCount}</TableCell>
                    <TableCell>{s.ordersCount}</TableCell>
                    <TableCell className="font-mono">{fmt(s.salesValue)}</TableCell>
                    <TableCell className="font-mono">{fmt(s.collected)}</TableCell>
                    <TableCell className="font-mono">{fmt(s.returnedValue)}</TableCell>
                    <TableCell className="font-mono">{fmt(s.bonusValue)}</TableCell>
                    <TableCell className="font-mono">{fmt(s.discountValue)}</TableCell>
                    <TableCell>{statusBadge(s.status)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
