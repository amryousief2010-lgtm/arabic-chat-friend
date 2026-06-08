import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, CheckCircle2, XCircle, ExternalLink, Wallet, HandCoins } from "lucide-react";
import { useLabTreasuryApprovals, type PendingMovement, type PendingAdvanceDiff } from "@/hooks/useLabTreasuryApprovals";

const PM_LABEL: Record<string, string> = {
  cash: "نقدي",
  vodafone_cash: "فودافون كاش",
  instapay: "إنستاباي",
  bank_transfer: "تحويل بنكي",
};

const fmtMoney = (n: any) => `${Number(n || 0).toLocaleString("ar-EG", { maximumFractionDigits: 2 })} ج.م`;
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString("ar-EG") : "—");

const SESSION_KEY = "lab_treasury_approvals_dismissed_at";

export default function PendingApprovalsAlert() {
  const {
    isApprover,
    total,
    movements,
    advances,
    profiles,
    approveMovement,
    rejectMovement,
    approveAdvanceDifference,
    rejectAdvance,
  } = useLabTreasuryApprovals();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectFor, setRejectFor] = useState<
    { kind: "movement"; item: PendingMovement } | { kind: "advance"; item: PendingAdvanceDiff } | null
  >(null);
  const [rejectReason, setRejectReason] = useState("");

  // Auto-open once per session when there are pending items
  useEffect(() => {
    if (!isApprover || total === 0) return;
    const dismissed = sessionStorage.getItem(SESSION_KEY);
    if (dismissed) return;
    setOpen(true);
  }, [isApprover, total]);

  if (!isApprover) return null;

  const handleClose = () => {
    sessionStorage.setItem(SESSION_KEY, String(Date.now()));
    setOpen(false);
  };

  const doApproveMov = async (m: PendingMovement) => {
    setBusyId(m.id);
    try {
      await approveMovement(m);
      toast.success("تم اعتماد الحركة");
    } catch (e: any) {
      toast.error("فشل الاعتماد: " + (e?.message || ""));
    } finally {
      setBusyId(null);
    }
  };

  const doApproveAdv = async (a: PendingAdvanceDiff) => {
    setBusyId(a.id);
    try {
      await approveAdvanceDifference(a);
      toast.success("تم اعتماد فرق العهدة");
    } catch (e: any) {
      toast.error("فشل الاعتماد: " + (e?.message || ""));
    } finally {
      setBusyId(null);
    }
  };

  const submitReject = async () => {
    if (!rejectFor) return;
    try {
      if (rejectFor.kind === "movement") {
        await rejectMovement(rejectFor.item, rejectReason);
      } else {
        await rejectAdvance(rejectFor.item, rejectReason);
      }
      toast.success("تم تسجيل الرفض");
      setRejectFor(null);
      setRejectReason("");
    } catch (e: any) {
      toast.error(e?.message || "فشل الرفض");
    }
  };

  const openDetails = () => {
    handleClose();
    navigate("/lab-treasury?tab=pending");
  };

  return (
    <>
      {/* Floating reminder bubble when dialog is dismissed but items still pending */}
      {!open && total > 0 && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-24 md:bottom-6 left-4 z-40 flex items-center gap-2 rounded-full bg-amber-500 hover:bg-amber-600 text-white shadow-lg px-4 py-2 text-sm font-semibold"
        >
          <AlertTriangle className="h-4 w-4" />
          {total} اعتمادات معلقة
        </button>
      )}

      <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : handleClose())}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-700">
              <AlertTriangle className="h-5 w-5" />
              اعتمادات خزنة المعمل المعلقة ({total})
            </DialogTitle>
          </DialogHeader>

          {total === 0 ? (
            <div className="text-center py-8 text-muted-foreground">لا توجد اعتمادات معلقة</div>
          ) : (
            <div className="space-y-3">
              {movements.map((m) => (
                <Card key={m.id} className="border-amber-200">
                  <CardContent className="p-3 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Badge variant={m.movement_type === "income" ? "default" : "destructive"}>
                          {m.movement_type === "income" ? "إيراد" : "مصروف"}
                        </Badge>
                        <Badge variant="outline">{PM_LABEL[m.payment_method] || m.payment_method}</Badge>
                        <span className="text-xs text-muted-foreground">{fmtDate(m.movement_date)}</span>
                      </div>
                      <div className="text-lg font-bold text-primary">{fmtMoney(m.amount)}</div>
                    </div>
                    <div className="text-sm grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1">
                      <div><span className="text-muted-foreground">الشخص/العميل: </span>{m.customer_name || m.beneficiary || "—"}</div>
                      <div><span className="text-muted-foreground">منشئ الطلب: </span>{(m.created_by && profiles[m.created_by]) || "—"}</div>
                      <div className="md:col-span-2"><span className="text-muted-foreground">البيان: </span>{m.description || m.notes || "—"}</div>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button size="sm" disabled={busyId === m.id} onClick={() => doApproveMov(m)}>
                        <CheckCircle2 className="h-4 w-4 ml-1" /> اعتماد
                      </Button>
                      <Button size="sm" variant="destructive" disabled={busyId === m.id}
                        onClick={() => { setRejectFor({ kind: "movement", item: m }); setRejectReason(""); }}>
                        <XCircle className="h-4 w-4 ml-1" /> رفض
                      </Button>
                      <Button size="sm" variant="outline" onClick={openDetails}>
                        <ExternalLink className="h-4 w-4 ml-1" /> عرض التفاصيل
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}

              {advances.map((a) => (
                <Card key={a.id} className="border-blue-200">
                  <CardContent className="p-3 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Badge className="bg-blue-600"><HandCoins className="h-3 w-3 ml-1" /> فرق عهدة مستحق</Badge>
                        <Badge variant="outline">{PM_LABEL[a.payment_method] || a.payment_method}</Badge>
                        <span className="text-xs text-muted-foreground">عهدة {fmtDate(a.issued_at)}</span>
                      </div>
                      <div className="text-lg font-bold text-blue-700">{fmtMoney(a.pending_employee_amount)}</div>
                    </div>
                    <div className="text-sm grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1">
                      <div><span className="text-muted-foreground">الموظف: </span>{a.recipient_name}</div>
                      <div><span className="text-muted-foreground">منشئ الطلب: </span>{(a.created_by && profiles[a.created_by]) || "—"}</div>
                      <div><span className="text-muted-foreground">قيمة العهدة: </span>{fmtMoney(a.amount)}</div>
                      <div><span className="text-muted-foreground">المصروف الفعلي: </span>{fmtMoney(a.actual_expense_total)}</div>
                      <div className="md:col-span-2"><span className="text-muted-foreground">الغرض: </span>{a.purpose || a.notes || "—"}</div>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button size="sm" disabled={busyId === a.id} onClick={() => doApproveAdv(a)}>
                        <CheckCircle2 className="h-4 w-4 ml-1" /> اعتماد صرف الفرق
                      </Button>
                      <Button size="sm" variant="destructive" disabled={busyId === a.id}
                        onClick={() => { setRejectFor({ kind: "advance", item: a }); setRejectReason(""); }}>
                        <XCircle className="h-4 w-4 ml-1" /> إلغاء العهدة
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => { handleClose(); navigate("/lab-treasury?tab=advances"); }}>
                        <ExternalLink className="h-4 w-4 ml-1" /> عرض التفاصيل
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={openDetails}>
              <Wallet className="h-4 w-4 ml-1" /> فتح صفحة خزنة المعمل
            </Button>
            <Button variant="ghost" onClick={handleClose}>
              تذكير لاحقًا
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject reason dialog */}
      <Dialog open={!!rejectFor} onOpenChange={(v) => { if (!v) { setRejectFor(null); setRejectReason(""); } }}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle>سبب الرفض</DialogTitle>
          </DialogHeader>
          <Textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="اكتب سبب الرفض (3 أحرف على الأقل)"
            rows={4}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRejectFor(null); setRejectReason(""); }}>إلغاء</Button>
            <Button variant="destructive" onClick={submitReject}>تأكيد الرفض</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
