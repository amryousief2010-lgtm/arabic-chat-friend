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
  Settings as SettingsIcon, Printer, FileSpreadsheet, X, Activity, TrendingUp,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { format } from "date-fns";
import { openPrintWindow, escapeHtml, fmtNum, fmtDate } from "@/lib/printPdf";
import * as XLSX from "xlsx";

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
            <DashboardTab kpis={kpis} batches={batches} settings={settings} />
          </TabsContent>

          <TabsContent value="batches">
            <BatchesTab batches={batches} lots={lots} clients={clients} settings={settings}
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

const DashboardTab = ({ kpis, batches, settings }: any) => {
  const k = kpis || {};
  const dueCandling = useMemo(() =>
    batches.filter((b: any) => b.status === "incubating" && new Date(b.candle_due_date) <= new Date()), [batches]);
  const dueHatcher = useMemo(() =>
    batches.filter((b: any) => ["incubating", "candled"].includes(b.status) && new Date(b.hatcher_due_date) <= new Date()), [batches]);

  return (
    <div className="space-y-4">
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

const BatchesTab = ({ batches, lots, clients, settings, canManage, onRefresh }: any) => {
  const [search, setSearch] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [activeBatch, setActiveBatch] = useState<any>(null);

  const filtered = useMemo(() => batches.filter((b: any) =>
    !search || b.batch_number?.toLowerCase().includes(search.toLowerCase())
  ), [batches, search]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث برقم الدفعة..." className="pr-9" />
        </div>
        {canManage && (
          <Button onClick={() => setShowNew(true)}><Plus className="w-4 h-4 ml-1" />دفعة جديدة</Button>
        )}
      </div>

      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>رقم الدفعة</TableHead>
              <TableHead>تاريخ الدخول</TableHead>
              <TableHead>الماكينة</TableHead>
              <TableHead>النوع</TableHead>
              <TableHead>إجمالي البيض</TableHead>
              <TableHead>عاصمة / عملاء</TableHead>
              <TableHead>الكتاكيت</TableHead>
              <TableHead>كشف يوم</TableHead>
              <TableHead>هاتشر يوم</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead>إجراءات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((b: any) => (
              <TableRow key={b.id}>
                <TableCell className="font-mono text-xs">{b.batch_number}</TableCell>
                <TableCell>{b.entry_date}</TableCell>
                <TableCell>{b.incubator_machine_no || "—"}</TableCell>
                <TableCell><Badge variant="outline">{b.batch_type === "internal" ? "عاصمة" : b.batch_type === "external" ? "عملاء" : "مختلطة"}</Badge></TableCell>
                <TableCell className="font-bold">{fmtNum(b.total_eggs_in)}</TableCell>
                <TableCell className="text-xs">{fmtNum(b.internal_eggs)} / {fmtNum(b.external_eggs)}</TableCell>
                <TableCell>{fmtNum(b.total_chicks)}</TableCell>
                <TableCell className="text-xs">{b.candle_due_date}</TableCell>
                <TableCell className="text-xs">{b.hatcher_due_date}</TableCell>
                <TableCell><Badge className={`${statusColors[b.status]} text-white`}>{statusLabels[b.status]}</Badge></TableCell>
                <TableCell><Button size="sm" variant="outline" onClick={() => setActiveBatch(b)}>إدارة</Button></TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground py-8">لا توجد دفعات</TableCell></TableRow>
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
    </div>
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
