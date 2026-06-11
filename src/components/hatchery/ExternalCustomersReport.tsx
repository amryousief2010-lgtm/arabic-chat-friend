import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Users, Egg, Bird, Wallet, TrendingUp, AlertTriangle, Trophy, Printer, FileSpreadsheet, FileText, Eye,
} from "lucide-react";
import { format } from "date-fns";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LineChart, Line, Legend } from "recharts";
import { exportCSV } from "@/lib/csvExport";
import { openPrintWindow } from "@/lib/printPdf";
import { toast } from "sonner";

type Customer = { id: string; name: string; customer_type: string; is_active: boolean; notes: string | null; is_test?: boolean | null };
type Batch = {
  id: string; customer_id: string; operational_batch_no: number | null; batch_number: string;
  receive_date: string; entry_date: string; exit_date: string | null;
  received_eggs: number; net_eggs: number;
  candle1_infertile: number; candle1_fertile: number;
  candle2_dead: number; candle2_fertile: number;
  hatched_chicks: number; hatcher_dead: number;
  brooding_days: number | null; status: string; notes: string | null;
  machine: string | null;
};
type Payment = { id: string; customer_id: string; payment_date: string; amount: number; notes: string | null };
type Pricing = {
  infertile_egg_price: number; chick_price: number; completed_unhatched_price: number;
  daily_brooding_price: number;
};

const todayISO = () => format(new Date(), "yyyy-MM-dd");
const monthStartISO = () => { const d = new Date(); d.setDate(1); return format(d, "yyyy-MM-dd"); };
const num = (v: any) => (v == null || isNaN(Number(v)) ? 0 : Number(v));
const fmt = (v: any) => num(v).toLocaleString("ar-EG");
const fmtMoney = (v: any) => `${num(v).toLocaleString("ar-EG", { maximumFractionDigits: 2 })} ج.م`;

type SortKey = "eggs" | "revenue" | "profit" | "hatch_rate" | "remaining" | "name";

