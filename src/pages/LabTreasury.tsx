import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { openPrintWindow, escapeHtml, fmtNum, fmtDate } from "@/lib/printPdf";
import * as XLSX from "xlsx";
import { Wallet, TrendingUp, TrendingDown, CircleDollarSign, Banknote, Smartphone, Building2, CreditCard, CheckCircle2, XCircle, Hourglass, Printer, FileSpreadsheet, Plus } from "lucide-react";

type PaymentMethod = "cash" | "vodafone_cash" | "instapay" | "bank_transfer";
type MovementType = "income" | "expense";
type Status = "pending" | "approved" | "rejected";
type IncomeCat = "hatching" | "chick_sales" | "other";
type ExpenseCat =
  | "electricity" | "maintenance" | "water"
  | "salaries_mother_farm" | "salaries_hatchery" | "salaries_brooding"
  | "medicine" | "feed_supplies" | "tools" | "transport" | "other";

interface Movement {
  id: string;
  movement_type: MovementType;
  movement_date: string;
  income_category: IncomeCat | null;
  expense_category: ExpenseCat | null;
  customer_name: string | null;
  units_count: number | null;
  unit_price: number | null;
  amount: number;
  payment_method: PaymentMethod;
  description: string | null;
  beneficiary: string | null;
  notes: string | null;
  receipt_url: string | null;
  status: Status;
  rejection_reason: string | null;
  balance_after: number | null;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cash: "نقدي",
  vodafone_cash: "فودافون كاش",
  instapay: "إنستا باي",
  bank_transfer: "تحويل بنكي",
};

const INCOME_LABELS: Record<IncomeCat, string> = {
  hatching: "تفريخ بيض عملاء",
  chick_sales: "بيع كتاكيت",
  other: "إيراد آخر",
};

const EXPENSE_LABELS: Record<ExpenseCat, string> = {
  electricity: "كهرباء",
  maintenance: "صيانة",
  water: "مياه",
  salaries_mother_farm: "رواتب موظفي مزرعة الأمهات",
  salaries_hatchery: "رواتب موظفي معمل التفريخ",
  salaries_brooding: "رواتب موظفي الحضانات",
  medicine: "أدوية ومطهرات",
  feed_supplies: "علف ومستلزمات كتاكيت",
  tools: "أدوات تشغيل",
  transport: "نقل ومشاوير",
  other: "مصروفات أخرى",
};

const STATUS_LABELS: Record<Status, string> = {
  pending: "بانتظار الاعتماد",
  approved: "معتمدة",
  rejected: "مرفوضة",
};

const incomeSchema = z.object({
  movement_date: z.string().min(1, "التاريخ مطلوب"),
  income_category: z.enum(["hatching", "chick_sales", "other"]),
  customer_name: z.string().max(200).optional(),
  units_count: z.number().nonnegative().optional(),
  unit_price: z.number().nonnegative().optional(),
  amount: z.number().positive("المبلغ يجب أن يكون أكبر من صفر"),
  payment_method: z.enum(["cash", "vodafone_cash", "instapay", "bank_transfer"]),
  description: z.string().max(500).optional(),
  notes: z.string().max(1000).optional(),
});

const expenseSchema = z.object({
  movement_date: z.string().min(1, "التاريخ مطلوب"),
  expense_category: z.enum([
    "electricity", "maintenance", "water",
    "salaries_mother_farm", "salaries_hatchery", "salaries_brooding",
    "medicine", "feed_supplies", "tools", "transport", "other",
  ]),
  amount: z.number().positive("المبلغ يجب أن يكون أكبر من صفر"),
  payment_method: z.enum(["cash", "vodafone_cash", "instapay", "bank_transfer"]),
  description: z.string().max(500).optional(),
  beneficiary: z.string().max(200).optional(),
  notes: z.string().max(1000).optional(),
});

const today = () => new Date().toISOString().slice(0, 10);

