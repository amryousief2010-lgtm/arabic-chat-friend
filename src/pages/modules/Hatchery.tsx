import { useMemo, useState } from "react";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  FlaskConical, Plus, Users, Wrench, Bird, Activity, TrendingUp, Trash2, Pencil, AlertTriangle, BarChart3, Inbox, Bell, DollarSign,
} from "lucide-react";
import FarmShipmentsInbox from "@/components/hatchery/FarmShipmentsInbox";
import { toast } from "sonner";
import { format, addDays, differenceInDays, parseISO } from "date-fns";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from "recharts";

const today = () => format(new Date(), "yyyy-MM-dd");
const monthStart = () => { const d = new Date(); d.setDate(1); return format(d, "yyyy-MM-dd"); };

// ====== ثوابت ماكينات المعمل ======
export const MACHINES = [
  { id: "M1", name: "ماكينة 1", capacity: 720 },
  { id: "M2", name: "ماكينة 2", capacity: 720 },
  { id: "M3", name: "ماكينة 3", capacity: 120 },
];
export const HATCHER = { id: "HATCHER", name: "هاتشر", capacity: 120 };
// مراحل الدورة (بالأيام من تاريخ الدخول)
const STAGE_CANDLE1 = 15; // الكشف الأول
const STAGE_CANDLE2 = 30; // الكشف الثاني
const STAGE_EXIT = 42;    // الخروج للهاتشر
// تسعير العملاء الخارجيين (افتراضي)
const PRICE_INFERTILE = 50;   // غير مخصب (كشف 1)
const PRICE_DEAD2 = 100;      // ميت كشف 2
const PRICE_CHICK = 150;      // كتكوت ناتج
const PRICE_HATCHER_DEAD = 100; // نافق هاتشر
const PRICE_BROODING_PER_DAY = 10; // مبلغ التحضين عن كل يوم تأخير في الاستلام

const addDaysStr = (d: string, n: number) => d ? format(addDays(parseISO(d), n), "yyyy-MM-dd") : "";
const autoStatus = (entry: string): "pending" | "incubating" | "hatching" | "completed" => {
  if (!entry) return "pending";
  const age = differenceInDays(new Date(), parseISO(entry));
  if (age < 0) return "pending";
  if (age < STAGE_EXIT) return "incubating";
  if (age < STAGE_EXIT + 3) return "hatching";
  return "completed";
};

