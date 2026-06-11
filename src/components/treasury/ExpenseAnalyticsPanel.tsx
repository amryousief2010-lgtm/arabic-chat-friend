import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip as RTooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, LineChart, Line,
} from "recharts";
import { Printer, FileDown, Wallet, AlertCircle, TrendingUp, TrendingDown } from "lucide-react";
import { openPrintWindow, escapeHtml, fmtNum, fmtDate } from "@/lib/printPdf";
import { exportCSV } from "@/lib/csvExport";

export type AnalyticsRow = {
  id: string;
  date: string;            // ISO date (YYYY-MM-DD or full ISO)
  category: string;        // Arabic label
  categoryCode?: string;
  amount: number;
  type: "expense" | "income";
  status: string;          // approved | pending | rejected | posted | ...
  paymentMethod?: string;
  createdByName?: string;
};

type Props = {
  title: string;            // e.g. "تحليل مصروفات خزنة العهدة"
  treasuryName: string;     // e.g. "خزنة العهدة"
  rows: AnalyticsRow[];
  /** which status values count as final/approved for KPIs */
  approvedStatuses?: string[];
  /** which status values count as pending */
  pendingStatuses?: string[];
};

const COLORS = [
  "#6b46c1", "#ed8936", "#3182ce", "#38a169", "#d53f8c",
  "#dd6b20", "#2c7a7b", "#805ad5", "#e53e3e", "#319795",
  "#b7791f", "#4c51bf",
];

const fmt = (n: number) => fmtNum(n, 2);
const todayISO = () => new Date().toISOString().slice(0, 10);
const addDays = (d: string, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x.toISOString().slice(0, 10);
};
const startOfMonth = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};
const startOfYear = () => {
  const d = new Date();
  return new Date(d.getFullYear(), 0, 1).toISOString().slice(0, 10);
};
const startOfWeek = () => {
  const d = new Date();
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d.toISOString().slice(0, 10);
};

type Preset = "all" | "today" | "week" | "month" | "year" | "custom";