export default function LabTreasury() {
  const { user, isGeneralManager, isExecutiveManager, isAccountant } = useAuth();
  const isManager = isGeneralManager || isExecutiveManager;
  const canApprove = isManager;

  const [movements, setMovements] = useState<Movement[]>([]);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  // filters
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [fType, setFType] = useState<string>("all");
  const [fCategory, setFCategory] = useState<string>("all");
  const [fPayment, setFPayment] = useState<string>("all");
  const [fStatus, setFStatus] = useState<string>("all");
  const [fCustomer, setFCustomer] = useState("");

  // forms
  const [incForm, setIncForm] = useState({
    movement_date: today(),
    income_category: "hatching" as IncomeCat,
    customer_name: "",
    units_count: "" as any,
    unit_price: "" as any,
    amount: "" as any,
    payment_method: "cash" as PaymentMethod,
    description: "",
    notes: "",
  });
  const [incReceipt, setIncReceipt] = useState<File | null>(null);

  const [expForm, setExpForm] = useState({
    movement_date: today(),
    expense_category: "electricity" as ExpenseCat,
    amount: "" as any,
    payment_method: "cash" as PaymentMethod,
    description: "",
    beneficiary: "",
    notes: "",
  });
  const [expReceipt, setExpReceipt] = useState<File | null>(null);

  const [rejectionReason, setRejectionReason] = useState<Record<string, string>>({});

  async function fetchData() {
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("lab_treasury_movements")
      .select("*")
      .order("movement_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1000);
    if (error) {
      toast.error("فشل تحميل حركات الخزنة: " + error.message);
      setLoading(false);
      return;
    }
    const list = (data || []) as Movement[];
    setMovements(list);

    const userIds = Array.from(new Set(list.flatMap((m) => [m.created_by, m.approved_by]).filter(Boolean))) as string[];
    if (userIds.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", userIds);
      const map: Record<string, string> = {};
      (profs || []).forEach((p: any) => { map[p.id] = p.full_name || ""; });
      setProfiles(map);
    }
    setLoading(false);
  }

  useEffect(() => { fetchData(); }, []);

  // Realtime
  useEffect(() => {
    const ch = supabase
      .channel("lab-treasury-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "lab_treasury_movements" }, () => fetchData())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  // Derived
  const approved = useMemo(() => movements.filter((m) => m.status === "approved"), [movements]);
  const balancesByMethod = useMemo(() => {
    const map: Record<PaymentMethod, number> = { cash: 0, vodafone_cash: 0, instapay: 0, bank_transfer: 0 };
    approved.forEach((m) => {
      const sign = m.movement_type === "income" ? 1 : -1;
      map[m.payment_method] += sign * Number(m.amount);
    });
    return map;
  }, [approved]);
  const totalBalance = balancesByMethod.cash + balancesByMethod.vodafone_cash + balancesByMethod.instapay + balancesByMethod.bank_transfer;

  const todayStr = today();
  const monthStart = todayStr.slice(0, 7);
  const todayIncome = approved.filter((m) => m.movement_date === todayStr && m.movement_type === "income").reduce((s, m) => s + Number(m.amount), 0);
  const todayExpense = approved.filter((m) => m.movement_date === todayStr && m.movement_type === "expense").reduce((s, m) => s + Number(m.amount), 0);
  const monthIncome = approved.filter((m) => m.movement_date.startsWith(monthStart) && m.movement_type === "income").reduce((s, m) => s + Number(m.amount), 0);
  const monthExpense = approved.filter((m) => m.movement_date.startsWith(monthStart) && m.movement_type === "expense").reduce((s, m) => s + Number(m.amount), 0);

  const topExpenseCat = useMemo(() => {
    const map: Record<string, number> = {};
    approved.filter((m) => m.movement_type === "expense" && m.movement_date.startsWith(monthStart)).forEach((m) => {
      const k = m.expense_category || "other";
      map[k] = (map[k] || 0) + Number(m.amount);
    });
    const entry = Object.entries(map).sort((a, b) => b[1] - a[1])[0];
    return entry ? { label: EXPENSE_LABELS[entry[0] as ExpenseCat] || "—", value: entry[1] } : { label: "—", value: 0 };
  }, [approved, monthStart]);

  const totalHatching = approved.filter((m) => m.income_category === "hatching").reduce((s, m) => s + Number(m.amount), 0);
  const totalChickSales = approved.filter((m) => m.income_category === "chick_sales").reduce((s, m) => s + Number(m.amount), 0);

  const filtered = useMemo(() => {
    return movements.filter((m) => {
      if (fromDate && m.movement_date < fromDate) return false;
      if (toDate && m.movement_date > toDate) return false;
      if (fType !== "all" && m.movement_type !== fType) return false;
      if (fPayment !== "all" && m.payment_method !== fPayment) return false;
      if (fStatus !== "all" && m.status !== fStatus) return false;
      if (fCategory !== "all" && m.income_category !== fCategory && m.expense_category !== fCategory) return false;
      if (fCustomer && !(m.customer_name || "").toLowerCase().includes(fCustomer.toLowerCase())) return false;
      return true;
    });
  }, [movements, fromDate, toDate, fType, fCategory, fPayment, fStatus, fCustomer]);

  async function uploadReceipt(file: File | null): Promise<string | null> {
    if (!file || !user) return null;
    const path = `${user.id}/${Date.now()}-${file.name.replace(/[^\w.\-]/g, "_")}`;
    const { error } = await supabase.storage.from("lab-treasury-receipts").upload(path, file, { upsert: false });
    if (error) {
      toast.error("فشل رفع الإيصال: " + error.message);
      return null;
    }
    return path;
  }

  async function submitIncome() {
    if (!user) return;
    const parsed = incomeSchema.safeParse({
      ...incForm,
      units_count: incForm.units_count === "" ? undefined : Number(incForm.units_count),
      unit_price: incForm.unit_price === "" ? undefined : Number(incForm.unit_price),
      amount: Number(incForm.amount),
    });
    if (!parsed.success) {
      toast.error(parsed.error.errors[0]?.message || "تحقق من الحقول");
      return;
    }
    const receipt_url = await uploadReceipt(incReceipt);
    const { error } = await (supabase as any).from("lab_treasury_movements").insert({
      movement_type: "income",
      movement_date: parsed.data.movement_date,
      income_category: parsed.data.income_category,
      customer_name: parsed.data.customer_name || null,
      units_count: parsed.data.units_count ?? null,
      unit_price: parsed.data.unit_price ?? null,
      amount: parsed.data.amount,
      payment_method: parsed.data.payment_method,
      description: parsed.data.description || null,
      notes: parsed.data.notes || null,
      receipt_url,
      created_by: user.id,
      status: "pending",
    });
    if (error) { toast.error("فشل التسجيل: " + error.message); return; }
    toast.success("تم تسجيل الإيراد — بانتظار الاعتماد");
    setIncForm({ ...incForm, customer_name: "", units_count: "", unit_price: "", amount: "", description: "", notes: "" });
    setIncReceipt(null);
    fetchData();
  }

  async function submitExpense() {
    if (!user) return;
    const parsed = expenseSchema.safeParse({ ...expForm, amount: Number(expForm.amount) });
    if (!parsed.success) {
      toast.error(parsed.error.errors[0]?.message || "تحقق من الحقول");
      return;
    }
    const receipt_url = await uploadReceipt(expReceipt);
    const { error } = await (supabase as any).from("lab_treasury_movements").insert({
      movement_type: "expense",
      movement_date: parsed.data.movement_date,
      expense_category: parsed.data.expense_category,
      amount: parsed.data.amount,
      payment_method: parsed.data.payment_method,
      description: parsed.data.description || null,
      beneficiary: parsed.data.beneficiary || null,
      notes: parsed.data.notes || null,
      receipt_url,
      created_by: user.id,
      status: "pending",
    });
    if (error) { toast.error("فشل التسجيل: " + error.message); return; }
    toast.success("تم تسجيل المصروف — بانتظار الاعتماد");
    setExpForm({ ...expForm, amount: "", description: "", beneficiary: "", notes: "" });
    setExpReceipt(null);
    fetchData();
  }

  async function approve(id: string) {
    const { error } = await (supabase as any).from("lab_treasury_movements")
      .update({ status: "approved" }).eq("id", id);
    if (error) toast.error("فشل الاعتماد: " + error.message);
    else { toast.success("تم اعتماد الحركة"); fetchData(); }
  }
  async function reject(id: string) {
    const reason = rejectionReason[id]?.trim();
    if (!reason) { toast.error("اكتب سبب الرفض"); return; }
    const { error } = await (supabase as any).from("lab_treasury_movements")
      .update({ status: "rejected", rejection_reason: reason }).eq("id", id);
    if (error) toast.error("فشل الرفض: " + error.message);
    else { toast.success("تم رفض الحركة"); fetchData(); }
  }
  async function removeMovement(id: string) {
    if (!confirm("تأكيد حذف الحركة؟")) return;
    const { error } = await (supabase as any).from("lab_treasury_movements").delete().eq("id", id);
    if (error) toast.error("فشل الحذف: " + error.message);
    else { toast.success("تم الحذف"); fetchData(); }
  }

  function exportExcel() {
    const rows = filtered.map((m) => ({
      "التاريخ": m.movement_date,
      "النوع": m.movement_type === "income" ? "إيراد" : "مصروف",
      "البيان": m.movement_type === "income"
        ? INCOME_LABELS[m.income_category as IncomeCat] || ""
        : EXPENSE_LABELS[m.expense_category as ExpenseCat] || "",
      "العميل/المستفيد": m.customer_name || m.beneficiary || "",
      "وارد": m.movement_type === "income" ? Number(m.amount) : 0,
      "منصرف": m.movement_type === "expense" ? Number(m.amount) : 0,
      "طريقة الدفع": PAYMENT_LABELS[m.payment_method],
      "الرصيد بعد": m.balance_after ?? "",
      "الحالة": STATUS_LABELS[m.status],
      "سجّل بواسطة": profiles[m.created_by || ""] || "",
      "ملاحظات": m.notes || "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "خزنة المعمل");
    XLSX.writeFile(wb, `lab-treasury-${todayStr}.xlsx`);
  }

  function printReport(title: string) {
    const rowsHtml = filtered.map((m) => `
      <tr>
        <td>${escapeHtml(m.movement_date)}</td>
        <td>${m.movement_type === "income" ? "إيراد" : "مصروف"}</td>
        <td>${escapeHtml(m.movement_type === "income"
          ? INCOME_LABELS[m.income_category as IncomeCat] || ""
          : EXPENSE_LABELS[m.expense_category as ExpenseCat] || "")}</td>
        <td>${escapeHtml(m.customer_name || m.beneficiary || "")}</td>
        <td class="num">${m.movement_type === "income" ? fmtNum(m.amount, 2) : "—"}</td>
        <td class="num">${m.movement_type === "expense" ? fmtNum(m.amount, 2) : "—"}</td>
        <td>${PAYMENT_LABELS[m.payment_method]}</td>
        <td class="num">${m.balance_after != null ? fmtNum(m.balance_after, 2) : "—"}</td>
        <td>${STATUS_LABELS[m.status]}</td>
        <td>${escapeHtml(profiles[m.created_by || ""] || "")}</td>
      </tr>`).join("");

    const totalIn = filtered.filter((m) => m.movement_type === "income" && m.status === "approved").reduce((s, m) => s + Number(m.amount), 0);
    const totalOut = filtered.filter((m) => m.movement_type === "expense" && m.status === "approved").reduce((s, m) => s + Number(m.amount), 0);

    const body = `
      <header>
        <div><h1>${escapeHtml(title)}</h1><div class="en">Lab & Brooding Treasury</div></div>
        <div class="meta">${fmtDate(new Date())}</div>
      </header>
      <div class="stats">
        <div class="stat"><div class="k">إجمالي الوارد</div><div class="v num">${fmtNum(totalIn, 2)}</div></div>
        <div class="stat"><div class="k">إجمالي المنصرف</div><div class="v num">${fmtNum(totalOut, 2)}</div></div>
        <div class="stat"><div class="k">صافي الحركة</div><div class="v num">${fmtNum(totalIn - totalOut, 2)}</div></div>
        <div class="stat"><div class="k">عدد الحركات</div><div class="v num">${filtered.length}</div></div>
      </div>
      <table>
        <thead><tr>
          <th>التاريخ</th><th>النوع</th><th>البيان</th><th>العميل/المستفيد</th>
          <th>وارد</th><th>منصرف</th><th>طريقة الدفع</th><th>الرصيد بعد</th>
          <th>الحالة</th><th>سجّل بواسطة</th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>`;
    openPrintWindow(title, body);
  }

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <Wallet className="w-7 h-7 text-primary" />
            <h1 className="text-2xl font-bold">خزنة المعمل والحضانات</h1>
            <Badge variant="outline">المسؤول: محمد خالد</Badge>
          </div>
        </div>

        <Tabs defaultValue="dashboard" className="w-full">
          <TabsList className="flex flex-wrap h-auto">
            <TabsTrigger value="dashboard">لوحة الخزنة</TabsTrigger>
            <TabsTrigger value="income">إضافة إيراد</TabsTrigger>
            <TabsTrigger value="expense">إضافة مصروف</TabsTrigger>
            <TabsTrigger value="log">سجل الحركات</TabsTrigger>
            {canApprove && <TabsTrigger value="approvals">الاعتمادات</TabsTrigger>}
            <TabsTrigger value="reports">التقارير</TabsTrigger>
          </TabsList>

          {/* Dashboard */}
          <TabsContent value="dashboard" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard icon={<CircleDollarSign />} title="إجمالي رصيد الخزنة" value={fmtNum(totalBalance, 2)} accent />
              <StatCard icon={<Banknote />} title="الرصيد النقدي" value={fmtNum(balancesByMethod.cash, 2)} />
              <StatCard icon={<Smartphone />} title="فودافون كاش" value={fmtNum(balancesByMethod.vodafone_cash, 2)} />
              <StatCard icon={<CreditCard />} title="إنستا باي" value={fmtNum(balancesByMethod.instapay, 2)} />
              <StatCard icon={<Building2 />} title="تحويل بنكي" value={fmtNum(balancesByMethod.bank_transfer, 2)} />
              <StatCard icon={<TrendingUp />} title="إيرادات اليوم" value={fmtNum(todayIncome, 2)} />
              <StatCard icon={<TrendingDown />} title="مصروفات اليوم" value={fmtNum(todayExpense, 2)} />
              <StatCard icon={<CircleDollarSign />} title="صافي اليوم" value={fmtNum(todayIncome - todayExpense, 2)} />
              <StatCard icon={<TrendingUp />} title="إيرادات الشهر" value={fmtNum(monthIncome, 2)} />
              <StatCard icon={<TrendingDown />} title="مصروفات الشهر" value={fmtNum(monthExpense, 2)} />
              <StatCard icon={<CircleDollarSign />} title="صافي الشهر" value={fmtNum(monthIncome - monthExpense, 2)} />
              <StatCard icon={<TrendingDown />} title={`أعلى بند مصروف (${topExpenseCat.label})`} value={fmtNum(topExpenseCat.value, 2)} />
              <StatCard icon={<TrendingUp />} title="إجمالي إيرادات التفريخ" value={fmtNum(totalHatching, 2)} />
              <StatCard icon={<TrendingUp />} title="إجمالي إيرادات بيع الكتاكيت" value={fmtNum(totalChickSales, 2)} />
            </div>
          </TabsContent>

          {/* Income form */}
          <TabsContent value="income">
            <Card>
              <CardHeader><CardTitle>إضافة إيراد جديد</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                <Field label="التاريخ">
                  <Input type="date" value={incForm.movement_date} onChange={(e) => setIncForm({ ...incForm, movement_date: e.target.value })} />
                </Field>
                <Field label="نوع الإيراد">
                  <Select value={incForm.income_category} onValueChange={(v) => setIncForm({ ...incForm, income_category: v as IncomeCat })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(INCOME_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="اسم العميل">
                  <Input value={incForm.customer_name} onChange={(e) => setIncForm({ ...incForm, customer_name: e.target.value })} />
                </Field>
                <Field label="العدد (بيض/كتاكيت)">
                  <Input type="number" value={incForm.units_count} onChange={(e) => setIncForm({ ...incForm, units_count: e.target.value })} />
                </Field>
                <Field label="سعر الوحدة">
                  <Input type="number" value={incForm.unit_price} onChange={(e) => {
                    const up = e.target.value;
                    const units = Number(incForm.units_count) || 0;
                    setIncForm({ ...incForm, unit_price: up, amount: up && units ? String(Number(up) * units) : incForm.amount });
                  }} />
                </Field>
                <Field label="إجمالي المبلغ *">
                  <Input type="number" value={incForm.amount} onChange={(e) => setIncForm({ ...incForm, amount: e.target.value })} />
                </Field>
                <Field label="طريقة التحصيل">
                  <Select value={incForm.payment_method} onValueChange={(v) => setIncForm({ ...incForm, payment_method: v as PaymentMethod })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(PAYMENT_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="الوصف"><Input value={incForm.description} onChange={(e) => setIncForm({ ...incForm, description: e.target.value })} /></Field>
                <Field label="صورة الإيصال">
                  <Input type="file" accept="image/*,application/pdf" onChange={(e) => setIncReceipt(e.target.files?.[0] || null)} />
                </Field>
                <div className="md:col-span-2 lg:col-span-3">
                  <Field label="ملاحظات"><Textarea value={incForm.notes} onChange={(e) => setIncForm({ ...incForm, notes: e.target.value })} /></Field>
                </div>
                <div className="md:col-span-2 lg:col-span-3">
                  <Button onClick={submitIncome} className="gap-2"><Plus className="w-4 h-4" />تسجيل الإيراد</Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Expense form */}
          <TabsContent value="expense">
            <Card>
              <CardHeader><CardTitle>إضافة مصروف جديد</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                <Field label="التاريخ"><Input type="date" value={expForm.movement_date} onChange={(e) => setExpForm({ ...expForm, movement_date: e.target.value })} /></Field>
                <Field label="بند المصروف">
                  <Select value={expForm.expense_category} onValueChange={(v) => setExpForm({ ...expForm, expense_category: v as ExpenseCat })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(EXPENSE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="المبلغ *"><Input type="number" value={expForm.amount} onChange={(e) => setExpForm({ ...expForm, amount: e.target.value })} /></Field>
                <Field label="طريقة الدفع">
                  <Select value={expForm.payment_method} onValueChange={(v) => setExpForm({ ...expForm, payment_method: v as PaymentMethod })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(PAYMENT_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="المستفيد / الجهة"><Input value={expForm.beneficiary} onChange={(e) => setExpForm({ ...expForm, beneficiary: e.target.value })} /></Field>
                <Field label="الوصف"><Input value={expForm.description} onChange={(e) => setExpForm({ ...expForm, description: e.target.value })} /></Field>
                <Field label="صورة الإيصال">
                  <Input type="file" accept="image/*,application/pdf" onChange={(e) => setExpReceipt(e.target.files?.[0] || null)} />
                </Field>
                <div className="md:col-span-2 lg:col-span-3">
                  <Field label="ملاحظات"><Textarea value={expForm.notes} onChange={(e) => setExpForm({ ...expForm, notes: e.target.value })} /></Field>
                </div>
                <div className="md:col-span-2 lg:col-span-3">
                  <Button onClick={submitExpense} className="gap-2"><Plus className="w-4 h-4" />تسجيل المصروف</Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Log */}
          <TabsContent value="log" className="space-y-3">
            <Card>
              <CardHeader><CardTitle>فلاتر</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
                <Field label="من"><Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></Field>
                <Field label="إلى"><Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} /></Field>
                <Field label="النوع">
                  <Select value={fType} onValueChange={setFType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">الكل</SelectItem>
                      <SelectItem value="income">إيراد</SelectItem>
                      <SelectItem value="expense">مصروف</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="التصنيف">
                  <Select value={fCategory} onValueChange={setFCategory}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">الكل</SelectItem>
                      {Object.entries(INCOME_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                      {Object.entries(EXPENSE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="طريقة الدفع">
                  <Select value={fPayment} onValueChange={setFPayment}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">الكل</SelectItem>
                      {Object.entries(PAYMENT_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="الحالة">
                  <Select value={fStatus} onValueChange={setFStatus}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">الكل</SelectItem>
                      {Object.entries(STATUS_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="العميل"><Input value={fCustomer} onChange={(e) => setFCustomer(e.target.value)} placeholder="بحث..." /></Field>
              </CardContent>
            </Card>

            <div className="flex gap-2 flex-wrap">
              <Button variant="outline" onClick={exportExcel} className="gap-2"><FileSpreadsheet className="w-4 h-4" />Excel</Button>
              <Button variant="outline" onClick={() => printReport("كشف حركة خزنة المعمل والحضانات")} className="gap-2"><Printer className="w-4 h-4" />طباعة / PDF</Button>
            </div>

            <Card>
              <CardContent className="p-0 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>التاريخ</TableHead>
                      <TableHead>النوع</TableHead>
                      <TableHead>البيان</TableHead>
                      <TableHead>وارد</TableHead>
                      <TableHead>منصرف</TableHead>
                      <TableHead>طريقة</TableHead>
                      <TableHead>رصيد بعد</TableHead>
                      <TableHead>الحالة</TableHead>
                      <TableHead>سجّل بواسطة</TableHead>
                      <TableHead>ملاحظات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow><TableCell colSpan={10} className="text-center py-8">جارٍ التحميل...</TableCell></TableRow>
                    ) : filtered.length === 0 ? (
                      <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">لا توجد حركات</TableCell></TableRow>
                    ) : filtered.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell>{m.movement_date}</TableCell>
                        <TableCell>{m.movement_type === "income" ? <Badge variant="default">إيراد</Badge> : <Badge variant="destructive">مصروف</Badge>}</TableCell>
                        <TableCell>{m.movement_type === "income"
                          ? INCOME_LABELS[m.income_category as IncomeCat]
                          : EXPENSE_LABELS[m.expense_category as ExpenseCat]}
                          {m.customer_name && <div className="text-xs text-muted-foreground">{m.customer_name}</div>}
                          {m.beneficiary && <div className="text-xs text-muted-foreground">{m.beneficiary}</div>}
                        </TableCell>
                        <TableCell className="font-mono">{m.movement_type === "income" ? fmtNum(m.amount, 2) : "—"}</TableCell>
                        <TableCell className="font-mono">{m.movement_type === "expense" ? fmtNum(m.amount, 2) : "—"}</TableCell>
                        <TableCell>{PAYMENT_LABELS[m.payment_method]}</TableCell>
                        <TableCell className="font-mono">{m.balance_after != null ? fmtNum(m.balance_after, 2) : "—"}</TableCell>
                        <TableCell><StatusBadge s={m.status} /></TableCell>
                        <TableCell className="text-xs">{profiles[m.created_by || ""] || "—"}</TableCell>
                        <TableCell className="text-xs max-w-[200px] truncate" title={m.notes || ""}>{m.notes || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Approvals */}
          {canApprove && (
            <TabsContent value="approvals" className="space-y-3">
              <Card>
                <CardHeader><CardTitle>الحركات بانتظار الاعتماد</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {movements.filter((m) => m.status === "pending").length === 0 && (
                    <div className="text-center text-muted-foreground py-6">لا توجد حركات معلقة</div>
                  )}
                  {movements.filter((m) => m.status === "pending").map((m) => (
                    <div key={m.id} className="border rounded-md p-3 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant={m.movement_type === "income" ? "default" : "destructive"}>
                          {m.movement_type === "income" ? "إيراد" : "مصروف"}
                        </Badge>
                        <span className="font-semibold">{fmtNum(m.amount, 2)} ج</span>
                        <span className="text-sm text-muted-foreground">{m.movement_date}</span>
                        <Badge variant="outline">{PAYMENT_LABELS[m.payment_method]}</Badge>
                        <span className="text-sm">
                          {m.movement_type === "income"
                            ? INCOME_LABELS[m.income_category as IncomeCat]
                            : EXPENSE_LABELS[m.expense_category as ExpenseCat]}
                        </span>
                        <span className="text-xs text-muted-foreground">— {profiles[m.created_by || ""] || ""}</span>
                      </div>
                      {(m.customer_name || m.beneficiary || m.description || m.notes) && (
                        <div className="text-xs text-muted-foreground space-y-0.5">
                          {m.customer_name && <div>عميل: {m.customer_name}</div>}
                          {m.beneficiary && <div>مستفيد: {m.beneficiary}</div>}
                          {m.description && <div>وصف: {m.description}</div>}
                          {m.notes && <div>ملاحظات: {m.notes}</div>}
                        </div>
                      )}
                      <div className="flex gap-2 items-center flex-wrap">
                        <Button size="sm" onClick={() => approve(m.id)} className="gap-1"><CheckCircle2 className="w-4 h-4" />اعتماد</Button>
                        <Input placeholder="سبب الرفض" value={rejectionReason[m.id] || ""} onChange={(e) => setRejectionReason({ ...rejectionReason, [m.id]: e.target.value })} className="max-w-xs h-9" />
                        <Button size="sm" variant="destructive" onClick={() => reject(m.id)} className="gap-1"><XCircle className="w-4 h-4" />رفض</Button>
                        {isGeneralManager && (
                          <Button size="sm" variant="outline" onClick={() => removeMovement(m.id)}>حذف</Button>
                        )}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>
          )}

          {/* Reports */}
          <TabsContent value="reports" className="space-y-3">
            <Card>
              <CardHeader><CardTitle>التقارير</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  استخدم الفلاتر في تبويب «سجل الحركات» لاختيار الفترة/النوع/البند/طريقة الدفع، ثم اطبع أو صدّر.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => { setFromDate(todayStr); setToDate(todayStr); printReport("تقرير يومي - خزنة المعمل والحضانات"); }}>تقرير يومي</Button>
                  <Button variant="outline" onClick={() => { setFromDate(`${monthStart}-01`); setToDate(todayStr); printReport("تقرير شهري - خزنة المعمل والحضانات"); }}>تقرير شهري</Button>
                  <Button variant="outline" onClick={() => { setFCategory("hatching"); setFType("income"); printReport("تقرير إيرادات التفريخ"); }}>إيرادات التفريخ</Button>
                  <Button variant="outline" onClick={() => { setFCategory("chick_sales"); setFType("income"); printReport("تقرير إيرادات بيع الكتاكيت"); }}>إيرادات بيع الكتاكيت</Button>
                  <Button variant="outline" onClick={() => { setFType("expense"); printReport("تقرير المصروفات حسب البند"); }}>المصروفات حسب البند</Button>
                  <Button variant="outline" onClick={exportExcel} className="gap-2"><FileSpreadsheet className="w-4 h-4" />تصدير Excel</Button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 pt-3">
                  <StatCard title="إجمالي الإيرادات (الشهر)" value={fmtNum(monthIncome, 2)} icon={<TrendingUp />} />
                  <StatCard title="إجمالي المصروفات (الشهر)" value={fmtNum(monthExpense, 2)} icon={<TrendingDown />} />
                  <StatCard title="صافي التشغيل (الشهر)" value={fmtNum(monthIncome - monthExpense, 2)} icon={<CircleDollarSign />} accent />
                  <StatCard title="رواتب الشهر (مزرعة+معمل+حضانات)" value={fmtNum(
                    approved.filter((m) => m.movement_date.startsWith(monthStart) &&
                      (m.expense_category === "salaries_mother_farm" || m.expense_category === "salaries_hatchery" || m.expense_category === "salaries_brooding"))
                      .reduce((s, m) => s + Number(m.amount), 0), 2
                  )} icon={<TrendingDown />} />
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

function StatCard({ title, value, icon, accent }: { title: string; value: string; icon?: React.ReactNode; accent?: boolean }) {
  return (
    <Card className={accent ? "border-primary" : ""}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs text-muted-foreground">{title}</div>
          {icon && <div className={"w-5 h-5 " + (accent ? "text-primary" : "text-muted-foreground")}>{icon}</div>}
        </div>
        <div className={"text-xl font-bold font-mono mt-1 " + (accent ? "text-primary" : "")}>{value}</div>
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function StatusBadge({ s }: { s: Status }) {
  if (s === "approved") return <Badge className="gap-1"><CheckCircle2 className="w-3 h-3" />معتمدة</Badge>;
  if (s === "rejected") return <Badge variant="destructive" className="gap-1"><XCircle className="w-3 h-3" />مرفوضة</Badge>;
  return <Badge variant="secondary" className="gap-1"><Hourglass className="w-3 h-3" />بانتظار الاعتماد</Badge>;
}
