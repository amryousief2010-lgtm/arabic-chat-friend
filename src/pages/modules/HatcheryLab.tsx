import { useMemo, useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  FlaskConical, Egg, Bird, Plus, Search, AlertTriangle, FileText, Wallet,
  Settings as SettingsIcon, Printer, FileSpreadsheet, X, Activity, TrendingUp, ClipboardCheck,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { format } from "date-fns";
import { openPrintWindow, escapeHtml, fmtNum, fmtDate } from "@/lib/printPdf";
import * as XLSX from "xlsx";
import HatcheryClientMetrics from "@/components/hatchery/HatcheryClientMetrics";
import { printBatchStatement } from "@/lib/hatcheryStatements";
import HatcheryGroupedBatches from "@/components/hatchery/HatcheryGroupedBatches";


const today = () => format(new Date(), "yyyy-MM-dd");

// ---------- Types ----------
type Lot = any; type Batch = any; type Invoice = any; type Settings = any;

const fmtEGP = (v: any) => `${fmtNum(v, 2)} ج.م`;

// ============================================================
// Main Page
// ============================================================
const HatcheryLab = () => {
  const { isGeneralManager, isExecutiveManager, isHatcheryManager, isAccountant } = useAuth();
  const canManage = isGeneralManager || isExecutiveManager || isHatcheryManager;
  const canBill = canManage || isAccountant;
  const qc = useQueryClient();
  const [tab, setTab] = useState("dashboard");

  // ----- Queries -----
  const { data: settings } = useQuery<Settings>({
    queryKey: ["hatchery_pricing_settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hatchery_pricing_settings" as any)
        .select("*").order("updated_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: batches = [] } = useQuery<Batch[]>({
    queryKey: ["hatchery_batches_full"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_hatchery_batches_full" as any)
        .select("*").order("entry_date", { ascending: false }).limit(500);
      if (error) throw error;
      return (data as any) || [];
    },
  });

  const { data: lots = [] } = useQuery<Lot[]>({
    queryKey: ["hatchery_lots"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hatchery_batch_lots" as any)
        .select("*").order("created_at", { ascending: false }).limit(2000);
      if (error) throw error;
      return (data as any) || [];
    },
  });

  const { data: clients = [] } = useQuery<any[]>({
    queryKey: ["hatch_customers_all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hatch_customers" as any)
        .select("id,name").order("name");
      if (error) throw error;
      return (data as any) || [];
    },
  });

  const { data: invoices = [] } = useQuery<Invoice[]>({
    queryKey: ["hatchery_client_invoices"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hatchery_client_invoices" as any)
        .select("*").order("issued_at", { ascending: false });
      if (error) throw error;
      return (data as any) || [];
    },
  });

  const { data: kpis } = useQuery<any>({
    queryKey: ["hatchery_kpis"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_hatchery_dashboard_kpis" as any).select("*").maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: balances = [] } = useQuery<any[]>({
    queryKey: ["hatchery_balances"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_hatchery_client_balances" as any).select("*").order("remaining_amount", { ascending: false });
      if (error) throw error;
      return (data as any) || [];
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["hatchery_batches_full"] });
    qc.invalidateQueries({ queryKey: ["hatchery_lots"] });
    qc.invalidateQueries({ queryKey: ["hatchery_client_invoices"] });
    qc.invalidateQueries({ queryKey: ["hatchery_kpis"] });
    qc.invalidateQueries({ queryKey: ["hatchery_balances"] });
  };

  return (
    <DashboardLayout>
      <Header title="معمل التفريخ والحضانات" subtitle="نظام كامل: دفعات • كشف • هاتشر • حضانات • فواتير" />
      <div className="p-4 max-w-7xl mx-auto space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <a href="/hatchery/import-batches/review">
              <ClipboardCheck className="w-4 h-4 ml-1" /> مراجعة دفعات المعمل المستوردة
            </a>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <a href="/hatchery/import-batches">
              <FileSpreadsheet className="w-4 h-4 ml-1" /> استيراد دفعات المعمل
            </a>
          </Button>
        </div>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex flex-wrap h-auto">
            <TabsTrigger value="dashboard"><Activity className="w-4 h-4 ml-1" />الداشبورد</TabsTrigger>
            <TabsTrigger value="batches"><FlaskConical className="w-4 h-4 ml-1" />الدفعات</TabsTrigger>
            <TabsTrigger value="invoices"><FileText className="w-4 h-4 ml-1" />الفواتير</TabsTrigger>
            <TabsTrigger value="balances"><Wallet className="w-4 h-4 ml-1" />مديونية العملاء</TabsTrigger>
            <TabsTrigger value="settings"><SettingsIcon className="w-4 h-4 ml-1" />الإعدادات</TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard">
            <DashboardTab kpis={kpis} batches={batches} settings={settings} setTab={setTab} />
          </TabsContent>

          <TabsContent value="batches">
            <BatchesTab lots={lots} clients={clients} settings={settings}
              canManage={canManage} onRefresh={refresh} />
          </TabsContent>

          <TabsContent value="invoices">
            <InvoicesTab invoices={invoices} canBill={canBill} onRefresh={refresh} />
          </TabsContent>

          <TabsContent value="balances">
            <BalancesTab balances={balances} />
          </TabsContent>

          <TabsContent value="settings">
            <SettingsTab settings={settings} canManage={canManage} onRefresh={refresh} />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
};

// ============================================================
// Dashboard Tab
// ============================================================
const KCard = ({ label, value, sub, color = "from-primary to-accent", icon: Icon = FlaskConical }: any) => (
  <Card className="relative overflow-hidden border-0 shadow-md">
    <div className={`absolute inset-0 bg-gradient-to-br ${color}`} />
    <div className="relative p-4 text-white">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs opacity-90">{label}</span>
        <Icon className="w-4 h-4 opacity-80" />
      </div>
      <p className="text-2xl font-bold">{value}</p>
      {sub && <p className="text-[11px] opacity-80 mt-1">{sub}</p>}
    </div>
  </Card>
);

import HatcheryAlerts from "@/components/hatchery/HatcheryAlerts";

const DashboardTab = ({ kpis, batches, settings, setTab }: any) => {
  const k = kpis || {};
  const dueCandling = useMemo(() =>
    batches.filter((b: any) => b.status === "incubating" && new Date(b.candle_due_date) <= new Date()), [batches]);
  const dueHatcher = useMemo(() =>
    batches.filter((b: any) => ["incubating", "candled"].includes(b.status) && new Date(b.hatcher_due_date) <= new Date()), [batches]);

  return (
    <div className="space-y-4">
      <HatcheryAlerts
        settings={settings}
        onNavigate={(tabName: string, filter?: string) => {
          if (filter) sessionStorage.setItem("hatchery_batch_filter", filter);
          setTab(tabName);
        }}
      />

      {(dueCandling.length > 0 || dueHatcher.length > 0) && (
        <Alert className="bg-amber-50 dark:bg-amber-950 border-amber-300">
          <AlertTriangle className="w-4 h-4 text-amber-600" />
          <AlertTitle>تنبيهات الدفعات</AlertTitle>
          <AlertDescription>
            {dueCandling.length > 0 && <div>• {dueCandling.length} دفعة وصلت ليوم الكشف ({settings?.candling_day || 15} يوم)</div>}
            {dueHatcher.length > 0 && <div>• {dueHatcher.length} دفعة وصلت ليوم النقل للهاتشر ({settings?.transfer_to_hatcher_day || 39} يوم)</div>}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KCard label="إجمالي البيض في المعمل" value={fmtNum(k.eggs_in_incubators)} icon={Egg} color="from-orange-500 to-amber-600" />
        <KCard label="بيض نعام العاصمة" value={fmtNum(k.internal_eggs)} icon={Egg} color="from-purple-600 to-violet-700" />
        <KCard label="بيض العملاء" value={fmtNum(k.external_eggs)} icon={Egg} color="from-cyan-500 to-blue-600" />
        <KCard label="نسبة الفقس" value={`${k.hatch_rate_pct || 0}%`} icon={TrendingUp} color="from-emerald-500 to-teal-600" />
        <KCard label="تنتظر الكشف" value={fmtNum(k.batches_awaiting_candling)} icon={AlertTriangle} color="from-yellow-500 to-orange-500" />
        <KCard label="تنتظر النقل للهاتشر" value={fmtNum(k.batches_awaiting_hatcher)} icon={AlertTriangle} color="from-pink-500 to-rose-600" />
        <KCard label="في الهاتشر" value={fmtNum(k.in_hatcher)} icon={Bird} color="from-indigo-500 to-blue-700" />
        <KCard label="في الحضانات" value={fmtNum(k.in_brooding)} icon={Bird} color="from-fuchsia-500 to-pink-600" />
        <KCard label="كتاكيت هذا الشهر" value={fmtNum(k.chicks_this_month)} icon={Bird} color="from-emerald-600 to-green-700" />
        <KCard label="إجمالي الفواتير" value={fmtEGP(k.invoices_total)} icon={FileText} color="from-slate-600 to-slate-800" />
        <KCard label="المدفوع" value={fmtEGP(k.invoices_paid)} icon={Wallet} color="from-green-600 to-emerald-700" />
        <KCard label="المتبقي" value={fmtEGP(k.invoices_remaining)} icon={Wallet} color="from-red-500 to-red-700" />
      </div>

      <HatcheryClientMetrics />
    </div>
  );
};

// ============================================================
// Batches Tab
// ============================================================
const statusLabels: Record<string, string> = {
  incubating: "في التفريخ", candled: "تم الكشف", in_hatcher: "في الهاتشر",
  in_brooding: "في الحضانات", closed: "مغلقة", cancelled: "ملغاة",
};
const statusColors: Record<string, string> = {
  incubating: "bg-blue-500", candled: "bg-amber-500", in_hatcher: "bg-purple-500",
  in_brooding: "bg-fuchsia-500", closed: "bg-emerald-600", cancelled: "bg-gray-500",
};

const IMPORT_LOG_ID = "94124ef6-50c0-4054-8e7e-df8c4f286433";

const hatchStatusLabel: Record<string, string> = {
  pending: "في الانتظار",
  received: "تم الاستلام",
  incubating: "في الكشف",
  completed: "مكتملة",
};
const hatchStatusColor: Record<string, string> = {
  pending: "bg-slate-500",
  received: "bg-blue-500",
  incubating: "bg-amber-500",
  completed: "bg-emerald-600",
};

// ---- Stage + dates helpers ----
const addDays = (d: string | Date, n: number) => {
  const dt = typeof d === "string" ? new Date(d) : new Date(d.getTime());
  dt.setDate(dt.getDate() + n);
  return dt.toISOString().slice(0, 10);
};
const daysDiff = (a?: string | null, b?: string | null) => {
  if (!a || !b) return null;
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.round(ms / 86400000);
};

type StageKey =
  | "awaiting_entry" | "in_machine" | "awaiting_candle1" | "after_candle1"
  | "awaiting_candle2" | "after_candle2" | "in_hatcher" | "completed" | "overdue";

const STAGE_META: Record<StageKey, { label: string; color: string }> = {
  awaiting_entry:   { label: "بانتظار الدخول",  color: "bg-slate-500" },
  in_machine:       { label: "داخل الماكينة",    color: "bg-blue-500" },
  awaiting_candle1: { label: "بانتظار الكشف الأول", color: "bg-yellow-500" },
  after_candle1:    { label: "بعد الكشف الأول",  color: "bg-cyan-600" },
  awaiting_candle2: { label: "بانتظار الكشف الثاني", color: "bg-yellow-600" },
  after_candle2:    { label: "بعد الكشف الثاني",  color: "bg-indigo-500" },
  in_hatcher:       { label: "في الهاتشر",       color: "bg-purple-500" },
  completed:        { label: "مكتملة / خرجت",    color: "bg-emerald-600" },
  overdue:          { label: "متأخرة عن الإجراء", color: "bg-red-600" },
};

function computeStage(b: any, settings: any): { stage: StageKey; expCandle1?: string; expCandle2?: string; expExit?: string; daysIn: number | null; overdueReason?: string; isSoon?: boolean } {
  const candleDay = settings?.candling_day || 15;
  const hatcherDay = settings?.transfer_to_hatcher_day || 39;
  const candle2Default = Math.max(candleDay + 10, 25);
  const todayStr = new Date().toISOString().slice(0, 10);

  const entry = b.entry_date || b.receive_date || null;
  const expCandle1 = entry ? addDays(entry, candleDay) : undefined;
  const expCandle2 = entry ? addDays(entry, candle2Default) : undefined;
  const expExit = entry ? addDays(entry, hatcherDay) : undefined;
  const daysIn = entry ? daysDiff(entry, todayStr) : null;

  if (b.status === "completed" || b.exit_date) {
    return { stage: "completed", expCandle1, expCandle2, expExit, daysIn };
  }
  if (b.status === "in_hatcher") {
    return { stage: "in_hatcher", expCandle1, expCandle2, expExit, daysIn };
  }
  if (!entry) return { stage: "awaiting_entry", daysIn: null };

  // overdue checks
  const isAfter = (dueDate?: string) => dueDate && todayStr > dueDate;
  const within = (dueDate?: string, days = 3) => {
    if (!dueDate) return false;
    const d = daysDiff(todayStr, dueDate);
    return d !== null && d >= 0 && d <= days;
  };

  // After candle2 → in hatcher (around hatcher day)
  if (b.candle2_date) {
    if (todayStr >= (expExit || "9999-12-31")) {
      // past exit, no exit_date recorded → overdue
      if (isAfter(expExit)) return { stage: "overdue", expCandle1, expCandle2, expExit, daysIn, overdueReason: "تجاوز موعد الخروج" };
    }
    if (daysIn !== null && daysIn >= hatcherDay - 1) {
      return { stage: "in_hatcher", expCandle1, expCandle2, expExit, daysIn, isSoon: within(expExit) };
    }
    return { stage: "after_candle2", expCandle1, expCandle2, expExit, daysIn, isSoon: within(expExit) };
  }
  if (b.candle1_date) {
    if (isAfter(expCandle2)) {
      return { stage: "overdue", expCandle1, expCandle2, expExit, daysIn, overdueReason: "تجاوز موعد الكشف الثاني" };
    }
    return { stage: "awaiting_candle2", expCandle1, expCandle2, expExit, daysIn, isSoon: within(expCandle2) };
  }
  if (isAfter(expCandle1)) {
    return { stage: "overdue", expCandle1, expCandle2, expExit, daysIn, overdueReason: "تجاوز موعد الكشف الأول" };
  }
  if (daysIn !== null && daysIn >= 1) {
    return { stage: "awaiting_candle1", expCandle1, expCandle2, expExit, daysIn, isSoon: within(expCandle1) };
  }
  return { stage: "in_machine", expCandle1, expCandle2, expExit, daysIn };
}

type QuickFilter =
  | "all" | "internal" | "external" | "completed" | "in_progress" | "imported"
  | "candle2_today" | "candle2_3d" | "exit_today" | "exit_3d" | "overdue";

const BatchesTab = ({ lots, clients, settings, canManage, onRefresh }: any) => {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [activeBatch, setActiveBatch] = useState<any>(null);
  const [detailBatch, setDetailBatch] = useState<any>(null);
  const [filter, setFilter] = useState<QuickFilter>("all");
  const [viewMode, setViewMode] = useState<"grouped" | "detailed">("grouped");


  useEffect(() => {
    const f = sessionStorage.getItem("hatchery_batch_filter");
    if (f) {
      const valid: QuickFilter[] = ["all","internal","external","completed","in_progress","imported","candle2_today","candle2_3d","exit_today","exit_3d","overdue"];
      if (valid.includes(f as QuickFilter)) setFilter(f as QuickFilter);
      sessionStorage.removeItem("hatchery_batch_filter");
    }
  }, []);

  // Pull imported / lab batches from hatch_batches (the table the import wrote to)
  const { data: hatchBatches = [] } = useQuery<any[]>({
    queryKey: ["hatch_batches_lab"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hatch_batches")
        .select("id, batch_number, operational_batch_no, receive_date, entry_date, machine, received_eggs, net_eggs, hatched_chicks, hatcher_dead, candle1_date, candle1_fertile, candle1_infertile, candle2_date, candle2_fertile, candle2_dead, exit_date, status, customer_id, notes, created_at, hatch_customers(id,name,customer_type)")
        .order("receive_date", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data as any) || [];
    },
  });

  const { data: importLog } = useQuery<any>({
    queryKey: ["hatch_import_log_ts"],
    queryFn: async () => {
      const { data } = await supabase
        .from("hatch_batch_import_log")
        .select("created_at")
        .eq("id", IMPORT_LOG_ID)
        .maybeSingle();
      return data;
    },
  });

  const importTs = importLog?.created_at ? new Date(importLog.created_at).getTime() : null;
  const todayStr = new Date().toISOString().slice(0, 10);
  const in3days = addDays(todayStr, 3);

  const rows = useMemo(() => {
    return (hatchBatches as any[]).map((b) => {
      const c = b.hatch_customers || {};
      const isInternal = c.customer_type === "internal" || /عاصمة|داخل/.test(c.name || "");
      const createdMs = b.created_at ? new Date(b.created_at).getTime() : 0;
      const isImported = importTs ? Math.abs(createdMs - importTs) <= 60 * 60 * 1000 : false;
      const st = computeStage(b, settings);
      return {
        id: b.id,
        batch_number: b.batch_number,
        op_seq: b.operational_batch_no ?? null,
        receive_date: b.receive_date,
        entry_date: b.entry_date,
        machine: b.machine,
        type: isInternal ? "internal" : "external",
        customer_name: c.name || "—",
        total_eggs: b.received_eggs || 0,
        net_eggs: b.net_eggs || 0,
        chicks: b.hatched_chicks || 0,
        candle1_date: b.candle1_date,
        candle2_date: b.candle2_date,
        exit_date: b.exit_date,
        status: b.status || "pending",
        is_imported: isImported,
        stage: st.stage,
        expCandle1: st.expCandle1,
        expCandle2: st.expCandle2,
        expExit: st.expExit,
        daysIn: st.daysIn,
        isSoon: st.isSoon,
        overdueReason: st.overdueReason,
        _raw: b,
      };
    });
  }, [hatchBatches, importTs, settings]);

  const counts = useMemo(() => {
    const c2Soon = (r: any, d: number) => {
      const target = r.candle2_date || r.expCandle2;
      if (!target || r.status === "completed" || r.exit_date) return false;
      const diff = daysDiff(todayStr, target);
      return diff !== null && diff >= 0 && diff <= d;
    };
    const exSoon = (r: any, d: number) => {
      const target = r.exit_date || r.expExit;
      if (!target || r.status === "completed") return false;
      const diff = daysDiff(todayStr, target);
      return diff !== null && diff >= 0 && diff <= d;
    };
    return {
      all: rows.length,
      internal: rows.filter((r) => r.type === "internal").length,
      external: rows.filter((r) => r.type === "external").length,
      completed: rows.filter((r) => r.stage === "completed").length,
      in_progress: rows.filter((r) => r.stage !== "completed").length,
      imported: rows.filter((r) => r.is_imported).length,
      candle2_today: rows.filter((r) => c2Soon(r, 0)).length,
      candle2_3d: rows.filter((r) => c2Soon(r, 3)).length,
      exit_today: rows.filter((r) => exSoon(r, 0)).length,
      exit_3d: rows.filter((r) => exSoon(r, 3)).length,
      overdue: rows.filter((r) => r.stage === "overdue").length,
    };
  }, [rows, todayStr]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (search && !String(r.batch_number ?? "").toLowerCase().includes(search.toLowerCase()) && !r.customer_name.includes(search)) return false;
      switch (filter) {
        case "internal": return r.type === "internal";
        case "external": return r.type === "external";
        case "completed": return r.stage === "completed";
        case "in_progress": return r.stage !== "completed";
        case "imported": return r.is_imported;
        case "candle2_today": {
          const t = r.candle2_date || r.expCandle2;
          if (!t || r.stage === "completed") return false;
          return t === todayStr;
        }
        case "candle2_3d": {
          const t = r.candle2_date || r.expCandle2;
          if (!t || r.stage === "completed") return false;
          const d = daysDiff(todayStr, t);
          return d !== null && d >= 0 && d <= 3;
        }
        case "exit_today": {
          const t = r.exit_date || r.expExit;
          if (!t || r.stage === "completed") return false;
          return t === todayStr;
        }
        case "exit_3d": {
          const t = r.exit_date || r.expExit;
          if (!t || r.stage === "completed") return false;
          const d = daysDiff(todayStr, t);
          return d !== null && d >= 0 && d <= 3;
        }
        case "overdue": return r.stage === "overdue";
        default: return true;
      }
    });
  }, [rows, search, filter, todayStr]);

  const filterBtn = (key: QuickFilter, label: string, count: number, tone?: string) => (
    <Button
      key={key}
      size="sm"
      variant={filter === key ? "default" : "outline"}
      onClick={() => setFilter(key)}
      className={tone}
    >
      {label} <Badge variant="secondary" className="mr-2 text-[10px]">{count}</Badge>
    </Button>
  );

  const dateCell = (date?: string | null, expected?: string | null, status?: string) => {
    if (date) return <span className="text-xs">{date}</span>;
    if (status === "completed") return <span className="text-xs text-muted-foreground">—</span>;
    if (!expected) return <span className="text-xs text-muted-foreground">—</span>;
    const isPast = expected < todayStr;
    const isSoon = expected >= todayStr && expected <= in3days;
    return (
      <span className={`text-xs ${isPast ? "text-red-600 font-semibold" : isSoon ? "text-orange-600" : "text-muted-foreground"}`}>
        ~{expected}
      </span>
    );
  };

  const groupedStageMeta = {
    ...STAGE_META,
    in_progress: { label: "جارية", color: "bg-blue-500" },
  } as Record<string, { label: string; color: string }>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex gap-1 p-1 bg-muted rounded-lg">
          <Button
            size="sm"
            variant={viewMode === "grouped" ? "default" : "ghost"}
            onClick={() => setViewMode("grouped")}
          >
            عرض مجمع (دفعة تشغيلية)
          </Button>
          <Button
            size="sm"
            variant={viewMode === "detailed" ? "default" : "ghost"}
            onClick={() => setViewMode("detailed")}
          >
            عرض تفصيلي (لكل عميل)
          </Button>
        </div>
        {canManage && (
          <Button onClick={() => setShowNew(true)}><Plus className="w-4 h-4 ml-1" />دفعة جديدة</Button>
        )}
      </div>

      {viewMode === "grouped" ? (
        <>
          <HatcheryGroupedBatches rows={rows} stageMeta={groupedStageMeta} todayStr={todayStr} />
          {showNew && <NewBatchDialog open={showNew} onClose={() => setShowNew(false)} clients={clients} onSaved={() => { setShowNew(false); onRefresh(); }} />}
        </>
      ) : (
      <>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث برقم الدفعة أو اسم العميل..." className="pr-9" />
        </div>
      </div>


      <div className="flex flex-wrap gap-2">
        {filterBtn("all", "الكل", counts.all)}
        {filterBtn("internal", "دفعات العاصمة", counts.internal)}
        {filterBtn("external", "دفعات العملاء", counts.external)}
        {filterBtn("in_progress", "جارية", counts.in_progress)}
        {filterBtn("completed", "مكتملة", counts.completed)}
        {filterBtn("imported", "مستوردة", counts.imported)}
      </div>
      <div className="flex flex-wrap gap-2">
        {filterBtn("candle2_today", "كشف ثاني اليوم", counts.candle2_today)}
        {filterBtn("candle2_3d", "كشف ثاني خلال 3 أيام", counts.candle2_3d)}
        {filterBtn("exit_today", "خروج اليوم", counts.exit_today)}
        {filterBtn("exit_3d", "خروج خلال 3 أيام", counts.exit_3d)}
        {filterBtn("overdue", "متأخرة", counts.overdue)}
      </div>

      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>رقم الدفعة</TableHead>
              <TableHead>العميل</TableHead>
              <TableHead>الماكينة</TableHead>
              <TableHead>الوارد</TableHead>
              <TableHead>الدخول</TableHead>
              <TableHead>كشف 1</TableHead>
              <TableHead>كشف 2</TableHead>
              <TableHead>الخروج</TableHead>
              <TableHead>أيام داخل</TableHead>
              <TableHead>البيض</TableHead>
              <TableHead>الكتاكيت</TableHead>
              <TableHead>المرحلة</TableHead>
              <TableHead>إجراءات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((b: any) => {
              const meta = STAGE_META[b.stage as StageKey];
              return (
                <TableRow key={b.id} className={b.stage === "overdue" ? "bg-red-50/40 dark:bg-red-950/20" : b.isSoon ? "bg-orange-50/40 dark:bg-orange-950/10" : ""}>
                  <TableCell className="font-mono text-xs">
                    {b.batch_number}
                    {b.is_imported && <Badge variant="outline" className="mr-1 text-[9px]">مستوردة</Badge>}
                  </TableCell>
                  <TableCell className="text-xs">
                    {b.customer_name}
                    <div className="text-[10px] text-muted-foreground">{b.type === "internal" ? "عاصمة" : "عميل"}</div>
                  </TableCell>
                  <TableCell className="text-xs">{b.machine || "—"}</TableCell>
                  <TableCell className="text-xs">{b.receive_date || "—"}</TableCell>
                  <TableCell className="text-xs">{b.entry_date || "—"}</TableCell>
                  <TableCell>{dateCell(b.candle1_date, b.expCandle1, b.status)}</TableCell>
                  <TableCell>{dateCell(b.candle2_date, b.expCandle2, b.status)}</TableCell>
                  <TableCell>{dateCell(b.exit_date, b.expExit, b.status)}</TableCell>
                  <TableCell className="text-xs text-center">{b.daysIn ?? "—"}</TableCell>
                  <TableCell className="font-bold">{fmtNum(b.total_eggs)}</TableCell>
                  <TableCell>{fmtNum(b.chicks)}</TableCell>
                  <TableCell>
                    <Badge className={`${meta.color} text-white whitespace-nowrap`}>{meta.label}</Badge>
                    {b.overdueReason && <div className="text-[10px] text-red-600 mt-1">{b.overdueReason}</div>}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => setDetailBatch(b)}>تفاصيل</Button>
                      <Button size="sm" variant="ghost" onClick={() => printBatchStatement({
                        id: b.id,
                        batch_number: b.batch_number,
                        customer_name: b.customer_name,
                        customer_type: b.type,
                        is_imported: b.is_imported,
                        receive_date: b.receive_date,
                        entry_date: b.entry_date,
                        machine: b.machine,
                        received_eggs: b._raw?.received_eggs,
                        damaged: (b._raw?.received_eggs || 0) - (b._raw?.net_eggs || 0),
                        net_eggs: b._raw?.net_eggs,
                        candle1_date: b._raw?.candle1_date,
                        candle1_infertile: b._raw?.candle1_infertile,
                        candle1_fertile: b._raw?.candle1_fertile,
                        candle2_date: b._raw?.candle2_date,
                        candle2_dead: b._raw?.candle2_dead,
                        candle2_fertile: b._raw?.candle2_fertile,
                        exit_date: b._raw?.exit_date,
                        hatcher_dead: b._raw?.hatcher_dead,
                        hatched_chicks: b._raw?.hatched_chicks,
                        charge_total: (b._raw as any)?.charge_total,
                        notes: b._raw?.notes,
                      })}><Printer className="w-3 h-3" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {filtered.length === 0 && (
              <TableRow><TableCell colSpan={13} className="text-center text-muted-foreground py-8">لا توجد دفعات مطابقة</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {showNew && <NewBatchDialog open={showNew} onClose={() => setShowNew(false)} clients={clients} onSaved={() => { setShowNew(false); onRefresh(); }} />}
      {activeBatch && (
        <BatchDetailDialog batch={activeBatch} lots={lots.filter((l: any) => l.batch_id === activeBatch.id)}
          clients={clients} settings={settings} canManage={canManage}
          onClose={() => setActiveBatch(null)} onChanged={onRefresh} />
      )}
      {detailBatch && (
        <HatchBatchDetailDialog row={detailBatch} onClose={() => setDetailBatch(null)} />
      )}
      </>
      )}
    </div>

  );
};

// ============================================================
// Hatch Batch Detail Dialog (read-only operational view)
// ============================================================
const HatchBatchDetailDialog = ({ row, onClose }: { row: any; onClose: () => void }) => {
  const b = row._raw || {};
  const meta = STAGE_META[row.stage as StageKey];
  const fertility = b.received_eggs > 0 && b.candle1_fertile != null
    ? ((b.candle1_fertile / b.received_eggs) * 100).toFixed(1) + "%"
    : "—";
  const hatchRate = b.received_eggs > 0 && b.hatched_chicks
    ? ((b.hatched_chicks / b.received_eggs) * 100).toFixed(1) + "%"
    : "—";
  const totalDead = (b.candle1_infertile || 0) + (b.candle2_dead || 0) + (b.hatcher_dead || 0);
  const damaged = (b.received_eggs || 0) - (b.net_eggs || 0);

  const Row = ({ label, value }: { label: string; value: any }) => (
    <div className="flex justify-between border-b py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value ?? "—"}</span>
    </div>
  );

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            دفعة {b.batch_number}
            <Badge className={`${meta.color} text-white`}>{meta.label}</Badge>
            {row.is_imported && <Badge variant="outline">مستوردة من الشيت</Badge>}
            {!row.is_imported && <Badge variant="outline">دفعة جديدة</Badge>}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="p-3 space-y-1">
            <h4 className="font-semibold mb-2 text-primary">بيانات أساسية</h4>
            <Row label="العميل" value={row.customer_name} />
            <Row label="النوع" value={row.type === "internal" ? "عاصمة (داخلي)" : "عميل خارجي"} />
            <Row label="رقم الدفعة" value={b.batch_number} />
            <Row label="الماكينة" value={b.machine} />
            <Row label="تاريخ الوارد" value={b.receive_date} />
            <Row label="تاريخ الدخول" value={b.entry_date} />
            <Row label="أيام داخل الماكينة" value={row.daysIn} />
          </Card>

          <Card className="p-3 space-y-1">
            <h4 className="font-semibold mb-2 text-primary">المواعيد</h4>
            <Row label="الكشف الأول (فعلي)" value={b.candle1_date} />
            <Row label="الكشف الأول (متوقع)" value={row.expCandle1} />
            <Row label="الكشف الثاني (فعلي)" value={b.candle2_date} />
            <Row label="الكشف الثاني (متوقع)" value={row.expCandle2} />
            <Row label="الخروج/الهاتشر (فعلي)" value={b.exit_date} />
            <Row label="الخروج/الهاتشر (متوقع)" value={row.expExit} />
            {row.overdueReason && (
              <div className="text-xs text-red-600 mt-2">⚠ {row.overdueReason}</div>
            )}
          </Card>

          <Card className="p-3 space-y-1">
            <h4 className="font-semibold mb-2 text-primary">البيض والإنتاج</h4>
            <Row label="إجمالي البيض" value={fmtNum(b.received_eggs)} />
            <Row label="التالف" value={fmtNum(damaged)} />
            <Row label="الصافي" value={fmtNum(b.net_eggs)} />
            <Row label="لايح (كشف 1)" value={fmtNum(b.candle1_infertile)} />
            <Row label="مخصب (كشف 1)" value={fmtNum(b.candle1_fertile)} />
            <Row label="ميت كشف 2" value={fmtNum(b.candle2_dead)} />
            <Row label="مخصب بعد كشف 2" value={fmtNum(b.candle2_fertile)} />
            <Row label="نافق الهاتشر" value={fmtNum(b.hatcher_dead)} />
            <Row label="عدد الكتاكيت" value={fmtNum(b.hatched_chicks)} />
          </Card>

          <Card className="p-3 space-y-1">
            <h4 className="font-semibold mb-2 text-primary">النسب</h4>
            <Row label="نسبة الخصوبة" value={fertility} />
            <Row label="نسبة الفقس" value={hatchRate} />
            <Row label="إجمالي النافق" value={fmtNum(totalDead)} />
            {b.notes && (
              <div className="mt-2">
                <div className="text-xs text-muted-foreground mb-1">ملاحظات:</div>
                <div className="text-sm bg-muted/40 rounded p-2">{b.notes}</div>
              </div>
            )}
          </Card>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>إغلاق</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ============================================================
// New Batch Dialog
// ============================================================
const NewBatchDialog = ({ open, onClose, clients, onSaved }: any) => {
  const [entry_date, setEntryDate] = useState(today());
  const [batch_type, setBatchType] = useState<"internal" | "external" | "mixed">("mixed");
  const [machine, setMachine] = useState("");
  const [notes, setNotes] = useState("");
  const [lots, setLots] = useState<any[]>([
    { owner_type: "capital_ostrich", source: "mother_farm", eggs_in: "", client_id: "" },
  ]);

  const addLot = () => setLots([...lots, { owner_type: "external_client", source: "external", eggs_in: "", client_id: "" }]);
  const removeLot = (i: number) => setLots(lots.filter((_, j) => j !== i));
  const updateLot = (i: number, patch: any) => setLots(lots.map((l, j) => j === i ? { ...l, ...patch } : l));

  const save = async () => {
    if (!entry_date || !batch_type) return toast.error("بيانات ناقصة");
    if (lots.some(l => !l.eggs_in || +l.eggs_in <= 0)) return toast.error("أدخل عدد البيض لكل lot");
    if (lots.some(l => l.owner_type === "external_client" && !l.client_id)) return toast.error("اختر عميل للـ lot الخارجي");

    const { data: batch, error } = await supabase.from("hatchery_batches" as any)
      .insert({ entry_date, batch_type, incubator_machine_no: machine || null, notes: notes || null, created_by: (await supabase.auth.getUser()).data.user?.id })
      .select().single();
    if (error) return toast.error(error.message);

    const lotRows = lots.map(l => {
      const client = clients.find((c: any) => c.id === l.client_id);
      return {
        batch_id: (batch as any).id,
        owner_type: l.owner_type,
        source: l.source,
        eggs_in: +l.eggs_in,
        client_id: l.owner_type === "external_client" ? l.client_id : null,
        client_name_snapshot: client?.name || null,
      };
    });
    const { error: e2 } = await supabase.from("hatchery_batch_lots" as any).insert(lotRows);
    if (e2) return toast.error(e2.message);

    await supabase.from("hatchery_batch_movements" as any).insert({
      batch_id: (batch as any).id, event_type: "created",
      payload: { lots_count: lots.length, total_eggs: lots.reduce((s, l) => s + +l.eggs_in, 0) },
      created_by: (await supabase.auth.getUser()).data.user?.id,
    });
    toast.success("تم إنشاء الدفعة");
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>دفعة تفريخ جديدة</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div><Label>تاريخ الدخول</Label><Input type="date" value={entry_date} onChange={e => setEntryDate(e.target.value)} /></div>
            <div><Label>نوع الدفعة</Label>
              <Select value={batch_type} onValueChange={(v: any) => setBatchType(v)}>
                <SelectTrigger /><SelectContent>
                  <SelectItem value="internal">عاصمة فقط</SelectItem>
                  <SelectItem value="external">عملاء فقط</SelectItem>
                  <SelectItem value="mixed">مختلطة</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>رقم ماكينة التفريخ</Label><Input value={machine} onChange={e => setMachine(e.target.value)} placeholder="مثل M1" /></div>
            <div className="md:col-span-1"><Label>ملاحظات</Label><Input value={notes} onChange={e => setNotes(e.target.value)} /></div>
          </div>

          <div className="border-t pt-3">
            <div className="flex justify-between items-center mb-2">
              <h4 className="font-bold">حصص الدفعة (Lots)</h4>
              <Button size="sm" variant="outline" onClick={addLot}><Plus className="w-3 h-3 ml-1" />إضافة Lot</Button>
            </div>
            <div className="space-y-2">
              {lots.map((l, i) => (
                <Card key={i} className="p-3">
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2 items-end">
                    <div><Label>المالك</Label>
                      <Select value={l.owner_type} onValueChange={v => updateLot(i, { owner_type: v, source: v === "capital_ostrich" ? "mother_farm" : "external" })}>
                        <SelectTrigger /><SelectContent>
                          <SelectItem value="capital_ostrich">نعام العاصمة</SelectItem>
                          <SelectItem value="external_client">عميل خارجي</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div><Label>المصدر</Label>
                      <Select value={l.source} onValueChange={v => updateLot(i, { source: v })}>
                        <SelectTrigger /><SelectContent>
                          <SelectItem value="mother_farm">مزرعة الأمهات</SelectItem>
                          <SelectItem value="external">عميل خارجي</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {l.owner_type === "external_client" && (
                      <div><Label>العميل</Label>
                        <Select value={l.client_id} onValueChange={v => updateLot(i, { client_id: v })}>
                          <SelectTrigger><SelectValue placeholder="اختر..." /></SelectTrigger>
                          <SelectContent>{clients.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                    )}
                    <div><Label>عدد البيض</Label><Input type="number" value={l.eggs_in} onChange={e => updateLot(i, { eggs_in: e.target.value })} /></div>
                    <Button size="sm" variant="ghost" onClick={() => removeLot(i)} disabled={lots.length === 1}><X className="w-4 h-4" /></Button>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter><Button onClick={save}>حفظ الدفعة</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ============================================================
// Batch Detail Dialog (lots + actions)
// ============================================================
const BatchDetailDialog = ({ batch, lots, clients, settings, canManage, onClose, onChanged }: any) => {
  const [actionLot, setActionLot] = useState<any>(null);
  const [actionType, setActionType] = useState<string>("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const openAction = (lot: any, type: string) => { setActionLot(lot); setActionType(type); };

  const cancelBatch = async () => {
    if (!cancelReason.trim()) return toast.error("اذكر السبب");
    const { error } = await supabase.rpc("cancel_hatchery_batch" as any, { _batch_id: batch.id, _reason: cancelReason });
    if (error) return toast.error(error.message);
    toast.success("تم إلغاء الدفعة"); setCancelOpen(false); onChanged(); onClose();
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>دفعة {batch.batch_number} — {batch.entry_date}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline">ماكينة: {batch.incubator_machine_no || "—"}</Badge>
            <Badge className={`${statusColors[batch.status]} text-white`}>{statusLabels[batch.status]}</Badge>
            <Badge variant="outline">كشف: {batch.candle_due_date}</Badge>
            <Badge variant="outline">هاتشر: {batch.hatcher_due_date}</Badge>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>المالك</TableHead>
                <TableHead>العميل</TableHead>
                <TableHead>بيض</TableHead>
                <TableHead>لايح</TableHead>
                <TableHead>مخصب</TableHead>
                <TableHead>منقول هاتشر</TableHead>
                <TableHead>كتاكيت</TableHead>
                <TableHead>أكمل بدون فقس</TableHead>
                <TableHead>إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lots.map((l: any) => (
                <TableRow key={l.id} className={l.cancelled ? "opacity-50" : ""}>
                  <TableCell>{l.owner_type === "capital_ostrich" ? "عاصمة" : "عميل"}</TableCell>
                  <TableCell className="text-xs">{l.client_name_snapshot || "—"}</TableCell>
                  <TableCell>{fmtNum(l.eggs_in)}</TableCell>
                  <TableCell>{l.infertile_eggs != null ? fmtNum(l.infertile_eggs) : "—"}</TableCell>
                  <TableCell>{l.fertile_eggs != null ? fmtNum(l.fertile_eggs) : "—"}</TableCell>
                  <TableCell>{l.transferred_count != null ? fmtNum(l.transferred_count) : "—"}</TableCell>
                  <TableCell>{l.chicks_hatched != null ? fmtNum(l.chicks_hatched) : "—"}</TableCell>
                  <TableCell>{l.completed_unhatched != null ? fmtNum(l.completed_unhatched) : "—"}</TableCell>
                  <TableCell className="space-x-1 space-x-reverse">
                    {canManage && !l.cancelled && (
                      <>
                        {!l.candling_recorded_at && <Button size="sm" variant="outline" onClick={() => openAction(l, "candling")}>كشف</Button>}
                        {l.candling_recorded_at && !l.transferred_to_hatcher_at && <Button size="sm" variant="outline" onClick={() => openAction(l, "hatcher")}>هاتشر</Button>}
                        {l.transferred_to_hatcher_at && !l.hatcher_out_at && <Button size="sm" variant="outline" onClick={() => openAction(l, "hatch")}>فقس</Button>}
                        {l.hatcher_out_at && !l.brooding_in_at && <Button size="sm" variant="outline" onClick={() => openAction(l, "brooding_in")}>حضانة</Button>}
                        {l.brooding_in_at && !l.brooding_out_at && <Button size="sm" variant="outline" onClick={() => openAction(l, "deliver")}>تسليم</Button>}
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <DialogFooter>
          {canManage && batch.status !== "cancelled" && (
            <Button variant="destructive" onClick={() => setCancelOpen(true)}>إلغاء الدفعة</Button>
          )}
        </DialogFooter>

        {actionLot && (
          <LotActionDialog lot={actionLot} type={actionType} settings={settings}
            onClose={() => { setActionLot(null); setActionType(""); }}
            onDone={() => { setActionLot(null); setActionType(""); onChanged(); }} />
        )}
        {cancelOpen && (
          <Dialog open={true} onOpenChange={() => setCancelOpen(false)}>
            <DialogContent>
              <DialogHeader><DialogTitle>إلغاء الدفعة</DialogTitle></DialogHeader>
              <Label>السبب</Label>
              <Textarea value={cancelReason} onChange={e => setCancelReason(e.target.value)} />
              <DialogFooter><Button variant="destructive" onClick={cancelBatch}>تأكيد الإلغاء</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </DialogContent>
    </Dialog>
  );
};

// ============================================================
// Lot Action Dialog (candling / hatcher transfer / hatch result / brooding in / deliver)
// ============================================================
const LotActionDialog = ({ lot, type, settings, onClose, onDone }: any) => {
  const [form, setForm] = useState<any>({});

  const upd = (p: any) => setForm((f: any) => ({ ...f, ...p }));

  const submit = async () => {
    const uid = (await supabase.auth.getUser()).data.user?.id;
    let patch: any = {}; let event = ""; let payload: any = {};
    if (type === "candling") {
      const inf = +form.infertile || 0;
      const fert = +(form.fertile ?? (lot.eggs_in - inf));
      if (inf + fert !== lot.eggs_in) return toast.error("اللايح + المخصب يجب أن يساوي إجمالي البيض");
      patch = {
        infertile_eggs: inf,
        infertile_edible: +form.edible || 0,
        infertile_inedible: +form.inedible || 0,
        fertile_eggs: fert,
        candling_notes: form.notes || null,
        candling_recorded_at: new Date().toISOString(),
        candling_by: uid,
      };
      event = "candling"; payload = patch;
    } else if (type === "hatcher") {
      patch = {
        transferred_to_hatcher_at: new Date().toISOString(),
        transferred_to_hatcher_by: uid,
        hatcher_machine_no: form.machine || null,
        transferred_count: +form.count || lot.fertile_eggs || 0,
      };
      event = "transferred_to_hatcher"; payload = patch;
    } else if (type === "hatch") {
      const chicks = +form.chicks || 0;
      const unh = +form.unhatched || 0;
      patch = {
        chicks_hatched: chicks,
        completed_unhatched: unh,
        hatcher_out_at: new Date().toISOString(),
        hatcher_out_by: uid,
      };
      event = "hatched"; payload = patch;
    } else if (type === "brooding_in") {
      patch = { brooding_in_at: new Date().toISOString() };
      event = "moved_to_brooding"; payload = patch;
    } else if (type === "deliver") {
      const out = new Date();
      const inDate = new Date(lot.brooding_in_at);
      const days = Math.max(0, Math.round((out.getTime() - inDate.getTime()) / 86400000));
      patch = { brooding_out_at: out.toISOString(), brooding_days: days };
      event = "delivered"; payload = patch;
    }

    const { error } = await supabase.from("hatchery_batch_lots" as any).update(patch).eq("id", lot.id);
    if (error) return toast.error(error.message);

    // Update batch status
    if (type === "candling") await supabase.from("hatchery_batches" as any).update({ status: "candled" }).eq("id", lot.batch_id);
    if (type === "hatcher") await supabase.from("hatchery_batches" as any).update({ status: "in_hatcher" }).eq("id", lot.batch_id);
    if (type === "brooding_in") await supabase.from("hatchery_batches" as any).update({ status: "in_brooding" }).eq("id", lot.batch_id);
    if (type === "deliver") await supabase.from("hatchery_batches" as any).update({ status: "closed" }).eq("id", lot.batch_id);

    await supabase.from("hatchery_batch_movements" as any).insert({
      batch_id: lot.batch_id, lot_id: lot.id, event_type: event, payload, created_by: uid,
    });

    // Recompute invoice for external clients on candling/hatch/deliver
    if (lot.owner_type === "external_client" && ["candling", "hatch", "deliver"].includes(type)) {
      await supabase.rpc("compute_hatchery_invoice" as any, { _lot_id: lot.id });
    }
    toast.success("تم الحفظ");
    onDone();
  };

  const titleMap: Record<string, string> = {
    candling: "كشف اليوم 15", hatcher: "نقل إلى الهاتشر",
    hatch: "تسجيل الفقس", brooding_in: "نقل إلى الحضانات", deliver: "تسليم من الحضانات",
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>{titleMap[type]}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {type === "candling" && (
            <>
              <div className="text-sm">إجمالي البيض: <b>{lot.eggs_in}</b></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>بيض لايح (غير مخصب)</Label><Input type="number" value={form.infertile || ""} onChange={e => upd({ infertile: e.target.value })} /></div>
                <div><Label>بيض مخصب</Label><Input type="number" value={form.fertile ?? (lot.eggs_in - (+form.infertile || 0))} onChange={e => upd({ fertile: e.target.value })} /></div>
                <div><Label>لايح صالح للأكل</Label><Input type="number" value={form.edible || ""} onChange={e => upd({ edible: e.target.value })} /></div>
                <div><Label>لايح غير صالح</Label><Input type="number" value={form.inedible || ""} onChange={e => upd({ inedible: e.target.value })} /></div>
              </div>
              <div><Label>ملاحظات</Label><Textarea value={form.notes || ""} onChange={e => upd({ notes: e.target.value })} /></div>
            </>
          )}
          {type === "hatcher" && (
            <>
              <div><Label>رقم ماكينة الهاتشر</Label><Input value={form.machine || ""} onChange={e => upd({ machine: e.target.value })} placeholder="مثل HATCHER-1" /></div>
              <div><Label>الكمية المنقولة</Label><Input type="number" value={form.count ?? lot.fertile_eggs ?? ""} onChange={e => upd({ count: e.target.value })} /></div>
            </>
          )}
          {type === "hatch" && (
            <>
              <div className="text-sm">المنقول للهاتشر: <b>{lot.transferred_count}</b></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>عدد الكتاكيت الناتجة</Label><Input type="number" value={form.chicks || ""} onChange={e => upd({ chicks: e.target.value })} /></div>
                <div><Label>أكمل ولم يفقس</Label><Input type="number" value={form.unhatched || ""} onChange={e => upd({ unhatched: e.target.value })} /></div>
              </div>
            </>
          )}
          {type === "brooding_in" && <div className="text-sm text-muted-foreground">سيتم تسجيل دخول {lot.chicks_hatched} كتكوت إلى الحضانات الآن.</div>}
          {type === "deliver" && (
            <div className="text-sm text-muted-foreground">
              سيتم احتساب أيام التحضين من {lot.brooding_in_at?.slice(0, 10)} حتى اليوم وإضافة قيمتها للفاتورة.
            </div>
          )}
        </div>
        <DialogFooter><Button onClick={submit}>تأكيد</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ============================================================
// Invoices Tab
// ============================================================
const paymentStatusLabels: Record<string, string> = { unpaid: "غير مدفوعة", partial: "مدفوعة جزئيًا", paid: "مدفوعة" };
const paymentStatusColors: Record<string, string> = { unpaid: "bg-red-500", partial: "bg-amber-500", paid: "bg-emerald-600" };

const InvoicesTab = ({ invoices, canBill, onRefresh }: any) => {
  const [active, setActive] = useState<any>(null);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => invoices.filter((i: any) =>
    !search || i.invoice_no?.toLowerCase().includes(search.toLowerCase()) || i.client_name_snapshot?.includes(search)
  ), [invoices, search]);

  const exportExcel = () => {
    const rows = filtered.map((i: any) => ({
      "رقم الفاتورة": i.invoice_no, "العميل": i.client_name_snapshot,
      "بيض": i.eggs_in, "لايح": i.infertile_count, "كتاكيت": i.chicks_count,
      "أكمل بدون فقس": i.completed_unhatched_count, "أيام تحضين": i.brooding_days,
      "الإجمالي": +i.total_amount, "المدفوع": +i.paid_amount, "المتبقي": +i.remaining_amount,
      "الحالة": paymentStatusLabels[i.payment_status],
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "فواتير");
    XLSX.writeFile(wb, `hatchery-invoices-${today()}.xlsx`);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث..." className="pr-9" />
        </div>
        <Button variant="outline" onClick={exportExcel}><FileSpreadsheet className="w-4 h-4 ml-1" />Excel</Button>
      </div>
      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>رقم الفاتورة</TableHead><TableHead>العميل</TableHead>
              <TableHead>بيض</TableHead><TableHead>كتاكيت</TableHead>
              <TableHead>الإجمالي</TableHead><TableHead>المدفوع</TableHead><TableHead>المتبقي</TableHead>
              <TableHead>الحالة</TableHead><TableHead>التاريخ</TableHead><TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((i: any) => (
              <TableRow key={i.id}>
                <TableCell className="font-mono text-xs">{i.invoice_no}</TableCell>
                <TableCell>{i.client_name_snapshot}</TableCell>
                <TableCell>{fmtNum(i.eggs_in)}</TableCell>
                <TableCell>{fmtNum(i.chicks_count)}</TableCell>
                <TableCell className="font-bold">{fmtEGP(i.total_amount)}</TableCell>
                <TableCell>{fmtEGP(i.paid_amount)}</TableCell>
                <TableCell className="text-red-600">{fmtEGP(i.remaining_amount)}</TableCell>
                <TableCell><Badge className={`${paymentStatusColors[i.payment_status]} text-white`}>{paymentStatusLabels[i.payment_status]}</Badge></TableCell>
                <TableCell className="text-xs">{i.issued_at?.slice(0, 10)}</TableCell>
                <TableCell><Button size="sm" variant="outline" onClick={() => setActive(i)}>عرض</Button></TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">لا توجد فواتير</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
      {active && <InvoiceDialog invoice={active} canBill={canBill} onClose={() => setActive(null)} onChanged={() => { onRefresh(); setActive(null); }} />}
    </div>
  );
};

const InvoiceDialog = ({ invoice, canBill, onClose, onChanged }: any) => {
  const [payOpen, setPayOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("");
  const [notes, setNotes] = useState("");

  const addPayment = async () => {
    if (!amount || +amount <= 0) return toast.error("أدخل مبلغ صحيح");
    const uid = (await supabase.auth.getUser()).data.user?.id;
    const { error } = await supabase.from("hatchery_invoice_payments" as any).insert({
      invoice_id: invoice.id, amount: +amount, method: method || null, notes: notes || null, received_by: uid,
    });
    if (error) return toast.error(error.message);
    toast.success("تم تسجيل الدفعة"); setPayOpen(false); onChanged();
  };

  const printInvoice = () => {
    const i = invoice;
    const html = `
      <header>
        <div><h1>فاتورة تفريخ</h1><div class="en">Hatchery Invoice</div></div>
        <div class="meta">رقم: ${escapeHtml(i.invoice_no)}<br>التاريخ: ${fmtDate(i.issued_at)}</div>
      </header>
      <h2>بيانات العميل</h2>
      <table><tr><th>العميل</th><td>${escapeHtml(i.client_name_snapshot)}</td></tr></table>
      <h2>تفاصيل التفريخ</h2>
      <table>
        <thead><tr><th>البند</th><th>العدد</th><th>سعر الوحدة</th><th>الإجمالي</th></tr></thead>
        <tbody>
          <tr><td>بيض لايح (كشف اليوم ١٥)</td><td>${i.infertile_count}</td><td>${fmtNum(i.infertile_unit_price, 2)}</td><td>${fmtNum(i.infertile_amount, 2)}</td></tr>
          <tr><td>كتاكيت ناتجة</td><td>${i.chicks_count}</td><td>${fmtNum(i.chick_unit_price, 2)}</td><td>${fmtNum(i.chicks_amount, 2)}</td></tr>
          <tr><td>أكمل في الماكينة ولم يفقس</td><td>${i.completed_unhatched_count}</td><td>${fmtNum(i.completed_unhatched_unit_price, 2)}</td><td>${fmtNum(i.completed_unhatched_amount, 2)}</td></tr>
          <tr><td>تحضين (${i.brooding_chicks_count} كتكوت × ${i.brooding_days} يوم × ${fmtNum(i.brooding_daily_price, 2)})</td><td>${i.brooding_chicks_count}</td><td>${fmtNum(i.brooding_daily_price, 2)}/يوم</td><td>${fmtNum(i.brooding_amount, 2)}</td></tr>
        </tbody>
        <tfoot>
          <tr><th colspan="3">الإجمالي</th><th>${fmtNum(i.total_amount, 2)} ج.م</th></tr>
          <tr><th colspan="3">المدفوع</th><th>${fmtNum(i.paid_amount, 2)} ج.م</th></tr>
          <tr><th colspan="3">المتبقي</th><th>${fmtNum(i.remaining_amount, 2)} ج.م</th></tr>
        </tfoot>
      </table>
      ${i.notes ? `<h2>ملاحظات</h2><p>${escapeHtml(i.notes)}</p>` : ""}
    `;
    openPrintWindow(`فاتورة ${i.invoice_no}`, html);
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>فاتورة {invoice.invoice_no}</DialogTitle></DialogHeader>
        <div className="space-y-2 text-sm">
          <div><b>العميل:</b> {invoice.client_name_snapshot}</div>
          <Table>
            <TableHeader><TableRow><TableHead>البند</TableHead><TableHead>العدد</TableHead><TableHead>السعر</TableHead><TableHead>الإجمالي</TableHead></TableRow></TableHeader>
            <TableBody>
              <TableRow><TableCell>بيض لايح</TableCell><TableCell>{invoice.infertile_count}</TableCell><TableCell>{fmtEGP(invoice.infertile_unit_price)}</TableCell><TableCell>{fmtEGP(invoice.infertile_amount)}</TableCell></TableRow>
              <TableRow><TableCell>كتاكيت ناتجة</TableCell><TableCell>{invoice.chicks_count}</TableCell><TableCell>{fmtEGP(invoice.chick_unit_price)}</TableCell><TableCell>{fmtEGP(invoice.chicks_amount)}</TableCell></TableRow>
              <TableRow><TableCell>أكمل بدون فقس</TableCell><TableCell>{invoice.completed_unhatched_count}</TableCell><TableCell>{fmtEGP(invoice.completed_unhatched_unit_price)}</TableCell><TableCell>{fmtEGP(invoice.completed_unhatched_amount)}</TableCell></TableRow>
              <TableRow><TableCell>تحضين ({invoice.brooding_days} يوم)</TableCell><TableCell>{invoice.brooding_chicks_count}</TableCell><TableCell>{fmtEGP(invoice.brooding_daily_price)}/يوم</TableCell><TableCell>{fmtEGP(invoice.brooding_amount)}</TableCell></TableRow>
            </TableBody>
          </Table>
          <div className="border-t pt-2 space-y-1">
            <div className="flex justify-between"><span>الإجمالي:</span><b>{fmtEGP(invoice.total_amount)}</b></div>
            <div className="flex justify-between"><span>المدفوع:</span><b className="text-emerald-600">{fmtEGP(invoice.paid_amount)}</b></div>
            <div className="flex justify-between"><span>المتبقي:</span><b className="text-red-600">{fmtEGP(invoice.remaining_amount)}</b></div>
          </div>
        </div>
        <DialogFooter className="flex-wrap gap-2">
          <Button variant="outline" onClick={printInvoice}><Printer className="w-4 h-4 ml-1" />طباعة / PDF</Button>
          {canBill && invoice.payment_status !== "paid" && (
            <Button onClick={() => setPayOpen(true)}><Wallet className="w-4 h-4 ml-1" />إضافة دفعة</Button>
          )}
        </DialogFooter>
        {payOpen && (
          <Dialog open={true} onOpenChange={() => setPayOpen(false)}>
            <DialogContent>
              <DialogHeader><DialogTitle>تسجيل دفعة</DialogTitle></DialogHeader>
              <div className="space-y-2">
                <div><Label>المبلغ</Label><Input type="number" value={amount} onChange={e => setAmount(e.target.value)} /></div>
                <div><Label>طريقة الدفع</Label><Input value={method} onChange={e => setMethod(e.target.value)} placeholder="نقدي / تحويل..." /></div>
                <div><Label>ملاحظات</Label><Textarea value={notes} onChange={e => setNotes(e.target.value)} /></div>
              </div>
              <DialogFooter><Button onClick={addPayment}>تأكيد</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </DialogContent>
    </Dialog>
  );
};

// ============================================================
// Balances Tab
// ============================================================
const BalancesTab = ({ balances }: any) => (
  <Card className="overflow-x-auto">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>العميل</TableHead><TableHead>عدد الفواتير</TableHead>
          <TableHead>الإجمالي</TableHead><TableHead>المدفوع</TableHead><TableHead>المتبقي</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {balances.filter((b: any) => b.invoices_count > 0).map((b: any) => (
          <TableRow key={b.client_id}>
            <TableCell>{b.client_name}</TableCell>
            <TableCell>{b.invoices_count}</TableCell>
            <TableCell>{fmtEGP(b.total_amount)}</TableCell>
            <TableCell className="text-emerald-600">{fmtEGP(b.paid_amount)}</TableCell>
            <TableCell className="text-red-600 font-bold">{fmtEGP(b.remaining_amount)}</TableCell>
          </TableRow>
        ))}
        {balances.filter((b: any) => b.invoices_count > 0).length === 0 && (
          <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">لا توجد فواتير عملاء بعد</TableCell></TableRow>
        )}
      </TableBody>
    </Table>
  </Card>
);

// ============================================================
// Settings Tab
// ============================================================
const SettingsTab = ({ settings, canManage, onRefresh }: any) => {
  const [form, setForm] = useState<any>({});
  useEffect(() => { if (settings) setForm(settings); }, [settings]);

  const save = async () => {
    if (!canManage) return;
    const { error } = await supabase.from("hatchery_pricing_settings" as any)
      .update({
        infertile_egg_price: +form.infertile_egg_price,
        chick_price: +form.chick_price,
        completed_unhatched_price: +form.completed_unhatched_price,
        daily_brooding_price: +form.daily_brooding_price,
        candling_day: +form.candling_day,
        transfer_to_hatcher_day: +form.transfer_to_hatcher_day,
        hatcher_duration_hours: +form.hatcher_duration_hours,
        version: (form.version || 1) + 1,
        updated_by: (await supabase.auth.getUser()).data.user?.id,
      }).eq("id", settings.id);
    if (error) return toast.error(error.message);
    toast.success("تم حفظ الإعدادات"); onRefresh();
  };

  if (!settings) return <div>تحميل...</div>;
  const upd = (k: string, v: any) => setForm({ ...form, [k]: v });

  return (
    <Card className="p-4 max-w-3xl">
      <h3 className="font-bold mb-3">إعدادات الأسعار والمدد</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div><Label>سعر البيضة اللايح (ج.م)</Label><Input type="number" disabled={!canManage} value={form.infertile_egg_price ?? ""} onChange={e => upd("infertile_egg_price", e.target.value)} /></div>
        <div><Label>سعر الكتكوت الناتج (ج.م)</Label><Input type="number" disabled={!canManage} value={form.chick_price ?? ""} onChange={e => upd("chick_price", e.target.value)} /></div>
        <div><Label>سعر البيضة أكملت ولم تفقس (ج.م)</Label><Input type="number" disabled={!canManage} value={form.completed_unhatched_price ?? ""} onChange={e => upd("completed_unhatched_price", e.target.value)} /></div>
        <div><Label>سعر تحضين الكتكوت اليومي (ج.م)</Label><Input type="number" disabled={!canManage} value={form.daily_brooding_price ?? ""} onChange={e => upd("daily_brooding_price", e.target.value)} /></div>
        <div><Label>يوم الكشف الأول</Label><Input type="number" disabled={!canManage} value={form.candling_day ?? ""} onChange={e => upd("candling_day", e.target.value)} /></div>
        <div><Label>يوم النقل إلى الهاتشر</Label><Input type="number" disabled={!canManage} value={form.transfer_to_hatcher_day ?? ""} onChange={e => upd("transfer_to_hatcher_day", e.target.value)} /></div>
        <div><Label>مدة الهاتشر (ساعات)</Label><Input type="number" disabled={!canManage} value={form.hatcher_duration_hours ?? ""} onChange={e => upd("hatcher_duration_hours", e.target.value)} /></div>
      </div>
      {canManage && <Button className="mt-4" onClick={save}>حفظ الإعدادات</Button>}
      {!canManage && <p className="text-sm text-muted-foreground mt-3">عرض فقط — تعديل الإعدادات للمدير العام/التنفيذي/مدير المعمل.</p>}
    </Card>
  );
};

export default HatcheryLab;
