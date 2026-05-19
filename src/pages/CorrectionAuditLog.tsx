import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { Activity, User, Clock, Filter } from "lucide-react";

interface AuditRow {
  id: string;
  request_id: string;
  action: string;
  actor_id: string | null;
  old_status: string | null;
  new_status: string | null;
  note: string | null;
  created_at: string;
  actor_name?: string;
  request_module?: string;
  request_reference?: string | null;
  request_priority?: string;
  requester_name?: string;
}

const statusLabel = (s: string | null) => {
  switch (s) {
    case "pending": return "قيد الانتظار";
    case "in_review": return "قيد المراجعة";
    case "resolved": return "تم التنفيذ";
    case "rejected": return "مرفوض";
    default: return s ?? "—";
  }
};

const actionMeta = (a: string) => {
  switch (a) {
    case "created": return { label: "إنشاء طلب", cls: "bg-blue-500/15 text-blue-700 dark:text-blue-300" };
    case "status_change": return { label: "تغيير حالة", cls: "bg-purple-500/15 text-purple-700 dark:text-purple-300" };
    default: return { label: a, cls: "bg-muted text-muted-foreground" };
  }
};

export default function CorrectionAuditLog() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterAction, setFilterAction] = useState<string>("all");

  const fetchData = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("correction_request_audit")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1000);
    if (error) {
      toast.error("تعذّر تحميل السجل", { description: error.message });
      setLoading(false);
      return;
    }
    const audit = (data ?? []) as AuditRow[];

    const reqIds = Array.from(new Set(audit.map((a) => a.request_id)));
    const actorIds = Array.from(new Set(audit.map((a) => a.actor_id).filter(Boolean) as string[]));

    const [{ data: requests }, { data: profiles }] = await Promise.all([
      reqIds.length
        ? supabase.from("correction_requests").select("id, target_module, target_reference, priority, requested_by").in("id", reqIds)
        : Promise.resolve({ data: [] }),
      actorIds.length
        ? supabase.from("profiles").select("id, full_name, email").in("id", actorIds)
        : Promise.resolve({ data: [] }),
    ]);

    const reqMap = new Map((requests ?? []).map((r: any) => [r.id, r]));
    const requesterIds = Array.from(new Set(
      (requests ?? []).map((r: any) => r.requested_by).filter(Boolean)
    )) as string[];
    const { data: requesters } = requesterIds.length
      ? await supabase.from("profiles").select("id, full_name, email").in("id", requesterIds)
      : { data: [] };

    const nameMap = new Map<string, string>();
    (profiles ?? []).forEach((p: any) => nameMap.set(p.id, p.full_name || p.email));
    (requesters ?? []).forEach((p: any) => nameMap.set(p.id, p.full_name || p.email));

    audit.forEach((a) => {
      const r: any = reqMap.get(a.request_id);
      a.actor_name = a.actor_id ? nameMap.get(a.actor_id) ?? "—" : "—";
      a.request_module = r?.target_module ?? "—";
      a.request_reference = r?.target_reference ?? null;
      a.request_priority = r?.priority;
      a.requester_name = r?.requested_by ? nameMap.get(r.requested_by) : undefined;
    });

    setRows(audit);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
    const ch = supabase
      .channel("correction-audit")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "correction_request_audit" }, () => fetchData())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = rows.filter((r) => {
    if (filterAction !== "all" && r.action !== filterAction) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const hay = `${r.request_module} ${r.request_reference ?? ""} ${r.actor_name ?? ""} ${r.requester_name ?? ""} ${r.note ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  return (
    <DashboardLayout>
      <Header
        title="سجل تدقيق طلبات التصحيح"
        subtitle="تاريخ كامل لكل طلب — من أنشأه ومن وافق أو رفض، مع الوقت والملاحظة"
      />

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="w-5 h-5" />
            <span>الأحداث</span>
            <Badge variant="secondary" className="mr-auto">{filtered.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <div className="relative flex-1 min-w-[200px]">
              <Input
                placeholder="بحث بالقسم/المرجع/الموظف/الملاحظة..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-muted-foreground" />
              <Select value={filterAction} onValueChange={setFilterAction}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الأحداث</SelectItem>
                  <SelectItem value="created">إنشاء طلب</SelectItem>
                  <SelectItem value="status_change">تغيير حالة</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {loading && <p className="text-sm text-muted-foreground">جارٍ التحميل...</p>}
          {!loading && filtered.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">لا توجد أحداث مطابقة</p>
          )}

          <div className="relative">
            <div className="absolute right-[14px] top-2 bottom-2 w-px bg-border" />
            <div className="space-y-3">
              {filtered.map((r) => {
                const meta = actionMeta(r.action);
                return (
                  <div key={r.id} className="relative pr-10">
                    <div className="absolute right-2 top-3 w-6 h-6 rounded-full bg-primary/15 border-2 border-primary flex items-center justify-center">
                      <Activity className="w-3 h-3 text-primary" />
                    </div>
                    <Card>
                      <CardContent className="p-3 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge className={meta.cls}>{meta.label}</Badge>
                          {r.action === "status_change" && (
                            <span className="text-xs text-muted-foreground">
                              {statusLabel(r.old_status)} ← <strong>{statusLabel(r.new_status)}</strong>
                            </span>
                          )}
                          <span className="text-sm font-medium">{r.request_module}</span>
                          {r.request_reference && (
                            <span className="text-xs text-muted-foreground">• {r.request_reference}</span>
                          )}
                          <div className="flex items-center gap-1 text-xs text-muted-foreground mr-auto">
                            <Clock className="w-3 h-3" />
                            {format(new Date(r.created_at), "yyyy-MM-dd HH:mm:ss")}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <User className="w-3 h-3" />
                            بواسطة: <strong className="text-foreground">{r.actor_name}</strong>
                          </span>
                          {r.requester_name && r.requester_name !== r.actor_name && (
                            <span>صاحب الطلب: <strong className="text-foreground">{r.requester_name}</strong></span>
                          )}
                        </div>

                        {r.note && (
                          <p className="text-sm bg-muted/40 rounded-md p-2">{r.note}</p>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>
    </DashboardLayout>
  );
}
