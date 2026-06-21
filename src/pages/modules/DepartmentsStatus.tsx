/**
 * موقف ميزانيات الأقسام
 * ----------------------
 * صفحة قراءة فقط تجمّع موقف 8 أقسام من الجداول الموجودة في النظام.
 * لا تُنشئ أي حركة خزنة أو مخزون أو فاتورة. الاعتمادات المعلّقة تظهر منفصلة
 * ولا تدخل في صافي الرصيد إلا بعد اعتمادها.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Wallet, TrendingUp, TrendingDown, AlertTriangle, RefreshCw, Printer, FileSpreadsheet,
  Loader2, Eye, Egg, TreePine, Beef, Factory, Warehouse, Megaphone, Lock, Building2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { openPrintWindow, COMPANY_AR } from "@/lib/printPdf";

// ============================================================================
// Types
// ============================================================================

type DeptKey =
  | "hatchery" | "mother_farm" | "slaughterhouse" | "meat_factory"
  | "warehouses" | "marketing_sales" | "treasuries" | "admin";

interface DeptSnapshot {
  key: DeptKey;
  name: string;
  icon: any;
  revenue: number;          // إجمالي الإيرادات المعتمدة
  expenses: number;         // إجمالي المصروفات المعتمدة
  purchases: number;        // إجمالي المشتريات
  collections: number;      // إجمالي التحصيلات
  payments: number;         // إجمالي المدفوعات
  balance: number;          // الرصيد الحالي (خزنة/عهدة)
  debts: number;            // المديونيات / المستحق على العملاء
  pending: number;          // اعتمادات معلّقة (مش داخلة في الصافي)
  inventoryValue?: number;  // قيمة المخزون (للمخازن فقط)
  net: number;              // صافي الموقف = revenue + collections - expenses - payments
  lastActivity?: string;    // آخر حركة مالية
  alerts: string[];         // تنبيهات خاصة بالقسم
}

interface PageData {
  departments: DeptSnapshot[];
  lastUpdated: string;
  totals: {
    revenue: number; expenses: number; balance: number;
    debts: number; pending: number; net: number; inventoryValue: number;
  };
  globalAlerts: string[];
}

interface DateRange { from: string; to: string }

// ============================================================================
// Helpers
// ============================================================================

const fmt = (n: number) =>
  new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 0 }).format(Math.round(n || 0));

const todayISO = () => new Date().toISOString().slice(0, 10);
const monthStartISO = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};
const yearStartISO = () => new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10);
const monthsAgoISO = (n: number) => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() - n, 1).toISOString().slice(0, 10);
};

const sum = (rows: any[] | null | undefined, field: string) =>
  (rows ?? []).reduce((s, r) => s + Number(r?.[field] || 0), 0);

const safeQuery = async (p: any): Promise<any[]> => {
  try {
    const r = await p;
    if (r?.error) return [];
    return (r?.data as any[]) ?? [];
  } catch { return []; }
};

// ============================================================================
// Data collectors — one per department
// ============================================================================

async function collectHatchery(range: DateRange): Promise<DeptSnapshot> {
  const [invoices, payments, txns] = await Promise.all([
    safeQuery(supabase.from("hatchery_client_invoices")
      .select("invoice_total, collected_amount, remaining_amount, payment_status, created_at")
      .gte("created_at", range.from).lte("created_at", range.to + "T23:59:59")),
    safeQuery(supabase.from("hatchery_invoice_payments")
      .select("amount, paid_at")
      .gte("paid_at", range.from).lte("paid_at", range.to + "T23:59:59")),
    safeQuery(supabase.from("hatchery_treasury_txns")
      .select("direction, amount, txn_date, category")
      .gte("txn_date", range.from).lte("txn_date", range.to)),
  ]);
  // Treasury full balance is cumulative — show overall not just range
  const fullTxns = await safeQuery(supabase.from("hatchery_treasury_txns")
    .select("direction, amount, txn_date"));

  const revenue = sum(invoices, "invoice_total");
  const collections = sum(payments, "amount");
  const debts = sum(invoices, "remaining_amount");
  const expenses = sum(txns.filter(t => t.direction === "out"), "amount");
  const balance = sum(fullTxns.filter(t => t.direction === "in"), "amount")
                - sum(fullTxns.filter(t => t.direction === "out"), "amount");
  const last = [...payments, ...txns].map(r => r.paid_at || r.txn_date).filter(Boolean).sort().pop();

  const alerts: string[] = [];
  if (debts > 0) alerts.push(`مديونية عملاء التفريخ: ${fmt(debts)} ج.م`);
  if (balance < 0) alerts.push("رصيد خزنة المعمل سالب — راجع الحركات");

  return {
    key: "hatchery", name: "معمل التفريخ والحضانات", icon: Egg,
    revenue, expenses, purchases: 0, collections, payments: expenses,
    balance, debts, pending: 0,
    net: revenue + collections - expenses,
    lastActivity: last, alerts,
  };
}

async function collectMotherFarm(range: DateRange): Promise<DeptSnapshot> {
  const [eggs, feed, deaths] = await Promise.all([
    safeQuery(supabase.from("farm_egg_production")
      .select("count, log_date")
      .gte("log_date", range.from).lte("log_date", range.to)),
    safeQuery(supabase.from("farm_feed_log")
      .select("quantity_kg, cost, log_date")
      .gte("log_date", range.from).lte("log_date", range.to)),
    safeQuery(supabase.from("farm_egg_waste")
      .select("count, log_date")
      .gte("log_date", range.from).lte("log_date", range.to)),
  ]);
  const feedCost = sum(feed, "cost");
  const last = [...eggs, ...feed, ...deaths].map(r => r.log_date).filter(Boolean).sort().pop();
  const alerts: string[] = [];
  if (feedCost === 0 && feed.length > 0) alerts.push("سجلّات علف بدون تكلفة محتسبة");
  return {
    key: "mother_farm", name: "مزرعة الأمهات", icon: TreePine,
    revenue: 0, expenses: feedCost, purchases: feedCost, collections: 0, payments: feedCost,
    balance: 0, debts: 0, pending: 0,
    net: -feedCost,
    lastActivity: last, alerts,
  };
}

async function collectSlaughterhouse(range: DateRange): Promise<DeptSnapshot> {
  const [expensesRows, expensesPending, openings, batches] = await Promise.all([
    safeQuery(supabase.from("slaughter_custody_expenses")
      .select("amount, expense_date, status")
      .eq("status", "approved")
      .gte("expense_date", range.from).lte("expense_date", range.to)),
    safeQuery(supabase.from("slaughter_custody_expenses")
      .select("amount, status")
      .not("status","eq","approved")),
    safeQuery(supabase.from("slaughter_custody_opening_balances")
      .select("amount")),
    safeQuery(supabase.from("slaughter_batches")
      .select("slaughter_date, total_cost, status")
      .gte("slaughter_date", range.from).lte("slaughter_date", range.to)),
  ]);
  const allApproved = await safeQuery(supabase.from("slaughter_custody_expenses")
    .select("amount, status").eq("status", "approved"));
  const opening = sum(openings, "amount");
  const balance = opening - sum(allApproved, "amount");
  const expenses = sum(expensesRows, "amount");
  const pending = sum(expensesPending, "amount");
  const last = expensesRows.map(r => r.expense_date).filter(Boolean).sort().pop();
  const alerts: string[] = [];
  if (balance < 0) alerts.push("عهدة المجزر سالبة — راجع الفتح أو المصروفات");
  if (pending > 0) alerts.push(`مصروفات بانتظار اعتماد: ${fmt(pending)} ج.م`);
  return {
    key: "slaughterhouse", name: "المجزر", icon: Beef,
    revenue: sum(batches, "total_cost"), expenses, purchases: 0,
    collections: 0, payments: expenses,
    balance, debts: 0, pending,
    net: -expenses,
    lastActivity: last, alerts,
  };
}

async function collectMeatFactory(range: DateRange): Promise<DeptSnapshot> {
  const [purchases, sales, txns, txnsAll] = await Promise.all([
    safeQuery(supabase.from("meat_factory_purchases")
      .select("total_amount, purchase_date, status")
      .eq("status", "approved")
      .gte("purchase_date", range.from).lte("purchase_date", range.to)),
    safeQuery(supabase.from("meat_factory_sales")
      .select("total_amount, sale_date, status")
      .eq("status", "approved")
      .gte("sale_date", range.from).lte("sale_date", range.to)),
    safeQuery(supabase.from("meat_factory_treasury_txns")
      .select("direction, amount, txn_date")
      .gte("txn_date", range.from).lte("txn_date", range.to)),
    safeQuery(supabase.from("meat_factory_treasury_txns")
      .select("direction, amount")),
  ]);
  const pendingRows = await safeQuery(supabase.from("meat_factory_purchases")
    .select("total_amount, status").not("status","eq","approved"));
  const purchasesTotal = sum(purchases, "total_amount");
  const revenue = sum(sales, "total_amount");
  const expenses = sum(txns.filter(t => t.direction === "out"), "amount");
  const balance = sum(txnsAll.filter(t => t.direction === "in"), "amount")
                - sum(txnsAll.filter(t => t.direction === "out"), "amount");
  const last = [...purchases, ...sales, ...txns]
    .map(r => r.purchase_date || r.sale_date || r.txn_date).filter(Boolean).sort().pop();
  const alerts: string[] = [];
  if (balance < 0) alerts.push("خزنة مصنع اللحوم سالبة");
  return {
    key: "meat_factory", name: "مصنع اللحوم", icon: Factory,
    revenue, expenses, purchases: purchasesTotal,
    collections: revenue, payments: purchasesTotal,
    balance, debts: 0, pending: sum(pendingRows, "total_amount"),
    net: revenue - purchasesTotal - expenses,
    lastActivity: last, alerts,
  };
}

async function collectWarehouses(_range: DateRange): Promise<DeptSnapshot> {
  const [items, movements] = await Promise.all([
    safeQuery(supabase.from("inventory_items")
      .select("stock, unit_cost, warehouse_id, warehouse:warehouses(name)")
      .eq("is_active", true)),
    safeQuery(supabase.from("inventory_movements")
      .select("performed_at, movement_type").order("performed_at", { ascending: false }).limit(1)),
  ]);
  const inventoryValue = items.reduce((s, it) => s + Number(it.stock || 0) * Number(it.unit_cost || 0), 0);
  const negativeStock = items.filter(it => Number(it.stock) < 0).length;
  const alerts: string[] = [];
  if (negativeStock > 0) alerts.push(`عدد ${negativeStock} صنف برصيد سالب — يحتاج جرد`);
  return {
    key: "warehouses", name: "المخازن", icon: Warehouse,
    revenue: 0, expenses: 0, purchases: 0, collections: 0, payments: 0,
    balance: 0, debts: 0, pending: 0,
    inventoryValue, net: 0,
    lastActivity: movements[0]?.performed_at, alerts,
  };
}

async function collectMarketingSales(range: DateRange): Promise<DeptSnapshot> {
  const [orders] = await Promise.all([
    safeQuery(supabase.from("orders")
      .select("total, payment_status, status, created_at")
      .neq("status", "cancelled")
      .gte("created_at", range.from).lte("created_at", range.to + "T23:59:59")),
  ]);
  const revenue = sum(orders, "total");
  const collected = sum(orders.filter(o => o.payment_status === "paid"), "total");
  const debts = sum(orders.filter(o => o.payment_status !== "paid"), "total");
  const last = orders.map(o => o.created_at).filter(Boolean).sort().pop();
  const alerts: string[] = [];
  if (debts > revenue * 0.4 && revenue > 0)
    alerts.push("نسبة الطلبات غير المحصّلة عالية — راجع التحصيل");
  return {
    key: "marketing_sales", name: "التسويق والمبيعات", icon: Megaphone,
    revenue, expenses: 0, purchases: 0, collections: collected, payments: 0,
    balance: 0, debts, pending: 0,
    net: collected,
    lastActivity: last, alerts,
  };
}

async function collectTreasuries(_range: DateRange): Promise<DeptSnapshot> {
  const [main, lab, hat, meat, slaughterOpen, slaughterExp] = await Promise.all([
    safeQuery(supabase.from("main_treasury_transactions")
      .select("txn_type, amount, status").eq("status", "approved")),
    safeQuery(supabase.from("lab_treasury_movements")
      .select("movement_type, amount, status").eq("status", "approved")),
    safeQuery(supabase.from("hatchery_treasury_txns").select("direction, amount")),
    safeQuery(supabase.from("meat_factory_treasury_txns").select("direction, amount")),
    safeQuery(supabase.from("slaughter_custody_opening_balances").select("amount")),
    safeQuery(supabase.from("slaughter_custody_expenses").select("amount, status").eq("status", "approved")),
  ]);
  const mainPending = await safeQuery(supabase.from("main_treasury_transactions")
    .select("amount, status").not("status","eq","approved"));
  const labPending = await safeQuery(supabase.from("lab_treasury_movements")
    .select("amount, status").not("status","eq","approved"));

  const mainIn = sum(main.filter(t => ["deposit", "income", "in"].includes(t.txn_type)), "amount");
  const mainOut = sum(main.filter(t => ["withdrawal", "expense", "out", "transfer"].includes(t.txn_type)), "amount");
  const labIn = sum(lab.filter(t => String(t.movement_type).includes("in") || String(t.movement_type).includes("income")), "amount");
  const labOut = sum(lab.filter(t => String(t.movement_type).includes("out") || String(t.movement_type).includes("expense")), "amount");
  const hatBal = sum(hat.filter(t => t.direction === "in"), "amount") - sum(hat.filter(t => t.direction === "out"), "amount");
  const meatBal = sum(meat.filter(t => t.direction === "in"), "amount") - sum(meat.filter(t => t.direction === "out"), "amount");
  const slaughterBal = sum(slaughterOpen, "amount") - sum(slaughterExp, "amount");

  const balance = (mainIn - mainOut) + (labIn - labOut) + hatBal + meatBal + slaughterBal;
  const pending = sum(mainPending, "amount") + sum(labPending, "amount");

  const alerts: string[] = [];
  if (balance < 0) alerts.push("إجمالي أرصدة الخزن سالب — تحقق فورًا");
  if (pending > 0) alerts.push(`اعتمادات خزنة معلّقة: ${fmt(pending)} ج.م`);

  return {
    key: "treasuries", name: "الخزن والعهد", icon: Lock,
    revenue: 0, expenses: 0, purchases: 0, collections: 0, payments: 0,
    balance, debts: 0, pending,
    net: balance, alerts,
  };
}

async function collectAdmin(range: DateRange): Promise<DeptSnapshot> {
  const rows = await safeQuery(supabase.from("main_treasury_transactions")
    .select("amount, txn_type, status, txn_date")
    .eq("status", "approved")
    .in("txn_type", ["expense", "withdrawal"])
    .gte("txn_date", range.from).lte("txn_date", range.to));
  const pendingRows = await safeQuery(supabase.from("main_treasury_transactions")
    .select("amount, status").not("status","eq","approved"));
  const expenses = sum(rows, "amount");
  const last = rows.map(r => r.txn_date).filter(Boolean).sort().pop();
  return {
    key: "admin", name: "المصروفات العامة / الإدارة", icon: Building2,
    revenue: 0, expenses, purchases: 0, collections: 0, payments: expenses,
    balance: 0, debts: 0, pending: sum(pendingRows, "amount"),
    net: -expenses,
    lastActivity: last, alerts: [],
  };
}

// ============================================================================
// Aggregator
// ============================================================================

async function loadAll(range: DateRange): Promise<PageData> {
  const results = await Promise.all([
    collectHatchery(range), collectMotherFarm(range), collectSlaughterhouse(range),
    collectMeatFactory(range), collectWarehouses(range), collectMarketingSales(range),
    collectTreasuries(range), collectAdmin(range),
  ]);
  const totals = results.reduce((acc, d) => ({
    revenue: acc.revenue + d.revenue,
    expenses: acc.expenses + d.expenses,
    balance: acc.balance + d.balance,
    debts: acc.debts + d.debts,
    pending: acc.pending + d.pending,
    net: acc.net + d.net,
    inventoryValue: acc.inventoryValue + (d.inventoryValue || 0),
  }), { revenue: 0, expenses: 0, balance: 0, debts: 0, pending: 0, net: 0, inventoryValue: 0 });
  const globalAlerts: string[] = [];
  results.forEach(d => d.alerts.forEach(a => globalAlerts.push(`[${d.name}] ${a}`)));
  return {
    departments: results,
    lastUpdated: new Date().toLocaleString("ar-EG"),
    totals,
    globalAlerts,
  };
}

// ============================================================================
// UI
// ============================================================================

const PRESETS = [
  { id: "month", label: "الشهر الحالي", from: monthStartISO, to: todayISO },
  { id: "3m", label: "آخر 3 شهور", from: () => monthsAgoISO(3), to: todayISO },
  { id: "ytd", label: "من أول السنة", from: yearStartISO, to: todayISO },
];

export default function DepartmentsStatus() {
  const [from, setFrom] = useState(monthStartISO());
  const [to, setTo] = useState(todayISO());
  const [preset, setPreset] = useState("month");
  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState<DeptSnapshot | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await loadAll({ from, to });
      setData(d);
    } catch (e: any) {
      toast.error("تعذّر تحميل الموقف: " + (e?.message ?? e));
    } finally { setLoading(false); }
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  const applyPreset = (id: string) => {
    setPreset(id);
    const p = PRESETS.find(x => x.id === id);
    if (p) { setFrom(p.from()); setTo(p.to()); }
  };

  const exportExcel = () => {
    if (!data) return;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      data.departments.map(d => ({
        القسم: d.name,
        "الإيرادات": d.revenue,
        "المصروفات": d.expenses,
        "المشتريات": d.purchases,
        "التحصيلات": d.collections,
        "المدفوعات": d.payments,
        "الرصيد الحالي": d.balance,
        "قيمة المخزون": d.inventoryValue || 0,
        "المديونيات": d.debts,
        "اعتمادات معلّقة": d.pending,
        "صافي الموقف": d.net,
        "آخر حركة": d.lastActivity ? new Date(d.lastActivity).toLocaleString("ar-EG") : "—",
      })),
    ), "موقف الأقسام");
    XLSX.writeFile(wb, `موقف-ميزانيات-الأقسام-${todayISO()}.xlsx`);
  };

  const printReport = () => {
    if (!data) return;
    const rows = data.departments.map(d => `
      <tr>
        <td>${d.name}</td>
        <td class="n">${fmt(d.revenue)}</td>
        <td class="n">${fmt(d.expenses)}</td>
        <td class="n">${fmt(d.collections)}</td>
        <td class="n">${fmt(d.payments)}</td>
        <td class="n"><b>${fmt(d.balance)}</b></td>
        <td class="n">${fmt(d.debts)}</td>
        <td class="n">${fmt(d.pending)}</td>
        <td class="n"><b>${d.net >= 0 ? "+" : ""}${fmt(d.net)}</b></td>
      </tr>`).join("");
    const body = `
      <header><div><h1>${COMPANY_AR}</h1><div class="en">Departments Financial Status</div></div>
        <div class="meta">الفترة: ${from} → ${to}<br/>آخر تحديث: ${data.lastUpdated}</div></header>
      <div class="stats">
        <div class="stat"><div class="k">إجمالي الإيرادات</div><div class="v">${fmt(data.totals.revenue)}</div></div>
        <div class="stat"><div class="k">إجمالي المصروفات</div><div class="v">${fmt(data.totals.expenses)}</div></div>
        <div class="stat"><div class="k">إجمالي الرصيد</div><div class="v">${fmt(data.totals.balance)}</div></div>
        <div class="stat"><div class="k">إجمالي المديونيات</div><div class="v">${fmt(data.totals.debts)}</div></div>
        <div class="stat"><div class="k">اعتمادات معلّقة</div><div class="v">${fmt(data.totals.pending)}</div></div>
        <div class="stat"><div class="k">قيمة المخزون</div><div class="v">${fmt(data.totals.inventoryValue)}</div></div>
      </div>
      <h2>موقف الأقسام</h2>
      <table><thead><tr>
        <th>القسم</th><th>إيرادات</th><th>مصروفات</th><th>تحصيلات</th><th>مدفوعات</th>
        <th>الرصيد</th><th>مديونيات</th><th>معلّق</th><th>الصافي</th>
      </tr></thead><tbody>${rows}</tbody></table>
      ${data.globalAlerts.length ? `<h2>تنبيهات</h2><ul>${data.globalAlerts.map(a => `<li>${a}</li>`).join("")}</ul>` : ""}
      <p style="font-size:11px;color:#666;margin-top:14px">
        تقرير عرض فقط — لا يُنشئ أي حركة خزنة أو مخزون. الاعتمادات المعلّقة منفصلة ولا تدخل في الصافي.
      </p>`;
    openPrintWindow(`موقف ميزانيات الأقسام — ${todayISO()}`, body, "table{font-size:11px}.n{text-align:left;font-variant-numeric:tabular-nums}");
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Wallet className="w-7 h-7 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">موقف ميزانيات الأقسام</h1>
              <p className="text-muted-foreground mt-1 text-sm">
                {data ? `آخر تحديث: ${data.lastUpdated}` : "جارٍ التحميل..."}
                {" · "}عرض فقط — لا يُنشئ أي حركة
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" onClick={load} disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 ml-1 animate-spin" /> : <RefreshCw className="w-4 h-4 ml-1" />}
              تحديث الأرقام
            </Button>
            <Button variant="outline" onClick={printReport} disabled={!data}>
              <Printer className="w-4 h-4 ml-1" /> طباعة PDF
            </Button>
            <Button variant="outline" onClick={exportExcel} disabled={!data}>
              <FileSpreadsheet className="w-4 h-4 ml-1" /> Excel
            </Button>
          </div>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="grid gap-3 md:grid-cols-4">
              <div>
                <Label className="text-xs">الفترة</Label>
                <Select value={preset} onValueChange={applyPreset}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRESETS.map(p => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
                    <SelectItem value="custom">فترة مخصصة</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">من تاريخ</Label>
                <Input type="date" value={from} onChange={e => { setFrom(e.target.value); setPreset("custom"); }} />
              </div>
              <div>
                <Label className="text-xs">إلى تاريخ</Label>
                <Input type="date" value={to} onChange={e => { setTo(e.target.value); setPreset("custom"); }} />
              </div>
              <div className="flex items-end">
                <Button className="w-full" onClick={load} disabled={loading}>تطبيق</Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* KPIs */}
        {data && (
          <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
            <KPI title="إجمالي الإيرادات" value={data.totals.revenue} icon={<TrendingUp className="w-4 h-4 text-emerald-600" />} />
            <KPI title="إجمالي المصروفات" value={data.totals.expenses} icon={<TrendingDown className="w-4 h-4 text-red-600" />} />
            <KPI title="إجمالي الرصيد" value={data.totals.balance} icon={<Wallet className="w-4 h-4 text-primary" />} />
            <KPI title="إجمالي المديونيات" value={data.totals.debts} icon={<AlertTriangle className="w-4 h-4 text-orange-600" />} />
            <KPI title="اعتمادات معلّقة" value={data.totals.pending} icon={<Loader2 className="w-4 h-4 text-amber-600" />} />
            <KPI title="صافي الموقف" value={data.totals.net} accent={data.totals.net >= 0 ? "text-emerald-600" : "text-red-600"} icon={<Wallet className="w-4 h-4" />} />
          </div>
        )}

        {/* Alerts */}
        {data && data.globalAlerts.length > 0 && (
          <Card className="border-orange-500/40 bg-orange-500/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-orange-600" /> تنبيهات الموقف
              </CardTitle>
              <CardDescription>راجع البنود قبل اعتماد التقرير</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="text-sm space-y-1 list-disc pr-5">
                {data.globalAlerts.map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Departments table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">موقف الأقسام تفصيليًا</CardTitle>
            <CardDescription>الاعتمادات المعلّقة منفصلة ولا تدخل في الصافي</CardDescription>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>القسم</TableHead>
                  <TableHead>الإيرادات</TableHead>
                  <TableHead>المصروفات</TableHead>
                  <TableHead>المشتريات</TableHead>
                  <TableHead>التحصيلات</TableHead>
                  <TableHead>الرصيد</TableHead>
                  <TableHead>قيمة المخزون</TableHead>
                  <TableHead>مديونيات</TableHead>
                  <TableHead>معلّق</TableHead>
                  <TableHead>الصافي</TableHead>
                  <TableHead>آخر حركة</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && (
                  <TableRow><TableCell colSpan={12} className="text-center py-10 text-muted-foreground">
                    <Loader2 className="w-5 h-5 animate-spin inline ml-2" /> جارٍ التحميل...
                  </TableCell></TableRow>
                )}
                {!loading && data?.departments.map(d => {
                  const Icon = d.icon;
                  return (
                    <TableRow key={d.key}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <Icon className="w-4 h-4 text-primary" /> {d.name}
                        </div>
                      </TableCell>
                      <TableCell>{fmt(d.revenue)}</TableCell>
                      <TableCell className="text-red-600">{fmt(d.expenses)}</TableCell>
                      <TableCell>{fmt(d.purchases)}</TableCell>
                      <TableCell>{fmt(d.collections)}</TableCell>
                      <TableCell className={d.balance < 0 ? "text-red-600 font-bold" : ""}>{fmt(d.balance)}</TableCell>
                      <TableCell className="text-muted-foreground">{d.inventoryValue ? fmt(d.inventoryValue) : "—"}</TableCell>
                      <TableCell className={d.debts > 0 ? "text-orange-600" : ""}>{fmt(d.debts)}</TableCell>
                      <TableCell>
                        {d.pending > 0
                          ? <Badge variant="outline" className="border-amber-500 text-amber-700">{fmt(d.pending)}</Badge>
                          : "—"}
                      </TableCell>
                      <TableCell className={d.net >= 0 ? "text-emerald-600 font-bold" : "text-red-600 font-bold"}>
                        {d.net >= 0 ? "+" : ""}{fmt(d.net)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {d.lastActivity ? new Date(d.lastActivity).toLocaleDateString("ar-EG") : "—"}
                      </TableCell>
                      <TableCell>
                        <Button size="sm" variant="ghost" onClick={() => setDetails(d)}>
                          <Eye className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Details dialog */}
        <Dialog open={!!details} onOpenChange={(o) => !o && setDetails(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {details && <details.icon className="w-5 h-5 text-primary" />}
                تفاصيل {details?.name}
              </DialogTitle>
            </DialogHeader>
            {details && (
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  <Stat label="الإيرادات" value={details.revenue} />
                  <Stat label="المصروفات" value={details.expenses} negative />
                  <Stat label="المشتريات" value={details.purchases} />
                  <Stat label="التحصيلات" value={details.collections} />
                  <Stat label="المدفوعات" value={details.payments} negative />
                  <Stat label="الرصيد الحالي" value={details.balance} />
                  {details.inventoryValue ? <Stat label="قيمة المخزون" value={details.inventoryValue} /> : null}
                  <Stat label="المديونيات" value={details.debts} />
                  <Stat label="اعتمادات معلّقة" value={details.pending} />
                  <Stat label="صافي الموقف" value={details.net}
                    accent={details.net >= 0 ? "text-emerald-600" : "text-red-600"} />
                </div>
                {details.lastActivity && (
                  <div className="text-xs text-muted-foreground border-t pt-2">
                    آخر حركة مالية: {new Date(details.lastActivity).toLocaleString("ar-EG")}
                  </div>
                )}
                {details.alerts.length > 0 && (
                  <div className="border rounded-md p-3 bg-orange-500/5 border-orange-500/30">
                    <div className="font-semibold mb-1 text-orange-700 flex items-center gap-1">
                      <AlertTriangle className="w-4 h-4" /> تنبيهات
                    </div>
                    <ul className="text-xs space-y-1 list-disc pr-4">
                      {details.alerts.map((a, i) => <li key={i}>{a}</li>)}
                    </ul>
                  </div>
                )}
                <p className="text-xs text-muted-foreground border-t pt-2">
                  الأرقام مجمّعة من الجداول الفعلية المعتمدة. الاعتمادات المعلّقة معروضة منفصلة ولا تدخل في الصافي.
                </p>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}

function KPI({ title, value, icon, accent }: { title: string; value: number; icon: React.ReactNode; accent?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardDescription className="text-xs">{title}</CardDescription>
          {icon}
        </div>
        <CardTitle className={`text-2xl ${accent || ""}`}>{fmt(value)}</CardTitle>
      </CardHeader>
    </Card>
  );
}

function Stat({ label, value, negative, accent }: { label: string; value: number; negative?: boolean; accent?: string }) {
  return (
    <div className="border rounded-md p-3 bg-muted/30">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-bold ${accent || (negative ? "text-red-600" : "")}`}>{fmt(value)}</div>
    </div>
  );
}
