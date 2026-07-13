import { useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  ShieldCheck, Wallet, Beef, Drumstick, FlaskConical, Scissors,
  UsersRound, ShoppingCart, Factory, Eye, CheckCircle2, XCircle,
  Search, RefreshCw, AlertTriangle, MessageSquare, Send, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useExecutiveApprovals, type ApprovalCategory, type ApprovalItem } from "@/hooks/useExecutiveApprovals";
import ApprovalDetailsDialog from "@/components/executive/ApprovalDetailsDialog";

const CAT_LABEL: Record<ApprovalCategory, string> = {
  treasury: "الخزن",
  meat: "مصنع اللحوم",
  custody: "عهدة المسلخ",
  slaughter: "تقسيمة الدبح",
  lab: "خزنة المعمل",
  hr: "الموارد البشرية",
  mf_purchase: "فواتير شراء",
  mf_mfg: "فواتير تصنيع",
};
const CAT_ICON: Record<ApprovalCategory, JSX.Element> = {
  treasury: <Wallet className="h-3.5 w-3.5" />,
  meat: <Beef className="h-3.5 w-3.5" />,
  custody: <Drumstick className="h-3.5 w-3.5" />,
  slaughter: <Scissors className="h-3.5 w-3.5" />,
  lab: <FlaskConical className="h-3.5 w-3.5" />,
  hr: <UsersRound className="h-3.5 w-3.5" />,
  mf_purchase: <ShoppingCart className="h-3.5 w-3.5" />,
  mf_mfg: <Factory className="h-3.5 w-3.5" />,
};
const CAT_COLOR: Record<ApprovalCategory, string> = {
  treasury: "bg-amber-100 text-amber-800 border-amber-300",
  meat: "bg-red-100 text-red-800 border-red-300",
  custody: "bg-orange-100 text-orange-800 border-orange-300",
  slaughter: "bg-rose-100 text-rose-800 border-rose-300",
  lab: "bg-blue-100 text-blue-800 border-blue-300",
  hr: "bg-purple-100 text-purple-800 border-purple-300",
  mf_purchase: "bg-emerald-100 text-emerald-800 border-emerald-300",
  mf_mfg: "bg-indigo-100 text-indigo-800 border-indigo-300",
};

const fmtMoney = (n: any) =>
  `${Number(n || 0).toLocaleString("ar-EG", { maximumFractionDigits: 2 })} ج.م`;
const fmtDateTime = (d: string | null) =>
  d ? new Date(d).toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" }) : "—";

