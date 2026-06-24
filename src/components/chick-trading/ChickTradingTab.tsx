import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Plus, ShoppingCart, DollarSign, Skull, Wheat, Pill, FileText,
  TrendingUp, TrendingDown, Wallet, Tag, X, CheckCircle2,
  Pencil, Printer, Link2, ExternalLink,
} from "lucide-react";
import { fmtNum, fmtDate, openPrintWindow, escapeHtml, COMPANY_AR } from "@/lib/printPdf";

const fmtEGP = (v: any) => `${fmtNum(Number(v || 0), 2)} ج.م`;

type Batch = {
  id: string; batch_no: string; supplier_name: string; purchase_date: string;
  age_at_purchase: number; original_count: number; current_count: number;
  dead_count: number; sold_count: number; unit_purchase_price: number;
  purchase_total: number; transport_cost: number; disinfection_cost: number;
  other_costs: number; status: string; treasury_source: string; notes?: string;
  created_at: string;
  payment_status?: string; paid_amount?: number;
  deferred_paid_at?: string | null; deferred_payment_treasury?: string | null;
  linked_brooding_batch_id?: string | null;
};
type Sale = {
  id: string; sale_no: string; batch_id: string; customer_name: string; phone?: string;
  address?: string; quantity: number; unit_price: number; total: number;
  payment_method: string; treasury_destination?: string; sale_date: string;
  collected: boolean; collected_at?: string; collection_treasury?: string;
  status: string; notes?: string; created_at: string;
};

const TREASURY_LABEL: Record<string, string> = {
  lab: "خزنة المعمل والحضانات",
  main: "الخزنة الرئيسية",
  customer_debt: "تسوية من مديونية عميل",
  deferred: "شراء آجل / بدون دفع حالي",
};

const batchTotalCost = (b: Batch) =>
  (Number(b.original_count) * Number(b.unit_purchase_price)) +
  Number(b.transport_cost || 0) + Number(b.disinfection_cost || 0) + Number(b.other_costs || 0);

// ============ Hook ============
const useChickTrading = () => {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [mortality, setMortality] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    setLoading(true);
    const [b, s, e, m] = await Promise.all([
      supabase.from("chick_trading_batches" as any).select("*").order("created_at", { ascending: false }),
      supabase.from("chick_trading_sales" as any).select("*").order("created_at", { ascending: false }),
      supabase.from("chick_trading_expenses" as any).select("*").order("created_at", { ascending: false }),
      supabase.from("chick_trading_mortality" as any).select("*").order("created_at", { ascending: false }),
    ]);
    setBatches((b.data || []) as any);
    setSales((s.data || []) as any);
    setExpenses(e.data || []);
    setMortality(m.data || []);
    setLoading(false);
  };
  useEffect(() => { reload(); }, []);
  return { batches, sales, expenses, mortality, loading, reload };
};

