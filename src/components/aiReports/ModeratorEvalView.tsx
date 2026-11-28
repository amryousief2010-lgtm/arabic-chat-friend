import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BRAND } from "@/config/aiReports";
import { OUTCOME_AR, type ModeratorEvalRow } from "@/lib/aiReports/types";
import { num, pct } from "@/lib/aiReports/format";

const scoreColor = (s: number | null) => (s == null ? undefined : s >= 4 ? BRAND.purple : s >= 3 ? BRAND.magenta : BRAND.orange);

function ScoreBar({ dist }: { dist: Record<string, number> }) {
  const total = Object.values(dist).reduce((a, b) => a + Number(b), 0) || 1;
  const colors = ["#F37346", "#F59E6B", "#C47BB5", "#A4288A", "#662D8C"];
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted" title="توزيع الدرجات من 1 لـ 5">
      {[1, 2, 3, 4, 5].map((s) => <div key={s} style={{ width: `${(Number(dist[String(s)] ?? 0) * 100) / total}%`, background: colors[s - 1] }} />)}
    </div>
  );
}

export default function ModeratorEvalView({ rows }: { rows: ModeratorEvalRow[] }) {
  if (!rows.length) return <Card><CardContent className="py-10 text-center text-muted-foreground">مفيش مكالمات محللة في الفترة دي.</CardContent></Card>;
  return (
    <div dir="rtl" className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 text-start font-cairo">
      {rows.map((r) => (
        <Card key={r.moderator_id} className="overflow-hidden">
          <div className="h-1" style={{ background: scoreColor(r.avg_score) }} />
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-base">
              <bdi>{r.display_name}</bdi>
              <span className="text-2xl font-bold" style={{ color: scoreColor(r.avg_score) }}><bdi dir="ltr">{r.avg_score == null ? "—" : num(r.avg_score, 1)}<span className="text-xs text-muted-foreground font-normal"> / 5</span></bdi></span>
            </CardTitle>
            {r.small_sample && <Badge variant="outline" className="w-fit" style={{ borderColor: BRAND.orange, color: BRAND.orange }}>عينة صغيرة: التقييم مبدئي</Badge>}
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <ScoreBar dist={r.score_dist} />
            <div className="grid grid-cols-3 gap-2 text-center">
              <div><div className="text-lg font-bold">{num(r.analysed_calls)}</div><div className="text-xs text-muted-foreground">مكالمة محللة</div></div>
              <div><div className="text-lg font-bold">{pct(r.win_pct, 0)}</div><div className="text-xs text-muted-foreground">طلب أو وعد من استفسارات البيع</div></div>
              <div><div className="text-lg font-bold" style={{ color: r.followups ? BRAND.orange : undefined }}>{num(r.followups)}</div><div className="text-xs text-muted-foreground">محتاجة متابعة</div></div>
            </div>
            <div className="flex flex-wrap gap-1">
              {Object.entries(r.outcomes).sort((a, b) => b[1] - a[1]).map(([k, v]) => <Badge key={k} variant="secondary" className="text-[11px]">{OUTCOME_AR[k] ?? k} · {num(v)}</Badge>)}
            </div>
            {r.top_objections.length > 0 && (
              <div><div className="text-xs font-semibold mb-1">أكتر اعتراضات</div>
                <div className="flex flex-wrap gap-1">{r.top_objections.map((o) => <Badge key={o.text} variant="outline" className="text-[11px]">{o.text} · {num(o.n)}</Badge>)}</div></div>
            )}
            {r.recent_notes.length > 0 && (
              <div className="space-y-1"><div className="text-xs font-semibold">ملاحظات آخر مكالمات</div>
                {r.recent_notes.slice(0, 3).map((n, i) => (
                  <p key={i} dir="rtl" className="text-xs leading-6 rounded bg-muted/50 p-2 text-start"><bdi dir="ltr" className="font-bold" style={{ color: scoreColor(n.score) }}>{n.score ?? "—"}/5</bdi> · {n.note}</p>
                ))}</div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
