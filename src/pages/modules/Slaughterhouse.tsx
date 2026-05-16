import { useEffect, useMemo, useState } from "react";
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
import {
  Beef, TrendingUp, Package, Scale, Plus, AlertTriangle, CheckCircle2,
  Users, ClipboardCheck, Bird, FileSpreadsheet, FileText, Truck, Trash2,
  Settings as SettingsIcon, History, Save,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip as RTooltip,
  ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";

type Receipt = { id: string; receipt_number: string; receipt_date: string; source_type: string; source_name: string | null; bird_count: number; total_weight_kg: number; avg_weight_kg: number; price_per_kg: number; total_cost: number; dead_on_arrival: number; status: string; };
type Batch = { id: string; batch_number: string; slaughter_date: string; shift: string; live_receipt_id: string | null; birds_slaughtered: number; total_live_weight_kg: number; total_meat_kg: number; actual_yield_pct: number; cost_per_kg_meat: number; status: string; pre_slaughter_dead: number; rejected_birds: number; };
type Yield = { id: string; cut_name_ar: string; cut_name_en: string | null; barcode: string | null; standard_yield_pct: number; package_size_kg: number | null; category: string; display_order: number; is_active: boolean; };
type Output = { id: string; batch_id: string; cut_name_ar: string; barcode: string | null; actual_weight_kg: number; package_count: number; standard_weight_kg: number; variance_pct: number; unit_cost: number; unit_price: number; total_cost: number; destination: string; branch_id: string | null; };
type Worker = { id: string; full_name: string; role: string; phone: string | null; daily_wage: number; is_active: boolean; };
type QC = { id: string; check_type: string; check_date: string; inspector_name: string; result: string; temperature_c: number | null; ph_level: number | null; notes: string | null; };
type Branch = { id: string; code: string; name_ar: string; is_active: boolean };
type LiveBird = { id: string; receipt_id: string; bird_index: number; live_weight_kg: number; slaughter_weight_kg: number; purchase_cost: number; purchase_time: string | null; feed_cost: number; notes: string | null };
type Transfer = { id: string; batch_id: string; output_id: string | null; branch_id: string; cut_name_ar: string; weight_kg: number; unit_price: number; total_value: number; status: string; transferred_at: string };
type Settings = { id: string; low_yield_threshold: number; warning_yield_threshold: number; notify_on_low_yield: boolean };
type AuditEntry = { id: string; action: string; target_type: string; target_id: string | null; batch_id: string | null; transfer_id: string | null; performed_by: string | null; performed_at: string; old_value: any; new_value: any; notes: string | null };

const Slaughterhouse = () => {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [yields, setYields] = useState<Yield[]>([]);
  const [outputs, setOutputs] = useState<Output[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [qcs, setQcs] = useState<QC[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [birds, setBirds] = useState<LiveBird[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);

  // Dialogs
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [outputBatchId, setOutputBatchId] = useState<string | null>(null);
  const [birdsReceiptId, setBirdsReceiptId] = useState<string | null>(null);
  const [workerOpen, setWorkerOpen] = useState(false);
  const [qcOpen, setQcOpen] = useState(false);

  // Forms
  const [receiptForm, setReceiptForm] = useState({ source_type: "internal_farm", source_name: "", bird_count: 0, total_weight_kg: 0, avg_age_days: 0, price_per_kg: 0, dead_on_arrival: 0, notes: "" });
  const [batchForm, setBatchForm] = useState({ live_receipt_id: "", shift: "morning", birds_slaughtered: 0, total_live_weight_kg: 0, pre_slaughter_dead: 0, rejected_birds: 0, start_time: "", notes: "" });
  const [workerForm, setWorkerForm] = useState({ full_name: "", role: "slaughterer", phone: "", daily_wage: 0 });
  const [qcForm, setQcForm] = useState({ check_type: "post_slaughter", related_batch_id: "", inspector_name: "", result: "pass", temperature_c: "", ph_level: "", notes: "" });

  // Daily report date
  const [reportDate, setReportDate] = useState(new Date().toISOString().slice(0, 10));

  const fetchAll = async () => {
    setLoading(true);
    const [r, b, y, o, w, q, br, bd, tr] = await Promise.all([
      supabase.from("slaughter_live_receipts" as any).select("*").order("receipt_date", { ascending: false }).limit(500),
      supabase.from("slaughter_batches" as any).select("*").order("slaughter_date", { ascending: false }).limit(500),
      supabase.from("slaughter_yield_standards" as any).select("*").order("display_order"),
      supabase.from("slaughter_batch_outputs" as any).select("*").order("created_at", { ascending: false }).limit(1000),
      supabase.from("slaughter_workers" as any).select("*").order("full_name"),
      supabase.from("slaughter_quality_checks" as any).select("*").order("check_date", { ascending: false }).limit(200),
      supabase.from("branches" as any).select("*").order("name_ar"),
      supabase.from("slaughter_live_birds" as any).select("*").order("bird_index"),
      supabase.from("slaughter_branch_transfers" as any).select("*").order("transferred_at", { ascending: false }).limit(1000),
    ]);
    setReceipts((r.data as any) || []);
    setBatches((b.data as any) || []);
    setYields((y.data as any) || []);
    setOutputs((o.data as any) || []);
    setWorkers((w.data as any) || []);
    setQcs((q.data as any) || []);
    setBranches((br.data as any) || []);
    setBirds((bd.data as any) || []);
    setTransfers((tr.data as any) || []);
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

  const saveReceipt = async () => {
    if (!receiptForm.bird_count || !receiptForm.total_weight_kg) { toast.error("أدخل عدد الطيور والوزن الإجمالي"); return; }
    const receipt_number = `LR-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.floor(Math.random() * 9999).toString().padStart(4, "0")}`;
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("slaughter_live_receipts" as any).insert({ ...receiptForm, receipt_number, created_by: user?.id });
    if (error) { toast.error(error.message); return; }
    toast.success("تم تسجيل الاستلام — أضف وزن كل طائر منفصلًا الآن");
    setReceiptOpen(false);
    setReceiptForm({ source_type: "internal_farm", source_name: "", bird_count: 0, total_weight_kg: 0, avg_age_days: 0, price_per_kg: 0, dead_on_arrival: 0, notes: "" });
    fetchAll();
  };

  const saveBatch = async () => {
    if (!batchForm.birds_slaughtered || !batchForm.total_live_weight_kg) { toast.error("أدخل عدد الطيور المذبوحة والوزن الحي"); return; }
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

  const finalizeBatch = async (batch: Batch) => {
    const batchOutputs = outputs.filter(o => o.batch_id === batch.id);
    if (!batchOutputs.length) { toast.error("سجّل المخرجات أولاً"); return; }
    const { data, error } = await supabase.rpc("finalize_slaughter_batch" as any, { p_batch_id: batch.id });
    if (error) { toast.error(error.message); return; }
    const d: any = data;
    toast.success(`اكتملت الدفعة — ${Number(d?.total_meat_kg || 0).toFixed(1)} كجم — تكلفة ${Number(d?.cost_per_kg_meat || 0).toFixed(0)} ر.س/كجم — ${d?.transfers_created || 0} تحويل للفروع`);
    fetchAll();
  };

  const updateTransferStatus = async (id: string, status: string) => {
    const { error } = await supabase.from("slaughter_branch_transfers" as any).update({ status }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("تم تحديث حالة التحويل");
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
      pending: { label: "في الانتظار", cls: "bg-amber-500/20 text-amber-700" },
      rejected: { label: "مرفوض", cls: "bg-red-500/20 text-red-700" },
    };
    const v = map[s] || { label: s, cls: "bg-muted" };
    return <Badge variant="outline" className={v.cls}>{v.label}</Badge>;
  };

  return (
    <DashboardLayout>
      <Header title="إدارة المجزر" subtitle="استلام النعام، تفريغة الذبح اليومي، التقسيمة والتوزيع على الفروع" />

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

      <Tabs defaultValue="daily" dir="rtl">
        <TabsList className="grid grid-cols-4 md:grid-cols-7 w-full">
          <TabsTrigger value="daily">تفريغة اليوم</TabsTrigger>
          <TabsTrigger value="batches">دفعات الذبح</TabsTrigger>
          <TabsTrigger value="receipts">استلام حي</TabsTrigger>
          <TabsTrigger value="transfers">توزيع الفروع</TabsTrigger>
          <TabsTrigger value="yields">المعيار القياسي</TabsTrigger>
          <TabsTrigger value="workers">العمال</TabsTrigger>
          <TabsTrigger value="quality">الجودة</TabsTrigger>
        </TabsList>

        {/* ========== DAILY REPORT (Excel-style) ========== */}
        <TabsContent value="daily">
          <DailyReportTab
            reportDate={reportDate}
            setReportDate={setReportDate}
            receipts={receipts}
            birds={birds}
            batches={batches}
            outputs={outputs}
            branches={branches}
          />
        </TabsContent>

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
                      <Select value={batchForm.live_receipt_id} onValueChange={v => {
                        const r = receipts.find(x => x.id === v);
                        setBatchForm({ ...batchForm, live_receipt_id: v, birds_slaughtered: r?.bird_count || 0, total_live_weight_kg: Number(r?.total_weight_kg || 0) });
                      }}>
                        <SelectTrigger><SelectValue placeholder="اختر استلام..." /></SelectTrigger>
                        <SelectContent>{receipts.filter(r => r.status !== "processed").map(r => (
                          <SelectItem key={r.id} value={r.id}>{r.receipt_number} ({r.bird_count} طائر — {Number(r.total_weight_kg).toFixed(1)} كجم)</SelectItem>
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
                        <Button size="sm" variant="outline" onClick={() => setOutputBatchId(b.id)}>التقسيمة</Button>
                        {b.status === "in_progress" && <Button size="sm" onClick={() => finalizeBatch(b)} title="إنهاء واحتساب التكلفة وتوزيع الفروع"><CheckCircle2 className="w-4 h-4" /></Button>}
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
              branches={branches}
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
                    <div><Label>عدد الطيور (مبدئي)</Label><Input type="number" value={receiptForm.bird_count || ""} onChange={e => setReceiptForm({ ...receiptForm, bird_count: +e.target.value })} /></div>
                    <div><Label>الوزن الإجمالي (مبدئي)</Label><Input type="number" step="0.1" value={receiptForm.total_weight_kg || ""} onChange={e => setReceiptForm({ ...receiptForm, total_weight_kg: +e.target.value })} /></div>
                    <div><Label>متوسط العمر (أيام)</Label><Input type="number" value={receiptForm.avg_age_days || ""} onChange={e => setReceiptForm({ ...receiptForm, avg_age_days: +e.target.value })} /></div>
                    <div><Label>السعر/كجم (ر.س)</Label><Input type="number" step="0.01" value={receiptForm.price_per_kg || ""} onChange={e => setReceiptForm({ ...receiptForm, price_per_kg: +e.target.value })} /></div>
                    <div><Label>نافق عند الوصول</Label><Input type="number" value={receiptForm.dead_on_arrival || ""} onChange={e => setReceiptForm({ ...receiptForm, dead_on_arrival: +e.target.value })} /></div>
                    <div className="col-span-2"><Label>ملاحظات</Label><Textarea value={receiptForm.notes} onChange={e => setReceiptForm({ ...receiptForm, notes: e.target.value })} /></div>
                    <div className="col-span-2 text-xs text-muted-foreground bg-muted/40 p-2 rounded">
                      💡 بعد الحفظ ستتمكن من إدخال وزن وتكلفة كل طائر منفصلًا (مطابق لتفريغة Excel) وسيتم تحديث الإجماليات تلقائيًا.
                    </div>
                  </div>
                  <DialogFooter><Button onClick={saveReceipt}>حفظ</Button></DialogFooter>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>الرقم</TableHead><TableHead>التاريخ</TableHead><TableHead>المصدر</TableHead>
                  <TableHead>عدد</TableHead><TableHead>وزن (كجم)</TableHead><TableHead>متوسط</TableHead>
                  <TableHead>تكلفة (إجمالي)</TableHead><TableHead>نافق</TableHead><TableHead>الحالة</TableHead><TableHead>الطيور</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {receipts.map(r => {
                    const recBirds = birds.filter(b => b.receipt_id === r.id);
                    const totalCost = recBirds.reduce((s, b) => s + Number(b.purchase_cost || 0) + Number(b.feed_cost || 0), 0) || Number(r.total_cost || 0);
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono text-xs">{r.receipt_number}</TableCell>
                        <TableCell>{r.receipt_date}</TableCell>
                        <TableCell>{r.source_type === "internal_farm" ? "🏡 داخلي" : "🚚 خارجي"} {r.source_name ? `— ${r.source_name}` : ""}</TableCell>
                        <TableCell>{r.bird_count}</TableCell>
                        <TableCell>{Number(r.total_weight_kg).toFixed(1)}</TableCell>
                        <TableCell>{Number(r.avg_weight_kg || 0).toFixed(1)}</TableCell>
                        <TableCell className="font-semibold">{totalCost.toFixed(0)}</TableCell>
                        <TableCell>{r.dead_on_arrival > 0 && <span className="text-red-600">{r.dead_on_arrival}</span>}</TableCell>
                        <TableCell>{statusBadge(r.status)}</TableCell>
                        <TableCell>
                          <Button size="sm" variant="outline" onClick={() => setBirdsReceiptId(r.id)}>
                            <Bird className="w-3 h-3 ml-1" />{recBirds.length}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {!receipts.length && <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">لا توجد عمليات استلام</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {birdsReceiptId && (
            <BirdsDialog
              receiptId={birdsReceiptId}
              receipt={receipts.find(r => r.id === birdsReceiptId)!}
              birds={birds.filter(b => b.receipt_id === birdsReceiptId)}
              onClose={() => setBirdsReceiptId(null)}
              onUpdate={fetchAll}
            />
          )}
        </TabsContent>

        {/* ========== TRANSFERS ========== */}
        <TabsContent value="transfers">
          <TransfersTab transfers={transfers} branches={branches} batches={batches} onStatus={updateTransferStatus} />
        </TabsContent>

        {/* ========== YIELDS ========== */}
        <TabsContent value="yields">
          <Card>
            <CardHeader><CardTitle>المعيار القياسي لتقسيمة الطائر</CardTitle></CardHeader>
            <CardContent>
              <div className="mb-4 p-3 bg-muted/50 rounded-lg text-sm">
                <AlertTriangle className="w-4 h-4 inline ml-1 text-amber-600" />
                هذه النسب القياسية تستخدم لمقارنة التصافي الفعلي بالمعياري في كل دفعة ذبح.
              </div>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>القطعة</TableHead><TableHead>EN</TableHead><TableHead>الباركود</TableHead>
                  <TableHead>% من الوزن الحي</TableHead><TableHead>وزن العبوة</TableHead><TableHead>الفئة</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {yields.map(y => (
                    <TableRow key={y.id}>
                      <TableCell className="font-semibold">{y.cut_name_ar}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{y.cut_name_en}</TableCell>
                      <TableCell className="font-mono text-xs">{y.barcode}</TableCell>
                      <TableCell><Badge className="bg-primary/20 text-primary">{Number(y.standard_yield_pct).toFixed(2)}%</Badge></TableCell>
                      <TableCell>{y.package_size_kg} كجم</TableCell>
                      <TableCell><Badge variant="outline">{y.category === "meat" ? "لحم" : y.category === "offal" ? "أحشاء" : y.category === "waste" ? "مخلفات" : "ناتج ثانوي"}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="mt-4 pt-4 border-t text-sm text-muted-foreground">
                <b>إجمالي التصافي القياسي:</b> {yields.filter(y => y.category !== "waste").reduce((s, y) => s + Number(y.standard_yield_pct), 0).toFixed(2)}%
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

// ===================== Birds dialog (per-bird Excel-style entry) =====================
const BirdsDialog = ({ receiptId, receipt, birds, onClose, onUpdate }: {
  receiptId: string; receipt: Receipt; birds: LiveBird[]; onClose: () => void; onUpdate: () => void;
}) => {
  const initial = birds.length
    ? birds.map(b => ({ ...b }))
    : Array.from({ length: Math.max(receipt.bird_count, 10) }, (_, i) => ({
        id: "", receipt_id: receiptId, bird_index: i + 1, live_weight_kg: 0, slaughter_weight_kg: 0,
        purchase_cost: 0, purchase_time: null as string | null, feed_cost: 0, notes: null as string | null,
      }));
  const [rows, setRows] = useState(initial);

  const totals = useMemo(() => ({
    live: rows.reduce((s, b) => s + Number(b.live_weight_kg || 0), 0),
    slaughter: rows.reduce((s, b) => s + Number(b.slaughter_weight_kg || 0), 0),
    purchase: rows.reduce((s, b) => s + Number(b.purchase_cost || 0), 0),
    feed: rows.reduce((s, b) => s + Number(b.feed_cost || 0), 0),
    count: rows.filter(b => Number(b.live_weight_kg) > 0).length,
  }), [rows]);

  const addRow = () => setRows([...rows, { id: "", receipt_id: receiptId, bird_index: rows.length + 1, live_weight_kg: 0, slaughter_weight_kg: 0, purchase_cost: 0, purchase_time: null, feed_cost: 0, notes: null }]);
  const removeRow = (i: number) => setRows(rows.filter((_, idx) => idx !== i));

  const save = async () => {
    // Delete existing for this receipt, re-insert non-empty
    await supabase.from("slaughter_live_birds" as any).delete().eq("receipt_id", receiptId);
    const toInsert = rows
      .filter(b => Number(b.live_weight_kg) > 0 || Number(b.purchase_cost) > 0)
      .map((b, i) => ({
        receipt_id: receiptId,
        bird_index: i + 1,
        live_weight_kg: Number(b.live_weight_kg) || 0,
        slaughter_weight_kg: Number(b.slaughter_weight_kg) || 0,
        purchase_cost: Number(b.purchase_cost) || 0,
        purchase_time: b.purchase_time || null,
        feed_cost: Number(b.feed_cost) || 0,
        notes: b.notes || null,
      }));
    if (toInsert.length) {
      const { error } = await supabase.from("slaughter_live_birds" as any).insert(toInsert);
      if (error) { toast.error(error.message); return; }
    }
    toast.success(`تم حفظ بيانات ${toInsert.length} طائر — الإجماليات محدّثة تلقائيًا`);
    onClose();
    onUpdate();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent dir="rtl" className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>تفريغة الذبح — {receipt.receipt_number} ({receipt.receipt_date})</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3 text-sm">
          <div className="p-2 bg-muted/40 rounded">العدد: <b>{totals.count}</b></div>
          <div className="p-2 bg-muted/40 rounded">إجمالي وزن قائم: <b>{totals.live.toFixed(1)} كجم</b></div>
          <div className="p-2 bg-muted/40 rounded">إجمالي وزن الذبح: <b>{totals.slaughter.toFixed(1)} كجم</b></div>
          <div className="p-2 bg-muted/40 rounded">تكلفة الشراء: <b>{totals.purchase.toFixed(0)} ر.س</b></div>
          <div className="p-2 bg-muted/40 rounded">تكلفة العلف: <b>{totals.feed.toFixed(0)} ر.س</b></div>
        </div>
        <Table>
          <TableHeader><TableRow>
            <TableHead className="w-12">#</TableHead>
            <TableHead>الوزن قائم وقت الشراء</TableHead>
            <TableHead>الوزن وقت الذبح</TableHead>
            <TableHead>تكلفة الشراء</TableHead>
            <TableHead>وقت الشراء</TableHead>
            <TableHead>تكلفة العلف</TableHead>
            <TableHead></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.map((b, i) => (
              <TableRow key={i}>
                <TableCell className="font-bold">{i + 1}</TableCell>
                <TableCell><Input className="w-24" type="number" step="0.1" value={b.live_weight_kg || ""} onChange={e => { const v = [...rows]; v[i].live_weight_kg = +e.target.value; setRows(v); }} /></TableCell>
                <TableCell><Input className="w-24" type="number" step="0.1" value={b.slaughter_weight_kg || ""} onChange={e => { const v = [...rows]; v[i].slaughter_weight_kg = +e.target.value; setRows(v); }} /></TableCell>
                <TableCell><Input className="w-28" type="number" step="0.01" value={b.purchase_cost || ""} onChange={e => { const v = [...rows]; v[i].purchase_cost = +e.target.value; setRows(v); }} /></TableCell>
                <TableCell><Input className="w-28" type="time" value={b.purchase_time || ""} onChange={e => { const v = [...rows]; v[i].purchase_time = e.target.value; setRows(v); }} /></TableCell>
                <TableCell><Input className="w-24" type="number" step="0.01" value={b.feed_cost || ""} onChange={e => { const v = [...rows]; v[i].feed_cost = +e.target.value; setRows(v); }} /></TableCell>
                <TableCell><Button size="icon" variant="ghost" onClick={() => removeRow(i)}><Trash2 className="w-4 h-4 text-red-500" /></Button></TableCell>
              </TableRow>
            ))}
            <TableRow className="font-bold bg-muted/30">
              <TableCell>الإجمالي</TableCell>
              <TableCell>{totals.live.toFixed(1)}</TableCell>
              <TableCell>{totals.slaughter.toFixed(1)}</TableCell>
              <TableCell>{totals.purchase.toFixed(0)}</TableCell>
              <TableCell></TableCell>
              <TableCell>{totals.feed.toFixed(0)}</TableCell>
              <TableCell></TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={addRow}><Plus className="w-4 h-4 ml-1" />صف جديد</Button>
          <Button onClick={save} className="bg-gradient-to-r from-primary to-accent">حفظ التفريغة</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ===================== Batch Outputs Dialog (with branch + unit_price) =====================
const BatchOutputsDialog = ({ batchId, batch, yields, outputs, branches, onClose, onUpdate }: {
  batchId: string; batch: Batch; yields: Yield[]; outputs: Output[]; branches: Branch[]; onClose: () => void; onUpdate: () => void;
}) => {
  // Allow multiple rows per cut (one per branch). Pre-fill with one row per yield if no existing.
  const initial = outputs.length
    ? outputs.map(o => ({
        yield_standard_id: yields.find(y => y.cut_name_ar === o.cut_name_ar)?.id || null,
        cut_name_ar: o.cut_name_ar,
        barcode: o.barcode || "",
        actual_weight_kg: Number(o.actual_weight_kg),
        package_count: o.package_count,
        standard_weight_kg: Number(o.standard_weight_kg),
        unit_cost: Number(o.unit_cost),
        unit_price: Number(o.unit_price || 0),
        destination: o.destination,
        branch_id: o.branch_id || "",
      }))
    : yields.map(y => ({
        yield_standard_id: y.id,
        cut_name_ar: y.cut_name_ar,
        barcode: y.barcode || "",
        actual_weight_kg: 0,
        package_count: 0,
        standard_weight_kg: (Number(batch.total_live_weight_kg) * Number(y.standard_yield_pct)) / 100,
        unit_cost: 0,
        unit_price: 0,
        destination: "branch",
        branch_id: "",
      }));
  const [rows, setRows] = useState(initial);

  const totalActual = rows.reduce((s, r) => s + (Number(r.actual_weight_kg) || 0), 0);
  const totalValue = rows.reduce((s, r) => s + (Number(r.actual_weight_kg) * Number(r.unit_price || 0)), 0);
  const yieldPct = Number(batch.total_live_weight_kg) > 0 ? (totalActual / Number(batch.total_live_weight_kg)) * 100 : 0;

  const addRow = (cutName: string) => {
    const y = yields.find(y => y.cut_name_ar === cutName);
    setRows([...rows, {
      yield_standard_id: y?.id || null,
      cut_name_ar: cutName,
      barcode: y?.barcode || "",
      actual_weight_kg: 0, package_count: 0,
      standard_weight_kg: y ? (Number(batch.total_live_weight_kg) * Number(y.standard_yield_pct)) / 100 : 0,
      unit_cost: 0, unit_price: 0, destination: "branch", branch_id: "",
    }]);
  };

  const save = async () => {
    const toUpsert = rows.filter(r => Number(r.actual_weight_kg) > 0).map(r => ({
      batch_id: batchId,
      yield_standard_id: r.yield_standard_id,
      cut_name_ar: r.cut_name_ar,
      barcode: r.barcode || null,
      actual_weight_kg: Number(r.actual_weight_kg),
      package_count: Number(r.package_count) || 0,
      standard_weight_kg: Number(r.standard_weight_kg) || 0,
      unit_cost: Number(r.unit_cost) || 0,
      unit_price: Number(r.unit_price) || 0,
      destination: r.destination,
      branch_id: r.branch_id || null,
    }));
    await supabase.from("slaughter_batch_outputs" as any).delete().eq("batch_id", batchId);
    if (toUpsert.length) {
      const { error } = await supabase.from("slaughter_batch_outputs" as any).insert(toUpsert);
      if (error) { toast.error(error.message); return; }
    }
    toast.success(`تم حفظ ${toUpsert.length} صف من التقسيمة`);
    onClose();
    onUpdate();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent dir="rtl" className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>تقسيمة الدفعة {batch.batch_number}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3 text-sm">
          <div className="p-2 bg-muted/40 rounded">الوزن الحي: <b>{Number(batch.total_live_weight_kg).toFixed(1)} كجم</b></div>
          <div className="p-2 bg-muted/40 rounded">إجمالي المقطّع: <b>{totalActual.toFixed(1)} كجم</b></div>
          <div className="p-2 bg-muted/40 rounded">قيمة البيع: <b>{totalValue.toFixed(0)} ر.س</b></div>
          <div className="p-2 bg-muted/40 rounded">التصافي: <b className={yieldPct < 40 ? "text-red-600" : "text-emerald-600"}>{yieldPct.toFixed(1)}%</b></div>
        </div>
        <div className="text-xs text-muted-foreground mb-2">
          💡 لتوزيع نفس القطعة على أكثر من فرع، اضغط زر "+ فرع" بجانب القطعة لإضافة صف جديد بنفس الصنف وفرع مختلف.
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>الصنف</TableHead>
              <TableHead>القياسي</TableHead>
              <TableHead>الكمية (كجم)</TableHead>
              <TableHead>السعر/كجم</TableHead>
              <TableHead>الإجمالي</TableHead>
              <TableHead>الفرع</TableHead>
              <TableHead>عبوات</TableHead>
              <TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="font-semibold">{r.cut_name_ar}</TableCell>
                  <TableCell className="text-muted-foreground">{r.standard_weight_kg.toFixed(1)}</TableCell>
                  <TableCell><Input className="w-20" type="number" step="0.1" value={r.actual_weight_kg || ""} onChange={e => { const v = [...rows]; v[i].actual_weight_kg = +e.target.value; setRows(v); }} /></TableCell>
                  <TableCell><Input className="w-20" type="number" step="0.01" value={r.unit_price || ""} onChange={e => { const v = [...rows]; v[i].unit_price = +e.target.value; setRows(v); }} /></TableCell>
                  <TableCell className="font-semibold">{(Number(r.actual_weight_kg) * Number(r.unit_price || 0)).toFixed(0)}</TableCell>
                  <TableCell>
                    <Select value={r.branch_id} onValueChange={v => { const a = [...rows]; a[i].branch_id = v; setRows(a); }}>
                      <SelectTrigger className="w-32"><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name_ar}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell><Input className="w-16" type="number" value={r.package_count || ""} onChange={e => { const v = [...rows]; v[i].package_count = +e.target.value; setRows(v); }} /></TableCell>
                  <TableCell className="flex gap-1">
                    <Button size="icon" variant="ghost" onClick={() => addRow(r.cut_name_ar)} title="إضافة فرع آخر لنفس الصنف"><Plus className="w-4 h-4 text-emerald-600" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => setRows(rows.filter((_, idx) => idx !== i))}><Trash2 className="w-4 h-4 text-red-500" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <DialogFooter><Button onClick={save} className="bg-gradient-to-r from-primary to-accent">حفظ التقسيمة</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ===================== Transfers Tab =====================
const TransfersTab = ({ transfers, branches, batches, onStatus }: {
  transfers: Transfer[]; branches: Branch[]; batches: Batch[]; onStatus: (id: string, status: string) => void;
}) => {
  const [branchFilter, setBranchFilter] = useState<string>("");
  const filtered = branchFilter ? transfers.filter(t => t.branch_id === branchFilter) : transfers;

  const summaryByBranch = useMemo(() => {
    const m = new Map<string, { weight: number; value: number; count: number }>();
    transfers.forEach(t => {
      const x = m.get(t.branch_id) || { weight: 0, value: 0, count: 0 };
      x.weight += Number(t.weight_kg);
      x.value += Number(t.total_value);
      x.count += 1;
      m.set(t.branch_id, x);
    });
    return m;
  }, [transfers]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {branches.map(b => {
          const s = summaryByBranch.get(b.id) || { weight: 0, value: 0, count: 0 };
          return (
            <Card key={b.id}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2"><Truck className="w-4 h-4 text-primary" /><b>{b.name_ar}</b></div>
                  <Badge variant="outline">{s.count}</Badge>
                </div>
                <div className="text-xs text-muted-foreground">إجمالي: <b className="text-foreground">{s.weight.toFixed(1)} كجم</b></div>
                <div className="text-xs text-muted-foreground">القيمة: <b className="text-foreground">{s.value.toFixed(0)} ر.س</b></div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>سجل التحويلات للفروع</CardTitle>
          <Select value={branchFilter || "all"} onValueChange={v => setBranchFilter(v === "all" ? "" : v)}>
            <SelectTrigger className="w-48"><SelectValue placeholder="كل الفروع" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الفروع</SelectItem>
              {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name_ar}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>التاريخ</TableHead><TableHead>الدفعة</TableHead><TableHead>الفرع</TableHead>
              <TableHead>الصنف</TableHead><TableHead>الكمية (كجم)</TableHead><TableHead>السعر</TableHead>
              <TableHead>الإجمالي</TableHead><TableHead>الحالة</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {filtered.map(t => {
                const bt = batches.find(b => b.id === t.batch_id);
                const br = branches.find(b => b.id === t.branch_id);
                return (
                  <TableRow key={t.id}>
                    <TableCell>{new Date(t.transferred_at).toLocaleDateString("ar-EG")}</TableCell>
                    <TableCell className="font-mono text-xs">{bt?.batch_number || "-"}</TableCell>
                    <TableCell><Badge className="bg-primary/10">{br?.name_ar}</Badge></TableCell>
                    <TableCell>{t.cut_name_ar}</TableCell>
                    <TableCell>{Number(t.weight_kg).toFixed(1)}</TableCell>
                    <TableCell>{Number(t.unit_price).toFixed(0)}</TableCell>
                    <TableCell className="font-semibold">{Number(t.total_value).toFixed(0)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={
                        t.status === "received" ? "bg-emerald-500/20 text-emerald-700" :
                        t.status === "rejected" ? "bg-red-500/20 text-red-700" : "bg-amber-500/20 text-amber-700"
                      }>{t.status === "received" ? "مستلم" : t.status === "rejected" ? "مرفوض" : "في الانتظار"}</Badge>
                    </TableCell>
                    <TableCell className="flex gap-1">
                      {t.status === "pending" && <>
                        <Button size="sm" variant="outline" onClick={() => onStatus(t.id, "received")}>تأكيد</Button>
                        <Button size="sm" variant="outline" onClick={() => onStatus(t.id, "rejected")}>رفض</Button>
                      </>}
                    </TableCell>
                  </TableRow>
                );
              })}
              {!filtered.length && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">لا توجد تحويلات</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

// ===================== Daily Report Tab (Excel-style + export) =====================
const DailyReportTab = ({ reportDate, setReportDate, receipts, birds, batches, outputs, branches }: {
  reportDate: string; setReportDate: (d: string) => void;
  receipts: Receipt[]; birds: LiveBird[]; batches: Batch[]; outputs: Output[]; branches: Branch[];
}) => {
  const dayReceipts = receipts.filter(r => r.receipt_date === reportDate);
  const dayBatches = batches.filter(b => b.slaughter_date === reportDate);
  const dayReceiptIds = dayReceipts.map(r => r.id);
  const dayBatchIds = dayBatches.map(b => b.id);
  const dayBirds = birds.filter(b => dayReceiptIds.includes(b.receipt_id)).sort((a, b) => a.bird_index - b.bird_index);
  const dayOutputs = outputs.filter(o => dayBatchIds.includes(o.batch_id));

  const totals = {
    live: dayBirds.reduce((s, b) => s + Number(b.live_weight_kg || 0), 0),
    slaughter: dayBirds.reduce((s, b) => s + Number(b.slaughter_weight_kg || 0), 0),
    purchase: dayBirds.reduce((s, b) => s + Number(b.purchase_cost || 0), 0),
    feed: dayBirds.reduce((s, b) => s + Number(b.feed_cost || 0), 0),
    meat: dayOutputs.reduce((s, o) => s + Number(o.actual_weight_kg || 0), 0),
    value: dayOutputs.reduce((s, o) => s + Number(o.actual_weight_kg) * Number(o.unit_price || 0), 0),
  };
  const yieldPct = totals.live > 0 ? (totals.meat / totals.live) * 100 : 0;

  // Group outputs by cut + branch matrix
  const cutBranchMatrix = useMemo(() => {
    const cuts = Array.from(new Set(dayOutputs.map(o => o.cut_name_ar)));
    return cuts.map(cut => {
      const cutRows = dayOutputs.filter(o => o.cut_name_ar === cut);
      const qty = cutRows.reduce((s, r) => s + Number(r.actual_weight_kg), 0);
      const price = cutRows.find(r => Number(r.unit_price) > 0)?.unit_price || 0;
      const branchValues: Record<string, number> = {};
      branches.forEach(b => {
        branchValues[b.id] = cutRows.filter(r => r.branch_id === b.id).reduce((s, r) => s + Number(r.actual_weight_kg) * Number(r.unit_price || 0), 0);
      });
      return { cut, qty, price, total: qty * Number(price), branchValues };
    });
  }, [dayOutputs, branches]);

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    // Sheet 1: birds
    const birdsRows = [
      ["تفريغة الذبح اليومي", "", "", "", reportDate],
      [],
      ["#", "الوزن قائم", "الوزن الذبح", "تكلفة الشراء", "وقت الشراء", "تكلفة العلف"],
      ...dayBirds.map(b => [b.bird_index, Number(b.live_weight_kg), Number(b.slaughter_weight_kg), Number(b.purchase_cost), b.purchase_time, Number(b.feed_cost)]),
      ["الإجمالي", totals.live, totals.slaughter, totals.purchase, "", totals.feed],
      [],
      ["م", "الصنف", "الكمية", "السعر", "الإجمالي", ...branches.map(b => b.name_ar)],
      ...cutBranchMatrix.map((r, i) => [i + 1, r.cut, r.qty, r.price, r.total, ...branches.map(b => r.branchValues[b.id])]),
      ["الإجمالي", "", cutBranchMatrix.reduce((s, r) => s + r.qty, 0), "", cutBranchMatrix.reduce((s, r) => s + r.total, 0), ...branches.map(b => cutBranchMatrix.reduce((s, r) => s + r.branchValues[b.id], 0))],
      [],
      [`نسبة التصافي: ${yieldPct.toFixed(1)}%`],
    ];
    const ws = XLSX.utils.aoa_to_sheet(birdsRows);
    XLSX.utils.book_append_sheet(wb, ws, `تفريغة ${reportDate}`);
    XLSX.writeFile(wb, `slaughter-${reportDate}.xlsx`);
    toast.success("تم تصدير ملف Excel");
  };

  const exportPDF = () => {
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(`Slaughter Daily Report - ${reportDate}`, 14, 15);
    doc.setFontSize(10);
    doc.text(`Birds: ${dayBirds.length} | Live: ${totals.live.toFixed(1)} kg | Meat: ${totals.meat.toFixed(1)} kg | Yield: ${yieldPct.toFixed(1)}% | Cost: ${(totals.purchase + totals.feed).toFixed(0)}`, 14, 22);

    autoTable(doc, {
      startY: 28,
      head: [["#", "Live kg", "Slaughter kg", "Purchase", "Time", "Feed"]],
      body: dayBirds.map(b => [b.bird_index, Number(b.live_weight_kg), Number(b.slaughter_weight_kg), Number(b.purchase_cost), b.purchase_time || "-", Number(b.feed_cost)]),
      foot: [["Total", totals.live.toFixed(1), totals.slaughter.toFixed(1), totals.purchase.toFixed(0), "", totals.feed.toFixed(0)]],
      styles: { fontSize: 8 },
      headStyles: { fillColor: [124, 58, 237] },
    });

    const afterY = (doc as any).lastAutoTable.finalY + 6;
    autoTable(doc, {
      startY: afterY,
      head: [["#", "Cut", "Qty kg", "Price", "Total", ...branches.map(b => b.name_ar)]],
      body: cutBranchMatrix.map((r, i) => [i + 1, r.cut, r.qty.toFixed(1), Number(r.price).toFixed(0), r.total.toFixed(0), ...branches.map(b => r.branchValues[b.id].toFixed(0))]),
      foot: [["", "Total", cutBranchMatrix.reduce((s, r) => s + r.qty, 0).toFixed(1), "", cutBranchMatrix.reduce((s, r) => s + r.total, 0).toFixed(0), ...branches.map(b => cutBranchMatrix.reduce((s, r) => s + r.branchValues[b.id], 0).toFixed(0))]],
      styles: { fontSize: 8 },
      headStyles: { fillColor: [249, 115, 22] },
    });
    doc.save(`slaughter-${reportDate}.pdf`);
    toast.success("تم تصدير PDF");
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
        <CardTitle>تفريغة الذبح اليومي</CardTitle>
        <div className="flex items-center gap-2">
          <Input type="date" value={reportDate} onChange={e => setReportDate(e.target.value)} className="w-44" />
          <Button variant="outline" onClick={exportExcel}><FileSpreadsheet className="w-4 h-4 ml-1" />Excel</Button>
          <Button variant="outline" onClick={exportPDF}><FileText className="w-4 h-4 ml-1" />PDF</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Top stats */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-sm">
          <div className="p-2 bg-muted/40 rounded">طيور: <b>{dayBirds.length}</b></div>
          <div className="p-2 bg-muted/40 rounded">وزن قائم: <b>{totals.live.toFixed(1)}</b></div>
          <div className="p-2 bg-muted/40 rounded">لحم: <b>{totals.meat.toFixed(1)}</b></div>
          <div className="p-2 bg-muted/40 rounded">تكلفة الشراء: <b>{totals.purchase.toFixed(0)}</b></div>
          <div className="p-2 bg-muted/40 rounded">قيمة البيع: <b>{totals.value.toFixed(0)}</b></div>
          <div className={`p-2 rounded ${yieldPct < 40 ? "bg-red-500/20" : "bg-emerald-500/20"}`}>التصافي: <b>{yieldPct.toFixed(1)}%</b></div>
        </div>

        {/* Section 1: Birds */}
        <div>
          <h3 className="font-bold mb-2 flex items-center gap-2"><Bird className="w-4 h-4" /> القسم الأول: استلام الطيور</h3>
          <Table>
            <TableHeader><TableRow>
              <TableHead>#</TableHead><TableHead>الوزن قائم</TableHead><TableHead>الوزن الذبح</TableHead>
              <TableHead>تكلفة الشراء</TableHead><TableHead>وقت الشراء</TableHead><TableHead>تكلفة العلف</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {dayBirds.map(b => (
                <TableRow key={b.id}>
                  <TableCell className="font-bold">{b.bird_index}</TableCell>
                  <TableCell>{Number(b.live_weight_kg).toFixed(1)}</TableCell>
                  <TableCell>{Number(b.slaughter_weight_kg).toFixed(1)}</TableCell>
                  <TableCell>{Number(b.purchase_cost).toFixed(0)}</TableCell>
                  <TableCell>{b.purchase_time || "-"}</TableCell>
                  <TableCell>{Number(b.feed_cost).toFixed(0)}</TableCell>
                </TableRow>
              ))}
              {!dayBirds.length && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-4">لا توجد بيانات طيور لهذا اليوم</TableCell></TableRow>}
              <TableRow className="font-bold bg-muted/30">
                <TableCell>الإجمالي</TableCell>
                <TableCell>{totals.live.toFixed(1)}</TableCell>
                <TableCell>{totals.slaughter.toFixed(1)}</TableCell>
                <TableCell>{totals.purchase.toFixed(0)}</TableCell>
                <TableCell></TableCell>
                <TableCell>{totals.feed.toFixed(0)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        {/* Section 2: Cuts + Branches */}
        <div>
          <h3 className="font-bold mb-2 flex items-center gap-2"><Package className="w-4 h-4" /> القسم الثاني: التقسيمة والتوزيع على الفروع</h3>
          <Table>
            <TableHeader><TableRow>
              <TableHead>م</TableHead><TableHead>الصنف</TableHead><TableHead>الكمية</TableHead>
              <TableHead>السعر</TableHead><TableHead>الإجمالي</TableHead>
              {branches.map(b => <TableHead key={b.id}>{b.name_ar}</TableHead>)}
            </TableRow></TableHeader>
            <TableBody>
              {cutBranchMatrix.map((r, i) => (
                <TableRow key={i}>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell className="font-semibold">{r.cut}</TableCell>
                  <TableCell>{r.qty.toFixed(1)}</TableCell>
                  <TableCell>{Number(r.price).toFixed(0)}</TableCell>
                  <TableCell className="font-semibold">{r.total.toFixed(0)}</TableCell>
                  {branches.map(b => <TableCell key={b.id}>{r.branchValues[b.id] ? r.branchValues[b.id].toFixed(0) : "-"}</TableCell>)}
                </TableRow>
              ))}
              {!cutBranchMatrix.length && <TableRow><TableCell colSpan={5 + branches.length} className="text-center text-muted-foreground py-4">لا توجد تقسيمة لهذا اليوم</TableCell></TableRow>}
              <TableRow className="font-bold bg-muted/30">
                <TableCell></TableCell>
                <TableCell>الإجمالي</TableCell>
                <TableCell>{cutBranchMatrix.reduce((s, r) => s + r.qty, 0).toFixed(1)}</TableCell>
                <TableCell></TableCell>
                <TableCell>{cutBranchMatrix.reduce((s, r) => s + r.total, 0).toFixed(0)}</TableCell>
                {branches.map(b => <TableCell key={b.id}>{cutBranchMatrix.reduce((s, r) => s + r.branchValues[b.id], 0).toFixed(0)}</TableCell>)}
              </TableRow>
            </TableBody>
          </Table>
        </div>

        <div className="text-sm text-muted-foreground border-t pt-3">
          نسبة التصافي = اللحم المقطع / الوزن القائم = <b className={yieldPct < 40 ? "text-red-600" : "text-emerald-600"}>{yieldPct.toFixed(1)}%</b>
        </div>
      </CardContent>
    </Card>
  );
};

export default Slaughterhouse;
