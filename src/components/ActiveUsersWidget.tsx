import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Users, Circle } from "lucide-react";
import { formatDateTime } from "@/lib/dateFormat";

type PresenceRow = {
  user_id: string;
  user_name: string | null;
  role: string | null;
  status: string;
  last_seen_at: string;
  current_page: string | null;
  session_started_at: string;
  user_agent: string | null;
};

const roleLabel: Record<string, string> = {
  general_manager: "المدير العام",
  executive_manager: "المدير التنفيذي",
  sales_manager: "مدير المبيعات",
  sales_moderator: "موديراتور مبيعات",
  accountant: "محاسب",
  warehouse_supervisor: "مشرف مخازن",
  farm_manager: "مدير المزرعة",
  hatchery_manager: "مدير المعمل",
  brooding_manager: "مدير التحضين",
  slaughterhouse_manager: "مدير المجزر",
  meat_factory_manager: "مدير مصنع اللحوم",
  feed_factory_manager: "مدير مصنع العلف",
  hr_manager: "مدير الموارد البشرية",
  production_manager: "مدير الإنتاج",
  marketing_sales_manager: "مدير التسويق والمبيعات",
  financial_manager: "المدير المالي",
  quality_manager: "مدير الجودة",
};

const AWAY_MS = 5 * 60 * 1000;
const OFFLINE_MS = 15 * 60 * 1000;

function deriveStatus(row: PresenceRow): "online" | "away" | "offline" {
  const age = Date.now() - new Date(row.last_seen_at).getTime();
  if (age > OFFLINE_MS) return "offline";
  if (age > AWAY_MS || row.status === "away") return "away";
  return "online";
}

const statusInfo = {
  online: { label: "متصل الآن", color: "bg-emerald-500", text: "text-emerald-600" },
  away: { label: "غير نشط", color: "bg-amber-500", text: "text-amber-600" },
  offline: { label: "غير متصل", color: "bg-gray-400", text: "text-gray-500" },
};

function shortBrowser(ua: string | null) {
  if (!ua) return "-";
  if (/edg/i.test(ua)) return "Edge";
  if (/chrome/i.test(ua)) return "Chrome";
  if (/safari/i.test(ua)) return "Safari";
  if (/firefox/i.test(ua)) return "Firefox";
  return "متصفح";
}

export default function ActiveUsersWidget() {
  const { isGeneralManager, isExecutiveManager } = useAuth();
  const canView = isGeneralManager || isExecutiveManager;
  const [rows, setRows] = useState<PresenceRow[]>([]);
  const [open, setOpen] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;

    const fetchRows = async () => {
      const { data } = await supabase
        .from("user_presence")
        .select("*")
        .order("last_seen_at", { ascending: false });
      if (!cancelled && data) setRows(data as PresenceRow[]);
    };

    fetchRows();
    const refetch = setInterval(fetchRows, 30 * 1000);
    // Recompute derived statuses every 30s
    const recompute = setInterval(() => setTick((n) => n + 1), 30 * 1000);

    return () => {
      cancelled = true;
      clearInterval(refetch);
      clearInterval(recompute);
    };
  }, [canView]);

  if (!canView) return null;

  const enriched = rows.map((r) => ({ ...r, _status: deriveStatus(r) }));
  const onlineCount = enriched.filter((r) => r._status === "online").length;
  const awayCount = enriched.filter((r) => r._status === "away").length;
  const offlineCount = enriched.filter((r) => r._status === "offline").length;
  const lastActivity = enriched[0]?.last_seen_at;

  return (
    <>
      <Card
        className="cursor-pointer hover:shadow-md transition-shadow"
        onClick={() => setOpen(true)}
      >
        <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" />
            الموظفون النشطون الآن
          </CardTitle>
          <Badge variant="secondary" className="text-xs">{enriched.length}</Badge>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="flex items-center justify-center gap-1 text-emerald-600 font-bold text-lg">
                <Circle className="w-2.5 h-2.5 fill-emerald-500 text-emerald-500" />
                {onlineCount}
              </div>
              <div className="text-[11px] text-muted-foreground">متصل</div>
            </div>
            <div>
              <div className="flex items-center justify-center gap-1 text-amber-600 font-bold text-lg">
                <Circle className="w-2.5 h-2.5 fill-amber-500 text-amber-500" />
                {awayCount}
              </div>
              <div className="text-[11px] text-muted-foreground">غير نشط</div>
            </div>
            <div>
              <div className="flex items-center justify-center gap-1 text-gray-500 font-bold text-lg">
                <Circle className="w-2.5 h-2.5 fill-gray-400 text-gray-400" />
                {offlineCount}
              </div>
              <div className="text-[11px] text-muted-foreground">غير متصل</div>
            </div>
          </div>
          {lastActivity && (
            <div className="text-[11px] text-muted-foreground mt-2 text-center">
              آخر نشاط: {formatDateTime(lastActivity)}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" /> تواجد الموظفين على النظام
            </DialogTitle>
          </DialogHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">الموظف</TableHead>
                <TableHead className="text-right">الدور</TableHead>
                <TableHead className="text-right">الحالة</TableHead>
                <TableHead className="text-right">آخر صفحة</TableHead>
                <TableHead className="text-right">آخر ظهور</TableHead>
                <TableHead className="text-right">بداية الجلسة</TableHead>
                <TableHead className="text-right">المتصفح</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {enriched.map((r) => {
                const info = statusInfo[r._status];
                return (
                  <TableRow key={r.user_id}>
                    <TableCell className="font-medium">{r.user_name || "-"}</TableCell>
                    <TableCell>{roleLabel[r.role || ""] || r.role || "-"}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center gap-1.5 ${info.text}`}>
                        <span className={`w-2 h-2 rounded-full ${info.color}`} />
                        {info.label}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground" dir="ltr">{r.current_page || "-"}</TableCell>
                    <TableCell className="text-xs">{formatDateTime(r.last_seen_at)}</TableCell>
                    <TableCell className="text-xs">{formatDateTime(r.session_started_at)}</TableCell>
                    <TableCell className="text-xs">{shortBrowser(r.user_agent)}</TableCell>
                  </TableRow>
                );
              })}
              {enriched.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-6">
                    لا يوجد بيانات تواجد بعد.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </DialogContent>
      </Dialog>
    </>
  );
}
