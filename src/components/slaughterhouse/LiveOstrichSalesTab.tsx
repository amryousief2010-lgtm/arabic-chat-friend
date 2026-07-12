import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Bird, TrendingUp, TrendingDown, Calculator } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

type Availability = {
  receipt_id: string;
  receipt_number: string;
  receipt_date: string;
  source_name: string | null;
  original_count: number;
  current_alive_count: number;
  total_weight_kg: number;
  avg_weight_kg: number | null;
  price_per_kg: number;
  total_batch_cost: number;
  cost_per_bird_current: number;
  feed_cost_loaded: number;
  other_costs_loaded: number;
  sold_live_count: number;
  sold_live_weight_kg: number;
};

type Bird = {
  id: string;
  receipt_id: string;
  bird_index: number;
  live_weight_kg: number;
  slaughter_weight_kg: number;
  purchase_cost: number;
  feed_cost: number;
};

type BatchWeight = {
  live_receipt_id: string;
  birds_slaughtered: number;
  total_live_weight_kg: number;
};

type Sale = {
  id: string;
  sale_number: string;
  sale_date: string;
  live_receipt_id: string;
  bird_count: number;
  sale_weight_kg: number;
  price_per_kg: number;
  total_sale: number;
  unit_cost_at_sale: number;
  total_cost_at_sale: number;
  breakeven_per_kg: number;
  net_profit: number;
  cost_source: string;
  customer_name: string | null;
  payment_method: string;
  amount_paid: number;
};

const fmt = (n: number) =>
  Number(n || 0).toLocaleString("ar-EG", { maximumFractionDigits: 1 });
const fmtMoney = (n: number) =>
  Number(n || 0).toLocaleString("ar-EG", { maximumFractionDigits: 0 });

