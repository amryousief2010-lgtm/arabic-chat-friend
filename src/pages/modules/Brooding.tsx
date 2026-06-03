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
import { Bird, Plus, Skull, Wallet, Wheat, Pill, ShoppingCart, ArrowRightLeft, Printer, FileSpreadsheet, AlertTriangle, TrendingUp, Package } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { openPrintWindow } from "@/lib/printPdf";

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
type Sale = { id: string; batch_id: string; sale_date: string; customer_name: string; count: number; unit_price: number; total_amount: number; payment_method: string | null; treasury: string | null; cost_at_sale: number; profit: number; notes: string | null };
type Transfer = { id: string; batch_id: string; transfer_date: string; count: number; avg_weight_kg: number | null; total_weight_kg: number | null; transferred_cost: number; notes: string | null };

const EXPENSE_TYPES = [
  { value: "feed", label: "علف" },
  { value: "medicine", label: "أدوية" },
  { value: "vitamins", label: "فيتامينات" },
  { value: "labor", label: "عمالة" },
  { value: "bedding", label: "فرشة/نشارة" },
  { value: "utilities", label: "كهرباء/تدفئة" },
  { value: "other", label: "أخرى" },
];

const ageInMonths = (received: string): string => {
  const d = new Date(received);
  const months = (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 30);
  return months >= 1 ? `${months.toFixed(1)} شهر` : `${(months * 30).toFixed(0)} يوم`;
};

const fmt = (n: number) => new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 2 }).format(n || 0);
const fmtMoney = (n: number) => `${fmt(n)} ج.م`;

const exportXlsx = (rows: any[], filename: string) => {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  XLSX.writeFile(wb, `${filename}.xlsx`);
};