const Hatchery = () => {
  const qc = useQueryClient();

  const { data: customers = [] } = useQuery({
    queryKey: ["hatch_customers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("hatch_customers").select("*").order("name");
      if (error) throw error; return data || [];
    },
  });

  const { data: batches = [] } = useQuery({
    queryKey: ["hatch_batches"],
    queryFn: async () => {
      const { data, error } = await supabase.from("hatch_batches").select("*").order("receive_date", { ascending: false }).limit(1000);
      if (error) throw error; return data || [];
    },
  });

  const { data: ops = [] } = useQuery({
    queryKey: ["hatch_daily_ops"],
    queryFn: async () => {
      const { data, error } = await supabase.from("hatch_daily_ops").select("*").order("op_date", { ascending: false }).limit(500);
      if (error) throw error; return data || [];
    },
  });

  const { data: maint = [] } = useQuery({
    queryKey: ["hatch_maintenance"],
    queryFn: async () => {
      const { data, error } = await supabase.from("hatch_maintenance").select("*").order("maint_date", { ascending: false }).limit(500);
      if (error) throw error; return data || [];
    },
  });

  const { data: chicks = [] } = useQuery({
    queryKey: ["chick_movements"],
    queryFn: async () => {
      const { data, error } = await supabase.from("chick_movements").select("*").order("movement_date", { ascending: false }).limit(500);
      if (error) throw error; return data || [];
    },
  });

  const stats = useMemo(() => {
    const ms = monthStart();
    const completed = batches.filter((b: any) => b.status === "completed");
    const pending = batches.filter((b: any) => b.status !== "completed");

    const internalIds = new Set(customers.filter((c: any) => c.customer_type === "internal").map((c: any) => c.id));
    const internalDone = completed.filter((b: any) => internalIds.has(b.customer_id));
    const externalDone = completed.filter((b: any) => !internalIds.has(b.customer_id));

    const fertility = (arr: any[]) => {
      const net = arr.reduce((s, b: any) => s + (b.net_eggs || 0), 0);
      const fertile = arr.reduce((s, b: any) => s + (b.candle2_fertile || b.candle1_fertile || 0), 0);
      return net > 0 ? ((fertile / net) * 100).toFixed(1) : "0";
    };
    const conversion = (arr: any[]) => {
      const net = arr.reduce((s, b: any) => s + (b.net_eggs || 0), 0);
      const chicks = arr.reduce((s, b: any) => s + (b.hatched_chicks || 0), 0);
      return net > 0 ? ((chicks / net) * 100).toFixed(1) : "0";
    };
    const monthChicks = batches.filter((b: any) => b.exit_date && b.exit_date >= ms).reduce((s, b: any) => s + (b.hatched_chicks || 0), 0);
    const monthHatcherDead = batches.filter((b: any) => b.exit_date && b.exit_date >= ms).reduce((s, b: any) => s + (b.hatcher_dead || 0), 0);

    return {
      activeBatches: pending.length,
      completedBatches: completed.length,
      internalFertility: fertility(internalDone),
      externalFertility: fertility(externalDone),
      internalConversion: conversion(internalDone),
      externalConversion: conversion(externalDone),
      monthChicks,
      monthHatcherDead,
    };
  }, [batches, customers]);

  return (
    <DashboardLayout>
      <Header title="معمل التفريخ" subtitle="إدارة الدفعات والكشف والفقس وحركة الكتاكيت" />

      <div className="p-4 space-y-4 max-w-7xl mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPI icon={FlaskConical} label="دفعات نشطة" value={stats.activeBatches} sub={`مكتملة: ${stats.completedBatches}`} color="from-cyan-500 to-cyan-700" />
          <KPI icon={TrendingUp} label="خصوبة العاصمة" value={`${stats.internalFertility}%`} sub={`الآخرون: ${stats.externalFertility}%`} color="from-purple-500 to-purple-700" />
          <KPI icon={Bird} label="كتاكيت الشهر" value={stats.monthChicks} sub={`تحول داخلي: ${stats.internalConversion}%`} color="from-orange-500 to-orange-700" />
          <KPI icon={AlertTriangle} label="نافق هاتشر/شهر" value={stats.monthHatcherDead} color="from-red-500 to-red-700" />
        </div>

        <Tabs defaultValue="incoming" dir="rtl">
          <TabsList className="grid grid-cols-2 md:grid-cols-8 w-full">
            <TabsTrigger value="incoming"><Inbox className="w-4 h-4 ml-1" />وارد المزرعة</TabsTrigger>
            <TabsTrigger value="batches"><FlaskConical className="w-4 h-4 ml-1" />الدفعات</TabsTrigger>
            <TabsTrigger value="charts"><BarChart3 className="w-4 h-4 ml-1" />تحليلات</TabsTrigger>
            <TabsTrigger value="quality"><TrendingUp className="w-4 h-4 ml-1" />الجودة</TabsTrigger>
            <TabsTrigger value="customers"><Users className="w-4 h-4 ml-1" />العملاء</TabsTrigger>
            <TabsTrigger value="ops"><Activity className="w-4 h-4 ml-1" />التشغيل</TabsTrigger>
            <TabsTrigger value="maint"><Wrench className="w-4 h-4 ml-1" />الصيانة</TabsTrigger>
            <TabsTrigger value="chicks"><Bird className="w-4 h-4 ml-1" />الكتاكيت</TabsTrigger>
          </TabsList>

          <TabsContent value="incoming"><FarmShipmentsInbox /></TabsContent>
          <TabsContent value="batches"><BatchesTab batches={batches} customers={customers} qc={qc} /></TabsContent>
          <TabsContent value="charts"><BatchesChartsTab batches={batches} customers={customers} /></TabsContent>
          <TabsContent value="quality"><QualityTab stats={stats} /></TabsContent>
          <TabsContent value="customers"><CustomersTab customers={customers} batches={batches} qc={qc} /></TabsContent>
          <TabsContent value="ops"><OpsTab ops={ops} qc={qc} /></TabsContent>
          <TabsContent value="maint"><MaintTab maint={maint} qc={qc} /></TabsContent>
          <TabsContent value="chicks"><ChicksTab chicks={chicks} qc={qc} /></TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
};

const KPI = ({ icon: Icon, label, value, sub, color }: any) => (
  <Card className="relative overflow-hidden border-0 shadow-md">
    <div className={`absolute inset-0 bg-gradient-to-br ${color} opacity-95`} />
    <div className="relative p-4 text-white">
      <div className="flex items-center gap-2 mb-2"><Icon className="w-4 h-4" /><span className="text-xs opacity-90">{label}</span></div>
      <p className="text-2xl font-bold">{value}</p>
      {sub && <p className="text-xs opacity-80 mt-1">{sub}</p>}
    </div>
  </Card>
);

// ============ BATCHES ============
const emptyBatch = () => {
  const entry = today();
  return {
    batch_number: `BATCH-${Date.now()}`, receive_date: today(), customer_id: "", machine: "M1",
    received_eggs: 0, net_eggs: 0, entry_date: entry,
    candle1_date: addDaysStr(entry, STAGE_CANDLE1), candle1_fertile: 0, candle1_infertile: 0,
    candle2_date: addDaysStr(entry, STAGE_CANDLE2), candle2_fertile: 0, candle2_dead: 0,
    exit_date: addDaysStr(entry, STAGE_EXIT), hatched_chicks: 0, hatcher_dead: 0,
    pickup_date: "", brooding_days: 0, brooding_fee: 0,
    status: "pending", notes: "",
  };
};

const BatchesTab = ({ batches, customers, qc }: any) => {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>(emptyBatch());

  // مزامنة تواريخ المراحل تلقائياً عند تغيير تاريخ الدخول
  const setEntry = (entry: string) => {
    setForm((f: any) => ({
      ...f,
      entry_date: entry,
      candle1_date: addDaysStr(entry, STAGE_CANDLE1),
      candle2_date: addDaysStr(entry, STAGE_CANDLE2),
      exit_date: addDaysStr(entry, STAGE_EXIT),
      status: autoStatus(entry),
    }));
  };

  // إشغال الماكينات حسب الدفعات النشطة
  const machineUsage = useMemo(() => {
    const map: Record<string, number> = { M1: 0, M2: 0, M3: 0 };
    batches.forEach((b: any) => {
      if (b.status !== "completed" && b.machine && map[b.machine] !== undefined) {
        // استبعاد الدفعة قيد التعديل من الحساب
        if (editing && b.id === editing.id) return;
        map[b.machine] += b.net_eggs || b.received_eggs || 0;
      }
    });
    return map;
  }, [batches, editing]);

  const machineUsageActual = useMemo(() => {
    const map: Record<string, number> = { M1: 0, M2: 0, M3: 0 };
    batches.forEach((b: any) => {
      if (b.status !== "completed" && b.machine && map[b.machine] !== undefined) {
        map[b.machine] += b.net_eggs || b.received_eggs || 0;
      }
    });
    return map;
  }, [batches]);

  const selectedMachine = MACHINES.find((m) => m.id === form.machine);
  const machineUsed = selectedMachine ? machineUsage[selectedMachine.id] || 0 : 0;
  const machineActualUsed = selectedMachine ? machineUsageActual[selectedMachine.id] || 0 : 0;
  const currentBatchEggs = form.net_eggs || form.received_eggs || 0;
  const projectedMachineUsed = machineUsed + currentBatchEggs;
  const machineFree = selectedMachine ? selectedMachine.capacity - machineUsed : 0;
  const machineOver = selectedMachine ? projectedMachineUsed > selectedMachine.capacity : false;
  const machineCapacityBlocked = selectedMachine
    ? projectedMachineUsed > selectedMachine.capacity && projectedMachineUsed > machineActualUsed
    : false;

  // العميل الحالي (لحساب الفواتير الخارجية)
  const currentCustomer = customers.find((c: any) => c.id === form.customer_id);
  const isExternal = currentCustomer && currentCustomer.customer_type !== "internal";
  const broodingDays = useMemo(() => {
    if (!form.exit_date || !form.pickup_date) return 0;
    const ex = new Date(form.exit_date).getTime();
    const pu = new Date(form.pickup_date).getTime();
    const d = Math.floor((pu - ex) / (1000 * 60 * 60 * 24));
    return Math.max(0, d);
  }, [form.exit_date, form.pickup_date]);

  const billing = useMemo(() => {
    if (!isExternal) return null;
    const infertile = (form.candle1_infertile || 0) * (currentCustomer.infertile_price || PRICE_INFERTILE);
    const dead2 = (form.candle2_dead || 0) * PRICE_DEAD2;
    const chicks = (form.hatched_chicks || 0) * (currentCustomer.incubation_price || PRICE_CHICK);
    const hatcherDead = (form.hatcher_dead || 0) * (currentCustomer.hatcher_price || PRICE_HATCHER_DEAD);
    const brooding = broodingDays * PRICE_BROODING_PER_DAY;
    return { infertile, dead2, chicks, hatcherDead, brooding, broodingDays, total: infertile + dead2 + chicks + hatcherDead + brooding };
  }, [isExternal, form, currentCustomer, broodingDays]);

  const save = useMutation({
    mutationFn: async () => {
      if (machineCapacityBlocked) {
        throw new Error(`الماكينة ${selectedMachine?.name} ستتجاوز السعة ${selectedMachine?.capacity} بسبب هذا التعديل`);
      }
      const payload = { ...form, customer_id: form.customer_id || null,
        candle1_date: form.candle1_date || null, candle2_date: form.candle2_date || null,
        exit_date: form.exit_date || null, pickup_date: form.pickup_date || null,
        brooding_days: broodingDays, brooding_fee: broodingDays * PRICE_BROODING_PER_DAY };
      if (editing) {
        const { error } = await supabase.from("hatch_batches").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("hatch_batches").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => { toast.success("تم الحفظ"); setOpen(false); setEditing(null); setForm(emptyBatch()); qc.invalidateQueries({ queryKey: ["hatch_batches"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("hatch_batches").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { toast.success("حذف"); qc.invalidateQueries({ queryKey: ["hatch_batches"] }); },
  });

  const customerName = (id: string) => customers.find((c: any) => c.id === id)?.name || "-";

  const openEdit = (b: any) => { setEditing(b); setForm({ ...b, candle1_date: b.candle1_date || "", candle2_date: b.candle2_date || "", exit_date: b.exit_date || "", customer_id: b.customer_id || "", machine: b.machine || "M1" }); setOpen(true); };
  const openNew = () => { setEditing(null); setForm(emptyBatch()); setOpen(true); };

  const fertility = (b: any) => b.net_eggs > 0 ? (((b.candle2_fertile || b.candle1_fertile || 0) / b.net_eggs) * 100).toFixed(1) + "%" : "-";
  const conversion = (b: any) => b.net_eggs > 0 ? ((b.hatched_chicks / b.net_eggs) * 100).toFixed(1) + "%" : "-";

  // ====== إشعارات المراحل القادمة / المتأخرة ======
  const alerts = useMemo(() => {
    const list: { batch: any; type: string; label: string; days: number; severity: "due" | "soon" | "late" }[] = [];
    const now = new Date();
    batches.forEach((b: any) => {
      if (b.status === "completed" || !b.entry_date) return;
      const checks: { date: string | null; type: string; label: string; done: boolean }[] = [
        { date: b.candle1_date || addDaysStr(b.entry_date, STAGE_CANDLE1), type: "candle1", label: "الكشف الأول", done: !!b.candle1_fertile || !!b.candle1_infertile },
        { date: b.candle2_date || addDaysStr(b.entry_date, STAGE_CANDLE2), type: "candle2", label: "الكشف الثاني", done: !!b.candle2_fertile || !!b.candle2_dead },
        { date: b.exit_date || addDaysStr(b.entry_date, STAGE_EXIT), type: "exit", label: "الخروج للهاتشر", done: !!b.hatched_chicks },
      ];
      checks.forEach((c) => {
        if (!c.date || c.done) return;
        const diff = differenceInDays(parseISO(c.date), now);
        if (diff < -1) list.push({ batch: b, type: c.type, label: c.label, days: diff, severity: "late" });
        else if (diff <= 0) list.push({ batch: b, type: c.type, label: c.label, days: diff, severity: "due" });
        else if (diff <= 3) list.push({ batch: b, type: c.type, label: c.label, days: diff, severity: "soon" });
      });
    });
    return list.sort((a, b) => a.days - b.days);
  }, [batches]);

  const [search, setSearch] = useState("");
  const [fCustomer, setFCustomer] = useState("all");
  const [fStatus, setFStatus] = useState("all");
  const [fMachine, setFMachine] = useState("all");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");
  const filtered = useMemo(() => batches.filter((b: any) => {
    if (search && !b.batch_number.toLowerCase().includes(search.toLowerCase())) return false;
    if (fCustomer !== "all" && b.customer_id !== fCustomer) return false;
    if (fStatus !== "all" && b.status !== fStatus) return false;
    if (fMachine !== "all" && b.machine !== fMachine) return false;
    if (fFrom && b.receive_date < fFrom) return false;
    if (fTo && b.receive_date > fTo) return false;
    return true;
  }), [batches, search, fCustomer, fStatus, fMachine, fFrom, fTo]);

  return (
    <Card className="p-4">
      {/* ====== شريط الإشعارات الديناميكي ====== */}
      {alerts.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3">
          <div className="flex items-center gap-2 mb-2 text-amber-700 dark:text-amber-300 font-semibold">
            <Bell className="w-4 h-4" /> إشعارات المراحل القادمة ({alerts.length})
          </div>
          <div className="grid md:grid-cols-2 gap-2 max-h-40 overflow-auto">
            {alerts.slice(0, 12).map((a, i) => (
              <div key={i} className={`text-xs rounded p-2 flex items-center justify-between gap-2
                ${a.severity === "late" ? "bg-destructive/15 text-destructive" : a.severity === "due" ? "bg-orange-100 dark:bg-orange-950/30 text-orange-700 dark:text-orange-300" : "bg-cyan-50 dark:bg-cyan-950/20 text-cyan-700 dark:text-cyan-300"}`}>
                <span className="font-mono">{a.batch.batch_number}</span>
                <span>{a.label}</span>
                <Badge variant="outline">{a.batch.machine || "—"}</Badge>
                <span className="font-bold">{a.days < 0 ? `متأخر ${-a.days} يوم` : a.days === 0 ? "اليوم" : `بعد ${a.days} يوم`}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ====== شريط إشغال الماكينات ====== */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
        {MACHINES.map((m) => {
          const used = machineUsage[m.id] || 0;
          const pct = Math.min(100, Math.round((used / m.capacity) * 100));
          return (
            <Card key={m.id} className="p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-bold">{m.name}</span>
                <span className="text-xs text-muted-foreground">{used}/{m.capacity}</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div className={`h-full ${pct >= 100 ? "bg-destructive" : pct >= 80 ? "bg-orange-500" : "bg-emerald-500"}`} style={{ width: `${pct}%` }} />
              </div>
            </Card>
          );
        })}
        <Card className="p-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-bold">{HATCHER.name}</span>
            <span className="text-xs text-muted-foreground">سعة {HATCHER.capacity} كتكوت</span>
          </div>
          <div className="h-2 rounded-full bg-gradient-to-r from-purple-400 to-orange-400" />
        </Card>
      </div>

      <div className="flex justify-between mb-3">
        <h3 className="font-bold">دفعات المعمل</h3>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setEditing(null); setForm(emptyBatch()); } }}>
          <DialogTrigger asChild><Button size="sm" onClick={openNew}><Plus className="w-4 h-4 ml-1" />دفعة جديدة</Button></DialogTrigger>
          <DialogContent dir="rtl" className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{editing ? "تحديث الدفعة" : "دفعة جديدة"}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div><Label>رقم الدفعة</Label><Input value={form.batch_number} onChange={(e) => setForm({ ...form, batch_number: e.target.value })} /></div>
                <div>
                  <Label>الماكينة</Label>
                  <Select value={form.machine} onValueChange={(v) => setForm({ ...form, machine: v })}>
                    <SelectTrigger><SelectValue placeholder="اختر الماكينة" /></SelectTrigger>
                    <SelectContent>
                      {MACHINES.map((m) => {
                        const used = machineUsage[m.id] || 0;
                        const free = m.capacity - used;
                        return (
                          <SelectItem key={m.id} value={m.id}>
                            {m.name} — سعة {m.capacity} (متاح {free})
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  {selectedMachine && (
                    <p className={`text-xs mt-1 ${machineCapacityBlocked ? "text-destructive font-bold" : machineOver ? "text-amber-600 font-bold" : "text-muted-foreground"}`}>
                      مستخدم {machineUsed}/{selectedMachine.capacity} • متاح {machineFree}
                      {machineCapacityBlocked && " ⚠️ هذا التعديل سيزيد تجاوز السعة"}
                      {!machineCapacityBlocked && machineOver && " ⚠️ السعة متجاوزة مسبقاً، لكن يمكن حفظ التعديل إذا لم يزد الحمل"}
                    </p>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>العميل</Label>
                  <Select value={form.customer_id} onValueChange={(v) => setForm({ ...form, customer_id: v })}>
                    <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
                    <SelectContent>{customers.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name} {c.customer_type === "internal" ? "(داخلي)" : "(خارجي)"}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>الحالة (تلقائية)</Label>
                  <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pending">قيد الانتظار</SelectItem>
                      <SelectItem value="incubating">في التحضين</SelectItem>
                      <SelectItem value="hatching">في الهاتشر</SelectItem>
                      <SelectItem value="completed">مكتملة</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>تاريخ الوارد</Label><Input type="date" value={form.receive_date} onChange={(e) => setForm({ ...form, receive_date: e.target.value })} /></div>
                <div><Label>تاريخ الدخول (يحدد المراحل تلقائياً)</Label><Input type="date" value={form.entry_date} onChange={(e) => setEntry(e.target.value)} /></div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>وارد البيض</Label><Input type="number" value={form.received_eggs} onChange={(e) => setForm({ ...form, received_eggs: +e.target.value })} /></div>
                <div><Label>الصافي</Label><Input type="number" value={form.net_eggs} onChange={(e) => setForm({ ...form, net_eggs: +e.target.value })} /></div>
              </div>

              {/* الكشف الأول: مخصب + غير مخصب = الصافي (تلقائي) */}
              <div className="border-t pt-3 mt-2">
                <p className="font-semibold text-sm mb-2 text-cyan-700">
                  الكشف الأول (بعد {STAGE_CANDLE1} يوم) — غير المخصب يخرج للبيع · الإجمالي = {form.net_eggs || form.received_eggs || 0}
                </p>
                <div className="grid grid-cols-3 gap-2">
                  <div><Label>التاريخ</Label><Input type="date" value={form.candle1_date} onChange={(e) => setForm({ ...form, candle1_date: e.target.value })} /></div>
                  <div><Label>مخصب</Label><Input type="number" min={0} value={form.candle1_fertile} onChange={(e) => {
                    const v = Math.max(0, +e.target.value || 0);
                    const total = form.net_eggs || form.received_eggs || 0;
                    setForm({ ...form, candle1_fertile: v, candle1_infertile: Math.max(0, total - v) });
                  }} /></div>
                  <div><Label>غير مخصب (تلقائي)</Label><Input type="number" min={0} value={form.candle1_infertile} onChange={(e) => {
                    const v = Math.max(0, +e.target.value || 0);
                    const total = form.net_eggs || form.received_eggs || 0;
                    setForm({ ...form, candle1_infertile: v, candle1_fertile: Math.max(0, total - v) });
                  }} /></div>
                </div>
                {((form.candle1_fertile || 0) + (form.candle1_infertile || 0)) > 0 &&
                  ((form.candle1_fertile || 0) + (form.candle1_infertile || 0)) !== (form.net_eggs || form.received_eggs || 0) && (
                  <p className="text-xs text-destructive mt-1">⚠️ المجموع {(form.candle1_fertile || 0) + (form.candle1_infertile || 0)} ≠ الإجمالي {form.net_eggs || form.received_eggs || 0}</p>
                )}
              </div>

              {/* الكشف الثاني: مخصب مكتمل + ميت = مخصب الكشف الأول */}
              <div>
                <p className="font-semibold text-sm mb-2 text-cyan-700">
                  الكشف الثاني (بعد {STAGE_CANDLE2} يوم) — الميت يُعدم · من الكشف الأول = {form.candle1_fertile || 0}
                </p>
                <div className="grid grid-cols-3 gap-2">
                  <div><Label>التاريخ</Label><Input type="date" value={form.candle2_date} onChange={(e) => setForm({ ...form, candle2_date: e.target.value })} /></div>
                  <div><Label>مخصب (مكتمل النمو)</Label><Input type="number" min={0} value={form.candle2_fertile} onChange={(e) => {
                    const v = Math.max(0, +e.target.value || 0);
                    const base = form.candle1_fertile || 0;
                    setForm({ ...form, candle2_fertile: v, candle2_dead: Math.max(0, base - v) });
                  }} /></div>
                  <div><Label>ميت (تلقائي)</Label><Input type="number" min={0} value={form.candle2_dead} onChange={(e) => {
                    const v = Math.max(0, +e.target.value || 0);
                    const base = form.candle1_fertile || 0;
                    setForm({ ...form, candle2_dead: v, candle2_fertile: Math.max(0, base - v) });
                  }} /></div>
                </div>
                {((form.candle2_fertile || 0) + (form.candle2_dead || 0)) > 0 &&
                  ((form.candle2_fertile || 0) + (form.candle2_dead || 0)) !== (form.candle1_fertile || 0) && (
                  <p className="text-xs text-destructive mt-1">⚠️ المجموع {(form.candle2_fertile || 0) + (form.candle2_dead || 0)} ≠ مخصب الكشف الأول {form.candle1_fertile || 0}</p>
                )}
              </div>

              {/* الهاتشر: كتاكيت + نافق = مخصب الكشف الثاني */}
              <div>
                <p className="font-semibold text-sm mb-2 text-cyan-700">
                  الخروج للهاتشر (بعد {STAGE_EXIT} يوم) — سعة {HATCHER.capacity} · الداخل = {form.candle2_fertile || 0}
                </p>
                <div className="grid grid-cols-3 gap-2">
                  <div><Label>تاريخ الخروج</Label><Input type="date" value={form.exit_date} onChange={(e) => setForm({ ...form, exit_date: e.target.value })} /></div>
                  <div><Label>كتاكيت ناتجة</Label><Input type="number" min={0} value={form.hatched_chicks} onChange={(e) => {
                    const v = Math.max(0, +e.target.value || 0);
                    const base = form.candle2_fertile || 0;
                    setForm({ ...form, hatched_chicks: v, hatcher_dead: Math.max(0, base - v) });
                  }} /></div>
                  <div><Label>نافق هاتشر (تلقائي)</Label><Input type="number" min={0} value={form.hatcher_dead} onChange={(e) => {
                    const v = Math.max(0, +e.target.value || 0);
                    const base = form.candle2_fertile || 0;
                    setForm({ ...form, hatcher_dead: v, hatched_chicks: Math.max(0, base - v) });
                  }} /></div>
                </div>
              </div>

              {/* استلام العميل + التحضين */}
              <div>
                <p className="font-semibold text-sm mb-2 text-amber-700">
                  استلام العميل — كل يوم تأخير = {PRICE_BROODING_PER_DAY} ج تحضين
                </p>
                <div className="grid grid-cols-3 gap-2">
                  <div><Label>تاريخ إبلاغ العميل (الخروج)</Label><Input type="date" value={form.exit_date} disabled /></div>
                  <div><Label>تاريخ الاستلام الفعلي</Label><Input type="date" value={form.pickup_date || ""} onChange={(e) => setForm({ ...form, pickup_date: e.target.value })} /></div>
                  <div><Label>أيام التحضين (تلقائي)</Label><Input type="number" value={broodingDays} disabled /></div>
                </div>
                {broodingDays > 0 && (
                  <p className="text-xs text-amber-700 mt-1">
                    مبلغ التحضين = {broodingDays} يوم × {PRICE_BROODING_PER_DAY} ج = <b>{(broodingDays * PRICE_BROODING_PER_DAY).toLocaleString()} ج</b>
                  </p>
                )}
              </div>

              {/* ====== ملخص فاتورة العميل الخارجي ====== */}
              {isExternal && billing && (
                <div className="rounded-lg border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20 p-3">
                  <div className="flex items-center gap-2 mb-2 text-emerald-700 dark:text-emerald-300 font-semibold">
                    <DollarSign className="w-4 h-4" /> فاتورة العميل الخارجي
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>غير مخصب ({form.candle1_infertile} × {currentCustomer.infertile_price || PRICE_INFERTILE})</div><div className="text-end font-bold">{billing.infertile.toLocaleString()} ج</div>
                    <div>ميت كشف 2 ({form.candle2_dead} × {PRICE_DEAD2})</div><div className="text-end font-bold">{billing.dead2.toLocaleString()} ج</div>
                    <div>كتاكيت ({form.hatched_chicks} × {currentCustomer.incubation_price || PRICE_CHICK})</div><div className="text-end font-bold">{billing.chicks.toLocaleString()} ج</div>
                    <div>نافق هاتشر ({form.hatcher_dead} × {currentCustomer.hatcher_price || PRICE_HATCHER_DEAD})</div><div className="text-end font-bold">{billing.hatcherDead.toLocaleString()} ج</div>
                    <div>تحضين ({billing.broodingDays} يوم × {PRICE_BROODING_PER_DAY})</div><div className="text-end font-bold">{billing.brooding.toLocaleString()} ج</div>
                    <div className="col-span-2 border-t pt-2 mt-1 flex justify-between text-base">
                      <span className="font-bold text-emerald-700">الإجمالي</span>
                      <span className="font-bold text-emerald-700">{billing.total.toLocaleString()} ج</span>
                    </div>
                  </div>
                </div>
              )}

              <div><Label>ملاحظات</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            </div>
            <DialogFooter><Button onClick={() => save.mutate()} disabled={save.isPending || machineCapacityBlocked}>حفظ</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-2 mb-3">
        <Input placeholder="بحث برقم الدفعة..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select value={fCustomer} onValueChange={setFCustomer}>
          <SelectTrigger><SelectValue placeholder="كل العملاء" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل العملاء</SelectItem>
            {customers.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={fStatus} onValueChange={setFStatus}>
          <SelectTrigger><SelectValue placeholder="كل الحالات" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الحالات</SelectItem>
            <SelectItem value="pending">انتظار</SelectItem>
            <SelectItem value="incubating">تحضين</SelectItem>
            <SelectItem value="hatching">هاتشر</SelectItem>
            <SelectItem value="completed">مكتملة</SelectItem>
          </SelectContent>
        </Select>
        <Select value={fMachine} onValueChange={setFMachine}>
          <SelectTrigger><SelectValue placeholder="كل الماكينات" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الماكينات</SelectItem>
            {MACHINES.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} />
        <Input type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} />
      </div>
      <p className="text-xs text-muted-foreground mb-2">عرض {Math.min(filtered.length, 500)} من {filtered.length} دفعة</p>

      <div className="overflow-auto max-h-[600px]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>رقم</TableHead><TableHead>التاريخ</TableHead><TableHead>الماكينة</TableHead><TableHead>العميل</TableHead>
              <TableHead>وارد</TableHead><TableHead>صافي</TableHead><TableHead>كتاكيت</TableHead>
              <TableHead>خصوبة</TableHead><TableHead>تحول</TableHead><TableHead>الحالة</TableHead><TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.slice(0, 500).map((b: any) => (
              <TableRow key={b.id}>
                <TableCell className="font-mono text-xs">{b.batch_number}</TableCell>
                <TableCell>{b.receive_date}</TableCell>
                <TableCell><Badge variant="outline">{MACHINES.find((m) => m.id === b.machine)?.name || b.machine || "—"}</Badge></TableCell>
                <TableCell>{customerName(b.customer_id)}</TableCell>
                <TableCell>{b.received_eggs}</TableCell>
                <TableCell>{b.net_eggs}</TableCell>
                <TableCell className="font-bold text-orange-600">{b.hatched_chicks || 0}</TableCell>
                <TableCell className="text-emerald-600">{fertility(b)}</TableCell>
                <TableCell className="text-purple-600">{conversion(b)}</TableCell>
                <TableCell>
                  <Badge variant={b.status === "completed" ? "default" : "secondary"}>
                    {b.status === "completed" ? "مكتملة" : b.status === "incubating" ? "تحضين" : b.status === "hatching" ? "هاتشر" : "انتظار"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Button size="icon" variant="ghost" onClick={() => openEdit(b)}><Pencil className="w-4 h-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => del.mutate(b.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground py-6">لا توجد دفعات مطابقة</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
};

// ============ BATCHES CHARTS ============
const BatchesChartsTab = ({ batches, customers }: any) => {
  const [year, setYear] = useState(2026);
  const internalIds = useMemo(() => new Set(customers.filter((c: any) => c.customer_type === "internal").map((c: any) => c.id)), [customers]);

  const stages = useMemo(() => {
    const yearBatches = batches.filter((b: any) => b.receive_date && new Date(b.receive_date).getFullYear() === year);
    const sum = (k: string) => yearBatches.reduce((s: number, b: any) => s + (b[k] || 0), 0);
    return [
      { stage: "وارد", value: sum("received_eggs") },
      { stage: "صافي", value: sum("net_eggs") },
      { stage: "كشف 1 مخصب", value: sum("candle1_fertile") },
      { stage: "كشف 2 مخصب", value: sum("candle2_fertile") },
      { stage: "كتاكيت", value: sum("hatched_chicks") },
    ];
  }, [batches, year]);

  const monthly = useMemo(() => {
    const arr = Array.from({ length: 12 }, (_, i) => ({ name: `${i + 1}`, "وارد": 0, "صافي": 0, "كتاكيت": 0 }));
    batches.forEach((b: any) => {
      if (!b.receive_date) return;
      const d = new Date(b.receive_date);
      if (d.getFullYear() !== year) return;
      arr[d.getMonth()]["وارد"] += b.received_eggs || 0;
      arr[d.getMonth()]["صافي"] += b.net_eggs || 0;
      arr[d.getMonth()]["كتاكيت"] += b.hatched_chicks || 0;
    });
    return arr;
  }, [batches, year]);

  const cmpInternal = useMemo(() => {
    const groups = [
      { name: "العاصمة", arr: batches.filter((b: any) => internalIds.has(b.customer_id) && b.status === "completed") },
      { name: "الآخرون", arr: batches.filter((b: any) => !internalIds.has(b.customer_id) && b.status === "completed") },
    ];
    return groups.map((g) => {
      const net = g.arr.reduce((s: number, b: any) => s + (b.net_eggs || 0), 0);
      const fert = g.arr.reduce((s: number, b: any) => s + (b.candle2_fertile || b.candle1_fertile || 0), 0);
      const ch = g.arr.reduce((s: number, b: any) => s + (b.hatched_chicks || 0), 0);
      return {
        name: g.name,
        "خصوبة%": net > 0 ? +((fert / net) * 100).toFixed(1) : 0,
        "تحول%": net > 0 ? +((ch / net) * 100).toFixed(1) : 0,
      };
    });
  }, [batches, internalIds]);

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex justify-between items-center mb-3">
          <h3 className="font-bold">قمع المراحل ({year})</h3>
          <Select value={String(year)} onValueChange={(v) => setYear(+v)}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>{[2024, 2025, 2026, 2027].map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="h-72">
          <ResponsiveContainer>
            <BarChart data={stages} layout="vertical" margin={{ left: 80 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis type="category" dataKey="stage" />
              <Tooltip />
              <Bar dataKey="value" fill="hsl(var(--primary))" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="font-bold mb-3">تتبع شهري - المراحل</h3>
        <div className="h-72">
          <ResponsiveContainer>
            <LineChart data={monthly}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip /><Legend />
              <Line type="monotone" dataKey="وارد" stroke="hsl(var(--accent))" strokeWidth={2} />
              <Line type="monotone" dataKey="صافي" stroke="hsl(var(--primary))" strokeWidth={2} />
              <Line type="monotone" dataKey="كتاكيت" stroke="hsl(var(--destructive))" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="font-bold mb-3">العاصمة × الآخرون (دفعات مكتملة)</h3>
        <div className="h-64">
          <ResponsiveContainer>
            <BarChart data={cmpInternal}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis unit="%" />
              <Tooltip /><Legend />
              <Bar dataKey="خصوبة%" fill="hsl(var(--primary))" />
              <Bar dataKey="تحول%" fill="hsl(var(--accent))" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
};

// ============ QUALITY ============
const QualityTab = ({ stats }: any) => {
  const data = [
    { name: "الخصوبة", "العاصمة": +stats.internalFertility, "العملاء": +stats.externalFertility },
    { name: "التحول للكتكوت", "العاصمة": +stats.internalConversion, "العملاء": +stats.externalConversion },
  ];
  const diffFert = (+stats.internalFertility - +stats.externalFertility).toFixed(1);
  const diffConv = (+stats.internalConversion - +stats.externalConversion).toFixed(1);

  return (
    <Card className="p-4">
      <h3 className="font-bold mb-4">مقارنة جودة العاصمة (داخلي) مقابل العملاء الآخرين</h3>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">فرق الخصوبة</p>
          <p className={`text-xl font-bold ${+diffFert >= 0 ? "text-emerald-600" : "text-destructive"}`}>{+diffFert >= 0 ? "+" : ""}{diffFert} نقطة</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">فرق التحول</p>
          <p className={`text-xl font-bold ${+diffConv >= 0 ? "text-emerald-600" : "text-destructive"}`}>{+diffConv >= 0 ? "+" : ""}{diffConv} نقطة</p>
        </Card>
      </div>
      <div className="h-72">
        <ResponsiveContainer>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis unit="%" />
            <Tooltip />
            <Legend />
            <Bar dataKey="العاصمة" fill="hsl(var(--primary))" />
            <Bar dataKey="العملاء" fill="hsl(var(--accent))" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs text-muted-foreground mt-3">* الحسابات تعتمد على الدفعات المكتملة فقط حتى لا يتم ظلم الدفعات الجارية.</p>
    </Card>
  );
};

// ============ CUSTOMERS ============
const CustomersTab = ({ customers, qc }: any) => {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ name: "", customer_type: "external", incubation_price: 150, infertile_price: 50, hatcher_price: 100, notes: "" });

  const save = useMutation({
    mutationFn: async () => { const { error } = await supabase.from("hatch_customers").insert(form); if (error) throw error; },
    onSuccess: () => { toast.success("تم"); setOpen(false); setForm({ name: "", customer_type: "external", incubation_price: 150, infertile_price: 50, hatcher_price: 100, notes: "" }); qc.invalidateQueries({ queryKey: ["hatch_customers"] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("hatch_customers").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hatch_customers"] }),
  });

  return (
    <Card className="p-4">
      <div className="flex justify-between mb-3">
        <h3 className="font-bold">عملاء المعمل</h3>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="w-4 h-4 ml-1" />عميل جديد</Button></DialogTrigger>
          <DialogContent dir="rtl">
            <DialogHeader><DialogTitle>عميل جديد</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>الاسم</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div><Label>النوع</Label>
                <Select value={form.customer_type} onValueChange={(v) => setForm({ ...form, customer_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="internal">داخلي (العاصمة)</SelectItem>
                    <SelectItem value="external">خارجي</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div><Label>تحضين</Label><Input type="number" value={form.incubation_price} onChange={(e) => setForm({ ...form, incubation_price: +e.target.value })} /></div>
                <div><Label>غير مخصب</Label><Input type="number" value={form.infertile_price} onChange={(e) => setForm({ ...form, infertile_price: +e.target.value })} /></div>
                <div><Label>هاتشر</Label><Input type="number" value={form.hatcher_price} onChange={(e) => setForm({ ...form, hatcher_price: +e.target.value })} /></div>
              </div>
              <div><Label>ملاحظات</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            </div>
            <DialogFooter><Button onClick={() => save.mutate()} disabled={save.isPending}>حفظ</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <div className="overflow-auto">
        <Table>
          <TableHeader><TableRow><TableHead>الاسم</TableHead><TableHead>النوع</TableHead><TableHead>تحضين</TableHead><TableHead>غير مخصب</TableHead><TableHead>هاتشر</TableHead><TableHead></TableHead></TableRow></TableHeader>
          <TableBody>
            {customers.map((c: any) => (
              <TableRow key={c.id}>
                <TableCell className="font-bold">{c.name}</TableCell>
                <TableCell><Badge variant={c.customer_type === "internal" ? "default" : "outline"}>{c.customer_type === "internal" ? "داخلي" : "خارجي"}</Badge></TableCell>
                <TableCell>{c.incubation_price}</TableCell>
                <TableCell>{c.infertile_price}</TableCell>
                <TableCell>{c.hatcher_price}</TableCell>
                <TableCell><Button size="icon" variant="ghost" onClick={() => del.mutate(c.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button></TableCell>
              </TableRow>
            ))}
            {customers.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">لا يوجد عملاء</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
};

// ============ DAILY OPS ============
const OpsTab = ({ ops, qc }: any) => {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ op_date: today(), status: "normal", capacity: 0, notes: "" });
  const save = useMutation({
    mutationFn: async () => { const { error } = await supabase.from("hatch_daily_ops").insert(form); if (error) throw error; },
    onSuccess: () => { toast.success("تم"); setOpen(false); setForm({ op_date: today(), status: "normal", capacity: 0, notes: "" }); qc.invalidateQueries({ queryKey: ["hatch_daily_ops"] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const del = useMutation({ mutationFn: async (id: string) => { const { error } = await supabase.from("hatch_daily_ops").delete().eq("id", id); if (error) throw error; }, onSuccess: () => qc.invalidateQueries({ queryKey: ["hatch_daily_ops"] }) });

  return (
    <Card className="p-4">
      <div className="flex justify-between mb-3">
        <h3 className="font-bold">التشغيل اليومي للمعمل</h3>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="w-4 h-4 ml-1" />تسجيل يوم</Button></DialogTrigger>
          <DialogContent dir="rtl">
            <DialogHeader><DialogTitle>تشغيل يومي</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>التاريخ</Label><Input type="date" value={form.op_date} onChange={(e) => setForm({ ...form, op_date: e.target.value })} /></div>
              <div><Label>الحالة</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="normal">عادي</SelectItem>
                    <SelectItem value="alert">تنبيه</SelectItem>
                    <SelectItem value="stopped">متوقف</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>الطاقة المستخدمة</Label><Input type="number" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: +e.target.value })} /></div>
              <div><Label>ملاحظات</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            </div>
            <DialogFooter><Button onClick={() => save.mutate()} disabled={save.isPending}>حفظ</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <Table>
        <TableHeader><TableRow><TableHead>التاريخ</TableHead><TableHead>الحالة</TableHead><TableHead>الطاقة</TableHead><TableHead>ملاحظات</TableHead><TableHead></TableHead></TableRow></TableHeader>
        <TableBody>
          {ops.map((o: any) => (
            <TableRow key={o.id}>
              <TableCell>{o.op_date}</TableCell>
              <TableCell><Badge variant={o.status === "normal" ? "default" : "destructive"}>{o.status === "normal" ? "عادي" : o.status === "alert" ? "تنبيه" : "متوقف"}</Badge></TableCell>
              <TableCell>{o.capacity}</TableCell>
              <TableCell className="text-xs">{o.notes || "-"}</TableCell>
              <TableCell><Button size="icon" variant="ghost" onClick={() => del.mutate(o.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button></TableCell>
            </TableRow>
          ))}
          {ops.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">لا يوجد سجل</TableCell></TableRow>}
        </TableBody>
      </Table>
    </Card>
  );
};

// ============ MAINTENANCE ============
const MaintTab = ({ maint, qc }: any) => {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ maint_date: today(), maint_type: "periodic", machine: "", action: "", cost: 0, notes: "" });
  const save = useMutation({
    mutationFn: async () => { const { error } = await supabase.from("hatch_maintenance").insert(form); if (error) throw error; },
    onSuccess: () => { toast.success("تم"); setOpen(false); setForm({ maint_date: today(), maint_type: "periodic", machine: "", action: "", cost: 0, notes: "" }); qc.invalidateQueries({ queryKey: ["hatch_maintenance"] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const del = useMutation({ mutationFn: async (id: string) => { const { error } = await supabase.from("hatch_maintenance").delete().eq("id", id); if (error) throw error; }, onSuccess: () => qc.invalidateQueries({ queryKey: ["hatch_maintenance"] }) });

  return (
    <Card className="p-4">
      <div className="flex justify-between mb-3">
        <h3 className="font-bold">صيانة المعمل</h3>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="w-4 h-4 ml-1" />تسجيل صيانة</Button></DialogTrigger>
          <DialogContent dir="rtl">
            <DialogHeader><DialogTitle>صيانة جديدة</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div><Label>التاريخ</Label><Input type="date" value={form.maint_date} onChange={(e) => setForm({ ...form, maint_date: e.target.value })} /></div>
                <div><Label>النوع</Label>
                  <Select value={form.maint_type} onValueChange={(v) => setForm({ ...form, maint_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="periodic">دورية</SelectItem>
                      <SelectItem value="emergency">طارئة</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div><Label>الماكينة</Label><Input value={form.machine} onChange={(e) => setForm({ ...form, machine: e.target.value })} /></div>
              <div><Label>الإجراء</Label><Textarea value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value })} /></div>
              <div><Label>التكلفة</Label><Input type="number" value={form.cost} onChange={(e) => setForm({ ...form, cost: +e.target.value })} /></div>
              <div><Label>ملاحظات</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            </div>
            <DialogFooter><Button onClick={() => save.mutate()} disabled={save.isPending}>حفظ</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <Table>
        <TableHeader><TableRow><TableHead>التاريخ</TableHead><TableHead>النوع</TableHead><TableHead>الماكينة</TableHead><TableHead>الإجراء</TableHead><TableHead>التكلفة</TableHead><TableHead></TableHead></TableRow></TableHeader>
        <TableBody>
          {maint.map((m: any) => (
            <TableRow key={m.id}>
              <TableCell>{m.maint_date}</TableCell>
              <TableCell><Badge variant={m.maint_type === "emergency" ? "destructive" : "secondary"}>{m.maint_type === "emergency" ? "طارئة" : "دورية"}</Badge></TableCell>
              <TableCell>{m.machine || "-"}</TableCell>
              <TableCell className="text-xs">{m.action}</TableCell>
              <TableCell className="font-bold">{m.cost}</TableCell>
              <TableCell><Button size="icon" variant="ghost" onClick={() => del.mutate(m.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button></TableCell>
            </TableRow>
          ))}
          {maint.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">لا يوجد سجل صيانة</TableCell></TableRow>}
        </TableBody>
      </Table>
    </Card>
  );
};

// ============ CHICKS ============
const ChicksTab = ({ chicks, qc }: any) => {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ movement_date: today(), source: "", incoming: 0, outgoing: 0, dead: 0, sold: 0, unit_price: 0, age_days: 0, notes: "" });
  const save = useMutation({
    mutationFn: async () => { const { error } = await supabase.from("chick_movements").insert(form); if (error) throw error; },
    onSuccess: () => { toast.success("تم"); setOpen(false); setForm({ movement_date: today(), source: "", incoming: 0, outgoing: 0, dead: 0, sold: 0, unit_price: 0, age_days: 0, notes: "" }); qc.invalidateQueries({ queryKey: ["chick_movements"] }); qc.invalidateQueries({ queryKey: ["production-stats"] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const del = useMutation({ mutationFn: async (id: string) => { const { error } = await supabase.from("chick_movements").delete().eq("id", id); if (error) throw error; }, onSuccess: () => qc.invalidateQueries({ queryKey: ["chick_movements"] }) });

  const totals = useMemo(() => {
    const t = chicks.reduce((acc: any, c: any) => {
      acc.in += c.incoming; acc.out += c.outgoing; acc.dead += c.dead;
      acc.sold += c.sold; acc.revenue += (c.sold * c.unit_price);
      return acc;
    }, { in: 0, out: 0, dead: 0, sold: 0, revenue: 0 });
    t.balance = t.in - t.out - t.dead;
    return t;
  }, [chicks]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <Card className="p-3"><p className="text-xs text-muted-foreground">إجمالي وارد</p><p className="text-lg font-bold">{totals.in}</p></Card>
        <Card className="p-3"><p className="text-xs text-muted-foreground">منصرف</p><p className="text-lg font-bold">{totals.out}</p></Card>
        <Card className="p-3"><p className="text-xs text-muted-foreground">نافق</p><p className="text-lg font-bold text-destructive">{totals.dead}</p></Card>
        <Card className="p-3"><p className="text-xs text-muted-foreground">مبيعات</p><p className="text-lg font-bold text-emerald-600">{totals.sold}</p></Card>
        <Card className="p-3"><p className="text-xs text-muted-foreground">الرصيد</p><p className="text-lg font-bold text-purple-600">{totals.balance}</p></Card>
      </div>

      <Card className="p-4">
        <div className="flex justify-between mb-3">
          <h3 className="font-bold">حركة الكتاكيت</h3>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button size="sm"><Plus className="w-4 h-4 ml-1" />حركة جديدة</Button></DialogTrigger>
            <DialogContent dir="rtl">
              <DialogHeader><DialogTitle>حركة كتاكيت</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div><Label>التاريخ</Label><Input type="date" value={form.movement_date} onChange={(e) => setForm({ ...form, movement_date: e.target.value })} /></div>
                  <div><Label>المصدر</Label><Input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="اسم الدفعة/العميل" /></div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label>وارد</Label><Input type="number" value={form.incoming} onChange={(e) => setForm({ ...form, incoming: +e.target.value })} /></div>
                  <div><Label>منصرف</Label><Input type="number" value={form.outgoing} onChange={(e) => setForm({ ...form, outgoing: +e.target.value })} /></div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label>نافق</Label><Input type="number" value={form.dead} onChange={(e) => setForm({ ...form, dead: +e.target.value })} /></div>
                  <div><Label>مباع</Label><Input type="number" value={form.sold} onChange={(e) => setForm({ ...form, sold: +e.target.value })} /></div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label>سعر الوحدة (ج.م)</Label><Input type="number" value={form.unit_price} onChange={(e) => setForm({ ...form, unit_price: +e.target.value })} /></div>
                  <div><Label>العمر عند البيع (يوم)</Label><Input type="number" value={form.age_days} onChange={(e) => setForm({ ...form, age_days: +e.target.value })} /></div>
                </div>
                <div><Label>ملاحظات</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
              </div>
              <DialogFooter><Button onClick={() => save.mutate()} disabled={save.isPending}>حفظ</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        <Table>
          <TableHeader><TableRow><TableHead>التاريخ</TableHead><TableHead>المصدر</TableHead><TableHead>وارد</TableHead><TableHead>منصرف</TableHead><TableHead>نافق</TableHead><TableHead>مباع</TableHead><TableHead>العمر (يوم)</TableHead><TableHead>سعر</TableHead><TableHead>إجمالي بيع</TableHead><TableHead></TableHead></TableRow></TableHeader>
          <TableBody>
            {chicks.map((c: any) => (
              <TableRow key={c.id}>
                <TableCell>{c.movement_date}</TableCell>
                <TableCell>{c.source}</TableCell>
                <TableCell>{c.incoming}</TableCell>
                <TableCell>{c.outgoing}</TableCell>
                <TableCell className="text-destructive">{c.dead}</TableCell>
                <TableCell className="text-emerald-600">{c.sold}</TableCell>
                <TableCell>{c.age_days || "-"}</TableCell>
                <TableCell>{c.unit_price}</TableCell>
                <TableCell className="font-bold">{(c.sold * c.unit_price).toLocaleString()}</TableCell>
                <TableCell><Button size="icon" variant="ghost" onClick={() => del.mutate(c.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button></TableCell>
              </TableRow>
            ))}
            {chicks.length === 0 && <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-6">لا توجد حركة</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
};

export default Hatchery;
