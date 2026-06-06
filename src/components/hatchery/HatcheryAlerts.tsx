import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, Calendar } from "lucide-react";

interface HatcheryAlertsProps {
  settings?: any;
  onNavigate: (tabName: string, filter?: string) => void;
}

export default function HatcheryAlerts({ settings, onNavigate }: HatcheryAlertsProps) {
  const { data: dbBatches = [] } = useQuery<any[]>({
    queryKey: ["hatch_batches_lab"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hatch_batches")
        .select("*, hatch_customers(id,name,customer_type)")
        .order("receive_date", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data as any) || [];
    },
  });

  const { counts, todayOps } = useMemo(() => {
    const c1 = settings?.candling_day || 15;
    const h = settings?.transfer_to_hatcher_day || 39;
    const c2 = Math.max(c1 + 10, 25);
    const t = new Date().toISOString().slice(0, 10);
    const d3 = new Date();
    d3.setDate(d3.getDate() + 3);
    const d3s = d3.toISOString().slice(0, 10);

    const addD = (d: string, n: number) => {
      const dt = new Date(d);
      dt.setDate(dt.getDate() + n);
      return dt.toISOString().slice(0, 10);
    };

    let c2Today = 0, c2_3d = 0, exitToday = 0, exit3d = 0, overdue = 0;
    const ops: any[] = [];

    dbBatches.forEach((b: any) => {
      if (b.status === "completed" || b.exit_date) return;
      const entry = b.entry_date || b.receive_date;
      if (!entry) return;

      const expC2 = b.candle2_date || addD(entry, c2);
      const expEx = b.exit_date || addD(entry, h);
      const cName = b.hatch_customers?.name || "—";

      let stageLabel = "داخل الماكينة";
      if (!b.entry_date) stageLabel = "بانتظار الدخول";
      else if (b.candle2_date) stageLabel = "بعد الكشف الثاني";
      else if (b.candle1_date) stageLabel = "بعد الكشف الأول";

      let action = "";
      let targetDate = "";
      let isUrgent = false;

      if (expC2 === t) {
        c2Today++;
        action = "كشف ثاني";
        targetDate = expC2;
        isUrgent = true;
      } else if (!b.candle2_date && expC2 > t && expC2 <= d3s) {
        c2_3d++;
        if (!action) { action = "كشف ثاني"; targetDate = expC2; }
      }

      if (expEx === t) {
        exitToday++;
        action = "خروج";
        targetDate = expEx;
        isUrgent = true;
      } else if (!b.exit_date && expEx > t && expEx <= d3s) {
        exit3d++;
        if (!action) { action = "خروج"; targetDate = expEx; }
      }

      let isOverdue = false;
      if (!b.candle1_date && t > addD(entry, c1)) {
        isOverdue = true;
        action = "متابعة تأخير";
        targetDate = addD(entry, c1);
      } else if (!b.candle2_date && t > expC2) {
        isOverdue = true;
        action = "متابعة تأخير";
        targetDate = expC2;
      } else if (b.candle2_date && !b.exit_date && t > expEx) {
        isOverdue = true;
        action = "متابعة تأخير";
        targetDate = expEx;
      }

      if (isOverdue) overdue++;

      if (action) {
        ops.push({
          id: b.id,
          batch_number: b.batch_number,
          customer: cName,
          machine: b.machine || "—",
          stage: stageLabel,
          action,
          targetDate,
          isUrgent: isUrgent || isOverdue,
        });
      }
    });

    return { counts: { c2Today, c2_3d, exitToday, exit3d, overdue }, todayOps: ops };
  }, [dbBatches, settings]);

  const alertCards = [
    { label: "دفعات موعد كشفها الثاني اليوم", count: counts.c2Today, filter: "candle2_today", color: "bg-blue-600" },
    { label: "دفعات موعد كشفها الثاني خلال 3 أيام", count: counts.c2_3d, filter: "candle2_3d", color: "bg-blue-500" },
    { label: "دفعات موعد خروجها اليوم", count: counts.exitToday, filter: "exit_today", color: "bg-emerald-600" },
    { label: "دفعات موعد خروجها خلال 3 أيام", count: counts.exit3d, filter: "exit_3d", color: "bg-emerald-500" },
    { label: "دفعات متأخرة", count: counts.overdue, filter: "overdue", color: "bg-red-600" },
  ];

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold flex items-center gap-2">
        <AlertTriangle className="w-5 h-5 text-amber-600" />
        تنبيهات التشغيل
      </h3>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {alertCards.map((card) => (
          <Card key={card.filter} className={`relative overflow-hidden border-0 shadow-md ${card.color}`}>
            <div className="relative p-4 text-white">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] opacity-90 leading-tight">{card.label}</span>
                <Calendar className="w-4 h-4 opacity-70" />
              </div>
              <p className="text-2xl font-bold">{card.count}</p>
              <Button
                size="sm"
                variant="secondary"
                className="mt-2 text-xs"
                onClick={() => onNavigate("batches", card.filter)}
              >
                عرض الدفعات
              </Button>
            </div>
          </Card>
        ))}
      </div>

      {todayOps.length > 0 && (
        <div className="space-y-2">
          <h4 className="font-semibold text-sm">متابعة تشغيل المعمل اليوم</h4>
          <Card className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>رقم الدفعة</TableHead>
                  <TableHead>العميل</TableHead>
                  <TableHead>الماكينة</TableHead>
                  <TableHead>المرحلة الحالية</TableHead>
                  <TableHead>الإجراء المطلوب</TableHead>
                  <TableHead>التاريخ المستهدف</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {todayOps.map((op) => (
                  <TableRow key={op.id} className={op.isUrgent ? "bg-red-50/40 dark:bg-red-950/20" : ""}>
                    <TableCell className="font-mono text-xs">{op.batch_number}</TableCell>
                    <TableCell className="text-xs">{op.customer}</TableCell>
                    <TableCell className="text-xs">{op.machine}</TableCell>
                    <TableCell className="text-xs">{op.stage}</TableCell>
                    <TableCell>
                      <Badge variant={op.action === "متابعة تأخير" ? "destructive" : "default"} className="text-[10px]">
                        {op.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">{op.targetDate}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}
    </div>
  );
}
