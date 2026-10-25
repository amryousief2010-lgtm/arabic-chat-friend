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
