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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel } from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Receipt as ReceiptIcon } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Beef, TrendingUp, Package, Scale, Plus, AlertTriangle, CheckCircle2,
  Users, ClipboardCheck, Bird, FileSpreadsheet, FileText, Truck, Trash2,
  Settings as SettingsIcon, History, Save, Search, Printer, ShieldCheck, Pencil,
} from "lucide-react";
import companyLogo from "@/assets/company-logo.jpg";
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
type Yield = { id: string; cut_name_ar: string; cut_name_en: string | null; barcode: string | null; standard_yield_pct: number; standard_kg_per_bird: number | null; package_size_kg: number | null; category: string; display_order: number; is_active: boolean; };
type Output = { id: string; batch_id: string; cut_name_ar: string; barcode: string | null; actual_weight_kg: number; damaged_weight_kg: number; quarantined_weight_kg: number; package_count: number; standard_weight_kg: number; variance_pct: number; unit_cost: number; unit_price: number; total_cost: number; destination: string; branch_id: string | null; quality_status?: string; received_status?: string; received_warehouse_id?: string | null; received_at?: string | null };
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

const DEFAULT_YIELD_CUTS = ["لحمه","استيك","موزه","فراشه","قطعيه دبوس","دبوس بالعظم","فخده","صندوق","نعامه صندوق","تربيانكو","اسكالوب","رول النعام","فرم نعام"];
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
  const [warehouses, setWarehouses] = useState<{ id: string; name: string }[]>([]);
  const [birds, setBirds] = useState<LiveBird[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [adjustments, setAdjustments] = useState<Array<{ id: string; adjustment_date: string; new_balance: number; delta: number; reason: string | null; created_by: string | null; created_at: string }>>([]);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustForm, setAdjustForm] = useState({ new_balance: 0, reason: "", adjustment_date: new Date().toISOString().slice(0, 10) });
  const [loading, setLoading] = useState(true);
  // Dead-ostriches month/year filter
  const now = new Date();
  const [deadMonth, setDeadMonth] = useState<number>(now.getMonth() + 1);
  const [deadYear, setDeadYear] = useState<number>(now.getFullYear());

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
    const [r, b, y, o, w, q, br, bd, tr, st, au, pr, adj, wh] = await Promise.all([
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
      supabase.from("slaughter_live_stock_adjustments" as any).select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("warehouses" as any).select("id,name").order("name"),
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
    setAdjustments((adj.data as any) || []);
    setWarehouses((wh.data as any) || []);
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
  const birdsSlaughteredMonth = batches
    .filter(b => b.slaughter_date >= monthStartStr && b.status !== "cancelled")
    .reduce((s, b) => s + (b.birds_slaughtered || 0), 0);
  // النعام القائم = المُستلم - النافق - المذبوح - النافق قبل الذبح - المرفوض
  const adjustmentsSum = adjustments.reduce((s, a) => s + (a.delta || 0), 0);
  const liveBalance = (() => {
    const received = receipts.reduce((s, r) => s + (r.bird_count || 0), 0);
    const doa = receipts.reduce((s, r) => s + (r.dead_on_arrival || 0), 0);
    const active = batches.filter(b => b.status !== "cancelled");
    const slaughtered = active.reduce((s, b) => s + (b.birds_slaughtered || 0), 0);
    const preDead = active.reduce((s, b) => s + (b.pre_slaughter_dead || 0), 0);
    const rejected = active.reduce((s, b) => s + (b.rejected_birds || 0), 0);
    return Math.max(received - doa - slaughtered - preDead - rejected + adjustmentsSum, 0);
  })();
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
  const isExecManager = role === "general_manager" || role === "executive_manager";
  const pendingApprovalBatches = batches.filter(b => (b as any).transfer_status === "pending_approval");

  // ===== نعام نافق (شهري) =====
  const mm = String(deadMonth).padStart(2, "0");
  const monthPrefix = `${deadYear}-${mm}`; // YYYY-MM
  const deadInMonth = useMemo(() => {
    const doa = receipts
      .filter(r => (r.receipt_date || "").startsWith(monthPrefix))
      .reduce((s, r) => s + (r.dead_on_arrival || 0), 0);
    const activeB = batches.filter(b => b.status !== "cancelled" && (b.slaughter_date || "").startsWith(monthPrefix));
    const preDead = activeB.reduce((s, b) => s + (b.pre_slaughter_dead || 0), 0);
    const rejected = activeB.reduce((s, b) => s + (b.rejected_birds || 0), 0);
    const adjLoss = adjustments
      .filter(a => (a.adjustment_date || "").startsWith(monthPrefix) && (a.delta || 0) < 0)
      .reduce((s, a) => s + Math.abs(a.delta || 0), 0);
    return { doa, preDead, rejected, adjLoss, total: doa + preDead + rejected + adjLoss };
  }, [receipts, batches, adjustments, monthPrefix]);
  // Years list from data
  const yearsAvailable = useMemo(() => {
    const set = new Set<number>();
    receipts.forEach(r => r.receipt_date && set.add(Number(r.receipt_date.slice(0, 4))));
    batches.forEach(b => b.slaughter_date && set.add(Number(b.slaughter_date.slice(0, 4))));
    set.add(now.getFullYear());
    return Array.from(set).filter(y => y > 2000).sort((a, b) => b - a);
  }, [receipts, batches]);
  const monthNamesAr = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];

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

  const saveLiveStockAdjustment = async () => {
    if (!isExecManager) { toast.error("غير مصرح لك بتعديل رصيد النعام القائم"); return; }
    const newBal = Number(adjustForm.new_balance);
    if (!Number.isFinite(newBal) || newBal < 0) { toast.error("أدخل رصيد صحيح (0 أو أكثر)"); return; }
    const delta = newBal - liveBalance;
    if (delta === 0) { toast.error("الرصيد الجديد مطابق للحالي"); return; }
    if (!adjustForm.reason.trim()) { toast.error("اكتب سبب التعديل"); return; }
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("slaughter_live_stock_adjustments" as any).insert({
      adjustment_date: adjustForm.adjustment_date,
      new_balance: newBal,
      delta,
      reason: adjustForm.reason.trim(),
      created_by: user?.id,
    });
    if (error) { toast.error(error.message); return; }
    toast.success(`تم ضبط الرصيد إلى ${newBal} نعامة`);
    setAdjustOpen(false);
    setAdjustForm({ new_balance: 0, reason: "", adjustment_date: todayStr });
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

  const deleteReceipt = async (r: Receipt) => {
    if (!isExecManager) { toast.error("غير مصرح لك بحذف قسائم الشراء"); return; }
    if (!window.confirm(`هل تريد حذف قسيمة الشراء ${r.receipt_number}؟ سيتم حذف بيانات الطيور المرتبطة بها.`)) return;
    const linkedBatches = batches.filter(b => b.live_receipt_id === r.id);
    if (linkedBatches.length > 0) {
      toast.error("لا يمكن الحذف: توجد دفعات ذبح مرتبطة بهذه القسيمة. احذف الدفعات أولاً.");
      return;
    }
    await supabase.from("slaughter_live_birds" as any).delete().eq("receipt_id", r.id);
    const { error } = await supabase.from("slaughter_live_receipts" as any).delete().eq("id", r.id);
    if (error) { toast.error(error.message); return; }
    toast.success("تم حذف قسيمة الشراء");
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

  // Send a completed batch's outputs to a destination warehouse using the gated RPC
  const [confirmSendBatch, setConfirmSendBatch] = useState<Batch | null>(null);
  const [sendDestination, setSendDestination] = useState<"main" | "meat_factory">("main");
  const [sendingBatch, setSendingBatch] = useState(false);
  const [meatTransferBatch, setMeatTransferBatch] = useState<Batch | null>(null);
  const [approvalNote, setApprovalNote] = useState("");

  const findWarehouseByName = async (pattern: string) => {
    const { data } = await supabase
      .from("warehouses" as any)
      .select("id,name")
      .ilike("name", pattern)
      .limit(1)
      .maybeSingle();
    return data as any;
  };

  const [partialQty, setPartialQty] = useState<Record<string, string>>({});

  // Open partial dialog: prefill qty inputs with full available qty for each pending output of this batch
  const openSendDialog = (b: Batch, dest: "main" | "meat_factory") => {
    setSendDestination(dest);
    const rows = outputs.filter(o =>
      o.batch_id === b.id &&
      (o.received_status || "pending") !== "received" &&
      (o.quality_status || "accepted") === "accepted" &&
      Number(o.actual_weight_kg) > 0
    );
    const init: Record<string, string> = {};
    rows.forEach(o => { init[o.id] = String(Number(o.actual_weight_kg) || 0); });
    setPartialQty(init);
    setConfirmSendBatch(b);
  };

  const printTransferNote = (b: Batch, destLabel: string, lines: { name: string; qty: number }[], totalKg: number) => {
    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) return;
    const rows = lines.map((l, i) => `<tr><td>${i + 1}</td><td>${l.name}</td><td style="text-align:center">${l.qty.toFixed(2)} كجم</td></tr>`).join("");
    w.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>إذن توريد ${b.batch_number}</title>
      <style>
        body{font-family:'Tahoma','Cairo',Arial,sans-serif;padding:24px;color:#111}
        h1{margin:0 0 4px;font-size:22px;color:#5a2a82}
        .meta{display:flex;justify-content:space-between;margin:12px 0;font-size:14px}
        table{width:100%;border-collapse:collapse;margin-top:12px;font-size:14px}
        th,td{border:1px solid #ccc;padding:8px}
        th{background:#f3eef9;color:#5a2a82}
        tfoot td{font-weight:bold;background:#fafafa}
        .sign{display:flex;justify-content:space-between;margin-top:48px;font-size:14px}
        .sign div{width:30%;border-top:1px solid #333;padding-top:6px;text-align:center}
      </style></head><body>
      <h1>إذن توريد من المجزر</h1>
      <div class="meta">
        <div><b>رقم الدفعة:</b> ${b.batch_number}</div>
        <div><b>التاريخ:</b> ${new Date().toLocaleDateString("ar-EG")}</div>
        <div><b>الجهة:</b> ${destLabel}</div>
      </div>
      <table>
        <thead><tr><th>م</th><th>الصنف</th><th>الكمية</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td colspan="2">الإجمالي</td><td style="text-align:center">${totalKg.toFixed(2)} كجم</td></tr></tfoot>
      </table>
      <div class="sign"><div>المُسلِّم (المجزر)</div><div>المُستلِم (${destLabel})</div><div>المدير</div></div>
      <script>window.onload=()=>{window.print();}</script>
      </body></html>`);
    w.document.close();
  };

  const sendBatchToWarehouse = async (b: Batch, dest: "main" | "meat_factory") => {
    setSendingBatch(true);
    try {
      const pattern = dest === "meat_factory" ? "%مصنع اللحوم%" : "%رئيسي%";
      const destLabel = dest === "meat_factory" ? "مصنع اللحوم" : "المخزن الرئيسي";
      const wh = await findWarehouseByName(pattern);
      if (!wh) { toast.error(`لم يتم العثور على ${destLabel}`); return; }

      // Build items payload from partialQty
      const itemsPayload: { output_id: string; qty: number }[] = [];
      const printLines: { name: string; qty: number }[] = [];
      let totalKg = 0;
      for (const [outId, val] of Object.entries(partialQty)) {
        const qty = Number(val);
        if (!qty || qty <= 0) continue;
        const o = outputs.find(x => x.id === outId);
        if (!o) continue;
        const safeQty = Math.min(qty, Number(o.actual_weight_kg));
        itemsPayload.push({ output_id: outId, qty: safeQty });
        printLines.push({ name: o.cut_name_ar, qty: safeQty });
        totalKg += safeQty;
      }
      if (itemsPayload.length === 0) {
        toast.error("أدخل كمية على الأقل لصنف واحد");
        return;
      }

      const { data, error } = await supabase.rpc("transfer_slaughter_partial" as any, {
        p_batch_id: b.id,
        p_warehouse_id: wh.id,
        p_items: itemsPayload as any,
      });
      if (error) { toast.error(error.message); return; }
      const d: any = data || {};
      toast.success(`تم توريد ${d.received_count || 0} صنف إلى ${destLabel} (${Number(d.total_kg || 0).toFixed(1)} كجم)`);
      printTransferNote(b, destLabel, printLines, totalKg);
      setConfirmSendBatch(null);
      setPartialQty({});
      fetchAll();
    } finally {
      setSendingBatch(false);
    }
  };

  const approveLowYield = async (b: Batch) => {
    const wh = await findWarehouseByName("%رئيسي%");
    if (!wh) { toast.error("لم يتم العثور على المخزن الرئيسي"); return; }
    const { error } = await supabase.rpc("approve_low_yield_transfer" as any, {
      p_batch_id: b.id, p_warehouse_id: wh.id, p_note: approvalNote || null,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("تمت الموافقة وتم التحويل للمخزن الرئيسي");
    setApprovalNote("");
    fetchAll();
  };

  const rejectLowYield = async (b: Batch) => {
    const reason = window.prompt("سبب الرفض:");
    if (!reason) return;
    const { error } = await supabase.rpc("reject_low_yield_transfer" as any, {
      p_batch_id: b.id, p_reason: reason,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("تم رفض التحويل");
    fetchAll();
  };


  // Receipt details + export
  const [detailReceipt, setDetailReceipt] = useState<Receipt | null>(null);
  const exportReceiptExcel = (r: Receipt) => {
    const recBirds = birds.filter(b => b.receipt_id === r.id);
    const summary = [
      ["شركة نعام العاصمة - تفاصيل استلام طيور حية"],
      [],
      ["رقم الاستلام", r.receipt_number],
      ["التاريخ", r.receipt_date],
      ["المصدر", r.source_type === "internal_farm" ? "المزرعة الداخلية" : "مورد خارجي"],
      ["اسم المصدر", r.source_name || "-"],
      ["عدد الطيور", r.bird_count],
      ["الوزن الإجمالي (كجم)", Number(r.total_weight_kg || 0).toFixed(2)],
      ["متوسط الوزن (كجم)", Number(r.avg_weight_kg || 0).toFixed(2)],
      ["السعر/كجم", Number(r.price_per_kg || 0).toFixed(2)],
      ["إجمالي التكلفة", Number(r.total_cost || 0).toFixed(2)],
      ["نافق عند الوصول", r.dead_on_arrival],
      ["الحالة", r.status],
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), "ملخص الاستلام");
    if (recBirds.length) {
      const rows = recBirds.map((b, i) => ({
        "م": i + 1,
        "رقم الطائر": b.bird_index,
        "الوزن الحي (كجم)": Number(b.live_weight_kg || 0).toFixed(2),
        "وزن الذبح (كجم)": Number(b.slaughter_weight_kg || 0).toFixed(2),
        "تكلفة الشراء": Number(b.purchase_cost || 0).toFixed(2),
        "تكلفة العلف": Number(b.feed_cost || 0).toFixed(2),
        "وقت الشراء": b.purchase_time || "-",
        "ملاحظات": b.notes || "-",
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      ws["!cols"] = [{ wch: 4 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 24 }];
      XLSX.utils.book_append_sheet(wb, ws, "تفاصيل الطيور");
    }
    XLSX.writeFile(wb, `استلام-${r.receipt_number}.xlsx`);
    toast.success("تم تصدير ملف Excel");
  };

  const exportReceiptPDF = (r: Receipt) => {
    const recBirds = birds.filter(b => b.receipt_id === r.id);
    const totalCost = recBirds.reduce((s, b) => s + Number(b.purchase_cost || 0) + Number(b.feed_cost || 0), 0) || Number(r.total_cost || 0);
    const logoUrl = `${window.location.origin}${companyLogo}`;
    const esc = (s: unknown) =>
      String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
    const birdRows = recBirds.map((b, i) => `<tr>
      <td>${i + 1}</td>
      <td>${b.bird_index}</td>
      <td>${Number(b.live_weight_kg || 0).toFixed(2)}</td>
      <td>${Number(b.slaughter_weight_kg || 0).toFixed(2)}</td>
      <td>${Number(b.purchase_cost || 0).toFixed(2)}</td>
      <td>${Number(b.feed_cost || 0).toFixed(2)}</td>
      <td style="font-size:10px">${esc(b.notes || "-")}</td>
    </tr>`).join("");
    const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"/>
<title>استلام ${esc(r.receipt_number)}</title>
<style>
  @page { size: A4; margin: 10mm; }
  body { font-family: "Segoe UI", Tahoma, Arial, sans-serif; margin: 0; padding: 12px; color: #111; }
  .header { display:flex; align-items:center; gap:16px; border-bottom:3px double #7c3aed; padding-bottom:10px; margin-bottom:12px; }
  .header img { width:90px; height:90px; object-fit:contain; }
  .header .titles { flex:1; text-align:center; }
  .header h1 { margin:0; font-size:22px; color:#7c3aed; }
  .header p { margin:2px 0; font-size:11px; color:#555; }
  .report-title { text-align:center; font-size:16px; font-weight:700; background:linear-gradient(90deg,#7c3aed,#f97316); color:white; padding:8px; border-radius:6px; margin-bottom:12px; }
  .meta { display:grid; grid-template-columns:repeat(4,1fr); gap:6px; margin-bottom:12px; font-size:12px; }
  .meta div { border:1px solid #ddd; padding:6px 8px; border-radius:4px; background:#f9fafb; }
  .meta strong { color:#7c3aed; display:block; font-size:10px; }
  table { width:100%; border-collapse:collapse; font-size:11px; margin-top:8px; }
  th { background:#7c3aed; color:white; padding:6px 4px; border:1px solid #6d28d9; text-align:center; }
  td { border:1px solid #ddd; padding:5px 4px; text-align:center; }
  tbody tr:nth-child(even) { background:#faf5ff; }
  .toolbar { text-align:center; margin-bottom:10px; }
  .toolbar button { padding:8px 18px; background:#7c3aed; color:white; border:none; border-radius:4px; cursor:pointer; font-size:13px; }
  @media print { .toolbar { display:none; } body { padding:0; } }
</style></head>
<body>
  <div class="toolbar"><button onclick="window.print()">🖨️ طباعة / حفظ PDF</button></div>
  <div class="header">
    <img src="${logoUrl}" alt="شعار الشركة"/>
    <div class="titles">
      <h1>شركة نعام العاصمة</h1>
      <p>تقرير استلام طيور حية</p>
    </div>
  </div>
  <div class="report-title">إيصال استلام — ${esc(r.receipt_number)}</div>
  <div class="meta">
    <div><strong>تاريخ التوريد</strong>${esc(r.receipt_date)}</div>
    <div><strong>المصدر</strong>${r.source_type === "internal_farm" ? "🏡 داخلي" : "🚚 خارجي"}</div>
    <div><strong>اسم المورد</strong>${esc(r.source_name || "-")}</div>
    <div><strong>الحالة</strong>${esc(r.status)}</div>
    <div><strong>عدد الطيور</strong>${r.bird_count}</div>
    <div><strong>الوزن الإجمالي</strong>${Number(r.total_weight_kg || 0).toFixed(1)} كجم</div>
    <div><strong>متوسط الوزن</strong>${Number(r.avg_weight_kg || 0).toFixed(2)} كجم</div>
    <div><strong>نافق عند الوصول</strong>${r.dead_on_arrival}</div>
    <div><strong>السعر/كجم</strong>${Number(r.price_per_kg || 0).toFixed(2)} ج.م</div>
    <div><strong>إجمالي التكلفة</strong>${totalCost.toFixed(2)} ج.م</div>
  </div>
  ${recBirds.length ? `<table>
    <thead><tr><th>م</th><th>رقم الطائر</th><th>الوزن الحي</th><th>وزن الذبح</th><th>تكلفة الشراء</th><th>تكلفة العلف</th><th>ملاحظات</th></tr></thead>
    <tbody>${birdRows}</tbody>
  </table>` : '<p style="text-align:center;color:#888;padding:12px">لا توجد بيانات تفصيلية للطيور</p>'}
</body></html>`;
    const w = window.open("", "_blank");
    if (!w) { toast.error("افتح المتصفح للطباعة"); return; }
    w.document.write(html);
    w.document.close();
  };



  const exportBatchExcel = (b: Batch) => {
    const items = outputs.filter(o => o.batch_id === b.id);
    if (!items.length) { toast.error("لا توجد تقسيمة لهذه الدفعة"); return; }
    const rows = items.map((o, i) => {
      const branch = branches.find(br => br.id === o.branch_id);
      return {
        "م": i + 1,
        "اسم القطعية": o.cut_name_ar,
        "الباركود": o.barcode || "-",
        "الوزن الفعلي (كجم)": Number(o.actual_weight_kg || 0).toFixed(2),
        "الوزن القياسي (كجم)": Number(o.standard_weight_kg || 0).toFixed(2),
        "نسبة الانحراف %": Number(o.variance_pct || 0).toFixed(2),
        "عدد العبوات": o.package_count,
        "تالف (كجم)": Number(o.damaged_weight_kg || 0).toFixed(2),
        "محجوز (كجم)": Number(o.quarantined_weight_kg || 0).toFixed(2),
        "تكلفة الوحدة": Number(o.unit_cost || 0).toFixed(2),
        "سعر البيع": Number(o.unit_price || 0).toFixed(2),
        "إجمالي التكلفة": Number(o.total_cost || 0).toFixed(2),
        "الوجهة": o.destination,
        "الفرع": branch?.name_ar || "-",
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{ wch: 4 }, { wch: 22 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 16 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "التقسيمة");
    const summary = [
      ["شركة نعام العاصمة - تقرير تقسيمة دفعة"],
      [],
      ["رقم الدفعة", b.batch_number],
      ["التاريخ", b.slaughter_date],
      ["الشيفت", b.shift === "morning" ? "صباحي" : b.shift === "evening" ? "مسائي" : "ليلي"],
      ["عدد الطيور المذبوحة", b.birds_slaughtered],
      ["الوزن الحي (كجم)", Number(b.total_live_weight_kg || 0).toFixed(2)],
      ["إجمالي اللحم (كجم)", Number(b.total_meat_kg || 0).toFixed(2)],
      ["نسبة التصافي %", Number(b.actual_yield_pct || 0).toFixed(2)],
      ["تكلفة الكيلو", Number(b.cost_per_kg_meat || 0).toFixed(2)],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), "ملخص الدفعة");
    XLSX.writeFile(wb, `تقسيمة-${b.batch_number}.xlsx`);
    toast.success("تم تصدير ملف Excel");
  };

  const exportBatchPDF = (b: Batch) => {
    const items = outputs.filter(o => o.batch_id === b.id);
    if (!items.length) { toast.error("لا توجد تقسيمة لهذه الدفعة"); return; }
    const logoUrl = `${window.location.origin}${companyLogo}`;
    const shiftLabel = b.shift === "morning" ? "صباحي" : b.shift === "evening" ? "مسائي" : "ليلي";
    const totalActual = items.reduce((s, o) => s + Number(o.actual_weight_kg || 0), 0);
    const totalDamaged = items.reduce((s, o) => s + Number(o.damaged_weight_kg || 0), 0);
    const totalQuarantined = items.reduce((s, o) => s + Number(o.quarantined_weight_kg || 0), 0);
    const totalPackages = items.reduce((s, o) => s + (o.package_count || 0), 0);
    const totalCost = items.reduce((s, o) => s + Number(o.total_cost || 0), 0);
    const liveW = Number(b.total_live_weight_kg || 0);
    // نسبة تصافي اللحم: مجموع أوزان الأصناف المُحتسبة كلحم فقط ÷ الوزن الحي
    const meatSet = new Set((settings?.yield_cut_names || DEFAULT_YIELD_CUTS).map(normalizeCutName));
    const meatOnlyKg = items
      .filter(o => meatSet.has(normalizeCutName(o.cut_name_ar)))
      .reduce((s, o) => s + Number(o.actual_weight_kg || 0), 0);
    const meatYieldPct = liveW > 0 ? (meatOnlyKg / liveW) * 100 : 0;
    const totalPctOfLive = liveW > 0 ? (totalActual / liveW) * 100 : 0;

    const esc = (s: unknown) =>
      String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
    const rowsHtml = items.map((o, i) => {
      const branch = branches.find(br => br.id === o.branch_id);
      const variance = Number(o.variance_pct || 0);
      const varColor = variance < -5 ? "color:#b91c1c;font-weight:700" : variance > 5 ? "color:#15803d;font-weight:700" : "";
      const actual = Number(o.actual_weight_kg || 0);
      const pctOfLive = liveW > 0 ? (actual / liveW) * 100 : 0;
      const isMeat = meatSet.has(normalizeCutName(o.cut_name_ar));
      return `<tr>
        <td>${i + 1}</td>
        <td style="font-weight:600">${esc(o.cut_name_ar)}${isMeat ? ' <span style="color:#15803d;font-size:9px">●لحم</span>' : ''}</td>
        <td style="font-family:monospace;font-size:11px">${esc(o.barcode || "-")}</td>
        <td>${actual.toFixed(2)}</td>
        <td>${Number(o.standard_weight_kg || 0).toFixed(2)}</td>
        <td style="${varColor}">${variance.toFixed(1)}%</td>
        <td style="font-weight:700;color:#7c3aed">${pctOfLive.toFixed(2)}%</td>
        <td>${o.package_count}</td>
        <td>${Number(o.damaged_weight_kg || 0).toFixed(2)}</td>
        <td>${Number(o.unit_cost || 0).toFixed(2)}</td>
        <td>${Number(o.total_cost || 0).toFixed(2)}</td>
        <td>${esc(branch?.name_ar || o.destination || "-")}</td>
      </tr>`;
    }).join("");

    const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"/>
<title>تقسيمة الدفعة ${esc(b.batch_number)}</title>
<style>
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Tahoma, Arial, sans-serif; margin: 0; padding: 12px; color: #111; }
  .header { display:flex; align-items:center; gap:16px; border-bottom:3px double #7c3aed; padding-bottom:10px; margin-bottom:12px; }
  .header img { width:90px; height:90px; object-fit:contain; }
  .header .titles { flex:1; text-align:center; }
  .header h1 { margin:0; font-size:22px; color:#7c3aed; }
  .header p { margin:2px 0; font-size:11px; color:#555; }
  .report-title { text-align:center; font-size:16px; font-weight:700; background:linear-gradient(90deg,#7c3aed,#f97316); color:white; padding:8px; border-radius:6px; margin-bottom:12px; }
  .meta { display:grid; grid-template-columns:repeat(4,1fr); gap:6px; margin-bottom:12px; font-size:12px; }
  .meta div { border:1px solid #ddd; padding:6px 8px; border-radius:4px; background:#f9fafb; }
  .meta strong { color:#7c3aed; display:block; font-size:10px; }
  table { width:100%; border-collapse:collapse; font-size:11px; }
  th { background:#7c3aed; color:white; padding:6px 4px; border:1px solid #6d28d9; text-align:center; }
  td { border:1px solid #ddd; padding:5px 4px; text-align:center; }
  tbody tr:nth-child(even) { background:#faf5ff; }
  tfoot td { background:#fef3c7; font-weight:700; border-top:2px solid #f97316; }
  .footer { display:flex; justify-content:space-between; margin-top:20px; font-size:11px; color:#555; border-top:1px solid #ddd; padding-top:8px; }
  .sig { margin-top:30px; display:grid; grid-template-columns:repeat(3,1fr); gap:30px; text-align:center; font-size:12px; }
  .sig div { border-top:1px solid #333; padding-top:6px; }
  .toolbar { text-align:center; margin-bottom:10px; }
  .toolbar button { padding:8px 18px; background:#7c3aed; color:white; border:none; border-radius:4px; cursor:pointer; font-size:13px; }
  @media print { .toolbar { display:none; } body { padding:0; } }
</style></head>
<body>
  <div class="toolbar"><button onclick="window.print()">🖨️ طباعة / حفظ PDF</button></div>
  <div class="header">
    <img src="${logoUrl}" alt="شعار الشركة"/>
    <div class="titles">
      <h1>شركة نعام العاصمة</h1>
      <p>محافظة الغربية - مركز زفتى - قرية مسجد وصيف</p>
      <p>مجزر النعام — قرار وزاري رقم (298) لسنة 2023 — كود (N/1604020114)</p>
      <p>تم الذبح طبقًا للشريعة الإسلامية وتحت إشراف بيطري كامل</p>
    </div>
  </div>
  <div class="report-title">تقرير تقسيمة الذبح — ${esc(b.batch_number)}</div>
  <div class="meta">
    <div><strong>رقم الدفعة</strong>${esc(b.batch_number)}</div>
    <div><strong>تاريخ الذبح</strong>${esc(b.slaughter_date)}</div>
    <div><strong>الشيفت</strong>${esc(shiftLabel)}</div>
    <div><strong>عدد الطيور</strong>${b.birds_slaughtered}</div>
    <div><strong>الوزن الحي (كجم)</strong>${liveW.toFixed(1)}</div>
    <div><strong>إجمالي اللحم (كجم)</strong>${Number(b.total_meat_kg || 0).toFixed(1)}</div>
    <div><strong>نسبة التصافي الإجمالية</strong>${Number(b.actual_yield_pct || 0).toFixed(1)}%</div>
    <div style="background:#ecfdf5;border-color:#10b981"><strong style="color:#047857">نسبة تصافي اللحم فقط</strong><span style="color:#047857;font-weight:700">${meatYieldPct.toFixed(1)}%</span><div style="font-size:9px;color:#666">(${meatOnlyKg.toFixed(1)} كجم لحم ÷ ${liveW.toFixed(1)} كجم حي)</div></div>
    <div><strong>تكلفة الكيلو</strong>${Number(b.cost_per_kg_meat || 0).toFixed(0)} ج.م</div>
  </div>

  <table>
    <thead><tr>
      <th>م</th><th>اسم القطعية</th><th>الباركود</th>
      <th>الوزن الفعلي</th><th>الوزن القياسي</th><th>الانحراف %</th>
      <th>% من الوزن الحي</th>
      <th>العبوات</th><th>تالف</th><th>تكلفة الوحدة</th><th>إجمالي التكلفة</th><th>الوجهة</th>
    </tr></thead>
    <tbody>${rowsHtml}</tbody>
    <tfoot><tr>
      <td colspan="3">الإجمالي</td>
      <td>${totalActual.toFixed(2)}</td>
      <td>-</td><td>-</td>
      <td style="color:#7c3aed;font-weight:700">${totalPctOfLive.toFixed(2)}%</td>
      <td>${totalPackages}</td>
      <td>${totalDamaged.toFixed(2)}</td>
      <td>-</td>
      <td>${totalCost.toFixed(2)}</td>
      <td>محجوز: ${totalQuarantined.toFixed(2)}</td>
    </tr></tfoot>
  </table>
  <div class="sig">
    <div>مسؤول المجزر</div>
    <div>الطبيب البيطري</div>
    <div>مدير الإنتاج</div>
  </div>
  <div class="footer">
    <span>تاريخ الطباعة: ${new Date().toLocaleString("ar-EG")}</span>
    <span>شركة نعام العاصمة © ${new Date().getFullYear()}</span>
  </div>
  <script>window.addEventListener('load',()=>setTimeout(()=>window.print(),500));</script>
</body></html>`;

    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) { toast.error("افتح النوافذ المنبثقة"); return; }
    w.document.open(); w.document.write(html); w.document.close();
    toast.success("جاري إعداد ملف PDF...");
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
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
        <Card className="border-primary/40 bg-primary/5"><CardContent className="p-3 flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground">النعام القائم 🐦</p>
            <p className="text-2xl font-bold text-primary">{liveBalance}</p>
            {isExecManager && (
              <button
                type="button"
                onClick={() => { setAdjustForm({ new_balance: liveBalance, reason: "", adjustment_date: todayStr }); setAdjustOpen(true); }}
                className="mt-1 text-[10px] text-primary underline hover:opacity-80"
              >
                تعديل الرصيد
              </button>
            )}
          </div>
          <Bird className="w-7 h-7 text-primary/60" />
        </CardContent></Card>
        <Card className="border-orange-400/40 bg-orange-50/40 dark:bg-orange-950/10"><CardContent className="p-3 flex items-center justify-between">
          <div><p className="text-xs text-muted-foreground">مذبوح هذا الشهر</p><p className="text-2xl font-bold text-orange-600">{birdsSlaughteredMonth}</p></div>
          <Beef className="w-7 h-7 text-orange-500/60" />
        </CardContent></Card>
        <Card><CardContent className="p-3 flex items-center justify-between">
          <div><p className="text-xs text-muted-foreground">طيور اليوم</p><p className="text-2xl font-bold">{birdsToday}</p></div>
          <Beef className="w-7 h-7 text-primary/40" />
        </CardContent></Card>
        <Card><CardContent className="p-3 flex items-center justify-between">
          <div><p className="text-xs text-muted-foreground">لحوم اليوم (كجم)</p><p className="text-2xl font-bold">{meatToday.toFixed(1)}</p></div>
          <Scale className="w-7 h-7 text-accent/40" />
        </CardContent></Card>
        <Card><CardContent className="p-3 flex items-center justify-between">
          <div><p className="text-xs text-muted-foreground">إنتاج الشهر (كجم)</p><p className="text-2xl font-bold">{meatMonth.toFixed(0)}</p></div>
          <Package className="w-7 h-7 text-emerald-500/40" />
        </CardContent></Card>
        <Card><CardContent className="p-3 flex items-center justify-between">
          <div><p className="text-xs text-muted-foreground">التصافي اليوم</p><p className={`text-2xl font-bold ${yieldToday < 40 ? "text-red-600" : "text-emerald-600"}`}>{yieldToday.toFixed(1)}%</p></div>
          <TrendingUp className="w-7 h-7 text-blue-500/40" />
        </CardContent></Card>
        <Card><CardContent className="p-3 flex items-center justify-between">
          <div><p className="text-xs text-muted-foreground">تكلفة الكيلو</p><p className="text-2xl font-bold">{avgCost.toFixed(0)} ر.س</p></div>
          <ClipboardCheck className="w-7 h-7 text-amber-500/40" />
        </CardContent></Card>
      </div>

      {/* نعام نافق — شهر/سنة */}
      <Card className="mb-6 border-red-400/40 bg-red-50/30 dark:bg-red-950/10">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-600" />
              <h3 className="font-bold text-red-700 dark:text-red-400">نعام نافق — {monthNamesAr[deadMonth - 1]} {deadYear}</h3>
              {isExecManager && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1 border-red-400/50 text-red-700 hover:bg-red-50"
                  onClick={() => { setAdjustForm({ new_balance: liveBalance, reason: "", adjustment_date: todayStr }); setAdjustOpen(true); }}
                >
                  <Pencil className="w-3.5 h-3.5" />
                  تعديل
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                <Label className="text-xs">الشهر</Label>
                <Select value={String(deadMonth)} onValueChange={(v) => setDeadMonth(Number(v))}>
                  <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {monthNamesAr.map((n, i) => <SelectItem key={i} value={String(i + 1)}>{n}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-1">
                <Label className="text-xs">السنة</Label>
                <Select value={String(deadYear)} onValueChange={(v) => setDeadYear(Number(v))}>
                  <SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {yearsAvailable.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="p-3 rounded bg-red-500/10 border border-red-500/20">
              <div className="text-[11px] text-muted-foreground">الإجمالي</div>
              <div className="text-2xl font-bold text-red-700">{deadInMonth.total}</div>
            </div>
            <div className="p-3 rounded bg-background border">
              <div className="text-[11px] text-muted-foreground">نافق عند الوصول</div>
              <div className="text-xl font-bold">{deadInMonth.doa}</div>
            </div>
            <div className="p-3 rounded bg-background border">
              <div className="text-[11px] text-muted-foreground">نافق قبل الذبح</div>
              <div className="text-xl font-bold">{deadInMonth.preDead}</div>
            </div>
            <div className="p-3 rounded bg-background border">
              <div className="text-[11px] text-muted-foreground">طيور مرفوضة</div>
              <div className="text-xl font-bold">{deadInMonth.rejected}</div>
            </div>
            <div className="p-3 rounded bg-background border">
              <div className="text-[11px] text-muted-foreground">نقص بتسوية يدوية</div>
              <div className="text-xl font-bold">{deadInMonth.adjLoss}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Pending low-yield approval banner (managers only) */}
      {isExecManager && pendingApprovalBatches.length > 0 && (
        <Card className="mb-4 border-amber-500/50 bg-amber-50/60 dark:bg-amber-950/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="w-5 h-5" />
              موافقات تصافي منخفض بانتظارك ({pendingApprovalBatches.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {pendingApprovalBatches.map(b => (
              <div key={b.id} className="flex flex-wrap items-center justify-between gap-2 p-3 bg-background rounded border">
                <div className="text-sm">
                  <b>{b.batch_number}</b> · {b.slaughter_date} · طيور: {b.birds_slaughtered} ·
                  وزن حي: {Number(b.total_live_weight_kg).toFixed(1)} كجم ·
                  لحم: {Number(b.total_meat_kg || 0).toFixed(1)} كجم ·
                  <span className="text-red-600 font-bold mx-1">تصافي {Number(b.actual_yield_pct || 0).toFixed(1)}%</span>
                </div>
                <div className="flex gap-2">
                  <Input
                    placeholder="ملاحظة (اختياري)"
                    className="h-8 w-48 text-xs"
                    onChange={e => setApprovalNote(e.target.value)}
                  />
                  <Button size="sm" onClick={() => approveLowYield(b)} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                    <CheckCircle2 className="w-4 h-4 ml-1" />موافقة وتحويل
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => rejectLowYield(b)}>رفض</Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="daily" dir="rtl">
        <div className="w-full overflow-x-auto -mx-1 px-1 mb-2">
          <TabsList className="inline-flex w-max min-w-full gap-1 h-auto flex-wrap md:flex-nowrap">
            <TabsTrigger value="daily" className="text-xs md:text-sm whitespace-nowrap">التقرير اليومي</TabsTrigger>
            <TabsTrigger value="batches" className="text-xs md:text-sm whitespace-nowrap">دفعات الذبح</TabsTrigger>
            <TabsTrigger value="receipts" className="text-xs md:text-sm whitespace-nowrap">استلام حي</TabsTrigger>
            <TabsTrigger value="transfers" className="text-xs md:text-sm whitespace-nowrap">توزيع الفروع</TabsTrigger>
            <TabsTrigger value="warehouse-log" className="text-xs md:text-sm whitespace-nowrap gap-1"><Truck className="w-3 h-3" />سجل المخازن</TabsTrigger>
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
                workers={workers as any}
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
                        {b.status === "completed" && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => exportBatchPDF(b)} title="طباعة / تصدير PDF" className="text-red-600 hover:bg-red-50"><Printer className="w-4 h-4" /></Button>
                            <Button size="sm" variant="outline" onClick={() => exportBatchExcel(b)} title="تصدير Excel" className="text-emerald-600 hover:bg-emerald-50"><FileSpreadsheet className="w-4 h-4" /></Button>
                            {canManageBatch && (
                              <>
                                <Button size="sm" variant="outline" onClick={() => openSendDialog(b, "main")} title="إرسال التقسيمة إلى المخزن الرئيسي" className="text-primary hover:bg-primary/10">
                                  <Truck className="w-4 h-4 ml-1" />للمخزن الرئيسي
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => openSendDialog(b, "meat_factory")} title="إرسال التقسيمة إلى مصنع اللحوم" className="text-orange-600 hover:bg-orange-50">
                                  <Truck className="w-4 h-4 ml-1" />لمصنع اللحوم
                                </Button>
                              </>
                            )}
                          </>
                        )}

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

          {/* Partial transfer dialog: pick how much of each cut to send, remainder stays for the other destination */}
          <Dialog open={!!confirmSendBatch} onOpenChange={(o) => { if (!o) { setConfirmSendBatch(null); setPartialQty({}); } }}>
            <DialogContent dir="rtl" className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  توريد التقسيمة إلى {sendDestination === "meat_factory" ? "مصنع اللحوم" : "المخزن الرئيسي"}
                </DialogTitle>
              </DialogHeader>
              {confirmSendBatch && (() => {
                const rows = outputs.filter(o =>
                  o.batch_id === confirmSendBatch.id &&
                  (o.received_status || "pending") !== "received" &&
                  (o.quality_status || "accepted") === "accepted" &&
                  Number(o.actual_weight_kg) > 0
                );
                const totalAvail = rows.reduce((s, r) => s + Number(r.actual_weight_kg || 0), 0);
                const totalSelected = rows.reduce((s, r) => s + (Number(partialQty[r.id]) || 0), 0);
                return (
                  <div className="space-y-3 text-sm">
                    <div className="bg-muted/50 p-3 rounded text-xs leading-6">
                      دفعة <b>{confirmSendBatch.batch_number}</b> — المتبقي للتوريد: <b>{totalAvail.toFixed(2)} كجم</b>.
                      أدخل الكمية المراد توريدها إلى <b>{sendDestination === "meat_factory" ? "مصنع اللحوم" : "المخزن الرئيسي"}</b> لكل صنف. الباقي يبقى في الدفعة ويمكن توريده للجهة الأخرى لاحقًا.
                    </div>
                    {rows.length === 0 ? (
                      <div className="text-center text-muted-foreground py-6">لا توجد أصناف متاحة للتوريد — كل المخرجات تم توريدها سابقًا.</div>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>الصنف</TableHead>
                            <TableHead className="text-center">المتاح (كجم)</TableHead>
                            <TableHead className="text-center w-40">للتوريد الآن (كجم)</TableHead>
                            <TableHead className="text-center">إجراء</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {rows.map(r => {
                            const max = Number(r.actual_weight_kg) || 0;
                            return (
                              <TableRow key={r.id}>
                                <TableCell className="font-medium">{r.cut_name_ar}</TableCell>
                                <TableCell className="text-center">{max.toFixed(2)}</TableCell>
                                <TableCell className="text-center">
                                  <Input
                                    type="number" min={0} max={max} step="0.01"
                                    value={partialQty[r.id] ?? ""}
                                    onChange={e => setPartialQty(p => ({ ...p, [r.id]: e.target.value }))}
                                    className="h-8 text-center"
                                  />
                                </TableCell>
                                <TableCell className="text-center">
                                  <div className="flex gap-1 justify-center">
                                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setPartialQty(p => ({ ...p, [r.id]: String(max) }))}>الكل</Button>
                                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setPartialQty(p => ({ ...p, [r.id]: "0" }))}>صفر</Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                          <TableRow>
                            <TableCell className="font-bold">الإجمالي</TableCell>
                            <TableCell className="text-center font-bold">{totalAvail.toFixed(2)}</TableCell>
                            <TableCell className="text-center font-bold text-primary">{totalSelected.toFixed(2)}</TableCell>
                            <TableCell></TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    )}
                  </div>
                );
              })()}
              <DialogFooter className="gap-2">
                <Button variant="outline" disabled={sendingBatch} onClick={() => { setConfirmSendBatch(null); setPartialQty({}); }}>إلغاء</Button>
                <Button
                  disabled={sendingBatch}
                  onClick={() => confirmSendBatch && sendBatchToWarehouse(confirmSendBatch, sendDestination)}
                  className="bg-gradient-to-r from-primary to-accent"
                >
                  {sendingBatch ? "جاري التوريد..." : "تأكيد التوريد + طباعة الإذن"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
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
                  <TableHead>تكلفة (إجمالي)</TableHead><TableHead>نافق</TableHead><TableHead>الحالة</TableHead><TableHead>الطيور</TableHead><TableHead>إجراءات</TableHead>{canEditReceiptData && <TableHead>تعديل</TableHead>}
                </TableRow></TableHeader>
                <TableBody>
                  {receipts.filter(r => (!receiptDateFrom || r.receipt_date >= receiptDateFrom) && (!receiptDateTo || r.receipt_date <= receiptDateTo)).map(r => {
                    const recBirds = birds.filter(b => b.receipt_id === r.id);
                    const totalCost = recBirds.reduce((s, b) => s + Number(b.purchase_cost || 0) + Number(b.feed_cost || 0), 0) || Number(r.total_cost || 0);
                    return (
                      <TableRow key={r.id} className="hover:bg-primary/5">
                        <TableCell className="font-mono text-xs">
                          <button
                            type="button"
                            onClick={() => setDetailReceipt(r)}
                            className="text-primary hover:underline font-semibold"
                            title="عرض التفاصيل والطباعة والتصدير"
                          >
                            {r.receipt_number}
                          </button>
                        </TableCell>

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
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="sm" variant="outline" className="gap-1" title="فاتورة الشراء">
                                <ReceiptIcon className="w-3.5 h-3.5" />
                                <MoreHorizontal className="w-3 h-3" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="min-w-[180px]">
                              <DropdownMenuLabel className="text-xs">{r.receipt_number}</DropdownMenuLabel>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => setDetailReceipt(r)}>
                                <ReceiptIcon className="w-4 h-4 ml-2" /> عرض فاتورة الشراء
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => exportReceiptPDF(r)} className="text-red-600">
                                <Printer className="w-4 h-4 ml-2" /> طباعة / PDF
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => exportReceiptExcel(r)} className="text-emerald-700">
                                <FileSpreadsheet className="w-4 h-4 ml-2" /> تصدير Excel
                              </DropdownMenuItem>
                              {isExecManager && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem onClick={() => deleteReceipt(r)} className="text-destructive">
                                    <Trash2 className="w-4 h-4 ml-2" /> حذف القسيمة
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                        {canEditReceiptData && (
                          <TableCell>
                            <Button size="sm" variant="secondary" onClick={() => { setEditReceipt(r); setEditReceiptForm({}); }} title="تعديل بيانات الدفعة">
                              <SettingsIcon className="w-3 h-3 ml-1" />تعديل
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                  {!receipts.length && <TableRow><TableCell colSpan={canEditReceiptData ? 11 : 10} className="text-center text-muted-foreground py-8">لا توجد عمليات استلام</TableCell></TableRow>}
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

          {/* Receipt details dialog with PDF + Excel export */}
          <Dialog open={!!detailReceipt} onOpenChange={(o) => !o && setDetailReceipt(null)}>
            <DialogContent dir="rtl" className="max-w-4xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>تفاصيل الاستلام — {detailReceipt?.receipt_number}</DialogTitle>
              </DialogHeader>
              {detailReceipt && (() => {
                const r = detailReceipt;
                const recBirds = birds.filter(b => b.receipt_id === r.id);
                const totalCost = recBirds.reduce((s, b) => s + Number(b.purchase_cost || 0) + Number(b.feed_cost || 0), 0) || Number(r.total_cost || 0);
                return (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                      <div className="p-2 bg-muted/40 rounded"><div className="text-xs text-muted-foreground">التاريخ</div><b>{r.receipt_date}</b></div>
                      <div className="p-2 bg-muted/40 rounded"><div className="text-xs text-muted-foreground">المصدر</div><b>{r.source_type === "internal_farm" ? "🏡 داخلي" : "🚚 خارجي"}</b></div>
                      <div className="p-2 bg-muted/40 rounded"><div className="text-xs text-muted-foreground">اسم المورد</div><b>{r.source_name || "-"}</b></div>
                      <div className="p-2 bg-muted/40 rounded"><div className="text-xs text-muted-foreground">الحالة</div><b>{r.status}</b></div>
                      <div className="p-2 bg-primary/10 rounded"><div className="text-xs text-muted-foreground">عدد الطيور</div><b>{r.bird_count}</b></div>
                      <div className="p-2 bg-primary/10 rounded"><div className="text-xs text-muted-foreground">الوزن الإجمالي</div><b>{Number(r.total_weight_kg).toFixed(1)} كجم</b></div>
                      <div className="p-2 bg-primary/10 rounded"><div className="text-xs text-muted-foreground">متوسط الوزن</div><b>{Number(r.avg_weight_kg || 0).toFixed(2)} كجم</b></div>
                      <div className="p-2 bg-red-500/10 rounded"><div className="text-xs text-muted-foreground">نافق عند الوصول</div><b className="text-red-600">{r.dead_on_arrival}</b></div>
                      <div className="p-2 bg-emerald-500/10 rounded"><div className="text-xs text-muted-foreground">السعر/كجم</div><b>{Number(r.price_per_kg || 0).toFixed(2)} ج.م</b></div>
                      <div className="p-2 bg-emerald-500/10 rounded col-span-2 md:col-span-3"><div className="text-xs text-muted-foreground">إجمالي التكلفة</div><b className="text-emerald-700 text-lg">{totalCost.toFixed(2)} ج.م</b></div>
                    </div>
                    {recBirds.length > 0 && (
                      <div className="overflow-x-auto">
                        <div className="text-sm font-semibold mb-2">تفاصيل الطيور ({recBirds.length})</div>
                        <Table>
                          <TableHeader><TableRow>
                            <TableHead>م</TableHead><TableHead>رقم</TableHead><TableHead>الوزن الحي</TableHead>
                            <TableHead>وزن الذبح</TableHead><TableHead>تكلفة الشراء</TableHead><TableHead>تكلفة العلف</TableHead><TableHead>ملاحظات</TableHead>
                          </TableRow></TableHeader>
                          <TableBody>
                            {recBirds.map((b, i) => (
                              <TableRow key={b.id}>
                                <TableCell>{i + 1}</TableCell>
                                <TableCell>{b.bird_index}</TableCell>
                                <TableCell>{Number(b.live_weight_kg || 0).toFixed(2)}</TableCell>
                                <TableCell>{Number(b.slaughter_weight_kg || 0).toFixed(2)}</TableCell>
                                <TableCell>{Number(b.purchase_cost || 0).toFixed(2)}</TableCell>
                                <TableCell>{Number(b.feed_cost || 0).toFixed(2)}</TableCell>
                                <TableCell className="text-xs">{b.notes || "-"}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </div>
                );
              })()}
              <DialogFooter className="gap-2 flex-row">
                {detailReceipt && (
                  <>
                    <Button variant="outline" onClick={() => exportReceiptPDF(detailReceipt)} className="text-red-600 hover:bg-red-50">
                      <Printer className="w-4 h-4 ml-1" />طباعة / PDF
                    </Button>
                    <Button variant="outline" onClick={() => exportReceiptExcel(detailReceipt)} className="text-emerald-600 hover:bg-emerald-50">
                      <FileSpreadsheet className="w-4 h-4 ml-1" />تصدير Excel
                    </Button>
                    <Button variant="ghost" onClick={() => { setBirdsReceiptId(detailReceipt.id); setDetailReceipt(null); }}>
                      <Bird className="w-4 h-4 ml-1" />إدارة الطيور
                    </Button>
                  </>
                )}
                <Button variant="ghost" onClick={() => setDetailReceipt(null)}>إغلاق</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>






          <Dialog open={!!editReceipt} onOpenChange={(o) => { if (!o) { setEditReceipt(null); setEditReceiptForm({}); } }}>
            <DialogContent dir="rtl" className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>تعديل بيانات الاستلام — {editReceipt?.receipt_number}</DialogTitle>
              </DialogHeader>
              {editReceipt && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div><Label>تاريخ التوريد</Label>
                    <Input type="date" max={todayStr}
                      value={String(editReceiptForm.receipt_date ?? editReceipt.receipt_date)}
                      onChange={e => setEditReceiptForm({ ...editReceiptForm, receipt_date: e.target.value })} />
                  </div>
                  <div><Label>المصدر</Label>
                    <Select value={String(editReceiptForm.source_type ?? editReceipt.source_type)}
                      onValueChange={v => setEditReceiptForm({ ...editReceiptForm, source_type: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="internal_farm">المزرعة الداخلية</SelectItem>
                        <SelectItem value="external_supplier">مورد خارجي</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>اسم المصدر / المورد</Label>
                    <Input value={String(editReceiptForm.source_name ?? editReceipt.source_name ?? "")}
                      onChange={e => setEditReceiptForm({ ...editReceiptForm, source_name: e.target.value })} />
                  </div>
                  <div><Label>عدد الطيور</Label>
                    <Input type="number"
                      value={String(editReceiptForm.bird_count ?? editReceipt.bird_count ?? "")}
                      onChange={e => setEditReceiptForm({ ...editReceiptForm, bird_count: +e.target.value })} />
                  </div>
                  <div><Label>الوزن الإجمالي (كجم)</Label>
                    <Input type="number" step="0.1"
                      value={String(editReceiptForm.total_weight_kg ?? editReceipt.total_weight_kg ?? "")}
                      onChange={e => setEditReceiptForm({ ...editReceiptForm, total_weight_kg: +e.target.value })} />
                  </div>
                  <div><Label>السعر/كجم (ر.س)</Label>
                    <Input type="number" step="0.01"
                      value={String(editReceiptForm.price_per_kg ?? editReceipt.price_per_kg ?? "")}
                      onChange={e => setEditReceiptForm({ ...editReceiptForm, price_per_kg: +e.target.value })} />
                  </div>
                  <div><Label>نافق عند الوصول</Label>
                    <Input type="number"
                      value={String(editReceiptForm.dead_on_arrival ?? editReceipt.dead_on_arrival ?? "")}
                      onChange={e => setEditReceiptForm({ ...editReceiptForm, dead_on_arrival: +e.target.value })} />
                  </div>
                  <div className="sm:col-span-2 text-xs bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-300 p-2 rounded">
                    ⚠️ هذا التعديل متاح فقط للمدير العام والمدير التنفيذي. تغيير التاريخ يُسجَّل تلقائيًا في سجل التدقيق. أوزان الطيور المنفصلة تُعدَّل من شاشة "الطيور".
                  </div>
                </div>
              )}
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => { setEditReceipt(null); setEditReceiptForm({}); }}>إلغاء</Button>
                <Button onClick={saveEditedReceipt}><Save className="w-4 h-4 ml-1" />حفظ التعديلات</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>

        {/* ========== TRANSFERS ========== */}
        <TabsContent value="transfers">
          <TransfersTab transfers={transfers} branches={branches} batches={batches} onStatus={updateTransferStatus} />
        </TabsContent>

        {/* ========== WAREHOUSE TRANSFERS LOG (Main + Meat Factory) ========== */}
        <TabsContent value="warehouse-log">
          <WarehouseTransfersLog
            outputs={outputs}
            batches={batches}
            warehouses={warehouses}
            onPrint={printTransferNote}
          />
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
                  <TableHead>% من الوزن الحي</TableHead><TableHead>كجم/نعامة</TableHead><TableHead>وزن العبوة</TableHead><TableHead>الفئة</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {yields.map(y => (
                    <TableRow key={y.id}>
                      <TableCell className="font-semibold">{y.cut_name_ar}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{y.cut_name_en}</TableCell>
                      <TableCell className="font-mono text-xs">{y.barcode}</TableCell>
                      <TableCell><Badge className="bg-primary/20 text-primary">{Number(y.standard_yield_pct).toFixed(2)}%</Badge></TableCell>
                      <TableCell>{y.standard_kg_per_bird != null ? <Badge variant="secondary">{Number(y.standard_kg_per_bird).toFixed(2)} كجم</Badge> : <span className="text-muted-foreground text-xs">—</span>}</TableCell>
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

      {/* Adjust Live Stock Dialog */}
      <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>تعديل رصيد النعام القائم</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="p-3 rounded bg-muted/40 text-xs leading-relaxed">
              الرصيد المحسوب حاليًا: <b className="text-primary">{liveBalance}</b> نعامة.
              <br />هذا التعديل يُسجَّل كقيد افتتاحي/تسوية يدوية ولا يحذف أي توريد أو دفعة دبح.
            </div>
            <div className="space-y-1">
              <Label>تاريخ التسوية</Label>
              <Input type="date" value={adjustForm.adjustment_date}
                onChange={(e) => setAdjustForm(f => ({ ...f, adjustment_date: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>الرصيد الجديد (عدد النعام القائم)</Label>
              <Input type="number" min={0} value={adjustForm.new_balance}
                onChange={(e) => setAdjustForm(f => ({ ...f, new_balance: Number(e.target.value) }))} />
              <p className="text-[11px] text-muted-foreground">
                الفرق: <b className={Number(adjustForm.new_balance) - liveBalance >= 0 ? "text-emerald-600" : "text-red-600"}>
                  {Number(adjustForm.new_balance) - liveBalance >= 0 ? "+" : ""}{Number(adjustForm.new_balance) - liveBalance}
                </b>
              </p>
            </div>
            <div className="space-y-1">
              <Label>سبب التعديل *</Label>
              <Textarea rows={3} placeholder="مثال: قيد افتتاحي لشهر 6 / تسوية جرد فعلي..."
                value={adjustForm.reason}
                onChange={(e) => setAdjustForm(f => ({ ...f, reason: e.target.value }))} />
            </div>
            {adjustments.length > 0 && (
              <div className="border-t pt-2">
                <p className="text-xs font-semibold mb-1">آخر التسويات:</p>
                <div className="max-h-40 overflow-auto space-y-1">
                  {adjustments.slice(0, 5).map(a => (
                    <div key={a.id} className="text-[11px] flex justify-between gap-2 p-1.5 rounded bg-muted/30">
                      <span>{a.adjustment_date} — <b>{a.new_balance}</b> ({a.delta >= 0 ? "+" : ""}{a.delta})</span>
                      <span className="text-muted-foreground truncate max-w-[180px]" title={a.reason || ""}>{a.reason}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustOpen(false)}>إلغاء</Button>
            <Button onClick={saveLiveStockAdjustment}>حفظ التسوية</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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

// ===================== Warehouse Transfers Log (Main + Meat Factory) =====================
const WarehouseTransfersLog = ({ outputs, batches, warehouses, onPrint }: {
  outputs: Output[];
  batches: Batch[];
  warehouses: { id: string; name: string }[];
  onPrint: (b: Batch, destLabel: string, lines: { name: string; qty: number }[], totalKg: number) => void;
}) => {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Identify main warehouse vs meat factory by name
  const mainWh = warehouses.find(w => /رئيسي/.test(w.name));
  const meatWh = warehouses.find(w => /مصنع.*لحوم|لحوم/.test(w.name));

  // Build the log: every output that has been received into a warehouse
  const received = useMemo(() => {
    return outputs
      .filter(o => o.received_status === "received" && o.received_warehouse_id)
      .filter(o => {
        if (!o.received_at) return true;
        const d = o.received_at.slice(0, 10);
        if (dateFrom && d < dateFrom) return false;
        if (dateTo && d > dateTo) return false;
        return true;
      })
      .sort((a, b) => (b.received_at || "").localeCompare(a.received_at || ""));
  }, [outputs, dateFrom, dateTo]);

  const mainRows = received.filter(o => mainWh && o.received_warehouse_id === mainWh.id);
  const meatRows = received.filter(o => meatWh && o.received_warehouse_id === meatWh.id);

  // Group by batch for the "print whole shipment" button
  const groupByBatch = (rows: Output[]) => {
    const m = new Map<string, Output[]>();
    rows.forEach(r => {
      const arr = m.get(r.batch_id) || [];
      arr.push(r);
      m.set(r.batch_id, arr);
    });
    return Array.from(m.entries());
  };

  const renderSection = (title: string, rows: Output[], destLabel: string, colorClass: string) => {
    const totalKg = rows.reduce((s, r) => s + Number(r.actual_weight_kg || 0), 0);
    const totalValue = rows.reduce((s, r) => s + Number(r.actual_weight_kg || 0) * Number(r.unit_price || 0), 0);
    const groups = groupByBatch(rows);

    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Truck className={`w-5 h-5 ${colorClass}`} />
            <CardTitle className="text-base">{title}</CardTitle>
          </div>
          <div className="flex items-center gap-3 text-xs flex-wrap">
            <Badge variant="outline" className="text-sm">عدد الأصناف: <b className="mr-1">{rows.length}</b></Badge>
            <Badge variant="outline" className="text-sm">إجمالي الوزن: <b className="mr-1">{totalKg.toFixed(1)} كجم</b></Badge>
            <Badge variant="outline" className="text-sm">إجمالي القيمة: <b className="mr-1">{totalValue.toFixed(0)} ج.م</b></Badge>
          </div>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="text-center text-muted-foreground py-8 text-sm">لا توجد توريدات لهذه الجهة في المدى المحدد</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead className="text-xs">تاريخ الاستلام</TableHead>
                  <TableHead className="text-xs">رقم الدفعة</TableHead>
                  <TableHead className="text-xs">الصنف</TableHead>
                  <TableHead className="text-xs">الكمية (كجم)</TableHead>
                  <TableHead className="text-xs">السعر/كجم</TableHead>
                  <TableHead className="text-xs">الإجمالي</TableHead>
                  <TableHead className="text-xs">طباعة</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {rows.map(o => {
                    const b = batches.find(x => x.id === o.batch_id);
                    const qty = Number(o.actual_weight_kg || 0);
                    const price = Number(o.unit_price || 0);
                    return (
                      <TableRow key={o.id} className="hover:bg-muted/50">
                        <TableCell className="text-xs">{o.received_at ? formatDate(o.received_at) : "—"}</TableCell>
                        <TableCell className="font-mono text-xs">{b?.batch_number || "—"}</TableCell>
                        <TableCell className="font-semibold">{o.cut_name_ar}</TableCell>
                        <TableCell>{qty.toFixed(2)}</TableCell>
                        <TableCell>{price.toFixed(0)}</TableCell>
                        <TableCell className="font-semibold">{(qty * price).toFixed(0)}</TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-red-600 hover:bg-red-50"
                            title="إعادة طباعة إذن التوريد لهذا الصنف"
                            onClick={() => b && onPrint(b, destLabel, [{ name: o.cut_name_ar, qty }], qty)}
                          >
                            <Printer className="w-3.5 h-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {groups.length > 0 && (
            <div className="mt-4 pt-3 border-t">
              <div className="text-xs font-semibold mb-2 text-muted-foreground">📦 طباعة إذن توريد كامل لكل دفعة:</div>
              <div className="flex flex-wrap gap-2">
                {groups.map(([batchId, items]) => {
                  const b = batches.find(x => x.id === batchId);
                  if (!b) return null;
                  const total = items.reduce((s, x) => s + Number(x.actual_weight_kg || 0), 0);
                  const lines = items.map(x => ({ name: x.cut_name_ar, qty: Number(x.actual_weight_kg || 0) }));
                  return (
                    <Button
                      key={batchId}
                      size="sm"
                      variant="outline"
                      className="text-red-600 hover:bg-red-50 gap-1"
                      onClick={() => onPrint(b, destLabel, lines, total)}
                    >
                      <Printer className="w-3.5 h-3.5" />
                      <span className="font-mono text-xs">{b.batch_number}</span>
                      <span className="text-xs text-muted-foreground">({total.toFixed(1)} كجم)</span>
                    </Button>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-4">
      {/* Info banner explaining the approval flow */}
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="p-4 text-sm space-y-1.5">
          <div className="flex items-start gap-2">
            <ShieldCheck className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
            <div>
              <b className="text-primary">كيف تصل الكميات لمسؤول المخزن الرئيسي؟</b>
              <p className="text-muted-foreground mt-1">
                بمجرد ضغطك زر <b>«للمخزن الرئيسي»</b> أو <b>«لمصنع اللحوم»</b> من شاشة دفعات الذبح:
              </p>
              <ul className="list-disc pr-5 mt-1 space-y-1 text-muted-foreground text-xs">
                <li>تُضاف الكميات <b className="text-foreground">تلقائياً</b> إلى مخزون الجهة المستلِمة (المخزن الرئيسي أو مصنع اللحوم).</li>
                <li>يراها مسؤول المخزن فوراً في صفحة <b className="text-foreground">«المخازن» ← المخزن الرئيسي ← الأصناف</b> وفي <b className="text-foreground">«حركات المخزون»</b> برمز "استلام من دفعة ذبح رقم XXX".</li>
                <li>تُسجَّل أيضاً في <b className="text-foreground">«التدقيق»</b> داخل صفحة المسلخ.</li>
                <li>لا تحتاج موافقة منفصلة لأن من ينفّذ التحويل يكون مدير المسلخ أو المدير العام أو أمين مخزن مفوّض.</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Date filter */}
      <Card>
        <CardContent className="p-3 flex flex-wrap items-end gap-2">
          <div>
            <Label className="text-xs">من تاريخ</Label>
            <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-9 w-40" />
          </div>
          <div>
            <Label className="text-xs">إلى تاريخ</Label>
            <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-9 w-40" />
          </div>
          {(dateFrom || dateTo) && (
            <Button variant="ghost" size="sm" onClick={() => { setDateFrom(""); setDateTo(""); }}>مسح الفلتر</Button>
          )}
        </CardContent>
      </Card>

      {renderSection(
        `📦 توريدات المخزن الرئيسي${mainWh ? ` (${mainWh.name})` : ""}`,
        mainRows,
        mainWh?.name || "المخزن الرئيسي",
        "text-primary",
      )}

      {renderSection(
        `🥩 توريدات مصنع اللحوم${meatWh ? ` (${meatWh.name})` : ""}`,
        meatRows,
        meatWh?.name || "مصنع اللحوم",
        "text-orange-600",
      )}
    </div>
  );
};
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