// ============ Purchase Dialog ============
const NewPurchaseDialog = ({ onSaved }: { onSaved: () => void }) => {
  const { isGeneralManager, isExecutiveManager, isAccountant, isHatcheryManager, roles } = useAuth();
  const isBroodingManager = (roles || []).includes("brooding_manager");
  const canUseDebtSettlement = isGeneralManager || isExecutiveManager || isAccountant;
  const canUseDeferred = isGeneralManager || isExecutiveManager || isAccountant || isHatcheryManager || isBroodingManager;
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState({
    supplier_name: "", purchase_date: new Date().toISOString().slice(0, 10),
    age_at_purchase: 1, count: 0, unit_price: 0,
    transport_cost: 0, disinfection_cost: 0, other_costs: 0,
    treasury_source: "lab" as "lab" | "main" | "customer_debt" | "deferred",
    notes: "", attachment_url: "",
    settlement_customer: "",
    settlement_amount: 0,
    diff_treasury_source: "lab" as "lab" | "main" | "none",
    settlement_notes: "",
  });
  const total = (Number(f.count) * Number(f.unit_price)) +
    Number(f.transport_cost) + Number(f.disinfection_cost) + Number(f.other_costs);

  // Customers with outstanding debt
  const [debtCustomers, setDebtCustomers] = useState<Array<{ customer_name: string; balance: number }>>([]);
  const [customerBalance, setCustomerBalance] = useState<number>(0);
  useEffect(() => {
    if (!open || f.treasury_source !== "customer_debt") return;
    supabase.rpc("chick_trading_customers_with_debt" as any).then(({ data }) => {
      setDebtCustomers((data || []) as any);
    });
  }, [open, f.treasury_source]);
  useEffect(() => {
    if (f.treasury_source !== "customer_debt" || !f.settlement_customer) { setCustomerBalance(0); return; }
    supabase.rpc("chick_trading_customer_balance" as any, { _customer: f.settlement_customer })
      .then(({ data }) => setCustomerBalance(Number(data || 0)));
  }, [f.settlement_customer, f.treasury_source]);

  // Auto-fill settlement amount with min(balance, total)
  useEffect(() => {
    if (f.treasury_source !== "customer_debt") return;
    const suggested = Math.min(customerBalance, total);
    setF(prev => ({ ...prev, settlement_amount: Number(suggested.toFixed(2)) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerBalance, total, f.treasury_source]);

  const diffAmount = f.treasury_source === "customer_debt"
    ? Math.max(0, total - Number(f.settlement_amount || 0))
    : 0;
  const remainingDebt = Math.max(0, customerBalance - Number(f.settlement_amount || 0));

  const save = async () => {
    if (!f.supplier_name.trim()) return toast.error("اسم المورد مطلوب");
    if (!f.count || !f.unit_price) return toast.error("العدد والسعر مطلوبان");
    if (f.treasury_source === "deferred" && !canUseDeferred) {
      return toast.error("لا تملك صلاحية تسجيل شراء آجل");
    }
    if (f.treasury_source === "customer_debt") {
      if (!canUseDebtSettlement) return toast.error("لا تملك صلاحية تسوية مديونية عميل");
      if (!f.settlement_customer) return toast.error("اختر العميل");
      if (!f.settlement_amount || f.settlement_amount <= 0) return toast.error("قيمة التسوية مطلوبة");
      if (f.settlement_amount > customerBalance) {
        return toast.error(`قيمة التسوية أكبر من رصيد مديونية العميل (${fmtEGP(customerBalance)})`);
      }
      if (f.settlement_amount > total) {
        return toast.error("قيمة التسوية أكبر من إجمالي الشراء");
      }
    }
    setSaving(true);
    const { error } = await supabase.rpc("chick_trading_create_purchase_v2" as any, {
      _supplier: f.supplier_name, _purchase_date: f.purchase_date, _age: f.age_at_purchase,
      _count: f.count, _unit_price: f.unit_price,
      _transport: f.transport_cost, _disinfection: f.disinfection_cost, _other: f.other_costs,
      _treasury_source: f.treasury_source, _main_account_id: null,
      _notes: f.notes || null, _attachment_url: f.attachment_url || null,
      _settlement_customer: f.treasury_source === "customer_debt" ? f.settlement_customer : null,
      _settlement_amount: f.treasury_source === "customer_debt" ? f.settlement_amount : 0,
      _diff_treasury_source: f.treasury_source === "customer_debt" && diffAmount > 0 ? f.diff_treasury_source : null,
      _settlement_notes: f.treasury_source === "customer_debt" ? (f.settlement_notes || null) : null,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    if (f.treasury_source === "customer_debt") {
      toast.success(`تم خصم ${fmtEGP(f.settlement_amount)} من مديونية العميل. المتبقي عليه: ${fmtEGP(remainingDebt)}`);
    } else if (f.treasury_source === "deferred") {
      toast.success("تم تسجيل دفعة الكتاكيت كشراء آجل بدون خصم من أي خزنة");
    } else {
      toast.success("تم تسجيل شراء كتاكيت التجارة وخصم الخزنة");
    }
    setOpen(false); onSaved();
    setF({
      ...f, supplier_name: "", count: 0, unit_price: 0,
      transport_cost: 0, disinfection_cost: 0, other_costs: 0,
      notes: "", settlement_customer: "", settlement_amount: 0, settlement_notes: "",
    });
  };

  const summaryLabel = f.treasury_source === "customer_debt"
    ? (diffAmount > 0
        ? `إجمالي يُسوّى من مديونية العميل + فرق يُخصم من ${TREASURY_LABEL[f.diff_treasury_source] || ""}:`
        : "إجمالي يُسوّى من مديونية العميل:")
    : f.treasury_source === "deferred"
      ? "إجمالي شراء آجل (لن يُخصم من أي خزنة الآن):"
      : `إجمالي يُخصم من ${TREASURY_LABEL[f.treasury_source]}:`;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2 bg-gradient-to-l from-purple-600 to-orange-500 text-white">
          <ShoppingCart className="w-4 h-4" /> شراء كتاكيت تجارة
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-auto" dir="rtl">
        <DialogHeader><DialogTitle>شراء كتاكيت تجارة</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>اسم المزرعة / المورد *</Label>
            <Input value={f.supplier_name} onChange={e => setF({ ...f, supplier_name: e.target.value })} /></div>
          <div><Label>تاريخ الشراء</Label>
            <Input type="date" value={f.purchase_date} onChange={e => setF({ ...f, purchase_date: e.target.value })} /></div>
          <div><Label>عدد الكتاكيت *</Label>
            <Input type="number" value={f.count} onChange={e => setF({ ...f, count: +e.target.value })} /></div>
          <div><Label>عمر الكتاكيت (يوم) *</Label>
            <Input type="number" value={f.age_at_purchase} onChange={e => setF({ ...f, age_at_purchase: +e.target.value })} /></div>
          <div><Label>سعر الكتكوت *</Label>
            <Input type="number" step="0.01" value={f.unit_price} onChange={e => setF({ ...f, unit_price: +e.target.value })} /></div>
          <div><Label>إجمالي الشراء</Label>
            <Input readOnly value={fmtEGP(f.count * f.unit_price)} className="bg-muted" /></div>
          <div><Label>رسوم النقل</Label>
            <Input type="number" step="0.01" value={f.transport_cost} onChange={e => setF({ ...f, transport_cost: +e.target.value })} /></div>
          <div><Label>دخان/تطهير/أدوية بداية</Label>
            <Input type="number" step="0.01" value={f.disinfection_cost} onChange={e => setF({ ...f, disinfection_cost: +e.target.value })} /></div>
          <div><Label>مصروفات إضافية</Label>
            <Input type="number" step="0.01" value={f.other_costs} onChange={e => setF({ ...f, other_costs: +e.target.value })} /></div>
          <div><Label>الفلوس هتطلع من أي خزنة؟ *</Label>
            <Select value={f.treasury_source} onValueChange={(v: any) => setF({ ...f, treasury_source: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="lab">خزنة المعمل والحضانات</SelectItem>
                <SelectItem value="main">الخزنة الرئيسية</SelectItem>
                {canUseDebtSettlement && (
                  <SelectItem value="customer_debt">تسوية من مديونية عميل</SelectItem>
                )}
                {canUseDeferred && (
                  <SelectItem value="deferred">شراء آجل / بدون دفع حالي</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>

          {f.treasury_source === "deferred" && (
            <div className="col-span-2 p-3 rounded-md bg-amber-50 border border-amber-300 text-xs text-amber-900 space-y-1">
              <div className="font-bold">⚠️ شراء آجل / بدون دفع حالي</div>
              <div>لن يتم خصم أي مبلغ من خزنة المعمل أو الخزنة الرئيسية الآن.</div>
              <div>الدفعة ستظهر بحالة «غير مدفوع» ويمكن سدادها لاحقًا من تفاصيل الدفعة.</div>
            </div>
          )}

          {f.treasury_source === "customer_debt" && (
            <>
              <div className="col-span-2 p-3 rounded-md bg-amber-50 border border-amber-300 text-xs text-amber-900">
                ⚠️ لن يتم خصم أي مبلغ من الخزنة إلا إذا كان هناك فرق بين قيمة الشراء ومديونية العميل.
              </div>
              <div className="col-span-2"><Label>اسم العميل *</Label>
                <Select value={f.settlement_customer} onValueChange={v => setF({ ...f, settlement_customer: v })}>
                  <SelectTrigger><SelectValue placeholder="اختر عميل عليه مديونية" /></SelectTrigger>
                  <SelectContent>
                    {debtCustomers.length === 0 && (
                      <div className="p-2 text-xs text-muted-foreground text-center">
                        لا يوجد عملاء عليهم مديونية في تجارة الكتاكيت
                      </div>
                    )}
                    {debtCustomers.map(c => (
                      <SelectItem key={c.customer_name} value={c.customer_name}>
                        {c.customer_name} — رصيده: {fmtEGP(c.balance)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>رصيد مديونية العميل الحالي</Label>
                <Input readOnly value={fmtEGP(customerBalance)} className="bg-muted" /></div>
              <div><Label>قيمة الكتاكيت / الشراء</Label>
                <Input readOnly value={fmtEGP(total)} className="bg-muted" /></div>
              <div><Label>المبلغ الذي سيُخصم من الدين *</Label>
                <Input type="number" step="0.01" value={f.settlement_amount}
                  onChange={e => setF({ ...f, settlement_amount: +e.target.value })} /></div>
              <div><Label>المتبقي على العميل بعد التسوية</Label>
                <Input readOnly value={fmtEGP(remainingDebt)} className="bg-muted font-semibold" /></div>
              {diffAmount > 0 && (
                <div className="col-span-2"><Label>طريقة دفع الفرق ({fmtEGP(diffAmount)}) *</Label>
                  <Select value={f.diff_treasury_source} onValueChange={(v: any) => setF({ ...f, diff_treasury_source: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="lab">خزنة المعمل والحضانات</SelectItem>
                      <SelectItem value="main">الخزنة الرئيسية</SelectItem>
                      <SelectItem value="none">نقدي لاحقًا (بدون خصم خزنة)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="col-span-2"><Label>سبب / ملاحظات التسوية</Label>
                <Textarea value={f.settlement_notes}
                  onChange={e => setF({ ...f, settlement_notes: e.target.value })} /></div>
            </>
          )}

          <div className="col-span-2"><Label>ملاحظات</Label>
            <Textarea value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></div>
          <div className="col-span-2 p-3 rounded-md bg-purple-50 border border-purple-200 flex justify-between">
            <span className="font-semibold">{summaryLabel}</span>
            <span className="font-bold text-purple-700 text-lg">{fmtEGP(total)}</span>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={saving} className="bg-purple-600 hover:bg-purple-700">
            {saving ? "جاري الحفظ..." : "حفظ الشراء"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ============ Sale Dialog ============
const NewSaleDialog = ({ batches, onSaved }: { batches: Batch[]; onSaved: () => void }) => {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const open_batches = batches.filter(b => b.status === "open" && b.current_count > 0);
  const [f, setF] = useState({
    batch_id: "", customer_name: "", phone: "", address: "",
    quantity: 0, unit_price: 0,
    payment_method: "cash" as "cash" | "credit" | "transfer",
    treasury_destination: "lab" as "lab" | "main",
    sale_date: new Date().toISOString().slice(0, 10), notes: "",
  });
  const selected = open_batches.find(b => b.id === f.batch_id);
  const [pnl, setPnl] = useState<any>(null);
  const [loadingPnl, setLoadingPnl] = useState(false);
  useEffect(() => {
    if (!f.batch_id) { setPnl(null); return; }
    setLoadingPnl(true);
    (async () => {
      const { data } = await supabase.rpc("chick_trading_batch_pnl" as any, { _batch_id: f.batch_id });
      setPnl(data);
      setLoadingPnl(false);
    })();
  }, [f.batch_id]);
  const costPerChick = pnl?.current_cost_per_chick ? Number(pnl.current_cost_per_chick) : 0;
  const profitPer = f.unit_price - costPerChick;
  const total = f.quantity * f.unit_price;
  const totalSoldCost = f.quantity * costPerChick;
  const totalProfit = total - totalSoldCost;
  const noCost = !!selected && (!pnl || Number(pnl?.total_cost || 0) === 0);

  const save = async () => {
    if (!f.batch_id) return toast.error("اختر الدفعة");
    if (!f.customer_name.trim()) return toast.error("اسم العميل مطلوب");
    if (!f.quantity || !f.unit_price) return toast.error("العدد والسعر مطلوبان");
    if (selected && f.quantity > selected.current_count) {
      return toast.error(`المتاح فقط ${selected.current_count} كتكوت`);
    }
    setSaving(true);
    const { error } = await supabase.rpc("chick_trading_create_sale" as any, {
      _batch_id: f.batch_id, _customer: f.customer_name, _phone: f.phone || null,
      _address: f.address || null, _quantity: f.quantity, _unit_price: f.unit_price,
      _payment_method: f.payment_method,
      _treasury_destination: f.payment_method === "credit" ? null : f.treasury_destination,
      _main_account_id: null, _sale_date: f.sale_date, _notes: f.notes || null,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("تم تسجيل بيع كتاكيت التجارة");
    setOpen(false); onSaved();
    setF({ ...f, customer_name: "", phone: "", address: "", quantity: 0, unit_price: 0, notes: "" });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2 border-orange-400 text-orange-700">
          <DollarSign className="w-4 h-4" /> بيع كتاكيت تجارة
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl" dir="rtl">
        <DialogHeader><DialogTitle>بيع كتاكيت تجارة</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><Label>الدفعة *</Label>
            <Select value={f.batch_id} onValueChange={v => setF({ ...f, batch_id: v })}>
              <SelectTrigger><SelectValue placeholder="اختر دفعة تجارة" /></SelectTrigger>
              <SelectContent>
                {open_batches.map(b => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.batch_no} — {b.supplier_name} — متاح {b.current_count}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div><Label>اسم العميل *</Label>
            <Input value={f.customer_name} onChange={e => setF({ ...f, customer_name: e.target.value })} /></div>
          <div><Label>رقم الهاتف</Label>
            <Input value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} /></div>
          <div className="col-span-2"><Label>العنوان</Label>
            <Input value={f.address} onChange={e => setF({ ...f, address: e.target.value })} /></div>
          <div><Label>عدد الكتاكيت المباعة *</Label>
            <Input type="number" value={f.quantity} onChange={e => setF({ ...f, quantity: +e.target.value })} /></div>
          <div><Label>سعر الكتكوت *</Label>
            <Input type="number" step="0.01" value={f.unit_price} onChange={e => setF({ ...f, unit_price: +e.target.value })} /></div>
          <div><Label>تاريخ البيع</Label>
            <Input type="date" value={f.sale_date} onChange={e => setF({ ...f, sale_date: e.target.value })} /></div>
          <div><Label>طريقة الدفع</Label>
            <Select value={f.payment_method} onValueChange={(v: any) => setF({ ...f, payment_method: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">نقدي</SelectItem>
                <SelectItem value="transfer">تحويل</SelectItem>
                <SelectItem value="credit">آجل</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {f.payment_method !== "credit" && (
            <div className="col-span-2"><Label>التحصيل هيدخل في أي خزنة؟ *</Label>
              <Select value={f.treasury_destination} onValueChange={(v: any) => setF({ ...f, treasury_destination: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="lab">خزنة المعمل والحضانات</SelectItem>
                  <SelectItem value="main">الخزنة الرئيسية</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="col-span-2"><Label>ملاحظات</Label>
            <Textarea value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></div>
          {selected && (
            <div className="col-span-2 space-y-2">
              {loadingPnl && <div className="text-xs text-muted-foreground">جاري حساب التكلفة...</div>}
              {noCost && !loadingPnl && (
                <div className="p-2 rounded-md bg-amber-50 border border-amber-300 text-amber-800 text-xs">
                  ⚠️ لا توجد تكلفة محسوبة لهذه الدفعة، برجاء مراجعة الشراء والمصروفات.
                </div>
              )}
              <div className="p-3 rounded-md bg-orange-50 border border-orange-200 grid grid-cols-2 gap-2 text-sm">
                <div>المتاح للبيع: <strong>{selected.current_count}</strong></div>
                <div>إجمالي تكلفة الدفعة: <strong>{fmtEGP(Number(pnl?.total_cost || 0))}</strong></div>
                <div className="col-span-2 border-t border-orange-200 pt-2">
                  تكلفة الكتكوت عليّا: <strong className="text-orange-800">{fmtEGP(costPerChick)}</strong>
                </div>
                <div>سعر البيع للكتكوت: <strong>{fmtEGP(f.unit_price)}</strong></div>
                <div className={profitPer >= 0 ? "text-emerald-700" : "text-red-700"}>
                  ربح/كتكوت: <strong>{fmtEGP(profitPer)}</strong>
                </div>
                <div>إجمالي تكلفة المباع: <strong>{fmtEGP(totalSoldCost)}</strong></div>
                <div>إجمالي البيع: <strong>{fmtEGP(total)}</strong></div>
                <div className={`col-span-2 border-t border-orange-200 pt-2 ${totalProfit >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                  إجمالي الربح المتوقع: <strong>{fmtEGP(totalProfit)}</strong>
                </div>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={saving} className="bg-orange-600 hover:bg-orange-700">
            {saving ? "جاري الحفظ..." : "حفظ البيع"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ============ Expense Dialog ============
const AddExpenseDialog = ({ batch, onSaved }: { batch: Batch; onSaved: () => void }) => {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState({
    expense_type: "feed" as "feed" | "medicine" | "other",
    amount: 0, quantity: 0, unit: "كجم", notes: "",
    expense_date: new Date().toISOString().slice(0, 10),
    treasury_source: "lab" as "lab" | "main" | "none",
  });
  const save = async () => {
    if (!f.amount) return toast.error("القيمة مطلوبة");
    setSaving(true);
    const { error } = await supabase.rpc("chick_trading_add_expense" as any, {
      _batch_id: batch.id, _expense_type: f.expense_type, _amount: f.amount,
      _quantity: f.quantity || null, _unit: f.unit || null,
      _expense_date: f.expense_date, _notes: f.notes || null,
      _treasury_source: f.treasury_source, _main_account_id: null,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("تم تسجيل المصروف");
    setOpen(false); onSaved();
    setF({ ...f, amount: 0, quantity: 0, notes: "" });
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1"><Wheat className="w-3 h-3" />صرف</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader><DialogTitle>صرف/مصروف على دفعة {batch.batch_no}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div><Label>النوع</Label>
            <Select value={f.expense_type} onValueChange={(v: any) => setF({ ...f, expense_type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="feed">علف</SelectItem>
                <SelectItem value="medicine">أدوية</SelectItem>
                <SelectItem value="other">أخرى</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>الكمية</Label>
              <Input type="number" step="0.01" value={f.quantity} onChange={e => setF({ ...f, quantity: +e.target.value })} /></div>
            <div><Label>الوحدة</Label>
              <Input value={f.unit} onChange={e => setF({ ...f, unit: e.target.value })} /></div>
          </div>
          <div><Label>القيمة *</Label>
            <Input type="number" step="0.01" value={f.amount} onChange={e => setF({ ...f, amount: +e.target.value })} /></div>
          <div><Label>التاريخ</Label>
            <Input type="date" value={f.expense_date} onChange={e => setF({ ...f, expense_date: e.target.value })} /></div>
          <div><Label>الخزنة</Label>
            <Select value={f.treasury_source} onValueChange={(v: any) => setF({ ...f, treasury_source: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="lab">خزنة المعمل</SelectItem>
                <SelectItem value="main">الخزنة الرئيسية</SelectItem>
                <SelectItem value="none">بدون خزنة (تكلفة فقط)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>ملاحظات</Label>
            <Textarea value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></div>
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={saving}>حفظ</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ============ Mortality Dialog ============
const AddMortalityDialog = ({ batch, onSaved }: { batch: Batch; onSaved: () => void }) => {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const save = async () => {
    if (!count) return toast.error("العدد مطلوب");
    const { error } = await supabase.rpc("chick_trading_add_mortality" as any, {
      _batch_id: batch.id, _count: count, _mortality_date: date, _reason: reason || null,
    });
    if (error) return toast.error(error.message);
    toast.success("تم تسجيل النافق");
    setOpen(false); onSaved(); setCount(0); setReason("");
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1 text-red-700"><Skull className="w-3 h-3" />نافق</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader><DialogTitle>تسجيل نافق — {batch.batch_no}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div><Label>العدد *</Label><Input type="number" value={count} onChange={e => setCount(+e.target.value)} /></div>
          <div><Label>التاريخ</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
          <div><Label>السبب</Label><Textarea value={reason} onChange={e => setReason(e.target.value)} /></div>
        </div>
        <DialogFooter><Button onClick={save} variant="destructive">حفظ</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ============ Collect Sale Dialog ============
const CollectSaleDialog = ({ sale, onSaved }: { sale: Sale; onSaved: () => void }) => {
  const [open, setOpen] = useState(false);
  const [treasury, setTreasury] = useState<"lab" | "main">("lab");
  const collect = async () => {
    const { error } = await supabase.rpc("chick_trading_collect_sale" as any, {
      _sale_id: sale.id, _treasury: treasury, _main_account_id: null,
    });
    if (error) return toast.error(error.message);
    toast.success("تم تسجيل التحصيل");
    setOpen(false); onSaved();
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1 bg-emerald-600 hover:bg-emerald-700">
          <CheckCircle2 className="w-3 h-3" />تحصيل
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm" dir="rtl">
        <DialogHeader><DialogTitle>تحصيل فاتورة {sale.sale_no}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="text-sm">المبلغ: <strong>{fmtEGP(sale.total)}</strong></div>
          <div><Label>الخزنة</Label>
            <Select value={treasury} onValueChange={(v: any) => setTreasury(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="lab">خزنة المعمل والحضانات</SelectItem>
                <SelectItem value="main">الخزنة الرئيسية</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter><Button onClick={collect}>تأكيد التحصيل</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ============ Pay Deferred Purchase Dialog ============
const PayDeferredDialog = ({ batch, onSaved }: { batch: Batch; onSaved: () => void }) => {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const total = batchTotalCost(batch);
  const outstanding = Math.max(0, total - Number(batch.paid_amount || 0));
  const [treasury, setTreasury] = useState<"lab" | "main">("lab");
  const [amount, setAmount] = useState<number>(outstanding);
  const [notes, setNotes] = useState("");
  useEffect(() => { if (open) setAmount(outstanding); }, [open, outstanding]);
  const pay = async () => {
    if (!amount || amount <= 0) return toast.error("أدخل مبلغ السداد");
    if (amount > outstanding) return toast.error(`المتبقي فقط ${fmtEGP(outstanding)}`);
    setSaving(true);
    const { error } = await supabase.rpc("chick_trading_pay_deferred_purchase" as any, {
      _batch_id: batch.id, _treasury: treasury, _main_account_id: null,
      _amount: amount, _notes: notes || null,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("تم سداد قيمة الشراء وتسجيل حركة الخزنة");
    setOpen(false); onSaved();
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1 bg-amber-600 hover:bg-amber-700 text-white">
          <Wallet className="w-3 h-3" />سداد قيمة الشراء
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader><DialogTitle>سداد شراء آجل — دفعة {batch.batch_no}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="p-3 rounded-md bg-amber-50 border border-amber-200 text-xs space-y-1">
            <div>إجمالي الشراء: <strong>{fmtEGP(total)}</strong></div>
            <div>المدفوع سابقًا: <strong>{fmtEGP(batch.paid_amount || 0)}</strong></div>
            <div className="text-amber-900">المتبقي: <strong>{fmtEGP(outstanding)}</strong></div>
          </div>
          <div><Label>الخزنة *</Label>
            <Select value={treasury} onValueChange={(v: any) => setTreasury(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="lab">خزنة المعمل والحضانات</SelectItem>
                <SelectItem value="main">الخزنة الرئيسية</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>مبلغ السداد *</Label>
            <Input type="number" step="0.01" value={amount} onChange={e => setAmount(+e.target.value)} />
          </div>
          <div><Label>ملاحظات</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button onClick={pay} disabled={saving} className="bg-amber-600 hover:bg-amber-700">
            {saving ? "جاري السداد..." : "تأكيد السداد"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ============ Edit Batch Dialog (blocked if any activity) ============
const EditBatchDialog = ({ batch, hasActivity, onSaved }:
  { batch: Batch; hasActivity: boolean; onSaved: () => void }) => {
  const { isGeneralManager, isExecutiveManager, isAccountant } = useAuth();
  const canEdit = isGeneralManager || isExecutiveManager || isAccountant;
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState({
    supplier_name: batch.supplier_name,
    purchase_date: batch.purchase_date,
    age_at_purchase: batch.age_at_purchase,
    count: batch.original_count,
    unit_price: Number(batch.unit_purchase_price),
    treasury_source: batch.treasury_source,
    notes: batch.notes || "",
  });
  useEffect(() => {
    if (open) {
      setF({
        supplier_name: batch.supplier_name,
        purchase_date: batch.purchase_date,
        age_at_purchase: batch.age_at_purchase,
        count: batch.original_count,
        unit_price: Number(batch.unit_purchase_price),
        treasury_source: batch.treasury_source,
        notes: batch.notes || "",
      });
    }
  }, [open, batch]);
  if (!canEdit) return null;

  const save = async () => {
    if (hasActivity) {
      return toast.error("لا يمكن تعديل بيانات مؤثرة بعد وجود حركات على الدفعة.");
    }
    if (!f.supplier_name.trim()) return toast.error("اسم المورد مطلوب");
    if (!f.count || !f.unit_price) return toast.error("العدد والسعر مطلوبان");
    setSaving(true);
    const { error } = await supabase.rpc("chick_trading_update_batch" as any, {
      _batch_id: batch.id,
      _supplier: f.supplier_name,
      _purchase_date: f.purchase_date,
      _age: f.age_at_purchase,
      _original_count: f.count,
      _unit_price: f.unit_price,
      _treasury_source: f.treasury_source,
      _notes: f.notes || null,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("تم حفظ التعديلات");
    setOpen(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1">
          <Pencil className="w-3 h-3" />تعديل
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle>تعديل دفعة {batch.batch_no}</DialogTitle>
        </DialogHeader>
        {hasActivity ? (
          <div className="p-3 rounded-md bg-amber-50 border border-amber-300 text-sm text-amber-900">
            ⚠️ لا يمكن تعديل بيانات مؤثرة بعد وجود حركات على الدفعة (بيع/نافق/مصروف).
            استخدم حركة تصحيح إدارية لإجراء أي تعديل.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div><Label>المورد</Label>
              <Input value={f.supplier_name} onChange={e => setF({ ...f, supplier_name: e.target.value })} /></div>
            <div><Label>تاريخ الشراء</Label>
              <Input type="date" value={f.purchase_date} onChange={e => setF({ ...f, purchase_date: e.target.value })} /></div>
            <div><Label>عدد الكتاكيت</Label>
              <Input type="number" value={f.count} onChange={e => setF({ ...f, count: +e.target.value })} /></div>
            <div><Label>عمر الكتاكيت (يوم)</Label>
              <Input type="number" value={f.age_at_purchase} onChange={e => setF({ ...f, age_at_purchase: +e.target.value })} /></div>
            <div><Label>سعر الكتكوت</Label>
              <Input type="number" step="0.01" value={f.unit_price} onChange={e => setF({ ...f, unit_price: +e.target.value })} /></div>
            <div><Label>مصدر التمويل</Label>
              <Select value={f.treasury_source} onValueChange={(v: any) => setF({ ...f, treasury_source: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="lab">خزنة المعمل والحضانات</SelectItem>
                  <SelectItem value="main">الخزنة الرئيسية</SelectItem>
                  <SelectItem value="customer_debt">تسوية من مديونية عميل</SelectItem>
                  <SelectItem value="deferred">شراء آجل / بدون دفع حالي</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2"><Label>الملاحظات</Label>
              <Textarea value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></div>
            <div className="col-span-2 p-2 rounded-md bg-muted/40 text-xs text-muted-foreground">
              ℹ️ التعديل لا يُحدث أي حركة خزنة. لو الدفعة مرتبطة بدفعة تشغيلية في الحضانات هيتم تحديث بياناتها تلقائيًا.
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
          {!hasActivity && (
            <Button onClick={save} disabled={saving}>
              {saving ? "جاري الحفظ..." : "حفظ التعديلات"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ============ Print batch document ============
const printBatch = (b: Batch) => {
  const total = (Number(b.original_count) * Number(b.unit_purchase_price)) +
    Number(b.transport_cost || 0) + Number(b.disinfection_cost || 0) + Number(b.other_costs || 0);
  const paid = Number(b.paid_amount || 0);
  const outstanding = b.treasury_source === "deferred" ? Math.max(0, total - paid) : 0;
  const payStatusLabel =
    b.treasury_source !== "deferred" ? "مدفوعة" :
    (b.payment_status === "paid" ? "مسدّدة" : b.payment_status === "partial" ? "مدفوعة جزئيًا" : "غير مدفوعة (آجل)");
  const body = `
    <header>
      <div>
        <h1>${escapeHtml(COMPANY_AR)}</h1>
        <div class="en">محضر دفعة شراء — تجارة كتاكيت</div>
      </div>
      <div class="meta">
        <div>رقم الدفعة: <strong>${escapeHtml(b.batch_no)}</strong></div>
        <div>تاريخ الطباعة: ${escapeHtml(fmtDate(new Date().toISOString()))}</div>
      </div>
    </header>
    <h2>بيانات الدفعة</h2>
    <table>
      <tbody>
        <tr><th style="width:30%">المورد</th><td>${escapeHtml(b.supplier_name)}</td></tr>
        <tr><th>تاريخ الشراء</th><td>${escapeHtml(fmtDate(b.purchase_date))}</td></tr>
        <tr><th>عدد الكتاكيت</th><td class="num">${fmtNum(b.original_count)}</td></tr>
        <tr><th>عمر الكتاكيت</th><td>${fmtNum(b.age_at_purchase)} يوم</td></tr>
        <tr><th>سعر الكتكوت</th><td class="num">${fmtNum(b.unit_purchase_price, 2)} ج.م</td></tr>
        <tr><th>رسوم النقل</th><td class="num">${fmtNum(b.transport_cost, 2)} ج.م</td></tr>
        <tr><th>تطهير/بداية</th><td class="num">${fmtNum(b.disinfection_cost, 2)} ج.م</td></tr>
        <tr><th>مصروفات أخرى</th><td class="num">${fmtNum(b.other_costs, 2)} ج.م</td></tr>
        <tr><th>إجمالي قيمة الشراء</th><td class="num"><strong>${fmtNum(total, 2)} ج.م</strong></td></tr>
      </tbody>
    </table>
    <h2>التمويل والسداد</h2>
    <table>
      <tbody>
        <tr><th style="width:30%">مصدر التمويل</th><td>${escapeHtml(TREASURY_LABEL[b.treasury_source] || b.treasury_source)}</td></tr>
        <tr><th>حالة الدفع</th><td>${escapeHtml(payStatusLabel)}</td></tr>
        ${b.treasury_source === "deferred" ? `
          <tr><th>المدفوع</th><td class="num">${fmtNum(paid, 2)} ج.م</td></tr>
          <tr><th>المتبقي للمورد</th><td class="num"><strong>${fmtNum(outstanding, 2)} ج.م</strong></td></tr>
        ` : ""}
      </tbody>
    </table>
    ${b.notes ? `<h2>ملاحظات</h2><div style="padding:6px;border:1px solid #e0e0e0;border-radius:6px;background:#fafafa">${escapeHtml(b.notes)}</div>` : ""}
    <div style="margin-top:30px;display:grid;grid-template-columns:1fr 1fr;gap:20px;font-size:11px">
      <div style="border-top:1px solid #444;padding-top:6px;text-align:center">توقيع المسؤول</div>
      <div style="border-top:1px solid #444;padding-top:6px;text-align:center">توقيع المدير</div>
    </div>
  `;
  openPrintWindow(`دفعة تجارة كتاكيت ${b.batch_no}`, body);
};

// ============ Link operational batch button ============
const LinkOperationalButton = ({ batch, onSaved }:
  { batch: Batch; onSaved: () => void }) => {
  const [busy, setBusy] = useState(false);
  const create = async () => {
    if (batch.linked_brooding_batch_id) {
      toast.info("الدفعة مرتبطة بالفعل بدفعة تشغيلية");
      return;
    }
    setBusy(true);
    const { data, error } = await supabase.rpc("chick_trading_create_operational_batch" as any, { _batch_id: batch.id });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("تم إنشاء/ربط دفعة تشغيلية في دفعات الحضانات");
    onSaved();
  };
  if (batch.linked_brooding_batch_id) {
    return (
      <Button size="sm" variant="ghost" className="gap-1 text-emerald-700"
        onClick={() => window.open("/modules/brooding", "_blank")}>
        <ExternalLink className="w-3 h-3" />دفعة تشغيلية
      </Button>
    );
  }
  return (
    <Button size="sm" variant="outline" className="gap-1" onClick={create} disabled={busy}>
      <Link2 className="w-3 h-3" />{busy ? "..." : "إنشاء دفعة تشغيلية"}
    </Button>
  );
};

// ============ Batch Detail Dialog ============
const BatchDetailDialog = ({ batch, expenses, mortality, sales, onSaved }:
  { batch: Batch; expenses: any[]; mortality: any[]; sales: Sale[]; onSaved: () => void }) => {
  const [open, setOpen] = useState(false);
  const [pnl, setPnl] = useState<any>(null);
  useEffect(() => {
    if (!open) return;
    supabase.rpc("chick_trading_batch_pnl" as any, { _batch_id: batch.id }).then(({ data }) => setPnl(data));
  }, [open, batch.id, expenses.length, mortality.length, sales.length]);
  const batchExp = expenses.filter(e => e.batch_id === batch.id);
  const batchMort = mortality.filter(m => m.batch_id === batch.id);
  const batchSales = sales.filter(s => s.batch_id === batch.id);
  const [settlement, setSettlement] = useState<any>(null);
  useEffect(() => {
    if (!open || batch.treasury_source !== "customer_debt") { setSettlement(null); return; }
    supabase.from("chick_trading_debt_settlements" as any)
      .select("*").eq("purchase_batch_id", batch.id).maybeSingle()
      .then(({ data }) => setSettlement(data));
  }, [open, batch.id, batch.treasury_source]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">عرض</Button>
      </DialogTrigger>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            دفعة {batch.batch_no}
            <Badge className="bg-purple-100 text-purple-800 border-purple-300"><Tag className="w-3 h-3 ml-1" />تجارة</Badge>
          </DialogTitle>
        </DialogHeader>
        {batch.treasury_source === "customer_debt" && settlement && (
          <div className="mb-4 p-3 rounded-md border border-amber-300 bg-amber-50 text-sm space-y-1">
            <div className="font-bold text-amber-900 flex items-center gap-2">
              <Wallet className="w-4 h-4" /> مصدر التمويل: تسوية من مديونية عميل
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs text-amber-900">
              <div>العميل: <strong>{settlement.customer_name}</strong></div>
              <div>الدين قبل التسوية: <strong>{fmtEGP(settlement.balance_before)}</strong></div>
              <div>قيمة التسوية: <strong>{fmtEGP(settlement.settlement_amount)}</strong></div>
              <div>المتبقي على العميل: <strong>{fmtEGP(settlement.balance_after)}</strong></div>
              <div>فرق مدفوع من خزنة: <strong>{Number(settlement.diff_amount) > 0 ? `${fmtEGP(settlement.diff_amount)} (${TREASURY_LABEL[settlement.diff_treasury_source] || settlement.diff_treasury_source})` : "لا"}</strong></div>
              <div>رقم التسوية: <strong className="font-mono">{settlement.settlement_no}</strong></div>
            </div>
            {settlement.notes && <div className="text-xs text-amber-800 pt-1 border-t border-amber-200">📝 {settlement.notes}</div>}
          </div>
        )}
        {batch.treasury_source === "deferred" && (() => {
          const total = batchTotalCost(batch);
          const paid = Number(batch.paid_amount || 0);
          const outstanding = Math.max(0, total - paid);
          const status = batch.payment_status || "deferred";
          return (
            <div className="mb-4 p-3 rounded-md border border-amber-400 bg-amber-50 text-sm space-y-2">
              <div className="font-bold text-amber-900 flex items-center justify-between gap-2 flex-wrap">
                <span className="flex items-center gap-2">
                  <Wallet className="w-4 h-4" /> مصدر التمويل: شراء آجل / بدون دفع حالي
                </span>
                {status === "deferred" && <Badge className="bg-amber-500 text-white border-amber-600">غير مدفوع</Badge>}
                {status === "partial" && <Badge className="bg-orange-500 text-white border-orange-600">مدفوع جزئيًا</Badge>}
                {status === "paid" && <Badge className="bg-emerald-500 text-white border-emerald-600">تم السداد</Badge>}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-amber-900">
                <div>المورد: <strong>{batch.supplier_name}</strong></div>
                <div>إجمالي قيمة الشراء: <strong>{fmtEGP(total)}</strong></div>
                <div>المدفوع: <strong>{fmtEGP(paid)}</strong></div>
                <div>المتبقي للمورد: <strong className="text-amber-900">{fmtEGP(outstanding)}</strong></div>
              </div>
              {outstanding > 0 && (
                <div className="pt-1 border-t border-amber-200 flex justify-end">
                  <PayDeferredDialog batch={batch} onSaved={onSaved} />
                </div>
              )}
            </div>
          );
        })()}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <KCard label="عدد الشراء" value={batch.original_count} />
          <KCard label="المتاح حالياً" value={batch.current_count} />
          <KCard label="النافق" value={batch.dead_count} color="red" />
          <KCard label="المباع" value={batch.sold_count} color="orange" />
        </div>
        {pnl && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <KCard label="إجمالي التكلفة" value={fmtEGP(pnl.total_cost)} color="slate" />
            <KCard label="تكلفة الكتكوت الحالية" value={fmtEGP(pnl.current_cost_per_chick)} color="blue" />
            <KCard label="إجمالي المبيعات" value={fmtEGP(pnl.sales_total)} color="emerald" />
            <KCard label="صافي الربح/الخسارة"
              value={fmtEGP(pnl.net_profit)}
              color={pnl.net_profit >= 0 ? "emerald" : "red"} />
            <KCard label="إجمالي العلف" value={fmtEGP(pnl.feed_cost)} />
            <KCard label="إجمالي الأدوية" value={fmtEGP(pnl.medicine_cost)} />
            <KCard label="المحصل" value={fmtEGP(pnl.collected_total)} color="emerald" />
            <KCard label="المديونية" value={fmtEGP(pnl.credit_total)} color="orange" />
          </div>
        )}
        <div className="flex gap-2 mb-3">
          <AddExpenseDialog batch={batch} onSaved={onSaved} />
          <AddMortalityDialog batch={batch} onSaved={onSaved} />
        </div>
        <Tabs defaultValue="exp">
          <TabsList>
            <TabsTrigger value="exp">المصروفات ({batchExp.length})</TabsTrigger>
            <TabsTrigger value="mort">النافق ({batchMort.length})</TabsTrigger>
            <TabsTrigger value="sales">المبيعات ({batchSales.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="exp">
            <Table>
              <TableHeader><TableRow>
                <TableHead>التاريخ</TableHead><TableHead>النوع</TableHead>
                <TableHead>الكمية</TableHead><TableHead>القيمة</TableHead>
                <TableHead>الخزنة</TableHead><TableHead>ملاحظات</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {batchExp.map(e => (
                  <TableRow key={e.id}>
                    <TableCell>{fmtDate(e.expense_date)}</TableCell>
                    <TableCell>{e.expense_type === "feed" ? "علف" : e.expense_type === "medicine" ? "أدوية" : "أخرى"}</TableCell>
                    <TableCell>{e.quantity} {e.unit}</TableCell>
                    <TableCell>{fmtEGP(e.amount)}</TableCell>
                    <TableCell>{TREASURY_LABEL[e.treasury_source] || "—"}</TableCell>
                    <TableCell>{e.notes}</TableCell>
                  </TableRow>
                ))}
                {batchExp.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-4">لا توجد مصروفات</TableCell></TableRow>}
              </TableBody>
            </Table>
          </TabsContent>
          <TabsContent value="mort">
            <Table>
              <TableHeader><TableRow>
                <TableHead>التاريخ</TableHead><TableHead>العدد</TableHead><TableHead>السبب</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {batchMort.map(m => (
                  <TableRow key={m.id}><TableCell>{fmtDate(m.mortality_date)}</TableCell>
                    <TableCell>{m.count}</TableCell><TableCell>{m.reason}</TableCell></TableRow>
                ))}
                {batchMort.length === 0 && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-4">لا يوجد نافق</TableCell></TableRow>}
              </TableBody>
            </Table>
          </TabsContent>
          <TabsContent value="sales">
            <Table>
              <TableHeader><TableRow>
                <TableHead>رقم الفاتورة</TableHead><TableHead>التاريخ</TableHead>
                <TableHead>العميل</TableHead><TableHead>العدد</TableHead>
                <TableHead>السعر</TableHead><TableHead>الإجمالي</TableHead>
                <TableHead>الدفع</TableHead><TableHead>الحالة</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {batchSales.map(s => (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-xs">{s.sale_no}</TableCell>
                    <TableCell>{fmtDate(s.sale_date)}</TableCell>
                    <TableCell>{s.customer_name}</TableCell>
                    <TableCell>{s.quantity}</TableCell>
                    <TableCell>{fmtEGP(s.unit_price)}</TableCell>
                    <TableCell className="font-semibold">{fmtEGP(s.total)}</TableCell>
                    <TableCell>{s.payment_method === "cash" ? "نقدي" : s.payment_method === "credit" ? "آجل" : "تحويل"}</TableCell>
                    <TableCell>
                      {s.status === "cancelled" ? <Badge variant="destructive">ملغاة</Badge>
                        : s.collected ? <Badge className="bg-emerald-100 text-emerald-800">محصلة</Badge>
                          : <Badge variant="outline" className="text-orange-700">مديونية</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
                {batchSales.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-4">لا توجد مبيعات</TableCell></TableRow>}
              </TableBody>
            </Table>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};

const KCard = ({ label, value, color = "slate" }: any) => {
  const cls: Record<string, string> = {
    slate: "from-slate-600 to-slate-800",
    blue: "from-blue-600 to-blue-800",
    emerald: "from-emerald-600 to-emerald-800",
    red: "from-red-600 to-red-800",
    orange: "from-orange-500 to-orange-700",
  };
  return (
    <div className={`p-3 rounded-lg bg-gradient-to-br ${cls[color]} text-white`}>
      <div className="text-xs opacity-90">{label}</div>
      <div className="text-lg font-bold mt-1">{value}</div>
    </div>
  );
};

// ============ Main Tab ============
export default function ChickTradingTab() {
  const { isGeneralManager, isExecutiveManager, isHatcheryManager, roles } = useAuth();
  const canManage = isGeneralManager || isExecutiveManager || isHatcheryManager ||
    (roles || []).includes("brooding_manager");
  const { batches, sales, expenses, mortality, loading, reload } = useChickTrading();

  const totals = useMemo(() => {
    const totalPurchaseCost = batches.reduce((a, b) =>
      a + (b.original_count * Number(b.unit_purchase_price)) +
      Number(b.transport_cost) + Number(b.disinfection_cost) + Number(b.other_costs), 0);
    const totalExp = expenses.reduce((a, e) => a + Number(e.amount), 0);
    const activeSales = sales.filter(s => s.status === "active");
    const totalSales = activeSales.reduce((a, s) => a + Number(s.total), 0);
    const totalCollected = activeSales.filter(s => s.collected).reduce((a, s) => a + Number(s.total), 0);
    const totalCredit = totalSales - totalCollected;
    const open = batches.filter(b => b.status === "open").length;
    // Deferred purchase aggregates
    const deferredBatches = batches.filter(b => b.treasury_source === "deferred" && b.status !== "cancelled");
    let deferredTotal = 0, deferredPaid = 0, deferredOutstanding = 0;
    deferredBatches.forEach(b => {
      const t = batchTotalCost(b);
      const p = Number(b.paid_amount || 0);
      deferredTotal += t; deferredPaid += p; deferredOutstanding += Math.max(0, t - p);
    });
    const deferredOpenCount = deferredBatches.filter(b => (b.payment_status || "deferred") !== "paid").length;
    return {
      open, totalPurchaseCost, totalExp, totalSales, totalCollected, totalCredit,
      profit: totalSales - totalPurchaseCost - totalExp,
      birdsAlive: batches.reduce((a, b) => a + b.current_count, 0),
      deferredTotal, deferredPaid, deferredOutstanding, deferredOpenCount,
    };
  }, [batches, sales, expenses]);

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KCard label="دفعات مفتوحة" value={totals.open} color="blue" />
        <KCard label="كتاكيت حية" value={fmtNum(totals.birdsAlive, 0)} color="emerald" />
        <KCard label="إجمالي التكلفة" value={fmtEGP(totals.totalPurchaseCost + totals.totalExp)} color="slate" />
        <KCard label="إجمالي المبيعات" value={fmtEGP(totals.totalSales)} color="orange" />
        <KCard label="المحصل" value={fmtEGP(totals.totalCollected)} color="emerald" />
        <KCard label="المديونية" value={fmtEGP(totals.totalCredit)} color="orange" />
        <KCard label="صافي الربح/الخسارة" value={fmtEGP(totals.profit)}
          color={totals.profit >= 0 ? "emerald" : "red"} />
      </div>

      {/* Deferred-purchase KPIs */}
      {totals.deferredTotal > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KCard label="دفعات شراء آجل" value={totals.deferredOpenCount} color="orange" />
          <KCard label="إجمالي مشتريات آجل" value={fmtEGP(totals.deferredTotal)} color="orange" />
          <KCard label="مدفوع من الآجل" value={fmtEGP(totals.deferredPaid)} color="emerald" />
          <KCard label="متبقي للموردين" value={fmtEGP(totals.deferredOutstanding)} color="red" />
        </div>
      )}

      {/* Actions */}
      {canManage && (
        <div className="flex flex-wrap gap-2">
          <NewPurchaseDialog onSaved={reload} />
          <NewSaleDialog batches={batches} onSaved={reload} />
        </div>
      )}

      {/* Batches table */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2">
          <Tag className="w-5 h-5 text-purple-600" />دفعات تجارة الكتاكيت
        </CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>رقم الدفعة</TableHead>
                <TableHead>المورد</TableHead>
                <TableHead>تاريخ الشراء</TableHead>
                <TableHead>العمر</TableHead>
                <TableHead>الشراء</TableHead>
                <TableHead>الحالي</TableHead>
                <TableHead>نافق</TableHead>
                <TableHead>مباع</TableHead>
                <TableHead>سعر الكتكوت</TableHead>
                <TableHead>الخزنة</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead></TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {loading && <TableRow><TableCell colSpan={12} className="text-center py-6">جاري التحميل...</TableCell></TableRow>}
                {!loading && batches.length === 0 && (
                  <TableRow><TableCell colSpan={12} className="text-center text-muted-foreground py-6">
                    لا توجد دفعات. ابدأ بإضافة عملية شراء كتاكيت تجارة.
                  </TableCell></TableRow>
                )}
                {batches.map(b => {
                  const isDeferred = b.treasury_source === "deferred";
                  const payStatus = b.payment_status || (isDeferred ? "deferred" : "paid");
                  return (
                  <TableRow key={b.id} className={isDeferred && payStatus !== "paid" ? "bg-amber-50/70 hover:bg-amber-100/70" : ""}>
                    <TableCell className="font-mono text-xs">
                      <div className="flex items-center gap-2 flex-wrap">
                        {b.batch_no}
                        <Badge className="bg-purple-100 text-purple-800 border-purple-300 text-[10px]">تجارة</Badge>
                        {isDeferred && payStatus === "deferred" && (
                          <Badge className="bg-amber-500 text-white border-amber-600 text-[10px]">شراء آجل</Badge>
                        )}
                        {isDeferred && payStatus === "partial" && (
                          <Badge className="bg-orange-500 text-white border-orange-600 text-[10px]">مدفوع جزئيًا</Badge>
                        )}
                        {isDeferred && payStatus === "paid" && (
                          <Badge className="bg-emerald-500 text-white border-emerald-600 text-[10px]">آجل — مسدّد</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{b.supplier_name}</TableCell>
                    <TableCell>{fmtDate(b.purchase_date)}</TableCell>
                    <TableCell>{b.age_at_purchase} يوم</TableCell>
                    <TableCell>{b.original_count}</TableCell>
                    <TableCell className="font-semibold text-blue-700">{b.current_count}</TableCell>
                    <TableCell className="text-red-700">{b.dead_count}</TableCell>
                    <TableCell className="text-orange-700">{b.sold_count}</TableCell>
                    <TableCell>{fmtEGP(b.unit_purchase_price)}</TableCell>
                    <TableCell className="text-xs">{TREASURY_LABEL[b.treasury_source]}</TableCell>
                    <TableCell>
                      {b.status === "open" ? <Badge className="bg-emerald-100 text-emerald-800">مفتوحة</Badge>
                        : b.status === "closed" ? <Badge variant="outline">مغلقة</Badge>
                          : <Badge variant="destructive">ملغاة</Badge>}
                    </TableCell>
                    <TableCell>
                      <BatchDetailDialog batch={b} expenses={expenses} mortality={mortality}
                        sales={sales} onSaved={reload} />
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* All sales list */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-orange-600" />دفعات / فواتير البيع
        </CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>رقم</TableHead><TableHead>التاريخ</TableHead>
                <TableHead>العميل</TableHead><TableHead>الدفعة</TableHead>
                <TableHead>العدد</TableHead><TableHead>الإجمالي</TableHead>
                <TableHead>الدفع</TableHead><TableHead>الحالة</TableHead><TableHead></TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {sales.length === 0 && (
                  <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-4">لا توجد مبيعات</TableCell></TableRow>
                )}
                {sales.map(s => {
                  const b = batches.find(x => x.id === s.batch_id);
                  return (
                    <TableRow key={s.id}>
                      <TableCell className="font-mono text-xs">{s.sale_no}</TableCell>
                      <TableCell>{fmtDate(s.sale_date)}</TableCell>
                      <TableCell>{s.customer_name}</TableCell>
                      <TableCell className="text-xs">{b?.batch_no || "—"}</TableCell>
                      <TableCell>{s.quantity}</TableCell>
                      <TableCell className="font-semibold">{fmtEGP(s.total)}</TableCell>
                      <TableCell>{s.payment_method === "cash" ? "نقدي" : s.payment_method === "credit" ? "آجل" : "تحويل"}</TableCell>
                      <TableCell>
                        {s.status === "cancelled" ? <Badge variant="destructive">ملغاة</Badge>
                          : s.collected ? <Badge className="bg-emerald-100 text-emerald-800">محصلة</Badge>
                            : <Badge variant="outline" className="text-orange-700">مديونية</Badge>}
                      </TableCell>
                      <TableCell>
                        {s.status === "active" && !s.collected && canManage && (
                          <CollectSaleDialog sale={s} onSaved={reload} />
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
