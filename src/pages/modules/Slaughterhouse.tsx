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
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Beef, TrendingUp, Package, Scale, Plus, AlertTriangle, CheckCircle2,
  Users, ClipboardCheck, Bird, FileSpreadsheet, FileText, Truck, Trash2,
  Settings as SettingsIcon, History, Save, Search,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip as RTooltip,
  ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import { SlaughterBatchDialog } from "@/components/slaughterhouse/SlaughterBatchDialog";
import { formatDate, formatDateTime } from "@/lib/dateFormat";
import { ProductionDispatchInbox } from "@/components/production/ProductionDispatchInbox";
import RequestCorrectionDialog from "@/components/corrections/RequestCorrectionDialog";

type Receipt = { id: string; receipt_number: string; receipt_date: string; source_type: string; source_name: string | null; bird_count: number; total_weight_kg: number; avg_weight_kg: number; price_per_kg: number; total_cost: number; dead_on_arrival: number; status: string; };
type Batch = { id: string; batch_number: string; slaughter_date: string; shift: string; live_receipt_id: string | null; birds_slaughtered: number; total_live_weight_kg: number; total_meat_kg: number; actual_yield_pct: number; cost_per_kg_meat: number; status: string; pre_slaughter_dead: number; rejected_birds: number; };
type Yield = { id: string; cut_name_ar: string; cut_name_en: string | null; barcode: string | null; standard_yield_pct: number; package_size_kg: number | null; category: string; display_order: number; is_active: boolean; };
type Output = { id: string; batch_id: string; cut_name_ar: string; barcode: string | null; actual_weight_kg: number; damaged_weight_kg: number; quarantined_weight_kg: number; package_count: number; standard_weight_kg: number; variance_pct: number; unit_cost: number; unit_price: number; total_cost: number; destination: string; branch_id: string | null; quality_status?: string };
type Worker = { id: string; full_name: string; role: string; phone: string | null; daily_wage: number; is_active: boolean; };
type QC = { id: string; check_type: string; check_date: string; inspector_name: string; result: string; temperature_c: number | null; ph_level: number | null; notes: string | null; };
type Branch = { id: string; code: string; name_ar: string; is_active: boolean };
type LiveBird = { id: string; receipt_id: string; bird_index: number; live_weight_kg: number; slaughter_weight_kg: number; purchase_cost: number; purchase_time: string | null; feed_cost: number; notes: string | null };
type Transfer = { id: string; batch_id: string; output_id: string | null; branch_id: string; cut_name_ar: string; weight_kg: number; unit_price: number; total_value: number; status: string; transferred_at: string };
type Settings = { id: string; low_yield_threshold: number; warning_yield_threshold: number; notify_on_low_yield: boolean; yield_cut_names: string[] };

// Smart normalization for Arabic cut names: lowercase, collapse whitespace, strip tatweel/diacritics, unify ة↔ه, ى↔ي, أإآ↔ا
export const normalizeCutName = (s: string): string =>
  (s || "")
    .toString()
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();

const DEFAULT_YIELD_CUTS = ["لحمة","استيك","موزة","فراشة","قطعية دبوس","دبوس بالعظم","فخذة","صندوق","تربيانكو","اسكالوب","رول نعام","فرم"];
type AuditEntry = { id: string; action: string; target_type: string; target_id: string | null; batch_id: string | null; transfer_id: string | null; performed_by: string | null; performed_at: string; old_value: any; new_value: any; notes: string | null };

