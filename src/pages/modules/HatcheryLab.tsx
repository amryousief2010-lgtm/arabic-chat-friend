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
  Settings as SettingsIcon, Printer, FileSpreadsheet, X, Activity, TrendingUp, ClipboardCheck, Tag,
  Users, Archive, Warehouse, Receipt, BarChart3, Truck, ChevronLeft, Sparkles,
} from "lucide-react";
import ChickTradingTab from "@/components/chick-trading/ChickTradingTab";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { format } from "date-fns";
import { openPrintWindow, escapeHtml, fmtNum, fmtDate } from "@/lib/printPdf";
import * as XLSX from "xlsx";
import HatcheryClientMetrics from "@/components/hatchery/HatcheryClientMetrics";
import { printBatchStatement } from "@/lib/hatcheryStatements";
import HatcheryGroupedBatches from "@/components/hatchery/HatcheryGroupedBatches";
import {
  addDays,
  computeStage,
  daysDiff,
  HATCH_BATCHES_LAB_QUERY_KEY,
  HATCH_BATCHES_LAB_SELECT,
  isOperationalHatchBatch,
  STAGE_META,
  type StageKey,
} from "@/lib/hatcheryBatchStage";


const today = () => format(new Date(), "yyyy-MM-dd");

// ---------- Types ----------
type Lot = any; type Batch = any; type Invoice = any; type Settings = any;

const fmtEGP = (v: any) => `${fmtNum(v, 2)} ج.م`;

