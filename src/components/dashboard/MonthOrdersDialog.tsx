import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { FileSpreadsheet, Loader2, CheckCircle2, Undo2, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import * as XLSX from "xlsx";
import { cairoMonthStartUTC, currentCairoYearMonth } from "@/lib/cairoDate";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { updateOrderStatusShared } from "@/lib/orderStatusUpdate";

interface Row {
  id: string;
  order_number: string;
  total: number;
  status: string;
  payment_method: string;
  payment_status: string;
  moderator: string | null;
  created_at: string;
  source_warehouse_id: string | null;
  shipping_bill_no: string | null;
  customers: { name: string | null; phone?: string | null } | null;
}

const MAIN_WH_ID = "5ec781b5-685b-4806-b59a-83a79ea5662c";
const AGOUZA_WH_ID = "a970d469-37df-40e1-b99f-a49195a3778e";

type WhKey = "all" | "main" | "agouza" | "unknown" | "overdue";

const WH_LABEL: Record<Exclude<WhKey, "all" | "overdue">, string> = {
  main: "المخزن الرئيسي",
  agouza: "مخزن العجوزة",
  unknown: "غير محدد",
};

const OVERDUE_DAYS = 6;
function isOverdue(r: { created_at: string; status: string }): boolean {
  if (r.status === "delivered" || r.status === "cancelled") return false;
  const ageDays = (Date.now() - new Date(r.created_at).getTime()) / 86400000;
  return ageDays > OVERDUE_DAYS;
}

const MONTH_AR = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];
const statusAR: Record<string, string> = {
  pending: "قيد الانتظار", processing: "جاري التجهيز", shipped: "تم الشحن",
  delivered: "تم التوصيل", cancelled: "مرتجع / ملغي",
};

function classifyWh(id: string | null): Exclude<WhKey, "all"> {
  if (id === MAIN_WH_ID) return "main";
  if (id === AGOUZA_WH_ID) return "agouza";
  return "unknown";
}

function computeStats(rs: Row[]) {
  const s = { count: 0, total: 0, delivered: 0, deliveredSum: 0, cancelled: 0, cancelledSum: 0, remaining: 0, remainingSum: 0 };
  for (const r of rs) {
    const t = Number(r.total || 0);
    s.count++; s.total += t;
    if (r.status === "delivered") { s.delivered++; s.deliveredSum += t; }
    else if (r.status === "cancelled") { s.cancelled++; s.cancelledSum += t; }
    else { s.remaining++; s.remainingSum += t; }
  }
  return s;
}

function StatBlock({ title, stats, tone, onRemainingClick }: { title: string; stats: ReturnType<typeof computeStats>; tone: string; onRemainingClick?: () => void }) {
  return (
    <div className={`rounded-lg border p-3 ${tone}`}>
      <div className="font-bold mb-2">{title} — {stats.count} طلب</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <div>إجمالي المبيعات: <b className="text-primary">{stats.total.toLocaleString()} ج.م</b></div>
        <div>المُسلَّم: <b className="text-emerald-700">{stats.delivered} / {stats.deliveredSum.toLocaleString()} ج.م</b></div>
        <div>المرتجع / ملغي: <b className="text-rose-700">{stats.cancelled} / {stats.cancelledSum.toLocaleString()} ج.م</b></div>
        <div>
          المتبقي للتسليم:{" "}
          {onRemainingClick && stats.remaining > 0 ? (
            <button
              type="button"
              onClick={onRemainingClick}
              className="font-bold text-amber-700 underline decoration-dotted hover:text-amber-900"
              title="اعرض بوالص الشحن"
            >
              {stats.remaining} / {stats.remainingSum.toLocaleString()} ج.م
            </button>
          ) : (
            <b className="text-amber-700">{stats.remaining} / {stats.remainingSum.toLocaleString()} ج.م</b>
          )}
        </div>
      </div>
    </div>
  );
}