export default function ExpenseAnalyticsPanel({
  title,
  treasuryName,
  rows,
  approvedStatuses = ["approved", "posted"],
  pendingStatuses = ["pending", "pending_approval", "pending_review", "over_limit_pending", "draft"],
}: Props) {
  const [preset, setPreset] = useState<Preset>("month");
  const [from, setFrom] = useState<string>(startOfMonth());
  const [to, setTo] = useState<string>(todayISO());
  const [statusFilter, setStatusFilter] = useState<"approved" | "all" | "pending">("approved");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [paymentFilter, setPaymentFilter] = useState<string>("all");
  const [userFilter, setUserFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<"expense" | "all" | "income">("expense");

  function applyPreset(p: Preset) {
    setPreset(p);
    const today = todayISO();
    if (p === "today") { setFrom(today); setTo(today); }
    else if (p === "week") { setFrom(startOfWeek()); setTo(today); }
    else if (p === "month") { setFrom(startOfMonth()); setTo(today); }
    else if (p === "year") { setFrom(startOfYear()); setTo(today); }
    else if (p === "all") { setFrom(""); setTo(""); }
  }

  const isApproved = (s: string) => approvedStatuses.includes(s);
  const isPending = (s: string) => pendingStatuses.includes(s);

  // Status-aware filtering (financial KPIs use approved only by default)
  const inDate = (d: string) => {
    const dd = d.slice(0, 10);
    if (from && dd < from) return false;
    if (to && dd > to) return false;
    return true;
  };

  const baseRows = useMemo(() => rows.filter(r => inDate(r.date)), [rows, from, to]);

  const filtered = useMemo(() => baseRows.filter(r => {
    if (typeFilter !== "all" && r.type !== typeFilter) return false;
    if (statusFilter === "approved" && !isApproved(r.status)) return false;
    if (statusFilter === "pending" && !isPending(r.status)) return false;
    if (categoryFilter !== "all" && r.category !== categoryFilter) return false;
    if (paymentFilter !== "all" && (r.paymentMethod || "—") !== paymentFilter) return false;
    if (userFilter !== "all" && (r.createdByName || "—") !== userFilter) return false;
    return true;
  }), [baseRows, typeFilter, statusFilter, categoryFilter, paymentFilter, userFilter]);

  // For approved KPIs we always use approved expenses regardless of statusFilter
  const approvedExpenses = useMemo(() =>
    baseRows.filter(r => r.type === "expense" && isApproved(r.status)),
  [baseRows]);
  const approvedIncome = useMemo(() =>
    baseRows.filter(r => r.type === "income" && isApproved(r.status)),
  [baseRows]);
  const pendingExpenses = useMemo(() =>
    baseRows.filter(r => r.type === "expense" && isPending(r.status)),
  [baseRows]);

  const totalApprovedExpenses = approvedExpenses.reduce((s, r) => s + Number(r.amount || 0), 0);
  const totalApprovedIncome = approvedIncome.reduce((s, r) => s + Number(r.amount || 0), 0);
  const totalPending = pendingExpenses.reduce((s, r) => s + Number(r.amount || 0), 0);
  const net = totalApprovedIncome - totalApprovedExpenses;

  // grouping by category for charts/tables (uses statusFilter)
  type Stat = {
    category: string;
    total: number;
    count: number;
    avg: number;
    max: number;
    min: number;
    lastDate: string;
    lastUser: string;
    topPayment: string;
    percent: number;
  };

  const stats: Stat[] = useMemo(() => {
    const expensesOnly = filtered.filter(r => r.type === "expense");
    const grandTotal = expensesOnly.reduce((s, r) => s + Number(r.amount || 0), 0) || 1;
    const map = new Map<string, AnalyticsRow[]>();
    expensesOnly.forEach(r => {
      const key = r.category || "—";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    });
    const out: Stat[] = [];
    map.forEach((arr, cat) => {
      const amounts = arr.map(a => Number(a.amount || 0));
      const total = amounts.reduce((s, x) => s + x, 0);
      const sorted = [...arr].sort((a, b) => b.date.localeCompare(a.date));
      const pmCount = new Map<string, number>();
      arr.forEach(a => { const k = a.paymentMethod || "—"; pmCount.set(k, (pmCount.get(k) || 0) + 1); });
      const topPayment = [...pmCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "—";
      out.push({
        category: cat,
        total, count: arr.length,
        avg: total / arr.length,
        max: Math.max(...amounts),
        min: Math.min(...amounts),
        lastDate: sorted[0]?.date || "—",
        lastUser: sorted[0]?.createdByName || "—",
        topPayment,
        percent: (total / grandTotal) * 100,
      });
    });
    return out.sort((a, b) => b.total - a.total);
  }, [filtered]);

  const top10 = stats.slice(0, 10);
  const topCategory = stats[0];
  const topExpense = useMemo(() => {
    const exp = filtered.filter(r => r.type === "expense");
    return exp.sort((a, b) => Number(b.amount) - Number(a.amount))[0];
  }, [filtered]);

  const userCount = useMemo(() => {
    const m = new Map<string, number>();
    filtered.filter(r => r.type === "expense").forEach(r => {
      const k = r.createdByName || "—";
      m.set(k, (m.get(k) || 0) + 1);
    });
    return [...m.entries()].sort((a, b) => b[1] - a[1])[0];
  }, [filtered]);

  // distinct lists for filters
  const allCats = useMemo(() => [...new Set(rows.map(r => r.category).filter(Boolean))].sort(), [rows]);
  const allPay = useMemo(() => [...new Set(rows.map(r => r.paymentMethod).filter(Boolean) as string[])].sort(), [rows]);
  const allUsers = useMemo(() => [...new Set(rows.map(r => r.createdByName).filter(Boolean) as string[])].sort(), [rows]);

  // daily series
  const daily = useMemo(() => {
    const m = new Map<string, number>();
    filtered.filter(r => r.type === "expense").forEach(r => {
      const d = r.date.slice(0, 10);
      m.set(d, (m.get(d) || 0) + Number(r.amount || 0));
    });
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, total: v }));
  }, [filtered]);

  const incomeVsExpense = [
    { name: "إيرادات معتمدة", value: totalApprovedIncome },
    { name: "مصروفات معتمدة", value: totalApprovedExpenses },
  ];

  function handleExportCSV() {
    exportCSV(`${treasuryName}_تحليل_${from || "all"}_${to || "all"}.csv`,
      stats.map(s => ({
        "بند المصروف": s.category,
        "إجمالي المصروف": s.total,
        "عدد الحركات": s.count,
        "متوسط الحركة": Number(s.avg.toFixed(2)),
        "أعلى حركة": s.max,
        "أقل حركة": s.min,
        "آخر تاريخ صرف": s.lastDate,
        "آخر مستخدم": s.lastUser,
        "طريقة الدفع الأكثر": s.topPayment,
        "النسبة %": Number(s.percent.toFixed(2)),
      })));
  }

  function handlePrint() {
    const periodLbl = from || to ? `من ${from || "—"} إلى ${to || "—"}` : "كل الفترات";
    const rowsHtml = stats.map((s, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(s.category)}</td>
        <td class="num">${fmt(s.total)}</td>
        <td class="num">${s.count}</td>
        <td class="num">${fmt(s.avg)}</td>
        <td class="num">${fmt(s.max)}</td>
        <td class="num">${s.lastDate}</td>
        <td class="num">${s.percent.toFixed(1)}%</td>
      </tr>`).join("");
    const body = `
      <header>
        <div>
          <h1>${escapeHtml(title)}</h1>
          <div class="en">${escapeHtml(treasuryName)}</div>
        </div>
        <div class="meta">
          <div>الفترة: ${escapeHtml(periodLbl)}</div>
          <div>التاريخ: ${fmtDate(new Date().toISOString())}</div>
        </div>
      </header>
      <div class="stats">
        <div class="stat"><div class="k">إجمالي المصروفات المعتمدة</div><div class="v">${fmt(totalApprovedExpenses)} ج</div></div>
        <div class="stat"><div class="k">إجمالي الإيرادات المعتمدة</div><div class="v">${fmt(totalApprovedIncome)} ج</div></div>
        <div class="stat"><div class="k">صافي الحركة</div><div class="v">${fmt(net)} ج</div></div>
        <div class="stat"><div class="k">أكثر بند مصروف</div><div class="v">${escapeHtml(topCategory?.category || "—")}</div></div>
      </div>
      <h2>أعلى 10 بنود مصروفات</h2>
      <table>
        <thead><tr>
          <th>#</th><th>البند</th><th>الإجمالي</th><th>عدد</th>
          <th>متوسط</th><th>أعلى</th><th>آخر صرف</th><th>النسبة</th>
        </tr></thead>
        <tbody>${rowsHtml || `<tr><td colspan="8" style="text-align:center">لا توجد بيانات</td></tr>`}</tbody>
      </table>
      <div style="margin-top:14px;font-size:10px;color:#555">
        ملاحظة: هذا التحليل للقراءة فقط ولا يؤثر على أرصدة الخزنة.
        الأرقام الفعلية تعتمد على الحركات المعتمدة فقط.
      </div>
      <div style="margin-top:40px;display:flex;justify-content:space-around;font-size:11px">
        <div>توقيع المحاسبة: ____________________</div>
        <div>توقيع الإدارة: ____________________</div>
      </div>`;
    openPrintWindow(`${title} — ${periodLbl}`, body);
  }

  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Wallet className="h-5 w-5 text-primary" />
              {title}
            </CardTitle>
            <div className="text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-2 inline-flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />
              هذا التحليل للقراءة فقط ولا يؤثر على أرصدة الخزنة. الأرقام الفعلية تعتمد على الحركات المعتمدة approved فقط.
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleExportCSV}><FileDown className="h-4 w-4 ml-1" />Excel</Button>
            <Button variant="outline" size="sm" onClick={handlePrint}><Printer className="h-4 w-4 ml-1" />طباعة / PDF</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filters */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2 p-3 bg-muted/40 rounded-lg">
          <div className="col-span-2 md:col-span-2 lg:col-span-1">
            <Label className="text-xs">فترة سريعة</Label>
            <Select value={preset} onValueChange={(v) => applyPreset(v as Preset)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="today">اليوم</SelectItem>
                <SelectItem value="week">هذا الأسبوع</SelectItem>
                <SelectItem value="month">هذا الشهر</SelectItem>
                <SelectItem value="year">هذه السنة</SelectItem>
                <SelectItem value="all">كل الفترات</SelectItem>
                <SelectItem value="custom">مخصص</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">من تاريخ</Label>
            <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPreset("custom"); }} className="h-9" />
          </div>
          <div>
            <Label className="text-xs">إلى تاريخ</Label>
            <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPreset("custom"); }} className="h-9" />
          </div>
          <div>
            <Label className="text-xs">الحالة</Label>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="approved">معتمدة فقط</SelectItem>
                <SelectItem value="pending">معلقة فقط</SelectItem>
                <SelectItem value="all">الكل</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">النوع</Label>
            <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as any)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="expense">مصروفات</SelectItem>
                <SelectItem value="income">إيرادات</SelectItem>
                <SelectItem value="all">الكل</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">البند</Label>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="all">الكل</SelectItem>
                {allCats.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">طريقة الدفع</Label>
            <Select value={paymentFilter} onValueChange={setPaymentFilter}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                {allPay.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {allUsers.length > 0 && (
            <div className="col-span-2 md:col-span-2 lg:col-span-1">
              <Label className="text-xs">المستخدم</Label>
              <Select value={userFilter} onValueChange={setUserFilter}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {allUsers.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <KPI title="إجمالي المصروفات المعتمدة" value={`${fmt(totalApprovedExpenses)} ج`} tone="destructive" icon={<TrendingDown className="h-4 w-4" />} />
          <KPI title="إجمالي الإيرادات المعتمدة" value={`${fmt(totalApprovedIncome)} ج`} tone="success" icon={<TrendingUp className="h-4 w-4" />} />
          <KPI title="صافي الحركة" value={`${fmt(net)} ج`} tone={net >= 0 ? "success" : "destructive"} />
          <KPI title="أكثر بند مصروف" value={topCategory?.category || "—"} sub={topCategory ? `${fmt(topCategory.total)} ج (${topCategory.count} حركة)` : ""} />
          <KPI title="أعلى حركة مصروف" value={topExpense ? `${fmt(topExpense.amount)} ج` : "—"} sub={topExpense?.category || ""} />
          <KPI title="عدد حركات المصروف" value={String(approvedExpenses.length)} sub={`بنود: ${stats.length}`} />
          <KPI title="حركات معلقة" value={String(pendingExpenses.length)} sub={`${fmt(totalPending)} ج`} tone="warning" />
          <KPI title="أكثر مستخدم تسجيلًا" value={userCount?.[0] || "—"} sub={userCount ? `${userCount[1]} حركة` : ""} />
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">توزيع المصروفات حسب البند</CardTitle></CardHeader>
            <CardContent style={{ height: 260 }}>
              {top10.length === 0 ? <div className="text-center text-muted-foreground text-sm py-12">لا توجد بيانات</div> : (
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={top10} dataKey="total" nameKey="category" outerRadius={90} innerRadius={45} label={(e: any) => `${e.percent ? (e.percent * 100).toFixed(0) : 0}%`}>
                      {top10.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <RTooltip formatter={(v: any) => `${fmt(Number(v))} ج`} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">أعلى 10 بنود مصروفات</CardTitle></CardHeader>
            <CardContent style={{ height: 260 }}>
              {top10.length === 0 ? <div className="text-center text-muted-foreground text-sm py-12">لا توجد بيانات</div> : (
                <ResponsiveContainer>
                  <BarChart data={top10} layout="vertical" margin={{ left: 10, right: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" tickFormatter={(v) => fmtNum(v, 0)} />
                    <YAxis type="category" dataKey="category" width={110} tick={{ fontSize: 11 }} />
                    <RTooltip formatter={(v: any) => `${fmt(Number(v))} ج`} />
                    <Bar dataKey="total" fill="#6b46c1" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">تطور المصروفات يوميًا</CardTitle></CardHeader>
            <CardContent style={{ height: 240 }}>
              {daily.length === 0 ? <div className="text-center text-muted-foreground text-sm py-12">لا توجد بيانات</div> : (
                <ResponsiveContainer>
                  <LineChart data={daily}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis tickFormatter={(v) => fmtNum(v, 0)} />
                    <RTooltip formatter={(v: any) => `${fmt(Number(v))} ج`} />
                    <Line type="monotone" dataKey="total" stroke="#ed8936" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">إيرادات مقابل مصروفات</CardTitle></CardHeader>
            <CardContent style={{ height: 240 }}>
              <ResponsiveContainer>
                <BarChart data={incomeVsExpense}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis tickFormatter={(v) => fmtNum(v, 0)} />
                  <RTooltip formatter={(v: any) => `${fmt(Number(v))} ج`} />
                  <Bar dataKey="value">
                    <Cell fill="#38a169" />
                    <Cell fill="#e53e3e" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* Details table */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">تفاصيل تحليل المصروفات</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>البند</TableHead>
                    <TableHead className="text-right">الإجمالي</TableHead>
                    <TableHead className="text-right">عدد</TableHead>
                    <TableHead className="text-right">متوسط</TableHead>
                    <TableHead className="text-right">أعلى</TableHead>
                    <TableHead className="text-right">أقل</TableHead>
                    <TableHead>آخر صرف</TableHead>
                    <TableHead>آخر مستخدم</TableHead>
                    <TableHead>طريقة دفع</TableHead>
                    <TableHead className="text-right">%</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats.length === 0 && (
                    <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-6">لا توجد بيانات في الفترة المحددة</TableCell></TableRow>
                  )}
                  {stats.map((s) => (
                    <TableRow key={s.category}>
                      <TableCell className="font-medium">{s.category}</TableCell>
                      <TableCell className="text-right font-mono">{fmt(s.total)}</TableCell>
                      <TableCell className="text-right">{s.count}</TableCell>
                      <TableCell className="text-right font-mono">{fmt(s.avg)}</TableCell>
                      <TableCell className="text-right font-mono">{fmt(s.max)}</TableCell>
                      <TableCell className="text-right font-mono">{fmt(s.min)}</TableCell>
                      <TableCell className="text-xs">{s.lastDate}</TableCell>
                      <TableCell className="text-xs">{s.lastUser}</TableCell>
                      <TableCell className="text-xs">{s.topPayment}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant="outline">{s.percent.toFixed(1)}%</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </CardContent>
    </Card>
  );
}

function KPI({
  title, value, sub, tone, icon,
}: { title: string; value: string; sub?: string; tone?: "success" | "destructive" | "warning"; icon?: React.ReactNode }) {
  const toneCls =
    tone === "success" ? "border-green-300 bg-green-50/50" :
    tone === "destructive" ? "border-red-300 bg-red-50/50" :
    tone === "warning" ? "border-amber-300 bg-amber-50/50" : "";
  return (
    <Card className={toneCls}>
      <CardContent className="p-3">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{title}</span>{icon}
        </div>
        <div className="text-lg font-bold font-mono mt-1 truncate" title={value}>{value}</div>
        {sub && <div className="text-[11px] text-muted-foreground mt-0.5 truncate" title={sub}>{sub}</div>}
      </CardContent>
    </Card>
  );
}
