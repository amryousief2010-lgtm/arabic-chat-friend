import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sparkles, TrendingUp, TrendingDown, Megaphone, Users, PhoneCall, ListChecks } from "lucide-react";
import { BRAND } from "@/config/aiReports";
import type { MorningReportRow } from "@/lib/aiReports/types";
import { arDate, egp, num, pct, ratio } from "@/lib/aiReports/format";

const Tile = ({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "bad" | "good" }) => (
  <div className="rounded-xl border bg-card p-3">
    <div className="text-xs text-muted-foreground">{label}</div>
    <div className="text-xl font-bold mt-1" style={{ color: tone === "bad" ? BRAND.orange : tone === "good" ? BRAND.purple : undefined }}>{value}</div>
    {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
  </div>
);

const Para = ({ icon: Icon, title, text }: { icon: typeof Users; title: string; text?: string }) =>
  text ? (
    <div className="space-y-1">
      <div className="flex items-center gap-2 font-semibold"><Icon className="w-4 h-4" style={{ color: BRAND.purple }} />{title}</div>
      <p className="text-sm leading-7 text-foreground/90">{text}</p>
    </div>
  ) : null;

export default function MorningReportView({ row }: { row: MorningReportRow | null }) {
  if (!row) return <Card><CardContent className="py-10 text-center text-muted-foreground">لسه مفيش تقرير. التقرير بيتعمل كل يوم 10:10 الصبح بتوقيت الرياض.</CardContent></Card>;
  const f = row.facts; const ai = row.status === "done" ? row.report : null;
  const salesUp = f.sales.net_sales >= f.sales.avg7_net_sales;
  const adBad = (f.ads.pct ?? 0) > f.ads_cap_pct; const mtdBad = (f.ads.mtd_pct ?? 0) > f.ads_cap_pct;
  return (
    <div className="space-y-4">
      <div className="rounded-2xl p-5 text-white shadow" style={{ background: `linear-gradient(135deg, ${BRAND.purple}, ${BRAND.magenta})` }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-lg font-bold">التقرير الصباحي · أرقام {arDate(f.date)}</div>
          <Badge className="bg-white/20 text-white border-0">{ai ? "مكتوب بالذكاء الاصطناعي" : "أرقام بس"}</Badge>
        </div>
        {ai?.headline?.length ? (
          <ol className="mt-3 space-y-1 list-decimal pr-5 text-sm leading-7">{ai.headline.map((h, i) => <li key={i}>{h}</li>)}</ol>
        ) : (
          <p className="mt-3 text-sm opacity-90">{row.status === "error" ? "النص ماتكتبش النهارده، والأرقام تحت كاملة." : "النص بيتكتب بعد تسجيل صرف امبارح."}</p>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="طلبات امبارح" value={num(f.sales.orders)} hint={`متوسط 7 أيام ${num(f.sales.avg7_orders, 1)} · ملغي ${num(f.sales.cancelled)}`} />
        <Tile label="صافي مبيعات امبارح" value={egp(f.sales.net_sales)} hint={`متوسط 7 أيام ${egp(f.sales.avg7_net_sales)}`} tone={salesUp ? "good" : "bad"} />
        <Tile label="صرف الإعلانات امبارح" value={f.ads.spend_recorded ? egp(f.ads.spend) : "ماتسجلش"} hint={`${pct(f.ads.pct)} من المبيعات · السقف ${f.ads_cap_pct}%`} tone={adBad || !f.ads.spend_recorded ? "bad" : "good"} />
        <Tile label="نسبة الإعلانات من أول الشهر" value={pct(f.ads.mtd_pct)} hint={`${egp(f.ads.mtd_spend)} من ${egp(f.sales.mtd_net_sales)}`} tone={mtdBad ? "bad" : "good"} />
      </div>

      {ai && (
        <Card><CardContent className="pt-6 space-y-4">
          <Para icon={salesUp ? TrendingUp : TrendingDown} title="المبيعات" text={ai.sections.sales} />
          <Para icon={Megaphone} title="الإعلانات" text={ai.sections.ads} />
          <Para icon={Users} title="المودريتورز" text={ai.sections.moderators} />
          <Para icon={PhoneCall} title="المكالمات" text={ai.sections.calls} />
          <Para icon={ListChecks} title="المتابعات المفتوحة" text={ai.sections.followups} />
        </CardContent></Card>
      )}

      {ai?.decisions?.length ? (
        <Card style={{ borderColor: BRAND.orange }}>
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Sparkles className="w-4 h-4" style={{ color: BRAND.orange }} />3 قرارات مقترحة</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {ai.decisions.map((d, i) => (
              <div key={i} className="rounded-lg bg-muted/50 p-3"><div className="font-semibold">{i + 1}. {d.title}</div><div className="text-sm text-muted-foreground mt-1">{d.why}</div></div>
            ))}
            <p className="text-xs text-muted-foreground">مفيش حاجة بتتنفذ لوحدها. الموافقة على أي إجراء من تبويب «التنبيهات».</p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">المودريتورز امبارح</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead className="text-right">المودريتور</TableHead><TableHead className="text-right">محادثات</TableHead><TableHead className="text-right">أول رد متأخر</TableHead>
              <TableHead className="text-right">متروك</TableHead><TableHead className="text-right">طلبات</TableHead><TableHead className="text-right">ملغي</TableHead>
              <TableHead className="text-right">مكالمات متردّ عليها / فايتة</TableHead><TableHead className="text-right">معلق +72 ساعة</TableHead><TableHead className="text-right">مبيعات الشهر</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {f.moderators.map((m) => {
                const late = ratio(m.late_first_reply, m.conversations); const ab = ratio(m.abandoned, m.conversations);
                const note = ai?.moderator_notes?.find((n) => n.name === m.name)?.note;
                return (
                  <TableRow key={m.name}>
                    <TableCell className="font-semibold">{m.name}{note && <div className="text-xs font-normal text-muted-foreground max-w-xs">{note}</div>}</TableCell>
                    <TableCell>{num(m.conversations)}</TableCell>
                    <TableCell style={{ color: (late ?? 0) > 25 ? BRAND.orange : undefined }}>{m.conversations ? pct(late, 0) : "—"}</TableCell>
                    <TableCell style={{ color: (ab ?? 0) > 15 ? BRAND.orange : undefined }}>{m.conversations ? pct(ab, 0) : "—"}</TableCell>
                    <TableCell className="font-bold">{num(m.orders)}</TableCell>
                    <TableCell>{num(m.cancelled)}</TableCell>
                    <TableCell>{num(m.calls_answered)} / {num(m.calls_missed)}</TableCell>
                    <TableCell>{num(m.pending_over_72h)}</TableCell>
                    <TableCell>{egp(m.mtd_net_sales)}{m.target ? <div className="text-xs text-muted-foreground">الهدف {egp(m.target)}</div> : null}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {f.moderators.every((m) => !m.target) && <p className="text-xs text-muted-foreground mt-2">أهداف الشهر مش متسجلة لسه، فمقارنة الهدف مش ظاهرة.</p>}
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">الحملات آخر 3 أيام</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead className="text-right">الحملة</TableHead><TableHead className="text-right">الصرف</TableHead><TableHead className="text-right">محادثات</TableHead><TableHead className="text-right">طلبات</TableHead><TableHead className="text-right">تكلفة الطلب</TableHead></TableRow></TableHeader>
              <TableBody>
                {f.ads.campaigns_3d.slice(0, 10).map((c) => (
                  <TableRow key={c.name}>
                    <TableCell className="max-w-[12rem] truncate" title={c.name}>{c.name}{!c.tracked && <Badge variant="outline" className="mr-1 text-[10px]" style={{ borderColor: BRAND.orange, color: BRAND.orange }}>مش متتبعة</Badge>}</TableCell>
                    <TableCell>{egp(c.spend)}</TableCell><TableCell>{num(c.conversations)}</TableCell><TableCell>{num(c.orders)}</TableCell>
                    <TableCell style={{ color: !c.orders || c.spend / c.orders > 1000 ? BRAND.orange : undefined }}>{c.orders ? egp(c.spend / c.orders) : "بدون طلبات"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">المتابعات وأكتر اعتراضات العملاء</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <Tile label="طلبات معلقة +72 ساعة" value={num(f.followups.pending_over_72h)} hint={`منهم ${num(f.followups.pending_over_7d)} أكتر من أسبوع`} />
              <Tile label="مكالمات فايتة من غير رجوع" value={num(f.followups.missed_calls_no_callback)} hint="امبارح" />
            </div>
            <div className="flex flex-wrap gap-2">
              {f.top_objections_7d.map((o) => <Badge key={o.text} variant="secondary">{o.text} · {num(o.n)}</Badge>)}
              {!f.top_objections_7d.length && <span className="text-sm text-muted-foreground">لسه مفيش مكالمات محللة كفاية.</span>}
            </div>
          </CardContent>
        </Card>
      </div>
      {row.model && <p className="text-xs text-muted-foreground">الموديل {row.model}{row.cost_usd != null ? ` · التكلفة ${Number(row.cost_usd).toFixed(3)} دولار` : ""}</p>}
    </div>
  );
}
