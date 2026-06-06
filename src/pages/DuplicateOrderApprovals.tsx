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
import { CheckCircle2, ClipboardList, RefreshCw, ShieldAlert, XCircle } from "lucide-react";

const fmt = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString("ar-EG", { timeZone: "Africa/Cairo", dateStyle: "short", timeStyle: "short" }) : "—";

type ApprovalRow = {
  id: string;
  customer_id: string;
  requested_by: string;
  status: "pending" | "approved" | "rejected";
  reason: string | null;
  note: string | null;
  created_at: string;
  decided_at: string | null;
  decided_by: string | null;
  expires_at: string;
  matched_order_id: string | null;
  duplicate_score: number | null;
  proposed_order: any;
  proposed_items: any[];
  resolved_order_id: string | null;
  customer_name?: string;
  customer_phone?: string;
  requester_name?: string;
  decider_name?: string;
  matched_order?: {
    id: string;
    order_number: string;
    customer_name: string;
    customer_phone: string;
    moderator_name: string;
    created_at: string;
    status: string;
    shipping_company: string | null;
    fulfillment_type: string | null;
    delivery_address: string | null;
    products_summary: string;
  };
};

type AuditRow = {
  id: string;
  attempted_by: string;
  customer_id: string | null;
  customer_phone: string | null;
  matched_order_id: string | null;
  approval_id: string | null;
  similarity_score: number | null;
  proposed_order: any;
  proposed_items: any[];
  matched_order_snapshot: any;
  status: "detected" | "request_created" | "approved" | "rejected" | "saved_with_approval";
  decision_by: string | null;
  decision_reason: string | null;
  decided_at: string | null;
  created_at: string;
  attempted_by_name?: string;
  decision_by_name?: string;
  customer_name?: string;
};

type PotentialDuplicateRow = {
  cairo_order_date: string;
  shared_phone: string;
  order_a_id: string;
  order_a_number: string;
  order_a_created_at: string;
  order_a_customer_name: string;
  moderator_a: string;
  status_a: string;
  products_a: string;
  order_b_id: string;
  order_b_number: string;
  order_b_created_at: string;
  order_b_customer_name: string;
  moderator_b: string;
  status_b: string;
  products_b: string;
  same_shipping: boolean;
  same_address: boolean;
  same_items: boolean;
  similarity_score: number;
};

const summarizeItems = (items: any[] = []) =>
  items
    .map((item) => {
      const label = item?.offer_name || item?.product_name || item?.name || "—";
      const qty = Number(item?.quantity || 0);
      return `${label}${qty ? ` × ${qty}` : ""}`;
    })
    .join("، ");

const statusLabel = (status: string) => {
  if (status === "pending") return "بانتظار الموافقة";
  if (status === "approved") return "تمت الموافقة";
  if (status === "rejected") return "مرفوض";
  if (status === "saved_with_approval") return "تم حفظ الأوردر بعد الموافقة";
  if (status === "request_created") return "تم إنشاء طلب الموافقة";
  if (status === "detected") return "تم اكتشاف تكرار";
  return status;
};

const statusVariant = (status: string): "default" | "destructive" | "outline" | "secondary" => {
  if (status === "approved" || status === "saved_with_approval") return "default";
  if (status === "rejected") return "destructive";
  if (status === "request_created" || status === "pending") return "secondary";
  return "outline";
};

