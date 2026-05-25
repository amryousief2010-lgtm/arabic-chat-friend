import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Loader2, CheckCircle2, AlertTriangle, ShieldAlert, ShieldQuestion } from "lucide-react";

const TYPE_LABEL: Record<string, string> = {
  negative_stock: "رصيد سالب",
  missing_barcode: "باركود مفقود",
  duplicate_item: "صنف مكرر",
  price_anomaly: "سعر غير اعتيادي",
  recipe_missing: "وصفة مفقودة",
  cost_review: "مراجعة تكلفة",
  other: "أخرى",
};
const MOD_LABEL: Record<string, string> = { meat: "اللحوم", feed: "الأعلاف", shared: "مشترك", warehouse: "المخازن" };
const SEV_VAR: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  low: "outline", medium: "secondary", high: "default", critical: "destructive",
};

export default function DataQualityTasks() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("open");
  const [moduleFilter, setModuleFilter] = useState("all");
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    let q = supabase.from("data_quality_tasks").select("*").order("created_at", { ascending: false });
    if (statusFilter !== "all") q = q.eq("status", statusFilter);
    if (moduleFilter !== "all") q = q.eq("module", moduleFilter);
    const { data, error } = await q.limit(200);
    if (error) toast.error(error.message); else setTasks(data ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [statusFilter, moduleFilter]);

  const resolve = async (id: string, status: "resolved" | "dismissed") => {
    const { data: user } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("data_quality_tasks")
      .update({
        status,
        resolved_by: user.user?.id,
        resolved_at: new Date().toISOString(),
        resolution_notes: notes[id] || null,
      })
      .eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("تم تحديث المهمة"); load(); }
  };

  return (
    <DashboardLayout>
      <div className="space-y-4 p-4">
        <div>
          <h1 className="text-2xl font-bold">مهام جودة البيانات</h1>
          <p className="text-muted-foreground text-sm">
            الأرصدة السالبة، الباركود المفقود، تعارض البيانات، وتسويات المخزون.
          </p>
        </div>

        <div className="flex gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الحالات</SelectItem>
              <SelectItem value="open">مفتوحة</SelectItem>
              <SelectItem value="in_progress">قيد العمل</SelectItem>
              <SelectItem value="resolved">محلولة</SelectItem>
              <SelectItem value="dismissed">مرفوضة</SelectItem>
            </SelectContent>
          </Select>
          <Select value={moduleFilter} onValueChange={setModuleFilter}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الأقسام</SelectItem>
              <SelectItem value="meat">اللحوم</SelectItem>
              <SelectItem value="feed">الأعلاف</SelectItem>
              <SelectItem value="warehouse">المخازن</SelectItem>
              <SelectItem value="shared">مشترك</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : tasks.length === 0 ? (
          <Card><CardContent className="py-10 text-center text-muted-foreground">
            <CheckCircle2 className="w-10 h-10 mx-auto mb-2 text-green-500" />
            لا توجد مهام بهذه الفلاتر.
          </CardContent></Card>
        ) : (
          <div className="grid gap-3">
            {tasks.map((t) => (
              <Card key={t.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      {t.severity === "critical" ? <ShieldAlert className="w-4 h-4 text-destructive" /> : <ShieldQuestion className="w-4 h-4" />}
                      {t.title}
                    </CardTitle>
                    <div className="flex gap-1">
                      <Badge variant="outline">{MOD_LABEL[t.module]}</Badge>
                      <Badge variant={SEV_VAR[t.severity]}>{t.severity}</Badge>
                      <Badge variant="secondary">{TYPE_LABEL[t.task_type]}</Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {t.description && <p>{t.description}</p>}
                  {t.suggested_action && (
                    <div className="rounded bg-muted/40 p-2 text-xs">
                      <strong>الإجراء المقترح: </strong>{t.suggested_action}
                    </div>
                  )}
                  {t.status === "open" || t.status === "in_progress" ? (
                    <div className="space-y-2">
                      <Textarea placeholder="ملاحظات الحل (اختياري)" value={notes[t.id] ?? ""}
                        onChange={(e) => setNotes({ ...notes, [t.id]: e.target.value })} />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => resolve(t.id, "resolved")}>
                          <CheckCircle2 className="w-4 h-4 ml-1" /> حل
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => resolve(t.id, "dismissed")}>
                          <AlertTriangle className="w-4 h-4 ml-1" /> رفض
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">
                      {t.status === "resolved" ? "✅ تم الحل" : "❌ مرفوضة"}
                      {t.resolution_notes && ` — ${t.resolution_notes}`}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