// ============================================================
// Main Page
// ============================================================
const HatcheryLab = () => {
  const { isGeneralManager, isExecutiveManager, isHatcheryManager, isAccountant, roles } = useAuth();
  const canManage = isGeneralManager || isExecutiveManager || isHatcheryManager || (roles || []).includes('lab_treasury_approver');
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
    qc.invalidateQueries({ queryKey: HATCH_BATCHES_LAB_QUERY_KEY });
    qc.invalidateQueries({ queryKey: ["hatch_batches_dash"] });
    qc.invalidateQueries({ queryKey: ["hatch_next_op_no"] });
  };

  const quickLinks: { href: string; label: string; desc: string; icon: any; tone: "primary" | "muted" }[] = [
    { href: "/hatchery/import-batches", label: "استيراد دفعات المعمل", desc: "رفع ملف Excel للدفعات", icon: FileSpreadsheet, tone: "primary" },
    { href: "/hatchery/import-batches/review", label: "مراجعة الدفعات المستوردة", desc: "تدقيق قبل الاعتماد", icon: ClipboardCheck, tone: "primary" },
    { href: "/hatchery/customer-reconciliation", label: "تسوية حسابات العملاء", desc: "مطابقة الكميات والمبالغ", icon: ClipboardCheck, tone: "primary" },
    { href: "/hatchery/operational-statement", label: "كشف حساب تشغيل العملاء", desc: "حركة التشغيل التفصيلية", icon: FileText, tone: "primary" },
    { href: "/lab-treasury", label: "خزنة المعمل والحضانات", desc: "النقدية والحركات", icon: Wallet, tone: "primary" },
    { href: "/lab-treasury/customer-statement", label: "كشف حساب عملاء المعمل", desc: "كشف مالي مفصل", icon: Receipt, tone: "primary" },
    { href: "/lab-treasury/customer-balances", label: "أرصدة العملاء", desc: "إجمالي المستحقات", icon: Users, tone: "primary" },
    { href: "/hatchery/payments", label: "دفعات العملاء (أرشيف)", desc: "سجل الدفعات السابقة", icon: Archive, tone: "muted" },
    { href: "/modules/farm-hatchery-dashboard", label: "لوحة المزرعة والمعمل", desc: "مؤشرات تشغيلية", icon: BarChart3, tone: "muted" },
    { href: "/farm-shipments-log", label: "سجل وارد المزرعة", desc: "حركة الوارد من المزرعة", icon: Truck, tone: "muted" },
  ];

  const tabsConfig = [
    { value: "dashboard", label: "الداشبورد", icon: Activity },
    { value: "batches", label: "الدفعات", icon: FlaskConical },
    { value: "invoices", label: "الفواتير", icon: FileText },
    { value: "balances", label: "مديونية العملاء", icon: Wallet },
    { value: "chick_trading", label: "تجارة كتاكيت", icon: Tag },
    { value: "settings", label: "الإعدادات", icon: SettingsIcon },
  ];

  return (
    <DashboardLayout>
      <Header title="معمل التفريخ والحضانات" subtitle="نظام كامل: دفعات • كشف • هاتشر • حضانات • فواتير" />
      <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6" dir="rtl">

        {/* ===== Premium Page Header ===== */}
        <Card className="relative overflow-hidden border border-border/60 shadow-sm">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-l from-primary via-fuchsia-500 to-orange-500" />
          <div className="absolute -top-16 -left-16 w-56 h-56 rounded-full bg-primary/5 blur-3xl pointer-events-none" />
          <div className="absolute -bottom-16 -right-16 w-56 h-56 rounded-full bg-orange-500/5 blur-3xl pointer-events-none" />
          <div className="relative p-5 sm:p-7 bg-gradient-to-bl from-background via-background to-muted/30">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div className="flex items-start gap-4 min-w-0">
                <div className="shrink-0 w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-fuchsia-600 text-primary-foreground flex items-center justify-center shadow-lg shadow-primary/25">
                  <FlaskConical className="w-7 h-7" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h1 className="text-xl sm:text-2xl font-bold tracking-tight">دفعات معمل التفريخ</h1>
                    <span className="hidden sm:inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                      <Sparkles className="w-3 h-3" /> Premium
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                    إدارة دفعات التفريخ، متابعة الماكينات، الكشف، الفقس والخروج
                  </p>
                </div>
              </div>
              {canManage && (
                <Button
                  onClick={() => setTab("batches")}
                  className="h-10 px-5 bg-gradient-to-l from-primary to-fuchsia-600 hover:from-primary/90 hover:to-fuchsia-600/90 text-primary-foreground shadow-md shadow-primary/20"
                >
                  <Plus className="w-4 h-4 ml-1.5" /> دفعة جديدة
                </Button>
              )}
            </div>
          </div>
        </Card>

        {/* ===== Quick Access Grid ===== */}
        <section className="space-y-3">
          <div className="flex items-end justify-between px-1">
            <div>
              <h2 className="text-sm font-bold text-foreground">روابط سريعة</h2>
              <p className="text-xs text-muted-foreground mt-0.5">الوصول المباشر لكل وظائف المعمل</p>
            </div>
            <span className="text-[11px] text-muted-foreground">{quickLinks.length} وظيفة</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
            {quickLinks.map((q) => {
              const Icon = q.icon;
              const isPrimary = q.tone === "primary";
              return (
                <a
                  key={q.href}
                  href={q.href}
                  className="group relative flex flex-col gap-2 p-4 rounded-xl bg-card border border-border/60 hover:border-primary/40 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <div className="flex items-center justify-between">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
                      isPrimary
                        ? "bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground"
                        : "bg-muted text-muted-foreground group-hover:bg-orange-500/10 group-hover:text-orange-600"
                    }`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <ChevronLeft className="w-4 h-4 text-muted-foreground/40 group-hover:text-primary group-hover:-translate-x-0.5 transition-all" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-foreground leading-snug line-clamp-2">{q.label}</div>
                    <div className="text-[11px] text-muted-foreground mt-1 line-clamp-1">{q.desc}</div>
                  </div>
                </a>
              );
            })}
          </div>
        </section>

        {/* ===== Premium Tabs ===== */}
        <Tabs value={tab} onValueChange={setTab} className="space-y-4">
          <div className="relative">
            <div className="overflow-x-auto -mx-1 px-1 pb-1 scrollbar-thin">
              <TabsList className="inline-flex w-auto h-auto p-1.5 bg-card border border-border/60 rounded-xl shadow-sm gap-1">
                {tabsConfig.map((t) => {
                  const Icon = t.icon;
                  return (
                    <TabsTrigger
                      key={t.value}
                      value={t.value}
                      className="h-9 px-4 rounded-lg text-sm font-medium text-muted-foreground data-[state=active]:bg-gradient-to-l data-[state=active]:from-primary data-[state=active]:to-fuchsia-600 data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm transition-all whitespace-nowrap"
                    >
                      <Icon className="w-4 h-4 ml-1.5" />
                      {t.label}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </div>
          </div>

          <TabsContent value="dashboard" className="mt-0">
            <DashboardTab kpis={kpis} batches={batches} settings={settings} setTab={setTab} />
          </TabsContent>

          <TabsContent value="batches" className="mt-0">
            <BatchesTab lots={lots} clients={clients} settings={settings}
              canManage={canManage} onRefresh={refresh} />
          </TabsContent>

          <TabsContent value="invoices" className="mt-0">
            <InvoicesTab invoices={invoices} canBill={canBill} onRefresh={refresh} />
          </TabsContent>

          <TabsContent value="balances" className="mt-0">
            <BalancesTab balances={balances} />
          </TabsContent>

          <TabsContent value="chick_trading" className="mt-0">
            <ChickTradingTab />
          </TabsContent>

          <TabsContent value="settings" className="mt-0">
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
  <Card className="relative overflow-hidden border border-white/20 shadow-lg shadow-black/5">
    <div className={`absolute inset-0 bg-gradient-to-br ${color}`} />
    <div className="absolute inset-0 bg-white/10 backdrop-blur-[1px]" />
    <div className="relative p-5 text-white">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-medium opacity-90 tracking-wide">{label}</span>
        <div className="w-7 h-7 rounded-lg bg-white/15 flex items-center justify-center">
          <Icon className="w-3.5 h-3.5 opacity-90" />
        </div>
      </div>
      <p className="text-2xl font-extrabold font-mono tabular-nums tracking-tight">{value}</p>
      {sub && <p className="text-[11px] opacity-80 mt-1.5 font-medium">{sub}</p>}
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

// ---- Stage + dates helpers live in @/lib/hatcheryBatchStage ----

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
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");


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
    queryKey: HATCH_BATCHES_LAB_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hatch_batches")
        .select(HATCH_BATCHES_LAB_SELECT)
        .order("operational_batch_no", { ascending: true })
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
    return (hatchBatches as any[])
      .filter(isOperationalHatchBatch)
      .map((b) => {
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
    const result = rows.filter((r) => {
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
    return result.sort((a: any, b: any) => {
      const diff = (a.op_seq || 0) - (b.op_seq || 0);
      return sortOrder === "asc" ? diff : -diff;
    });
  }, [rows, search, filter, todayStr, sortOrder]);

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
    <div className="space-y-4">
      {/* Premium header card */}
      <Card className="relative border-0 shadow-md overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-purple-600 via-fuchsia-500 to-orange-500" />
        <div className="p-4 sm:p-5 bg-gradient-to-br from-background to-muted/30">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              <div className="shrink-0 w-11 h-11 rounded-xl bg-gradient-to-br from-purple-600 to-fuchsia-600 text-white flex items-center justify-center shadow-lg">
                <FlaskConical className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-lg sm:text-xl font-bold leading-tight">دفعات معمل التفريخ</h2>
                <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
                  إدارة دفعات التفريخ، متابعة الماكينات، الكشف، الفقس، والخروج
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* View mode (طريقة العرض) */}
              <div className="inline-flex items-center gap-1 p-1 bg-muted/70 rounded-lg border">
                <Button
                  size="sm"
                  variant={viewMode === "grouped" ? "default" : "ghost"}
                  onClick={() => setViewMode("grouped")}
                  className="h-8 text-xs"
                >
                  عرض مجمع
                </Button>
                <Button
                  size="sm"
                  variant={viewMode === "detailed" ? "default" : "ghost"}
                  onClick={() => setViewMode("detailed")}
                  className="h-8 text-xs"
                >
                  تفصيلي لكل عميل
                </Button>
              </div>

              {/* Sort */}
              <div className="inline-flex items-center gap-1 p-1 bg-muted/70 rounded-lg border">
                <Button size="sm" variant={sortOrder === "asc" ? "default" : "ghost"} className="h-8 text-xs" onClick={() => setSortOrder("asc")}>الأقدم أولًا</Button>
                <Button size="sm" variant={sortOrder === "desc" ? "default" : "ghost"} className="h-8 text-xs" onClick={() => setSortOrder("desc")}>الأحدث أولًا</Button>
              </div>

              {canManage && (
                <Button
                  onClick={() => setShowNew(true)}
                  className="h-9 bg-gradient-to-r from-purple-600 to-fuchsia-600 hover:from-purple-700 hover:to-fuchsia-700 text-white shadow-md"
                >
                  <Plus className="w-4 h-4 ml-1" />دفعة جديدة
                </Button>
              )}
            </div>
          </div>
        </div>
      </Card>

      {viewMode === "grouped" ? (
        <>
          <HatcheryGroupedBatches
            rows={rows}
            stageMeta={groupedStageMeta}
            todayStr={todayStr}
            sortOrder={sortOrder}
            initialFilter={filter === "overdue" ? "overdue" : undefined}
            onRefresh={() => {
              qc.invalidateQueries({ queryKey: HATCH_BATCHES_LAB_QUERY_KEY });
              qc.invalidateQueries({ queryKey: ["hatch_batches_dash"] });
              onRefresh?.();
            }}
          />
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
  const fertility = b.net_eggs > 0 && b.candle1_fertile != null
    ? ((b.candle1_fertile / b.net_eggs) * 100).toFixed(1) + "%"
    : "—";
  const hatchRate = b.net_eggs > 0 && b.hatched_chicks
    ? ((b.hatched_chicks / b.net_eggs) * 100).toFixed(1) + "%"
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
            <Row label="المستبعد" value={fmtNum(damaged)} />
            {b.excluded_reason && <Row label="سبب الاستبعاد" value={b.excluded_reason} />}
            <Row label="الصافي الداخل للماكينة" value={fmtNum(b.net_eggs)} />

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
const emptyMotherFarmLot = () => ({
  owner_type: "capital_ostrich",
  source: "mother_farm",
  eggs_in: "",
  client_id: "",
  from_shipment_ids: [] as string[],
  from_farm_transfer_ids: [] as string[],
  max_eggs: null as number | null,
  shipment_label: "",
});

const HATCHERY_INTAKE_START_TRANSFER_BATCH_ID = "5d5ca4a9-86e3-4360-a1ef-e0389e6b672a";
const HATCHERY_INTAKE_START_CREATED_DATE = "2026-06-20";

const isActiveHatcheryIntakeBatch = (g: any) =>
  g.transfer_batch_id === HATCHERY_INTAKE_START_TRANSFER_BATCH_ID ||
  String(g.latest_created_at || "").slice(0, 10) >= HATCHERY_INTAKE_START_CREATED_DATE;

const NewBatchDialog = ({ open, onClose, clients, onSaved }: any) => {
  const queryClient = useQueryClient();
  const [entry_date, setEntryDate] = useState(today());
  const [batch_type, setBatchType] = useState<"internal" | "external" | "mixed">("mixed");
  const [machine, setMachine] = useState("");
  const [notes, setNotes] = useState("");
  const [lots, setLots] = useState<any[]>([emptyMotherFarmLot()]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLots([emptyMotherFarmLot()]);
    queryClient.removeQueries({ queryKey: ["pending_farm_transfer_batches_for_new_batch"] });
    queryClient.removeQueries({ queryKey: ["pending_official_farm_transfer_batches_for_new_batch"] });
    queryClient.removeQueries({ queryKey: ["orphan_farm_shipments_review_for_new_batch"] });
  }, [open, queryClient]);

  // Auto-numbering preview: next operational_batch_no for the lab batches screen
  const { data: nextOpNo } = useQuery<number>({
    queryKey: ["hatch_next_op_no"],
    queryFn: async () => {
      const { data } = await supabase
        .from("hatch_batches")
        .select("operational_batch_no")
        .eq("is_test", false)
        .not("operational_batch_no", "is", null)
        .order("operational_batch_no", { ascending: false })
        .limit(1)
        .maybeSingle();
      return ((data as any)?.operational_batch_no || 0) + 1;
    },
  });

  // وارد بيض المزرعة المتاح — دفعات رسمية فقط من farm_transfers ومجمعة حسب transfer_batch_id
  const { data: transferBatchesData = [], refetch: refetchShipments } = useQuery<any[]>({
    queryKey: ["pending_official_farm_transfer_batches_for_new_batch", open],
    enabled: !!open,
    queryFn: async () => {
      const { data: farmTransfers, error: ftError } = await (supabase as any)
        .from("farm_transfers")
        .select("id, transfer_date, family_id, quantity, notes, created_at, transfer_batch_id")
        .not("transfer_batch_id", "is", null)
        .order("transfer_date", { ascending: false })
        .order("created_at", { ascending: false })
        .order("transfer_batch_id", { ascending: true })
        .limit(2000);
      if (ftError) throw ftError;

      const { data: shipRows, error } = await (supabase as any)
        .from("farm_to_hatchery_shipments")
        .select("id, production_date, egg_count, family_number, created_at, status, hatch_batch_id, farm_transfer_id, transfer_batch_id")
        .eq("is_test", false)
        .limit(2000);
      if (error) throw error;
      const allShipments = shipRows || [];
      const transfers = (farmTransfers || []).filter((ft: any) => !!ft.transfer_batch_id);
      if (!transfers.length) return [];

      // لا تدخل أي شحنة يتيمة في البانر/التحميل: الشحنات الرسمية فقط هي المرتبطة بسجل farm_transfer_id
      const officialLinkedShipments = allShipments.filter((s: any) => !!s.farm_transfer_id);

      // index official shipments by transfer_batch_id (primary) and farm_transfer_id (legacy)
      const shipmentsByBatchId = new Map<string, any[]>();
      const shipmentsByTransferId = new Map<string, any[]>();
      officialLinkedShipments.forEach((s: any) => {
        if (s.transfer_batch_id) {
          const arr = shipmentsByBatchId.get(s.transfer_batch_id) || [];
          arr.push(s);
          shipmentsByBatchId.set(s.transfer_batch_id, arr);
        }
        if (s.farm_transfer_id) {
          const arr = shipmentsByTransferId.get(s.farm_transfer_id) || [];
          arr.push(s);
          shipmentsByTransferId.set(s.farm_transfer_id, arr);
        }
      });

      const groups = new Map<string, any>();

      // المصدر الوحيد للبانر والتحميل: farm_transfers الرسمية ذات transfer_batch_id
      for (const ft of transfers) {
        // اربط الشحنات المرتبطة بهذه الدفعة (إن وُجدت) للتحقق إن لم تُستلم/تُربط بدفعة تفريخ
        const linkedShipments = [
          ...(ft.transfer_batch_id ? (shipmentsByBatchId.get(ft.transfer_batch_id) || []) : []),
          ...(shipmentsByTransferId.get(ft.id) || []),
        ];
        const dedup = Array.from(new Map(linkedShipments.map((s: any) => [s.id, s])).values());
        const blocking = dedup.some((s: any) => s.status !== "pending" || s.hatch_batch_id);
        if (blocking) continue;

        const key = `tb:${ft.transfer_batch_id}`;
        let g = groups.get(key);
        if (!g) {
          g = {
            key,
            transfer_batch_id: ft.transfer_batch_id,
            label: ft.notes || `دفعة نقل ${ft.transfer_date}`,
            shipments: [] as any[],
            farm_transfer_ids: [] as string[],
            total_eggs: 0,
            min_date: ft.transfer_date,
            max_date: ft.transfer_date,
            transfer_date: ft.created_at ? String(ft.created_at).slice(0, 10) : ft.transfer_date,
            transfer_sort_date: ft.transfer_date,
            latest_created_at: ft.created_at,
            source: "farm_transfers" as const,
          };
          groups.set(key, g);
        }
        g.farm_transfer_ids.push(ft.id);
        dedup.forEach((s: any) => {
          if (!g.shipments.some((x: any) => x.id === s.id)) g.shipments.push(s);
        });
        g.total_eggs += Number(ft.quantity) || 0;
        if (ft.transfer_date < g.min_date) g.min_date = ft.transfer_date;
        if (ft.transfer_date > g.max_date) g.max_date = ft.transfer_date;
        if (ft.transfer_date > g.transfer_sort_date) g.transfer_sort_date = ft.transfer_date;
        if (ft.created_at > g.latest_created_at) g.latest_created_at = ft.created_at;
        g.transfer_date = g.latest_created_at ? String(g.latest_created_at).slice(0, 10) : g.transfer_sort_date;
      }

      // الترتيب الرسمي فقط: transfer_date desc ثم created_at desc ثم transfer_batch_id
      const sortedGroups = Array.from(groups.values()).filter((g) => g.total_eggs > 0).sort((a, b) => {
        const dCmp = String(b.transfer_sort_date || "").localeCompare(String(a.transfer_sort_date || ""));
        if (dCmp !== 0) return dCmp;
        const cCmp = String(b.latest_created_at || "").localeCompare(String(a.latest_created_at || ""));
        if (cCmp !== 0) return cCmp;
        return String(a.transfer_batch_id || "").localeCompare(String(b.transfer_batch_id || ""));
      });
      return sortedGroups.map((g) => ({
        ...g,
        hatchery_intake_state: isActiveHatcheryIntakeBatch(g) ? "active" : "excluded_from_hatchery_intake",
      }));
    },
  });

  const { data: orphanShipmentsData = [] } = useQuery<any[]>({
    queryKey: ["orphan_farm_shipments_review_for_new_batch", open],
    enabled: !!open,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("farm_to_hatchery_shipments")
        .select("id, production_date, egg_count, created_at, status, hatch_batch_id, farm_transfer_id, transfer_batch_id")
        .eq("is_test", false)
        .eq("status", "pending")
        .is("hatch_batch_id", null)
        .is("transfer_batch_id", null)
        .is("farm_transfer_id", null)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data || [];
    },
  });

  // المجموعات المختارة بالفعل في lots (لمنع التكرار)
  const usedShipmentIds = useMemo(() => {
    const s = new Set<string>();
    lots.forEach((l) => (l.from_shipment_ids || []).forEach((id: string) => s.add(id)));
    return s;
  }, [lots]);

  const usedFarmTransferIds = useMemo(() => {
    const s = new Set<string>();
    lots.forEach((l) => (l.from_farm_transfer_ids || []).forEach((id: string) => s.add(id)));
    return s;
  }, [lots]);

  const availableTransferBatches = useMemo(
    () => transferBatchesData.filter((g) =>
      g.hatchery_intake_state === "active" &&
      (g.shipments || []).every((s: any) => !usedShipmentIds.has(s.id)) &&
      (g.farm_transfer_ids || []).every((id: string) => !usedFarmTransferIds.has(id))
    ),
    [transferBatchesData, usedShipmentIds, usedFarmTransferIds]
  );

  const excludedHistoricalTransferBatches = useMemo(
    () => transferBatchesData.filter((g) => g.hatchery_intake_state === "excluded_from_hatchery_intake"),
    [transferBatchesData]
  );

  // آخر دفعة نقل فقط (للعرض في البانر)
  const latestTransferBatch = useMemo(
    () => availableTransferBatches[0] || null,
    [availableTransferBatches]
  );

  useEffect(() => {
    if (!open || !latestTransferBatch) return;
    console.info("[HatcheryLab] تشخيص وارد المزرعة الرسمي", {
      bannerBatch: latestTransferBatch.label,
      transfer_batch_id: latestTransferBatch.transfer_batch_id,
      total_eggs: latestTransferBatch.total_eggs,
      transfer_date: latestTransferBatch.transfer_date,
        intake_start_transfer_batch_id: HATCHERY_INTAKE_START_TRANSFER_BATCH_ID,
      production_period: `${latestTransferBatch.min_date} → ${latestTransferBatch.max_date}`,
      orphan_shipments_excluded_from_banner: true,
      orphan_shipments_count: orphanShipmentsData.length,
        historical_batches_excluded_count: excludedHistoricalTransferBatches.length,
      official_batches_in_dropdown: availableTransferBatches.map((g) => ({
        transfer_batch_id: g.transfer_batch_id,
        total_eggs: g.total_eggs,
        transfer_date: g.transfer_date,
        production_period: `${g.min_date} → ${g.max_date}`,
      })),
      target_35_batch_visible: availableTransferBatches.some(
        (g) => g.transfer_batch_id === "5d5ca4a9-86e3-4360-a1ef-e0389e6b672a" && Number(g.total_eggs) === 35
      ),
    });
  }, [open, latestTransferBatch, availableTransferBatches, orphanShipmentsData.length, excludedHistoricalTransferBatches.length]);

  const loadTransferBatchIntoLot = (lotIndex: number, key: string) => {
    const g = transferBatchesData.find((x) => x.key === key);
    if (!g) return;
    if (g.hatchery_intake_state !== "active") {
      toast.error("هذه دفعة تاريخية مستبعدة من وارد التفريخ الجديد");
      return;
    }
    if (g.source !== "farm_transfers" || !g.transfer_batch_id || !(g.farm_transfer_ids || []).length) {
      toast.error("لا يمكن تحميل شحنة يتيمة أو غير رسمية تلقائياً");
      return;
    }
    const periodLabel = g.min_date === g.max_date ? g.min_date : `${g.min_date} → ${g.max_date}`;
    setLots((prev) =>
      prev.map((l, j) =>
        j === lotIndex
          ? {
              ...l,
              owner_type: "capital_ostrich",
              source: "mother_farm",
              eggs_in: String(g.total_eggs),
              client_id: "",
              from_shipment_ids: g.shipments.map((s: any) => s.id),
              from_farm_transfer_ids: g.farm_transfer_ids || [],
              max_eggs: g.total_eggs,
              shipment_label: `نقل ${g.transfer_date} · ${g.total_eggs} بيضة · فترة ${periodLabel}`,
            }
          : l
      )
    );
  };

  // زر "تحميل وارد المزرعة" — يحمّل آخر دفعة نقل pending فقط
  const loadLatestFarmShipment = () => {
    if (!latestTransferBatch) {
      toast.info("لا توجد دفعات نقل من المزرعة متاحة حالياً");
      return;
    }
    if (latestTransferBatch.hatchery_intake_state !== "active") {
      toast.error("لا يمكن تحميل دفعة تاريخية مستبعدة من وارد التفريخ الجديد");
      return;
    }
    if (latestTransferBatch.source !== "farm_transfers" || !latestTransferBatch.transfer_batch_id) {
      toast.error("لا يمكن تحميل شحنة غير رسمية من وارد المزرعة");
      return;
    }
    const emptyIdx = lots.findIndex(
      (l) => (!l.from_shipment_ids || l.from_shipment_ids.length === 0) && (!l.eggs_in || +l.eggs_in === 0) && !l.client_id
    );
    if (emptyIdx >= 0) {
      loadTransferBatchIntoLot(emptyIdx, latestTransferBatch.key);
    } else {
      setLots((prev) => [
        ...prev,
        {
          owner_type: "capital_ostrich",
          source: "mother_farm",
          eggs_in: "",
          client_id: "",
          from_shipment_ids: [],
          from_farm_transfer_ids: [],
          max_eggs: null,
          shipment_label: "",
        },
      ]);
      // حمّل في الصف الجديد بعد إضافته
      setTimeout(() => loadTransferBatchIntoLot(lots.length, latestTransferBatch.key), 0);
    }
    toast.success(`تم تحميل آخر دفعة نقل — ${latestTransferBatch.total_eggs} بيضة`);
  };

  const addLot = () => setLots([...lots, { owner_type: "external_client", source: "external", eggs_in: "", client_id: "", from_shipment_ids: [], from_farm_transfer_ids: [], max_eggs: null, shipment_label: "" }]);
  const removeLot = (i: number) => setLots(lots.filter((_, j) => j !== i));
  const updateLot = (i: number, patch: any) => setLots(lots.map((l, j) => j === i ? { ...l, ...patch } : l));

  const save = async () => {
    if (saving) return;
    if (!entry_date || !batch_type) return toast.error("بيانات ناقصة");
    if (lots.some(l => !l.eggs_in || +l.eggs_in <= 0)) return toast.error("أدخل عدد البيض لكل lot");
    if (lots.some(l => l.owner_type === "external_client" && !l.client_id)) return toast.error("اختر عميل للـ lot الخارجي");
    // تحقق ألا يتجاوز عدد البيض الكمية المتاحة في دفعة النقل المرتبطة
    for (const l of lots) {
      if (((l.from_shipment_ids?.length || 0) > 0 || (l.from_farm_transfer_ids?.length || 0) > 0) && l.max_eggs != null && +l.eggs_in > +l.max_eggs) {
        return toast.error(`عدد البيض في دفعة النقل (${l.shipment_label}) لا يجب أن يتجاوز ${l.max_eggs}`);
      }
    }
    // منع تكرار نفس الشحنة في أكثر من lot
    const allShipIds = lots.flatMap((l) => l.from_shipment_ids || []);
    if (new Set(allShipIds).size !== allShipIds.length) {
      return toast.error("لا يمكن استخدام نفس دفعة نقل المزرعة في أكثر من lot");
    }
    const allFarmTransferIds = lots.flatMap((l) => l.from_farm_transfer_ids || []);
    if (new Set(allFarmTransferIds).size !== allFarmTransferIds.length) {
      return toast.error("لا يمكن استخدام نفس مجموعة نقل المزرعة في أكثر من lot");
    }
    setSaving(true);
    try {
      const userId = (await supabase.auth.getUser()).data.user?.id;

      // re-check shipments are still pending
      if (allShipIds.length) {
        const { data: stillPending } = await (supabase as any)
          .from("farm_to_hatchery_shipments")
          .select("id, status, hatch_batch_id")
          .in("id", allShipIds);
        const blocked = (stillPending || []).filter((s: any) => s.status !== "pending" || s.hatch_batch_id);
        if (blocked.length) {
          toast.error("إحدى الشحنات تم استخدامها بالفعل في دفعة أخرى. يرجى إعادة فتح النافذة.");
          await refetchShipments();
          return;
        }
      }
      if (allFarmTransferIds.length) {
        const { data: linkedTransfers } = await (supabase as any)
          .from("farm_to_hatchery_shipments")
          .select("id, farm_transfer_id, status, hatch_batch_id")
          .in("farm_transfer_id", allFarmTransferIds);
        const blocked = (linkedTransfers || []).filter((s: any) => s.status !== "pending" || s.hatch_batch_id);
        if (blocked.length) {
          toast.error("إحدى مجموعات النقل تم استخدامها بالفعل في دفعة أخرى. يرجى إعادة فتح النافذة.");
          await refetchShipments();
          return;
        }
      }

      // 1) Create logical batch in hatchery_batches with its lots
      const { data: batch, error } = await supabase.from("hatchery_batches" as any)
        .insert({ entry_date, batch_type, incubator_machine_no: machine || null, notes: notes || null, created_by: userId })
        .select().single();
      if (error) { toast.error(error.message); return; }

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
      if (e2) { toast.error(e2.message); return; }

      // 2) Mirror into hatch_batches
      const { data: maxRow } = await supabase
        .from("hatch_batches")
        .select("operational_batch_no")
        .eq("is_test", false)
        .not("operational_batch_no", "is", null)
        .order("operational_batch_no", { ascending: false })
        .limit(1)
        .maybeSingle();
      const opNo = (((maxRow as any)?.operational_batch_no as number) || 0) + 1;

      const { data: internal } = await supabase
        .from("hatch_customers")
        .select("id")
        .eq("customer_type", "internal")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      const internalId = (internal as any)?.id || null;

      const ts = Date.now();
      const hatchRows = lots.map((l, idx) => ({
        batch_number: `HB-${opNo.toString().padStart(5, "0")}-${ts}-${idx}`,
        operational_batch_no: opNo,
        receive_date: entry_date,
        entry_date,
        machine: machine || null,
        received_eggs: +l.eggs_in,
        net_eggs: +l.eggs_in,
        customer_id: l.owner_type === "external_client" ? l.client_id : internalId,
        status: "pending",
        notes: ((l.from_shipment_ids?.length || 0) > 0 || (l.from_farm_transfer_ids?.length || 0) > 0)
          ? [notes, `منقولة من مزرعة الأمهات (${l.shipment_label})`].filter(Boolean).join(" — ")
          : (notes || null),
        created_by: userId,
        is_test: false,
      }));
      const { data: insertedHatch, error: e3 } = await supabase
        .from("hatch_batches")
        .insert(hatchRows as any)
        .select("id");
      if (e3) { toast.error(`فشل إنشاء سجل الدفعة في شاشة المعمل: ${e3.message}`); return; }

      // 3) ربط مجموعة نقل المزرعة الكاملة بسجل hatch_batches وتحديث حالتها إلى received
      for (let i = 0; i < lots.length; i++) {
        const l = lots[i];
        const ids: string[] = l.from_shipment_ids || [];
        const transferIds: string[] = l.from_farm_transfer_ids || [];
        if (!ids.length && !transferIds.length) continue;
        const hbId = (insertedHatch as any[])?.[i]?.id;
        if (!hbId) continue;
        if (transferIds.length) {
          const { data: existingShipments } = await (supabase as any)
            .from("farm_to_hatchery_shipments")
            .select("id, farm_transfer_id, transfer_batch_id")
            .in("farm_transfer_id", transferIds);
          const existingTransferIds = new Set((existingShipments || []).map((s: any) => s.farm_transfer_id).filter(Boolean));
          const existingIds = (existingShipments || []).map((s: any) => s.id);
          const missingTransferIds = transferIds.filter((id) => !existingTransferIds.has(id));

          if (missingTransferIds.length) {
            const { data: transferRows } = await (supabase as any)
              .from("farm_transfers")
              .select("id, transfer_date, family_id, quantity, transfer_batch_id")
              .in("id", missingTransferIds);
            const familyIds = Array.from(new Set((transferRows || []).map((r: any) => r.family_id).filter(Boolean))) as string[];
            const familyMap = new Map<string, string>();
            if (familyIds.length) {
              const { data: fams } = await supabase.from("farm_families").select("id, family_number").in("id", familyIds);
              (fams || []).forEach((f: any) => familyMap.set(f.id, String(f.family_number)));
            }
            // Prefer the actual transfer_batch_id from farm_transfers (so سجل النقل في المزرعة يبقى متطابق)
            const transferBatchId =
              (transferRows || []).find((r: any) => r.transfer_batch_id)?.transfer_batch_id ||
              (existingShipments || []).find((s: any) => s.transfer_batch_id)?.transfer_batch_id ||
              (crypto as any).randomUUID?.() || null;
            const newShipmentRows = (transferRows || []).map((r: any) => ({
              farm_transfer_id: r.id,
              transfer_batch_id: transferBatchId,
              family_id: r.family_id,
              family_number: familyMap.get(r.family_id) || null,
              production_date: r.transfer_date,
              egg_count: r.quantity,
              status: "received",
              hatch_batch_id: hbId,
              received_at: new Date().toISOString(),
              received_by: userId,
              receipt_notes: `تم ربطها بدفعة تفريخ رقم ${opNo}`,
              is_test: false,
            }));
            if (newShipmentRows.length) {
              await (supabase as any).from("farm_to_hatchery_shipments").insert(newShipmentRows);
            }
          }

          ids.push(...existingIds.filter((id: string) => !ids.includes(id)));
        }
        if (!ids.length) continue;
        await (supabase as any)
          .from("farm_to_hatchery_shipments")
          .update({
            status: "received",
            hatch_batch_id: hbId,
            received_at: new Date().toISOString(),
            received_by: userId,
            receipt_notes: `تم ربطها بدفعة تفريخ رقم ${opNo}`,
          })
          .in("id", ids)
          .eq("status", "pending")
          .is("hatch_batch_id", null);
      }

      await supabase.from("hatchery_batch_movements" as any).insert({
        batch_id: (batch as any).id, event_type: "created",
        payload: {
          lots_count: lots.length,
          total_eggs: lots.reduce((s, l) => s + +l.eggs_in, 0),
          operational_batch_no: opNo,
          auto_numbered: true,
          linked_farm_shipments: allShipIds,
        },
        created_by: userId,
      });
      toast.success(`تم إنشاء الدفعة رقم ${opNo}`);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            دفعة تفريخ جديدة
            {nextOpNo != null && (
              <Badge variant="secondary" className="mr-2">رقم الدفعة التلقائي: {nextOpNo}</Badge>
            )}
          </DialogTitle>
        </DialogHeader>
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

          {/* بانر آخر دفعة نقل من المزرعة */}
          {latestTransferBatch && (
            <div className="border rounded-lg p-3 bg-purple-50 dark:bg-purple-950/20 border-purple-200 flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm">
                <div className="font-bold text-purple-700 dark:text-purple-300">
                  بيض نعام العاصمة — مزرعة الأمهات
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  آخر دفعة نقل: <b>{latestTransferBatch.total_eggs.toLocaleString()}</b> بيضة
                  · تاريخ النقل: {latestTransferBatch.transfer_date}
                  {latestTransferBatch.min_date !== latestTransferBatch.max_date && (
                    <> · فترة الإنتاج: {latestTransferBatch.min_date} → {latestTransferBatch.max_date}</>
                  )}
                  <span className="mx-1">·</span>
                  <span className="text-amber-700">وارد من المزرعة / غير مستلم في دفعة</span>
                  {availableTransferBatches.length > 1 && (
                    <span className="mr-2 text-muted-foreground">
                      (+{availableTransferBatches.length - 1} دفعة نقل سابقة متاحة في القائمة)
                    </span>
                  )}
                </div>
              </div>
              <Button size="sm" variant="default" onClick={loadLatestFarmShipment}>
                <Plus className="w-3 h-3 ml-1" />تحميل وارد المزرعة
              </Button>
            </div>
          )}

          {latestTransferBatch && (
            <div className="rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground">
              <b>تقرير تشخيص وارد المزرعة:</b> بداية التشغيل من دفعة {HATCHERY_INTAKE_START_TRANSFER_BATCH_ID} · الدفعة المعروضة {latestTransferBatch.transfer_batch_id} · الإجمالي {latestTransferBatch.total_eggs} بيضة · الدفعات القديمة مستبعدة من وارد التفريخ الجديد · الشحنات اليتيمة مستبعدة من البانر والتحميل التلقائي · دفعة 35 بيضة {availableTransferBatches.some((g) => g.transfer_batch_id === "5d5ca4a9-86e3-4360-a1ef-e0389e6b672a" && Number(g.total_eggs) === 35) ? "ظاهرة في القائمة" : "غير ظاهرة في القائمة"}
            </div>
          )}

          <div className="border-t pt-3">
            <div className="flex justify-between items-center mb-2">
              <h4 className="font-bold">حصص الدفعة (Lots)</h4>
              <Button size="sm" variant="outline" onClick={addLot}><Plus className="w-3 h-3 ml-1" />إضافة Lot</Button>
            </div>
            <div className="space-y-2">
              {lots.map((l, i) => {
                const lotSelectedIds = new Set(l.from_shipment_ids || []);
                const lotSelectedTransferIds = new Set(l.from_farm_transfer_ids || []);
                const availableForLot = transferBatchesData.filter(
                  (g) =>
                    g.hatchery_intake_state === "active" &&
                    ((((g.shipments || []).length > 0 && g.shipments.every((s: any) => lotSelectedIds.has(s.id))) ||
                      ((g.farm_transfer_ids || []).length > 0 && g.farm_transfer_ids.every((id: string) => lotSelectedTransferIds.has(id)))) ||
                    ((g.shipments || []).every((s: any) => !usedShipmentIds.has(s.id)) &&
                      (g.farm_transfer_ids || []).every((id: string) => !usedFarmTransferIds.has(id))))
                );
                const currentKey =
                  (l.from_shipment_ids || []).length > 0 || (l.from_farm_transfer_ids || []).length > 0
                    ? transferBatchesData.find((g) =>
                        ((g.shipments || []).length > 0 && g.shipments.every((s: any) => lotSelectedIds.has(s.id))) ||
                        ((g.farm_transfer_ids || []).length > 0 && g.farm_transfer_ids.every((id: string) => lotSelectedTransferIds.has(id)))
                      )?.key || ""
                    : "";
                return (
                <Card key={i} className="p-3">
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2 items-end">
                    <div><Label>المالك</Label>
                      <Select value={l.owner_type} onValueChange={v => updateLot(i, { owner_type: v, source: v === "capital_ostrich" ? "mother_farm" : "external", from_shipment_ids: v === "capital_ostrich" ? l.from_shipment_ids : [], from_farm_transfer_ids: v === "capital_ostrich" ? l.from_farm_transfer_ids : [], max_eggs: v === "capital_ostrich" ? l.max_eggs : null, shipment_label: v === "capital_ostrich" ? l.shipment_label : "" })}>
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
                    {l.owner_type === "capital_ostrich" && availableForLot.length > 0 && (
                      <div><Label>وارد بيض المزرعة المتاح</Label>
                        <Select
                          value={currentKey}
                          onValueChange={(v) => loadTransferBatchIntoLot(i, v)}
                        >
                          <SelectTrigger><SelectValue placeholder="اختر دفعة نقل..." /></SelectTrigger>
                          <SelectContent>
                            {availableForLot.map((g) => {
                              const period =
                                g.min_date === g.max_date
                                  ? g.min_date
                                  : `${g.min_date} → ${g.max_date}`;
                              return (
                                <SelectItem key={g.key} value={g.key}>
                                  نقل {g.transfer_date} — {g.total_eggs} بيضة · فترة الإنتاج: {period}
                                </SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <div>
                      <Label>عدد البيض{l.max_eggs != null && <span className="text-xs text-muted-foreground"> (حد أقصى {l.max_eggs})</span>}</Label>
                      <Input
                        type="number"
                        value={l.eggs_in}
                        max={l.max_eggs ?? undefined}
                        onChange={e => updateLot(i, { eggs_in: e.target.value })}
                      />
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => removeLot(i)} disabled={lots.length === 1}><X className="w-4 h-4" /></Button>
                  </div>
                  {((l.from_shipment_ids?.length || 0) > 0 || (l.from_farm_transfer_ids?.length || 0) > 0) && (
                    <div className="mt-2 text-xs text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/20 rounded px-2 py-1">
                      منقولة من مزرعة الأمهات — {l.shipment_label}
                    </div>
                  )}
                </Card>
              );})}
            </div>
          </div>

          {/* قسم "شحنات قديمة / تحتاج مراجعة" أُخفي من نافذة دفعة تفريخ جديدة بناءً على طلب المستخدم.
              الدفعات المستبعدة والشحنات اليتيمة ما زالت محفوظة في قاعدة البيانات وتظهر في سجل نقل البيض/الأرشيف فقط. */}

        </div>
        <DialogFooter><Button onClick={save} disabled={saving}>{saving ? "جاري الحفظ..." : "حفظ الدفعة"}</Button></DialogFooter>
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
                        {l.hatcher_out_at && !l.brooding_in_at && !l.brooding_out_at && <Button size="sm" variant="outline" onClick={() => openAction(l, "brooding_in")}>حضانة</Button>}
                        {l.hatcher_out_at && !l.brooding_out_at && <Button size="sm" variant="default" onClick={() => openAction(l, "deliver")}>تسليم للعميل</Button>}
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
      // Brooding period starts at HATCH date (hatcher_out_at), fallback to brooding_in_at; inclusive day count (+1)
      const startISO = lot.hatcher_out_at || lot.brooding_in_at;
      const startDate = startISO ? new Date(startISO) : out;
      const dayMs = 86400000;
      const startDay = Math.floor(startDate.getTime() / dayMs);
      const endDay = Math.floor(out.getTime() / dayMs);
      const days = Math.max(1, endDay - startDay + 1);
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