const Slaughterhouse = () => {
  const { role } = useAuth();
  const canEditReceiptDate = role === "slaughterhouse_manager" || role === "general_manager" || role === "executive_manager";
  const canEditReceiptData = role === "general_manager" || role === "executive_manager";
  const canManageBatch = canEditReceiptDate;
  const [editBatch, setEditBatch] = useState<Batch | null>(null);
  const [editReceipt, setEditReceipt] = useState<Receipt | null>(null);
  const [editReceiptForm, setEditReceiptForm] = useState<Partial<Receipt> & { notes?: string }>({});
  const todayStr = new Date().toISOString().slice(0, 10);
  const [receiptDateFrom, setReceiptDateFrom] = useState<string>("");
  const [receiptDateTo, setReceiptDateTo] = useState<string>("");
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [yields, setYields] = useState<Yield[]>([]);
  const [outputs, setOutputs] = useState<Output[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [qcs, setQcs] = useState<QC[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [birds, setBirds] = useState<LiveBird[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  // Dialogs
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [outputBatchId, setOutputBatchId] = useState<string | null>(null);
  const [birdsReceiptId, setBirdsReceiptId] = useState<string | null>(null);
  const [workerOpen, setWorkerOpen] = useState(false);
  const [qcOpen, setQcOpen] = useState(false);

  // Forms
  const [receiptForm, setReceiptForm] = useState({ source_type: "internal_farm", source_name: "", bird_count: 0, total_weight_kg: 0, avg_age_days: 0, price_per_kg: 0, dead_on_arrival: 0, notes: "", receipt_date: new Date().toISOString().slice(0, 10) });
  const [batchForm, setBatchForm] = useState({ live_receipt_id: "", shift: "morning", birds_slaughtered: 0, total_live_weight_kg: 0, pre_slaughter_dead: 0, rejected_birds: 0, start_time: "", notes: "" });
  const [workerForm, setWorkerForm] = useState({ full_name: "", role: "slaughterer", phone: "", daily_wage: 0 });
  const [qcForm, setQcForm] = useState({ check_type: "post_slaughter", related_batch_id: "", inspector_name: "", result: "pass", temperature_c: "", ph_level: "", notes: "" });

  // Daily report date
  const [reportDate, setReportDate] = useState(new Date().toISOString().slice(0, 10));

  const fetchAll = async () => {
    setLoading(true);
    const [r, b, y, o, w, q, br, bd, tr, st, au, pr] = await Promise.all([
      supabase.from("slaughter_live_receipts" as any).select("*").order("receipt_date", { ascending: false }).limit(500),
      supabase.from("slaughter_batches" as any).select("*").order("slaughter_date", { ascending: false }).limit(500),
      supabase.from("slaughter_yield_standards" as any).select("*").order("display_order"),
      supabase.from("slaughter_batch_outputs" as any).select("*").order("created_at", { ascending: false }).limit(1000),
      supabase.from("slaughter_workers" as any).select("*").order("full_name"),
      supabase.from("slaughter_quality_checks" as any).select("*").order("check_date", { ascending: false }).limit(200),
      supabase.from("branches" as any).select("*").order("name_ar"),
      supabase.from("slaughter_live_birds" as any).select("*").order("bird_index"),
      supabase.from("slaughter_branch_transfers" as any).select("*").order("transferred_at", { ascending: false }).limit(1000),
      supabase.from("slaughter_settings" as any).select("*").limit(1).maybeSingle(),
      supabase.from("slaughter_audit_log" as any).select("*").order("performed_at", { ascending: false }).limit(500),
      supabase.from("profiles" as any).select("id, full_name").limit(1000),
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
    setSettings((st.data as any) || null);
    setAudit((au.data as any) || []);
    const pm: Record<string, string> = {};
    ((pr.data as any) || []).forEach((p: any) => { pm[p.id] = p.full_name; });
    setProfiles(pm);
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

  const validateReceiptDate = (d: string): string | null => {
    if (!d) return "تاريخ التوريد مطلوب";
    if (d > todayStr) return "لا يمكن استخدام تاريخ في المستقبل";
    return null;
  };

  const saveReceipt = async () => {
    const dateErr = validateReceiptDate(receiptForm.receipt_date);
    if (dateErr) { toast.error(dateErr); return; }
    if (!receiptForm.bird_count || !receiptForm.total_weight_kg) { toast.error("أدخل عدد الطيور والوزن الإجمالي"); return; }
    const dateForNumber = receiptForm.receipt_date.replace(/-/g, "");
    const receipt_number = `LR-${dateForNumber}-${Math.floor(Math.random() * 9999).toString().padStart(4, "0")}`;
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("slaughter_live_receipts" as any).insert({ ...receiptForm, receipt_number, created_by: user?.id });
    if (error) { toast.error(error.message); return; }
    toast.success("تم تسجيل الاستلام — أضف وزن كل طائر منفصلًا الآن");
    setReceiptOpen(false);
    setReceiptForm({ source_type: "internal_farm", source_name: "", bird_count: 0, total_weight_kg: 0, avg_age_days: 0, price_per_kg: 0, dead_on_arrival: 0, notes: "", receipt_date: todayStr });
    fetchAll();
  };

  const updateReceiptDate = async (id: string, newDate: string) => {
    if (!canEditReceiptDate) { toast.error("غير مصرح لك بتعديل تاريخ التوريد"); return; }
    const dateErr = validateReceiptDate(newDate);
    if (dateErr) { toast.error(dateErr); return; }
    const { error } = await supabase.from("slaughter_live_receipts" as any).update({ receipt_date: newDate }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("تم تحديث تاريخ التوريد وتم تسجيله في سجل التدقيق");
    fetchAll();
  };

  const saveEditedReceipt = async () => {
    if (!editReceipt) return;
    if (!canEditReceiptData) { toast.error("غير مصرح لك بتعديل بيانات الاستلام"); return; }
    const f = editReceiptForm;
    const dateErr = validateReceiptDate(String(f.receipt_date ?? editReceipt.receipt_date));
    if (dateErr) { toast.error(dateErr); return; }
    const payload: any = {
      receipt_date: f.receipt_date ?? editReceipt.receipt_date,
      source_type: f.source_type ?? editReceipt.source_type,
      source_name: f.source_name ?? editReceipt.source_name,
      bird_count: Number(f.bird_count ?? editReceipt.bird_count) || 0,
      total_weight_kg: Number(f.total_weight_kg ?? editReceipt.total_weight_kg) || 0,
      price_per_kg: Number(f.price_per_kg ?? editReceipt.price_per_kg) || 0,
      dead_on_arrival: Number(f.dead_on_arrival ?? editReceipt.dead_on_arrival) || 0,
    };
    const { error } = await supabase.from("slaughter_live_receipts" as any).update(payload).eq("id", editReceipt.id);
    if (error) { toast.error("تعذّر حفظ التعديل", { description: error.message }); return; }
    toast.success("✅ تم تحديث بيانات الاستلام");
    setEditReceipt(null);
    setEditReceiptForm({});
    fetchAll();
  };

  const saveBatch = async (formData?: typeof batchForm): Promise<boolean> => {
    const data = formData || batchForm;
    if (!data.birds_slaughtered || !data.total_live_weight_kg) { toast.error("أدخل عدد الطيور المذبوحة والوزن الحي"); return false; }
    const batch_number = `SB-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.floor(Math.random() * 9999).toString().padStart(4, "0")}`;
    const { data: { user } } = await supabase.auth.getUser();
    const payload: any = { ...data, batch_number, created_by: user?.id };
    if (!payload.live_receipt_id) delete payload.live_receipt_id;
    if (!payload.start_time) delete payload.start_time;
    const { error } = await supabase.from("slaughter_batches" as any).insert(payload);
    if (error) { toast.error(error.message); return false; }
    toast.success("تم إنشاء دفعة الذبح");
    setBatchOpen(false);
    setBatchForm({ live_receipt_id: "", shift: "morning", birds_slaughtered: 0, total_live_weight_kg: 0, pre_slaughter_dead: 0, rejected_birds: 0, start_time: "", notes: "" });
    fetchAll();
    return true;
  };

  const updateBatch = async (b: Batch) => {
    if (!canManageBatch) { toast.error("غير مصرح لك بتعديل الدفعات"); return; }
    const { id, ...rest } = b;
    const payload: any = {
      slaughter_date: rest.slaughter_date,
      shift: rest.shift,
      birds_slaughtered: Number(rest.birds_slaughtered) || 0,
      total_live_weight_kg: Number(rest.total_live_weight_kg) || 0,
      pre_slaughter_dead: Number(rest.pre_slaughter_dead) || 0,
      rejected_birds: Number(rest.rejected_birds) || 0,
      status: rest.status,
    };
    const { error } = await supabase.from("slaughter_batches" as any).update(payload).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("تم تحديث بيانات الدفعة");
    setEditBatch(null);
    fetchAll();
  };

  const deleteBatch = async (b: Batch) => {
    if (!canManageBatch) { toast.error("غير مصرح لك بحذف الدفعات"); return; }
    if (!window.confirm(`هل تريد حذف الدفعة ${b.batch_number}؟ سيتم حذف التقسيمة والتحويلات المرتبطة بها.`)) return;
    await supabase.from("slaughter_branch_transfers" as any).delete().eq("batch_id", b.id);
    await supabase.from("slaughter_batch_outputs" as any).delete().eq("batch_id", b.id);
    const { error } = await supabase.from("slaughter_batches" as any).delete().eq("id", b.id);
    if (error) { toast.error(error.message); return; }
    toast.success("تم حذف الدفعة");
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
    const yieldPct = Number(d?.actual_yield_pct || 0);
    const low = Number(settings?.low_yield_threshold ?? 40);
    const warn = Number(settings?.warning_yield_threshold ?? 45);
    if (yieldPct > 0 && yieldPct < low) {
      toast.error(`⚠️ تصافي منخفض ${yieldPct.toFixed(1)}% (أقل من الحد ${low}%)`, { duration: 8000 });
    } else if (yieldPct > 0 && yieldPct < warn) {
      toast.warning(`⚠️ التصافي ${yieldPct.toFixed(1)}% قريب من الحد الأدنى ${low}%`, { duration: 6000 });
    } else {
      toast.success(`اكتملت الدفعة — ${Number(d?.total_meat_kg || 0).toFixed(1)} كجم — تصافي ${yieldPct.toFixed(1)}% — ${d?.transfers_created || 0} تحويل`);
    }
    fetchAll();
  };

  const saveSettings = async (next: Partial<Settings>) => {
    if (!settings) return;
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("slaughter_settings" as any)
      .update({ ...next, updated_by: user?.id })
      .eq("id", settings.id);
    if (error) { toast.error(error.message); return; }
    toast.success("تم حفظ الإعدادات");
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

      <div className="flex justify-end mb-3">
        <RequestCorrectionDialog
          targetModule="المجزر"
          targetType="slaughterhouse"
          label="طلب تصحيح بيانات للإدارة"
          variant="outline"
        />
      </div>

      <div className="mb-6">
        <ProductionDispatchInbox destination="slaughterhouse" />
      </div>

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
        <div className="w-full overflow-x-auto -mx-1 px-1 mb-2">
          <TabsList className="inline-flex w-max min-w-full gap-1 h-auto flex-wrap md:flex-nowrap">
            <TabsTrigger value="daily" className="text-xs md:text-sm whitespace-nowrap">التقرير اليومي</TabsTrigger>
            <TabsTrigger value="batches" className="text-xs md:text-sm whitespace-nowrap">دفعات الذبح</TabsTrigger>
            <TabsTrigger value="receipts" className="text-xs md:text-sm whitespace-nowrap">استلام حي</TabsTrigger>
            <TabsTrigger value="transfers" className="text-xs md:text-sm whitespace-nowrap">توزيع الفروع</TabsTrigger>
            <TabsTrigger value="yields" className="text-xs md:text-sm whitespace-nowrap">المعيار القياسي</TabsTrigger>
            <TabsTrigger value="workers" className="text-xs md:text-sm whitespace-nowrap">العمال</TabsTrigger>
            <TabsTrigger value="quality" className="text-xs md:text-sm whitespace-nowrap">الجودة</TabsTrigger>
            <TabsTrigger value="audit" className="text-xs md:text-sm whitespace-nowrap gap-1"><History className="w-3 h-3" />التدقيق</TabsTrigger>
            <TabsTrigger value="settings" className="text-xs md:text-sm whitespace-nowrap gap-1"><SettingsIcon className="w-3 h-3" />الإعدادات</TabsTrigger>
          </TabsList>
        </div>

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
            settings={settings}
          />
        </TabsContent>

        {/* ========== BATCHES ========== */}
        <TabsContent value="batches">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>دفعات الذبح</CardTitle>
              <SlaughterBatchDialog
                open={batchOpen}
                onOpenChange={setBatchOpen}
                receipts={receipts}
                onSave={async (draft) => saveBatch(draft as any)}
              />
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
                      <TableCell className="flex gap-2 flex-wrap">
                        <Button size="sm" variant="outline" onClick={() => setOutputBatchId(b.id)}>التقسيمة</Button>
                        {b.status === "in_progress" && <Button size="sm" onClick={() => finalizeBatch(b)} title="إنهاء واحتساب التكلفة وتوزيع الفروع"><CheckCircle2 className="w-4 h-4" /></Button>}
                        {canManageBatch && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => setEditBatch(b)} title="تعديل بيانات الدفعة"><SettingsIcon className="w-4 h-4" /></Button>
                            <Button size="sm" variant="destructive" onClick={() => deleteBatch(b)} title="حذف الدفعة"><Trash2 className="w-4 h-4" /></Button>
                          </>
                        )}
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
              yieldCutNames={settings?.yield_cut_names || DEFAULT_YIELD_CUTS}
              onClose={() => setOutputBatchId(null)}
              onUpdate={fetchAll}
            />
          )}

          {editBatch && (
            <Dialog open onOpenChange={(o) => !o && setEditBatch(null)}>
              <DialogContent dir="rtl" className="max-w-lg">
                <DialogHeader><DialogTitle>تعديل الدفعة {editBatch.batch_number}</DialogTitle></DialogHeader>
                <div className="grid grid-cols-2 gap-3 mt-2">
                  <div><Label>تاريخ الذبح</Label><Input type="date" max={todayStr} value={editBatch.slaughter_date} onChange={e => setEditBatch({ ...editBatch, slaughter_date: e.target.value })} /></div>
                  <div><Label>الشيفت</Label>
                    <Select value={editBatch.shift} onValueChange={v => setEditBatch({ ...editBatch, shift: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent className="z-[100]">
                        <SelectItem value="morning">صباحي</SelectItem>
                        <SelectItem value="evening">مسائي</SelectItem>
                        <SelectItem value="night">ليلي</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>عدد الطيور</Label><Input type="number" value={editBatch.birds_slaughtered || ""} onChange={e => setEditBatch({ ...editBatch, birds_slaughtered: +e.target.value })} /></div>
                  <div><Label>الوزن الحي (كجم)</Label><Input type="number" step="0.1" value={editBatch.total_live_weight_kg || ""} onChange={e => setEditBatch({ ...editBatch, total_live_weight_kg: +e.target.value })} /></div>
                  <div><Label>نافق قبل الذبح</Label><Input type="number" value={editBatch.pre_slaughter_dead || ""} onChange={e => setEditBatch({ ...editBatch, pre_slaughter_dead: +e.target.value })} /></div>
                  <div><Label>مرفوض صحياً</Label><Input type="number" value={editBatch.rejected_birds || ""} onChange={e => setEditBatch({ ...editBatch, rejected_birds: +e.target.value })} /></div>
                  <div className="col-span-2"><Label>الحالة</Label>
                    <Select value={editBatch.status} onValueChange={v => setEditBatch({ ...editBatch, status: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent className="z-[100]">
                        <SelectItem value="in_progress">قيد الذبح</SelectItem>
                        <SelectItem value="completed">مكتملة</SelectItem>
                        <SelectItem value="cancelled">ملغاة</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter className="mt-3">
                  <Button variant="outline" onClick={() => setEditBatch(null)}>إلغاء</Button>
                  <Button onClick={() => updateBatch(editBatch)} className="bg-gradient-to-r from-primary to-accent"><Save className="w-4 h-4 ml-1" />حفظ التعديل</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </TabsContent>

        {/* ========== RECEIPTS ========== */}
        <TabsContent value="receipts">
          <Card>
            <CardHeader className="flex flex-col gap-3">
              <div className="flex flex-row items-center justify-between gap-2 flex-wrap">
                <CardTitle>استلام الطيور الحية</CardTitle>
                <Dialog open={receiptOpen} onOpenChange={setReceiptOpen}>
                  <DialogTrigger asChild><Button className="bg-gradient-to-r from-primary to-accent"><Plus className="w-4 h-4 ml-1" />استلام جديد</Button></DialogTrigger>
                  <DialogContent dir="rtl" className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader><DialogTitle>تسجيل استلام طيور</DialogTitle></DialogHeader>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div><Label>تاريخ التوريد *</Label><Input type="date" max={todayStr} value={receiptForm.receipt_date} onChange={e => setReceiptForm({ ...receiptForm, receipt_date: e.target.value })} /></div>
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
                      <div className="sm:col-span-2"><Label>ملاحظات</Label><Textarea value={receiptForm.notes} onChange={e => setReceiptForm({ ...receiptForm, notes: e.target.value })} /></div>
                      <div className="sm:col-span-2 text-xs text-muted-foreground bg-muted/40 p-2 rounded">
                        💡 بعد الحفظ ستتمكن من إدخال وزن وتكلفة كل طائر منفصلًا (مطابق لتفريغة Excel) وسيتم تحديث الإجماليات تلقائيًا.
                      </div>
                    </div>
                    <DialogFooter><Button onClick={saveReceipt}>حفظ</Button></DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <div><Label className="text-xs">من تاريخ</Label><Input type="date" value={receiptDateFrom} onChange={e => setReceiptDateFrom(e.target.value)} className="h-9 w-40" /></div>
                <div><Label className="text-xs">إلى تاريخ</Label><Input type="date" value={receiptDateTo} onChange={e => setReceiptDateTo(e.target.value)} className="h-9 w-40" /></div>
                {(receiptDateFrom || receiptDateTo) && (
                  <Button variant="ghost" size="sm" onClick={() => { setReceiptDateFrom(""); setReceiptDateTo(""); }}>مسح الفلتر</Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>الرقم</TableHead><TableHead>التاريخ</TableHead><TableHead>المصدر</TableHead>
                  <TableHead>عدد</TableHead><TableHead>وزن (كجم)</TableHead><TableHead>متوسط</TableHead>
                  <TableHead>تكلفة (إجمالي)</TableHead><TableHead>نافق</TableHead><TableHead>الحالة</TableHead><TableHead>الطيور</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {receipts.filter(r => (!receiptDateFrom || r.receipt_date >= receiptDateFrom) && (!receiptDateTo || r.receipt_date <= receiptDateTo)).map(r => {
                    const recBirds = birds.filter(b => b.receipt_id === r.id);
                    const totalCost = recBirds.reduce((s, b) => s + Number(b.purchase_cost || 0) + Number(b.feed_cost || 0), 0) || Number(r.total_cost || 0);
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono text-xs">{r.receipt_number}</TableCell>
                        <TableCell>{canEditReceiptDate ? (
                          <Input type="date" max={todayStr} value={r.receipt_date} onChange={e => updateReceiptDate(r.id, e.target.value)} className="h-8 w-36 text-xs" title="تعديل تاريخ التوريد (يُسجَّل في سجل التدقيق)" />
                        ) : (
                          <span className="text-xs">{r.receipt_date}</span>
                        )}</TableCell>
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
                <DialogContent dir="rtl" className="max-w-2xl max-h-[90vh] overflow-y-auto">
                  <DialogHeader><DialogTitle>تسجيل فحص جودة</DialogTitle></DialogHeader>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                    <div className="sm:col-span-2"><Label>ملاحظات</Label><Textarea value={qcForm.notes} onChange={e => setQcForm({ ...qcForm, notes: e.target.value })} /></div>
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

        {/* ========== AUDIT ========== */}
        <TabsContent value="audit">
          <AuditLogTab audit={audit} profiles={profiles} batches={batches} branches={branches} />
        </TabsContent>

        {/* ========== SETTINGS ========== */}
        <TabsContent value="settings">
          <SettingsTab settings={settings} onSave={saveSettings} />
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
const BatchOutputsDialog = ({ batchId, batch, yields, outputs, branches, yieldCutNames, onClose, onUpdate }: {
  batchId: string; batch: Batch; yields: Yield[]; outputs: Output[]; branches: Branch[]; yieldCutNames: string[]; onClose: () => void; onUpdate: () => void;
}) => {
  // Reconstruct merged rows by (cut_name_ar, branch_id) from split outputs (by quality_status).
  const initial = (() => {
    if (!outputs.length) return [] as any[];
    const map = new Map<string, any>();
    for (const o of outputs) {
      const key = `${o.cut_name_ar}__${o.branch_id || ""}`;
      const y = yields.find(y => y.cut_name_ar === o.cut_name_ar);
      let r = map.get(key);
      if (!r) {
        r = {
          yield_standard_id: y?.id || null,
          cut_name_ar: o.cut_name_ar,
          barcode: o.barcode || y?.barcode || "",
          produced_weight_kg: 0,
          actual_weight_kg: 0,         // accepted (derived)
          damaged_weight_kg: 0,
          quarantined_weight_kg: 0,
          package_count: Number(o.package_count) || 0,
          standard_weight_kg: Number(o.standard_weight_kg) || 0,
          unit_cost: Number(o.unit_cost) || 0,
          unit_price: Number(o.unit_price) || 0,
          destination: o.destination,
          branch_id: o.branch_id || "",
        };
        map.set(key, r);
      }
      const w = Number(o.actual_weight_kg) || 0;
      const q = (o.quality_status || "accepted").toLowerCase();
      if (q === "rejected") r.damaged_weight_kg += w;
      else if (q === "quarantine") r.quarantined_weight_kg += w;
      else r.actual_weight_kg += w;
      // legacy: outputs may also carry damaged/quarantined fields on a single accepted row
      r.damaged_weight_kg += Number(o.damaged_weight_kg || 0);
      r.quarantined_weight_kg += Number(o.quarantined_weight_kg || 0);
      r.produced_weight_kg = r.actual_weight_kg + r.damaged_weight_kg + r.quarantined_weight_kg;
      if (Number(o.unit_price) > 0) r.unit_price = Number(o.unit_price);
    }
    return Array.from(map.values());
  })();
  const [rows, setRows] = useState(initial);
  const [pickCut, setPickCut] = useState<string>("");
  const [searchCut, setSearchCut] = useState<string>("");
  const [pendingConfirm, setPendingConfirm] = useState<null | { mismatchRows: { name: string; produced: number; sum: number }[] }>(null);
  // Custom (unregistered) cuts that count toward yield % only
  const CUSTOM_KEY = `slaughter_custom_yield_${batchId}`;
  const [customItems, setCustomItems] = useState<Array<{ name: string; weight: number }>>(() => {
    try { return JSON.parse(localStorage.getItem(CUSTOM_KEY) || "[]"); } catch { return []; }
  });
  const [newCustomName, setNewCustomName] = useState("");
  const [newCustomWeight, setNewCustomWeight] = useState<number | "">("");
  useEffect(() => { try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(customItems)); } catch {} }, [customItems, CUSTOM_KEY]);

  // Helper: accepted (available) = produced - damaged - quarantined, clamped ≥ 0
  const acceptedOf = (r: any) =>
    Math.max(0, (Number(r.produced_weight_kg) || 0) - (Number(r.damaged_weight_kg) || 0) - (Number(r.quarantined_weight_kg) || 0));

  // Keep actual_weight_kg in sync with derived accepted on every render of rows
  useEffect(() => {
    setRows(prev => prev.map(r => ({ ...r, actual_weight_kg: acceptedOf(r) })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const yieldSet = useMemo(() => new Set((yieldCutNames || DEFAULT_YIELD_CUTS).map(normalizeCutName)), [yieldCutNames]);
  const { totalActual, totalProduced, totalValue, yieldWeight, yieldPct, totalDamaged, totalQuarantined, includedBreakdown, excludedBreakdown } = useMemo(() => {
    let totalActual = 0, totalProduced = 0, totalValue = 0, yieldWeight = 0, totalDamaged = 0, totalQuarantined = 0;
    const incMap = new Map<string, number>();
    const excMap = new Map<string, number>();
    for (const r of rows) {
      const accepted = acceptedOf(r);
      totalProduced += Number(r.produced_weight_kg) || 0;
      totalActual += accepted;
      totalDamaged += Number(r.damaged_weight_kg) || 0;
      totalQuarantined += Number(r.quarantined_weight_kg) || 0;
      totalValue += accepted * Number(r.unit_price || 0);
      const norm = normalizeCutName(r.cut_name_ar);
      if (yieldSet.has(norm)) {
        yieldWeight += accepted;
        incMap.set(r.cut_name_ar, (incMap.get(r.cut_name_ar) || 0) + accepted);
      } else if (accepted > 0) {
        excMap.set(r.cut_name_ar, (excMap.get(r.cut_name_ar) || 0) + accepted);
      }
    }
    // Include custom (unregistered) cuts in yield calc + breakdown
    for (const c of customItems) {
      const w = Number(c.weight) || 0;
      if (w <= 0 || !c.name?.trim()) continue;
      yieldWeight += w;
      const label = `${c.name.trim()} (مخصص)`;
      incMap.set(label, (incMap.get(label) || 0) + w);
    }
    const live = Number(batch.total_live_weight_kg);
    return {
      totalActual, totalProduced, totalValue, yieldWeight, totalDamaged, totalQuarantined,
      yieldPct: live > 0 ? (yieldWeight / live) * 100 : 0,
      includedBreakdown: Array.from(incMap.entries()).sort((a, b) => b[1] - a[1]),
      excludedBreakdown: Array.from(excMap.entries()).sort((a, b) => b[1] - a[1]),
    };
  }, [rows, yieldSet, batch.total_live_weight_kg, customItems]);

  const updateRow = (i: number, patch: Partial<any>) => {
    setRows(prev => {
      const v = [...prev];
      v[i] = { ...v[i], ...patch };
      return v;
    });
  };

  const addRow = (cutName: string) => {
    const y = yields.find(y => y.cut_name_ar === cutName);
    setRows(prev => [...prev, {
      yield_standard_id: y?.id || null,
      cut_name_ar: cutName,
      barcode: y?.barcode || "",
      produced_weight_kg: 0,
      actual_weight_kg: 0,
      damaged_weight_kg: 0,
      quarantined_weight_kg: 0,
      package_count: 0,
      standard_weight_kg: y ? (Number(batch.total_live_weight_kg) * Number(y.standard_yield_pct)) / 100 : 0,
      unit_cost: 0, unit_price: 0, destination: "branch", branch_id: "",
    }]);
  };

  // Persist: split each user row into 1-3 outputs by quality_status so warehouse receipt sees them correctly.
  const persist = async () => {
    const toUpsert: any[] = [];
    for (const r of rows) {
      const accepted = acceptedOf(r);
      const damaged = Number(r.damaged_weight_kg) || 0;
      const quarantined = Number(r.quarantined_weight_kg) || 0;
      if (accepted <= 0 && damaged <= 0 && quarantined <= 0) continue;

      const base = {
        batch_id: batchId,
        yield_standard_id: r.yield_standard_id,
        cut_name_ar: r.cut_name_ar,
        barcode: r.barcode || null,
        standard_weight_kg: Number(r.standard_weight_kg) || 0,
        unit_cost: Number(r.unit_cost) || 0,
        unit_price: Number(r.unit_price) || 0,
        destination: r.destination,
        branch_id: r.branch_id || null,
      };

      if (accepted > 0) {
        toUpsert.push({
          ...base,
          actual_weight_kg: accepted,
          damaged_weight_kg: 0,
          quarantined_weight_kg: 0,
          package_count: Number(r.package_count) || 0,
          quality_status: "accepted",
        });
      }
      if (damaged > 0) {
        toUpsert.push({
          ...base,
          actual_weight_kg: damaged,
          damaged_weight_kg: damaged,
          quarantined_weight_kg: 0,
          package_count: 0,
          quality_status: "rejected",
        });
      }
      if (quarantined > 0) {
        toUpsert.push({
          ...base,
          actual_weight_kg: quarantined,
          damaged_weight_kg: 0,
          quarantined_weight_kg: quarantined,
          package_count: 0,
          quality_status: "quarantine",
        });
      }
    }

    await supabase.from("slaughter_batch_outputs" as any).delete().eq("batch_id", batchId);
    if (toUpsert.length) {
      const { error } = await supabase.from("slaughter_batch_outputs" as any).insert(toUpsert);
      if (error) { toast.error(error.message); return; }
    }
    toast.success(`تم حفظ ${toUpsert.length} صف من التقسيمة (مقسّمة حسب حالة الجودة)`);
    onClose();
    onUpdate();
  };

  const save = () => {
    // Check mismatch: damaged + quarantined > produced (would yield clamped accepted)
    const mismatch: { name: string; produced: number; sum: number }[] = [];
    for (const r of rows) {
      const produced = Number(r.produced_weight_kg) || 0;
      const damaged = Number(r.damaged_weight_kg) || 0;
      const quarantined = Number(r.quarantined_weight_kg) || 0;
      const accepted = acceptedOf(r);
      const sum = accepted + damaged + quarantined;
      if (produced > 0 && Math.abs(sum - produced) > 0.01) {
        mismatch.push({ name: r.cut_name_ar, produced, sum });
      }
      if (produced === 0 && (damaged > 0 || quarantined > 0)) {
        mismatch.push({ name: r.cut_name_ar, produced, sum: damaged + quarantined });
      }
    }
    if (mismatch.length > 0) {
      setPendingConfirm({ mismatchRows: mismatch });
      return;
    }
    persist();
  };

  // Available yields not yet added (allow duplicates only via "+ فرع") + search filter
  const usedCuts = new Set(rows.map(r => r.cut_name_ar));
  const availableYields = yields
    .filter(y => y.is_active !== false && !usedCuts.has(y.cut_name_ar))
    .filter(y => {
      const q = searchCut.trim().toLowerCase();
      if (!q) return true;
      return (
        y.cut_name_ar.toLowerCase().includes(q) ||
        (y.cut_name_en || "").toLowerCase().includes(q) ||
        (y.barcode || "").toLowerCase().includes(q)
      );
    });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent dir="rtl" className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>تقسيمة الدفعة {batch.batch_number}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mb-3 text-sm">
          <div className="p-2 bg-muted/40 rounded">الوزن الحي: <b>{Number(batch.total_live_weight_kg).toFixed(1)} كجم</b></div>
          <div className="p-2 bg-muted/40 rounded">إجمالي المُنتَج: <b>{totalProduced.toFixed(1)} كجم</b></div>
          <div className="p-2 bg-emerald-500/10 rounded">المتاح (مقبول): <b>{totalActual.toFixed(1)} كجم</b></div>
          <div className="p-2 bg-red-500/10 rounded">تالف: <b className="text-red-600">{totalDamaged.toFixed(1)} كجم</b></div>
          <div className="p-2 bg-amber-500/10 rounded">محجور: <b className="text-amber-600">{totalQuarantined.toFixed(1)} كجم</b></div>
          <div className="p-2 bg-muted/40 rounded">التصافي: <b className={yieldPct < 40 ? "text-red-600" : "text-emerald-600"}>{yieldPct.toFixed(1)}%</b></div>
        </div>

        {/* Yield breakdown panel */}
        <div className="mb-3 border rounded p-3 bg-muted/20 text-xs space-y-2">
          <div className="font-semibold text-sm flex items-center gap-2">
            📊 تفاصيل احتساب نسبة التصافي
            <span className="text-muted-foreground font-normal">({yieldWeight.toFixed(1)} كجم ÷ {Number(batch.total_live_weight_kg).toFixed(1)} كجم وزن حي = {yieldPct.toFixed(1)}%)</span>
          </div>
          {includedBreakdown.length > 0 ? (
            <div>
              <div className="text-emerald-700 dark:text-emerald-400 font-semibold mb-1">✅ الأصناف المُحتسبة ({includedBreakdown.length}):</div>
              <div className="flex flex-wrap gap-1">
                {includedBreakdown.map(([name, w]) => (
                  <span key={name} className="bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 px-2 py-0.5 rounded">
                    {name}: <b>{w.toFixed(1)} كجم</b>
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-muted-foreground">لم يُسجّل أي وزن لأصناف اللحوم بعد.</div>
          )}
          {excludedBreakdown.length > 0 && (
            <div>
              <div className="text-amber-700 dark:text-amber-400 font-semibold mb-1">⛔ مستبعد من التصافي (يُسجَّل ولا يُحتسب):</div>
              <div className="flex flex-wrap gap-1">
                {excludedBreakdown.map(([name, w]) => (
                  <span key={name} className="bg-amber-500/15 text-amber-800 dark:text-amber-300 px-2 py-0.5 rounded">
                    {name}: {w.toFixed(1)} كجم
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="text-muted-foreground pt-1 border-t border-border/50">
            💡 يمكنك تعديل قائمة أصناف التصافي من <b>الإعدادات → قائمة أصناف اللحوم</b>. يُحتسب من <b>الكمية المقبولة (المتاح)</b> فقط، باستثناء التالف والمحجور.
          </div>
        </div>

        {/* Custom (unregistered) cuts that only affect yield % */}
        <div className="mb-3 p-3 border rounded bg-primary/5 space-y-2">
          <Label className="text-xs font-semibold block">
            ➕ إضافة صنف غير مسجل لاحتساب التصافي
            <span className="text-muted-foreground font-normal mr-1">(يُضاف للوزن المُحتسب فقط ولا يدخل جدول التقسيمة — يُحفظ تلقائيًا لكل دفعة)</span>
          </Label>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[180px]">
              <Select
                value={newCustomName || undefined}
                onValueChange={(v) => setNewCustomName(v === "__other__" ? "" : v)}
              >
                <SelectTrigger><SelectValue placeholder="اختر صنفًا (مسجل أو غير مسجل)..." /></SelectTrigger>
                <SelectContent className="z-[100] max-h-72">
                  {yields.filter(y => y.is_active !== false).length > 0 && (
                    <>
                      <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground bg-muted/40">📦 من قائمة المنتجات المسجلة</div>
                      {yields.filter(y => y.is_active !== false).map((y) => (
                        <SelectItem key={`reg-${y.id}`} value={y.cut_name_ar}>
                          <span className="flex items-center gap-2">
                            <span>{y.cut_name_ar}</span>
                            {y.barcode && <span className="text-xs text-muted-foreground font-mono">#{y.barcode}</span>}
                          </span>
                        </SelectItem>
                      ))}
                    </>
                  )}
                  <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground bg-muted/40 mt-1">➕ أصناف غير مسجلة شائعة</div>
                  {["ذيل", "رأس", "رقبة", "جلد", "أحشاء", "شحم بطن", "عظم رقبة", "عظم ظهر", "أرجل", "أجنحة"].map((n) => (
                    <SelectItem key={`pre-${n}`} value={n}>{n}</SelectItem>
                  ))}
                  <SelectItem value="__other__">✏️ أخرى (اكتب يدويًا)...</SelectItem>
                </SelectContent>
              </Select>
              {(newCustomName === "" ||
                (!yields.some(y => y.cut_name_ar === newCustomName) &&
                 !["ذيل","رأس","رقبة","جلد","أحشاء","شحم بطن","عظم رقبة","عظم ظهر","أرجل","أجنحة"].includes(newCustomName))) && (
                <Input
                  className="mt-2"
                  placeholder="اكتب اسم الصنف يدويًا..."
                  value={newCustomName}
                  onChange={(e) => setNewCustomName(e.target.value)}
                />
              )}
            </div>
            <div className="w-32">
              <Input
                type="number" step="0.1" min={0} inputMode="decimal"
                placeholder="الوزن (كجم)"
                value={newCustomWeight}
                onChange={(e) => setNewCustomWeight(e.target.value === "" ? "" : +e.target.value)}
              />
            </div>
            <Button
              type="button"
              onClick={() => {
                const n = newCustomName.trim();
                const w = Number(newCustomWeight);
                if (!n || !w || w <= 0) { toast.error("اختر صنفًا وأدخل وزنًا صالحًا"); return; }
                setCustomItems((p) => [...p, { name: n, weight: w }]);
                setNewCustomName(""); setNewCustomWeight("");
              }}
              className="bg-gradient-to-r from-primary to-accent"
            >
              <Plus className="w-4 h-4 ml-1" /> إضافة
            </Button>
          </div>
          {customItems.length > 0 && (
            <div className="space-y-1 pt-2 border-t border-border/40">
              <div className="text-xs text-muted-foreground mb-1">الأصناف المضافة (قابلة للتعديل):</div>
              {customItems.map((c, idx) => (
                <div key={idx} className="flex items-center gap-2 bg-background/60 rounded px-2 py-1">
                  <Input
                    className="flex-1 min-w-[140px] h-8 text-sm"
                    value={c.name}
                    onChange={(e) => setCustomItems((p) => p.map((x, i) => i === idx ? { ...x, name: e.target.value } : x))}
                    placeholder="اسم الصنف"
                  />
                  <Input
                    className="w-24 h-8 text-sm"
                    type="number" step="0.1" min={0} inputMode="decimal"
                    value={c.weight || ""}
                    onChange={(e) => setCustomItems((p) => p.map((x, i) => i === idx ? { ...x, weight: +e.target.value || 0 } : x))}
                    placeholder="كجم"
                  />
                  <span className="text-xs text-muted-foreground">كجم</span>
                  <Button
                    type="button" size="sm" variant="destructive"
                    className="h-8 px-2"
                    onClick={() => setCustomItems((p) => p.filter((_, i) => i !== idx))}
                  >
                    <Trash2 className="w-4 h-4 ml-1" /> حذف
                  </Button>
                </div>
              ))}
              <div className="text-xs text-emerald-700 dark:text-emerald-400 pt-1">
                إجمالي المضاف للتصافي: <b>{customItems.reduce((s, c) => s + (Number(c.weight) || 0), 0).toFixed(1)} كجم</b>
              </div>
            </div>
          )}
        </div>




        {/* Dynamic add cut with search */}
        <div className="mb-3 p-3 border rounded bg-muted/20 space-y-2">
          <Label className="text-xs text-muted-foreground block">إضافة صنف للتقسيمة</Label>
          <div className="relative">
            <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              value={searchCut}
              onChange={e => setSearchCut(e.target.value)}
              placeholder="ابحث بالاسم أو رقم الكود/الباركود..."
              className="pr-8"
            />
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[220px]">
              <Select value={pickCut} onValueChange={setPickCut}>
                <SelectTrigger><SelectValue placeholder={availableYields.length === 0 ? "لا توجد نتائج" : "اختر صنفًا من قائمة المنتجات..."} /></SelectTrigger>
                <SelectContent className="z-[100] max-h-72">
                  {availableYields.length === 0 ? (
                    <div className="text-xs text-muted-foreground p-3 text-center">
                      {searchCut ? "لا توجد نتائج مطابقة للبحث" : "جميع الأصناف مُضافة"}
                    </div>
                  ) : availableYields.map(y => (
                    <SelectItem key={y.id} value={y.cut_name_ar}>
                      <span className="flex items-center gap-2">
                        <span className="font-semibold">{y.cut_name_ar}</span>
                        {y.barcode && <span className="text-xs text-muted-foreground font-mono">#{y.barcode}</span>}
                        <span className="text-xs text-muted-foreground">({Number(y.standard_yield_pct).toFixed(1)}%)</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              onClick={() => { if (pickCut) { addRow(pickCut); setPickCut(""); setSearchCut(""); } }}
              disabled={!pickCut}
              className="bg-gradient-to-r from-primary to-accent"
            >
              <Plus className="w-4 h-4 ml-1" /> إضافة
            </Button>
          </div>
        </div>

        <div className="text-xs text-muted-foreground mb-2">
          💡 المتاح يُحسب تلقائيًا = الكمية المنتجة − التالف − المحجور. لتوزيع نفس القطعة على أكثر من فرع، اضغط زر "+ فرع".
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>الصنف / الكود</TableHead>
              <TableHead>القياسي</TableHead>
              <TableHead>المُنتَج (كجم)</TableHead>
              <TableHead className="text-red-600">تالف (كجم)</TableHead>
              <TableHead className="text-amber-600">محجور (كجم)</TableHead>
              <TableHead className="text-emerald-600">المتاح (كجم)</TableHead>
              <TableHead>السعر/كجم</TableHead>
              <TableHead>الإجمالي</TableHead>
              <TableHead>الفرع</TableHead>
              <TableHead>عبوات</TableHead>
              <TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={11} className="text-center text-muted-foreground py-6">
                    لم يتم إضافة أي صنف بعد. ابحث واختر صنفًا من القائمة أعلاه لبدء التقسيمة.
                  </TableCell>
                </TableRow>
              )}
              {rows.map((r, i) => {
                const accepted = acceptedOf(r);
                const produced = Number(r.produced_weight_kg) || 0;
                const overAlloc = (Number(r.damaged_weight_kg) || 0) + (Number(r.quarantined_weight_kg) || 0) > produced && produced > 0;
                return (
                  <TableRow key={i}>
                    <TableCell>
                      <div className="font-semibold">{r.cut_name_ar}</div>
                      {r.barcode && <div className="text-[10px] text-muted-foreground font-mono">#{r.barcode}</div>}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.standard_weight_kg.toFixed(1)}</TableCell>
                    <TableCell>
                      <Input className="w-20" type="number" step="0.1" value={r.produced_weight_kg || ""}
                        onChange={e => updateRow(i, { produced_weight_kg: +e.target.value })} />
                    </TableCell>
                    <TableCell>
                      <Input className="w-20 border-red-200" type="number" step="0.1" value={r.damaged_weight_kg || ""}
                        onChange={e => updateRow(i, { damaged_weight_kg: +e.target.value })} />
                    </TableCell>
                    <TableCell>
                      <Input className="w-20 border-amber-200" type="number" step="0.1" value={r.quarantined_weight_kg || ""}
                        onChange={e => updateRow(i, { quarantined_weight_kg: +e.target.value })} />
                    </TableCell>
                    <TableCell>
                      <div className={"font-bold " + (overAlloc ? "text-red-600" : "text-emerald-700")}>
                        {accepted.toFixed(1)}
                      </div>
                      {overAlloc && <div className="text-[10px] text-red-600">تجاوز المُنتَج!</div>}
                    </TableCell>
                    <TableCell><Input className="w-20" type="number" step="0.01" value={r.unit_price || ""}
                      onChange={e => updateRow(i, { unit_price: +e.target.value })} /></TableCell>
                    <TableCell className="font-semibold">{(accepted * Number(r.unit_price || 0)).toFixed(0)}</TableCell>
                    <TableCell>
                      <Select value={r.branch_id} onValueChange={v => updateRow(i, { branch_id: v })}>
                        <SelectTrigger className="w-32"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name_ar}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell><Input className="w-16" type="number" value={r.package_count || ""}
                      onChange={e => updateRow(i, { package_count: +e.target.value })} /></TableCell>
                    <TableCell className="flex gap-1">
                      <Button size="icon" variant="ghost" onClick={() => addRow(r.cut_name_ar)} title="إضافة فرع آخر لنفس الصنف"><Plus className="w-4 h-4 text-emerald-600" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => setRows(rows.filter((_, idx) => idx !== i))}><Trash2 className="w-4 h-4 text-red-500" /></Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <DialogFooter><Button onClick={save} className="bg-gradient-to-r from-primary to-accent">حفظ التقسيمة</Button></DialogFooter>

        <AlertDialog open={!!pendingConfirm} onOpenChange={(o) => !o && setPendingConfirm(null)}>
          <AlertDialogContent dir="rtl">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-500" /> عدم تطابق الكميات
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2 text-sm">
                  <div>هناك أصناف لا يتساوى فيها مجموع (المقبول + التالف + المحجور) مع الكمية المُنتجة:</div>
                  <ul className="list-disc pr-5 space-y-1 text-xs">
                    {pendingConfirm?.mismatchRows.map((m, idx) => (
                      <li key={idx}>
                        <b>{m.name}</b>: المُنتَج {m.produced.toFixed(1)} كجم — المجموع {m.sum.toFixed(1)} كجم
                        (فرق {(m.sum - m.produced).toFixed(1)} كجم)
                      </li>
                    ))}
                  </ul>
                  <div className="text-muted-foreground">هل تريد المتابعة وحفظ التقسيمة كما هي؟</div>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="flex-row-reverse gap-2">
              <AlertDialogCancel>مراجعة الأرقام</AlertDialogCancel>
              <AlertDialogAction onClick={() => { setPendingConfirm(null); persist(); }}>
                تأكيد والحفظ
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
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
                    <TableCell>{formatDate(t.transferred_at)}</TableCell>
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
const DailyReportTab = ({ reportDate, setReportDate, receipts, birds, batches, outputs, branches, settings }: {
  reportDate: string; setReportDate: (d: string) => void;
  receipts: Receipt[]; birds: LiveBird[]; batches: Batch[]; outputs: Output[]; branches: Branch[];
  settings: Settings | null;
}) => {
  const [branchFilter, setBranchFilter] = useState<string>("");
  const lowThr = Number(settings?.low_yield_threshold ?? 40);
  const warnThr = Number(settings?.warning_yield_threshold ?? 45);

  const dayReceipts = receipts.filter(r => r.receipt_date === reportDate);
  const dayBatches = batches.filter(b => b.slaughter_date === reportDate);
  const dayReceiptIds = dayReceipts.map(r => r.id);
  const dayBatchIds = dayBatches.map(b => b.id);
  const dayBirds = birds.filter(b => dayReceiptIds.includes(b.receipt_id)).sort((a, b) => a.bird_index - b.bird_index);
  const dayOutputs = outputs.filter(o => dayBatchIds.includes(o.batch_id) && (!branchFilter || o.branch_id === branchFilter));

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

  // Per-batch chart data
  const batchChart = dayBatches.map(b => ({
    name: b.batch_number.slice(-6),
    live: Number(b.total_live_weight_kg || 0),
    meat: Number(b.total_meat_kg || 0),
    yield: Number(b.actual_yield_pct || 0),
    cost: Number(b.cost_per_kg_meat || 0),
  }));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
        <CardTitle>التقرير اليومي للذبح</CardTitle>
        <div className="flex items-center gap-2 flex-wrap">
          <Input type="date" value={reportDate} onChange={e => setReportDate(e.target.value)} className="w-44" />
          <Select value={branchFilter || "all"} onValueChange={v => setBranchFilter(v === "all" ? "" : v)}>
            <SelectTrigger className="w-40"><SelectValue placeholder="كل الفروع" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الفروع</SelectItem>
              {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name_ar}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={exportExcel}><FileSpreadsheet className="w-4 h-4 ml-1" />Excel</Button>
          <Button variant="outline" onClick={exportPDF}><FileText className="w-4 h-4 ml-1" />PDF</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Yield alert */}
        {yieldPct > 0 && yieldPct < warnThr && (
          <div className={`p-3 rounded border flex items-center gap-2 ${yieldPct < lowThr ? "bg-red-500/10 border-red-500/40 text-red-700" : "bg-amber-500/10 border-amber-500/40 text-amber-700"}`}>
            <AlertTriangle className="w-4 h-4" />
            <span className="text-sm font-medium">
              {yieldPct < lowThr
                ? `تنبيه: التصافي ${yieldPct.toFixed(1)}% أقل من الحد الأدنى (${lowThr}%)`
                : `تحذير: التصافي ${yieldPct.toFixed(1)}% قريب من الحد الأدنى (${lowThr}%)`}
            </span>
          </div>
        )}

        {/* Top stats */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-sm">
          <div className="p-2 bg-muted/40 rounded">طيور: <b>{dayBirds.length}</b></div>
          <div className="p-2 bg-muted/40 rounded">وزن قائم: <b>{totals.live.toFixed(1)}</b></div>
          <div className="p-2 bg-muted/40 rounded">لحم: <b>{totals.meat.toFixed(1)}</b></div>
          <div className="p-2 bg-muted/40 rounded">تكلفة الشراء: <b>{totals.purchase.toFixed(0)}</b></div>
          <div className="p-2 bg-muted/40 rounded">قيمة البيع: <b>{totals.value.toFixed(0)}</b></div>
          <div className={`p-2 rounded ${yieldPct < lowThr ? "bg-red-500/20" : yieldPct < warnThr ? "bg-amber-500/20" : "bg-emerald-500/20"}`}>التصافي: <b>{yieldPct.toFixed(1)}%</b></div>
        </div>

        {/* Charts */}
        {batchChart.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-muted/20 p-3 rounded">
              <p className="text-xs text-muted-foreground mb-2">الوزن الحي vs اللحم (كجم)</p>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={batchChart}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="name" fontSize={10} />
                  <YAxis fontSize={10} />
                  <RTooltip />
                  <Legend />
                  <Bar dataKey="live" fill="hsl(var(--primary))" name="حي" />
                  <Bar dataKey="meat" fill="hsl(var(--accent))" name="لحم" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="bg-muted/20 p-3 rounded">
              <p className="text-xs text-muted-foreground mb-2">التصافي % والتكلفة/كجم</p>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={batchChart}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="name" fontSize={10} />
                  <YAxis yAxisId="l" fontSize={10} />
                  <YAxis yAxisId="r" orientation="right" fontSize={10} />
                  <RTooltip />
                  <Legend />
                  <Line yAxisId="l" type="monotone" dataKey="yield" stroke="hsl(var(--primary))" name="تصافي %" />
                  <Line yAxisId="r" type="monotone" dataKey="cost" stroke="hsl(var(--accent))" name="تكلفة/كجم" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

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

// ===================== Settings Tab =====================
const SettingsTab = ({ settings, onSave }: { settings: Settings | null; onSave: (next: Partial<Settings>) => void }) => {
  const [low, setLow] = useState(settings?.low_yield_threshold ?? 40);
  const [warn, setWarn] = useState(settings?.warning_yield_threshold ?? 45);
  const [notify, setNotify] = useState(settings?.notify_on_low_yield ?? true);
  const [cutsText, setCutsText] = useState((settings?.yield_cut_names ?? DEFAULT_YIELD_CUTS).join("، "));
  useEffect(() => {
    if (settings) {
      setLow(settings.low_yield_threshold);
      setWarn(settings.warning_yield_threshold);
      setNotify(settings.notify_on_low_yield);
      setCutsText((settings.yield_cut_names ?? DEFAULT_YIELD_CUTS).join("، "));
    }
  }, [settings]);
  if (!settings) return <Card><CardContent className="p-6 text-center text-muted-foreground">جاري التحميل...</CardContent></Card>;

  const parsedCuts = cutsText.split(/[،,\n]/).map(s => s.trim()).filter(Boolean);

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><SettingsIcon className="w-5 h-5" />إعدادات حدود التصافي والتنبيهات</CardTitle></CardHeader>
      <CardContent className="space-y-4 max-w-2xl">
        <div>
          <Label>الحد الأدنى للتصافي (%) — أقل من هذا = تنبيه أحمر</Label>
          <Input type="number" step="0.5" value={low} onChange={e => setLow(+e.target.value)} />
        </div>
        <div>
          <Label>حد التحذير للتصافي (%) — أقل من هذا = تحذير برتقالي</Label>
          <Input type="number" step="0.5" value={warn} onChange={e => setWarn(+e.target.value)} />
        </div>
        <div className="flex items-center gap-2 pt-2">
          <input id="notify" type="checkbox" checked={notify} onChange={e => setNotify(e.target.checked)} className="w-4 h-4" />
          <Label htmlFor="notify" className="cursor-pointer">إرسال تنبيه عند انخفاض التصافي عند إنهاء دفعة</Label>
        </div>

        <div className="pt-2 border-t">
          <Label className="text-base font-semibold">قائمة أصناف اللحوم المُحتسبة في نسبة التصافي</Label>
          <p className="text-xs text-muted-foreground mt-1 mb-2">
            افصل بين الأصناف بفاصلة عربية «،» أو إنجليزية أو سطر جديد. أي صنف غير مدرج هنا (مثل «ريش») لن يُضاف إلى نسبة التصافي.
            المطابقة ذكية: تتجاهل المسافات الزائدة وحالة الأحرف واختلافات ة/ه و ى/ي و أ/إ/آ.
          </p>
          <Textarea rows={4} value={cutsText} onChange={e => setCutsText(e.target.value)} placeholder="لحمة، استيك، موزة، ..." />
          <div className="text-xs text-muted-foreground mt-2">
            عدد الأصناف الحالية: <b>{parsedCuts.length}</b>
            {parsedCuts.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {parsedCuts.map((c, i) => <span key={i} className="bg-primary/10 px-2 py-0.5 rounded">{c}</span>)}
              </div>
            )}
          </div>
        </div>

        <div className="text-xs text-muted-foreground bg-muted/40 p-3 rounded">
          💡 عند الانتهاء من دفعة ذبح، سيقارن النظام نسبة التصافي بهذين الحدّين ويعرض تنبيهًا فوريًا، كما سيتم تسجيل العملية في سجل التدقيق وإنشاء إشعار للمدراء.
        </div>
        <Button onClick={() => onSave({ low_yield_threshold: low, warning_yield_threshold: warn, notify_on_low_yield: notify, yield_cut_names: parsedCuts })}
          className="bg-gradient-to-r from-primary to-accent">
          <Save className="w-4 h-4 ml-1" />حفظ الإعدادات
        </Button>
      </CardContent>
    </Card>
  );
};

// ===================== Audit Log Tab =====================
const AuditLogTab = ({ audit, profiles, batches, branches }: {
  audit: AuditEntry[]; profiles: Record<string, string>; batches: Batch[]; branches: Branch[];
}) => {
  const [actionFilter, setActionFilter] = useState<string>("");
  const filtered = actionFilter ? audit.filter(a => a.action === actionFilter) : audit;
  const actionLabel = (a: string) => ({ finalize_batch: "إنهاء دفعة", transfer_status_change: "تحديث تحويل فرع" } as any)[a] || a;
  const summarize = (entry: AuditEntry) => {
    if (entry.action === "finalize_batch") {
      const nv = entry.new_value || {}; const ov = entry.old_value || {};
      return `تصافي: ${Number(ov.actual_yield_pct||0).toFixed(1)}% → ${Number(nv.actual_yield_pct||0).toFixed(1)}% | لحم: ${Number(nv.total_meat_kg||0).toFixed(1)} كجم | تحويلات: ${nv.transfers_created||0}`;
    }
    if (entry.action === "transfer_status_change") {
      const nv = entry.new_value || {}; const ov = entry.old_value || {};
      const br = branches.find(b => b.id === nv.branch_id)?.name_ar || "-";
      return `${nv.cut_name_ar} → ${br}: ${ov.status} → ${nv.status} (${Number(nv.weight_kg||0).toFixed(1)} كجم)`;
    }
    return entry.notes || "";
  };
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
        <CardTitle className="flex items-center gap-2"><History className="w-5 h-5" />سجل التدقيق</CardTitle>
        <Select value={actionFilter || "all"} onValueChange={v => setActionFilter(v === "all" ? "" : v)}>
          <SelectTrigger className="w-48"><SelectValue placeholder="كل العمليات" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل العمليات</SelectItem>
            <SelectItem value="finalize_batch">إنهاء دفعة</SelectItem>
            <SelectItem value="transfer_status_change">تحديث تحويل فرع</SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow>
            <TableHead>الوقت</TableHead><TableHead>العملية</TableHead><TableHead>المستخدم</TableHead>
            <TableHead>الدفعة</TableHead><TableHead>التفاصيل</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {filtered.map(e => {
              const bt = batches.find(b => b.id === e.batch_id);
              return (
                <TableRow key={e.id}>
                  <TableCell className="text-xs">{formatDateTime(e.performed_at)}</TableCell>
                  <TableCell><Badge variant="outline">{actionLabel(e.action)}</Badge></TableCell>
                  <TableCell className="text-sm">{e.performed_by ? (profiles[e.performed_by] || e.performed_by.slice(0, 8)) : "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{bt?.batch_number || "—"}</TableCell>
                  <TableCell className="text-sm">{summarize(e)}</TableCell>
                </TableRow>
              );
            })}
            {!filtered.length && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">لا توجد عمليات مسجلة</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
};

export default Slaughterhouse;