export default function LiveOstrichSalesTab() {
  const { roles } = useAuth();
  const canManage = roles.some((r) =>
    ["general_manager", "executive_manager", "slaughterhouse_manager"].includes(r)
  );

  const [availability, setAvailability] = useState<Availability[]>([]);
  const [soldBirdIds, setSoldBirdIds] = useState<Set<string>>(new Set());
  const [birds, setBirds] = useState<Bird[]>([]);
  const [batchWeights, setBatchWeights] = useState<BatchWeight[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const fetchAll = async () => {
    const [av, sl, br, bw] = await Promise.all([
      supabase.from("v_available_live_ostrich" as any).select("*").order("receipt_date", { ascending: false }),
      supabase.from("slaughter_live_sales" as any).select("*").order("sale_date", { ascending: false }).limit(500),
      supabase.from("slaughter_live_birds").select("id, receipt_id, bird_index, live_weight_kg, slaughter_weight_kg, purchase_cost, feed_cost"),
      supabase
        .from("slaughter_batches" as any)
        .select("live_receipt_id, birds_slaughtered, total_live_weight_kg")
        .eq("approval_status", "approved")
        .neq("status", "cancelled"),
    ]);
    setAvailability((av.data as any) || []);
    setSales((sl.data as any) || []);
    setBirds((br.data as any) || []);
    setBatchWeights((bw.data as any) || []);
    const soldIds = new Set<string>(
      (((sl.data as any) || []) as Sale[])
        .map((s: any) => s.live_bird_id)
        .filter(Boolean)
    );
    setSoldBirdIds(soldIds);
  };

  useEffect(() => { fetchAll(); }, []);

  // Form state
  const [receiptId, setReceiptId] = useState<string>("");
  const [birdId, setBirdId] = useState<string>("__none__");
  const [birdCount, setBirdCount] = useState<number>(1);
  const [saleWeight, setSaleWeight] = useState<number>(0);
  const [pricePerKg, setPricePerKg] = useState<number>(0);
  const [saleDate, setSaleDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [payment, setPayment] = useState<"cash" | "credit" | "partial">("cash");
  const [amountPaid, setAmountPaid] = useState<number>(0);
  const [targetMargin, setTargetMargin] = useState<number>(0);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) {
      setReceiptId(""); setBirdId("__none__"); setBirdCount(1);
      setSaleWeight(0); setPricePerKg(0); setCustomerName(""); setCustomerPhone("");
      setPayment("cash"); setAmountPaid(0); setTargetMargin(0); setNotes("");
    }
  }, [open]);

  const selectedReceipt = useMemo(
    () => availability.find((r) => r.receipt_id === receiptId),
    [receiptId, availability]
  );
  const availableBirds = useMemo(
    () => birds.filter((b) => b.receipt_id === receiptId && !soldBirdIds.has(b.id)),
    [birds, receiptId, soldBirdIds]
  );
  const selectedBird = useMemo(
    () => availableBirds.find((b) => b.id === birdId),
    [birdId, availableBirds]
  );

  const selectedBatchAvgWeight = useMemo(() => {
    if (!selectedReceipt) return { value: 0, source: "" };

    const savedAvg = Number(selectedReceipt.avg_weight_kg || 0);
    if (savedAvg > 0) return { value: savedAvg, source: "متوسط مسجل على الدفعة" };

    const totalWeight = Number(selectedReceipt.total_weight_kg || 0);
    const originalCount = Number(selectedReceipt.original_count || 0);
    if (totalWeight > 0 && originalCount > 0) {
      return { value: totalWeight / originalCount, source: "متوسط وزن الشراء" };
    }

    const previousSlaughter = batchWeights.filter(
      (b) => b.live_receipt_id === selectedReceipt.receipt_id && Number(b.birds_slaughtered || 0) > 0 && Number(b.total_live_weight_kg || 0) > 0
    );
    const slaughteredCount = previousSlaughter.reduce((sum, b) => sum + Number(b.birds_slaughtered || 0), 0);
    const slaughteredWeight = previousSlaughter.reduce((sum, b) => sum + Number(b.total_live_weight_kg || 0), 0);

    if (slaughteredCount > 0 && slaughteredWeight > 0) {
      return { value: slaughteredWeight / slaughteredCount, source: "تقديري من دفعات الذبح السابقة لنفس الدفعة" };
    }

    return { value: 0, source: "" };
  }, [selectedReceipt, batchWeights]);

  // Pre-fill weight when bird selected
  useEffect(() => {
    if (selectedBird && !saleWeight) {
      setSaleWeight(Number(selectedBird.live_weight_kg || 0));
    }
  }, [selectedBird]); // eslint-disable-line

  // Pre-fill an estimated per-bird weight when selling by count from a selected batch
  useEffect(() => {
    if (!selectedBird && selectedBatchAvgWeight.value > 0 && !saleWeight) {
      setSaleWeight(Number(selectedBatchAvgWeight.value.toFixed(1)));
    }
  }, [selectedBird, selectedBatchAvgWeight.value, saleWeight]);

  // Cost calculation
  const costInfo = useMemo(() => {
    if (!selectedReceipt) return null;
    const w = Number(saleWeight || 0);
    const count = selectedBird ? 1 : Math.max(1, Number(birdCount || 1));

    let purchaseCost = 0;
    let expenseShare = 0;
    let source: "per_bird" | "batch_average" = "batch_average";

    if (selectedBird && Number(selectedBird.purchase_cost) > 0) {
      source = "per_bird";
      purchaseCost = Number(selectedBird.purchase_cost || 0);
      const receiptTotalW = Number(selectedReceipt.total_weight_kg || 0);
      const birdW = Number(selectedBird.live_weight_kg || 0);
      const otherCosts =
        Number(selectedReceipt.feed_cost_loaded || 0) +
        Number(selectedReceipt.other_costs_loaded || 0);
      expenseShare = receiptTotalW > 0 ? (otherCosts * birdW) / receiptTotalW : 0;
      expenseShare += Number(selectedBird.feed_cost || 0);
    } else {
      source = "batch_average";
      const totalW = Number(selectedReceipt.total_weight_kg || 0);
      const soldW = Number(selectedReceipt.sold_live_weight_kg || 0);
      const remainingW = totalW - soldW;

      // Prefer original purchase unit cost (opening_cost_total / bird_count) to avoid
      // over-inflated cost_per_bird_current after batch reallocations.
      const openingTotal = Number(selectedReceipt.opening_cost_total || 0);
      const origBirds = Number(selectedReceipt.bird_count || 0);
      const originalUnitCost =
        openingTotal > 0 && origBirds > 0
          ? openingTotal / origBirds
          : Number(selectedReceipt.cost_per_bird_current || 0);

      if (totalW > 0 && remainingW > 0) {
        // Real batch with weights → cost per kg × sale weight (based on original total)
        const totalBatch = openingTotal > 0 ? openingTotal : Number(selectedReceipt.total_batch_cost || 0);
        const perKg = totalBatch / totalW;
        purchaseCost = w * perKg * count;
      } else {
        // Opening balance / no weights recorded → use original per-bird cost
        purchaseCost = originalUnitCost * count;
      }
      expenseShare = 0;
    }


    const totalCost = (purchaseCost + expenseShare) * (source === "per_bird" ? count : 1);
    const totalWeight = w * count;
    const breakeven = totalWeight > 0 ? totalCost / totalWeight : 0;
    const totalSale = totalWeight * Number(pricePerKg || 0);
    const profit = totalSale - totalCost;
    const profitPct = totalCost > 0 ? (profit / totalCost) * 100 : 0;
    const profitPerKg = totalWeight > 0 ? profit / totalWeight : 0;

    return { source, purchaseCost, expenseShare, totalCost, totalWeight, breakeven, totalSale, profit, profitPct, profitPerKg, count };
  }, [selectedReceipt, selectedBird, saleWeight, pricePerKg, birdCount]);

  // Suggest price from target margin
  useEffect(() => {
    if (targetMargin > 0 && costInfo && costInfo.breakeven > 0) {
      const suggested = costInfo.breakeven * (1 + targetMargin / 100);
      setPricePerKg(Number(suggested.toFixed(2)));
    }
  }, [targetMargin]); // eslint-disable-line

  const genSaleNumber = () => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `LS-${y}${m}${day}-${rand}`;
  };

  const save = async () => {
    if (!selectedReceipt) { toast.error("اختر الدفعة"); return; }
    if (!saleWeight || saleWeight <= 0) { toast.error("أدخل وزن البيع"); return; }
    if (!pricePerKg || pricePerKg < 0) { toast.error("أدخل سعر البيع"); return; }
    if (!selectedBird && (!birdCount || birdCount <= 0)) { toast.error("أدخل عدد النعام"); return; }
    if (!selectedBird && birdCount > selectedReceipt.current_alive_count) {
      toast.error(`المتاح من الدفعة ${selectedReceipt.current_alive_count} فقط`); return;
    }

    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    const payload = {
      sale_number: genSaleNumber(),
      sale_date: saleDate,
      live_receipt_id: selectedReceipt.receipt_id,
      live_bird_id: selectedBird?.id || null,
      bird_count: selectedBird ? 1 : birdCount,
      sale_weight_kg: costInfo!.totalWeight,
      price_per_kg: pricePerKg,
      unit_cost_at_sale: costInfo!.count > 0 ? costInfo!.totalCost / costInfo!.count : 0,
      total_cost_at_sale: costInfo!.totalCost,
      breakeven_per_kg: costInfo!.breakeven,
      cost_source: costInfo!.source,
      customer_name: customerName || null,
      customer_phone: customerPhone || null,
      payment_method: payment,
      amount_paid: payment === "cash" ? costInfo!.totalSale : (payment === "partial" ? amountPaid : 0),
      notes: notes || null,
      created_by: user?.id || null,
    };
    const { error } = await supabase.from("slaughter_live_sales" as any).insert(payload);
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    toast.success("تم تسجيل بيعة نعام قائم");
    setOpen(false);
    fetchAll();
  };

  const totals = useMemo(() => {
    return sales.reduce(
      (a, s) => {
        a.count += Number(s.bird_count || 0);
        a.weight += Number(s.sale_weight_kg || 0);
        a.revenue += Number(s.total_sale || 0);
        a.cost += Number(s.total_cost_at_sale || 0);
        a.profit += Number(s.net_profit || 0);
        return a;
      },
      { count: 0, weight: 0, revenue: 0, cost: 0, profit: 0 }
    );
  }, [sales]);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="flex items-center gap-2">
            <Bird className="w-5 h-5 text-orange-600" />
            بيع نعام قائم
          </CardTitle>
          {canManage && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button className="bg-gradient-to-r from-primary to-accent">
                  <Plus className="w-4 h-4 ml-1" /> بيعة قائمة جديدة
                </Button>
              </DialogTrigger>
              <DialogContent dir="rtl" className="max-w-3xl max-h-[90vh] overflow-y-auto">
                <DialogHeader><DialogTitle>تسجيل بيعة نعام قائم</DialogTitle></DialogHeader>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="sm:col-span-2">
                    <Label>الدفعة المشتراة</Label>
                    <Select value={receiptId} onValueChange={(v) => { setReceiptId(v); setBirdId("__none__"); setSaleWeight(0); }}>
                      <SelectTrigger><SelectValue placeholder="اختر الدفعة" /></SelectTrigger>
                      <SelectContent>
                        {availability
                          .filter((r) => r.current_alive_count > 0)
                          .map((r) => (
                            <SelectItem key={r.receipt_id} value={r.receipt_id}>
                              {r.receipt_number} · {r.receipt_date} · متاح: {r.current_alive_count} طير
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {availableBirds.length > 0 && (
                    <div className="sm:col-span-2">
                      <Label>النعامة (اختياري — اترك فارغ للبيع بالعدد)</Label>
                      <Select value={birdId} onValueChange={setBirdId}>
                        <SelectTrigger><SelectValue placeholder="اختر النعامة" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">— بدون تحديد (بيع بالعدد) —</SelectItem>
                          {availableBirds.map((b) => (
                            <SelectItem key={b.id} value={b.id}>
                              #{b.bird_index} · وزن حي: {fmt(Number(b.live_weight_kg))} كجم · تكلفة: {fmtMoney(Number(b.purchase_cost))} ج.م
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {selectedReceipt && (
                    <div className="sm:col-span-2 rounded-lg border bg-muted/40 p-3 text-sm">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div>
                          <div className="text-muted-foreground">المتاح من الدفعة</div>
                          <div className="font-bold">{fmt(Number(selectedReceipt.current_alive_count || 0))} نعامة</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">متوسط وزن النعامة</div>
                          <div className="font-bold">
                            {selectedBatchAvgWeight.value > 0 ? `${fmt(selectedBatchAvgWeight.value)} كجم` : "غير مسجل"}
                          </div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">وزن تقديري للبيع</div>
                          <div className="font-bold">
                            {selectedBatchAvgWeight.value > 0
                              ? `${fmt(selectedBatchAvgWeight.value * (selectedBird ? 1 : Math.max(1, Number(birdCount || 1))))} كجم`
                              : "أدخل الوزن يدويًا"}
                          </div>
                        </div>
                      </div>
                      {selectedBatchAvgWeight.source && (
                        <div className="mt-2 text-xs text-muted-foreground">{selectedBatchAvgWeight.source}</div>
                      )}
                    </div>
                  )}

                  {!selectedBird && (
                    <div>
                      <Label>عدد النعام المباع</Label>
                      <Input type="number" min={1} value={birdCount} onChange={(e) => setBirdCount(Number(e.target.value))} />
                    </div>
                  )}

                  <div>
                    <Label>وزن البيع القائم (كجم) {selectedBird ? "" : "— لكل نعامة"}</Label>
                    <Input type="number" step="0.1" value={saleWeight || ""} onChange={(e) => setSaleWeight(Number(e.target.value))} />
                  </div>

                  <div>
                    <Label>سعر بيع الكيلو (ج.م)</Label>
                    <Input type="number" step="0.5" value={pricePerKg || ""} onChange={(e) => setPricePerKg(Number(e.target.value))} />
                  </div>

                  <div>
                    <Label>نسبة ربح مستهدفة % (اختياري)</Label>
                    <Input type="number" step="0.5" value={targetMargin || ""} onChange={(e) => setTargetMargin(Number(e.target.value))} placeholder="مثلاً 15" />
                  </div>

                  <div>
                    <Label>تاريخ البيع</Label>
                    <Input type="date" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} />
                  </div>

                  <div>
                    <Label>اسم العميل</Label>
                    <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
                  </div>

                  <div>
                    <Label>هاتف العميل</Label>
                    <Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
                  </div>

                  <div>
                    <Label>طريقة السداد</Label>
                    <Select value={payment} onValueChange={(v: any) => setPayment(v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cash">نقدي</SelectItem>
                        <SelectItem value="credit">آجل</SelectItem>
                        <SelectItem value="partial">دفعة جزئية</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {payment === "partial" && (
                    <div>
                      <Label>المبلغ المدفوع</Label>
                      <Input type="number" value={amountPaid || ""} onChange={(e) => setAmountPaid(Number(e.target.value))} />
                    </div>
                  )}

                  <div className="sm:col-span-2">
                    <Label>ملاحظات</Label>
                    <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
                  </div>

                  {costInfo && costInfo.totalWeight > 0 && (
                    <div className="sm:col-span-2 rounded-lg border-2 border-primary/40 bg-primary/5 p-3 space-y-1.5 text-sm">
                      <div className="flex items-center gap-2 font-bold text-primary mb-1">
                        <Calculator className="w-4 h-4" /> ملخص التكلفة والربح
                        {costInfo.source === "batch_average" && (
                          <Badge variant="outline" className="text-[10px]">تكلفة تقديرية من متوسط الدفعة</Badge>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                        <div>تكلفة شراء النعامة:</div>
                        <div className="text-left font-semibold">{fmtMoney(costInfo.purchaseCost)} ج.م</div>
                        {costInfo.source === "per_bird" && (
                          <>
                            <div>نصيبها من المصروفات:</div>
                            <div className="text-left font-semibold">{fmtMoney(costInfo.expenseShare)} ج.م</div>
                          </>
                        )}
                        <div>إجمالي التكلفة حتى اليوم:</div>
                        <div className="text-left font-semibold">{fmtMoney(costInfo.totalCost)} ج.م</div>
                        <div>سعر التعادل للكيلو:</div>
                        <div className="text-left font-semibold">{fmt(costInfo.breakeven)} ج.م/كجم</div>
                        <div>إجمالي البيع:</div>
                        <div className="text-left font-semibold">{fmtMoney(costInfo.totalSale)} ج.م</div>
                        <div className={costInfo.profit >= 0 ? "text-emerald-700 font-bold" : "text-red-700 font-bold"}>
                          {costInfo.profit >= 0 ? "صافي الربح:" : "صافي الخسارة:"}
                        </div>
                        <div className={"text-left font-bold " + (costInfo.profit >= 0 ? "text-emerald-700" : "text-red-700")}>
                          {fmtMoney(Math.abs(costInfo.profit))} ج.م
                        </div>
                        <div>الربح في الكيلو:</div>
                        <div className="text-left font-semibold">{fmt(costInfo.profitPerKg)} ج.م/كجم</div>
                        <div>نسبة الربح:</div>
                        <div className="text-left font-semibold">{fmt(costInfo.profitPct)} %</div>
                      </div>
                    </div>
                  )}
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
                  <Button onClick={save} disabled={loading || !selectedReceipt}>حفظ البيعة</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>

        {/* KPI summary */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <div className="rounded-lg border bg-background p-3">
            <div className="text-[11px] text-muted-foreground">عمليات البيع</div>
            <div className="text-lg font-bold">{sales.length}</div>
          </div>
          <div className="rounded-lg border bg-background p-3">
            <div className="text-[11px] text-muted-foreground">عدد النعام المباع</div>
            <div className="text-lg font-bold">{totals.count}</div>
          </div>
          <div className="rounded-lg border bg-background p-3">
            <div className="text-[11px] text-muted-foreground">إجمالي وزن البيع</div>
            <div className="text-lg font-bold">{fmt(totals.weight)} كجم</div>
          </div>
          <div className="rounded-lg border bg-background p-3">
            <div className="text-[11px] text-muted-foreground">إجمالي المبيعات</div>
            <div className="text-lg font-bold text-primary">{fmtMoney(totals.revenue)} ج.م</div>
          </div>
          <div className={"rounded-lg border p-3 " + (totals.profit >= 0 ? "bg-emerald-50 dark:bg-emerald-950/30" : "bg-red-50 dark:bg-red-950/30")}>
            <div className="text-[11px] text-muted-foreground flex items-center gap-1">
              {totals.profit >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              صافي الربح
            </div>
            <div className={"text-lg font-bold " + (totals.profit >= 0 ? "text-emerald-700" : "text-red-700")}>
              {fmtMoney(totals.profit)} ج.م
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-xs">
              <tr>
                <th className="p-2 text-right">رقم العملية</th>
                <th className="p-2 text-right">التاريخ</th>
                <th className="p-2 text-right">الدفعة</th>
                <th className="p-2 text-right">عدد</th>
                <th className="p-2 text-right">وزن البيع</th>
                <th className="p-2 text-right">سعر/كجم</th>
                <th className="p-2 text-right">التكلفة</th>
                <th className="p-2 text-right">إجمالي البيع</th>
                <th className="p-2 text-right">الربح</th>
                <th className="p-2 text-right">العميل</th>
                <th className="p-2 text-right">السداد</th>
              </tr>
            </thead>
            <tbody>
              {sales.length === 0 && (
                <tr><td colSpan={11} className="p-6 text-center text-muted-foreground">لا توجد عمليات بيع نعام قائم بعد</td></tr>
              )}
              {sales.map((s) => {
                const rec = availability.find((r) => r.receipt_id === s.live_receipt_id);
                return (
                  <tr key={s.id} className="border-t hover:bg-muted/40">
                    <td className="p-2 font-mono text-xs">{s.sale_number}</td>
                    <td className="p-2">{s.sale_date}</td>
                    <td className="p-2 text-xs">{rec?.receipt_number || "—"}</td>
                    <td className="p-2">{s.bird_count}</td>
                    <td className="p-2">{fmt(Number(s.sale_weight_kg))} كجم</td>
                    <td className="p-2">{fmt(Number(s.price_per_kg))}</td>
                    <td className="p-2">{fmtMoney(Number(s.total_cost_at_sale))}</td>
                    <td className="p-2 font-semibold text-primary">{fmtMoney(Number(s.total_sale))}</td>
                    <td className={"p-2 font-bold " + (Number(s.net_profit) >= 0 ? "text-emerald-700" : "text-red-700")}>
                      {fmtMoney(Number(s.net_profit))}
                    </td>
                    <td className="p-2 text-xs">{s.customer_name || "—"}</td>
                    <td className="p-2 text-xs">
                      <Badge variant={s.payment_method === "cash" ? "default" : s.payment_method === "credit" ? "destructive" : "secondary"}>
                        {s.payment_method === "cash" ? "نقدي" : s.payment_method === "credit" ? "آجل" : "جزئي"}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
