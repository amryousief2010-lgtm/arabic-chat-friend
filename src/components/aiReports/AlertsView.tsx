import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, AlertOctagon, Info, Sparkles, Check, Clock, X, Send } from "lucide-react";
import { BRAND } from "@/config/aiReports";
import { SEVERITY_AR, type ActionRow, type AlertRow, type Severity } from "@/lib/aiReports/types";
import { riyadhTime } from "@/lib/aiReports/format";

const SEV: Record<Severity, { color: string; Icon: typeof Info }> = {
  danger: { color: "#DC2626", Icon: AlertOctagon }, warning: { color: BRAND.orange, Icon: AlertTriangle }, info: { color: BRAND.purple, Icon: Info },
};
export type AlertScope = "active" | "shadow" | "resolved";

interface Props {
  alerts: AlertRow[]; actions: ActionRow[]; scope: AlertScope; onScope: (s: AlertScope) => void; isGm: boolean;
  onOp: (id: string, op: "seen" | "snooze" | "resolve") => void; onRequest: (a: AlertRow) => void;
  onDecide: (actionId: string, approve: boolean) => void; busy?: string | null;
}

export default function AlertsView({ alerts, actions, scope, onScope, isGm, onOp, onRequest, onDecide, busy }: Props) {
  const pending = actions.filter((a) => a.status === "requested");
  const scopes: [AlertScope, string][] = [["active", "المفتوحة"], ...(isGm ? [["shadow", "تجريبي (أسبوع الخلفية)"] as [AlertScope, string]] : []), ["resolved", "المقفولة"]];
  return (
    <div dir="rtl" className="space-y-4 text-start font-cairo">
      {pending.length > 0 && (
        <Card style={{ borderColor: BRAND.magenta }}>
          <CardHeader className="pb-2"><CardTitle className="text-base">طلبات مستنية موافقة ({pending.length})</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {pending.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/50 p-3 text-sm">
                <div><div className="font-semibold">{a.action_text}</div><div className="text-xs text-muted-foreground">{a.alert_title} · {riyadhTime(a.requested_at)} (بتوقيت الرياض){a.note ? ` · ${a.note}` : ""}</div></div>
                {isGm ? (
                  <div className="flex gap-2">
                    <Button size="sm" disabled={busy === a.id} style={{ background: BRAND.purple }} onClick={() => onDecide(a.id, true)}><Check className="w-4 h-4 ml-1" />موافق</Button>
                    <Button size="sm" variant="outline" disabled={busy === a.id} onClick={() => onDecide(a.id, false)}><X className="w-4 h-4 ml-1" />رفض</Button>
                  </div>
                ) : <Badge variant="secondary">مستني موافقة المدير العام</Badge>}
              </div>
            ))}
            <p className="text-xs text-muted-foreground">الموافقة بتتسجل بس، والتنفيذ (زي إيقاف حملة على ميتا) بيتعمل يدوي.</p>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        {scopes.map(([s, l]) => (
          <Button key={s} size="sm" variant={scope === s ? "default" : "outline"} style={scope === s ? { background: BRAND.magenta } : undefined} onClick={() => onScope(s)}>{l}</Button>
        ))}
      </div>

      {!alerts.length && <Card><CardContent className="py-10 text-center text-muted-foreground">مفيش تنبيهات هنا.</CardContent></Card>}
      <div className="space-y-3">
        {alerts.map((a) => {
          const { color, Icon } = SEV[a.severity];
          return (
            <Card key={a.id} className="overflow-hidden" style={{ borderRightWidth: 4, borderRightColor: color, opacity: a.status === "seen" ? 0.85 : 1 }}>
              <CardContent className="pt-4 space-y-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex items-start gap-2">
                    <Icon className="w-5 h-5 mt-0.5 shrink-0" style={{ color }} />
                    <div>
                      <div className="font-semibold">{a.title}</div>
                      <div className="text-xs text-muted-foreground">{a.rule_code} · {a.rule_name} · {riyadhTime(a.updated_at)} (بتوقيت الرياض)</div>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Badge style={{ background: color, color: "#fff" }}>{SEVERITY_AR[a.severity]}</Badge>
                    {a.shadow && <Badge variant="outline">تجريبي</Badge>}
                    {a.status === "seen" && <Badge variant="secondary">اتشاف</Badge>}
                    {a.action_status && <Badge variant="outline">{a.action_status === "requested" ? "مستني موافقة" : a.action_status === "approved" ? "اتوافق عليه" : "اترفض"}</Badge>}
                  </div>
                </div>
                {a.body && <p dir="rtl" className="text-sm text-foreground/90 text-start">{a.body}</p>}
                {a.ai_note && <p dir="rtl" className="text-sm rounded-lg p-2 flex gap-2 text-start" style={{ background: "#A4288A10" }}><Sparkles className="w-4 h-4 shrink-0 mt-1" style={{ color: BRAND.magenta }} />{a.ai_note}</p>}
                {a.status !== "resolved" && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {a.suggested_action && !a.action_status && (
                      <Button size="sm" disabled={busy === a.id} style={{ background: BRAND.purple }} onClick={() => onRequest(a)}><Send className="w-4 h-4 ml-1" />{a.suggested_action}</Button>
                    )}
                    {a.status === "open" && <Button size="sm" variant="outline" disabled={busy === a.id} onClick={() => onOp(a.id, "seen")}><Check className="w-4 h-4 ml-1" />اتشاف</Button>}
                    <Button size="sm" variant="outline" disabled={busy === a.id} onClick={() => onOp(a.id, "snooze")}><Clock className="w-4 h-4 ml-1" />أجّل ساعة</Button>
                    <Button size="sm" variant="ghost" disabled={busy === a.id} onClick={() => onOp(a.id, "resolve")}>اتقفل</Button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