const ApprovalsCenter = () => {
  const { user } = useAuth();
  const { isApprover, isLoading, items, counts, approve, reject, refetch } = useExecutiveApprovals();

  // Filters
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<"all" | ApprovalCategory>("all");
  const [requester, setRequester] = useState<string>("__all__");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [minAmount, setMinAmount] = useState<string>("");

  // Actions
  const [busyId, setBusyId] = useState<string | null>(null);
  const [detailsFor, setDetailsFor] = useState<ApprovalItem | null>(null);
  const [rejectFor, setRejectFor] = useState<ApprovalItem | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [messageFor, setMessageFor] = useState<ApprovalItem | null>(null);
  const [messageText, setMessageText] = useState("");
  const [sendingMsg, setSendingMsg] = useState(false);

  const sendMessage = async () => {
    if (!messageFor || !user) return;
    if (!messageFor.created_by) {
      toast.error("لا يوجد مستلم لهذا الطلب");
      return;
    }
    if (messageText.trim().length < 2) {
      toast.error("اكتب نص الرسالة");
      return;
    }
    setSendingMsg(true);
    try {
      const subject = `بخصوص: ${messageFor.title}`;
      const { data: msg, error: msgErr } = await (supabase as any)
        .from("internal_messages")
        .insert({
          sender_id: user.id,
          subject: subject.slice(0, 200),
          body: messageText.trim(),
          priority: "normal",
          has_attachments: false,
        })
        .select("id")
        .single();
      if (msgErr) throw msgErr;
      const { error: recErr } = await (supabase as any)
        .from("internal_message_recipients")
        .insert([{ message_id: msg.id, recipient_id: messageFor.created_by }]);
      if (recErr) throw recErr;
      toast.success("تم إرسال الرسالة");
      setMessageFor(null);
      setMessageText("");
    } catch (e: any) {
      toast.error(e?.message || "فشل الإرسال");
    } finally {
      setSendingMsg(false);
    }
  };

  const requesters = useMemo(() => {
    const map = new Map<string, string>();
    items.forEach((i) => {
      if (i.created_by) map.set(i.created_by, i.creator_name || i.created_by);
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const min = Number(minAmount) || 0;
    const fromTs = fromDate ? new Date(fromDate).getTime() : null;
    const toTs = toDate ? new Date(toDate + "T23:59:59").getTime() : null;
    return items.filter((it) => {
      if (category !== "all" && it.category !== category) return false;
      if (requester !== "__all__" && it.created_by !== requester) return false;
      if (min > 0 && Number(it.amount || 0) < min) return false;
      if (fromTs && new Date(it.created_at).getTime() < fromTs) return false;
      if (toTs && new Date(it.created_at).getTime() > toTs) return false;
      if (q) {
        const hay = `${it.title} ${it.subtitle || ""} ${it.source} ${it.creator_name || ""} ${it.raw?.invoice_no || ""} ${it.raw?.reference_no || ""} ${it.raw?.batch_number || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, category, requester, minAmount, fromDate, toDate, search]);

  const doApprove = async (item: ApprovalItem) => {
    setBusyId(item.id);
    try {
      await approve(item);
      toast.success("تم اعتماد الطلب");
    } catch (e: any) {
      toast.error(e?.message || "فشل الاعتماد");
    } finally { setBusyId(null); }
  };

  const submitReject = async () => {
    if (!rejectFor) return;
    if (rejectReason.trim().length < 3) {
      toast.error("سبب الرفض يجب أن يكون 3 أحرف على الأقل");
      return;
    }
    setBusyId(rejectFor.id);
    try {
      await reject(rejectFor, rejectReason.trim());
      toast.success("تم تسجيل الرفض");
      setRejectFor(null);
      setRejectReason("");
    } catch (e: any) {
      toast.error(e?.message || "فشل الرفض");
    } finally { setBusyId(null); }
  };

  const resetFilters = () => {
    setSearch(""); setCategory("all"); setRequester("__all__");
    setFromDate(""); setToDate(""); setMinAmount("");
  };

  if (!isApprover) {
    return (
      <DashboardLayout>
        <div dir="rtl" className="p-6 text-center">
          <AlertTriangle className="h-12 w-12 mx-auto text-amber-500 mb-3" />
          <h2 className="text-lg font-semibold">صفحة محصورة على المدير العام والمدير التنفيذي</h2>
        </div>
      </DashboardLayout>
    );
  }

  const kpis: Array<{ key: ApprovalCategory | "all"; label: string; value: number; icon: JSX.Element; color: string }> = [
    { key: "all", label: "إجمالي المعلق", value: counts.all, icon: <ShieldCheck className="h-4 w-4" />, color: "bg-primary/10 text-primary border-primary/30" },
    { key: "treasury", label: CAT_LABEL.treasury, value: counts.treasury, icon: CAT_ICON.treasury, color: CAT_COLOR.treasury },
    { key: "mf_purchase", label: CAT_LABEL.mf_purchase, value: counts.mf_purchase, icon: CAT_ICON.mf_purchase, color: CAT_COLOR.mf_purchase },
    { key: "mf_mfg", label: CAT_LABEL.mf_mfg, value: counts.mf_mfg, icon: CAT_ICON.mf_mfg, color: CAT_COLOR.mf_mfg },
    { key: "meat", label: CAT_LABEL.meat, value: counts.meat, icon: CAT_ICON.meat, color: CAT_COLOR.meat },
    { key: "slaughter", label: CAT_LABEL.slaughter, value: counts.slaughter, icon: CAT_ICON.slaughter, color: CAT_COLOR.slaughter },
    { key: "custody", label: CAT_LABEL.custody, value: counts.custody, icon: CAT_ICON.custody, color: CAT_COLOR.custody },
    { key: "lab", label: CAT_LABEL.lab, value: counts.lab, icon: CAT_ICON.lab, color: CAT_COLOR.lab },
    { key: "hr", label: CAT_LABEL.hr, value: counts.hr, icon: CAT_ICON.hr, color: CAT_COLOR.hr },
  ];

  return (
    <DashboardLayout>
      <div dir="rtl" className="p-4 md:p-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-7 w-7 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">مركز الاعتمادات</h1>
              <p className="text-sm text-muted-foreground">
                جميع الطلبات المعلقة من كل الأقسام في مكان واحد — للمدير العام والمدير التنفيذي
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className="h-4 w-4 ml-1" /> تحديث
          </Button>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9 gap-2">
          {kpis.map((k) => {
            const active = category === k.key;
            return (
              <button
                key={k.key}
                onClick={() => setCategory(k.key as any)}
                className={`text-right rounded-lg border p-3 transition-all hover:shadow-md ${active ? "ring-2 ring-primary" : ""} ${k.color}`}
              >
                <div className="flex items-center gap-2 text-xs">{k.icon}<span>{k.label}</span></div>
                <div className="text-2xl font-bold mt-1 tabular-nums">{k.value}</div>
              </button>
            );
          })}
        </div>

        {/* Filters */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">الفلاتر</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="lg:col-span-2">
              <Label className="text-xs">بحث (رقم/عنوان/وصف)</Label>
              <div className="relative">
                <Search className="absolute right-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input className="pr-8" placeholder="ابحث برقم الفاتورة، اسم الموظف، الوصف..." value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            </div>
            <div>
              <Label className="text-xs">القسم</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الأقسام</SelectItem>
                  {(Object.keys(CAT_LABEL) as ApprovalCategory[]).map((c) => (
                    <SelectItem key={c} value={c}>{CAT_LABEL[c]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">طالب الاعتماد</Label>
              <Select value={requester} onValueChange={setRequester}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">الكل</SelectItem>
                  {requesters.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">من تاريخ</Label>
              <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">إلى تاريخ</Label>
              <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">حد أدنى للقيمة</Label>
              <Input type="number" min={0} value={minAmount} onChange={(e) => setMinAmount(e.target.value)} placeholder="0" />
            </div>
            <div className="flex items-end">
              <Button variant="outline" size="sm" onClick={resetFilters} className="w-full">إعادة الضبط</Button>
            </div>
          </CardContent>
        </Card>

        {/* Note */}
        <div className="text-xs rounded-md border border-amber-300 bg-amber-50 text-amber-900 px-3 py-2">
          الحالة المعروضة دائمًا <b>بانتظار الاعتماد</b>. عند الاعتماد ينفَّذ أثر العملية مرة واحدة فقط حسب نوعها (لن تتكرر حركة خزنة أو مخزون). الرفض لا يؤثر على المخزون أو الخزنة أو الرواتب ويُحفظ كسجل دائم.
        </div>

        {/* Table */}
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-base">الطلبات المعلقة ({filtered.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>القسم</TableHead>
                  <TableHead>نوع الاعتماد</TableHead>
                  <TableHead>رقم الطلب / الوصف</TableHead>
                  <TableHead>القيمة</TableHead>
                  <TableHead>طالب الاعتماد</TableHead>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead className="text-center">إجراء</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((item) => (
                  <TableRow key={`${item.category}-${item.id}`}>
                    <TableCell>
                      <Badge variant="outline" className={CAT_COLOR[item.category]}>
                        <span className="ml-1">{CAT_ICON[item.category]}</span>
                        {CAT_LABEL[item.category]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">{item.source}</TableCell>
                    <TableCell>
                      <div className="font-medium text-sm">{item.title}</div>
                      {item.subtitle && <div className="text-xs text-muted-foreground line-clamp-2">{item.subtitle}</div>}
                    </TableCell>
                    <TableCell className="font-bold text-primary tabular-nums whitespace-nowrap">
                      {item.amount != null ? fmtMoney(item.amount) : (item.qty != null ? `${item.qty} ${item.unit || ""}` : "—")}
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{item.creator_name || "—"}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{fmtDateTime(item.created_at)}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="bg-amber-100 text-amber-800 border-amber-300">بانتظار الاعتماد</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1 justify-center flex-wrap">
                        <Button size="sm" variant="outline" onClick={() => setDetailsFor(item)}>
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" disabled={busyId === item.id} onClick={() => doApprove(item)} className="bg-emerald-600 hover:bg-emerald-700">
                          <CheckCircle2 className="h-3.5 w-3.5 ml-1" /> اعتماد
                        </Button>
                        <Button size="sm" variant="destructive" disabled={busyId === item.id}
                                onClick={() => { setRejectFor(item); setRejectReason(""); }}>
                          <XCircle className="h-3.5 w-3.5 ml-1" /> رفض
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {!filtered.length && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-10">
                      {isLoading ? "جاري التحميل..." : "لا توجد اعتمادات مطابقة للفلاتر الحالية"}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Reject dialog */}
      <Dialog open={!!rejectFor} onOpenChange={(v) => { if (!v) { setRejectFor(null); setRejectReason(""); } }}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader><DialogTitle>سبب الرفض</DialogTitle></DialogHeader>
          {rejectFor && (
            <div className="text-xs text-muted-foreground mb-2">
              {CAT_LABEL[rejectFor.category]} — {rejectFor.title}
            </div>
          )}
          <Textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="اكتب سبب الرفض (3 أحرف على الأقل)"
            rows={4}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRejectFor(null); setRejectReason(""); }}>إلغاء</Button>
            <Button variant="destructive" onClick={submitReject} disabled={busyId === rejectFor?.id}>تأكيد الرفض</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ApprovalDetailsDialog item={detailsFor} onClose={() => setDetailsFor(null)} />
    </DashboardLayout>
  );
};

export default ApprovalsCenter;
