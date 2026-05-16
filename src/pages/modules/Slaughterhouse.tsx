import { useEffect, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Beef, TrendingUp, Package, Scale, Plus, AlertTriangle, CheckCircle2, Users, ClipboardCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Receipt = { id: string; receipt_number: string; receipt_date: string; source_type: string; source_name: string | null; bird_count: number; total_weight_kg: number; avg_weight_kg: number; price_per_kg: number; total_cost: number; dead_on_arrival: number; status: string; };
type Batch = { id: string; batch_number: string; slaughter_date: string; shift: string; live_receipt_id: string | null; birds_slaughtered: number; total_live_weight_kg: number; total_meat_kg: number; actual_yield_pct: number; cost_per_kg_meat: number; status: string; pre_slaughter_dead: number; rejected_birds: number; };
type Yield = { id: string; cut_name_ar: string; cut_name_en: string | null; barcode: string | null; standard_yield_pct: number; package_size_kg: number | null; category: string; display_order: number; is_active: boolean; };
type Output = { id: string; batch_id: string; cut_name_ar: string; barcode: string | null; actual_weight_kg: number; package_count: number; standard_weight_kg: number; variance_pct: number; unit_cost: number; total_cost: number; destination: string; };
type Worker = { id: string; full_name: string; role: string; phone: string | null; daily_wage: number; is_active: boolean; };
type QC = { id: string; check_type: string; check_date: string; inspector_name: string; result: string; temperature_c: number | null; ph_level: number | null; notes: string | null; };

const Slaughterhouse = () => {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [yields, setYields] = useState<Yield[]>([]);
  const [outputs, setOutputs] = useState<Output[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [qcs, setQcs] = useState<QC[]>([]);
  const [loading, setLoading] = useState(true);

  // Dialogs
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [outputBatchId, setOutputBatchId] = useState<string | null>(null);
  const [workerOpen, setWorkerOpen] = useState(false);
  const [qcOpen, setQcOpen] = useState(false);

  // Forms
  const [receiptForm, setReceiptForm] = useState({ source_type: "internal_farm", source_name: "", bird_count: 0, total_weight_kg: 0, avg_age_days: 0, price_per_kg: 0, dead_on_arrival: 0, notes: "" });
  const [batchForm, setBatchForm] = useState({ live_receipt_id: "", shift: "morning", birds_slaughtered: 0, total_live_weight_kg: 0, pre_slaughter_dead: 0, rejected_birds: 0, start_time: "", notes: "" });
  const [workerForm, setWorkerForm] = useState({ full_name: "", role: "slaughterer", phone: "", daily_wage: 0 });
  const [qcForm, setQcForm] = useState({ check_type: "post_slaughter", related_batch_id: "", inspector_name: "", result: "pass", temperature_c: "", ph_level: "", notes: "" });

  const fetchAll = async () => {
    setLoading(true);
    const [r, b, y, o, w, q] = await Promise.all([
      supabase.from("slaughter_live_receipts" as any).select("*").order("receipt_date", { ascending: false }).limit(500),
      supabase.from("slaughter_batches" as any).select("*").order("slaughter_date", { ascending: false }).limit(500),
      supabase.from("slaughter_yield_standards" as any).select("*").order("display_order"),
      supabase.from("slaughter_batch_outputs" as any).select("*").order("created_at", { ascending: false }).limit(1000),
      supabase.from("slaughter_workers" as any).select("*").order("full_name"),
      supabase.from("slaughter_quality_checks" as any).select("*").order("check_date", { ascending: false }).limit(200),
    ]);
    setReceipts((r.data as any) || []);
    setBatches((b.data as any) || []);
    setYields((y.data as any) || []);
    setOutputs((o.data as any) || []);
    setWorkers((w.data as any) || []);
    setQcs((q.data as any) || []);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  // KPIs
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = new Date(); monthStart.setDate(1);
  const monthStartStr = monthStart.toISOString().slice(0, 10);
  const birdsToday = batches.filter(b => b.slaughter_date === today).reduce((s, b) => s + b.birds_slaughtered, 0);
  const meatToday = batches.filter(b => b.slaughter_date === today).reduce((s, b) => s + Number(b.total_meat_kg || 0), 0);
  const meatMonth = batches.filter(b => b.slaughter_date >= monthStartStr).reduce((s, b) => s + Number(b.total_meat_kg || 0), 0);
  const yieldToday = (() => {
    const todays = batches.filter(b => b.slaughter_date === today && b.actual_yield_pct > 0);
    if (!todays.length) return 0;
    return todays.reduce((s, b) => s + Number(b.actual_yield_pct), 0) / todays.length;
  })();
  const avgCost = (() => {
    const recent = batches.filter(b => b.cost_per_kg_meat > 0).slice(0, 10);
    if (!recent.length) return 0;
    return recent.reduce((s, b) => s + Number(b.cost_per_kg_meat), 0) / recent.length;
  })();

  // Submit handlers
  const saveReceipt = async () => {
    if (!receiptForm.bird_count || !receiptForm.total_weight_kg) {
      toast.error("أدخل عدد الطيور والوزن الإجمالي");
      return;
    }
    const receipt_number = `LR-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.floor(Math.random() * 9999).toString().padStart(4, "0")}`;
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("slaughter_live_receipts" as any).insert({ ...receiptForm, receipt_number, created_by: user?.id });
    if (error) { toast.error(error.message); return; }
    toast.success("تم تسجيل استلام الطيور");
    setReceiptOpen(false);
    setReceiptForm({ source_type: "internal_farm", source_name: "", bird_count: 0, total_weight_kg: 0, avg_age_days: 0, price_per_kg: 0, dead_on_arrival: 0, notes: "" });
    fetchAll();
  };

  const saveBatch = async () => {
    if (!batchForm.birds_slaughtered || !batchForm.total_live_weight_kg) {
      toast.error("أدخل عدد الطيور المذبوحة والوزن الحي");
      return;
    }
    const batch_number = `SB-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.floor(Math.random() * 9999).toString().padStart(4, "0")}`;
    const { data: { user } } = await supabase.auth.getUser();
    const payload: any = { ...batchForm, batch_number, created_by: user?.id };
    if (!payload.live_receipt_id) delete payload.live_receipt_id;
    if (!payload.start_time) delete payload.start_time;
    const { error } = await supabase.from("slaughter_batches" as any).insert(payload);
    if (error) { toast.error(error.message); return; }
    toast.success("تم إنشاء دفعة الذبح");
    setBatchOpen(false);
    setBatchForm({ live_receipt_id: "", shift: "morning", birds_slaughtered: 0, total_live_weight_kg: 0, pre_slaughter_dead: 0, rejected_birds: 0, start_time: "", notes: "" });
    fetchAll();
  };

  const saveWorker = async () => {
    if (!workerForm.full_name) { toast.error("أدخل اسم العامل"); return; }
    const { error } = await supabase.from("slaughter_workers" as any).insert(workerForm);
    if (error) { toast.error(error.message); return; }
    toast.success("تمت إضافة العامل");
    setWorkerOpen(false);
    setWorkerForm({ full_name: "", role: "slaughterer", phone: "", daily_wage: 0 });
    fetchAll();
  };

  const saveQC = async () => {
    if (!qcForm.inspector_name) { toast.error("أدخل اسم المفتش"); return; }
    const { data: { user } } = await supabase.auth.getUser();
    const payload: any = { ...qcForm, created_by: user?.id };
    if (!payload.related_batch_id) delete payload.related_batch_id;
    if (!payload.temperature_c) delete payload.temperature_c;
    if (!payload.ph_level) delete payload.ph_level;
    const { error } = await supabase.from("slaughter_quality_checks" as any).insert(payload);
    if (error) { toast.error(error.message); return; }
    toast.success("تم تسجيل فحص الجودة");
    setQcOpen(false);
    setQcForm({ check_type: "post_slaughter", related_batch_id: "", inspector_name: "", result: "pass", temperature_c: "", ph_level: "", notes: "" });
    fetchAll();
  };

  const completeBatch = async (batch: Batch) => {
    const batchOutputs = outputs.filter(o => o.batch_id === batch.id);
    if (!batchOutputs.length) { toast.error("سجّل المخرجات أولاً"); return; }
    const totalMeat = batchOutputs.filter(o => o.destination !== "waste").reduce((s, o) => s + Number(o.actual_weight_kg), 0);
    // get receipt cost
    let totalCost = 0;
    if (batch.live_receipt_id) {
      const rec = receipts.find(r => r.id === batch.live_receipt_id);
      if (rec) totalCost = Number(rec.total_cost);
    }
    const cost_per_kg = totalMeat > 0 ? totalCost / totalMeat : 0;
    const { error } = await supabase.from("slaughter_batches" as any).update({ status: "completed", total_meat_kg: totalMeat, cost_per_kg_meat: cost_per_kg, end_time: new Date().toTimeString().slice(0, 8) }).eq("id", batch.id);
    if (error) { toast.error(error.message); return; }
    toast.success(`اكتملت الدفعة — التصافي ${((totalMeat / Number(batch.total_live_weight_kg)) * 100).toFixed(1)}%`);
    fetchAll();
  };

  const statusBadge = (s: string) => {
    const map: Record<string, { label: string; cls: string }> = {
      received: { label: "مستلم", cls: "bg-blue-500/20 text-blue-700" },
      in_holding: { label: "بالحظيرة", cls: "bg-amber-500/20 text-amber-700" },
      processed: { label: "تم الذبح", cls: "bg-emerald-500/20 text-emerald-700" },
      in_progress: { label: "قيد الذبح", cls: "bg-purple-500/20 text-purple-700" },
      completed: { label: "مكتمل", cls: "bg-emerald-500/20 text-emerald-700" },
      cancelled: { label: "ملغي", cls: "bg-red-500/20 text-red-700" },
      pass: { label: "ناجح", cls: "bg-emerald-500/20 text-emerald-700" },
      warning: { label: "تحذير", cls: "bg-amber-500/20 text-amber-700" },
      fail: { label: "راسب", cls: "bg-red-500/20 text-red-700" },
    };
    const v = map[s] || { label: s, cls: "bg-muted" };
    return <Badge variant="outline" className={v.cls}>{v.label}</Badge>;
  };

  return (
    <DashboardLayout>
      <Header title="إدارة المجزر" subtitle="استلام الطيور، الذبح، المخرجات والتصافي" />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <Card><CardContent className="p-4 flex items-center justify-between">
          <div><p className="text-xs text-muted-foreground">طيور اليوم</p><p className="text-2xl font-bold">{birdsToday}</p></div>
          <Beef className="w-8 h-8 text-primary/40" />
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center justify-between">
          <div><p className="text-xs text-muted-foreground">لحوم اليوم (كجم)</p><p className="text-2xl font-bold">{meatToday.toFixed(1)}</p></div>
          <Scale className="w-8 h-8 text-accent/40" />
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center justify-between">
          <div><p className="text-xs text-muted-foreground">إنتاج الشهر (كجم)</p><p className="text-2xl font-bold">{meatMonth.toFixed(0)}</p></div>
          <Package className="w-8 h-8 text-emerald-500/40" />
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center justify-between">
          <div><p className="text-xs text-muted-foreground">التصافي اليوم</p><p className={`text-2xl font-bold ${yieldToday < 40 ? "text-red-600" : "text-emerald-600"}`}>{yieldToday.toFixed(1)}%</p></div>
          <TrendingUp className="w-8 h-8 text-blue-500/40" />
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center justify-between">
          <div><p className="text-xs text-muted-foreground">تكلفة الكيلو</p><p className="text-2xl font-bold">{avgCost.toFixed(0)} ر.س</p></div>
          <ClipboardCheck className="w-8 h-8 text-amber-500/40" />
        </CardContent></Card>
      </div>

      <Tabs defaultValue="batches" dir="rtl">
        <TabsList className="grid grid-cols-5 w-full md:w-auto">
          <TabsTrigger value="batches">دفعات الذبح</TabsTrigger>
          <TabsTrigger value="receipts">استلام حي</TabsTrigger>
          <TabsTrigger value="yields">المخرجات القياسية</TabsTrigger>
          <TabsTrigger value="workers">العمال</TabsTrigger>
          <TabsTrigger value="quality">ضبط الجودة</TabsTrigger>
        </TabsList>

        {/* ========== BATCHES ========== */}
        <TabsContent value="batches">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>دفعات الذبح</CardTitle>
              <Dialog open={batchOpen} onOpenChange={setBatchOpen}>
                <DialogTrigger asChild><Button className="bg-gradient-to-r from-primary to-accent"><Plus className="w-4 h-4 ml-1" />دفعة جديدة</Button></DialogTrigger>
                <DialogContent dir="rtl" className="max-w-2xl">
                  <DialogHeader><DialogTitle>دفعة ذبح جديدة</DialogTitle></DialogHeader>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>استلام حي مرتبط</Label>
                      <Select value={batchForm.live_receipt_id} onValueChange={v => setBatchForm({ ...batchForm, live_receipt_id: v })}>
                        <SelectTrigger><SelectValue placeholder="اختر استلام..." /></SelectTrigger>
                        <SelectContent>{receipts.filter(r => r.status !== "processed").map(r => (
                          <SelectItem key={r.id} value={r.id}>{r.receipt_number} ({r.bird_count} طائر)</SelectItem>
                        ))}</SelectContent>
                      </Select>
                    </div>
                    <div><Label>الشيفت</Label>
                      <Select value={batchForm.shift} onValueChange={v => setBatchForm({ ...batchForm, shift: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="morning">صباحي</SelectItem>
                          <SelectItem value="evening">مسائي</SelectItem>
                          <SelectItem value="night">ليلي</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div><Label>عدد الطيور المذبوحة</Label><Input type="number" value={batchForm.birds_slaughtered || ""} onChange={e => setBatchForm({ ...batchForm, birds_slaughtered: +e.target.value })} /></div>
                    <div><Label>الوزن الحي الإجمالي (كجم)</Label><Input type="number" step="0.1" value={batchForm.total_live_weight_kg || ""} onChange={e => setBatchForm({ ...batchForm, total_live_weight_kg: +e.target.value })} /></div>
                    <div><Label>نافق قبل الذبح</Label><Input type="number" value={batchForm.pre_slaughter_dead || ""} onChange={e => setBatchForm({ ...batchForm, pre_slaughter_dead: +e.target.value })} /></div>
                    <div><Label>مرفوض صحياً</Label><Input type="number" value={batchForm.rejected_birds || ""} onChange={e => setBatchForm({ ...batchForm, rejected_birds: +e.target.value })} /></div>
                    <div><Label>وقت البدء</Label><Input type="time" value={batchForm.start_time} onChange={e => setBatchForm({ ...batchForm, start_time: e.target.value })} /></div>
                    <div className="col-span-2"><Label>ملاحظات</Label><Textarea value={batchForm.notes} onChange={e => setBatchForm({ ...batchForm, notes: e.target.value })} /></div>
                  </div>
                  <DialogFooter><Button onClick={saveBatch}>حفظ</Button></DialogFooter>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>رقم الدفعة</TableHead><TableHead>التاريخ</TableHead><TableHead>الشيفت</TableHead>
                  <TableHead>الطيور</TableHead><TableHead>الوزن الحي</TableHead><TableHead>اللحم</TableHead>
                  <TableHead>التصافي</TableHead><TableHead>تكلفة/كجم</TableHead><TableHead>الحالة</TableHead><TableHead>إجراءات</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {batches.map(b => (
                    <TableRow key={b.id}>
                      <TableCell className="font-mono text-xs">{b.batch_number}</TableCell>
                      <TableCell>{b.slaughter_date}</TableCell>
                      <TableCell>{b.shift === "morning" ? "صباحي" : b.shift === "evening" ? "مسائي" : "ليلي"}</TableCell>
                      <TableCell>{b.birds_slaughtered}</TableCell>
                      <TableCell>{Number(b.total_live_weight_kg).toFixed(1)}</TableCell>
                      <TableCell>{Number(b.total_meat_kg || 0).toFixed(1)}</TableCell>
                      <TableCell><span className={Number(b.actual_yield_pct) < 40 && Number(b.actual_yield_pct) > 0 ? "text-red-600 font-bold" : ""}>{Number(b.actual_yield_pct || 0).toFixed(1)}%</span></TableCell>
                      <TableCell>{Number(b.cost_per_kg_meat || 0).toFixed(0)}</TableCell>
                      <TableCell>{statusBadge(b.status)}</TableCell>
                      <TableCell className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => setOutputBatchId(b.id)}>المخرجات</Button>
                        {b.status === "in_progress" && <Button size="sm" onClick={() => completeBatch(b)}><CheckCircle2 className="w-4 h-4" /></Button>}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!batches.length && <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">لا توجد دفعات بعد</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {outputBatchId && (
            <BatchOutputsDialog
              batchId={outputBatchId}
              batch={batches.find(b => b.id === outputBatchId)!}
              yields={yields}
              outputs={outputs.filter(o => o.batch_id === outputBatchId)}
              onClose={() => setOutputBatchId(null)}
              onUpdate={fetchAll}
            />
          )}
        </TabsContent>

        {/* ========== RECEIPTS ========== */}
        <TabsContent value="receipts">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>استلام الطيور الحية</CardTitle>
              <Dialog open={receiptOpen} onOpenChange={setReceiptOpen}>
                <DialogTrigger asChild><Button className="bg-gradient-to-r from-primary to-accent"><Plus className="w-4 h-4 ml-1" />استلام جديد</Button></DialogTrigger>
                <DialogContent dir="rtl" className="max-w-2xl">
                  <DialogHeader><DialogTitle>تسجيل استلام طيور</DialogTitle></DialogHeader>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>المصدر</Label>
                      <Select value={receiptForm.source_type} onValueChange={v => setReceiptForm({ ...receiptForm, source_type: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="internal_farm">المزرعة الداخلية</SelectItem>
                          <SelectItem value="external_supplier">مورد خارجي</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div><Label>اسم المصدر / المورد</Label><Input value={receiptForm.source_name} onChange={e => setReceiptForm({ ...receiptForm, source_name: e.target.value })} /></div>
                    <div><Label>عدد الطيور</Label><Input type="number" value={receiptForm.bird_count || ""} onChange={e => setReceiptForm({ ...receiptForm, bird_count: +e.target.value })} /></div>
                    <div><Label>الوزن الإجمالي (كجم)</Label><Input type="number" step="0.1" value={receiptForm.total_weight_kg || ""} onChange={e => setReceiptForm({ ...receiptForm, total_weight_kg: +e.target.value })} /></div>
                    <div><Label>متوسط العمر (أيام)</Label><Input type="number" value={receiptForm.avg_age_days || ""} onChange={e => setReceiptForm({ ...receiptForm, avg_age_days: +e.target.value })} /></div>
                    <div><Label>السعر/كجم (ر.س)</Label><Input type="number" step="0.01" value={receiptForm.price_per_kg || ""} onChange={e => setReceiptForm({ ...receiptForm, price_per_kg: +e.target.value })} /></div>
                    <div><Label>نافق عند الوصول</Label><Input type="number" value={receiptForm.dead_on_arrival || ""} onChange={e => setReceiptForm({ ...receiptForm, dead_on_arrival: +e.target.value })} /></div>
                    <div className="col-span-2"><Label>ملاحظات</Label><Textarea value={receiptForm.notes} onChange={e => setReceiptForm({ ...receiptForm, notes: e.target.value })} /></div>
                    <div className="col-span-2 text-sm text-muted-foreground">التكلفة الإجمالية: <b>{(receiptForm.total_weight_kg * receiptForm.price_per_kg).toFixed(2)} ر.س</b></div>
                  </div>
                  <DialogFooter><Button onClick={saveReceipt}>حفظ</Button></DialogFooter>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>الرقم</TableHead><TableHead>التاريخ</TableHead><TableHead>المصدر</TableHead>
                  <TableHead>عدد</TableHead><TableHead>وزن (كجم)</TableHead><TableHead>متوسط الوزن</TableHead>
                  <TableHead>سعر/كجم</TableHead><TableHead>التكلفة</TableHead><TableHead>نافق</TableHead><TableHead>الحالة</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {receipts.map(r => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.receipt_number}</TableCell>
                      <TableCell>{r.receipt_date}</TableCell>
                      <TableCell>{r.source_type === "internal_farm" ? "🏡 داخلي" : "🚚 خارجي"} — {r.source_name || "-"}</TableCell>
                      <TableCell>{r.bird_count}</TableCell>
                      <TableCell>{Number(r.total_weight_kg).toFixed(1)}</TableCell>
                      <TableCell>{Number(r.avg_weight_kg).toFixed(1)}</TableCell>
                      <TableCell>{Number(r.price_per_kg).toFixed(2)}</TableCell>
                      <TableCell className="font-semibold">{Number(r.total_cost).toFixed(0)}</TableCell>
                      <TableCell>{r.dead_on_arrival > 0 && <span className="text-red-600">{r.dead_on_arrival}</span>}</TableCell>
                      <TableCell>{statusBadge(r.status)}</TableCell>
                    </TableRow>
                  ))}
                  {!receipts.length && <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">لا توجد عمليات استلام</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ========== YIELDS ========== */}
        <TabsContent value="yields">
          <Card>
            <CardHeader><CardTitle>المخرجات القياسية لكل طائر</CardTitle></CardHeader>
            <CardContent>
              <div className="mb-4 p-3 bg-muted/50 rounded-lg text-sm">
                <AlertTriangle className="w-4 h-4 inline ml-1 text-amber-600" />
                هذه النسب القياسية تستخدم لمقارنة التصافي الفعلي بالمعياري. الباركودات الرسمية معتمدة من الجهات الرسمية.
              </div>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>القطعة</TableHead><TableHead>الاسم EN</TableHead><TableHead>الباركود الرسمي</TableHead>
                  <TableHead>% من الوزن الحي</TableHead><TableHead>وزن العبوة</TableHead><TableHead>الفئة</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {yields.map(y => (
                    <TableRow key={y.id}>
                      <TableCell className="font-semibold">{y.cut_name_ar}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{y.cut_name_en}</TableCell>
                      <TableCell className="font-mono text-xs">{y.barcode}</TableCell>
                      <TableCell><Badge className="bg-primary/20 text-primary">{Number(y.standard_yield_pct).toFixed(1)}%</Badge></TableCell>
                      <TableCell>{y.package_size_kg} كجم</TableCell>
                      <TableCell><Badge variant="outline">{y.category === "meat" ? "لحم" : y.category === "offal" ? "أحشاء" : y.category === "waste" ? "مخلفات" : "ناتج ثانوي"}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="mt-4 pt-4 border-t text-sm text-muted-foreground">
                <b>إجمالي التصافي القياسي:</b> {yields.filter(y => y.category !== "waste").reduce((s, y) => s + Number(y.standard_yield_pct), 0).toFixed(1)}%
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ========== WORKERS ========== */}
        <TabsContent value="workers">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>عمال المجزر</CardTitle>
              <Dialog open={workerOpen} onOpenChange={setWorkerOpen}>
                <DialogTrigger asChild><Button className="bg-gradient-to-r from-primary to-accent"><Plus className="w-4 h-4 ml-1" />عامل جديد</Button></DialogTrigger>
                <DialogContent dir="rtl">
                  <DialogHeader><DialogTitle>إضافة عامل</DialogTitle></DialogHeader>
                  <div className="grid gap-3">
                    <div><Label>الاسم الكامل</Label><Input value={workerForm.full_name} onChange={e => setWorkerForm({ ...workerForm, full_name: e.target.value })} /></div>
                    <div><Label>الدور</Label>
                      <Select value={workerForm.role} onValueChange={v => setWorkerForm({ ...workerForm, role: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="slaughterer">ذبّاح</SelectItem>
                          <SelectItem value="cutter">مقطّع</SelectItem>
                          <SelectItem value="packer">معبّئ</SelectItem>
                          <SelectItem value="supervisor">مشرف</SelectItem>
                          <SelectItem value="quality_inspector">مفتش جودة</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div><Label>الهاتف</Label><Input value={workerForm.phone} onChange={e => setWorkerForm({ ...workerForm, phone: e.target.value })} /></div>
                    <div><Label>الأجر اليومي (ر.س)</Label><Input type="number" value={workerForm.daily_wage || ""} onChange={e => setWorkerForm({ ...workerForm, daily_wage: +e.target.value })} /></div>
                  </div>
                  <DialogFooter><Button onClick={saveWorker}>حفظ</Button></DialogFooter>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>الاسم</TableHead><TableHead>الدور</TableHead><TableHead>الهاتف</TableHead><TableHead>أجر يومي</TableHead><TableHead>الحالة</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {workers.map(w => (
                    <TableRow key={w.id}>
                      <TableCell className="font-semibold flex items-center gap-2"><Users className="w-4 h-4 text-muted-foreground" />{w.full_name}</TableCell>
                      <TableCell>{({ slaughterer: "ذبّاح", cutter: "مقطّع", packer: "معبّئ", supervisor: "مشرف", quality_inspector: "مفتش جودة" } as any)[w.role] || w.role}</TableCell>
                      <TableCell>{w.phone || "-"}</TableCell>
                      <TableCell>{w.daily_wage} ر.س</TableCell>
                      <TableCell>{w.is_active ? <Badge className="bg-emerald-500/20 text-emerald-700">نشط</Badge> : <Badge variant="outline">موقوف</Badge>}</TableCell>
                    </TableRow>
                  ))}
                  {!workers.length && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">لا يوجد عمال مسجلون</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ========== QUALITY ========== */}
        <TabsContent value="quality">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>فحوصات الجودة</CardTitle>
              <Dialog open={qcOpen} onOpenChange={setQcOpen}>
                <DialogTrigger asChild><Button className="bg-gradient-to-r from-primary to-accent"><Plus className="w-4 h-4 ml-1" />فحص جديد</Button></DialogTrigger>
                <DialogContent dir="rtl" className="max-w-2xl">
                  <DialogHeader><DialogTitle>تسجيل فحص جودة</DialogTitle></DialogHeader>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>نوع الفحص</Label>
                      <Select value={qcForm.check_type} onValueChange={v => setQcForm({ ...qcForm, check_type: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pre_slaughter">قبل الذبح</SelectItem>
                          <SelectItem value="post_slaughter">بعد الذبح</SelectItem>
                          <SelectItem value="packaging">عند التعبئة</SelectItem>
                          <SelectItem value="random">عشوائي</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div><Label>دفعة الذبح</Label>
                      <Select value={qcForm.related_batch_id} onValueChange={v => setQcForm({ ...qcForm, related_batch_id: v })}>
                        <SelectTrigger><SelectValue placeholder="اختياري" /></SelectTrigger>
                        <SelectContent>{batches.slice(0, 50).map(b => <SelectItem key={b.id} value={b.id}>{b.batch_number}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div><Label>اسم المفتش</Label><Input value={qcForm.inspector_name} onChange={e => setQcForm({ ...qcForm, inspector_name: e.target.value })} /></div>
                    <div><Label>النتيجة</Label>
                      <Select value={qcForm.result} onValueChange={v => setQcForm({ ...qcForm, result: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pass">ناجح</SelectItem>
                          <SelectItem value="warning">تحذير</SelectItem>
                          <SelectItem value="fail">راسب</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div><Label>درجة الحرارة (°م)</Label><Input type="number" step="0.1" value={qcForm.temperature_c} onChange={e => setQcForm({ ...qcForm, temperature_c: e.target.value })} /></div>
                    <div><Label>درجة الـ pH</Label><Input type="number" step="0.01" value={qcForm.ph_level} onChange={e => setQcForm({ ...qcForm, ph_level: e.target.value })} /></div>
                    <div className="col-span-2"><Label>ملاحظات</Label><Textarea value={qcForm.notes} onChange={e => setQcForm({ ...qcForm, notes: e.target.value })} /></div>
                  </div>
                  <DialogFooter><Button onClick={saveQC}>حفظ</Button></DialogFooter>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>التاريخ</TableHead><TableHead>النوع</TableHead><TableHead>المفتش</TableHead>
                  <TableHead>النتيجة</TableHead><TableHead>الحرارة</TableHead><TableHead>pH</TableHead><TableHead>ملاحظات</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {qcs.map(q => (
                    <TableRow key={q.id}>
                      <TableCell>{q.check_date}</TableCell>
                      <TableCell>{({ pre_slaughter: "قبل الذبح", post_slaughter: "بعد الذبح", packaging: "تعبئة", random: "عشوائي" } as any)[q.check_type]}</TableCell>
                      <TableCell>{q.inspector_name}</TableCell>
                      <TableCell>{statusBadge(q.result)}</TableCell>
                      <TableCell>{q.temperature_c ?? "-"}</TableCell>
                      <TableCell>{q.ph_level ?? "-"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-xs truncate">{q.notes || "-"}</TableCell>
                    </TableRow>
                  ))}
                  {!qcs.length && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">لا توجد فحوصات</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </DashboardLayout>
  );
};

// ===== Batch Outputs Dialog =====
const BatchOutputsDialog = ({ batchId, batch, yields, outputs, onClose, onUpdate }: {
  batchId: string; batch: Batch; yields: Yield[]; outputs: Output[]; onClose: () => void; onUpdate: () => void;
}) => {
  const [rows, setRows] = useState(yields.map(y => {
    const existing = outputs.find(o => o.cut_name_ar === y.cut_name_ar);
    return {
      yield_standard_id: y.id,
      cut_name_ar: y.cut_name_ar,
      barcode: y.barcode || "",
      actual_weight_kg: existing ? Number(existing.actual_weight_kg) : 0,
      package_count: existing ? existing.package_count : 0,
      standard_weight_kg: (Number(batch.total_live_weight_kg) * Number(y.standard_yield_pct)) / 100,
      unit_cost: existing ? Number(existing.unit_cost) : 0,
      destination: existing ? existing.destination : "warehouse",
      _existing_id: existing?.id || null,
    };
  }));

  const totalActual = rows.reduce((s, r) => s + (r.actual_weight_kg || 0), 0);
  const totalStandard = rows.reduce((s, r) => s + r.standard_weight_kg, 0);

  const save = async () => {
    const toUpsert = rows.filter(r => r.actual_weight_kg > 0).map(r => ({
      batch_id: batchId,
      yield_standard_id: r.yield_standard_id,
      cut_name_ar: r.cut_name_ar,
      barcode: r.barcode || null,
      actual_weight_kg: r.actual_weight_kg,
      package_count: r.package_count,
      standard_weight_kg: r.standard_weight_kg,
      unit_cost: r.unit_cost,
      destination: r.destination,
    }));
    // Clear existing then insert
    await supabase.from("slaughter_batch_outputs" as any).delete().eq("batch_id", batchId);
    if (toUpsert.length) {
      const { error } = await supabase.from("slaughter_batch_outputs" as any).insert(toUpsert);
      if (error) { toast.error(error.message); return; }
    }
    toast.success(`تم حفظ ${toUpsert.length} مخرج`);
    onClose();
    onUpdate();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent dir="rtl" className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>مخرجات الدفعة {batch.batch_number}</DialogTitle></DialogHeader>
        <div className="p-3 bg-muted/50 rounded-lg text-sm mb-3">
          الوزن الحي: <b>{Number(batch.total_live_weight_kg).toFixed(1)} كجم</b> —
          إجمالي المخرجات الفعلية: <b>{totalActual.toFixed(1)} كجم</b> —
          القياسي: <b>{totalStandard.toFixed(1)} كجم</b> —
          التصافي الفعلي: <b className={totalActual / Number(batch.total_live_weight_kg) < 0.4 ? "text-red-600" : "text-emerald-600"}>{Number(batch.total_live_weight_kg) > 0 ? ((totalActual / Number(batch.total_live_weight_kg)) * 100).toFixed(1) : 0}%</b>
        </div>
        <Table>
          <TableHeader><TableRow>
            <TableHead>القطعة</TableHead><TableHead>الباركود</TableHead>
            <TableHead>الوزن القياسي</TableHead><TableHead>الوزن الفعلي</TableHead>
            <TableHead>عدد العبوات</TableHead><TableHead>التكلفة/كجم</TableHead><TableHead>الوجهة</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={r.yield_standard_id}>
                <TableCell className="font-semibold">{r.cut_name_ar}</TableCell>
                <TableCell className="font-mono text-xs">{r.barcode}</TableCell>
                <TableCell className="text-muted-foreground">{r.standard_weight_kg.toFixed(1)}</TableCell>
                <TableCell><Input className="w-24" type="number" step="0.1" value={r.actual_weight_kg || ""} onChange={e => { const v = [...rows]; v[i].actual_weight_kg = +e.target.value; setRows(v); }} /></TableCell>
                <TableCell><Input className="w-20" type="number" value={r.package_count || ""} onChange={e => { const v = [...rows]; v[i].package_count = +e.target.value; setRows(v); }} /></TableCell>
                <TableCell><Input className="w-24" type="number" step="0.01" value={r.unit_cost || ""} onChange={e => { const v = [...rows]; v[i].unit_cost = +e.target.value; setRows(v); }} /></TableCell>
                <TableCell>
                  <Select value={r.destination} onValueChange={v => { const arr = [...rows]; arr[i].destination = v; setRows(arr); }}>
                    <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="warehouse">مخزون</SelectItem>
                      <SelectItem value="meat_factory">مصنع اللحوم</SelectItem>
                      <SelectItem value="direct_sale">بيع مباشر</SelectItem>
                      <SelectItem value="waste">مخلفات</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <DialogFooter><Button onClick={save} className="bg-gradient-to-r from-primary to-accent">حفظ المخرجات</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default Slaughterhouse;
