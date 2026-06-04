import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CheckCircle2, XCircle, Eye, Clock, Paperclip, Download, ExternalLink } from "lucide-react";
import { format } from "date-fns";
import { useNavigate } from "react-router-dom";

/** Map a correction request's target_module/target_type to an in-app route */
function resolveTargetRoute(module: string, type?: string): string | null {
  const m = (module || "").toLowerCase();
  const t = (type || "").toLowerCase();
  if (t.includes("slaughter") || m.includes("مجزر") || m.includes("ذبح")) return "/modules/slaughterhouse";
  if (t.includes("hatchery") || m.includes("فقاسة") || m.includes("تفقيس")) return "/modules/hatchery";
  if (t.includes("farm") || m.includes("مزرعة") || m.includes("مزارع")) return "/modules/farm";
  if (t.includes("brooding") || m.includes("حضان")) return "/modules/brooding";
  if (t.includes("feed") || m.includes("علف") || m.includes("أعلاف")) return "/modules/feed-factory";
  if (t.includes("meat") || m.includes("مصنع لحوم") || m.includes("لحوم")) return "/modules/meat-factory";
  if (t.includes("warehouse") || m.includes("مخزن") || m.includes("مخازن")) return "/modules/warehouses";
  if (t.includes("order") || m.includes("طلب") || m.includes("طلبات")) return "/orders";
  if (t.includes("customer") || m.includes("عميل") || m.includes("عملاء")) return "/customers";
  if (t.includes("product") || m.includes("منتج") || m.includes("أصناف")) return "/products";
  return null;
}

interface CorrectionRequest {
  id: string;
  target_module: string;
  target_type: string;
  target_reference: string | null;
  note: string;
  priority: "low" | "normal" | "high" | "urgent";
  status: "pending" | "in_review" | "resolved" | "rejected";
  requested_by: string;
  reviewed_by: string | null;
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
  attachment_url: string | null;
  attachment_name: string | null;
  attachment_type: string | null;
  requester_name?: string;
  reviewer_name?: string;
}

const priorityBadge: Record<CorrectionRequest["priority"], { label: string; cls: string }> = {
  low: { label: "منخفضة", cls: "bg-muted text-muted-foreground" },
  normal: { label: "عادية", cls: "bg-blue-500/15 text-blue-700 dark:text-blue-300" },
  high: { label: "مرتفعة", cls: "bg-orange-500/15 text-orange-700 dark:text-orange-300" },
  urgent: { label: "عاجل", cls: "bg-red-500/15 text-red-700 dark:text-red-300" },
};

