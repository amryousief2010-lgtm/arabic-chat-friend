import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { FileSpreadsheet, Loader2, CheckCircle2, Undo2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import * as XLSX from "xlsx";
import {
  cairoMonthStartUTC,
  currentCairoYearMonth,
} from "@/lib/cairoDate";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { updateOrderStatusShared, type SharedOrderStatus } from "@/lib/orderStatusUpdate";

interface Row {
  id: string;
  order_number: string;
  total: number;
  status: string;
  payment_method: string;
  payment_status: string;
  moderator: string | null;
  created_at: string;
  customers: { name: string | null } | null;
}

const MONTH_AR = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];
const statusAR: Record<string, string> = {
  pending: "قيد الانتظار", processing: "جاري التجهيز", shipped: "تم الشحن",
  delivered: "تم التوصيل", cancelled: "مرتجع / ملغي",
};

export default function MonthOrdersDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [returnDialog, setReturnDialog] = useState<{ ids: string[] } | null>(null);
  const [returnReason, setReturnReason] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);

  const { user, roles, isGeneralManager, isExecutiveManager, isSalesModerator } = useAuth();
  const rolesList = roles || [];
  const canUpdateStatus =
    isGeneralManager ||
    isExecutiveManager ||
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
          .select("id, order_number, total, status, payment_method, payment_status, moderator, created_at, customers(name)")
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

  const totalSum = rows.reduce((s, r) => s + Number(r.total || 0), 0);
  const deliveredSum = rows.filter(r => r.status === "delivered").reduce((s, r) => s + Number(r.total || 0), 0);

  const exportExcel = () => {
    const data = rows.map((r) => ({
      "رقم الطلب": r.order_number,
      "العميل": r.customers?.name || "-",
      "الموديريتور": r.moderator || "-",
      "الإجمالي": Number(r.total),
      "طريقة الدفع": r.payment_method === "cash" ? "نقدي" : "إلكتروني",
      "حالة الدفع": r.payment_status,
      "الحالة": statusAR[r.status] || r.status,
      "تاريخ الإنشاء": new Date(r.created_at).toLocaleString("ar-EG"),
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "طلبات الشهر");
    XLSX.writeFile(wb, `طلبات-${monthLabel}.xlsx`);
  };

  const markDelivered = async (ids: string[]) => {
    if (!canUpdateStatus) { toast.error("ليس لديك صلاحية تحديث الحالة."); return; }
    if (ids.length === 1) {
      if (!window.confirm("هل تريد تأكيد تسليم هذا الطلب؟")) return;
    } else {
      if (!window.confirm(`هل تريد تأكيد تسليم ${ids.length} طلب؟`)) return;
    }
    let ok = 0, fail = 0;
    for (const id of ids) {
      setBusyId(id);
      try {
        await updateOrderStatusShared({ orderId: id, newStatus: "delivered", userId: user?.id });
        setRows(prev => prev.map(r => r.id === id ? { ...r, status: "delivered" } : r));
        ok++;
      } catch (e: any) {
        console.error(e); fail++;
      }
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
    setSelected(new Set(rows.map(r => r.id)));
  };
  const toggleOne = (id: string, checked: boolean) => {
    setSelected(prev => {
      const n = new Set(prev);
      if (checked) n.add(id); else n.delete(id);
      return n;
    });
  };

  const selectedIds = useMemo(() => Array.from(selected), [selected]);

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden flex flex-col" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-4 flex-wrap">
            <span>طلبات {monthLabel} — {rows.length} طلب</span>
            <Button size="sm" onClick={exportExcel} disabled={loading || rows.length === 0} className="gap-2">
              <FileSpreadsheet className="w-4 h-4" /> تصدير Excel
            </Button>
          </DialogTitle>
        </DialogHeader>

        <div className="text-sm text-muted-foreground flex items-center gap-4 flex-wrap">
          <span>إجمالي المبيعات: <span className="font-bold text-primary">{totalSum.toLocaleString()} ج.م</span></span>
          <span>المُسلَّم: <span className="font-bold text-emerald-600">{deliveredSum.toLocaleString()} ج.م</span></span>
        </div>

        {canUpdateStatus && selectedIds.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap bg-muted/40 border rounded-lg p-2">
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
            <Table>
              <TableHeader className="sticky top-0 bg-background z-10">
                <TableRow>
                  {canUpdateStatus && (
                    <TableHead className="w-10">
                      <Checkbox
                        checked={rows.length > 0 && selected.size === rows.length}
                        onCheckedChange={(v) => toggleAll(!!v)}
                      />
                    </TableHead>
                  )}
                  <TableHead>رقم الطلب</TableHead>
                  <TableHead>العميل</TableHead>
                  <TableHead>الموديريتور</TableHead>
                  <TableHead>الإجمالي</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>التاريخ</TableHead>
                  {canUpdateStatus && <TableHead>إجراءات</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow><TableCell colSpan={canUpdateStatus ? 8 : 6} className="text-center py-10 text-muted-foreground">لا توجد طلبات</TableCell></TableRow>
                ) : rows.map((r) => {
                  const isDelivered = r.status === "delivered";
                  const isCancelled = r.status === "cancelled";
                  const busy = busyId === r.id;
                  return (
                    <TableRow key={r.id} className={selected.has(r.id) ? "bg-primary/5" : ""}>
                      {canUpdateStatus && (
                        <TableCell>
                          <Checkbox
                            checked={selected.has(r.id)}
                            onCheckedChange={(v) => toggleOne(r.id, !!v)}
                          />
                        </TableCell>
                      )}
                      <TableCell className="font-mono text-xs">{r.order_number}</TableCell>
                      <TableCell>{r.customers?.name || "-"}</TableCell>
                      <TableCell>{r.moderator || "-"}</TableCell>
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
                            <Button
                              size="sm"
                              className="h-7 px-2 gap-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs"
                              disabled={busy || isDelivered}
                              onClick={() => markDelivered([r.id])}
                            >
                              <CheckCircle2 className="w-3 h-3" /> تسليم
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              className="h-7 px-2 gap-1 text-xs"
                              disabled={busy || isCancelled}
                              onClick={() => { setReturnDialog({ ids: [r.id] }); setReturnReason(""); }}
                            >
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
          )}
        </div>
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
          <Textarea
            value={returnReason}
            onChange={(e) => setReturnReason(e.target.value)}
            placeholder="مثال: العميل رفض الاستلام، عنوان خاطئ، ..."
            rows={3}
          />
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
