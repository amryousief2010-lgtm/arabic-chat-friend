import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Bird, Plus, Skull, Wallet, Wheat, Pill, ShoppingCart, ArrowRightLeft, Printer, FileSpreadsheet, AlertTriangle, TrendingUp, Package, MoreVertical } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { openPrintWindow } from "@/lib/printPdf";
import { MarketProfitabilityCard, MarketPricesTab, useMarketPrices } from "./BroodingMarketPrices";

// ===== Types =====
type Batch = {
  id: string;
  batch_number: string;
  received_date: string;
  source: string;
  age_at_receipt_days: number;
  original_count: number;
  current_count: number;
  mortality_count: number;
  sold_count: number;
  transferred_count: number;
  total_cost: number;
  cost_per_bird: number;
  status: string;
  notes: string | null;
};

type Mortality = { id: string; batch_id: string; mortality_date: string; count: number; reason: string | null; notes: string | null };
type Expense = { id: string; batch_id: string; expense_date: string; expense_type: string; item_name: string | null; quantity: number | null; unit_price: number | null; total_amount: number; treasury: string | null; notes: string | null };
type FeedIssue = { id: string; batch_id: string; issue_date: string; feed_name: string; quantity_kg: number; unit_cost: number; total_cost: number; notes: string | null };
type MedIssue = { id: string; batch_id: string; issue_date: string; medicine_name: string; quantity: number; unit: string | null; unit_cost: number; total_cost: number; notes: string | null };
type Sale = { id: string; batch_id: string; sale_date: string; customer_name: string; count: number; unit_price: number; total_amount: number; payment_method: string | null; treasury: string | null; cost_at_sale: number; profit: number; notes: string | null; age_at_sale_days?: number | null; age_label_snapshot?: string | null };
type Transfer = { id: string; batch_id: string; transfer_date: string; count: number; avg_weight_kg: number | null; total_weight_kg: number | null; transferred_cost: number; notes: string | null; live_price_per_kg?: number; valuation_amount?: number; expected_profit_loss?: number };

type BroodingSettings = {
  default_chick_price: number;
  feed_cost_per_kg_phase1: number;
  feed_cost_per_kg_phase2: number;
  phase_split_months: number;
  low_feed_alert_kg: number;
  mortality_alert_pct: number;
  print_header_color: string;
  print_accent_color: string;
  company_name: string;
};
type FeedInventory = { id: string; feed_name: string; current_kg: number; last_unit_cost: number; notes: string | null };
type FeedStockMovement = { id: string; feed_id: string; movement_type: string; quantity_kg: number; unit_cost: number; total_cost: number; batch_id: string | null; notes: string | null; created_at: string };

const DEFAULT_SETTINGS: BroodingSettings = {
  default_chick_price: 1500,
  feed_cost_per_kg_phase1: 20.238,
  feed_cost_per_kg_phase2: 18.638,
  phase_split_months: 4,
  low_feed_alert_kg: 20,
  mortality_alert_pct: 5,
  print_header_color: '#1b5e20',
  print_accent_color: '#e8f5e9',
  company_name: 'نعام العاصمة',
};

// Current age of a batch in days = (today - received_date) + age_at_receipt_days.
// Computed dynamically; no manual editing required.
const currentAgeDays = (batch: Batch | undefined | null): number => {
  if (!batch) return 0;
  const days = Math.floor((Date.now() - new Date(batch.received_date).getTime()) / 86400000);
  return Math.max(days + (batch.age_at_receipt_days || 0), 0);
};

// Age on a specific date — used to price feed/medicine on the day it was issued.
const ageOnDateDays = (batch: Batch | undefined | null, isoDate: string): number => {
  if (!batch) return 0;
  const days = Math.floor((new Date(isoDate).getTime() - new Date(batch.received_date).getTime()) / 86400000);
  return Math.max(days + (batch.age_at_receipt_days || 0), 0);
};

// Compute the recommended feed unit cost for a batch based on its CURRENT age
// using the two-phase recipe defined in brooding_settings.
const feedCostForBatch = (batch: Batch | undefined, settings: BroodingSettings, onDate?: string): number => {
  if (!batch) return settings.feed_cost_per_kg_phase1;
  const days = onDate ? ageOnDateDays(batch, onDate) : currentAgeDays(batch);
  return days < settings.phase_split_months * 30
    ? settings.feed_cost_per_kg_phase1
    : settings.feed_cost_per_kg_phase2;
};

const EXPENSE_TYPES = [
  { value: "feed", label: "علف" },
  { value: "medicine", label: "أدوية" },
  { value: "vitamins", label: "فيتامينات" },
  { value: "labor", label: "عمالة" },
  { value: "bedding", label: "فرشة/نشارة" },
  { value: "utilities", label: "كهرباء/تدفئة" },
  { value: "other", label: "أخرى" },
];

// Pretty current-age label: "45 يوم (شهر ونص)" — dynamic, no manual updates.
const ageLabel = (batch: Batch | undefined | null): string => {
  const d = currentAgeDays(batch);
  if (d < 30) return `${d} يوم`;
  const months = d / 30;
  let approx = "";
  if (Math.abs(months - Math.round(months)) < 0.25) approx = `${Math.round(months)} شهر`;
  else if (months < 2) approx = "شهر ونص";
  else approx = `${months.toFixed(1)} شهر`;
  return `${d} يوم (${approx})`;
};


const fmt = (n: number) => new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 2 }).format(n || 0);
const fmtMoney = (n: number) => `${fmt(n)} ج.م`;

const exportXlsx = (rows: any[], filename: string) => {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  XLSX.writeFile(wb, `${filename}.xlsx`);
};

