import { useEffect, useMemo, useState, useCallback } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  ClipboardCheck, ShieldCheck, Info, Search, FileText, Printer, Plus,
  ListChecks, XCircle, CheckCircle2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { printStocktakingMinutes, printEmptyStocktakingForm } from "@/lib/printStocktaking";

interface Item { id: string; name: string; unit: string; stock: number; unit_cost: number; warehouse_id: string }
interface Session {
  id: string;
  session_no: string;
  warehouse_id: string;
  count_date: string;
  stocktaker_name: string;
  status: "draft" | "approved" | "cancelled";
  notes: string | null;
  created_at: string;
  approved_at: string | null;
  approved_by: string | null;
  total_increase: number;
  total_decrease: number;
  net_value: number;
}
interface Line {
  id: string;
  session_id: string;
  item_id: string;
  system_qty: number;
  actual_qty: number;
  unit_cost: number;
  diff: number;
  diff_value: number;
  reason: string;
  notes: string | null;
}

const REASONS = [
  "جرد فعلي",
  "فرق وزن",
  "خطأ إدخال",
  "تالف",
  "مرتجع",
  "تصحيح عبوات",
  "تسوية مخزون",
];

const sb = supabase as any;

export default function WarehouseStocktaking() {
  const { isGeneralManager, isExecutiveManager, profile, role, roles } = useAuth();
  const canApprove = isGeneralManager || isExecutiveManager;
  // مشرف مخزن العجوزة لا يملك صلاحية جرد المخزن الرئيسي
  const MAIN_WAREHOUSE_ID = "5ec781b5-685b-4806-b59a-83a79ea5662c";
  const userRoles: string[] = (roles as any) || (role ? [role] : []);
  const isWarehouseSupervisorOnly =
    userRoles.includes("warehouse_supervisor") &&
    !isGeneralManager && !isExecutiveManager;
  // صلاحية التعديل على الجرد: المدراء + مشرف المخزن فقط.
  // أمين مخزن العجوزة (agouza_warehouse_keeper) وغيره: عرض فقط.
  const canEditStocktaking =
    isGeneralManager || isExecutiveManager || userRoles.includes("warehouse_supervisor");

  const [warehouses, setWarehouses] = useState<{ id: string; name: string }[]>([]);
  const [activeWh, setActiveWh] = useState<string>("");
  const [items, setItems] = useState<Item[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);

  const [stocktaker, setStocktaker] = useState<string>("عبدالمنعم عثمان");
  const [countDate, setCountDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [search, setSearch] = useState("");

  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  // editable buffers per item
  const [actuals, setActuals] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [noteBuf, setNoteBuf] = useState<Record<string, string>>({});

  // approvers names cache for printing
  const [approverNames, setApproverNames] = useState<Record<string, string>>({});

  // load warehouses
  useEffect(() => {
    sb.from("warehouses").select("id, name").eq("is_active", true).order("name").then(({ data }: any) => {
      let list = (data || []) as any[];
      if (isWarehouseSupervisorOnly) {
        list = list.filter((w) => w.id !== MAIN_WAREHOUSE_ID);
      }
      setWarehouses(list);
      if (list.length && !activeWh) setActiveWh(list[0].id);
    });
  }, [isWarehouseSupervisorOnly]);

  const loadItems = useCallback(async (whId: string) => {
    if (!whId) return;
    setLoadingItems(true);
    const { data } = await sb
      .from("inventory_items").select("id, name, unit, stock, unit_cost, warehouse_id")
      .eq("warehouse_id", whId).eq("is_active", true).order("name");
    setItems((data || []) as Item[]);
    setLoadingItems(false);
  }, []);

  const loadSessions = useCallback(async (whId: string) => {
    if (!whId) return;
    const { data } = await sb
      .from("stocktaking_sessions").select("*")
      .eq("warehouse_id", whId)
      .order("created_at", { ascending: false }).limit(40);
    setSessions((data || []) as Session[]);
  }, []);

  const loadLines = useCallback(async (sessionId: string | null) => {
    if (!sessionId) { setLines([]); return; }
    const { data } = await sb
      .from("stocktaking_lines").select("*")
      .eq("session_id", sessionId);
    setLines((data || []) as Line[]);
    // sync buffers from existing lines
    const a: Record<string, string> = {}, r: Record<string, string> = {}, n: Record<string, string> = {};
    (data || []).forEach((l: Line) => {
      a[l.item_id] = String(l.actual_qty);
      r[l.item_id] = l.reason;
      n[l.item_id] = l.notes || "";
    });
    setActuals(a); setReasons(r); setNoteBuf(n);
  }, []);

  useEffect(() => { loadItems(activeWh); loadSessions(activeWh); setActiveSessionId(null); }, [activeWh, loadItems, loadSessions]);
  useEffect(() => { loadLines(activeSessionId); }, [activeSessionId, loadLines]);

  // load approver names
  useEffect(() => {
    const ids = Array.from(new Set(sessions.map((s) => s.approved_by).filter(Boolean))) as string[];
    if (!ids.length) return;
    sb.from("profiles").select("id, full_name").in("id", ids).then(({ data }: any) => {
      const map: Record<string, string> = {};
      (data || []).forEach((p: any) => { map[p.id] = p.full_name; });
      setApproverNames((prev) => ({ ...prev, ...map }));
    });
  }, [sessions]);

  const activeSession = useMemo(() => sessions.find((s) => s.id === activeSessionId) || null, [sessions, activeSessionId]);
  const isDraft = activeSession?.status === "draft";

  const filtered = useMemo(() =>
    search.trim() ? items.filter((i) => i.name.includes(search.trim())) : items
  , [items, search]);

  // ============ ACTIONS ============
  const createSession = async () => {
    if (!canEditStocktaking) { toast.error("ليس لديك صلاحية تعديل الجرد"); return; }
    if (!activeWh) { toast.error("اختر مخزن أولًا"); return; }
    if (!stocktaker.trim()) { toast.error("اكتب اسم القائم بالجرد"); return; }
    setBusyAction("create");
    try {
      const { data, error } = await sb.rpc("create_stocktaking_session", {
        p_warehouse_id: activeWh,
        p_stocktaker_name: stocktaker.trim(),
        p_count_date: countDate,
        p_notes: null,
      });
      if (error) throw error;
      toast.success("تم فتح مسودة جرد جديدة");
      await loadSessions(activeWh);
      setActiveSessionId(data as string);
    } catch (e: any) { toast.error(e.message || "فشل"); }
    finally { setBusyAction(null); }
  };

  const saveLine = async (it: Item) => {
    if (!canEditStocktaking) { toast.error("ليس لديك صلاحية تعديل الجرد"); return; }
    if (!activeSessionId || !isDraft) return;
    const a = actuals[it.id];
    const reason = reasons[it.id];
    if (a === undefined || a === "") { toast.error("أدخل الكمية الفعلية"); return; }
    if (!reason || !reason.trim()) { toast.error("اختر السبب (إجباري)"); return; }
    setBusyItem(it.id);
    try {
      const { error } = await sb.rpc("upsert_stocktaking_line", {
        p_session_id: activeSessionId,
        p_item_id: it.id,
        p_actual_qty: Number(a),
        p_reason: reason.trim(),
        p_notes: (noteBuf[it.id] || "").trim() || null,
      });
      if (error) throw error;
      toast.success("تم حفظ السطر في المسودة");
      await Promise.all([loadLines(activeSessionId), loadSessions(activeWh)]);
    } catch (e: any) { toast.error(e.message || "فشل"); }
    finally { setBusyItem(null); }
  };

  const deleteLine = async (lineId: string) => {
    if (!canEditStocktaking) { toast.error("ليس لديك صلاحية تعديل الجرد"); return; }
    if (!isDraft) return;
    if (!confirm("حذف هذا السطر من المسودة؟")) return;
    try {
      const { error } = await sb.rpc("delete_stocktaking_line", { p_line_id: lineId });
      if (error) throw error;
      toast.success("تم حذف السطر");
      await Promise.all([loadLines(activeSessionId!), loadSessions(activeWh)]);
    } catch (e: any) { toast.error(e.message || "فشل"); }
  };

  const approveSession = async () => {
    if (!activeSession) return;
    if (!canApprove) { toast.error("الاعتماد متاح فقط للمدير العام أو التنفيذي"); return; }
    if (!confirm(`اعتماد جلسة ${activeSession.session_no} وتثبيت الرصيد النهائي؟ لا يمكن التراجع.`)) return;
    setBusyAction("approve");
    try {
      const { error } = await sb.rpc("approve_stocktaking_session", { p_session_id: activeSession.id });
      if (error) throw error;
      toast.success("تم اعتماد الجرد وتثبيت الرصيد");
      await Promise.all([loadSessions(activeWh), loadItems(activeWh), loadLines(activeSession.id)]);
    } catch (e: any) { toast.error(e.message || "فشل"); }
    finally { setBusyAction(null); }
  };

  const cancelSession = async () => {
    if (!activeSession) return;
    if (!canApprove) { toast.error("الإلغاء متاح فقط للمدير العام أو التنفيذي"); return; }
    if (!confirm(`إلغاء مسودة ${activeSession.session_no}؟`)) return;
    setBusyAction("cancel");
    try {
      const { error } = await sb.rpc("cancel_stocktaking_session", { p_session_id: activeSession.id });
      if (error) throw error;
      toast.success("تم إلغاء المسودة");
      await loadSessions(activeWh);
      setActiveSessionId(null);
    } catch (e: any) { toast.error(e.message || "فشل"); }
    finally { setBusyAction(null); }
  };

  // ============ PRINTING ============
  const whName = warehouses.find((w) => w.id === activeWh)?.name || "—";

  const printEmptyForm = () => {
    if (!items.length) { toast.error("لا توجد أصناف"); return; }
    printEmptyStocktakingForm({
      warehouseName: whName,
      countDate,
      stocktakerName: stocktaker || "—",
      rows: items.map((i) => ({ name: i.name, unit: i.unit, systemQty: i.stock })),
    });
  };

  const printMinutes = () => {
    if (!activeSession) { toast.error("اختر جلسة جرد أولًا"); return; }
    const itemMap = new Map(items.map((i) => [i.id, i]));
    const rows = lines.map((l) => {
      const it = itemMap.get(l.item_id);
      return {
        name: it?.name || "—",
        unit: it?.unit || "—",
        systemQty: l.system_qty,
        actualQty: l.actual_qty,
        unitCost: l.unit_cost,
        reason: l.reason,
        notes: l.notes,
      };
    });
    printStocktakingMinutes({
      warehouseName: whName,
      sessionNo: activeSession.session_no,
      countDate: activeSession.count_date,
      stocktakerName: activeSession.stocktaker_name,
      approvedByName: activeSession.approved_by ? (approverNames[activeSession.approved_by] || "—") : null,
      approvedAt: activeSession.approved_at,
      status: activeSession.status,
      totals: {
        increase: activeSession.total_increase,
        decrease: activeSession.total_decrease,
        net: activeSession.net_value,
      },
      rows,
    });
  };

  // ============ DIFFERENCES VIEW DATA ============
  const linesWithItem = useMemo(() => {
    const map = new Map(items.map((i) => [i.id, i]));
    return lines.map((l) => ({ ...l, item: map.get(l.item_id) }));
  }, [lines, items]);
  const linesWithDiff = useMemo(() => linesWithItem.filter((l) => Number(l.diff) !== 0), [linesWithItem]);

  return (
    <DashboardLayout>
      <div className="space-y-4 p-4" dir="rtl">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
            <ClipboardCheck className="w-6 h-6 text-primary" />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">الجرد والتسويات</h1>
            <p className="text-sm text-muted-foreground">
              نظام جرد بمسودة واعتماد. مسؤول المخزن يجهّز الأرقام، والمدير العام/التنفيذي يعتمد ويثبّت الرصيد النهائي.
            </p>
          </div>
        </div>

        {!canEditStocktaking && (
          <Alert className="border-amber-300 bg-amber-50">
            <Info className="h-4 w-4" />
            <AlertDescription className="text-amber-900">
              وضع العرض فقط — يمكنك تصفح جلسات الجرد والفروق، لكن لا يمكنك فتح مسودة أو إدخال/حذف أسطر أو الاعتماد.
            </AlertDescription>
          </Alert>
        )}

        {!canApprove && canEditStocktaking && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>يمكنك تجهيز المسودة فقط. الاعتماد النهائي للمدير العام أو التنفيذي.</AlertDescription>
          </Alert>
        )}

        {/* Setup + create draft */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Plus className="w-4 h-4" /> فتح جلسة جرد جديدة</CardTitle>
            <CardDescription>اختر المخزن واكتب اسم القائم بالجرد ثم افتح مسودة جديدة. يمكن طباعة نموذج فارغ قبل البدء.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-3">
              <div className="flex-1 min-w-[200px]">
                <Label className="text-xs">المخزن</Label>
                <Select value={activeWh} onValueChange={setActiveWh}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1 min-w-[200px]">
                <Label className="text-xs">القائم بالجرد *</Label>
                <Input value={stocktaker} onChange={(e) => setStocktaker(e.target.value)} />
              </div>
              <div className="w-[180px]">
                <Label className="text-xs">تاريخ الجرد</Label>
                <Input type="date" value={countDate} onChange={(e) => setCountDate(e.target.value)} />
              </div>
              <div className="flex items-end gap-2">
                <Button onClick={createSession} disabled={!canEditStocktaking || busyAction === "create"}>
                  <Plus className="w-3 h-3 ml-1" /> فتح مسودة
                </Button>
                <Button variant="outline" onClick={printEmptyForm}>
                  <Printer className="w-3 h-3 ml-1" /> نموذج جرد فارغ
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Sessions list */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><ListChecks className="w-4 h-4" /> جلسات الجرد</CardTitle>
          </CardHeader>
          <CardContent>
            {sessions.length === 0 ? (
              <div className="text-center py-6 text-sm text-muted-foreground">لا توجد جلسات بعد لهذا المخزن.</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>رقم الجلسة</TableHead>
                      <TableHead>التاريخ</TableHead>
                      <TableHead>القائم بالجرد</TableHead>
                      <TableHead>الحالة</TableHead>
                      <TableHead>زيادة</TableHead>
                      <TableHead>نقص</TableHead>
                      <TableHead>الصافي</TableHead>
                      <TableHead className="text-left">إجراء</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sessions.map((s) => (
                      <TableRow key={s.id} className={activeSessionId === s.id ? "bg-primary/5" : ""}>
                        <TableCell className="font-mono text-xs">{s.session_no}</TableCell>
                        <TableCell>{s.count_date}</TableCell>
                        <TableCell>{s.stocktaker_name}</TableCell>
                        <TableCell>
                          {s.status === "draft" && <Badge variant="outline" className="border-amber-400 text-amber-700">مسودة</Badge>}
                          {s.status === "approved" && <Badge className="bg-emerald-600">معتمد</Badge>}
                          {s.status === "cancelled" && <Badge variant="secondary">ملغي</Badge>}
                        </TableCell>
                        <TableCell className="font-mono text-emerald-700">{Number(s.total_increase || 0).toFixed(2)}</TableCell>
                        <TableCell className="font-mono text-rose-700">{Number(s.total_decrease || 0).toFixed(2)}</TableCell>
                        <TableCell className={`font-mono ${Number(s.net_value || 0) >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                          {Number(s.net_value || 0).toFixed(2)}
                        </TableCell>
                        <TableCell className="text-left">
                          <Button size="sm" variant={activeSessionId === s.id ? "default" : "outline"}
                                  onClick={() => setActiveSessionId(s.id)}>
                            فتح
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Active session */}
        {activeSession && (
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    جلسة: <span className="font-mono">{activeSession.session_no}</span>
                    {activeSession.status === "draft" && <Badge variant="outline" className="border-amber-400 text-amber-700">مسودة</Badge>}
                    {activeSession.status === "approved" && <Badge className="bg-emerald-600">معتمد</Badge>}
                    {activeSession.status === "cancelled" && <Badge variant="secondary">ملغي</Badge>}
                  </CardTitle>
                  <CardDescription>
                    القائم بالجرد: <b>{activeSession.stocktaker_name}</b> — تاريخ: {activeSession.count_date}
                    {activeSession.approved_at && (
                      <> — معتمد في: {new Date(activeSession.approved_at).toLocaleString("ar-EG-u-nu-latn")}</>
                    )}
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={printMinutes}>
                    <Printer className="w-3 h-3 ml-1" /> طباعة محضر الجرد
                  </Button>
                  {isDraft && canApprove && (
                    <>
                      <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700"
                              disabled={busyAction === "approve" || lines.length === 0}
                              onClick={approveSession}>
                        <CheckCircle2 className="w-3 h-3 ml-1" /> اعتماد وتثبيت الرصيد
                      </Button>
                      <Button size="sm" variant="destructive" disabled={busyAction === "cancel"} onClick={cancelSession}>
                        <XCircle className="w-3 h-3 ml-1" /> إلغاء المسودة
                      </Button>
                    </>
                  )}
                  {isDraft && !canApprove && (
                    <Badge variant="outline">الاعتماد للمدير العام / التنفيذي فقط</Badge>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="entry">
                <TabsList>
                  <TabsTrigger value="entry">إدخال الجرد</TabsTrigger>
                  <TabsTrigger value="diffs">فروق الجرد ({linesWithDiff.length})</TabsTrigger>
                </TabsList>

                {/* ENTRY TAB */}
                <TabsContent value="entry" className="space-y-3">
                  <div className="relative max-w-md">
                    <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input className="pr-9" placeholder="بحث باسم الصنف" value={search}
                           onChange={(e) => setSearch(e.target.value)} />
                  </div>

                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>الصنف</TableHead>
                          <TableHead>الوحدة</TableHead>
                          <TableHead>رصيد النظام</TableHead>
                          <TableHead>الكمية الفعلية</TableHead>
                          <TableHead>الفرق</TableHead>
                          <TableHead>السبب *</TableHead>
                          <TableHead>ملاحظات</TableHead>
                          <TableHead className="text-left">إجراء</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {loadingItems ? (
                          <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">جاري التحميل...</TableCell></TableRow>
                        ) : filtered.length === 0 ? (
                          <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">لا توجد أصناف.</TableCell></TableRow>
                        ) : filtered.map((it) => {
                          const a = actuals[it.id];
                          const sys = Number(it.stock || 0);
                          const diff = a !== undefined && a !== "" ? Number(a) - sys : null;
                          const existingLine = lines.find((l) => l.item_id === it.id);
                          return (
                            <TableRow key={it.id}>
                              <TableCell className="font-medium">{it.name}</TableCell>
                              <TableCell>{it.unit}</TableCell>
                              <TableCell className="font-mono">{sys.toLocaleString("ar-EG-u-nu-latn")}</TableCell>
                              <TableCell>
                                <Input type="number" step="0.01" className="w-28"
                                       disabled={!isDraft || !canEditStocktaking}
                                       value={a ?? ""}
                                       onChange={(e) => setActuals((s) => ({ ...s, [it.id]: e.target.value }))} />
                              </TableCell>
                              <TableCell className={`font-mono ${diff !== null && diff < 0 ? "text-rose-600" : diff !== null && diff > 0 ? "text-emerald-600" : ""}`}>
                                {diff === null ? "—" : (diff > 0 ? `+${diff}` : diff)}
                              </TableCell>
                              <TableCell>
                                <Select value={reasons[it.id] || ""}
                                        onValueChange={(v) => setReasons((s) => ({ ...s, [it.id]: v }))}
                                        disabled={!isDraft || !canEditStocktaking}>
                                  <SelectTrigger className="w-40"><SelectValue placeholder="اختر السبب" /></SelectTrigger>
                                  <SelectContent>
                                    {REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                              </TableCell>
                              <TableCell>
                                <Input className="w-40" disabled={!isDraft || !canEditStocktaking} placeholder="ملاحظات"
                                       value={noteBuf[it.id] || ""}
                                       onChange={(e) => setNoteBuf((s) => ({ ...s, [it.id]: e.target.value }))} />
                              </TableCell>
                              <TableCell className="text-left flex gap-1">
                                <Button size="sm" disabled={!isDraft || !canEditStocktaking || busyItem === it.id || diff === null}
                                        onClick={() => saveLine(it)}>
                                  حفظ
                                </Button>
                                {existingLine && isDraft && canEditStocktaking && (
                                  <Button size="sm" variant="ghost" onClick={() => deleteLine(existingLine.id)}>
                                    حذف
                                  </Button>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>

                {/* DIFFS TAB */}
                <TabsContent value="diffs" className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="rounded-lg border p-3 bg-emerald-50">
                      <div className="text-xs text-muted-foreground">إجمالي الزيادة (قيمة)</div>
                      <div className="text-xl font-bold text-emerald-700 font-mono">
                        {Number(activeSession.total_increase || 0).toFixed(2)} ج.م
                      </div>
                    </div>
                    <div className="rounded-lg border p-3 bg-rose-50">
                      <div className="text-xs text-muted-foreground">إجمالي النقص (قيمة)</div>
                      <div className="text-xl font-bold text-rose-700 font-mono">
                        {Math.abs(Number(activeSession.total_decrease || 0)).toFixed(2)} ج.م
                      </div>
                    </div>
                    <div className="rounded-lg border p-3 bg-slate-50">
                      <div className="text-xs text-muted-foreground">صافي فرق الجرد</div>
                      <div className={`text-xl font-bold font-mono ${Number(activeSession.net_value || 0) >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                        {Number(activeSession.net_value || 0).toFixed(2)} ج.م
                      </div>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>الصنف</TableHead>
                          <TableHead>الوحدة</TableHead>
                          <TableHead>قبل الجرد</TableHead>
                          <TableHead>بعد الجرد</TableHead>
                          <TableHead>الفرق</TableHead>
                          <TableHead>تكلفة الوحدة</TableHead>
                          <TableHead>قيمة الفرق</TableHead>
                          <TableHead>السبب</TableHead>
                          <TableHead>ملاحظات</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {linesWithDiff.length === 0 ? (
                          <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">لا توجد فروق.</TableCell></TableRow>
                        ) : linesWithDiff.map((l) => (
                          <TableRow key={l.id}>
                            <TableCell className="font-medium">{l.item?.name || "—"}</TableCell>
                            <TableCell>{l.item?.unit || "—"}</TableCell>
                            <TableCell className="font-mono">{Number(l.system_qty).toFixed(2)}</TableCell>
                            <TableCell className="font-mono">{Number(l.actual_qty).toFixed(2)}</TableCell>
                            <TableCell className={`font-mono ${l.diff < 0 ? "text-rose-600" : "text-emerald-600"}`}>
                              {l.diff > 0 ? "+" : ""}{Number(l.diff).toFixed(2)}
                            </TableCell>
                            <TableCell className="font-mono">{Number(l.unit_cost).toFixed(2)}</TableCell>
                            <TableCell className={`font-mono font-bold ${l.diff_value < 0 ? "text-rose-700" : "text-emerald-700"}`}>
                              {Number(l.diff_value).toFixed(2)}
                            </TableCell>
                            <TableCell>{l.reason}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{l.notes || "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        )}

        <Alert>
          <ShieldCheck className="h-4 w-4" />
          <AlertDescription className="text-xs">
            <b>تدفق العمل:</b> فتح مسودة جرد ← إدخال الأرقام والأسباب ← مراجعة فروق الجرد ← اعتماد المدير العام/التنفيذي ←
            تثبيت الرصيد رسميًا (يتم إنشاء حركات adjustment لكل صنف بفرق ≠ 0 بمرجع موحّد للجلسة). لا حذف لأي حركات قديمة، ولا تغيير للأرصدة قبل الاعتماد.
          </AlertDescription>
        </Alert>
      </div>
    </DashboardLayout>
  );
}
