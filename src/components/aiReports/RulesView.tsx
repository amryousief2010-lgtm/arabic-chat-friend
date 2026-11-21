import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SEVERITY_AR, type RuleRow } from "@/lib/aiReports/types";

const AUD: Record<string, string> = { general_manager: "المدير العام", sales_manager: "م. آلاء حامد", moderator: "المودريتور" };
const PARAM_AR: Record<string, string> = {
  warn_pct: "تحذير فوق %", danger_pct: "خطير فوق %", cap_pct: "السقف %", min_spend: "أقل صرف (جنيه)", max_cpo: "أقصى تكلفة طلب", factor: "مضاعف المتوسط",
  min_convs: "أقل محادثات", min_conv_pct: "أقل تحويل %", minutes: "دقايق", warn_count: "تحذير عند", danger_count: "خطير عند", wait_minutes: "انتظار (دقيقة)",
  late_pct: "متأخر %", abandoned_pct: "متروك %", after_minutes: "بعد (دقيقة)", min_calls: "أقل مكالمات", missed_pct: "فايت %", min_cancels: "أقل إلغاءات",
  hours: "ساعات", silence_minutes: "سكوت (دقيقة)", min_waiting: "أقل مستنيين", pace_pct: "من المفروض %",
};

interface Props { rules: RuleRow[]; canEdit: boolean; onSave: (code: string, patch: { enabled?: boolean; shadow?: boolean; params?: Record<string, number> }) => void }

export default function RulesView({ rules, canEdit, onSave }: Props) {
  const [edits, setEdits] = useState<Record<string, Record<string, number>>>({});
  return (
    <Card><CardContent className="pt-6 overflow-x-auto">
      <p className="text-sm text-muted-foreground mb-3">«تجريبي» يعني التنبيه بيتسجل في الخلفية ومش بيظهر في الجرس، عشان نراجع العدد أسبوع قبل التشغيل الفعلي. التعديل للمدير العام بس.</p>
      <Table>
        <TableHeader><TableRow>
          <TableHead className="text-right">القاعدة</TableHead><TableHead className="text-right">الخطورة</TableHead><TableHead className="text-right">لمين</TableHead>
          <TableHead className="text-right">الحدود</TableHead><TableHead className="text-right">شغالة</TableHead><TableHead className="text-right">تجريبي</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {rules.map((r) => {
            const e = edits[r.code] ?? {}; const dirty = Object.keys(e).length > 0;
            return (
              <TableRow key={r.code}>
                <TableCell><div className="font-semibold">{r.code} · {r.name_ar}</div>{r.notes && <div className="text-xs text-muted-foreground max-w-xs">{r.notes}</div>}</TableCell>
                <TableCell><Badge variant="outline">{SEVERITY_AR[r.severity]}</Badge></TableCell>
                <TableCell className="text-xs">{r.audience.map((a) => AUD[a] ?? a).join("، ")}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-2 items-center">
                    {Object.entries(r.params).map(([k, v]) => (
                      <label key={k} className="text-xs flex items-center gap-1">{PARAM_AR[k] ?? k}
                        <Input type="number" className="h-7 w-20" disabled={!canEdit} value={e[k] ?? v}
                          onChange={(ev) => setEdits((s) => ({ ...s, [r.code]: { ...s[r.code], [k]: Number(ev.target.value) } }))} />
                      </label>
                    ))}
                    {dirty && canEdit && <Button size="sm" className="h-7" onClick={() => { onSave(r.code, { params: e }); setEdits((s) => { const n = { ...s }; delete n[r.code]; return n; }); }}>حفظ</Button>}
                  </div>
                </TableCell>
                <TableCell><Switch checked={r.enabled} disabled={!canEdit} onCheckedChange={(v) => onSave(r.code, { enabled: v })} /></TableCell>
                <TableCell><Switch checked={r.shadow} disabled={!canEdit} onCheckedChange={(v) => onSave(r.code, { shadow: v })} /></TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </CardContent></Card>
  );
}
