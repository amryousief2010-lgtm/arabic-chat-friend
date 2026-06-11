import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Egg, TrendingUp, Wallet, AlertTriangle, FileSpreadsheet, Printer, Users, Receipt, Clock, CheckCircle2 } from "lucide-react";
import { openPrintWindow, escapeHtml, fmtNum } from "@/lib/printPdf";
import * as XLSX from "xlsx";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid, LineChart, Line,
} from "recharts";

interface Invoice {
  id: string;
  client_id: string | null;
  client_name_snapshot: string | null;
  eggs_in: number;
  chicks_count: number;
  brooding_chicks_count: number;
  brooding_amount: number;
  chicks_amount: number;
  infertile_amount: number;
  completed_unhatched_amount: number;
  total_amount: number;
  paid_amount: number;
  remaining_amount: number;
  payment_status: string;
  issued_at: string;
}
interface Payment {
  id: string;
  invoice_id: string;
  amount: number;
  method: string | null;
  paid_at: string;
}
interface LabMv {
  id: string;
  amount: number;
  status: string;
  movement_date: string;
  income_category: string | null;
  expense_category: string | null;
  movement_type: string;
  source_table: string | null;
  customer_name: string | null;
  payment_method: string | null;
}

const monthKey = (d: string) => {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
};
const monthLabel = (k: string) => {
  const [y, m] = k.split("-");
  return `${["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"][Number(m)-1]} ${y}`;
};