const DuplicateOrderApprovals = () => {
  const [rows, setRows] = useState<ApprovalRow[]>([]);
  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);
  const [reportRows, setReportRows] = useState<PotentialDuplicateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [decision, setDecision] = useState<{ open: boolean; row?: ApprovalRow; approve: boolean; reason: string }>({
    open: false, approve: true, reason: "",
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const [{ data: approvals, error: approvalsError }, { data: audits, error: auditsError }, { data: report, error: reportError }] = await Promise.all([
        supabase.from("duplicate_order_approvals").select("*").order("created_at", { ascending: false }).limit(500),
        supabase.from("duplicate_order_attempt_audit").select("*").order("created_at", { ascending: false }).limit(500),
        supabase.rpc("get_potential_duplicate_orders_report", { p_limit: 200 }),
      ]);

      if (approvalsError) throw approvalsError;
      if (auditsError) throw auditsError;
      if (reportError) throw reportError;

      const approvalsList = (approvals || []) as ApprovalRow[];
      const auditsList = (audits || []) as AuditRow[];
      const orderIds = Array.from(new Set([
        ...approvalsList.map((row) => row.matched_order_id).filter(Boolean),
        ...approvalsList.map((row) => row.resolved_order_id).filter(Boolean),
        ...auditsList.map((row) => row.matched_order_id).filter(Boolean),
      ])) as string[];
      const customerIds = Array.from(new Set([
        ...approvalsList.map((row) => row.customer_id).filter(Boolean),
        ...auditsList.map((row) => row.customer_id).filter(Boolean),
      ])) as string[];
      const userIds = Array.from(new Set([
        ...approvalsList.map((row) => row.requested_by).filter(Boolean),
        ...approvalsList.map((row) => row.decided_by).filter(Boolean),
        ...auditsList.map((row) => row.attempted_by).filter(Boolean),
        ...auditsList.map((row) => row.decision_by).filter(Boolean),
      ])) as string[];

      const [{ data: customers }, { data: profiles }, { data: orders }, { data: orderItems }] = await Promise.all([
        customerIds.length ? supabase.from("customers").select("id, name, phone").in("id", customerIds) : Promise.resolve({ data: [] as any[] }),
        userIds.length ? supabase.from("profile_directory").select("id, full_name").in("id", userIds) : Promise.resolve({ data: [] as any[] }),
        orderIds.length
          ? supabase.from("orders").select("id, order_number, customer_id, created_at, status, shipping_company, fulfillment_type, delivery_address, created_by").in("id", orderIds)
          : Promise.resolve({ data: [] as any[] }),
        orderIds.length
          ? supabase.from("order_items").select("order_id, product_name, quantity, offer_name").in("order_id", orderIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);

      const customerMap = new Map((customers || []).map((row: any) => [row.id, row]));
      const profileMap = new Map((profiles || []).map((row: any) => [row.id, row.full_name]));
      const orderMap = new Map((orders || []).map((row: any) => [row.id, row]));
      const orderSummaryMap = new Map<string, string>();

      for (const item of orderItems || []) {
        const current = orderSummaryMap.get(item.order_id) || [];
        const next = Array.isArray(current) ? current : [current];
        next.push(`${item.offer_name || item.product_name} × ${Number(item.quantity || 0)}`);
        orderSummaryMap.set(item.order_id, next.join("، "));
      }

      const mapOrderCard = (orderId: string | null | undefined) => {
        if (!orderId) return undefined;
        const order = orderMap.get(orderId);
        if (!order) return undefined;
        const customer = customerMap.get(order.customer_id);
        return {
          id: order.id,
          order_number: order.order_number,
          customer_name: customer?.name || "—",
          customer_phone: customer?.phone || "—",
          moderator_name: profileMap.get(order.created_by) || "—",
          created_at: order.created_at,
          status: order.status,
          shipping_company: order.shipping_company,
          fulfillment_type: order.fulfillment_type,
          delivery_address: order.delivery_address,
          products_summary: orderSummaryMap.get(order.id) || "—",
        };
      };

      setRows(approvalsList.map((row) => ({
        ...row,
        customer_name: customerMap.get(row.customer_id)?.name,
        customer_phone: customerMap.get(row.customer_id)?.phone,
        requester_name: profileMap.get(row.requested_by),
        decider_name: row.decided_by ? profileMap.get(row.decided_by) : undefined,
        matched_order: mapOrderCard(row.matched_order_id),
      })));

      setAuditRows(auditsList.map((row) => ({
        ...row,
        attempted_by_name: profileMap.get(row.attempted_by),
        decision_by_name: row.decision_by ? profileMap.get(row.decision_by) : undefined,
        customer_name: row.customer_id ? customerMap.get(row.customer_id)?.name : undefined,
      })));

      setReportRows((report || []) as PotentialDuplicateRow[]);
    } catch (e: any) {
      toast.error(e.message || "تعذر تحميل الطلبات");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const approvalsChannel = supabase
      .channel("dup-appr")
      .on("postgres_changes", { event: "*", schema: "public", table: "duplicate_order_approvals" }, fetchData)
      .subscribe();
    const auditChannel = supabase
      .channel("dup-appr-audit")
      .on("postgres_changes", { event: "*", schema: "public", table: "duplicate_order_attempt_audit" }, fetchData)
      .subscribe();
    return () => {
      supabase.removeChannel(approvalsChannel);
      supabase.removeChannel(auditChannel);
    };
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

  const renderOrderCard = (title: string, data: { customer_name?: string; customer_phone?: string; delivery_address?: string | null; shipping_company?: string | null; fulfillment_type?: string | null; products_summary?: string; order_number?: string; moderator_name?: string; created_at?: string; status?: string } | null | undefined) => (
    <div className="rounded-lg border p-3 space-y-2 bg-muted/20">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="font-semibold">{title}</div>
        {data?.order_number && <Badge variant="outline">{data.order_number}</Badge>}
      </div>
      <div className="grid gap-2 text-sm text-muted-foreground md:grid-cols-2">
        <div>العميل: <span className="text-foreground font-medium">{data?.customer_name || "—"}</span></div>
        <div>الهاتف: <span className="text-foreground font-medium">{data?.customer_phone || "—"}</span></div>
        <div>المودريتور: <span className="text-foreground font-medium">{data?.moderator_name || "—"}</span></div>
        <div>الوقت: <span className="text-foreground font-medium">{fmt(data?.created_at)}</span></div>
        <div>الحالة: <span className="text-foreground font-medium">{data?.status || "—"}</span></div>
        <div>التسليم: <span className="text-foreground font-medium">{data?.shipping_company || data?.fulfillment_type || "—"}</span></div>
        <div className="md:col-span-2">العنوان: <span className="text-foreground font-medium">{data?.delivery_address || "—"}</span></div>
        <div className="md:col-span-2">المنتجات: <span className="text-foreground font-medium">{data?.products_summary || "—"}</span></div>
      </div>
    </div>
  );

  const renderApprovalRow = (row: ApprovalRow) => (
    <div key={row.id} className="border rounded-lg p-4 bg-card space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <div className="font-semibold">{row.customer_name || row.proposed_order?.customer_name || "—"}</div>
          <div className="text-sm text-muted-foreground">
            المودريتور الأولى: <span className="text-foreground font-medium">{row.matched_order?.moderator_name || "—"}</span>
            {" • "}
            المودريتور الثانية: <span className="text-foreground font-medium">{row.requester_name || "—"}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={statusVariant(row.status)}>{statusLabel(row.status)}</Badge>
          {row.duplicate_score != null && <Badge variant="outline">تشابه {Number(row.duplicate_score).toFixed(0)}%</Badge>}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {renderOrderCard("الطلب الجديد المقترح", {
          customer_name: row.proposed_order?.customer_name || row.customer_name,
          customer_phone: row.proposed_order?.customer_phone || row.customer_phone,
          delivery_address: row.proposed_order?.delivery_address,
          shipping_company: row.proposed_order?.shipping_company,
          fulfillment_type: row.proposed_order?.fulfillment_type,
          products_summary: summarizeItems(row.proposed_items),
          moderator_name: row.requester_name,
          created_at: row.created_at,
          status: row.status,
        })}
        {renderOrderCard("الطلب المشابه الموجود", row.matched_order)}
      </div>

      {row.note && <div className="text-sm">ملاحظة المودريتور: <span className="text-muted-foreground">{row.note}</span></div>}
      {row.reason && <div className="text-sm">سبب القرار: <span className="text-muted-foreground">{row.reason}</span></div>}
      <div className="text-xs text-muted-foreground">
        وقت الطلب: {fmt(row.created_at)}
        {row.decided_at && <> • وقت القرار: {fmt(row.decided_at)}</>}
        {row.decider_name && <> • بواسطة: {row.decider_name}</>}
      </div>

      {row.status === "pending" && new Date(row.expires_at) > new Date() && (
        <div className="flex gap-2 pt-1">
          <Button size="sm" onClick={() => setDecision({ open: true, row, approve: true, reason: "" })}>
            <CheckCircle2 className="w-4 h-4 ms-1" /> موافقة
          </Button>
          <Button size="sm" variant="destructive" onClick={() => setDecision({ open: true, row, approve: false, reason: "" })}>
            <XCircle className="w-4 h-4 ms-1" /> رفض
          </Button>
        </div>
      )}
    </div>
  );

  const renderAuditRow = (row: AuditRow) => (
    <div key={row.id} className="rounded-lg border p-4 space-y-2 bg-card">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="font-semibold">{row.customer_name || row.proposed_order?.customer_name || "—"}</div>
        <Badge variant={statusVariant(row.status)}>{statusLabel(row.status)}</Badge>
      </div>
      <div className="grid gap-2 text-sm text-muted-foreground md:grid-cols-2">
        <div>المودريتور: <span className="text-foreground font-medium">{row.attempted_by_name || "—"}</span></div>
        <div>الهاتف: <span className="text-foreground font-medium">{row.customer_phone || row.proposed_order?.customer_phone || "—"}</span></div>
        <div>وقت المحاولة: <span className="text-foreground font-medium">{fmt(row.created_at)}</span></div>
        <div>نسبة التشابه: <span className="text-foreground font-medium">{row.similarity_score != null ? `${Number(row.similarity_score).toFixed(0)}%` : "—"}</span></div>
        <div className="md:col-span-2">الطلب المشابه: <span className="text-foreground font-medium">{row.matched_order_snapshot?.order_number || row.matched_order_snapshot?.matched_order_id || "—"}</span></div>
        <div className="md:col-span-2">المنتجات المقترحة: <span className="text-foreground font-medium">{summarizeItems(row.proposed_items) || "—"}</span></div>
      </div>
      {row.decision_reason && <div className="text-sm text-muted-foreground">سبب القرار: {row.decision_reason}</div>}
      {(row.decision_by_name || row.decided_at) && (
        <div className="text-xs text-muted-foreground">
          القرار بواسطة: {row.decision_by_name || "—"} • {fmt(row.decided_at)}
        </div>
      )}
    </div>
  );

  const renderReportRow = (row: PotentialDuplicateRow, index: number) => (
    <div key={`${row.order_a_id}-${row.order_b_id}-${index}`} className="rounded-lg border p-4 space-y-3 bg-card">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="font-semibold">{row.shared_phone}</div>
        <Badge variant="outline">تشابه {Number(row.similarity_score).toFixed(0)}%</Badge>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {renderOrderCard("الطلب الأول", {
          customer_name: row.order_a_customer_name,
          moderator_name: row.moderator_a,
          created_at: row.order_a_created_at,
          order_number: row.order_a_number,
          status: row.status_a,
          products_summary: row.products_a,
          customer_phone: row.shared_phone,
        })}
        {renderOrderCard("الطلب الثاني", {
          customer_name: row.order_b_customer_name,
          moderator_name: row.moderator_b,
          created_at: row.order_b_created_at,
          order_number: row.order_b_number,
          status: row.status_b,
          products_summary: row.products_b,
          customer_phone: row.shared_phone,
        })}
      </div>
      <div className="flex gap-2 flex-wrap text-xs text-muted-foreground">
        <Badge variant={row.same_items ? "default" : "outline"}>نفس المنتجات</Badge>
        <Badge variant={row.same_address ? "default" : "outline"}>نفس العنوان</Badge>
        <Badge variant={row.same_shipping ? "default" : "outline"}>نفس طريقة التسليم</Badge>
      </div>
    </div>
  );

  return (
    <DashboardLayout>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <Header title="طلبات مكررة بانتظار الموافقة" subtitle="مراجعة الطلب الجديد المقترح مقابل الطلب المشابه، مع سجل المحاولات وتقرير الطلبات المحتمل تكرارها" />
        <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldAlert className="w-5 h-5 text-primary" /> إدارة الطلبات المكررة</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="pending">
            <TabsList className="grid w-full grid-cols-2 md:grid-cols-4 gap-2 h-auto">
              <TabsTrigger value="pending">قيد الانتظار <Badge variant="outline" className="ms-2">{pending.length}</Badge></TabsTrigger>
              <TabsTrigger value="decided">تم البت <Badge variant="outline" className="ms-2">{decided.length}</Badge></TabsTrigger>
              <TabsTrigger value="audit">سجل المحاولات <Badge variant="outline" className="ms-2">{auditRows.length}</Badge></TabsTrigger>
              <TabsTrigger value="report">تقرير محتمل التكرار <Badge variant="outline" className="ms-2">{reportRows.length}</Badge></TabsTrigger>
            </TabsList>

            <TabsContent value="pending" className="space-y-3 mt-4">
              {pending.length === 0 && <p className="text-sm text-muted-foreground py-6 text-center">لا توجد طلبات معلّقة</p>}
              {pending.map(renderApprovalRow)}
            </TabsContent>

            <TabsContent value="decided" className="space-y-3 mt-4">
              {decided.length === 0 && <p className="text-sm text-muted-foreground py-6 text-center">لا يوجد سجل</p>}
              {decided.map(renderApprovalRow)}
            </TabsContent>

            <TabsContent value="audit" className="space-y-3 mt-4">
              {auditRows.length === 0 && <p className="text-sm text-muted-foreground py-6 text-center">لا توجد محاولات مسجلة بعد</p>}
              {auditRows.map(renderAuditRow)}
            </TabsContent>

            <TabsContent value="report" className="space-y-3 mt-4">
              <div className="rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground flex gap-2 items-start">
                <ClipboardList className="w-4 h-4 mt-0.5" />
                هذا التقرير للمراجعة اليدوية فقط. لا يتم حذف أو تعديل أي طلب حالي تلقائيًا.
              </div>
              {reportRows.length === 0 && <p className="text-sm text-muted-foreground py-6 text-center">لا توجد حالات مشتبه بها حاليًا</p>}
              {reportRows.map(renderReportRow)}
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
                ? "عند الموافقة سيتم السماح بتسجيل الطلب المكرر مع حفظ بيانات القرار في السجل."
                : "لن يتم حفظ الطلب المكرر، ويمكنك كتابة سبب الرفض لإظهاره للمودريتور."}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder={decision.approve ? "سبب أو ملاحظة الموافقة" : "سبب الرفض"}
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