export default function ExternalCustomersReport() {
  const [fromDate, setFromDate] = useState<string>(monthStartISO());
  const [toDate, setToDate] = useState<string>(todayISO());
  const [customerFilter, setCustomerFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all"); // all | paid | owes | credit
  const [sortKey, setSortKey] = useState<SortKey>("eggs");
  const [detailsCustomerId, setDetailsCustomerId] = useState<string | null>(null);

  const { data: customers = [] } = useQuery({
    queryKey: ["ecr_customers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hatch_customers")
        .select("id,name,customer_type,is_active,notes,is_test")
        .eq("customer_type", "external")
        .order("name");
      if (error) throw error;
      return (data || []) as Customer[];
    },
  });

  const { data: batches = [] } = useQuery({
    queryKey: ["ecr_batches", fromDate, toDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hatch_batches")
        .select("*")
        .gte("entry_date", fromDate)
        .lte("entry_date", toDate)
        .order("entry_date", { ascending: false });
      if (error) throw error;
      return (data || []) as Batch[];
    },
  });

  const { data: payments = [] } = useQuery({
    queryKey: ["ecr_payments", fromDate, toDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hatch_customer_payments")
        .select("id,customer_id,payment_date,amount,notes")
        .order("payment_date", { ascending: false });
      if (error) throw error;
      return (data || []) as Payment[];
    },
  });

  const { data: pricing } = useQuery({
    queryKey: ["ecr_pricing"],
    queryFn: async () => {
      const { data } = await supabase
        .from("hatchery_pricing_settings")
        .select("infertile_egg_price,chick_price,completed_unhatched_price,daily_brooding_price")
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      return (data || {
        infertile_egg_price: 50, chick_price: 150, completed_unhatched_price: 100, daily_brooding_price: 10,
      }) as Pricing;
    },
  });

  // Per-customer lots (hatchery_batch_lots) — source of truth for brooding period
  const { data: lots = [] } = useQuery({
    queryKey: ["ecr_lots", fromDate, toDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hatchery_batch_lots" as any)
        .select("client_id,chicks_hatched,hatcher_out_at,brooding_in_at,brooding_out_at,brooding_days,cancelled,owner_type")
        .eq("owner_type", "external_client")
        .eq("cancelled", false);
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  // Aggregate brooding info per customer
  const broodingByCustomer = useMemo(() => {
    const dailyPrice = num(pricing?.daily_brooding_price);
    const today = new Date();
    const m = new Map<string, { chicksBrooded: number; daysSum: number; feesActual: number; pendingChicks: number; feesProjected: number }>();
    for (const l of lots) {
      if (!l.client_id) continue;
      const chicks = num(l.chicks_hatched);
      if (chicks <= 0) continue;
      const startISO = l.hatcher_out_at || l.brooding_in_at;
      if (!startISO) continue;
      const start = new Date(startISO);
      const e = m.get(l.client_id) || { chicksBrooded: 0, daysSum: 0, feesActual: 0, pendingChicks: 0, feesProjected: 0 };
      const dayMs = 86400000;
      const startDay = Math.floor(start.getTime() / dayMs);
      if (l.brooding_out_at) {
        const end = new Date(l.brooding_out_at);
        const days = Math.max(1, Math.floor(end.getTime() / dayMs) - startDay + 1);
        e.chicksBrooded += chicks;
        e.daysSum += days;
        e.feesActual += chicks * days * dailyPrice;
      } else {
        const days = Math.max(1, Math.floor(today.getTime() / dayMs) - startDay + 1);
        e.pendingChicks += chicks;
        e.feesProjected += chicks * days * dailyPrice;
      }
      m.set(l.client_id, e);
    }
    return m;
  }, [lots, pricing]);


  // External customer ids only
  const externalIds = useMemo(() => new Set(customers.map((c) => c.id)), [customers]);
  const customerById = useMemo(() => {
    const m = new Map<string, Customer>();
    customers.forEach((c) => m.set(c.id, c));
    return m;
  }, [customers]);

  // Calculate per-batch dues
  const calcBatchDues = (b: Batch, p: Pricing) => {
    const infertileFee = num(b.candle1_infertile) * num(p.infertile_egg_price);
    const candle2Fee = num(b.candle2_dead) * num(p.completed_unhatched_price);
    const chicksFee = num(b.hatched_chicks) * num(p.chick_price);
    const broodingFee = num(b.brooding_days) * num(b.hatched_chicks) * num(p.daily_brooding_price);
    const total = infertileFee + candle2Fee + chicksFee + broodingFee;
    return { infertileFee, candle2Fee, chicksFee, broodingFee, total };
  };

  // External batches only
  const externalBatches = useMemo(
    () => batches.filter((b) => externalIds.has(b.customer_id)),
    [batches, externalIds]
  );

  // Aggregate per customer
  const customerRows = useMemo(() => {
    if (!pricing) return [];
    const map = new Map<string, any>();
    for (const c of customers) {
      if (customerFilter !== "all" && c.id !== customerFilter) continue;
      map.set(c.id, {
        customer: c,
        batches: [] as Batch[],
        batchesCount: 0,
        totalEggs: 0,
        totalInfertile: 0,
        totalFertile: 0,
        totalChicks: 0,
        infertileFee: 0,
        candle2Fee: 0,
        chicksFee: 0,
        broodingFee: 0,
        totalDue: 0,
        totalPaid: 0,
        remaining: 0,
        lastEntry: null as string | null,
        lastPayment: null as string | null,
      });
    }
    for (const b of externalBatches) {
      const row = map.get(b.customer_id);
      if (!row) continue;
      const d = calcBatchDues(b, pricing);
      row.batches.push(b);
      row.batchesCount += 1;
      row.totalEggs += num(b.received_eggs);
      row.totalInfertile += num(b.candle1_infertile);
      row.totalFertile += num(b.candle1_fertile);
      row.totalChicks += num(b.hatched_chicks);
      row.infertileFee += d.infertileFee;
      row.candle2Fee += d.candle2Fee;
      row.chicksFee += d.chicksFee;
      row.broodingFee += d.broodingFee;
      row.totalDue += d.total;
      if (!row.lastEntry || b.entry_date > row.lastEntry) row.lastEntry = b.entry_date;
    }
    // Payments in date range
    for (const p of payments) {
      if (p.payment_date < fromDate || p.payment_date > toDate) continue;
      const row = map.get(p.customer_id);
      if (!row) continue;
      row.totalPaid += num(p.amount);
      if (!row.lastPayment || p.payment_date > row.lastPayment) row.lastPayment = p.payment_date;
    }
    const rows = Array.from(map.values()).map((r) => {
      // Override brooding aggregates from per-customer lot data (real hatch→pickup periods)
      const br = broodingByCustomer.get(r.customer.id);
      if (br) {
        // Replace batch-derived approximation with actual lot data
        r.broodingFee = br.feesActual;
        r.broodingChicks = br.chicksBrooded;
        r.broodingDays = br.daysSum;
        r.pendingChicks = br.pendingChicks;
        r.broodingFeeProjected = br.feesProjected;
        // Recompute totalDue using replaced brooding component
        r.totalDue = r.infertileFee + r.candle2Fee + r.chicksFee + r.broodingFee;
      } else {
        r.broodingChicks = 0; r.broodingDays = 0; r.pendingChicks = 0; r.broodingFeeProjected = 0;
      }
      r.remaining = r.totalDue - r.totalPaid;
      r.hatchRate = r.totalEggs > 0 ? (r.totalChicks / r.totalEggs) * 100 : 0;
      r.statusKey = r.remaining > 0.5 ? "owes" : r.remaining < -0.5 ? "credit" : "paid";
      return r;
    }).filter((r) => r.batchesCount > 0 || r.totalPaid > 0);

    const filtered = statusFilter === "all" ? rows : rows.filter((r) => r.statusKey === statusFilter);

    const sorters: Record<SortKey, (a: any, b: any) => number> = {
      eggs: (a, b) => b.totalEggs - a.totalEggs,
      revenue: (a, b) => b.totalDue - a.totalDue,
      profit: (a, b) => b.totalDue - a.totalDue, // alias (no cost data)
      hatch_rate: (a, b) => b.hatchRate - a.hatchRate,
      remaining: (a, b) => b.remaining - a.remaining,
      name: (a, b) => a.customer.name.localeCompare(b.customer.name, "ar"),
    };
    return filtered.sort(sorters[sortKey]);
  }, [customers, externalBatches, payments, pricing, customerFilter, statusFilter, sortKey, fromDate, toDate]);

  // Top-level KPIs
  const totals = useMemo(() => {
    const t = {
      customersCount: customerRows.length,
      totalEggs: 0, totalChicks: 0, totalDue: 0, totalPaid: 0, remaining: 0,
      topByEggs: null as any, topByRevenue: null as any, topByDebt: null as any,
    };
    for (const r of customerRows) {
      t.totalEggs += r.totalEggs; t.totalChicks += r.totalChicks;
      t.totalDue += r.totalDue; t.totalPaid += r.totalPaid; t.remaining += r.remaining;
    }
    if (customerRows.length) {
      t.topByEggs = [...customerRows].sort((a, b) => b.totalEggs - a.totalEggs)[0];
      t.topByRevenue = [...customerRows].sort((a, b) => b.totalDue - a.totalDue)[0];
      t.topByDebt = [...customerRows].sort((a, b) => b.remaining - a.remaining)[0];
    }
    return t;
  }, [customerRows]);

  // Charts data
  const top10ByEggs = useMemo(() => [...customerRows].sort((a, b) => b.totalEggs - a.totalEggs).slice(0, 10).map(r => ({ name: r.customer.name, value: r.totalEggs })), [customerRows]);
  const top10ByRevenue = useMemo(() => [...customerRows].sort((a, b) => b.totalDue - a.totalDue).slice(0, 10).map(r => ({ name: r.customer.name, value: Math.round(r.totalDue) })), [customerRows]);
  const top10ByDebt = useMemo(() => [...customerRows].sort((a, b) => b.remaining - a.remaining).slice(0, 10).map(r => ({ name: r.customer.name, value: Math.round(r.remaining) })), [customerRows]);

  const monthlyTrend = useMemo(() => {
    const byMonth = new Map<string, { month: string; eggs: number; revenue: number }>();
    for (const b of externalBatches) {
      if (!b.entry_date) continue;
      const m = b.entry_date.slice(0, 7);
      const e = byMonth.get(m) || { month: m, eggs: 0, revenue: 0 };
      e.eggs += num(b.received_eggs);
      if (pricing) e.revenue += calcBatchDues(b, pricing).total;
      byMonth.set(m, e);
    }
    return Array.from(byMonth.values()).sort((a, b) => a.month.localeCompare(b.month));
  }, [externalBatches, pricing]);

  const detailsRow = detailsCustomerId ? customerRows.find(r => r.customer.id === detailsCustomerId) : null;
  const detailsPayments = useMemo(() => {
    if (!detailsCustomerId) return [];
    return payments
      .filter(p => p.customer_id === detailsCustomerId && p.payment_date >= fromDate && p.payment_date <= toDate)
      .sort((a, b) => b.payment_date.localeCompare(a.payment_date));
  }, [payments, detailsCustomerId, fromDate, toDate]);

  // Exports
  const handleExportCsv = () => {
    const rows = customerRows.map((r) => ({
      "اسم العميل": r.customer.name,
      "عدد الدفعات": r.batchesCount,
      "إجمالي البيض": r.totalEggs,
      "اللايح": r.totalInfertile,
      "المخصب": r.totalFertile,
      "الكتاكيت": r.totalChicks,
      "نسبة الفقس %": r.hatchRate.toFixed(1),
      "رسوم اللايح": Math.round(r.infertileFee),
      "رسوم كشف 2": Math.round(r.candle2Fee),
      "رسوم الكتاكيت": Math.round(r.chicksFee),
      "رسوم التحضين": Math.round(r.broodingFee),
      "إجمالي المستحق": Math.round(r.totalDue),
      "إجمالي المدفوع": Math.round(r.totalPaid),
      "المتبقي": Math.round(r.remaining),
      "آخر دخول": r.lastEntry || "—",
      "آخر دفعة": r.lastPayment || "—",
      "الحالة": r.statusKey === "paid" ? "مسدد" : r.statusKey === "owes" ? "عليه متبقي" : "له رصيد",
    }));
    exportCSV(`external_customers_${fromDate}_${toDate}.csv`, rows);
    toast.success("تم التصدير");
  };

  const handlePrint = () => {
    const tableRows = customerRows.map((r) => `
      <tr>
        <td>${escapeHtml(r.customer.name)}</td>
        <td>${r.batchesCount}</td>
        <td>${fmt(r.totalEggs)}</td>
        <td>${fmt(r.totalInfertile)}</td>
        <td>${fmt(r.totalChicks)}</td>
        <td>${r.hatchRate.toFixed(1)}%</td>
        <td>${fmt(Math.round(r.totalDue))}</td>
        <td>${fmt(Math.round(r.totalPaid))}</td>
        <td>${fmt(Math.round(r.remaining))}</td>
        <td>${r.statusKey === "paid" ? "مسدد" : r.statusKey === "owes" ? "عليه متبقي" : "له رصيد"}</td>
      </tr>`).join("");
    const body = `
      <h1>كشف عملاء التفريخ الخارجيين</h1>
      <p>الفترة: من ${fromDate} إلى ${toDate}</p>
      <table>
        <thead><tr>
          <th>العميل</th><th>عدد الدفعات</th><th>إجمالي البيض</th><th>اللايح</th>
          <th>الكتاكيت</th><th>نسبة الفقس</th><th>المستحق</th><th>المدفوع</th><th>المتبقي</th><th>الحالة</th>
        </tr></thead>
        <tbody>${tableRows}</tbody>
        <tfoot><tr>
          <td colspan="2"><b>الإجمالي</b></td>
          <td><b>${fmt(totals.totalEggs)}</b></td>
          <td></td>
          <td><b>${fmt(totals.totalChicks)}</b></td>
          <td></td>
          <td><b>${fmt(Math.round(totals.totalDue))}</b></td>
          <td><b>${fmt(Math.round(totals.totalPaid))}</b></td>
          <td><b>${fmt(Math.round(totals.remaining))}</b></td>
          <td></td>
        </tr></tfoot>
      </table>
      <div style="margin-top:48px;display:flex;justify-content:space-between;">
        <div>توقيع مسؤول المعمل: ____________</div>
        <div>توقيع المحاسبة: ____________</div>
        <div>توقيع الإدارة: ____________</div>
      </div>`;
    openPrintWindow("كشف عملاء التفريخ الخارجيين", body);
  };

  return (
    <div className="space-y-4" dir="rtl">
      {/* Filters */}
      <Card>
        <CardContent className="p-4 grid grid-cols-2 md:grid-cols-6 gap-3">
          <div>
            <Label className="text-xs">من تاريخ</Label>
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">إلى تاريخ</Label>
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">العميل</Label>
            <Select value={customerFilter} onValueChange={setCustomerFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل العملاء</SelectItem>
                {customers.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">حالة الحساب</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                <SelectItem value="paid">مسدد</SelectItem>
                <SelectItem value="owes">عليه متبقي</SelectItem>
                <SelectItem value="credit">له رصيد</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">ترتيب حسب</Label>
            <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="eggs">أكثر بيض وارد</SelectItem>
                <SelectItem value="revenue">أعلى إيراد</SelectItem>
                <SelectItem value="hatch_rate">أعلى نسبة فقس</SelectItem>
                <SelectItem value="remaining">أعلى متبقي/مديونية</SelectItem>
                <SelectItem value="name">الاسم</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end gap-2">
            <Button variant="outline" size="sm" onClick={handleExportCsv}><FileSpreadsheet className="w-4 h-4 ml-1" />Excel</Button>
            <Button variant="outline" size="sm" onClick={handlePrint}><Printer className="w-4 h-4 ml-1" />طباعة/PDF</Button>
          </div>
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KPI icon={Users} label="عدد العملاء الخارجيين" value={totals.customersCount} color="from-cyan-500 to-cyan-700" />
        <KPI icon={Egg} label="إجمالي البيض الخارجي" value={fmt(totals.totalEggs)} color="from-amber-500 to-amber-700" />
        <KPI icon={Bird} label="إجمالي الكتاكيت" value={fmt(totals.totalChicks)} color="from-orange-500 to-orange-700" />
        <KPI icon={TrendingUp} label="إجمالي إيراد التفريخ الخارجي" value={fmtMoney(totals.totalDue)} color="from-purple-500 to-purple-700" />
        <KPI icon={Wallet} label="إجمالي المدفوع" value={fmtMoney(totals.totalPaid)} color="from-green-500 to-green-700" />
        <KPI icon={AlertTriangle} label="إجمالي المتبقي" value={fmtMoney(totals.remaining)} color="from-red-500 to-red-700" />
      </div>

      {/* Highlight cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <HighlightCard icon={Trophy} title="أكثر عميل ورّد بيض" name={totals.topByEggs?.customer.name} value={totals.topByEggs ? `${fmt(totals.topByEggs.totalEggs)} بيضة` : "—"} />
        <HighlightCard icon={TrendingUp} title="أكثر عميل حقق إيراد" name={totals.topByRevenue?.customer.name} value={totals.topByRevenue ? fmtMoney(totals.topByRevenue.totalDue) : "—"} />
        <HighlightCard icon={AlertTriangle} title="أعلى عميل عليه مديونية" name={totals.topByDebt?.customer.name} value={totals.topByDebt ? fmtMoney(totals.topByDebt.remaining) : "—"} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Top 10 عملاء — البيض الوارد">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={top10ByEggs}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" hide /><YAxis /><Tooltip /><Bar dataKey="value" fill="hsl(var(--primary))" /></BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Top 10 عملاء — الإيراد">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={top10ByRevenue}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" hide /><YAxis /><Tooltip /><Bar dataKey="value" fill="#9333ea" /></BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Top 10 عملاء — المتبقي عليهم">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={top10ByDebt}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" hide /><YAxis /><Tooltip /><Bar dataKey="value" fill="#ef4444" /></BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="تطور البيض والإيراد شهريًا">
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={monthlyTrend}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" /><YAxis /><Tooltip /><Legend />
              <Line type="monotone" dataKey="eggs" name="البيض" stroke="#f59e0b" />
              <Line type="monotone" dataKey="revenue" name="الإيراد" stroke="#9333ea" />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Table */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">جدول العملاء الخارجيين</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">العميل</TableHead>
                <TableHead>دفعات</TableHead>
                <TableHead>البيض</TableHead>
                <TableHead>لايح</TableHead>
                <TableHead>مخصب</TableHead>
                <TableHead>كتاكيت</TableHead>
                <TableHead>نسبة فقس</TableHead>
                <TableHead>المستحق</TableHead>
                <TableHead>المدفوع</TableHead>
                <TableHead>المتبقي</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>تفاصيل</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customerRows.length === 0 ? (
                <TableRow><TableCell colSpan={12} className="text-center py-8 text-muted-foreground">لا توجد بيانات في الفترة المختارة</TableCell></TableRow>
              ) : customerRows.map((r) => (
                <TableRow key={r.customer.id}>
                  <TableCell className="font-medium">{r.customer.name}</TableCell>
                  <TableCell>{r.batchesCount}</TableCell>
                  <TableCell>{fmt(r.totalEggs)}</TableCell>
                  <TableCell>{fmt(r.totalInfertile)}</TableCell>
                  <TableCell>{fmt(r.totalFertile)}</TableCell>
                  <TableCell>{fmt(r.totalChicks)}</TableCell>
                  <TableCell>{r.hatchRate.toFixed(1)}%</TableCell>
                  <TableCell className="font-bold text-primary">{fmt(Math.round(r.totalDue))}</TableCell>
                  <TableCell className="text-green-600">{fmt(Math.round(r.totalPaid))}</TableCell>
                  <TableCell className={r.remaining > 0 ? "text-red-600 font-bold" : r.remaining < 0 ? "text-blue-600" : ""}>{fmt(Math.round(r.remaining))}</TableCell>
                  <TableCell>
                    <Badge variant={r.statusKey === "paid" ? "default" : r.statusKey === "owes" ? "destructive" : "secondary"}>
                      {r.statusKey === "paid" ? "مسدد" : r.statusKey === "owes" ? "عليه متبقي" : "له رصيد"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" onClick={() => setDetailsCustomerId(r.customer.id)}>
                      <Eye className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground text-center">
        * "إجمالي المستحق" يمثل إيراد العميل (رسوم اللايح + كشف 2 + الكتاكيت + التحضين). لا يتم خصم تكلفة تشغيل المعمل لذلك يُعرض كإيراد وليس صافي ربح.
      </p>

      {/* Details Dialog */}
      <Dialog open={!!detailsCustomerId} onOpenChange={(o) => !o && setDetailsCustomerId(null)}>
        <DialogContent dir="rtl" className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>تفاصيل العميل: {detailsRow?.customer.name}</DialogTitle>
          </DialogHeader>
          {detailsRow && pricing && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                <Box label="عدد الدفعات" value={detailsRow.batchesCount} />
                <Box label="إجمالي البيض" value={fmt(detailsRow.totalEggs)} />
                <Box label="الكتاكيت" value={fmt(detailsRow.totalChicks)} />
                <Box label="نسبة الفقس" value={`${detailsRow.hatchRate.toFixed(1)}%`} />
                <Box label="المستحق" value={fmtMoney(detailsRow.totalDue)} />
                <Box label="المدفوع" value={fmtMoney(detailsRow.totalPaid)} />
                <Box label="المتبقي" value={fmtMoney(detailsRow.remaining)} />
                <Box label="آخر دفعة" value={detailsRow.lastPayment || "—"} />
              </div>

              <div>
                <h3 className="font-semibold mb-2">الدفعات</h3>
                <div className="overflow-x-auto rounded border">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>التاريخ</TableHead><TableHead>رقم الدفعة</TableHead>
                      <TableHead>الماكينة</TableHead><TableHead>البيض</TableHead>
                      <TableHead>لايح</TableHead><TableHead>مخصب</TableHead>
                      <TableHead>كتاكيت</TableHead><TableHead>رسوم الدفعة</TableHead>
                      <TableHead>الحالة</TableHead><TableHead>ملاحظات</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {detailsRow.batches.sort((a: Batch, b: Batch) => (b.entry_date || "").localeCompare(a.entry_date || "")).map((b: Batch) => {
                        const d = calcBatchDues(b, pricing);
                        return (
                          <TableRow key={b.id}>
                            <TableCell>{b.entry_date}</TableCell>
                            <TableCell>{b.operational_batch_no || b.batch_number}</TableCell>
                            <TableCell>{b.machine}</TableCell>
                            <TableCell>{fmt(b.received_eggs)}</TableCell>
                            <TableCell>{fmt(b.candle1_infertile)}</TableCell>
                            <TableCell>{fmt(b.candle1_fertile)}</TableCell>
                            <TableCell>{fmt(b.hatched_chicks)}</TableCell>
                            <TableCell className="text-primary font-bold">{fmt(Math.round(d.total))}</TableCell>
                            <TableCell>{b.status}</TableCell>
                            <TableCell className="text-xs text-muted-foreground max-w-xs truncate">{b.notes || "—"}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>

              <div>
                <h3 className="font-semibold mb-2">المدفوعات في الفترة</h3>
                <div className="overflow-x-auto rounded border">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>التاريخ</TableHead><TableHead>المبلغ</TableHead><TableHead>ملاحظات</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {detailsPayments.length === 0 ? (
                        <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-4">لا توجد مدفوعات</TableCell></TableRow>
                      ) : detailsPayments.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell>{p.payment_date}</TableCell>
                          <TableCell className="font-bold text-green-600">{fmtMoney(p.amount)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{p.notes || "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

const KPI = ({ icon: Icon, label, value, color }: any) => (
  <Card className="relative overflow-hidden border-0 shadow-md">
    <div className={`absolute inset-0 bg-gradient-to-br ${color} opacity-95`} />
    <div className="relative p-4 text-white">
      <div className="flex items-center gap-2 mb-2"><Icon className="w-4 h-4" /><span className="text-xs opacity-90">{label}</span></div>
      <p className="text-xl font-bold">{value}</p>
    </div>
  </Card>
);

const HighlightCard = ({ icon: Icon, title, name, value }: any) => (
  <Card className="border-2 border-primary/20">
    <CardContent className="p-4 flex items-center gap-3">
      <div className="p-3 rounded-full bg-primary/10"><Icon className="w-5 h-5 text-primary" /></div>
      <div className="flex-1">
        <p className="text-xs text-muted-foreground">{title}</p>
        <p className="font-bold">{name || "—"}</p>
        <p className="text-sm text-primary">{value}</p>
      </div>
    </CardContent>
  </Card>
);

const ChartCard = ({ title, children }: any) => (
  <Card><CardHeader className="pb-2"><CardTitle className="text-sm">{title}</CardTitle></CardHeader><CardContent>{children}</CardContent></Card>
);

const Box = ({ label, value }: any) => (
  <div className="p-2 rounded border bg-muted/30">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="font-bold">{value}</p>
  </div>
);

function escapeHtml(s: string) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