const printTable = (title: string, headers: string[], rows: (string | number)[][]) => {
  const html = `
    <h1 style="text-align:center;font-family:'Cairo',sans-serif">${title}</h1>
    <table style="width:100%;border-collapse:collapse;font-family:'Cairo',sans-serif" border="1">
      <thead><tr>${headers.map(h => `<th style="padding:8px;background:#f3e8ff">${h}</th>`).join("")}</tr></thead>
      <tbody>${rows.map(r => `<tr>${r.map(c => `<td style="padding:6px">${c}</td>`).join("")}</tr>`).join("")}</tbody>
    </table>`;
  openPrintWindow(html, title);
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
  const [loading, setLoading] = useState(true);

  const loadAll = async () => {
    setLoading(true);
    const [b, m, e, f, md, s, t] = await Promise.all([
      supabase.from("brooding_batches").select("*").order("received_date", { ascending: false }),
      supabase.from("brooding_mortality").select("*").order("mortality_date", { ascending: false }),
      supabase.from("brooding_expenses").select("*").order("expense_date", { ascending: false }),
      supabase.from("brooding_feed_issuance").select("*").order("issue_date", { ascending: false }),
      supabase.from("brooding_medicine_issuance").select("*").order("issue_date", { ascending: false }),
      supabase.from("brooding_chick_sales").select("*").order("sale_date", { ascending: false }),
      supabase.from("brooding_to_slaughter_transfers").select("*").order("transfer_date", { ascending: false }),
    ]);
    setBatches((b.data as Batch[]) || []);
    setMortality((m.data as Mortality[]) || []);
    setExpenses((e.data as Expense[]) || []);
    setFeed((f.data as FeedIssue[]) || []);
    setMedicine((md.data as MedIssue[]) || []);
    setSales((s.data as Sale[]) || []);
    setTransfers((t.data as Transfer[]) || []);
    setLoading(false);
  };

  useEffect(() => { loadAll(); }, []);

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
    const feedCost = feed.reduce((a, x) => a + Number(x.total_cost), 0);
    const medCost = medicine.reduce((a, x) => a + Number(x.total_cost), 0);
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 15);
    const last15 = [...expenses, ...feed.map(f => ({ expense_date: f.issue_date, total_amount: f.total_cost })), ...medicine.map(m => ({ expense_date: m.issue_date, total_amount: m.total_cost }))]
      .filter((x: any) => new Date(x.expense_date) >= cutoff)
      .reduce((a, x: any) => a + Number(x.total_amount), 0);
    const salesProfit = sales.reduce((a, x) => a + Number(x.profit), 0);
    const salesRevenue = sales.reduce((a, x) => a + Number(x.total_amount), 0);
    return { totalBirds, openBatches, totalMortality, mortalityRate, totalSold, totalTransferred, totalCost, avgCostPerBird, feedCost, medCost, last15, salesProfit, salesRevenue };
  }, [batches, feed, medicine, expenses, sales]);

  const batchLabel = (id: string) => batches.find(b => b.id === id)?.batch_number || id.slice(0, 6);

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6" dir="rtl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-2xl bg-gradient-to-br from-primary to-orange-500 text-white">
              <Bird className="w-7 h-7" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">التحضين والتسمين</h1>
              <p className="text-muted-foreground">إدارة دفعات الكتاكيت من الاستلام حتى البيع أو المجزر</p>
            </div>
          </div>
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
          <KPI label="دفعات مفتوحة" value={fmt(kpis.openBatches)} icon={<Package className="w-5 h-5" />} color="from-orange-500 to-orange-700" />
          <KPI label="إجمالي النافق" value={fmt(kpis.totalMortality)} icon={<Skull className="w-5 h-5" />} color="from-red-500 to-red-700" />
          <KPI label="نسبة النفوق" value={`${kpis.mortalityRate.toFixed(1)}%`} icon={<AlertTriangle className="w-5 h-5" />} color="from-amber-500 to-amber-700" />
          <KPI label="مباع ككتاكيت" value={fmt(kpis.totalSold)} icon={<ShoppingCart className="w-5 h-5" />} color="from-emerald-500 to-emerald-700" />
          <KPI label="محوّل للمجزر" value={fmt(kpis.totalTransferred)} icon={<ArrowRightLeft className="w-5 h-5" />} color="from-indigo-500 to-indigo-700" />
          <KPI label="إجمالي التكلفة" value={fmtMoney(kpis.totalCost)} icon={<Wallet className="w-5 h-5" />} color="from-slate-600 to-slate-800" />
          <KPI label="متوسط تكلفة الطائر" value={fmtMoney(kpis.avgCostPerBird)} icon={<TrendingUp className="w-5 h-5" />} color="from-cyan-500 to-cyan-700" />
          <KPI label="مصروفات العلف" value={fmtMoney(kpis.feedCost)} icon={<Wheat className="w-5 h-5" />} color="from-yellow-600 to-yellow-800" />
          <KPI label="مصروفات الأدوية" value={fmtMoney(kpis.medCost)} icon={<Pill className="w-5 h-5" />} color="from-pink-500 to-pink-700" />
          <KPI label="آخر 15 يوم" value={fmtMoney(kpis.last15)} icon={<Wallet className="w-5 h-5" />} color="from-fuchsia-500 to-fuchsia-700" />
          <KPI label="أرباح البيع" value={fmtMoney(kpis.salesProfit)} icon={<TrendingUp className="w-5 h-5" />} color="from-green-500 to-green-700" />
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
          </TabsList>

          {/* BATCHES */}
          <TabsContent value="batches">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>الدفعات</CardTitle>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => exportXlsx(batches, "brooding_batches")}><FileSpreadsheet className="w-4 h-4 ml-1" />Excel</Button>
                  <Button variant="outline" size="sm" onClick={() => printTable("تقرير الدفعات", ["رقم", "تاريخ الاستلام", "العمر", "الأصلي", "الحالي", "نافق", "مباع", "محوّل", "تكلفة", "تكلفة الطائر", "الحالة"],
                    batches.map(b => [b.batch_number, b.received_date, ageInMonths(b.received_date), b.original_count, b.current_count, b.mortality_count, b.sold_count, b.transferred_count, fmtMoney(Number(b.total_cost)), fmtMoney(Number(b.cost_per_bird)), b.status]))}><Printer className="w-4 h-4 ml-1" />طباعة</Button>
                  {canManage && <NewBatchDialog onCreated={loadAll} />}
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
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {batches.map(b => (
                      <TableRow key={b.id}>
                        <TableCell className="font-semibold">{b.batch_number}</TableCell>
                        <TableCell>{b.received_date}</TableCell>
                        <TableCell>{ageInMonths(b.received_date)}</TableCell>
                        <TableCell>{b.original_count}</TableCell>
                        <TableCell className="font-bold text-primary">{b.current_count}</TableCell>
                        <TableCell className="text-red-600">{b.mortality_count}</TableCell>
                        <TableCell>{b.sold_count}</TableCell>
                        <TableCell>{b.transferred_count}</TableCell>
                        <TableCell>{fmtMoney(Number(b.total_cost))}</TableCell>
                        <TableCell>{fmtMoney(Number(b.cost_per_bird))}</TableCell>
                        <TableCell><Badge variant={b.status === "active" ? "default" : "secondary"}>{b.status}</Badge></TableCell>
                      </TableRow>
                    ))}
                    {batches.length === 0 && !loading && (
                      <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground">لا توجد دفعات</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
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
              form={(b, close) => <FeedForm batches={batches} onDone={() => { close(); loadAll(); }} />}
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
const NewBatchDialog = ({ onCreated }: { onCreated: () => void }) => {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ batch_number: "", received_date: new Date().toISOString().slice(0, 10), age_at_receipt_days: 0, original_count: 0, notes: "" });
  const submit = async () => {
    if (!f.batch_number || f.original_count <= 0) { toast.error("أكمل الحقول المطلوبة"); return; }
    const { error } = await supabase.from("brooding_batches").insert({ ...f, current_count: f.original_count, source: "معمل التفريخ" });
    if (error) { toast.error(error.message); return; }
    await supabase.from("brooding_batch_movements").insert({ batch_id: (await supabase.from("brooding_batches").select("id").eq("batch_number", f.batch_number).single()).data?.id, movement_type: "opening", count_delta: f.original_count, cost_delta: 0, description: "رصيد افتتاحي" });
    toast.success("تم إنشاء الدفعة");
    setOpen(false); onCreated();
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" className="bg-primary"><Plus className="w-4 h-4 ml-1" />دفعة جديدة</Button></DialogTrigger>
      <DialogContent dir="rtl"><DialogHeader><DialogTitle>دفعة كتاكيت جديدة</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>رقم الدفعة</Label><Input value={f.batch_number} onChange={e => setF({ ...f, batch_number: e.target.value })} placeholder="BRD-003" /></div>
          <div><Label>تاريخ الاستلام</Label><Input type="date" value={f.received_date} onChange={e => setF({ ...f, received_date: e.target.value })} /></div>
          <div><Label>العمر عند الاستلام (يوم)</Label><Input type="number" value={f.age_at_receipt_days} onChange={e => setF({ ...f, age_at_receipt_days: +e.target.value })} /></div>
          <div><Label>العدد</Label><Input type="number" value={f.original_count} onChange={e => setF({ ...f, original_count: +e.target.value })} /></div>
          <div><Label>ملاحظات</Label><Textarea value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></div>
        </div>
        <DialogFooter><Button onClick={submit}>حفظ</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const BatchSelect = ({ value, onChange, batches }: any) => (
  <Select value={value} onValueChange={onChange}>
    <SelectTrigger><SelectValue placeholder="اختر الدفعة" /></SelectTrigger>
    <SelectContent>{batches.filter((b: Batch) => b.current_count > 0).map((b: Batch) => <SelectItem key={b.id} value={b.id}>{b.batch_number} — متاح {b.current_count}</SelectItem>)}</SelectContent>
  </Select>
);

const MortalityForm = ({ batches, onDone }: any) => {
  const [f, setF] = useState({ batch_id: "", mortality_date: new Date().toISOString().slice(0, 10), count: 1, reason: "", notes: "" });
  const submit = async () => {
    if (!f.batch_id) { toast.error("اختر الدفعة"); return; }
    const { error } = await supabase.from("brooding_mortality").insert(f);
    if (error) { toast.error(error.message); return; }
    toast.success("تم تسجيل النافق"); onDone();
  };
  return (<div className="space-y-3">
    <div><Label>الدفعة</Label><BatchSelect value={f.batch_id} onChange={(v: string) => setF({ ...f, batch_id: v })} batches={batches} /></div>
    <div><Label>التاريخ</Label><Input type="date" value={f.mortality_date} onChange={e => setF({ ...f, mortality_date: e.target.value })} /></div>
    <div><Label>العدد النافق</Label><Input type="number" value={f.count} onChange={e => setF({ ...f, count: +e.target.value })} /></div>
    <div><Label>السبب</Label><Input value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} /></div>
    <div><Label>ملاحظات</Label><Textarea value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></div>
    <Button onClick={submit} className="w-full">حفظ</Button>
  </div>);
};

const ExpenseForm = ({ batches, onDone }: any) => {
  const [f, setF] = useState({ batch_id: "", expense_date: new Date().toISOString().slice(0, 10), expense_type: "feed", item_name: "", quantity: 0, unit_price: 0, total_amount: 0, treasury: "", notes: "" });
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

const FeedForm = ({ batches, onDone }: any) => {
  const [f, setF] = useState({ batch_id: "", issue_date: new Date().toISOString().slice(0, 10), feed_name: "", quantity_kg: 0, unit_cost: 0, total_cost: 0, notes: "" });
  useEffect(() => { setF(p => ({ ...p, total_cost: p.quantity_kg * p.unit_cost })); }, [f.quantity_kg, f.unit_cost]);
  const submit = async () => {
    if (!f.batch_id || !f.feed_name || f.quantity_kg <= 0) { toast.error("أكمل البيانات"); return; }
    const { error } = await supabase.from("brooding_feed_issuance").insert(f);
    if (error) { toast.error(error.message); return; }
    toast.success("تم صرف العلف"); onDone();
  };
  return (<div className="space-y-3">
    <div><Label>الدفعة</Label><BatchSelect value={f.batch_id} onChange={(v: string) => setF({ ...f, batch_id: v })} batches={batches} /></div>
    <div><Label>التاريخ</Label><Input type="date" value={f.issue_date} onChange={e => setF({ ...f, issue_date: e.target.value })} /></div>
    <div><Label>نوع العلف</Label><Input value={f.feed_name} onChange={e => setF({ ...f, feed_name: e.target.value })} /></div>
    <div className="grid grid-cols-3 gap-2">
      <div><Label>الكمية (كجم)</Label><Input type="number" value={f.quantity_kg} onChange={e => setF({ ...f, quantity_kg: +e.target.value })} /></div>
      <div><Label>سعر الكيلو</Label><Input type="number" value={f.unit_cost} onChange={e => setF({ ...f, unit_cost: +e.target.value })} /></div>
      <div><Label>الإجمالي</Label><Input type="number" value={f.total_cost} onChange={e => setF({ ...f, total_cost: +e.target.value })} /></div>
    </div>
    <div><Label>ملاحظات</Label><Textarea value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></div>
    <Button onClick={submit} className="w-full">حفظ</Button>
  </div>);
};

const MedicineForm = ({ batches, onDone }: any) => {
  const [f, setF] = useState({ batch_id: "", issue_date: new Date().toISOString().slice(0, 10), medicine_name: "", quantity: 0, unit: "", unit_cost: 0, total_cost: 0, notes: "" });
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

const SaleForm = ({ batches, onDone }: any) => {
  const [f, setF] = useState({ batch_id: "", sale_date: new Date().toISOString().slice(0, 10), customer_name: "", count: 1, unit_price: 0, total_amount: 0, payment_method: "cash", treasury: "", notes: "" });
  useEffect(() => { setF(p => ({ ...p, total_amount: p.count * p.unit_price })); }, [f.count, f.unit_price]);
  const submit = async () => {
    if (!f.batch_id || !f.customer_name || f.count <= 0) { toast.error("أكمل البيانات"); return; }
    const { error } = await supabase.from("brooding_chick_sales").insert(f);
    if (error) { toast.error(error.message); return; }
    toast.success("تمت الفاتورة"); onDone();
  };
  return (<div className="space-y-3">
    <div><Label>الدفعة</Label><BatchSelect value={f.batch_id} onChange={(v: string) => setF({ ...f, batch_id: v })} batches={batches} /></div>
    <div><Label>التاريخ</Label><Input type="date" value={f.sale_date} onChange={e => setF({ ...f, sale_date: e.target.value })} /></div>
    <div><Label>العميل</Label><Input value={f.customer_name} onChange={e => setF({ ...f, customer_name: e.target.value })} /></div>
    <div className="grid grid-cols-3 gap-2">
      <div><Label>العدد</Label><Input type="number" value={f.count} onChange={e => setF({ ...f, count: +e.target.value })} /></div>
      <div><Label>سعر الكتكوت</Label><Input type="number" value={f.unit_price} onChange={e => setF({ ...f, unit_price: +e.target.value })} /></div>
      <div><Label>الإجمالي</Label><Input type="number" value={f.total_amount} readOnly /></div>
    </div>
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
    <Button onClick={submit} className="w-full">حفظ</Button>
  </div>);
};

const TransferForm = ({ batches, onDone }: any) => {
  const [f, setF] = useState({ batch_id: "", transfer_date: new Date().toISOString().slice(0, 10), count: 1, avg_weight_kg: 0, total_weight_kg: 0, notes: "" });
  useEffect(() => { if (f.count && f.avg_weight_kg) setF(p => ({ ...p, total_weight_kg: +(p.count * p.avg_weight_kg).toFixed(2) })); }, [f.count, f.avg_weight_kg]);
  const submit = async () => {
    if (!f.batch_id || f.count <= 0) { toast.error("أكمل البيانات"); return; }
    const { error } = await supabase.from("brooding_to_slaughter_transfers").insert(f as any);
    if (error) { toast.error(error.message); return; }
    toast.success("تم التحويل للمجزر"); onDone();
  };
  return (<div className="space-y-3">
    <div><Label>الدفعة</Label><BatchSelect value={f.batch_id} onChange={(v: string) => setF({ ...f, batch_id: v })} batches={batches} /></div>
    <div><Label>التاريخ</Label><Input type="date" value={f.transfer_date} onChange={e => setF({ ...f, transfer_date: e.target.value })} /></div>
    <div className="grid grid-cols-3 gap-2">
      <div><Label>العدد</Label><Input type="number" value={f.count} onChange={e => setF({ ...f, count: +e.target.value })} /></div>
      <div><Label>متوسط الوزن (كجم)</Label><Input type="number" step="0.1" value={f.avg_weight_kg} onChange={e => setF({ ...f, avg_weight_kg: +e.target.value })} /></div>
      <div><Label>إجمالي الوزن</Label><Input type="number" value={f.total_weight_kg} onChange={e => setF({ ...f, total_weight_kg: +e.target.value })} /></div>
    </div>
    <div><Label>ملاحظات</Label><Textarea value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></div>
    <Button onClick={submit} className="w-full">حفظ</Button>
  </div>);
};

export default Brooding;
