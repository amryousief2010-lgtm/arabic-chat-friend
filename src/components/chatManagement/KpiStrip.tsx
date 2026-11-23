import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { InboxKpis } from "@/lib/chatManagement/inbox";
import type { SectionStatus } from "@/lib/chatManagement/callsLoad";
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

/** فشل البطاقة يعرض «—» لا صفراً، مع إعادة مستقلة. التحميل هيكل خاص بالبطاقة. */
export function CallAnalysisStrip({ k, status = "ready", objectionsStatus = "ready", onRetry, onRetryObjections }: {
  k: CallAnalysisKpis;
  status?: Exclude<SectionStatus, "idle">;
  objectionsStatus?: SectionStatus;
  onRetry?: () => void;
  onRetryObjections?: () => void;
}) {
  const failed = status === "error";
  const tiles = [
    { key: "analyzed", label: "مكالمات محلَّلة", value: failed ? "—" : String(k.analyzed), color: BRAND.purple },
    { key: "score", label: "متوسط تقييم التعامل (من 5)", value: failed || k.avgScore == null ? "—" : k.avgScore.toFixed(1), color: BRAND.magenta },
    { key: "order", label: "مكالمات وصلت لطلب أو وعد", value: failed || k.orderPct == null ? "—" : `${k.orderPct.toFixed(0)}%`, color: BRAND.purple },
    { key: "followups", label: "متابعات مطلوبة مفتوحة", value: failed ? "—" : String(k.openFollowups), color: BRAND.orange },
  ];
  return (
    <div className="space-y-2" data-testid="call-analysis-strip">
      {status === "loading" ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="call-analysis-skeleton">
          {tiles.map((t) => (
            <Card key={t.key} style={{ borderTop: `3px solid ${t.color}` }}>
              <CardContent className="space-y-2 p-3">
                <Skeleton className="mx-auto h-8 w-16" />
                <Skeleton className="mx-auto h-3 w-24" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {tiles.map((t) => (
            <Card key={t.key} style={{ borderTop: `3px solid ${t.color}` }}>
              <CardContent className="p-3 text-center">
                <div className="text-2xl font-bold" style={{ color: t.color }} data-testid={`analysis-${t.key}`}>{t.value}</div>
                <div className="text-xs text-muted-foreground">{t.label}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {failed && onRetry && (
        <div className="text-center">
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs text-[#A4288A]" onClick={onRetry} aria-label="إعادة تحميل تحليل المكالمات">إعادة المحاولة</Button>
        </div>
      )}
      {objectionsStatus === "loading" && <Skeleton className="h-4 w-48" data-testid="objections-skeleton" />}
      {objectionsStatus === "error" && (
        <p className="text-center text-xs text-muted-foreground" data-testid="objections-error">
          أكثر الاعتراضات: —{" "}
          <button type="button" className="text-[#A4288A] underline" onClick={onRetryObjections} aria-label="إعادة تحميل الاعتراضات">إعادة</button>
        </p>
      )}
      {objectionsStatus === "ready" && k.topObjections.length > 0 && (
        <p className="text-xs text-muted-foreground">أكثر الاعتراضات: {k.topObjections.map((o) => `${o.objection} (${o.calls})`).join("، ")}</p>
      )}
    </div>
  );
}
