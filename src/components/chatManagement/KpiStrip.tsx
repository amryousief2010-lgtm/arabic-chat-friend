import { Card, CardContent } from "@/components/ui/card";
import type { InboxKpis } from "@/lib/chatManagement/inbox";
import { BRAND } from "./brand";

const items: { key: keyof InboxKpis; label: string; color: string }[] = [
  { key: "on_time", label: "أول رد في الوقت", color: BRAND.purple },
  { key: "cover", label: "تغطية", color: BRAND.magenta },
  { key: "late", label: "متأخر", color: BRAND.orange },
  { key: "pending", label: "بانتظار أول رد", color: "#6b7280" },
  { key: "abandoned", label: "مهملة الآن", color: BRAND.orange },
];

export default function KpiStrip({ kpis }: { kpis: InboxKpis }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3" data-testid="kpi-strip">
      {items.map((i) => (
        <Card key={i.key} style={{ borderTop: `3px solid ${i.color}` }}>
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold" style={{ color: i.color }} data-testid={`kpi-${i.key}`}>{kpis[i.key]}</div>
            <div className="text-xs text-muted-foreground">{i.label}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/** مؤشرات تحليل المكالمات (من cm_call_analysis): عدد المحللة، متوسط تقييم التعامل، نسبة الوصول لطلب، المتابعات المفتوحة، أكثر الاعتراضات. */
export interface CallAnalysisKpis { analyzed: number; avgScore: number | null; orderPct: number | null; openFollowups: number; topObjections: { objection: string; calls: number }[] }
export function CallAnalysisStrip({ k }: { k: CallAnalysisKpis }) {
  const tiles = [
    { label: "مكالمات محلَّلة", value: String(k.analyzed), color: BRAND.purple },
    { label: "متوسط تقييم التعامل (من 5)", value: k.avgScore == null ? "—" : k.avgScore.toFixed(1), color: BRAND.magenta },
    { label: "مكالمات وصلت لطلب أو وعد", value: k.orderPct == null ? "—" : `${k.orderPct.toFixed(0)}%`, color: BRAND.purple },
    { label: "متابعات مطلوبة مفتوحة", value: String(k.openFollowups), color: BRAND.orange },
  ];
  return (
    <div className="space-y-2" data-testid="call-analysis-strip">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((t) => (
          <Card key={t.label} style={{ borderTop: `3px solid ${t.color}` }}>
            <CardContent className="p-3 text-center">
              <div className="text-2xl font-bold" style={{ color: t.color }}>{t.value}</div>
              <div className="text-xs text-muted-foreground">{t.label}</div>
            </CardContent>
          </Card>))}
      </div>
      {k.topObjections.length > 0 && <p className="text-xs text-muted-foreground">أكثر الاعتراضات: {k.topObjections.map((o) => `${o.objection} (${o.calls})`).join("، ")}</p>}
    </div>
  );
}