const statusBadge: Record<CorrectionRequest["status"], { label: string; cls: string }> = {
  pending: { label: "قيد الانتظار", cls: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-300" },
  in_review: { label: "قيد المراجعة", cls: "bg-blue-500/15 text-blue-700 dark:text-blue-300" },
  resolved: { label: "تم التنفيذ", cls: "bg-green-500/15 text-green-700 dark:text-green-300" },
  rejected: { label: "مرفوض", cls: "bg-red-500/15 text-red-700 dark:text-red-300" },
};

export default function CorrectionRequests() {
  const { isGeneralManager, isExecutiveManager, user } = useAuth();
  const navigate = useNavigate();
  const canReview = isGeneralManager || isExecutiveManager;
  const [items, setItems] = useState<CorrectionRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<CorrectionRequest | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [decisionLoading, setDecisionLoading] = useState(false);
  const [tab, setTab] = useState<"pending" | "all">("pending");

  const fetchItems = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("correction_requests")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) {
      toast.error("تعذّر تحميل الطلبات", { description: error.message });
      setLoading(false);
      return;
    }
    const rows = (data ?? []) as CorrectionRequest[];
    const ids = Array.from(
      new Set([
        ...rows.map((r) => r.requested_by),
        ...rows.map((r) => r.reviewed_by).filter(Boolean) as string[],
      ])
    );
    if (ids.length > 0) {
      const { data: profiles } = await supabase
        .from("profile_directory")
        .select("id, full_name")
        .in("id", ids);
      const map = new Map((profiles ?? []).map((p) => [p.id, p.full_name || p.id]));
      rows.forEach((r) => {
        r.requester_name = map.get(r.requested_by) ?? "موظف";
        if (r.reviewed_by) r.reviewer_name = map.get(r.reviewed_by) ?? "—";
      });
    }
    setItems(rows);
    setLoading(false);
  };

  useEffect(() => {
    fetchItems();
    if (!canReview) return;
    const ch = supabase
      .channel("correction-requests")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "correction_requests" },
        () => fetchItems()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canReview]);

  const decide = async (status: "resolved" | "rejected") => {
    if (!selected) return;
    if (!reviewNote.trim()) {
      toast.error("اكتب ملاحظة الرد قبل الإرسال");
      return;
    }
    setDecisionLoading(true);
    const { error } = await supabase
      .from("correction_requests")
      .update({
        status,
        review_note: reviewNote.trim(),
        reviewed_by: user?.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", selected.id);
    setDecisionLoading(false);
    if (error) {
      toast.error("تعذّر حفظ الرد", { description: error.message });
      return;
    }
    toast.success(status === "resolved" ? "✅ تم تأكيد التصحيح" : "❌ تم رفض الطلب");
    setSelected(null);
    setReviewNote("");
  };

  const openAttachment = async (path: string) => {
    const { data, error } = await supabase.storage
      .from("correction-attachments")
      .createSignedUrl(path, 300);
    if (error || !data?.signedUrl) {
      toast.error("تعذّر فتح المرفق", { description: error?.message });
      return;
    }
    window.open(data.signedUrl, "_blank");
  };

  const filtered = items.filter((r) => (tab === "pending" ? r.status === "pending" || r.status === "in_review" : true));

  return (
    <DashboardLayout>
      <Header
        title="طلبات التصحيح"
        subtitle={canReview ? "مراجعة الطلبات الواردة من الموظفين والرد عليها" : "تتبع طلباتك المرسلة للإدارة"}
      />

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>السجل</span>
            <Badge variant="secondary">{items.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
            <TabsList>
              <TabsTrigger value="pending">قيد المعالجة</TabsTrigger>
              <TabsTrigger value="all">الكل</TabsTrigger>
            </TabsList>
            <TabsContent value={tab} className="mt-4 space-y-3">
              {loading && <p className="text-sm text-muted-foreground">جارٍ التحميل...</p>}
              {!loading && filtered.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">لا توجد طلبات</p>
              )}
              {filtered.map((r) => (
                <Card key={r.id} className="border-r-4" style={{
                  borderRightColor:
                    r.priority === "urgent" ? "hsl(0 84% 60%)" :
                    r.priority === "high" ? "hsl(25 95% 53%)" :
                    r.priority === "low" ? "hsl(var(--muted))" : "hsl(217 91% 60%)"
                }}>
                  <CardContent className="p-4 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge className={priorityBadge[r.priority].cls}>
                          {priorityBadge[r.priority].label}
                        </Badge>
                        <Badge className={statusBadge[r.status].cls}>
                          {statusBadge[r.status].label}
                        </Badge>
                        <span className="text-sm font-medium">{r.target_module}</span>
                        {r.target_reference && (
                          <span className="text-xs text-muted-foreground">
                            • {r.target_reference}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="w-3 h-3" />
                        {format(new Date(r.created_at), "yyyy-MM-dd HH:mm")}
                      </div>
                    </div>

                    <p className="text-sm">{r.note}</p>

                    {r.attachment_url && (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="gap-1"
                        onClick={() => openAttachment(r.attachment_url!)}
                      >
                        <Paperclip className="w-3 h-3" />
                        {r.attachment_name || "عرض المرفق"}
                      </Button>
                    )}

                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <p className="text-xs text-muted-foreground">
                        مُرسِل الطلب: <span className="font-medium">{r.requester_name}</span>
                      </p>
                      <div className="flex items-center gap-2 flex-wrap">
                        {(() => {
                          const route = resolveTargetRoute(r.target_module, r.target_type);
                          if (!route) return null;
                          const qs = r.target_reference ? `?ref=${encodeURIComponent(r.target_reference)}` : "";
                          return (
                            <Button size="sm" variant="secondary" onClick={() => navigate(`${route}${qs}`)}>
                              <ExternalLink className="w-4 h-4 ml-1" />
                              فتح السجل المعني
                            </Button>
                          );
                        })()}
                        {canReview && (r.status === "pending" || r.status === "in_review") && (
                          <Button size="sm" variant="default" onClick={() => { setSelected(r); setReviewNote(""); }}>
                            <Eye className="w-4 h-4 ml-1" />
                            مراجعة والرد
                          </Button>
                        )}
                      </div>
                    </div>

                    {r.review_note && (
                      <div className="mt-2 p-2 rounded-md bg-muted/50 text-sm">
                        <p className="font-medium text-xs mb-1">
                          رد الإدارة ({r.reviewer_name ?? "—"}):
                        </p>
                        <p>{r.review_note}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent dir="rtl" className="max-w-lg">
          <DialogHeader>
            <DialogTitle>مراجعة طلب التصحيح</DialogTitle>
            <DialogDescription>
              اكتب ملاحظة موجزة توضح الإجراء المتخذ ثم اعتمد أو ارفض الطلب.
            </DialogDescription>
          </DialogHeader>
          {selected && (
            <div className="space-y-3 py-2">
              <div className="p-3 rounded-md bg-muted/40 text-sm space-y-1">
                <p><strong>القسم:</strong> {selected.target_module}</p>
                {selected.target_reference && <p><strong>المرجع:</strong> {selected.target_reference}</p>}
                <p><strong>الموظف:</strong> {selected.requester_name}</p>
                <p><strong>الملاحظة:</strong> {selected.note}</p>
                {selected.attachment_url && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1 mt-2"
                    onClick={() => openAttachment(selected.attachment_url!)}
                  >
                    <Download className="w-3 h-3" />
                    تنزيل / عرض المرفق ({selected.attachment_name})
                  </Button>
                )}
              </div>
              <Textarea
                placeholder="رد الإدارة / الإجراء المتخذ..."
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                rows={4}
              />
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="destructive" onClick={() => decide("rejected")} disabled={decisionLoading}>
              <XCircle className="w-4 h-4 ml-1" /> رفض
            </Button>
            <Button onClick={() => decide("resolved")} disabled={decisionLoading}>
              <CheckCircle2 className="w-4 h-4 ml-1" /> تأكيد التصحيح
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
