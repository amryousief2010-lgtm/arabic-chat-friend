import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { canManageAiRules, BRAND } from "@/config/aiReports";
import { useAiAlertsUnread } from "@/hooks/useAiAlertsUnread";
import MorningReportView from "@/components/aiReports/MorningReportView";
import ModeratorEvalView from "@/components/aiReports/ModeratorEvalView";
import AlertsView, { type AlertScope } from "@/components/aiReports/AlertsView";
import RulesView from "@/components/aiReports/RulesView";
import type { ActionRow, AlertRow, ModeratorEvalRow, MorningReportRow, RuleRow } from "@/lib/aiReports/types";

const db = supabase as any;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };
const errMsg = (e: any) => /forbidden|permission|42501/i.test(String(e?.message ?? "")) ? "مش عندك صلاحية للإجراء ده." : "حصل خطأ، جرّب تاني بعد شوية.";

/** «التقارير والتنبيهات الذكية»: التقرير الصباحي، تقييم المودريتورز من المكالمات، والتنبيهات. للمدير العام ومدير المبيعات بس. */
export default function AiReports() {
  const { roles } = useAuth();
  const isGm = canManageAiRules(roles);
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "report";
  const { refresh: refreshBell } = useAiAlertsUnread();

  const [report, setReport] = useState<MorningReportRow | null>(null);
  const [evalRows, setEvalRows] = useState<ModeratorEvalRow[]>([]);
  const [from, setFrom] = useState(daysAgo(6)); const [to, setTo] = useState(iso(new Date()));
  const [alerts, setAlerts] = useState<AlertRow[]>([]); const [actions, setActions] = useState<ActionRow[]>([]);
  const [scope, setScope] = useState<AlertScope>("active");
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [requesting, setRequesting] = useState<AlertRow | null>(null); const [note, setNote] = useState("");
  const [regen, setRegen] = useState(false);

  const loadReport = useCallback(async () => {
    const { data, error } = await db.rpc("cm_ai_morning_report_get", { _d: null });
    if (error) { toast.error(errMsg(error)); return; }
    setReport((data ?? [])[0] ?? null);
  }, []);
  const loadEval = useCallback(async () => {
    const { data, error } = await db.rpc("cm_ai_moderator_eval", { _from: from, _to: to });
    if (error) { toast.error(errMsg(error)); return; }
    setEvalRows(data ?? []);
  }, [from, to]);
  const loadAlerts = useCallback(async () => {
    const [a, x] = await Promise.all([db.rpc("cm_ai_alerts_list", { _scope: scope, _limit: 200 }), db.rpc("cm_ai_actions_list", { _limit: 50 })]);
    if (a.error || x.error) { toast.error(errMsg(a.error ?? x.error)); return; }
    setAlerts(a.data ?? []); setActions(x.data ?? []);
  }, [scope]);
  const loadRules = useCallback(async () => {
    const { data, error } = await db.rpc("cm_ai_rules_list");
    if (error) { toast.error(errMsg(error)); return; }
    setRules(data ?? []);
  }, []);

  useEffect(() => { if (tab === "report") loadReport(); }, [tab, loadReport]);
  useEffect(() => { if (tab === "moderators") loadEval(); }, [tab, loadEval]);
  useEffect(() => { if (tab === "alerts") loadAlerts(); }, [tab, loadAlerts]);
  useEffect(() => { if (tab === "rules") loadRules(); }, [tab, loadRules]);

  const op = async (id: string, o: "seen" | "snooze" | "resolve") => {
    setBusy(id); const { error } = await db.rpc("cm_ai_alert_update", { _id: id, _op: o }); setBusy(null);
    if (error) toast.error(errMsg(error)); else { loadAlerts(); refreshBell(); }
  };
  const submitRequest = async () => {
    if (!requesting) return; setBusy(requesting.id);
    const { error } = await db.rpc("cm_ai_alert_request_action", { _id: requesting.id, _note: note || null }); setBusy(null);
    if (error) toast.error(errMsg(error)); else { toast.success("الطلب اتسجل ومستني موافقة المدير العام"); setRequesting(null); setNote(""); loadAlerts(); refreshBell(); }
  };
  const decide = async (actionId: string, approve: boolean) => {
    setBusy(actionId); const { error } = await db.rpc("cm_ai_action_decide", { _action_id: actionId, _approve: approve, _note: null }); setBusy(null);
    if (error) toast.error(errMsg(error)); else { toast.success(approve ? "اتوافق عليه. التنفيذ يدوي." : "اترفض"); loadAlerts(); }
  };
  const saveRule = async (code: string, p: { enabled?: boolean; shadow?: boolean; params?: Record<string, number> }) => {
    const { error } = await db.rpc("cm_ai_rule_update", { _code: code, _enabled: p.enabled ?? null, _shadow: p.shadow ?? null, _params: p.params ?? null });
    if (error) toast.error(errMsg(error)); else { toast.success("اتحفظ"); loadRules(); }
  };
  const regenerate = async () => {
    setRegen(true);
    const { data, error } = await supabase.functions.invoke("cm-morning-report", { body: {} });
    setRegen(false);
    if (error || data?.ok === false) toast.error(data?.error ?? "التقرير ماتعملش. جرّب تاني بعد شوية."); else { toast.success("التقرير اتحدث"); loadReport(); }
  };

  return (
    <DashboardLayout>
      <div dir="rtl" className="space-y-4 font-cairo">
        <Header title="التقارير والتنبيهات الذكية" subtitle="التقرير الصباحي، وتقييم المودريتورز من المكالمات، والتنبيهات" />
        <Tabs dir="rtl" value={tab} onValueChange={(v) => setParams({ tab: v })}>
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="report">التقرير الصباحي</TabsTrigger>
            <TabsTrigger value="moderators">تقييم المودريتورز</TabsTrigger>
            <TabsTrigger value="alerts">التنبيهات</TabsTrigger>
            <TabsTrigger value="rules">القواعد والحدود</TabsTrigger>
          </TabsList>

          <TabsContent value="report" className="space-y-3">
            <div className="flex justify-end">
              <Button size="sm" variant="outline" disabled={regen} onClick={regenerate}><RefreshCw className={`w-4 h-4 ml-1 ${regen ? "animate-spin" : ""}`} />حدّث التقرير (مرتين في اليوم بحد أقصى)</Button>
            </div>
            <MorningReportView row={report} />
          </TabsContent>

          <TabsContent value="moderators" className="space-y-3">
            <Card><CardContent className="flex flex-wrap items-end gap-3 pt-6">
              <label className="text-sm">من<Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-44" /></label>
              <label className="text-sm">إلى<Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-44" /></label>
              {[["7 أيام", 6], ["30 يوم", 29]].map(([l, n]) => (
                <Button key={l as string} size="sm" variant="outline" onClick={() => { setFrom(daysAgo(n as number)); setTo(iso(new Date())); }}>{l}</Button>))}
              <span className="text-xs text-muted-foreground">التقييم من المكالمات المحللة بس (الدرجة من 1 لـ 5 لتعامل المودريتور).</span>
            </CardContent></Card>
            <ModeratorEvalView rows={evalRows} />
          </TabsContent>

          <TabsContent value="alerts">
            <AlertsView alerts={alerts} actions={actions} scope={scope} onScope={setScope} isGm={isGm} onOp={op} onRequest={(a) => setRequesting(a)} onDecide={decide} busy={busy} />
          </TabsContent>

          <TabsContent value="rules">
            <RulesView rules={rules} canEdit={isGm} onSave={saveRule} />
          </TabsContent>
        </Tabs>

        <Dialog open={!!requesting} onOpenChange={(o) => { if (!o) setRequesting(null); }}>
          <DialogContent dir="rtl">
            <DialogHeader><DialogTitle>طلب موافقة</DialogTitle></DialogHeader>
            <p className="text-sm">{requesting?.suggested_action}</p>
            <p className="text-xs text-muted-foreground">{requesting?.title}</p>
            <Textarea placeholder="ملاحظة (اختياري)" value={note} onChange={(e) => setNote(e.target.value)} />
            <p className="text-xs text-muted-foreground">الطلب بيتسجل بس ومفيش حاجة بتتنفذ لوحدها.</p>
            <DialogFooter><Button disabled={!!busy} style={{ background: BRAND.purple }} onClick={submitRequest}>ابعت الطلب</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