export default function LabHatcheryClientsRevenue() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [movements, setMovements] = useState<LabMv[]>([]);
  const [loading, setLoading] = useState(true);

  // filters
  const now = new Date();
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState<string>("all"); // all | 1..12
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [clientFilter, setClientFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [methodFilter, setMethodFilter] = useState<string>("all");

  useEffect(() => { load(); }, []);
  async function load() {
    setLoading(true);
    try {
      const [inv, pay, mv] = await Promise.all([
        supabase.from("hatchery_client_invoices").select("id,client_id,client_name_snapshot,eggs_in,chicks_count,brooding_chicks_count,brooding_amount,chicks_amount,infertile_amount,completed_unhatched_amount,total_amount,paid_amount,remaining_amount,payment_status,issued_at").order("issued_at", { ascending: false }).limit(5000),
        supabase.from("hatchery_invoice_payments").select("id,invoice_id,amount,method,paid_at").order("paid_at", { ascending: false }).limit(10000),
        supabase.from("lab_treasury_movements").select("id,amount,status,movement_date,income_category,expense_category,movement_type,source_table,customer_name,payment_method").or("source_table.eq.hatchery_invoice_payments,income_category.eq.hatching,expense_category.neq.electricity").limit(10000),
      ]);
      setInvoices((inv.data as any) || []);
      setPayments((pay.data as any) || []);
      setMovements((mv.data as any) || []);
    } finally { setLoading(false); }
  }

  const invById = useMemo(() => Object.fromEntries(invoices.map(i => [i.id, i])), [invoices]);

  const filteredInvoices = useMemo(() => invoices.filter(i => {
    const d = new Date(i.issued_at);
    if (year !== "all" && String(d.getFullYear()) !== year) return false;
    if (month !== "all" && String(d.getMonth() + 1) !== month) return false;
    if (from && i.issued_at < from) return false;
    if (to && i.issued_at > to + "T23:59:59") return false;
    if (clientFilter !== "all" && (i.client_name_snapshot || "") !== clientFilter) return false;
    if (statusFilter !== "all" && i.payment_status !== statusFilter) return false;
    return true;
  }), [invoices, year, month, from, to, clientFilter, statusFilter]);

  const filteredPayments = useMemo(() => payments.filter(p => {
    const inv = invById[p.invoice_id];
    if (!inv) return false;
    const d = new Date(p.paid_at);
    if (year !== "all" && String(d.getFullYear()) !== year) return false;
    if (month !== "all" && String(d.getMonth() + 1) !== month) return false;
    if (from && p.paid_at < from) return false;
    if (to && p.paid_at > to + "T23:59:59") return false;
    if (clientFilter !== "all" && (inv.client_name_snapshot || "") !== clientFilter) return false;
    if (methodFilter !== "all" && (p.method || "") !== methodFilter) return false;
    return true;
  }), [payments, invById, year, month, from, to, clientFilter, methodFilter]);

  // Pending lab treasury approval (collections waiting)
  const pendingLabCollections = useMemo(() => movements.filter(m =>
    m.movement_type === "income" &&
    (m.source_table === "hatchery_invoice_payments" || m.income_category === "hatching") &&
    m.status === "pending"
  ), [movements]);
  const pendingLabAmount = pendingLabCollections.reduce((s, m) => s + Number(m.amount || 0), 0);

  const approvedLabCollections = useMemo(() => movements.filter(m =>
    m.movement_type === "income" &&
    (m.source_table === "hatchery_invoice_payments" || m.income_category === "hatching") &&
    m.status === "approved"
  ), [movements]);

  // current month metrics
  const cm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthInv = invoices.filter(i => monthKey(i.issued_at) === cm);
  const monthPay = payments.filter(p => monthKey(p.paid_at) === cm);
  const monthDue = monthInv.reduce((s, i) => s + Number(i.total_amount || 0), 0);
  const monthCollectedPayments = monthPay.reduce((s, p) => s + Number(p.amount || 0), 0);
  // Approved at lab treasury this month (official confirmed collected — pending excluded)
  const monthCollectedApproved = approvedLabCollections
    .filter(m => monthKey(m.movement_date) === cm)
    .reduce((s, m) => s + Number(m.amount || 0), 0);
  const monthPendingApproval = pendingLabCollections
    .filter(m => monthKey(m.movement_date) === cm)
    .reduce((s, m) => s + Number(m.amount || 0), 0);
  const monthRemaining = invoices.reduce((s, i) => s + Number(i.remaining_amount || 0), 0);
  const monthClients = new Set(monthInv.map(i => i.client_name_snapshot || "—")).size;
  // alias kept for chart/PDF compatibility
  const monthCollected = monthCollectedPayments;

  // top client current month
  const topClientMap: Record<string, number> = {};
  monthInv.forEach(i => {
    const k = i.client_name_snapshot || "—";
    topClientMap[k] = (topClientMap[k] || 0) + Number(i.total_amount || 0);
  });
  const topClient = Object.entries(topClientMap).sort((a, b) => b[1] - a[1])[0];

  // Approximate net (current month) — approved collections minus approved lab expenses
  const monthExpensesApproved = movements.filter(m =>
    m.movement_type === "expense" && m.status === "approved" && monthKey(m.movement_date) === cm
  ).reduce((s, m) => s + Number(m.amount || 0), 0);
  const approxNet = monthCollectedApproved - monthExpensesApproved;

  // last 12 months chart
  const months12 = useMemo(() => {
    const arr: string[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      arr.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    return arr;
  }, []);
  const chartData = months12.map(k => {
    const inv = invoices.filter(i => monthKey(i.issued_at) === k);
    const pay = payments.filter(p => monthKey(p.paid_at) === k);
    const due = inv.reduce((s, i) => s + Number(i.total_amount || 0), 0);
    const col = pay.reduce((s, p) => s + Number(p.amount || 0), 0);
    return { month: monthLabel(k), key: k, due, collected: col, remaining: due - col };
  });
  const topMonth = [...chartData].sort((a, b) => b.collected - a.collected)[0];

  // monthly details table (uses filtered)
  const monthlyTable = useMemo(() => {
    const map: Record<string, any> = {};
    filteredInvoices.forEach(i => {
      const k = monthKey(i.issued_at);
      if (!map[k]) map[k] = { month: k, clients: new Set(), invoices: 0, due: 0, collected: 0, remaining: 0, lais: 0, candle2: 0, chicks: 0, brooding: 0 };
      map[k].clients.add(i.client_name_snapshot || "—");
      map[k].invoices += 1;
      map[k].due += Number(i.total_amount || 0);
      map[k].lais += Number(i.infertile_amount || 0);
      map[k].candle2 += Number(i.completed_unhatched_amount || 0);
      map[k].chicks += Number(i.chicks_amount || 0);
      map[k].brooding += Number(i.brooding_amount || 0);
    });
    filteredPayments.forEach(p => {
      const k = monthKey(p.paid_at);
      if (!map[k]) map[k] = { month: k, clients: new Set(), invoices: 0, due: 0, collected: 0, remaining: 0, lais: 0, candle2: 0, chicks: 0, brooding: 0 };
      map[k].collected += Number(p.amount || 0);
    });
    return Object.values(map).map((r: any) => ({ ...r, clientsCount: r.clients.size, remaining: r.due - r.collected })).sort((a: any, b: any) => b.month.localeCompare(a.month));
  }, [filteredInvoices, filteredPayments]);

  // top clients table
  const topClientsTable = useMemo(() => {
    const map: Record<string, any> = {};
    filteredInvoices.forEach(i => {
      const k = i.client_name_snapshot || "—";
      if (!map[k]) map[k] = { client: k, batches: 0, eggs: 0, chicks: 0, due: 0, paid: 0, remaining: 0, brooding: 0 };
      map[k].batches += 1;
      map[k].eggs += Number(i.eggs_in || 0);
      map[k].chicks += Number(i.chicks_count || 0);
      map[k].due += Number(i.total_amount || 0);
      map[k].paid += Number(i.paid_amount || 0);
      map[k].remaining += Number(i.remaining_amount || 0);
      map[k].brooding += Number(i.brooding_amount || 0);
    });
    return Object.values(map).sort((a: any, b: any) => b.due - a.due);
  }, [filteredInvoices]);

  const clientsList = useMemo(() => Array.from(new Set(invoices.map(i => i.client_name_snapshot || "—"))).sort(), [invoices]);

  function exportExcel() {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(monthlyTable.map((r: any) => ({
      "الشهر": monthLabel(r.month), "عدد العملاء": r.clientsCount, "عدد الفواتير": r.invoices,
      "إجمالي المستحق": r.due, "إجمالي المحصل": r.collected, "المتبقي": r.remaining,
      "رسوم اللايح": r.lais, "رسوم الكشف الثاني": r.candle2, "رسوم الكتاكيت": r.chicks, "رسوم التحضين": r.brooding,
    }))), "تفاصيل الشهر");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(topClientsTable.map((r: any) => ({
      "اسم العميل": r.client, "عدد الدفعات": r.batches, "إجمالي البيض": r.eggs, "إجمالي الكتاكيت": r.chicks,
      "إجمالي المستحق": r.due, "إجمالي المدفوع": r.paid, "المتبقي": r.remaining, "رسوم التحضين": r.brooding,
    }))), "أعلى العملاء");
    XLSX.writeFile(wb, `إيراد_تفريخ_العملاء_${cm}.xlsx`);
  }

  function exportPDF() {
    const html = `
      <h2 style="text-align:center">تقرير إيراد تفريخ العملاء الخارجيين</h2>
      <p style="text-align:center;color:#666">الفترة: ${escapeHtml(year)}${month !== "all" ? "/" + month : ""}</p>
      <h3>ملخص الشهر الحالي</h3>
      <ul>
        <li>إجمالي فواتير الشهر: <b>${fmtNum(monthDue, 2)}</b> ج.م</li>
        <li>المحصل فعلياً: <b>${fmtNum(monthCollected, 2)}</b> ج.م</li>
        <li>المحصل بانتظار الاعتماد: <b>${fmtNum(pendingLabAmount, 2)}</b> ج.م</li>
        <li>المتبقي على العملاء: <b>${fmtNum(monthRemaining, 2)}</b> ج.م</li>
        <li>عدد العملاء: <b>${monthClients}</b></li>
      </ul>
      <h3>تفاصيل الشهور</h3>
      <table border="1" cellspacing="0" cellpadding="6" style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr><th>الشهر</th><th>عملاء</th><th>فواتير</th><th>مستحق</th><th>محصل</th><th>متبقي</th><th>لايح</th><th>كشف 2</th><th>كتاكيت</th><th>تحضين</th></tr></thead>
        <tbody>${monthlyTable.map((r: any) => `<tr><td>${escapeHtml(monthLabel(r.month))}</td><td>${r.clientsCount}</td><td>${r.invoices}</td><td>${fmtNum(r.due,0)}</td><td>${fmtNum(r.collected,0)}</td><td>${fmtNum(r.remaining,0)}</td><td>${fmtNum(r.lais,0)}</td><td>${fmtNum(r.candle2,0)}</td><td>${fmtNum(r.chicks,0)}</td><td>${fmtNum(r.brooding,0)}</td></tr>`).join("")}</tbody>
      </table>
      <h3 style="margin-top:18px">أعلى العملاء إيرادًا</h3>
      <table border="1" cellspacing="0" cellpadding="6" style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr><th>العميل</th><th>دفعات</th><th>بيض</th><th>كتاكيت</th><th>مستحق</th><th>مدفوع</th><th>متبقي</th><th>تحضين</th></tr></thead>
        <tbody>${topClientsTable.map((r: any) => `<tr><td>${escapeHtml(r.client)}</td><td>${r.batches}</td><td>${fmtNum(r.eggs,0)}</td><td>${fmtNum(r.chicks,0)}</td><td>${fmtNum(r.due,0)}</td><td>${fmtNum(r.paid,0)}</td><td>${fmtNum(r.remaining,0)}</td><td>${fmtNum(r.brooding,0)}</td></tr>`).join("")}</tbody>
      </table>
      <p style="margin-top:20px;color:#666;font-size:11px">هذا التقرير قراءة وتحليل فقط ولا يؤثر على أرصدة الخزنة.</p>
    `;
    openPrintWindow("إيراد تفريخ العملاء الشهري", html);
  }

  if (loading) return <Card><CardContent className="p-6 text-center text-muted-foreground">جاري التحميل...</CardContent></Card>;

  return (
    <div className="space-y-4">
      <Alert className="border-primary/30 bg-primary/5">
        <Egg className="w-4 h-4 text-primary" />
        <AlertTitle className="text-sm">إيراد تفريخ العملاء الخارجيين</AlertTitle>
        <AlertDescription className="text-xs">
          هذا الرقم يوضح إيراد تفريخ العملاء الخارجيين. لا يُعد صافي ربح نهائي إلا إذا تم خصم مصروفات تشغيل المعمل من نفس الفترة. هذا التحليل قراءة فقط ولا يؤثر على أرصدة الخزنة.
        </AlertDescription>
      </Alert>

      {/* main KPI cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="border-primary/30">
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Receipt className="w-4 h-4 text-primary" /> فواتير الشهر</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold tabular-nums">{fmtNum(monthDue, 2)}</div><div className="text-xs text-muted-foreground">{monthInv.length} فاتورة</div></CardContent>
        </Card>
        <Card className="border-[hsl(var(--success))]/30">
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-[hsl(var(--success))]" /> المحصل فعلياً</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold tabular-nums text-[hsl(var(--success))]">{fmtNum(monthCollected, 2)}</div><div className="text-xs text-muted-foreground">{monthPay.length} دفعة</div></CardContent>
        </Card>
        <Card className="border-amber-400/40">
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Clock className="w-4 h-4 text-amber-600" /> بانتظار اعتماد الخزنة</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold tabular-nums text-amber-600">{fmtNum(pendingLabAmount, 2)}</div><div className="text-xs text-muted-foreground">{pendingLabCollections.length} حركة</div></CardContent>
        </Card>
        <Card className="border-destructive/30">
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-destructive" /> المتبقي على العملاء</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold tabular-nums text-destructive">{fmtNum(monthRemaining, 2)}</div><div className="text-xs text-muted-foreground">{monthClients} عميل هذا الشهر</div></CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Users className="w-4 h-4 text-primary" /> أعلى عميل هذا الشهر</CardTitle></CardHeader>
          <CardContent>
            <div className="text-lg font-bold">{topClient?.[0] || "—"}</div>
            <div className="text-sm text-muted-foreground tabular-nums">{fmtNum(topClient?.[1] || 0, 2)} ج.م</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="w-4 h-4 text-primary" /> أعلى شهر (آخر 12 شهر)</CardTitle></CardHeader>
          <CardContent>
            <div className="text-lg font-bold">{topMonth?.month || "—"}</div>
            <div className="text-sm text-muted-foreground tabular-nums">محصل: {fmtNum(topMonth?.collected || 0, 2)} ج.م</div>
          </CardContent>
        </Card>
        <Card className="border-[hsl(var(--success))]/30">
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Wallet className="w-4 h-4 text-[hsl(var(--success))]" /> صافي تفريخ العملاء التقريبي</CardTitle></CardHeader>
          <CardContent>
            <div className="text-xl font-bold tabular-nums">{fmtNum(approxNet, 2)}</div>
            <div className="text-[11px] text-muted-foreground">= محصل ({fmtNum(monthCollected,0)}) − مصروفات معتمدة ({fmtNum(monthExpensesApproved,0)}). قيمة تقريبية وليست صافي ربح محاسبي.</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters + export */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base">الفلاتر والتصدير</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={exportExcel}><FileSpreadsheet className="w-4 h-4 ml-1" /> Excel</Button>
            <Button size="sm" variant="outline" onClick={exportPDF}><Printer className="w-4 h-4 ml-1" /> PDF / طباعة</Button>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2 text-xs">
          <div><Label>السنة</Label><Select value={year} onValueChange={setYear}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">الكل</SelectItem>{[2024,2025,2026,2027].map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent></Select></div>
          <div><Label>الشهر</Label><Select value={month} onValueChange={setMonth}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">الكل</SelectItem>{Array.from({length:12}).map((_,i) => <SelectItem key={i+1} value={String(i+1)}>{i+1}</SelectItem>)}</SelectContent></Select></div>
          <div><Label>من</Label><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
          <div><Label>إلى</Label><Input type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
          <div><Label>العميل</Label><Select value={clientFilter} onValueChange={setClientFilter}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">الكل</SelectItem>{clientsList.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></div>
          <div><Label>حالة الفاتورة</Label><Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">الكل</SelectItem><SelectItem value="unpaid">غير مدفوعة</SelectItem><SelectItem value="partial">دفع جزئي</SelectItem><SelectItem value="paid">مدفوعة</SelectItem></SelectContent></Select></div>
          <div><Label>طريقة الدفع</Label><Select value={methodFilter} onValueChange={setMethodFilter}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">الكل</SelectItem><SelectItem value="cash">نقدي</SelectItem><SelectItem value="vodafone_cash">فودافون كاش</SelectItem><SelectItem value="instapay">إنستا باي</SelectItem><SelectItem value="bank_transfer">تحويل بنكي</SelectItem></SelectContent></Select></div>
        </CardContent>
      </Card>

      {/* monthly chart */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">إيراد تفريخ العملاء شهرياً (آخر 12 شهر)</CardTitle></CardHeader>
        <CardContent style={{ height: 320 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis />
              <Tooltip formatter={(v: any) => fmtNum(Number(v), 0)} />
              <Legend />
              <Bar dataKey="due" name="إجمالي المستحق" fill="hsl(var(--primary))" />
              <Bar dataKey="collected" name="إجمالي المحصل" fill="hsl(var(--success))" />
              <Bar dataKey="remaining" name="المتبقي" fill="hsl(var(--destructive))" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* monthly details */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">تفاصيل إيراد تفريخ العملاء حسب الشهر</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>الشهر</TableHead><TableHead>عدد العملاء</TableHead><TableHead>عدد الفواتير</TableHead>
              <TableHead className="text-end">المستحق</TableHead><TableHead className="text-end">المحصل</TableHead><TableHead className="text-end">المتبقي</TableHead>
              <TableHead className="text-end">اللايح</TableHead><TableHead className="text-end">الكشف 2</TableHead><TableHead className="text-end">الكتاكيت</TableHead><TableHead className="text-end">التحضين</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {monthlyTable.length === 0 ? <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-6">لا توجد بيانات</TableCell></TableRow> :
              monthlyTable.map((r: any) => (
                <TableRow key={r.month}>
                  <TableCell className="font-medium">{monthLabel(r.month)}</TableCell>
                  <TableCell>{r.clientsCount}</TableCell><TableCell>{r.invoices}</TableCell>
                  <TableCell className="text-end tabular-nums">{fmtNum(r.due, 2)}</TableCell>
                  <TableCell className="text-end tabular-nums text-[hsl(var(--success))]">{fmtNum(r.collected, 2)}</TableCell>
                  <TableCell className="text-end tabular-nums text-destructive">{fmtNum(r.remaining, 2)}</TableCell>
                  <TableCell className="text-end tabular-nums">{fmtNum(r.lais, 0)}</TableCell>
                  <TableCell className="text-end tabular-nums">{fmtNum(r.candle2, 0)}</TableCell>
                  <TableCell className="text-end tabular-nums">{fmtNum(r.chicks, 0)}</TableCell>
                  <TableCell className="text-end tabular-nums">{fmtNum(r.brooding, 0)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* top clients */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">أعلى عملاء التفريخ إيرادًا</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>العميل</TableHead><TableHead>الدفعات</TableHead><TableHead className="text-end">البيض</TableHead><TableHead className="text-end">الكتاكيت</TableHead>
              <TableHead className="text-end">المستحق</TableHead><TableHead className="text-end">المدفوع</TableHead><TableHead className="text-end">المتبقي</TableHead><TableHead className="text-end">التحضين</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {topClientsTable.length === 0 ? <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">لا توجد بيانات</TableCell></TableRow> :
              topClientsTable.map((r: any) => (
                <TableRow key={r.client}>
                  <TableCell className="font-medium">{r.client}</TableCell>
                  <TableCell>{r.batches}</TableCell>
                  <TableCell className="text-end tabular-nums">{fmtNum(r.eggs, 0)}</TableCell>
                  <TableCell className="text-end tabular-nums">{fmtNum(r.chicks, 0)}</TableCell>
                  <TableCell className="text-end tabular-nums">{fmtNum(r.due, 2)}</TableCell>
                  <TableCell className="text-end tabular-nums text-[hsl(var(--success))]">{fmtNum(r.paid, 2)}</TableCell>
                  <TableCell className="text-end tabular-nums text-destructive">{fmtNum(r.remaining, 2)}</TableCell>
                  <TableCell className="text-end tabular-nums">{fmtNum(r.brooding, 0)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
