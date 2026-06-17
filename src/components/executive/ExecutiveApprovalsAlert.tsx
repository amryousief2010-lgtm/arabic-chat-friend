import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Bell, CheckCircle2, XCircle, ShieldAlert, Wallet, Beef, Drumstick, FlaskConical, Scissors, Eye, UsersRound } from "lucide-react";
import { useExecutiveApprovals, type ApprovalItem, type ApprovalCategory } from "@/hooks/useExecutiveApprovals";
import ApprovalDetailsDialog from "./ApprovalDetailsDialog";

const SESSION_KEY = "executive_approvals_dismissed_at";
const LAST_SEEN_KEY = "executive_approvals_last_seen_total";

const fmtMoney = (n: any) =>
  `${Number(n || 0).toLocaleString("ar-EG", { maximumFractionDigits: 2 })} ج.م`;
const fmtDateTime = (d: string | null) =>
  d ? new Date(d).toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" }) : "—";

const CAT_LABEL: Record<ApprovalCategory, string> = {
  treasury: "الخزن",
  meat: "مصنع اللحوم",
  custody: "عهدة الدبح",
  slaughter: "تقسيمة الدبح",
  lab: "المعمل",
  hr: "خصومات الموظفين",
};
const CAT_ICON: Record<ApprovalCategory, JSX.Element> = {
  treasury: <Wallet className="h-4 w-4" />,
  meat: <Beef className="h-4 w-4" />,
  custody: <Drumstick className="h-4 w-4" />,
  slaughter: <Scissors className="h-4 w-4" />,
  lab: <FlaskConical className="h-4 w-4" />,
  hr: <UsersRound className="h-4 w-4" />,
};
const CAT_COLOR: Record<ApprovalCategory, string> = {
  treasury: "bg-amber-100 text-amber-800 border-amber-300",
  meat: "bg-red-100 text-red-800 border-red-300",
  custody: "bg-orange-100 text-orange-800 border-orange-300",
  slaughter: "bg-rose-100 text-rose-800 border-rose-300",
  lab: "bg-blue-100 text-blue-800 border-blue-300",
  hr: "bg-purple-100 text-purple-800 border-purple-300",
};

