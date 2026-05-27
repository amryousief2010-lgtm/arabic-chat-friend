import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { CheckCircle2, XCircle, RefreshCw, ShieldAlert } from "lucide-react";
import { formatCairoDateTime } from "@/lib/cairoDate";

type Row = {
  id: string;
  customer_id: string;
  requested_by: string;
  status: "pending" | "approved" | "rejected";
  reason: string | null;
  note: string | null;
  created_at: string;
  decided_at: string | null;
  expires_at: string;
  customer_name?: string;
  customer_phone?: string;
  requester_name?: string;
};

const DuplicateOrderApprovals = () => {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [decision, setDecision] = useState<{ open: boolean; row?: Row; approve: boolean; reason: string }>({
    open: false, approve: true, reason: "",
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("duplicate_order_approvals")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;

      const list = (data || []) as Row[];
      const custIds = Array.from(new Set(list.map((r) => r.customer_id)));
      const userIds = Array.from(new Set(list.map((r) => r.requested_by)));
      const [{ data: custs }, { data: profs }] = await Promise.all([
        custIds.length
          ? supabase.from("customers").select("id, name, phone").in("id", custIds)
          : Promise.resolve({ data: [] as any[] }),
        userIds.length
          ? supabase.from("profiles").select("id, full_name").in("id", userIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);
      const cMap = new Map((custs || []).map((c: any) => [c.id, c]));
      const pMap = new Map((profs || []).map((p: any) => [p.id, p.full_name]));
      setRows(list.map((r) => ({
        ...r,
        customer_name: cMap.get(r.customer_id)?.name,
        customer_phone: cMap.get(r.customer_id)?.phone,
        requester_name: pMap.get(r.requested_by),
      })));
    } catch (e: any) {
      toast.error(e.message || "تعذر تحميل الطلبات");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const ch = supabase
      .channel("dup-appr")
      .on("postgres_changes", { event: "*", schema: "public", table: "duplicate_order_approvals" }, () => fetchData())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const pending = useMemo(() => rows.filter((r) => r.status === "pending" && new Date(r.expires_at) > new Date()), [rows]);
  const decided = useMemo(() => rows.filter((r) => r.status !== "pending" || new Date(r.expires_at) <= new Date()), [rows]);

  const submitDecision = async () => {
    if (!decision.row) return;
    const { error } = await supabase.rpc("decide_duplicate_order_approval", {
      p_id: decision.row.id,
      p_approve: decision.approve,
      p_reason: decision.reason.trim() || null,
    });
    if (error) {
      toast.error(error.message || "تعذر تنفيذ العملية");
      return;
    }
    toast.success(decision.approve ? "تمت الموافقة" : "تم الرفض");
    setDecision({ open: false, approve: true, reason: "" });
    fetchData();
  };

  const renderRow = (r: Row) => (
    <div key={r.id} className="border rounded-lg p-3 bg-card space-y-1">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="font-semibold">{r.customer_name || "—"} <span className="text-xs text-muted-foreground">({r.customer_phone || "—"})</span></div>
        <Badge variant={r.status === "approved" ? "default" : r.status === "rejected" ? "destructive" : "outline"}>
          {r.status === "pending" ? "بانتظار الموافقة" : r.status === "approved" ? "تمت الموافقة" : "مرفوض"}
        </Badge>
      </div>
      <div className="text-sm text-muted-foreground">
        البنت: <span className="font-medium text-foreground">{r.requester_name || "—"}</span>
      </div>
      {r.note && <div className="text-sm">ملاحظتها: {r.note}</div>}
      {r.reason && <div className="text-sm text-muted-foreground">سبب القرار: {r.reason}</div>}
      <div className="text-xs text-muted-foreground">
        طلبت: {formatCairoDateTime(r.created_at)}
        {r.decided_at && <> • تم البت: {formatCairoDateTime(r.decided_at)}</>}
      </div>
      {r.status === "pending" && new Date(r.expires_at) > new Date() && (
        <div className="flex gap-2 pt-2">
          <Button size="sm" onClick={() => setDecision({ open: true, row: r, approve: true, reason: "" })}>
            <CheckCircle2 className="w-4 h-4 ms-1" /> موافقة
          </Button>
          <Button size="sm" variant="destructive" onClick={() => setDecision({ open: true, row: r, approve: false, reason: "" })}>
            <XCircle className="w-4 h-4 ms-1" /> رفض
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <DashboardLayout>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <Header title="موافقات تكرار الطلبات" subtitle="طلبات تسجيل أوردر لنفس العميل فى نفس اليوم — تحتاج موافقة مديرة التسويق" />
        <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldAlert className="w-5 h-5 text-primary" /> الطلبات</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="pending">
            <TabsList>
              <TabsTrigger value="pending">قيد الانتظار <Badge variant="outline" className="ms-2">{pending.length}</Badge></TabsTrigger>
              <TabsTrigger value="decided">تم البت فيها <Badge variant="outline" className="ms-2">{decided.length}</Badge></TabsTrigger>
            </TabsList>
            <TabsContent value="pending" className="space-y-2 mt-3">
              {pending.length === 0 && <p className="text-sm text-muted-foreground py-6 text-center">لا توجد طلبات معلّقة</p>}
              {pending.map(renderRow)}
            </TabsContent>
            <TabsContent value="decided" className="space-y-2 mt-3">
              {decided.length === 0 && <p className="text-sm text-muted-foreground py-6 text-center">لا يوجد سجل</p>}
              {decided.map(renderRow)}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Dialog open={decision.open} onOpenChange={(o) => setDecision((s) => ({ ...s, open: o }))}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{decision.approve ? "الموافقة على الطلب" : "رفض الطلب"}</DialogTitle>
            <DialogDescription>
              {decision.approve
                ? "بعد الموافقة هتقدر البنت تسجل الطلب لنفس العميل خلال 24 ساعة."
                : "البنت مش هتقدر تسجل الطلب، ممكن توضحى السبب."}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder={decision.approve ? "ملاحظة (اختيارى)" : "سبب الرفض"}
            value={decision.reason}
            onChange={(e) => setDecision((s) => ({ ...s, reason: e.target.value }))}
          />
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDecision({ open: false, approve: true, reason: "" })}>إلغاء</Button>
            <Button variant={decision.approve ? "default" : "destructive"} onClick={submitDecision}>
              تأكيد
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default DuplicateOrderApprovals;