const printTable = (
  title: string,
  headers: string[],
  rows: (string | number)[][],
  settings: BroodingSettings = DEFAULT_SETTINGS,
  meta?: { batchNumber?: string; status?: string; reportType?: string; totals?: { label: string; value: string }[] }
) => {
  const header = settings.print_header_color;
  const accent = settings.print_accent_color;
  const today = new Date().toLocaleDateString('ar-EG');
  const metaRows = [
    meta?.reportType && `<div><strong>نوع التقرير:</strong> ${meta.reportType}</div>`,
    meta?.batchNumber && `<div><strong>رقم الدفعة/الحركة:</strong> ${meta.batchNumber}</div>`,
    `<div><strong>التاريخ:</strong> ${today}</div>`,
    meta?.status && `<div><strong>الحالة:</strong> ${meta.status}</div>`,
  ].filter(Boolean).join('');
  const totalsHtml = meta?.totals?.length
    ? `<table style="width:100%;border-collapse:collapse;margin-top:12px;font-family:'Cairo',sans-serif;border:2px solid ${header}">
         <tr style="background:${accent}"><th colspan="2" style="padding:8px;color:${header};font-size:14px">الإجماليات</th></tr>
         ${meta.totals.map(t => `<tr><td style="padding:6px;border:1px solid #ccc;font-weight:bold">${t.label}</td><td style="padding:6px;border:1px solid #ccc;text-align:left">${t.value}</td></tr>`).join('')}
       </table>` : '';
  const html = `
    <div style="font-family:'Cairo',sans-serif;direction:rtl">
      <div style="border-bottom:3px solid ${header};padding-bottom:10px;margin-bottom:15px">
        <h1 style="margin:0;text-align:center;color:${header};font-size:26px">${settings.company_name}</h1>
        <h2 style="margin:4px 0 0;text-align:center;color:#555;font-size:16px;font-weight:normal">قسم التحضين والتسمين</h2>
      </div>
      <h3 style="text-align:center;color:${header};margin:0 0 10px">${title}</h3>
      <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:8px;background:${accent};border-radius:6px;margin-bottom:12px;font-size:13px">${metaRows}</div>
      <table style="width:100%;border-collapse:collapse;font-size:12px;border:1px solid #999">
        <thead><tr>${headers.map(h => `<th style="padding:8px;background:${accent};color:${header};border:1px solid #999;font-weight:bold">${h}</th>`).join('')}</tr></thead>
        <tbody>${rows.map((r, i) => `<tr style="background:${i % 2 ? '#fafafa' : '#fff'}">${r.map(c => `<td style="padding:6px;border:1px solid #ccc">${c ?? '-'}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
      ${totalsHtml}
      <div style="margin-top:40px;display:flex;justify-content:space-between;font-size:13px">
        <div style="border-top:1px solid #333;padding-top:6px;min-width:180px;text-align:center">توقيع المسؤول</div>
        <div style="border-top:1px solid #333;padding-top:6px;min-width:180px;text-align:center">توقيع المدير</div>
      </div>
    </div>`;
  openPrintWindow(title, html);
};

// ===== Component =====
const Brooding = () => {
  const { roles, role } = useAuth();
  const userRoles = roles && roles.length > 0 ? roles : (role ? [role] : []);
  const canManage = userRoles.includes("general_manager") || userRoles.includes("executive_manager");

  const [batches, setBatches] = useState<Batch[]>([]);
  const [mortality, setMortality] = useState<Mortality[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [feed, setFeed] = useState<FeedIssue[]>([]);
  const [medicine, setMedicine] = useState<MedIssue[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [settings, setSettings] = useState<BroodingSettings>(DEFAULT_SETTINGS);
  const [feedInventory, setFeedInventory] = useState<FeedInventory[]>([]);
  const [feedStockMovements, setFeedStockMovements] = useState<FeedStockMovement[]>([]);
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { prices: marketPrices } = useMarketPrices();

  const loadAll = async () => {
    setLoading(true);
    const [b, m, e, f, md, s, t, st, fi, fsm, sn] = await Promise.all([
      supabase.from("brooding_batches").select("*").order("received_date", { ascending: false }),
      supabase.from("brooding_mortality").select("*").order("mortality_date", { ascending: false }),
      supabase.from("brooding_expenses").select("*").order("expense_date", { ascending: false }),
      supabase.from("brooding_feed_issuance").select("*").order("issue_date", { ascending: false }),
      supabase.from("brooding_medicine_issuance").select("*").order("issue_date", { ascending: false }),
      supabase.from("brooding_chick_sales").select("*").order("sale_date", { ascending: false }),
      supabase.from("brooding_to_slaughter_transfers").select("*").order("transfer_date", { ascending: false }),
      supabase.from("brooding_settings" as any).select("*").eq("id", true).maybeSingle(),
      supabase.from("brooding_feed_inventory" as any).select("*").order("feed_name"),
      supabase.from("brooding_feed_stock_movements" as any).select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("brooding_cost_snapshots" as any).select("*").order("snapshot_date", { ascending: false }),
    ]);
    setBatches((b.data as Batch[]) || []);
    setMortality((m.data as Mortality[]) || []);
    setExpenses((e.data as Expense[]) || []);
    setFeed((f.data as FeedIssue[]) || []);
    setMedicine((md.data as MedIssue[]) || []);
    setSales((s.data as Sale[]) || []);
    setTransfers((t.data as Transfer[]) || []);
    if (st.data) setSettings({ ...DEFAULT_SETTINGS, ...(st.data as any) });
    setFeedInventory(((fi.data as any) || []) as FeedInventory[]);
    setFeedStockMovements(((fsm.data as any) || []) as FeedStockMovement[]);
    setSnapshots(((sn.data as any) || []));
    setLoading(false);
  };

  useEffect(() => { loadAll(); }, []);

  // Auto-snapshot every 15 days for active batches (runs once after load)
  useEffect(() => {
    if (loading || !batches.length) return;
    const today = new Date().toISOString().slice(0, 10);
    (async () => {
      for (const b of batches) {
        if (b.status !== "active") continue;
        const last = snapshots.filter(s => s.batch_id === b.id).sort((a, c) => c.snapshot_date.localeCompare(a.snapshot_date))[0];
        const days = last ? Math.floor((Date.now() - new Date(last.snapshot_date).getTime()) / 86400000) : 9999;
        if (days >= 15) {
          await supabase.from("brooding_cost_snapshots" as any).insert({
            batch_id: b.id,
            snapshot_date: today,
            current_count: b.current_count,
            total_cost: b.total_cost,
            cost_per_bird: b.cost_per_bird,
            notes: `Snapshot تلقائي - العمر ${ageLabel(b)}`,
          });
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);


  // ===== KPIs =====
  const kpis = useMemo(() => {
    const totalBirds = batches.reduce((a, b) => a + b.current_count, 0);
    const openBatches = batches.filter(b => b.status === "active").length;
    const totalMortality = batches.reduce((a, b) => a + b.mortality_count, 0);
    const totalSold = batches.reduce((a, b) => a + b.sold_count, 0);
    const totalTransferred = batches.reduce((a, b) => a + b.transferred_count, 0);
    const totalOriginal = batches.reduce((a, b) => a + b.original_count, 0);
    const mortalityRate = totalOriginal > 0 ? (totalMortality / totalOriginal) * 100 : 0;
    const totalCost = batches.reduce((a, b) => a + Number(b.total_cost), 0);
    const avgCostPerBird = totalBirds > 0 ? totalCost / totalBirds : 0;
    // Current chicks value: per-batch (current_count × cost_per_bird) from DB.
    // total_cost stored in DB already includes opening + feed + medicine + expenses,
    // and cost_per_bird = total_cost / current_count (recomputed after every movement),
    // so mortality automatically redistributes the cost on the remaining live birds.
    const currentChicksValue = batches.reduce(
      (acc, b) => acc + b.current_count * Number(b.cost_per_bird),
      0,
    );
    const feedCost = feed.reduce((a, x) => a + Number(x.total_cost), 0);
    const medCost = medicine.reduce((a, x) => a + Number(x.total_cost), 0);
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 15);
    const last15 = [...expenses, ...feed.map(f => ({ expense_date: f.issue_date, total_amount: f.total_cost })), ...medicine.map(m => ({ expense_date: m.issue_date, total_amount: m.total_cost }))]
      .filter((x: any) => new Date(x.expense_date) >= cutoff)
      .reduce((a, x: any) => a + Number(x.total_amount), 0);
    const salesProfit = sales.reduce((a, x) => a + Number(x.profit), 0);
    const salesRevenue = sales.reduce((a, x) => a + Number(x.total_amount), 0);
    const transferredCost = transfers.reduce((a, x) => a + Number(x.transferred_cost), 0);
    const feedStockKg = feedInventory.reduce((a, x) => a + Number(x.current_kg), 0);
    const feedStockValue = feedInventory.reduce((a, x) => a + Number(x.current_kg) * Number(x.last_unit_cost), 0);
    return { totalBirds, openBatches, totalMortality, mortalityRate, totalSold, totalTransferred, totalCost, avgCostPerBird, feedCost, medCost, last15, salesProfit, salesRevenue, currentChicksValue, transferredCost, feedStockKg, feedStockValue };
  }, [batches, feed, medicine, expenses, sales, transfers, feedInventory, settings.default_chick_price]);

  const batchLabel = (id: string) => batches.find(b => b.id === id)?.batch_number || id.slice(0, 6);
  const feedNameById = (id: string | null) => feedInventory.find(f => f.id === id)?.feed_name || '-';

  // Auto-suggest next batch number BRD-XXX
  const nextBatchNumber = useMemo(() => {
    const nums = batches
      .map(b => /^BRD-(\d+)$/i.exec(b.batch_number)?.[1])
      .filter(Boolean)
      .map(s => parseInt(s as string, 10));
    const next = (nums.length ? Math.max(...nums) : 0) + 1;
    return `BRD-${String(next).padStart(3, "0")}`;
  }, [batches]);


  return (
    <DashboardLayout>
      <div className="p-6 space-y-6" dir="rtl">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-2xl bg-gradient-to-br from-primary to-orange-500 text-white">
              <Bird className="w-7 h-7" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">التحضين والتسمين</h1>
              <p className="text-muted-foreground">إدارة دفعات الكتاكيت من الاستلام حتى البيع أو المجزر</p>
            </div>
          </div>
          {canManage && (
            <NewBatchDialog onCreated={loadAll} nextBatchNumber={nextBatchNumber} settings={settings} prominent />
          )}
        </div>

        {!canManage && (
          <Card className="border-amber-300 bg-amber-50">
            <CardContent className="p-4 flex items-center gap-2 text-amber-800">
              <AlertTriangle className="w-5 h-5" />
              ليس لديك صلاحية الإدارة. العرض فقط محدود — تواصل مع المدير العام.
            </CardContent>
          </Card>
        )}

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPI label="الطيور الحالية" value={fmt(kpis.totalBirds)} icon={<Bird className="w-5 h-5" />} color="from-purple-500 to-purple-700" />
          <KPI label="قيمة الكتاكيت الحالية" value={fmtMoney(kpis.currentChicksValue)} icon={<Wallet className="w-5 h-5" />} color="from-emerald-600 to-emerald-800" />
          <KPI label="دفعات مفتوحة" value={fmt(kpis.openBatches)} icon={<Package className="w-5 h-5" />} color="from-orange-500 to-orange-700" />
          <KPI label="إجمالي النافق" value={fmt(kpis.totalMortality)} icon={<Skull className="w-5 h-5" />} color="from-red-500 to-red-700" />
          <KPI label="نسبة النفوق" value={`${kpis.mortalityRate.toFixed(1)}%`} icon={<AlertTriangle className="w-5 h-5" />} color="from-amber-500 to-amber-700" />
          <KPI label="مباع ككتاكيت" value={fmt(kpis.totalSold)} icon={<ShoppingCart className="w-5 h-5" />} color="from-emerald-500 to-emerald-700" />
          <KPI label="محوّل للمجزر" value={fmt(kpis.totalTransferred)} icon={<ArrowRightLeft className="w-5 h-5" />} color="from-indigo-500 to-indigo-700" />
          <KPI label="إجمالي التكلفة" value={fmtMoney(kpis.totalCost)} icon={<Wallet className="w-5 h-5" />} color="from-slate-600 to-slate-800" />
          <KPI label="متوسط تكلفة الطائر" value={fmtMoney(kpis.avgCostPerBird)} icon={<TrendingUp className="w-5 h-5" />} color="from-cyan-500 to-cyan-700" />
          <KPI label="رصيد علف الكتاكيت" value={`${fmt(kpis.feedStockKg)} كجم`} icon={<Wheat className="w-5 h-5" />} color="from-lime-600 to-lime-800" />
          <KPI label="قيمة رصيد العلف" value={fmtMoney(kpis.feedStockValue)} icon={<Wallet className="w-5 h-5" />} color="from-teal-600 to-teal-800" />
          <KPI label="مصروفات العلف" value={fmtMoney(kpis.feedCost)} icon={<Wheat className="w-5 h-5" />} color="from-yellow-600 to-yellow-800" />
          <KPI label="مصروفات الأدوية" value={fmtMoney(kpis.medCost)} icon={<Pill className="w-5 h-5" />} color="from-pink-500 to-pink-700" />
          <KPI label="مصروفات آخر 15 يوم" value={fmtMoney(kpis.last15)} icon={<Wallet className="w-5 h-5" />} color="from-fuchsia-500 to-fuchsia-700" />
          <KPI label="أرباح البيع" value={fmtMoney(kpis.salesProfit)} icon={<TrendingUp className="w-5 h-5" />} color="from-green-500 to-green-700" />
          <KPI label="تكلفة المحوّل للمجزر" value={fmtMoney(kpis.transferredCost)} icon={<ArrowRightLeft className="w-5 h-5" />} color="from-indigo-600 to-indigo-800" />
        </div>

        <Tabs defaultValue="batches" className="space-y-4">
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="batches">الدفعات</TabsTrigger>
            <TabsTrigger value="mortality">النافق</TabsTrigger>
            <TabsTrigger value="expenses">المصروفات</TabsTrigger>
            <TabsTrigger value="feed">صرف علف</TabsTrigger>
            <TabsTrigger value="medicine">صرف أدوية</TabsTrigger>
            <TabsTrigger value="sales">بيع كتاكيت</TabsTrigger>
            <TabsTrigger value="transfers">التحويل للمجزر</TabsTrigger>
            <TabsTrigger value="feedstock">مخزون العلف</TabsTrigger>
            <TabsTrigger value="recipes">تركيبة علف التسمين</TabsTrigger>
            {canManage && <TabsTrigger value="settings">الإعدادات</TabsTrigger>}
          </TabsList>


          {/* BATCHES */}
          <TabsContent value="batches">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>الدفعات</CardTitle>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => exportXlsx(batches, "brooding_batches")}><FileSpreadsheet className="w-4 h-4 ml-1" />Excel</Button>
                  <Button variant="outline" size="sm" onClick={() => printTable("تقرير الدفعات", ["رقم", "تاريخ الاستلام", "العمر", "الأصلي", "الحالي", "نافق", "مباع", "محوّل", "تكلفة", "تكلفة الطائر", "الحالة"],
                    batches.map(b => [b.batch_number, b.received_date, ageLabel(b), b.original_count, b.current_count, b.mortality_count, b.sold_count, b.transferred_count, fmtMoney(Number(b.total_cost)), fmtMoney(Number(b.cost_per_bird)), b.status]))}><Printer className="w-4 h-4 ml-1" />طباعة</Button>
                  {canManage && <NewBatchDialog onCreated={loadAll} nextBatchNumber={nextBatchNumber} settings={settings} />}
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>رقم الدفعة</TableHead>
                      <TableHead>تاريخ الاستلام</TableHead>
                      <TableHead>العمر</TableHead>
                      <TableHead>الأصلي</TableHead>
                      <TableHead>الحالي</TableHead>
                      <TableHead>نافق</TableHead>
                      <TableHead>مباع</TableHead>
                      <TableHead>محوّل</TableHead>
                      <TableHead>التكلفة</TableHead>
                      <TableHead>ت. الطائر</TableHead>
                      <TableHead>الحالة</TableHead>
                      {canManage && <TableHead>حركة</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {batches.map(b => (
                      <TableRow key={b.id}>
                        <TableCell className="font-semibold">{b.batch_number}</TableCell>
                        <TableCell>{b.received_date}</TableCell>
                        <TableCell>{ageLabel(b)}</TableCell>
                        <TableCell>{b.original_count}</TableCell>
                        <TableCell className="font-bold text-primary">{b.current_count}</TableCell>
                        <TableCell className="text-red-600">{b.mortality_count}</TableCell>
                        <TableCell>{b.sold_count}</TableCell>
                        <TableCell>{b.transferred_count}</TableCell>
                        <TableCell>{fmtMoney(Number(b.total_cost))}</TableCell>
                        <TableCell>{fmtMoney(Number(b.cost_per_bird))}</TableCell>
                        <TableCell><Badge variant={b.status === "active" ? "default" : "secondary"}>{b.status}</Badge></TableCell>
                        {canManage && (
                          <TableCell>
                            <BatchActionsMenu batch={b} batches={batches} feedInventory={feedInventory} settings={settings} canManage={canManage} onReload={loadAll} />
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                    {batches.length === 0 && !loading && (
                      <TableRow><TableCell colSpan={12} className="text-center text-muted-foreground">لا توجد دفعات</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* COST BREAKDOWN PER BATCH */}
            <Card className="mt-4">
              <CardHeader>
                <CardTitle>تفاصيل تكلفة كل دفعة (ديناميكية حسب العمر)</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الدفعة</TableHead>
                      <TableHead>العمر الحالي</TableHead>
                      <TableHead>الحالي</TableHead>
                      <TableHead>ت. الكتكوت عند الدخول</TableHead>
                      <TableHead>تكلفة افتتاحية</TableHead>
                      <TableHead>علف</TableHead>
                      <TableHead>أدوية</TableHead>
                      <TableHead>مصروفات</TableHead>
                      <TableHead className="font-bold">إجمالي التكلفة</TableHead>
                      <TableHead className="font-bold">ت. الطائر الحالية</TableHead>
                      <TableHead>سعر علف اليوم</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {batches.map(b => {
                      const feedSum = feed.filter((x: any) => x.batch_id === b.id).reduce((a, x: any) => a + Number(x.total_cost), 0);
                      const medSum = medicine.filter((x: any) => x.batch_id === b.id).reduce((a, x: any) => a + Number(x.total_cost), 0);
                      const expSum = expenses.filter((x: any) => x.batch_id === b.id).reduce((a, x: any) => a + Number(x.total_amount), 0);
                      const total = Number(b.total_cost);
                      const opening = Math.max(total - feedSum - medSum - expSum, 0);
                      const openingPerBird = b.original_count > 0 ? opening / b.original_count : 0;
                      const todayFeedPrice = feedCostForBatch(b, settings);
                      return (
                        <TableRow key={b.id}>
                          <TableCell className="font-semibold">{b.batch_number}</TableCell>
                          <TableCell className="text-amber-700 font-semibold">{ageLabel(b)}</TableCell>
                          <TableCell className="font-bold text-primary">{b.current_count}</TableCell>
                          <TableCell>{fmtMoney(openingPerBird)}</TableCell>
                          <TableCell>{fmtMoney(opening)}</TableCell>
                          <TableCell>{fmtMoney(feedSum)}</TableCell>
                          <TableCell>{fmtMoney(medSum)}</TableCell>
                          <TableCell>{fmtMoney(expSum)}</TableCell>
                          <TableCell className="font-bold">{fmtMoney(total)}</TableCell>
                          <TableCell className="font-bold text-emerald-700">{fmtMoney(Number(b.cost_per_bird))}</TableCell>
                          <TableCell className="text-muted-foreground">{fmtMoney(todayFeedPrice)} / كجم</TableCell>
                        </TableRow>
                      );
                    })}
                    {batches.length === 0 && (
                      <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground">لا توجد دفعات</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* 15-DAY COST SNAPSHOTS PER BATCH */}
            <Card className="mt-4">
              <CardHeader>
                <CardTitle>تطور التكلفة (Snapshots كل 15 يوم)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {batches.map(b => {
                  const list = snapshots.filter(s => s.batch_id === b.id).sort((a, c) => a.snapshot_date.localeCompare(c.snapshot_date));
                  if (!list.length) return (
                    <div key={b.id} className="text-sm text-muted-foreground">
                      <strong>{b.batch_number}</strong> — لا توجد snapshots بعد. سيتم إنشاء snapshot تلقائيًا.
                    </div>
                  );
                  return (
                    <div key={b.id}>
                      <div className="font-semibold mb-2">{b.batch_number} — العمر الحالي: {ageLabel(b)}</div>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>التاريخ</TableHead>
                            <TableHead>العمر</TableHead>
                            <TableHead>العدد</TableHead>
                            <TableHead>إجمالي التكلفة</TableHead>
                            <TableHead>ت. الطائر</TableHead>
                            <TableHead>الفرق عن السابق</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {list.map((s, i) => {
                            const prev = i > 0 ? list[i - 1] : null;
                            const diff = prev ? Number(s.cost_per_bird) - Number(prev.cost_per_bird) : 0;
                            return (
                              <TableRow key={s.id}>
                                <TableCell>{s.snapshot_date}</TableCell>
                                <TableCell>{ageOnDateDays(b, s.snapshot_date)} يوم</TableCell>
                                <TableCell>{s.current_count}</TableCell>
                                <TableCell>{fmtMoney(Number(s.total_cost))}</TableCell>
                                <TableCell className="font-semibold">{fmtMoney(Number(s.cost_per_bird))}</TableCell>
                                <TableCell className={diff > 0 ? "text-red-600" : diff < 0 ? "text-emerald-600" : "text-muted-foreground"}>
                                  {prev ? (diff >= 0 ? "+" : "") + fmtMoney(diff) : "—"}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  );
                })}
                {batches.length === 0 && (
                  <div className="text-center text-muted-foreground">لا توجد دفعات</div>
                )}
              </CardContent>
            </Card>
          </TabsContent>



          {/* MORTALITY */}
          <TabsContent value="mortality">
            <MovementCard
              title="تسجيل النافق"
              data={mortality}
              canManage={canManage}
              batches={batches}
              onReload={loadAll}
              exportName="brooding_mortality"
              columns={[
                { key: "mortality_date", label: "التاريخ" },
                { key: "batch_id", label: "الدفعة", render: (v: string) => batchLabel(v) },
                { key: "count", label: "العدد", className: "text-red-600 font-bold" },
                { key: "reason", label: "السبب" },
                { key: "notes", label: "ملاحظات" },
              ]}
              form={(b, close) => <MortalityForm batches={batches} onDone={() => { close(); loadAll(); }} />}
              addLabel="تسجيل نافق"
            />
          </TabsContent>

          {/* EXPENSES */}
          <TabsContent value="expenses">
            <MovementCard
              title="مصروفات دورة التسمين"
              data={expenses}
              canManage={canManage}
              batches={batches}
              onReload={loadAll}
              exportName="brooding_expenses"
              columns={[
                { key: "expense_date", label: "التاريخ" },
                { key: "batch_id", label: "الدفعة", render: (v: string) => batchLabel(v) },
                { key: "expense_type", label: "النوع", render: (v: string) => EXPENSE_TYPES.find(t => t.value === v)?.label || v },
                { key: "item_name", label: "الصنف" },
                { key: "quantity", label: "الكمية" },
                { key: "unit_price", label: "سعر الوحدة", render: (v: number) => v ? fmtMoney(v) : "-" },
                { key: "total_amount", label: "الإجمالي", render: (v: number) => fmtMoney(v), className: "font-bold" },
                { key: "treasury", label: "الخزنة" },
              ]}
              form={(b, close) => <ExpenseForm batches={batches} onDone={() => { close(); loadAll(); }} />}
              addLabel="إضافة مصروف"
            />
          </TabsContent>

          {/* FEED */}
          <TabsContent value="feed">
            <MovementCard
              title="صرف علف للدفعات"
              data={feed}
              canManage={canManage}
              batches={batches}
              onReload={loadAll}
              exportName="brooding_feed"
              columns={[
                { key: "issue_date", label: "التاريخ" },
                { key: "batch_id", label: "الدفعة", render: (v: string) => batchLabel(v) },
                { key: "feed_name", label: "نوع العلف" },
                { key: "quantity_kg", label: "الكمية (كجم)" },
                { key: "unit_cost", label: "سعر الكيلو", render: (v: number) => fmtMoney(v) },
                { key: "total_cost", label: "الإجمالي", render: (v: number) => fmtMoney(v), className: "font-bold" },
              ]}
              form={(b, close) => <FeedForm batches={batches} feedInventory={feedInventory} settings={settings} canOverride={canManage} onDone={() => { close(); loadAll(); }} />}
              addLabel="صرف علف"
            />
          </TabsContent>

          {/* MEDICINE */}
          <TabsContent value="medicine">
            <MovementCard
              title="صرف أدوية للدفعات"
              data={medicine}
              canManage={canManage}
              batches={batches}
              onReload={loadAll}
              exportName="brooding_medicine"
              columns={[
                { key: "issue_date", label: "التاريخ" },
                { key: "batch_id", label: "الدفعة", render: (v: string) => batchLabel(v) },
                { key: "medicine_name", label: "الدواء" },
                { key: "quantity", label: "الكمية" },
                { key: "unit", label: "الوحدة" },
                { key: "unit_cost", label: "سعر الوحدة", render: (v: number) => fmtMoney(v) },
                { key: "total_cost", label: "الإجمالي", render: (v: number) => fmtMoney(v), className: "font-bold" },
              ]}
              form={(b, close) => <MedicineForm batches={batches} onDone={() => { close(); loadAll(); }} />}
              addLabel="صرف دواء"
            />
          </TabsContent>

          {/* SALES */}
          <TabsContent value="sales">
            <MovementCard
              title="بيع كتاكيت"
              data={sales}
              canManage={canManage}
              batches={batches}
              onReload={loadAll}
              exportName="brooding_sales"
              columns={[
                { key: "sale_date", label: "التاريخ" },
                { key: "batch_id", label: "الدفعة", render: (v: string) => batchLabel(v) },
                { key: "customer_name", label: "العميل" },
                { key: "count", label: "العدد" },
                { key: "unit_price", label: "سعر الكتكوت", render: (v: number) => fmtMoney(v) },
                { key: "total_amount", label: "الإجمالي", render: (v: number) => fmtMoney(v), className: "font-bold" },
                { key: "cost_at_sale", label: "تكلفة البيع", render: (v: number) => fmtMoney(v) },
                { key: "profit", label: "الربح", render: (v: number) => fmtMoney(v), className: "font-bold text-green-600" },
                { key: "payment_method", label: "الدفع" },
                { key: "treasury", label: "الخزنة" },
              ]}
              form={(b, close) => <SaleForm batches={batches} onDone={() => { close(); loadAll(); }} />}
              addLabel="فاتورة بيع"
            />
          </TabsContent>

          {/* TRANSFERS */}
          <TabsContent value="transfers">
            <MovementCard
              title="التحويل للمجزر"
              data={transfers}
              canManage={canManage}
              batches={batches}
              onReload={loadAll}
              exportName="brooding_transfers"
              columns={[
                { key: "transfer_date", label: "التاريخ" },
                { key: "batch_id", label: "الدفعة", render: (v: string) => batchLabel(v) },
                { key: "count", label: "العدد" },
                { key: "avg_weight_kg", label: "متوسط الوزن (كجم)" },
                { key: "total_weight_kg", label: "إجمالي الوزن (كجم)" },
                { key: "transferred_cost", label: "التكلفة المنقولة", render: (v: number) => fmtMoney(v), className: "font-bold" },
              ]}
              form={(b, close) => <TransferForm batches={batches} onDone={() => { close(); loadAll(); }} />}
              addLabel="تحويل للمجزر"
            />
          </TabsContent>

          {/* FEED STOCK */}
          <TabsContent value="feedstock">
            <FeedStockTab inventory={feedInventory} movements={feedStockMovements} batches={batches} canManage={canManage} settings={settings} onReload={loadAll} />
          </TabsContent>

          {/* FEED RECIPES */}
          <TabsContent value="recipes">
            <RecipesTab canManage={canManage} />
          </TabsContent>

          {/* SETTINGS */}
          {canManage && (
            <TabsContent value="settings">
              <SettingsTab settings={settings} onSaved={loadAll} />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </DashboardLayout>
  );
};

// ===== Small components =====
const KPI = ({ label, value, icon, color }: any) => (
  <Card className="overflow-hidden">
    <CardContent className="p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-xl font-bold mt-1">{value}</div>
        </div>
        <div className={`p-2 rounded-lg bg-gradient-to-br ${color} text-white`}>{icon}</div>
      </div>
    </CardContent>
  </Card>
);

const MovementCard = ({ title, data, canManage, onReload, exportName, columns, form, addLabel }: any) => {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{title}</CardTitle>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => exportXlsx(data, exportName)}><FileSpreadsheet className="w-4 h-4 ml-1" />Excel</Button>
          <Button variant="outline" size="sm" onClick={() => printTable(title, columns.map((c: any) => c.label), data.map((r: any) => columns.map((c: any) => c.render ? c.render(r[c.key]) : (r[c.key] ?? "-"))))}><Printer className="w-4 h-4 ml-1" />طباعة</Button>
          {canManage && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="bg-primary"><Plus className="w-4 h-4 ml-1" />{addLabel}</Button>
              </DialogTrigger>
              <DialogContent dir="rtl" className="max-w-lg">
                <DialogHeader><DialogTitle>{addLabel}</DialogTitle></DialogHeader>
                {form(null, () => setOpen(false))}
              </DialogContent>
            </Dialog>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow>{columns.map((c: any) => <TableHead key={c.key}>{c.label}</TableHead>)}</TableRow></TableHeader>
          <TableBody>
            {data.map((r: any) => (
              <TableRow key={r.id}>
                {columns.map((c: any) => (
                  <TableCell key={c.key} className={c.className}>{c.render ? c.render(r[c.key]) : (r[c.key] ?? "-")}</TableCell>
                ))}
              </TableRow>
            ))}
            {data.length === 0 && <TableRow><TableCell colSpan={columns.length} className="text-center text-muted-foreground">لا توجد بيانات</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
};

// ===== Forms =====
const SOURCES = [
  { value: "hatchery", label: "معمل التفريخ" },
  { value: "opening", label: "إدخال يدوي / رصيد افتتاحي" },
  { value: "external", label: "شراء خارجي" },
];
const AGE_PRESETS = [
  { label: "يوم", days: 1 },
  { label: "أسبوع", days: 7 },
  { label: "شهر", days: 30 },
  { label: "شهر ونص", days: 45 },
  { label: "شهرين", days: 60 },
];

const NewBatchDialog = ({ onCreated, nextBatchNumber, settings, prominent = false }: { onCreated: () => void; nextBatchNumber: string; settings: BroodingSettings; prominent?: boolean }) => {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [autoPrice, setAutoPrice] = useState(true);
  const initial = () => ({
    batch_number: nextBatchNumber,
    received_date: new Date().toISOString().slice(0, 10),
    source: "hatchery" as "hatchery" | "opening" | "external",
    age_at_receipt_days: 7,
    original_count: 0,
    opening_cost: 0,
    treasury: "",
    payment_method: "cash" as "cash" | "credit",
    status: "active" as "active" | "completed" | "transferred" | "closed",
    notes: "",
  });
  const [f, setF] = useState(initial);

  useEffect(() => { if (open) { setF(initial()); setAutoPrice(true); } /* eslint-disable-next-line */ }, [open, nextBatchNumber]);

  // Auto-fill cost from hatchery default price when source = hatchery
  useEffect(() => {
    if (f.source === "hatchery" && autoPrice) {
      setF(p => ({ ...p, opening_cost: p.original_count * settings.default_chick_price }));
    }
    // eslint-disable-next-line
  }, [f.source, f.original_count, autoPrice, settings.default_chick_price]);


  const submit = async () => {
    if (!f.batch_number.trim()) { toast.error("أدخل رقم الدفعة"); return; }
    if (f.original_count <= 0) { toast.error("عدد الكتاكيت يجب أن يكون أكبر من صفر"); return; }
    if (f.opening_cost < 0) { toast.error("التكلفة لا يمكن أن تكون سالبة"); return; }
    setSaving(true);
    const sourceLabel = SOURCES.find(s => s.value === f.source)?.label || "معمل التفريخ";
    const payload = {
      batch_number: f.batch_number.trim(),
      received_date: f.received_date,
      source: sourceLabel,
      age_at_receipt_days: f.age_at_receipt_days,
      original_count: f.original_count,
      current_count: f.original_count,
      total_cost: f.opening_cost || 0,
      cost_per_bird: f.original_count > 0 ? (f.opening_cost || 0) / f.original_count : 0,
      status: f.status,
      notes: f.notes || null,
    };
    const { data: inserted, error } = await supabase.from("brooding_batches").insert(payload).select("id").single();
    setSaving(false);
    if (error) {
      if ((error as any).code === "23505") toast.error("رقم الدفعة موجود مسبقًا");
      else toast.error(error.message);
      return;
    }
    const batchId = inserted?.id;
    // Opening movement (cost_delta is the single source of truth for opening cost;
    // do NOT also insert a brooding_expense row or the trigger will double-count.)
    if (batchId) {
      const treasuryNote =
        f.source === "external" && f.payment_method === "cash" && (f.opening_cost || 0) > 0 && f.treasury
          ? ` — نقدي من خزنة: ${f.treasury}`
          : "";
      await supabase.from("brooding_batch_movements").insert({
        batch_id: batchId,
        movement_type: "opening",
        count_delta: f.original_count,
        cost_delta: f.opening_cost || 0,
        description: `إضافة دفعة كتاكيت جديدة — ${sourceLabel}${treasuryNote}`,
      });
    }
    toast.success("تم إنشاء الدفعة بنجاح");
    setOpen(false);
    onCreated();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size={prominent ? "lg" : "sm"} className="bg-gradient-to-r from-primary to-orange-500 text-white shadow-md hover:opacity-95">
          <Plus className="w-4 h-4 ml-1" />إضافة دفعة جديدة
        </Button>
      </DialogTrigger>
      <DialogContent dir="rtl" className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>دفعة كتاكيت جديدة</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div><Label>رقم الدفعة</Label><Input value={f.batch_number} onChange={e => setF({ ...f, batch_number: e.target.value })} placeholder="BRD-003" /></div>
            <div><Label>تاريخ الاستلام</Label><Input type="date" value={f.received_date} onChange={e => setF({ ...f, received_date: e.target.value })} /></div>
          </div>

          <div><Label>مصدر الدفعة</Label>
            <Select value={f.source} onValueChange={(v: any) => setF({ ...f, source: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{SOURCES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          <div>
            <Label>العمر عند الاستلام</Label>
            <div className="flex flex-wrap gap-1 mt-1">
              {AGE_PRESETS.map(a => (
                <Button key={a.days} type="button" size="sm" variant={f.age_at_receipt_days === a.days ? "default" : "outline"} onClick={() => setF({ ...f, age_at_receipt_days: a.days })}>{a.label}</Button>
              ))}
            </div>
            <Input className="mt-2" type="number" min={0} value={f.age_at_receipt_days} onChange={e => setF({ ...f, age_at_receipt_days: +e.target.value })} placeholder="أو إدخال العمر بالأيام" />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div><Label>عدد الكتاكيت</Label><Input type="number" min={1} value={f.original_count || ""} onChange={e => setF({ ...f, original_count: +e.target.value })} /></div>
            <div><Label>الحالة</Label>
              <Select value={f.status} onValueChange={(v: any) => setF({ ...f, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">تحت التحضين / التسمين</SelectItem>
                  <SelectItem value="completed">مكتملة</SelectItem>
                  <SelectItem value="transferred">محوّلة للمجزر</SelectItem>
                  <SelectItem value="closed">مغلقة</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>التكلفة الافتتاحية {f.source === "hatchery" && autoPrice && <span className="text-xs text-emerald-600">(محسوبة تلقائيًا)</span>}</Label>
              <Input type="number" min={0} value={f.opening_cost || ""} onChange={e => { setAutoPrice(false); setF({ ...f, opening_cost: +e.target.value }); }} />
            </div>
            <div><Label>تكلفة الطائر (محسوبة)</Label><Input readOnly value={f.original_count > 0 ? ((f.opening_cost || 0) / f.original_count).toFixed(2) : "0"} /></div>
          </div>
          {f.source === "hatchery" && (
            <div className="text-xs text-muted-foreground p-2 rounded bg-emerald-50 border border-emerald-200">
              💡 سعر الكتكوت من معمل {settings.company_name} = <strong>{fmtMoney(settings.default_chick_price)}</strong> / كتكوت. لا يتم خصم خزنة (دفعة داخلية).
            </div>
          )}

          {f.source === "external" && (
            <div className="grid grid-cols-2 gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200">
              <div><Label>طريقة الدفع</Label>
                <Select value={f.payment_method} onValueChange={(v: any) => setF({ ...f, payment_method: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">نقدي (يخصم من الخزنة)</SelectItem>
                    <SelectItem value="credit">آجل</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>الخزنة</Label><Input value={f.treasury} onChange={e => setF({ ...f, treasury: e.target.value })} placeholder="اسم الخزنة" /></div>
            </div>
          )}

          <div><Label>ملاحظات</Label><Textarea value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "جاري الحفظ..." : "حفظ الدفعة"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const BATCH_ACTIONS = [
  { key: "mortality", label: "تسجيل نافق", icon: Skull },
  { key: "feed", label: "صرف علف", icon: Wheat },
  { key: "medicine", label: "صرف دواء", icon: Pill },
  { key: "expense", label: "إضافة مصروف", icon: Wallet },
  { key: "sale", label: "بيع كتاكيت", icon: ShoppingCart },
  { key: "transfer", label: "تحويل للمجزر", icon: ArrowRightLeft },
] as const;

const BatchActionsMenu = ({ batch, batches, feedInventory, settings, canManage, onReload }: { batch: Batch; batches: Batch[]; feedInventory: FeedInventory[]; settings: BroodingSettings; canManage: boolean; onReload: () => void }) => {
  const [action, setAction] = useState<string | null>(null);
  const close = () => { setAction(null); onReload(); };
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline"><MoreVertical className="w-4 h-4 ml-1" />حركة</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>{batch.batch_number}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {BATCH_ACTIONS.map(a => (
            <DropdownMenuItem key={a.key} onClick={() => setAction(a.key)}>
              <a.icon className="w-4 h-4 ml-2" />{a.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={!!action} onOpenChange={(v) => !v && setAction(null)}>
        <DialogContent dir="rtl" className="max-w-lg">
          <DialogHeader><DialogTitle>{BATCH_ACTIONS.find(a => a.key === action)?.label} — {batch.batch_number}</DialogTitle></DialogHeader>
          {action === "mortality" && <MortalityForm batches={batches} defaultBatchId={batch.id} onDone={close} />}
          {action === "feed" && <FeedForm batches={batches} feedInventory={feedInventory} settings={settings} canOverride={canManage} defaultBatchId={batch.id} onDone={close} />}
          {action === "medicine" && <MedicineForm batches={batches} defaultBatchId={batch.id} onDone={close} />}
          {action === "expense" && <ExpenseForm batches={batches} defaultBatchId={batch.id} onDone={close} />}
          {action === "sale" && <SaleForm batches={batches} defaultBatchId={batch.id} onDone={close} />}
          {action === "transfer" && <TransferForm batches={batches} defaultBatchId={batch.id} onDone={close} />}
        </DialogContent>
      </Dialog>
    </>
  );
};

const BatchSelect = ({ value, onChange, batches }: any) => (
  <Select value={value} onValueChange={onChange}>
    <SelectTrigger><SelectValue placeholder="اختر الدفعة" /></SelectTrigger>
    <SelectContent>{batches.filter((b: Batch) => b.current_count > 0).map((b: Batch) => <SelectItem key={b.id} value={b.id}>{b.batch_number} — متاح {b.current_count}</SelectItem>)}</SelectContent>
  </Select>
);

const MORTALITY_REASONS = [
  "مرض",
  "ضعف عام",
  "خنق / حوادث",
  "ارتفاع/انخفاض حرارة",
  "أخرى (اذكر التفاصيل في الملاحظات)",
];

const MortalityForm = ({ batches, onDone, defaultBatchId }: any) => {
  const [f, setF] = useState({ batch_id: defaultBatchId || "", mortality_date: new Date().toISOString().slice(0, 10), count: 1, reason: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const batch = batches.find((b: Batch) => b.id === f.batch_id);
  const submit = async () => {
    if (!f.batch_id) { toast.error("اختر الدفعة"); return; }
    const reason = (f.reason || "").trim();
    if (reason.length < 3) { toast.error("يجب كتابة سبب النافق قبل الحفظ"); return; }
    if (batch && f.count > batch.current_count) {
      toast.error(`لا يمكن تسجيل ${f.count} نافق — العدد الحالي بالدفعة ${batch.current_count} فقط`);
      return;
    }
    if (f.count <= 0) { toast.error("العدد يجب أن يكون أكبر من صفر"); return; }
    setSaving(true);
    const { error } = await supabase.from("brooding_mortality").insert({ ...f, reason });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("تم تسجيل النافق"); onDone();
  };
  return (<div className="space-y-3">
    <div><Label>الدفعة</Label><BatchSelect value={f.batch_id} onChange={(v: string) => setF({ ...f, batch_id: v })} batches={batches} /></div>
    <div><Label>التاريخ</Label><Input type="date" value={f.mortality_date} onChange={e => setF({ ...f, mortality_date: e.target.value })} /></div>
    <div>
      <Label>العدد النافق {batch && <span className="text-xs text-muted-foreground">(الحد الأقصى: {batch.current_count})</span>}</Label>
      <Input type="number" min={1} max={batch?.current_count || undefined} value={f.count} onChange={e => setF({ ...f, count: +e.target.value })} />
    </div>
    <div>
      <Label className="text-red-600">السبب * (إجباري)</Label>
      <Select value={MORTALITY_REASONS.includes(f.reason) ? f.reason : ""} onValueChange={v => setF({ ...f, reason: v })}>
        <SelectTrigger><SelectValue placeholder="اختر سببًا أو اكتب يدويًا بالأسفل" /></SelectTrigger>
        <SelectContent>{MORTALITY_REASONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
      </Select>
      <Input className="mt-1" value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} placeholder="أو اكتب السبب يدويًا" />
      {(!f.reason || f.reason.trim().length < 3) && (
        <p className="text-xs text-red-600 mt-1">⚠️ لا يتم حفظ النافق إلا بعد كتابة سبب واضح</p>
      )}
    </div>
    <div><Label>ملاحظات</Label><Textarea value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></div>
    <Button onClick={submit} disabled={saving || !f.reason || f.reason.trim().length < 3} className="w-full">{saving ? "..." : "حفظ"}</Button>
  </div>);
};

const ExpenseForm = ({ batches, onDone, defaultBatchId }: any) => {
  const [f, setF] = useState({ batch_id: defaultBatchId || "", expense_date: new Date().toISOString().slice(0, 10), expense_type: "feed", item_name: "", quantity: 0, unit_price: 0, total_amount: 0, treasury: "", notes: "" });
  useEffect(() => { if (f.quantity && f.unit_price) setF(p => ({ ...p, total_amount: p.quantity * p.unit_price })); }, [f.quantity, f.unit_price]);
  const submit = async () => {
    if (!f.batch_id || f.total_amount <= 0) { toast.error("أكمل البيانات"); return; }
    const { error } = await supabase.from("brooding_expenses").insert(f as any);
    if (error) { toast.error(error.message); return; }
    toast.success("تم تسجيل المصروف"); onDone();
  };
  return (<div className="space-y-3">
    <div><Label>الدفعة</Label><BatchSelect value={f.batch_id} onChange={(v: string) => setF({ ...f, batch_id: v })} batches={batches} /></div>
    <div className="grid grid-cols-2 gap-2">
      <div><Label>التاريخ</Label><Input type="date" value={f.expense_date} onChange={e => setF({ ...f, expense_date: e.target.value })} /></div>
      <div><Label>النوع</Label>
        <Select value={f.expense_type} onValueChange={v => setF({ ...f, expense_type: v })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{EXPENSE_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>
    </div>
    <div><Label>الصنف</Label><Input value={f.item_name} onChange={e => setF({ ...f, item_name: e.target.value })} /></div>
    <div className="grid grid-cols-3 gap-2">
      <div><Label>الكمية</Label><Input type="number" value={f.quantity} onChange={e => setF({ ...f, quantity: +e.target.value })} /></div>
      <div><Label>سعر الوحدة</Label><Input type="number" value={f.unit_price} onChange={e => setF({ ...f, unit_price: +e.target.value })} /></div>
      <div><Label>الإجمالي</Label><Input type="number" value={f.total_amount} onChange={e => setF({ ...f, total_amount: +e.target.value })} /></div>
    </div>
    <div><Label>الخزنة / مصدر الصرف</Label><Input value={f.treasury} onChange={e => setF({ ...f, treasury: e.target.value })} /></div>
    <div><Label>ملاحظات</Label><Textarea value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></div>
    <Button onClick={submit} className="w-full">حفظ</Button>
  </div>);
};

const FeedForm = ({ batches, feedInventory = [], settings = DEFAULT_SETTINGS, canOverride = false, onDone, defaultBatchId }: { batches: Batch[]; feedInventory?: FeedInventory[]; settings?: BroodingSettings; canOverride?: boolean; onDone: () => void; defaultBatchId?: string }) => {
  const defaultFeed = feedInventory[0]?.feed_name || "علف كتاكيت نعام";
  const [f, setF] = useState({ batch_id: defaultBatchId || "", issue_date: new Date().toISOString().slice(0, 10), feed_name: defaultFeed, quantity_kg: 0, unit_cost: 0, total_cost: 0, notes: "" });
  const [override, setOverride] = useState(false);
  const batch = batches.find(b => b.id === f.batch_id);
  const recommendedUnitCost = feedCostForBatch(batch, settings);
  const inv = feedInventory.find(x => x.feed_name === f.feed_name);

  // Auto-fill unit_cost from settings when not overriding
  useEffect(() => {
    if (!override) setF(p => ({ ...p, unit_cost: recommendedUnitCost }));
    // eslint-disable-next-line
  }, [recommendedUnitCost, override, f.batch_id]);

  useEffect(() => { setF(p => ({ ...p, total_cost: +(p.quantity_kg * p.unit_cost).toFixed(3) })); }, [f.quantity_kg, f.unit_cost]);

  const printPermit = (saved: typeof f, user: string) => {
    const html = `
      <div style="font-family:'Cairo',sans-serif;direction:rtl">
        <div style="border-bottom:3px solid ${settings.print_header_color};padding-bottom:10px;margin-bottom:15px">
          <h1 style="margin:0;text-align:center;color:${settings.print_header_color};font-size:26px">${settings.company_name}</h1>
          <h2 style="margin:4px 0 0;text-align:center;color:#555;font-size:16px;font-weight:normal">القسم: التحضين والتسمين — نوع الحركة: <strong>صرف علف</strong></h2>
        </div>
        <h3 style="text-align:center;color:${settings.print_header_color};margin:0 0 12px">إذن صرف علف رقم ${Date.now().toString().slice(-6)}</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #999">
          <tr><th style="padding:8px;background:${settings.print_accent_color};border:1px solid #999;text-align:right">رقم الدفعة</th><td style="padding:8px;border:1px solid #ccc">${batch?.batch_number || '-'}</td>
              <th style="padding:8px;background:${settings.print_accent_color};border:1px solid #999;text-align:right">تاريخ الصرف</th><td style="padding:8px;border:1px solid #ccc">${saved.issue_date}</td></tr>
          <tr><th style="padding:8px;background:${settings.print_accent_color};border:1px solid #999;text-align:right">نوع العلف</th><td style="padding:8px;border:1px solid #ccc">${saved.feed_name}</td>
              <th style="padding:8px;background:${settings.print_accent_color};border:1px solid #999;text-align:right">الكمية</th><td style="padding:8px;border:1px solid #ccc"><strong>${saved.quantity_kg} كجم</strong></td></tr>
          <tr><th style="padding:8px;background:${settings.print_accent_color};border:1px solid #999;text-align:right">سعر الكيلو (تكلفة)</th><td style="padding:8px;border:1px solid #ccc">${saved.unit_cost} ج.م</td>
              <th style="padding:8px;background:${settings.print_accent_color};border:1px solid #999;text-align:right">إجمالي التكلفة</th><td style="padding:8px;border:1px solid #ccc;font-weight:bold;color:${settings.print_header_color}">${saved.total_cost} ج.م</td></tr>
          <tr><th style="padding:8px;background:${settings.print_accent_color};border:1px solid #999;text-align:right">المستخدم</th><td colspan="3" style="padding:8px;border:1px solid #ccc">${user}</td></tr>
          ${saved.notes ? `<tr><th style="padding:8px;background:${settings.print_accent_color};border:1px solid #999;text-align:right">ملاحظات</th><td colspan="3" style="padding:8px;border:1px solid #ccc">${saved.notes}</td></tr>` : ''}
        </table>
        <div style="margin-top:50px;display:flex;justify-content:space-between;gap:20px;font-size:13px">
          <div style="border-top:2px solid #333;padding-top:8px;flex:1;text-align:center">توقيع مسؤول التحضين<br/><span style="color:#888;font-size:11px">................................</span></div>
          <div style="border-top:2px solid #333;padding-top:8px;flex:1;text-align:center">توقيع مسؤول مصنع الأعلاف<br/><span style="color:#888;font-size:11px">................................</span></div>
        </div>
        <p style="margin-top:20px;text-align:center;font-size:11px;color:#888">⚠️ تم إرسال إشعار تلقائي لمسؤول مصنع الأعلاف بهذه الحركة</p>
      </div>`;
    openPrintWindow("إذن صرف علف", html);
  };

  const { profile } = useAuth();
  const [lastSaved, setLastSaved] = useState<typeof f | null>(null);

  const submit = async () => {
    if (!f.batch_id || !f.feed_name || f.quantity_kg <= 0) { toast.error("أكمل البيانات"); return; }
    if (inv && f.quantity_kg > Number(inv.current_kg)) {
      toast.error(`الرصيد المتاح من ${f.feed_name} = ${inv.current_kg} كجم فقط`);
      return;
    }
    const { error } = await supabase.from("brooding_feed_issuance").insert(f);
    if (error) { toast.error(error.message); return; }
    toast.success("تم صرف العلف وخصمه من المخزون — تم إرسال إشعار لمسؤول مصنع الأعلاف");
    setLastSaved({ ...f });
  };
  return (<div className="space-y-3">
    <div><Label>الدفعة</Label><BatchSelect value={f.batch_id} onChange={(v: string) => setF({ ...f, batch_id: v })} batches={batches} /></div>
    <div><Label>التاريخ</Label><Input type="date" value={f.issue_date} onChange={e => setF({ ...f, issue_date: e.target.value })} /></div>
    <div>
      <Label>نوع العلف (من مخزون علف الكتاكيت)</Label>
      {feedInventory.length > 0 ? (
        <Select value={f.feed_name} onValueChange={v => setF({ ...f, feed_name: v })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{feedInventory.map(i => <SelectItem key={i.id} value={i.feed_name}>{i.feed_name} — متاح {fmt(Number(i.current_kg))} كجم</SelectItem>)}</SelectContent>
        </Select>
      ) : (
        <Input value={f.feed_name} onChange={e => setF({ ...f, feed_name: e.target.value })} />
      )}
    </div>
    {batch && (
      <div className="text-xs text-muted-foreground p-2 rounded bg-emerald-50 border border-emerald-200">
        💡 سعر التكلفة الموصى به (حسب عمر الدفعة): <strong>{fmtMoney(recommendedUnitCost)}/كجم</strong> — السعر مأخوذ بالتكلفة وليس البيع
        {inv && <> | الرصيد المتاح: <strong>{fmt(Number(inv.current_kg))} كجم</strong></>}
      </div>
    )}
    <div className="grid grid-cols-3 gap-2">
      <div><Label>الكمية (كجم)</Label><Input type="number" value={f.quantity_kg} onChange={e => setF({ ...f, quantity_kg: +e.target.value })} /></div>
      <div>
        <Label>سعر الكيلو (تكلفة)</Label>
        <Input type="number" step="0.001" disabled={!canOverride || !override} value={f.unit_cost} onChange={e => setF({ ...f, unit_cost: +e.target.value })} />
      </div>
      <div><Label>الإجمالي</Label><Input type="number" value={f.total_cost} readOnly /></div>
    </div>
    {canOverride && (
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={override} onChange={e => setOverride(e.target.checked)} />
        تعديل السعر يدويًا (مدير عام/تنفيذي فقط)
      </label>
    )}
    <div><Label>ملاحظات</Label><Textarea value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></div>
    {lastSaved ? (
      <div className="space-y-2">
        <div className="p-2 rounded bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
          ✅ تم الصرف بنجاح. يمكنك طباعة إذن الصرف الآن.
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => printPermit(lastSaved, profile?.full_name || "—")}>
            <Printer className="w-4 h-4 ml-1" />طباعة إذن الصرف
          </Button>
          <Button onClick={onDone}>إغلاق</Button>
        </div>
      </div>
    ) : (
      <Button onClick={submit} className="w-full">حفظ وصرف العلف</Button>
    )}
  </div>);
};

const MedicineForm = ({ batches, onDone, defaultBatchId }: any) => {
  const [f, setF] = useState({ batch_id: defaultBatchId || "", issue_date: new Date().toISOString().slice(0, 10), medicine_name: "", quantity: 0, unit: "", unit_cost: 0, total_cost: 0, notes: "" });
  useEffect(() => { setF(p => ({ ...p, total_cost: p.quantity * p.unit_cost })); }, [f.quantity, f.unit_cost]);
  const submit = async () => {
    if (!f.batch_id || !f.medicine_name) { toast.error("أكمل البيانات"); return; }
    const { error } = await supabase.from("brooding_medicine_issuance").insert(f);
    if (error) { toast.error(error.message); return; }
    toast.success("تم صرف الدواء"); onDone();
  };
  return (<div className="space-y-3">
    <div><Label>الدفعة</Label><BatchSelect value={f.batch_id} onChange={(v: string) => setF({ ...f, batch_id: v })} batches={batches} /></div>
    <div><Label>التاريخ</Label><Input type="date" value={f.issue_date} onChange={e => setF({ ...f, issue_date: e.target.value })} /></div>
    <div><Label>اسم الدواء</Label><Input value={f.medicine_name} onChange={e => setF({ ...f, medicine_name: e.target.value })} /></div>
    <div className="grid grid-cols-2 gap-2">
      <div><Label>الكمية</Label><Input type="number" value={f.quantity} onChange={e => setF({ ...f, quantity: +e.target.value })} /></div>
      <div><Label>الوحدة</Label><Input value={f.unit} onChange={e => setF({ ...f, unit: e.target.value })} placeholder="مل / قرص" /></div>
    </div>
    <div className="grid grid-cols-2 gap-2">
      <div><Label>سعر الوحدة</Label><Input type="number" value={f.unit_cost} onChange={e => setF({ ...f, unit_cost: +e.target.value })} /></div>
      <div><Label>الإجمالي</Label><Input type="number" value={f.total_cost} onChange={e => setF({ ...f, total_cost: +e.target.value })} /></div>
    </div>
    <div><Label>ملاحظات</Label><Textarea value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></div>
    <Button onClick={submit} className="w-full">حفظ</Button>
  </div>);
};

const SALE_AGE_PRESETS = [
  { label: "عمر أسبوع", days: 7 },
  { label: "عمر أسبوعين", days: 14 },
  { label: "عمر شهر", days: 30 },
  { label: "عمر شهر ونص", days: 45 },
  { label: "عمر شهرين", days: 60 },
];

const SaleForm = ({ batches, onDone, defaultBatchId }: any) => {
  const { roles, role } = useAuth();
  const userRoles = roles && roles.length > 0 ? roles : (role ? [role] : []);
  const canManualAge = userRoles.includes("general_manager") || userRoles.includes("executive_manager");

  const [f, setF] = useState({ batch_id: defaultBatchId || "", sale_date: new Date().toISOString().slice(0, 10), customer_name: "", count: 1, unit_price: 0, total_amount: 0, payment_method: "cash", treasury: "", notes: "" });
  const [ageMode, setAgeMode] = useState<"auto" | "preset" | "manual">("auto");
  const [ageDays, setAgeDays] = useState<number>(0);
  const [ageLabelSel, setAgeLabelSel] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const batch = batches.find((b: Batch) => b.id === f.batch_id);
  const currentBatchAge = batch ? currentAgeDays(batch) : 0;
  const currentBatchAgeLabel = batch ? ageLabel(batch) : "";
  const currentCost = batch ? Number(batch.cost_per_bird) : 0;
  const totalCostAtSale = currentCost * f.count;
  const profit = f.total_amount - totalCostAtSale;

  useEffect(() => { setF(p => ({ ...p, total_amount: p.count * p.unit_price })); }, [f.count, f.unit_price]);
  // Default age = current batch age
  useEffect(() => {
    if (ageMode === "auto" && batch) {
      setAgeDays(currentBatchAge);
      setAgeLabelSel(currentBatchAgeLabel);
    }
  }, [ageMode, f.batch_id, batch, currentBatchAge, currentBatchAgeLabel]);

  const submit = async () => {
    if (!f.batch_id || !f.customer_name || f.count <= 0) { toast.error("أكمل البيانات"); return; }
    if (batch && f.count > batch.current_count) {
      toast.error(`لا يمكن البيع — العدد الحالي بالدفعة ${batch.current_count} فقط`);
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("brooding_chick_sales").insert({
      ...f,
      age_at_sale_days: ageDays || currentBatchAge,
      age_label_snapshot: ageLabelSel || currentBatchAgeLabel,
    } as any);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`تم البيع — تكلفة ${fmtMoney(totalCostAtSale)} | ${profit >= 0 ? "ربح" : "خسارة"}: ${fmtMoney(Math.abs(profit))}`);
    onDone();
  };
  return (<div className="space-y-3">
    <div><Label>الدفعة</Label><BatchSelect value={f.batch_id} onChange={(v: string) => setF({ ...f, batch_id: v })} batches={batches} /></div>
    {batch && (
      <div className="text-xs p-2 rounded bg-emerald-50 border border-emerald-200 space-y-1">
        <div>📦 <strong>{batch.batch_number}</strong> — العمر الحالي: <strong>{currentBatchAgeLabel}</strong></div>
        <div>💰 تكلفة الطائر الحالية: <strong>{fmtMoney(currentCost)}</strong> | العدد المتاح: <strong>{batch.current_count}</strong></div>
      </div>
    )}
    <div><Label>التاريخ</Label><Input type="date" value={f.sale_date} onChange={e => setF({ ...f, sale_date: e.target.value })} /></div>
    <div><Label>العميل</Label><Input value={f.customer_name} onChange={e => setF({ ...f, customer_name: e.target.value })} /></div>

    <div className="p-3 rounded-lg border bg-amber-50/40 space-y-2">
      <Label className="font-semibold">عمر الكتاكيت وقت البيع</Label>
      <div className="flex gap-1 flex-wrap">
        <Button type="button" size="sm" variant={ageMode === "auto" ? "default" : "outline"} onClick={() => setAgeMode("auto")}>العمر الحالي تلقائيًا</Button>
        <Button type="button" size="sm" variant={ageMode === "preset" ? "default" : "outline"} onClick={() => setAgeMode("preset")}>اختيار جاهز</Button>
        {canManualAge && (
          <Button type="button" size="sm" variant={ageMode === "manual" ? "default" : "outline"} onClick={() => setAgeMode("manual")}>إدخال يدوي (مدير)</Button>
        )}
      </div>
      {ageMode === "preset" && (
        <Select value={ageLabelSel} onValueChange={v => { const p = SALE_AGE_PRESETS.find(x => x.label === v); setAgeLabelSel(v); setAgeDays(p?.days || 0); }}>
          <SelectTrigger><SelectValue placeholder="اختر عمر الكتاكيت" /></SelectTrigger>
          <SelectContent>{SALE_AGE_PRESETS.map(a => <SelectItem key={a.days} value={a.label}>{a.label}</SelectItem>)}</SelectContent>
        </Select>
      )}
      {ageMode === "manual" && canManualAge && (
        <div className="grid grid-cols-2 gap-2">
          <Input type="number" min={0} placeholder="العمر بالأيام" value={ageDays} onChange={e => setAgeDays(+e.target.value)} />
          <Input placeholder="وصف العمر (مثل: عمر شهر)" value={ageLabelSel} onChange={e => setAgeLabelSel(e.target.value)} />
        </div>
      )}
      <div className="text-xs text-muted-foreground">العمر المسجل: <strong>{ageLabelSel || `${ageDays} يوم`}</strong></div>
    </div>

    <div className="grid grid-cols-3 gap-2">
      <div><Label>العدد</Label><Input type="number" min={1} max={batch?.current_count || undefined} value={f.count} onChange={e => setF({ ...f, count: +e.target.value })} /></div>
      <div><Label>سعر الكتكوت</Label><Input type="number" value={f.unit_price} onChange={e => setF({ ...f, unit_price: +e.target.value })} /></div>
      <div><Label>الإجمالي</Label><Input type="number" value={f.total_amount} readOnly /></div>
    </div>

    {batch && f.count > 0 && (
      <div className="text-xs p-2 rounded bg-slate-50 border space-y-1">
        <div>تكلفة الكتاكيت المباعة = {f.count} × {fmtMoney(currentCost)} = <strong>{fmtMoney(totalCostAtSale)}</strong></div>
        <div>إجمالي البيع: <strong>{fmtMoney(f.total_amount)}</strong></div>
        <div className={profit >= 0 ? "text-emerald-700 font-bold" : "text-red-700 font-bold"}>
          {profit >= 0 ? "الربح المتوقع" : "الخسارة المتوقعة"}: {fmtMoney(Math.abs(profit))}
        </div>
      </div>
    )}

    <div className="grid grid-cols-2 gap-2">
      <div><Label>طريقة الدفع</Label>
        <Select value={f.payment_method} onValueChange={v => setF({ ...f, payment_method: v })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="cash">نقدي</SelectItem><SelectItem value="bank">تحويل بنكي</SelectItem><SelectItem value="credit">آجل</SelectItem></SelectContent>
        </Select>
      </div>
      <div><Label>الخزنة</Label><Input value={f.treasury} onChange={e => setF({ ...f, treasury: e.target.value })} /></div>
    </div>
    <div><Label>ملاحظات</Label><Textarea value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></div>
    <Button onClick={submit} disabled={saving} className="w-full">{saving ? "..." : "حفظ الفاتورة"}</Button>
  </div>);
};

const TransferForm = ({ batches, onDone, defaultBatchId }: any) => {
  const [f, setF] = useState({ batch_id: defaultBatchId || "", transfer_date: new Date().toISOString().slice(0, 10), count: 1, avg_weight_kg: 0, total_weight_kg: 0, live_price_per_kg: 0, notes: "" });
  const [saving, setSaving] = useState(false);
  const batch = batches.find((b: Batch) => b.id === f.batch_id);
  const costPerBird = batch ? Number(batch.cost_per_bird) : 0;
  const totalTransferCost = costPerBird * f.count;
  const valuation = f.total_weight_kg * f.live_price_per_kg;
  const expectedPL = valuation - totalTransferCost;

  useEffect(() => { if (f.count && f.avg_weight_kg) setF(p => ({ ...p, total_weight_kg: +(p.count * p.avg_weight_kg).toFixed(2) })); }, [f.count, f.avg_weight_kg]);

  const submit = async () => {
    if (!f.batch_id || f.count <= 0) { toast.error("أكمل البيانات"); return; }
    if (batch && f.count > batch.current_count) {
      toast.error(`لا يمكن تحويل ${f.count} — العدد المتاح ${batch.current_count} فقط`);
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("brooding_to_slaughter_transfers").insert({
      ...f,
      valuation_amount: +valuation.toFixed(2),
      expected_profit_loss: +expectedPL.toFixed(2),
    } as any);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`تم التحويل — تكلفة ${fmtMoney(totalTransferCost)} | ${expectedPL >= 0 ? "ربح" : "خسارة"} متوقع: ${fmtMoney(Math.abs(expectedPL))}`);
    onDone();
  };
  return (<div className="space-y-3">
    <div><Label>الدفعة</Label><BatchSelect value={f.batch_id} onChange={(v: string) => setF({ ...f, batch_id: v })} batches={batches} /></div>
    {batch && (
      <div className="text-xs p-2 rounded bg-indigo-50 border border-indigo-200">
        تكلفة الطائر الحالية: <strong>{fmtMoney(costPerBird)}</strong> | العدد المتاح: <strong>{batch.current_count}</strong>
      </div>
    )}
    <div><Label>التاريخ</Label><Input type="date" value={f.transfer_date} onChange={e => setF({ ...f, transfer_date: e.target.value })} /></div>
    <div className="grid grid-cols-3 gap-2">
      <div><Label>العدد</Label><Input type="number" min={1} max={batch?.current_count || undefined} value={f.count} onChange={e => setF({ ...f, count: +e.target.value })} /></div>
      <div><Label>متوسط الوزن (كجم)</Label><Input type="number" step="0.1" value={f.avg_weight_kg} onChange={e => setF({ ...f, avg_weight_kg: +e.target.value })} /></div>
      <div><Label>إجمالي الوزن قائم</Label><Input type="number" step="0.1" value={f.total_weight_kg} onChange={e => setF({ ...f, total_weight_kg: +e.target.value })} /></div>
    </div>
    <div className="grid grid-cols-2 gap-2">
      <div><Label>سعر الكيلو قائم</Label><Input type="number" step="0.01" value={f.live_price_per_kg} onChange={e => setF({ ...f, live_price_per_kg: +e.target.value })} /></div>
      <div><Label>قيمة البيع/التقييم قائم</Label><Input readOnly value={fmt(valuation)} /></div>
    </div>
    {batch && f.count > 0 && (
      <div className="text-xs p-2 rounded bg-slate-50 border space-y-1">
        <div>إجمالي تكلفة الطيور المحولة: <strong>{fmtMoney(totalTransferCost)}</strong> ({f.count} × {fmtMoney(costPerBird)})</div>
        <div>إجمالي الوزن قائم: <strong>{fmt(f.total_weight_kg)} كجم</strong> × {fmtMoney(f.live_price_per_kg)} = <strong>{fmtMoney(valuation)}</strong></div>
        <div className={expectedPL >= 0 ? "text-emerald-700 font-bold" : "text-red-700 font-bold"}>
          {expectedPL >= 0 ? "الربح المتوقع" : "الخسارة المتوقعة"}: {fmtMoney(Math.abs(expectedPL))}
        </div>
      </div>
    )}
    <div><Label>ملاحظات</Label><Textarea value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></div>
    <Button onClick={submit} disabled={saving} className="w-full">{saving ? "..." : "تأكيد التحويل للمجزر"}</Button>
  </div>);
};

// ===== Feed Stock Tab =====
const FeedStockTab = ({ inventory, movements, batches, canManage, settings, onReload }: { inventory: FeedInventory[]; movements: FeedStockMovement[]; batches: Batch[]; canManage: boolean; settings: BroodingSettings; onReload: () => void }) => {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ feed_id: inventory[0]?.id || "", movement_type: "purchase" as "purchase" | "opening" | "adjustment", quantity_kg: 0, unit_cost: 20.238, notes: "" });

  useEffect(() => { if (open) setF(s => ({ ...s, feed_id: inventory[0]?.id || "" })); }, [open, inventory]);

  const submit = async () => {
    if (!f.feed_id || f.quantity_kg <= 0) { toast.error("أكمل البيانات"); return; }
    const { error } = await supabase.from("brooding_feed_stock_movements" as any).insert({
      feed_id: f.feed_id,
      movement_type: f.movement_type,
      quantity_kg: f.quantity_kg,
      unit_cost: f.unit_cost,
      total_cost: f.quantity_kg * f.unit_cost,
      notes: f.notes || null,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("تم تسجيل الحركة");
    setOpen(false);
    onReload();
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>مخزون علف الكتاكيت</CardTitle>
          {canManage && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild><Button size="sm"><Plus className="w-4 h-4 ml-1" />حركة مخزون</Button></DialogTrigger>
              <DialogContent dir="rtl" className="max-w-md">
                <DialogHeader><DialogTitle>حركة مخزون علف</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label>الصنف</Label>
                    <Select value={f.feed_id} onValueChange={v => setF({ ...f, feed_id: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{inventory.map(i => <SelectItem key={i.id} value={i.id}>{i.feed_name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>نوع الحركة</Label>
                    <Select value={f.movement_type} onValueChange={(v: any) => setF({ ...f, movement_type: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="purchase">شراء (إضافة للرصيد)</SelectItem>
                        <SelectItem value="opening">رصيد افتتاحي</SelectItem>
                        <SelectItem value="adjustment">تسوية (تعيين الرصيد)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label>الكمية (كجم)</Label><Input type="number" value={f.quantity_kg} onChange={e => setF({ ...f, quantity_kg: +e.target.value })} /></div>
                    <div><Label>سعر الكيلو</Label><Input type="number" step="0.001" value={f.unit_cost} onChange={e => setF({ ...f, unit_cost: +e.target.value })} /></div>
                  </div>
                  <div><Label>ملاحظات</Label><Textarea value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></div>
                  <Button onClick={submit} className="w-full">حفظ</Button>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>الصنف</TableHead><TableHead>الرصيد (كجم)</TableHead><TableHead>آخر سعر/كجم</TableHead><TableHead>القيمة</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {inventory.map(i => {
                const low = Number(i.current_kg) <= settings.low_feed_alert_kg;
                return (
                  <TableRow key={i.id}>
                    <TableCell className="font-semibold">{i.feed_name}</TableCell>
                    <TableCell className={low ? "text-red-600 font-bold" : "font-bold"}>{fmt(Number(i.current_kg))} {low && <Badge variant="destructive" className="mr-2">منخفض</Badge>}</TableCell>
                    <TableCell>{fmtMoney(Number(i.last_unit_cost))}</TableCell>
                    <TableCell>{fmtMoney(Number(i.current_kg) * Number(i.last_unit_cost))}</TableCell>
                  </TableRow>
                );
              })}
              {inventory.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">لا يوجد مخزون</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>سجل حركات المخزون</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>التاريخ</TableHead><TableHead>النوع</TableHead><TableHead>الكمية</TableHead><TableHead>سعر/كجم</TableHead><TableHead>الإجمالي</TableHead><TableHead>الدفعة</TableHead><TableHead>ملاحظات</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {movements.map(m => (
                <TableRow key={m.id}>
                  <TableCell>{new Date(m.created_at).toLocaleDateString("ar-EG")}</TableCell>
                  <TableCell><Badge variant={m.movement_type === "consumption" ? "destructive" : "secondary"}>
                    {m.movement_type === "opening" ? "افتتاحي" : m.movement_type === "purchase" ? "شراء" : m.movement_type === "consumption" ? "صرف" : "تسوية"}
                  </Badge></TableCell>
                  <TableCell>{fmt(Number(m.quantity_kg))} كجم</TableCell>
                  <TableCell>{fmtMoney(Number(m.unit_cost))}</TableCell>
                  <TableCell className="font-bold">{fmtMoney(Number(m.total_cost))}</TableCell>
                  <TableCell>{m.batch_id ? batches.find(b => b.id === m.batch_id)?.batch_number || "-" : "-"}</TableCell>
                  <TableCell className="text-xs">{m.notes || "-"}</TableCell>
                </TableRow>
              ))}
              {movements.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">لا توجد حركات</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

// ===== Settings Tab =====
const SettingsTab = ({ settings, onSaved }: { settings: BroodingSettings; onSaved: () => void }) => {
  const [s, setS] = useState<BroodingSettings>(settings);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setS(settings); }, [settings]);

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from("brooding_settings" as any).update({
      ...s, updated_at: new Date().toISOString(),
    }).eq("id", true);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("تم حفظ الإعدادات");
    onSaved();
  };

  const num = (k: keyof BroodingSettings, label: string, step = "0.01") => (
    <div>
      <Label>{label}</Label>
      <Input type="number" step={step} value={(s as any)[k]} onChange={e => setS({ ...s, [k]: +e.target.value } as any)} />
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>إعدادات قسم التحضين والتسمين</CardTitle>
        <p className="text-sm text-muted-foreground">للمدير العام والمدير التنفيذي فقط</p>
      </CardHeader>
      <CardContent className="space-y-6">
        <section>
          <h3 className="font-bold text-emerald-700 mb-2">أسعار الكتكوت والعلف</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {num("default_chick_price", "سعر الكتكوت من معمل التفريخ (عمر أسبوع)", "1")}
            {num("feed_cost_per_kg_phase1", "تركيبة 1: من يوم → 4 شهور (ج/كجم)", "0.001")}
            {num("feed_cost_per_kg_phase2", "تركيبة 2: من 4 شهور → الذبح (ج/كجم)", "0.001")}
            {num("phase_split_months", "حد التحول بين التركيبتين (شهور)", "1")}
          </div>
        </section>

        <section>
          <h3 className="font-bold text-emerald-700 mb-2">حدود التنبيهات</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {num("low_feed_alert_kg", "تنبيه انخفاض رصيد العلف (كجم)", "1")}
            {num("mortality_alert_pct", "تنبيه نسبة النفوق (%)", "0.1")}
          </div>
        </section>

        <section>
          <h3 className="font-bold text-emerald-700 mb-2">شكل الطباعة</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div><Label>اسم الشركة</Label><Input value={s.company_name} onChange={e => setS({ ...s, company_name: e.target.value })} /></div>
            <div><Label>لون رأس الطباعة</Label><Input type="color" value={s.print_header_color} onChange={e => setS({ ...s, print_header_color: e.target.value })} /></div>
            <div><Label>لون الإبراز</Label><Input type="color" value={s.print_accent_color} onChange={e => setS({ ...s, print_accent_color: e.target.value })} /></div>
          </div>
        </section>

        <div className="flex justify-end">
          <Button onClick={save} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700">{saving ? "جاري الحفظ..." : "حفظ الإعدادات"}</Button>
        </div>
      </CardContent>
    </Card>
  );
};

// ===== Recipes Tab (تركيبة علف التسمين) =====
type Recipe = { id: string; name: string; feed_type: string; batch_size: number; unit: string; is_active: boolean };
type RecipeItem = { id: string; recipe_id: string; raw_material_id: string; quantity: number; unit: string | null; unit_cost: number | null; raw_material_name?: string };

const RecipesTab = ({ canManage }: { canManage: boolean }) => {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [items, setItems] = useState<RecipeItem[]>([]);
  const [materials, setMaterials] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingItemId, setSavingItemId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const [r, i, m] = await Promise.all([
      supabase.from("feed_recipes").select("id,name,feed_type,batch_size,unit,is_active").order("name"),
      supabase.from("feed_recipe_items").select("id,recipe_id,raw_material_id,quantity,unit,unit_cost"),
      supabase.from("raw_materials" as any).select("id,name"),
    ]);
    const matMap: Record<string, string> = {};
    ((m.data as any) || []).forEach((x: any) => { matMap[x.id] = x.name; });
    setMaterials(matMap);
    setRecipes((r.data as any) || []);
    setItems(((i.data as any) || []).map((x: any) => ({ ...x, raw_material_name: matMap[x.raw_material_id] })));
    if (!selected && r.data && r.data.length) setSelected((r.data as any).find((x: any) => x.is_active)?.id || (r.data as any)[0].id);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const currentRecipe = recipes.find(r => r.id === selected);
  const currentItems = items.filter(i => i.recipe_id === selected);
  const totalKg = currentItems.reduce((a, x) => a + Number(x.quantity), 0);
  const totalCost = currentItems.reduce((a, x) => a + Number(x.quantity) * Number(x.unit_cost || 0), 0);
  const costPerKg = totalKg > 0 ? totalCost / totalKg : 0;
  const costPerTon = costPerKg * 1000;

  const updateItem = async (item: RecipeItem, patch: Partial<RecipeItem>) => {
    setSavingItemId(item.id);
    const next = { ...item, ...patch };
    const { error } = await supabase.from("feed_recipe_items").update({
      quantity: Number(next.quantity),
      unit_cost: Number(next.unit_cost || 0),
    }).eq("id", item.id);
    setSavingItemId(null);
    if (error) { toast.error(error.message); return; }
    setItems(prev => prev.map(p => p.id === item.id ? next : p));
    toast.success("تم تحديث التركيبة — تم إعادة احتساب تكلفة الكيلو. الحركات القديمة لا تتأثر.");
  };

  const phaseLabel = (t: string) =>
    t === "starter" ? "بادئ (الكتاكيت 0-2 شهور)" :
    t === "grower" ? "نامي/تسمين (2 شهر → الذبح)" :
    t === "layer" ? "بياض" : t;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
          <CardTitle>تركيبة علف التسمين</CardTitle>
          <div className="text-xs text-muted-foreground">
            {canManage ? "✏️ يمكن للمدير العام/التنفيذي تعديل الكميات والأسعار" : "👁️ عرض فقط — التعديل للمدير العام/التنفيذي"}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {recipes.map(r => (
              <Button key={r.id} size="sm" variant={selected === r.id ? "default" : "outline"} onClick={() => setSelected(r.id)}>
                {r.name} {r.is_active && <Badge variant="secondary" className="mr-2">نشطة</Badge>}
              </Button>
            ))}
            {recipes.length === 0 && !loading && <div className="text-muted-foreground">لا توجد تركيبات. يمكن إضافتها من مصنع الأعلاف.</div>}
          </div>

          {currentRecipe && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 rounded-lg bg-emerald-50 border border-emerald-200">
              <div><div className="text-xs text-muted-foreground">المرحلة العمرية</div><div className="font-bold">{phaseLabel(currentRecipe.feed_type)}</div></div>
              <div><div className="text-xs text-muted-foreground">حجم الدفعة (كجم)</div><div className="font-bold">{fmt(Number(currentRecipe.batch_size))}</div></div>
              <div><div className="text-xs text-muted-foreground">تكلفة الكيلو (تكلفة)</div><div className="font-bold text-emerald-700">{fmtMoney(costPerKg)}</div></div>
              <div><div className="text-xs text-muted-foreground">تكلفة الطن</div><div className="font-bold text-emerald-700">{fmtMoney(costPerTon)}</div></div>
            </div>
          )}

          {currentRecipe && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الخامة</TableHead>
                  <TableHead>الكمية (كجم)</TableHead>
                  <TableHead>سعر الخامة/كجم</TableHead>
                  <TableHead>تكلفة الخامة</TableHead>
                  <TableHead>%</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {currentItems.map(it => {
                  const lineCost = Number(it.quantity) * Number(it.unit_cost || 0);
                  const pct = totalKg > 0 ? (Number(it.quantity) / totalKg) * 100 : 0;
                  return (
                    <TableRow key={it.id}>
                      <TableCell className="font-semibold">{it.raw_material_name || materials[it.raw_material_id] || "—"}</TableCell>
                      <TableCell>
                        {canManage ? (
                          <Input type="number" step="0.01" className="w-28" defaultValue={Number(it.quantity)}
                            onBlur={e => { const v = +e.target.value; if (v !== Number(it.quantity)) updateItem(it, { quantity: v }); }}
                            disabled={savingItemId === it.id} />
                        ) : fmt(Number(it.quantity))}
                      </TableCell>
                      <TableCell>
                        {canManage ? (
                          <Input type="number" step="0.001" className="w-28" defaultValue={Number(it.unit_cost || 0)}
                            onBlur={e => { const v = +e.target.value; if (v !== Number(it.unit_cost || 0)) updateItem(it, { unit_cost: v }); }}
                            disabled={savingItemId === it.id} />
                        ) : fmtMoney(Number(it.unit_cost || 0))}
                      </TableCell>
                      <TableCell className="font-bold">{fmtMoney(lineCost)}</TableCell>
                      <TableCell className="text-muted-foreground">{pct.toFixed(1)}%</TableCell>
                    </TableRow>
                  );
                })}
                {currentItems.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">لا توجد خامات</TableCell></TableRow>}
                {currentItems.length > 0 && (
                  <TableRow className="bg-emerald-50 font-bold">
                    <TableCell>الإجمالي</TableCell>
                    <TableCell>{fmt(totalKg)} كجم</TableCell>
                    <TableCell>—</TableCell>
                    <TableCell className="text-emerald-700">{fmtMoney(totalCost)}</TableCell>
                    <TableCell>100%</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}

          <div className="text-xs text-amber-700 p-2 rounded bg-amber-50 border border-amber-200">
            ⚠️ <strong>تنبيه:</strong> أي تعديل في كمية أو سعر خامة يغير تكلفة الكيلو فورًا، ويُستخدم في حركات صرف العلف <u>الجديدة</u> فقط.
            الحركات القديمة محفوظة بسعرها الأصلي ولا تتغير. الأسعار هنا أسعار <strong>تكلفة</strong> وليست أسعار بيع.
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Brooding;