export default function ExecutiveApprovalsAlert() {
  const { isApprover, items, counts, approve, reject } = useExecutiveApprovals();
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"all" | ApprovalCategory>("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectFor, setRejectFor] = useState<ApprovalItem | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [detailsFor, setDetailsFor] = useState<ApprovalItem | null>(null);
  const lastTotalRef = useRef<number>(-1);

  // Auto-open once per session
  useEffect(() => {
    if (!isApprover || counts.all === 0) return;
    if (sessionStorage.getItem(SESSION_KEY)) return;
    setOpen(true);
  }, [isApprover, counts.all]);

  // Detect new approvals while dashboard is open → toast
  useEffect(() => {
    if (!isApprover) return;
    const prev = Number(sessionStorage.getItem(LAST_SEEN_KEY) ?? "-1");
    if (lastTotalRef.current === -1) {
      lastTotalRef.current = counts.all;
      sessionStorage.setItem(LAST_SEEN_KEY, String(counts.all));
      return;
    }
    if (counts.all > lastTotalRef.current) {
      toast.info("يوجد اعتماد جديد بانتظارك", {
        description: `إجمالي الاعتمادات المعلقة: ${counts.all}`,
        action: { label: "فتح", onClick: () => setOpen(true) },
      });
    }
    lastTotalRef.current = counts.all;
    sessionStorage.setItem(LAST_SEEN_KEY, String(counts.all));
  }, [counts.all, isApprover]);

  if (!isApprover) return null;

  const handleClose = () => {
    sessionStorage.setItem(SESSION_KEY, String(Date.now()));
    setOpen(false);
  };

  const doApprove = async (item: ApprovalItem) => {
    setBusyId(item.id);
    try {
      await approve(item);
      toast.success("تم اعتماد الطلب");
    } catch (e: any) {
      toast.error(e?.message || "فشل الاعتماد");
    } finally {
      setBusyId(null);
    }
  };

  const submitReject = async () => {
    if (!rejectFor) return;
    setBusyId(rejectFor.id);
    try {
      await reject(rejectFor, rejectReason);
      toast.success("تم تسجيل الرفض");
      setRejectFor(null);
      setRejectReason("");
    } catch (e: any) {
      toast.error(e?.message || "فشل الرفض");
    } finally {
      setBusyId(null);
    }
  };

  const filtered = activeTab === "all" ? items : items.filter((i) => i.category === activeTab);

  return (
    <>
      {/* Floating bell — always visible if there are pending items */}
      {counts.all > 0 && !open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed top-4 left-4 md:top-6 md:left-6 z-40 flex items-center gap-2 rounded-full bg-gradient-to-r from-purple-600 to-orange-500 hover:opacity-90 text-white shadow-xl px-4 py-2 text-sm font-semibold animate-pulse"
        >
          <Bell className="h-4 w-4" />
          لديك {counts.all} اعتماد بانتظار المراجعة
        </button>
      )}

      <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : handleClose())}>
        <DialogContent className="max-w-4xl max-h-[88vh] overflow-hidden flex flex-col" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-purple-700">
              <ShieldAlert className="h-5 w-5" />
              اعتمادات مطلوبة ({counts.all})
            </DialogTitle>
          </DialogHeader>

          {counts.all === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <CheckCircle2 className="h-12 w-12 mx-auto mb-3 text-emerald-500" />
              لا توجد اعتمادات معلقة حالياً
            </div>
          ) : (
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="flex-1 overflow-hidden flex flex-col">
              <TabsList className="grid grid-cols-6 w-full">
                <TabsTrigger value="all">الكل ({counts.all})</TabsTrigger>
                <TabsTrigger value="treasury">الخزن ({counts.treasury})</TabsTrigger>
                <TabsTrigger value="meat">مصنع اللحوم ({counts.meat})</TabsTrigger>
                <TabsTrigger value="slaughter">تقسيمة الدبح ({counts.slaughter})</TabsTrigger>
                <TabsTrigger value="custody">عهدة الدبح ({counts.custody})</TabsTrigger>
                <TabsTrigger value="lab">المعمل ({counts.lab})</TabsTrigger>
              </TabsList>

              <TabsContent value={activeTab} className="flex-1 overflow-y-auto mt-3 space-y-2">
                {filtered.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-sm">لا يوجد عناصر في هذا التبويب</div>
                ) : (
                  filtered.map((item) => (
                    <Card key={`${item.category}-${item.id}`} className="border-r-4" style={{ borderRightColor: "hsl(var(--primary))" }}>
                      <CardContent className="p-3 space-y-2">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="outline" className={CAT_COLOR[item.category]}>
                              <span className="ml-1">{CAT_ICON[item.category]}</span>
                              {CAT_LABEL[item.category]}
                            </Badge>
                            <Badge variant="secondary" className="text-[10px]">{item.source}</Badge>
                            <span className="font-semibold text-sm">{item.title}</span>
                          </div>
                          {item.amount != null && (
                            <div className="text-lg font-bold text-primary tabular-nums">{fmtMoney(item.amount)}</div>
                          )}
                        </div>
                        {item.subtitle && <div className="text-xs text-muted-foreground">{item.subtitle}</div>}
                        <div className="text-xs grid grid-cols-2 md:grid-cols-3 gap-x-3 gap-y-1 text-muted-foreground">
                          <div>التاريخ: <span className="text-foreground">{fmtDateTime(item.created_at)}</span></div>
                          <div>المسجِّل: <span className="text-foreground">{item.creator_name || "—"}</span></div>
                          {item.qty != null && <div>الكمية: <span className="text-foreground">{item.qty} {item.unit || ""}</span></div>}
                        </div>
                        {item.category === "slaughter" && (
                          <div className="text-[11px] rounded-md border border-amber-300 bg-amber-50 text-amber-900 px-2 py-1 leading-relaxed">
                            ملاحظة: اعتماد التقسيمة يثبت الحالة فقط، ولا يضيف نواتج الدبح إلى المخزون تلقائيًا. إدخال النواتج يتم عبر دورة حركة المخزون المنفصلة.
                          </div>
                        )}

                        <div className="flex flex-wrap gap-2 pt-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setDetailsFor(item)}
                          >
                            <Eye className="h-4 w-4 ml-1" /> تفاصيل
                          </Button>
                          <Button size="sm" disabled={busyId === item.id} onClick={() => doApprove(item)}>
                            <CheckCircle2 className="h-4 w-4 ml-1" /> اعتماد
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={busyId === item.id}
                            onClick={() => { setRejectFor(item); setRejectReason(""); }}
                          >
                            <XCircle className="h-4 w-4 ml-1" /> رفض
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
              </TabsContent>
            </Tabs>
          )}

          <DialogFooter className="border-t pt-3">
            <Button variant="ghost" onClick={handleClose}>تذكير لاحقًا</Button>
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
            <Button variant="destructive" onClick={submitReject} disabled={busyId === rejectFor?.id}>
              تأكيد الرفض
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ApprovalDetailsDialog item={detailsFor} onClose={() => setDetailsFor(null)} />
    </>
  );
}