export default function MonthOrdersDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [returnDialog, setReturnDialog] = useState<{ ids: string[] } | null>(null);
  const [returnReason, setReturnReason] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [tab, setTab] = useState<WhKey>("all");

  const { user, roles, isGeneralManager, isExecutiveManager, isSalesModerator } = useAuth();
  const rolesList = roles || [];
  const canUpdateStatus =
    isGeneralManager || isExecutiveManager ||
    rolesList.includes("marketing_sales_manager") ||
    rolesList.includes("sales_manager") ||
    isSalesModerator ||
    rolesList.includes("shipping_company") ||
    rolesList.includes("private_delivery_rep" as any) ||
    rolesList.includes("courier" as any);

  const { year, monthIndex0 } = currentCairoYearMonth();
  const monthLabel = `${MONTH_AR[monthIndex0]} ${year}`;

  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setTab("all");
    (async () => {
      setLoading(true);
      const start = cairoMonthStartUTC(year, monthIndex0).toISOString();
      const end = cairoMonthStartUTC(year, monthIndex0 + 1).toISOString();
      let all: Row[] = [];
      let page = 0;
      const size = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("orders")
          .select("id, order_number, total, status, payment_method, payment_status, moderator, created_at, source_warehouse_id, customers(name)")
          .gte("created_at", start)
          .lt("created_at", end)
          .order("created_at", { ascending: false })
          .range(page * size, (page + 1) * size - 1);
        if (error) { toast.error(error.message); break; }
        all = all.concat((data || []) as any);
        if (!data || data.length < size) break;
        page++;
      }
      setRows(all);
      setLoading(false);
    })();
  }, [open, year, monthIndex0]);

  const buckets = useMemo(() => {
    const b = { main: [] as Row[], agouza: [] as Row[], unknown: [] as Row[], overdue: [] as Row[] };
    for (const r of rows) {
      b[classifyWh(r.source_warehouse_id)].push(r);
      if (isOverdue(r)) b.overdue.push(r);
    }
    return b;
  }, [rows]);

  const stats = useMemo(() => ({
    all: computeStats(rows),
    main: computeStats(buckets.main),
    agouza: computeStats(buckets.agouza),
    unknown: computeStats(buckets.unknown),
    overdue: computeStats(buckets.overdue),
  }), [rows, buckets]);

  const visibleRows = tab === "all" ? rows : buckets[tab];
  const hasUnknown = buckets.unknown.length > 0;
  const hasOverdue = buckets.overdue.length > 0;

  const exportExcel = () => {
    const src = visibleRows;
    const data = src.map((r) => ({
      "رقم الطلب": r.order_number,
      "العميل": r.customers?.name || "-",
      "الموديريتور": r.moderator || "-",
      "المخزن": WH_LABEL[classifyWh(r.source_warehouse_id)],
      "الإجمالي": Number(r.total),
      "طريقة الدفع": r.payment_method === "cash" ? "نقدي" : "إلكتروني",
      "حالة الدفع": r.payment_status,
      "الحالة": statusAR[r.status] || r.status,
      "تاريخ الإنشاء": new Date(r.created_at).toLocaleString("ar-EG"),
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    const suffix = tab === "all" ? "الكل" : tab === "overdue" ? "متأخر التسليم" : WH_LABEL[tab];
    XLSX.utils.book_append_sheet(wb, ws, "طلبات");
    XLSX.writeFile(wb, `طلبات-${monthLabel}-${suffix}.xlsx`);
  };

  const markDelivered = async (ids: string[]) => {
    if (!canUpdateStatus) { toast.error("ليس لديك صلاحية تحديث الحالة."); return; }
    const msg = ids.length === 1 ? "هل تريد تأكيد تسليم هذا الطلب؟" : `هل تريد تأكيد تسليم ${ids.length} طلب؟`;
    if (!window.confirm(msg)) return;
    let ok = 0, fail = 0;
    for (const id of ids) {
      setBusyId(id);
      try {
        await updateOrderStatusShared({ orderId: id, newStatus: "delivered", userId: user?.id });
        setRows(prev => prev.map(r => r.id === id ? { ...r, status: "delivered" } : r));
        ok++;
      } catch (e: any) { console.error(e); fail++; }
    }
    setBusyId(null);
    setSelected(new Set());
    if (ok) toast.success(`تم تحديث ${ok} طلب إلى تم التسليم`);
    if (fail) toast.error(`فشل تحديث ${fail} طلب`);
  };

  const confirmReturn = async () => {
    if (!returnDialog) return;
    if (!canUpdateStatus) { toast.error("ليس لديك صلاحية تحديث الحالة."); return; }
    const reason = returnReason.trim();
    if (!reason) { toast.error("أدخل سبب المرتجع"); return; }
    setBulkBusy(true);
    let ok = 0, fail = 0;
    for (const id of returnDialog.ids) {
      try {
        await updateOrderStatusShared({ orderId: id, newStatus: "cancelled", userId: user?.id, cancelReason: reason });
        setRows(prev => prev.map(r => r.id === id ? { ...r, status: "cancelled" } : r));
        ok++;
      } catch (e) { console.error(e); fail++; }
    }
    setBulkBusy(false);
    setReturnDialog(null);
    setReturnReason("");
    setSelected(new Set());
    if (ok) toast.success(`تم تسجيل ${ok} مرتجع`);
    if (fail) toast.error(`فشل ${fail} تحديث`);
  };

  const toggleAll = (checked: boolean) => {
    if (!checked) { setSelected(new Set()); return; }
    setSelected(new Set(visibleRows.map(r => r.id)));
  };
  const toggleOne = (id: string, checked: boolean) => {
    setSelected(prev => { const n = new Set(prev); if (checked) n.add(id); else n.delete(id); return n; });
  };

  const selectedIds = useMemo(() => Array.from(selected).filter(id => visibleRows.some(r => r.id === id)), [selected, visibleRows]);

  const whBadge = (id: string | null) => {
    const k = classifyWh(id);
    const cls = k === "main" ? "bg-blue-100 text-blue-800 border-blue-300"
      : k === "agouza" ? "bg-purple-100 text-purple-800 border-purple-300"
      : "bg-gray-100 text-gray-700 border-gray-300";
    return <Badge variant="outline" className={`${cls} text-[10px]`}>{WH_LABEL[k]}</Badge>;
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto flex flex-col" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-4 flex-wrap">
            <span>طلبات {monthLabel} — {rows.length} طلب</span>
            <Button size="sm" onClick={exportExcel} disabled={loading || visibleRows.length === 0} className="gap-2">
              <FileSpreadsheet className="w-4 h-4" /> تصدير Excel
            </Button>
          </DialogTitle>
        </DialogHeader>

        {hasUnknown && (
          <div className="flex items-center gap-2 text-xs bg-amber-50 border border-amber-300 text-amber-900 rounded-md p-2">
            <AlertTriangle className="w-4 h-4" />
            يوجد {buckets.unknown.length} أوردر غير محدد المخزن، برجاء مراجعتها وربطها بالمخزن الصحيح.
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <StatBlock title="المخزن الرئيسي" stats={stats.main} tone="bg-blue-50/50 border-blue-200" />
          <StatBlock title="مخزن العجوزة" stats={stats.agouza} tone="bg-purple-50/50 border-purple-200" />
        </div>

        <button
          type="button"
          onClick={() => { setTab("overdue"); setSelected(new Set()); }}
          className={`w-full text-right rounded-lg border p-3 transition ${
            hasOverdue
              ? "bg-rose-50 border-rose-300 hover:bg-rose-100"
              : "bg-emerald-50 border-emerald-200 hover:bg-emerald-100"
          }`}
        >
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 font-bold">
              <AlertTriangle className={`w-4 h-4 ${hasOverdue ? "text-rose-700" : "text-emerald-700"}`} />
              <span className={hasOverdue ? "text-rose-800" : "text-emerald-800"}>
                متأخر التسليم (أكثر من {OVERDUE_DAYS} أيام من تاريخ التسجيل)
              </span>
            </div>
            <div className="text-xs flex items-center gap-3">
              <span>عدد: <b className={hasOverdue ? "text-rose-700" : "text-emerald-700"}>{stats.overdue.count}</b></span>
              <span>قيمة: <b className={hasOverdue ? "text-rose-700" : "text-emerald-700"}>{stats.overdue.total.toLocaleString()} ج.م</b></span>
            </div>
          </div>
        </button>

        <Tabs value={tab} onValueChange={(v) => { setTab(v as WhKey); setSelected(new Set()); }}>
          <TabsList className="flex flex-wrap h-auto">
            <TabsTrigger value="all">الكل ({stats.all.count})</TabsTrigger>
            <TabsTrigger value="main">المخزن الرئيسي ({stats.main.count})</TabsTrigger>
            <TabsTrigger value="agouza">مخزن العجوزة ({stats.agouza.count})</TabsTrigger>
            {hasUnknown && <TabsTrigger value="unknown">غير محدد ({stats.unknown.count})</TabsTrigger>}
            {hasOverdue && <TabsTrigger value="overdue" className="text-rose-700">متأخر التسليم ({stats.overdue.count})</TabsTrigger>}
          </TabsList>
          <TabsContent value={tab} className="mt-2" forceMount>
        {canUpdateStatus && selectedIds.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap bg-muted/40 border rounded-lg p-2 mb-2">
            <span className="text-sm font-semibold">تم تحديد {selectedIds.length}:</span>
            <Button size="sm" className="gap-1 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => markDelivered(selectedIds)}>
              <CheckCircle2 className="w-4 h-4" /> تسليم ناجح
            </Button>
            <Button size="sm" variant="destructive" className="gap-1" onClick={() => { setReturnDialog({ ids: selectedIds }); setReturnReason(""); }}>
              <Undo2 className="w-4 h-4" /> مرتجع
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>إلغاء التحديد</Button>
          </div>
        )}

        <div className="flex-1 overflow-auto border rounded-lg">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> جارٍ التحميل...
            </div>
          ) : (
            <>
            {/* Desktop table */}
            <div className="hidden md:block">
            <Table>
              <TableHeader className="sticky top-0 bg-background z-10">
                <TableRow>
                  {canUpdateStatus && (
                    <TableHead className="w-10">
                      <Checkbox
                        checked={visibleRows.length > 0 && selectedIds.length === visibleRows.length}
                        onCheckedChange={(v) => toggleAll(!!v)}
                      />
                    </TableHead>
                  )}
                  <TableHead>رقم الطلب</TableHead>
                  <TableHead>العميل</TableHead>
                  <TableHead>الموديريتور</TableHead>
                  <TableHead>المخزن</TableHead>
                  <TableHead>الإجمالي</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>التاريخ</TableHead>
                  {canUpdateStatus && <TableHead>إجراءات</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRows.length === 0 ? (
                  <TableRow><TableCell colSpan={canUpdateStatus ? 9 : 7} className="text-center py-10 text-muted-foreground">لا توجد طلبات</TableCell></TableRow>
                ) : visibleRows.map((r) => {
                  const isDelivered = r.status === "delivered";
                  const isCancelled = r.status === "cancelled";
                  const busy = busyId === r.id;
                  return (
                    <TableRow key={r.id} className={selected.has(r.id) ? "bg-primary/5" : ""}>
                      {canUpdateStatus && (
                        <TableCell>
                          <Checkbox checked={selected.has(r.id)} onCheckedChange={(v) => toggleOne(r.id, !!v)} />
                        </TableCell>
                      )}
                      <TableCell className="font-mono text-xs">{r.order_number}</TableCell>
                      <TableCell>{r.customers?.name || "-"}</TableCell>
                      <TableCell>{r.moderator || "-"}</TableCell>
                      <TableCell>{whBadge(r.source_warehouse_id)}</TableCell>
                      <TableCell className="font-semibold text-primary">{Number(r.total).toLocaleString()} ج.م</TableCell>
                      <TableCell>
                        <Badge variant={isDelivered ? "default" : isCancelled ? "destructive" : "outline"}>
                          {statusAR[r.status] || r.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{new Date(r.created_at).toLocaleString("ar-EG")}</TableCell>
                      {canUpdateStatus && (
                        <TableCell>
                          <div className="flex gap-1 flex-wrap">
                            <Button size="sm" className="h-7 px-2 gap-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs"
                              disabled={busy || isDelivered} onClick={() => markDelivered([r.id])}>
                              <CheckCircle2 className="w-3 h-3" /> تسليم
                            </Button>
                            <Button size="sm" variant="destructive" className="h-7 px-2 gap-1 text-xs"
                              disabled={busy || isCancelled} onClick={() => { setReturnDialog({ ids: [r.id] }); setReturnReason(""); }}>
                              <Undo2 className="w-3 h-3" /> مرتجع
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden space-y-2 p-2">
              {visibleRows.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground text-sm">لا توجد طلبات</div>
              ) : visibleRows.map((r) => {
                const isDelivered = r.status === "delivered";
                const isCancelled = r.status === "cancelled";
                const busy = busyId === r.id;
                return (
                  <div key={r.id} className={`border rounded-lg p-3 space-y-2 ${selected.has(r.id) ? "bg-primary/5" : ""}`}>
                    <div className="flex items-center gap-2 flex-wrap">
                      {canUpdateStatus && (
                        <Checkbox checked={selected.has(r.id)} onCheckedChange={(v) => toggleOne(r.id, !!v)} />
                      )}
                      <span className="font-mono text-xs">{r.order_number}</span>
                      {whBadge(r.source_warehouse_id)}
                      <Badge variant={isDelivered ? "default" : isCancelled ? "destructive" : "outline"} className="text-[10px]">
                        {statusAR[r.status] || r.status}
                      </Badge>
                    </div>
                    <div className="text-sm font-semibold">{r.customers?.name || "-"}</div>
                    <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3">
                      <span className="text-primary font-bold">{Number(r.total).toLocaleString()} ج.م</span>
                      <span>{new Date(r.created_at).toLocaleString("ar-EG")}</span>
                      {r.moderator && <span>👤 {r.moderator}</span>}
                    </div>
                    {canUpdateStatus && (
                      <div className="flex gap-2">
                        <Button size="sm" className="flex-1 gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                          disabled={busy || isDelivered} onClick={() => markDelivered([r.id])}>
                          <CheckCircle2 className="w-4 h-4" /> تسليم
                        </Button>
                        <Button size="sm" variant="destructive" className="flex-1 gap-1"
                          disabled={busy || isCancelled} onClick={() => { setReturnDialog({ ids: [r.id] }); setReturnReason(""); }}>
                          <Undo2 className="w-4 h-4" /> مرتجع
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            </>
          )}
        </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>

    <Dialog open={!!returnDialog} onOpenChange={(v) => { if (!v) { setReturnDialog(null); setReturnReason(""); } }}>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogHeader>
          <DialogTitle>تأكيد المرتجع</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          سيتم تحديث {returnDialog?.ids.length || 0} طلب إلى "مرتجع / ملغي" وتسجيل السبب في الملاحظات.
        </p>
        <div>
          <label className="text-sm font-semibold block mb-1">سبب المرتجع *</label>
          <Textarea value={returnReason} onChange={(e) => setReturnReason(e.target.value)}
            placeholder="مثال: العميل رفض الاستلام، عنوان خاطئ، ..." rows={3} />
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="ghost" onClick={() => { setReturnDialog(null); setReturnReason(""); }} disabled={bulkBusy}>إلغاء</Button>
          <Button variant="destructive" onClick={confirmReturn} disabled={bulkBusy || !returnReason.trim()}>
            {bulkBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : "تأكيد المرتجع"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}
