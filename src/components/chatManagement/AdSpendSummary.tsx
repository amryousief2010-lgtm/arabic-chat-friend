import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { formatMoney } from "@/lib/chatManagement/kpiMetrics";
import { firstOfMonth, lineForSpend, safeDiv, spendByDay, type FCampaign, type FLine, type FLineMap, type FSpend } from "@/lib/chatManagement/adFunnel";

const db = supabase as any;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const n = (v: number | null) => (v == null ? "—" : v.toLocaleString("en-US"));
const th = "p-2 text-right whitespace-nowrap";

/** ملخّص الإنفاق الإعلاني اليومي (قراءة فقط) من أول الشهر: حسب اليوم وحسب الحملة مع الخط والمودريتور. */
export default function AdSpendSummary({ reloadKey }: { reloadKey?: number }) {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(iso(new Date()));
  const [spend, setSpend] = useState<FSpend[]>([]);
  const [camps, setCamps] = useState<FCampaign[]>([]);
  const [maps, setMaps] = useState<FLineMap[]>([]);
  const [lines, setLines] = useState<FLine[]>([]);
  const [mods, setMods] = useState<{ id: string; display_name: string }[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([
      db.from("cm_ad_spend_daily").select("campaign_id,spend_date,spend,impressions,clicks").gte("spend_date", from).lte("spend_date", to).order("spend_date").limit(5000),
      db.from("cm_campaigns").select("id,name,meta_campaign_id,product_tag"),
      db.from("cm_campaign_line_map").select("campaign_id,line_id,valid_from,valid_to"),
      db.from("cm_lines").select("id,label,owner_moderator_id"),
      db.from("cm_moderators").select("id,display_name"),
    ]).then(([s, c, m, l, o]) => {
      if (!live) return;
      const e = s.error ?? c.error ?? m.error ?? l.error ?? o.error;
      setErr(e ? "تعذّر تحميل ملخّص الإنفاق. أعد المحاولة بعد قليل." : null);
      setSpend(s.data ?? []); setCamps(c.data ?? []); setMaps(m.data ?? []); setLines(l.data ?? []); setMods(o.data ?? []);
    });
    return () => { live = false; };
  }, [from, to, reloadKey]);

  const days = useMemo(() => spendByDay(spend), [spend]);
  const byCamp = useMemo(() => {
    const m = new Map<string, { id: string; spend: number; impressions: number; clicks: number; line: string; mod: string }>();
    for (const s of spend) {
      const lid = lineForSpend(maps, s.campaign_id, s.spend_date);
      const ln = lines.find((x) => x.id === lid);
      const r = m.get(s.campaign_id) ?? { id: s.campaign_id, spend: 0, impressions: 0, clicks: 0,
        line: ln?.label ?? "غير مربوطة بخط", mod: ln ? (mods.find((x) => x.id === ln.owner_moderator_id)?.display_name ?? "—") : "غير محدَّد" };
      r.spend = Math.round((r.spend + Number(s.spend)) * 100) / 100; r.impressions += Number(s.impressions ?? 0); r.clicks += Number(s.clicks ?? 0);
      m.set(s.campaign_id, r);
    }
    return [...m.values()].sort((a, b) => b.spend - a.spend);
  }, [spend, maps, lines, mods]);
  const total = Math.round(days.reduce((a, d) => a + d.spend, 0) * 100) / 100;
  const imp = days.reduce((a, d) => a + Number(d.impressions ?? 0), 0);
  const clk = days.reduce((a, d) => a + Number(d.clicks ?? 0), 0);
  const cname = (id: string) => camps.find((c) => c.id === id)?.name ?? "—";

  return (
    <Card><CardHeader><CardTitle>ملخّص الإنفاق</CardTitle>
      <CardDescription>من أول الشهر افتراضيًا. الحملة تُنسب للخط والمودريتور عبر ربط الحملة بالخط في التطبيق.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">من<Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-44" /></label>
          <label className="text-sm">إلى<Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-44" /></label>
        </div>
        {err && <p role="alert" className="text-sm text-[#F37346]">{err}</p>}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {[["إجمالي الإنفاق", formatMoney(total)], ["عدد الأيام", n(days.length)], ["مرات الظهور", n(imp)], ["النقرات", n(clk)],
            ["تكلفة النقرة", formatMoney(safeDiv(total, clk))]].map(([l, v]) => (
            <Card key={l} className="border-[#A4288A]/20"><CardContent className="pt-4"><div className="text-xs text-muted-foreground">{l}</div><div className="text-2xl font-bold text-[#662D8C]">{v}</div></CardContent></Card>))}
        </div>
        <div className="overflow-x-auto rounded border"><table className="w-full min-w-max text-sm">
          <thead className="bg-muted"><tr>{["اليوم", "الإنفاق", "مرات الظهور", "النقرات", "عدد الحملات"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
          <tbody>{days.map((d) => (<tr key={d.day} className="border-t"><td className="p-2">{d.day}</td><td className="p-2">{formatMoney(d.spend)}</td>
            <td className="p-2">{n(d.impressions)}</td><td className="p-2">{n(d.clicks)}</td><td className="p-2">{d.campaigns}</td></tr>))}
            {!days.length && <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">لا إنفاق مسجَّل في هذه الفترة</td></tr>}
          </tbody></table></div>
        <div className="overflow-x-auto rounded border"><table className="w-full min-w-max text-sm">
          <thead className="bg-muted"><tr>{["الحملة", "الخط", "المودريتور", "الإنفاق", "مرات الظهور", "النقرات", "تكلفة النقرة", "النسبة من الإجمالي"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
          <tbody>{byCamp.map((r) => (<tr key={r.id} className="border-t"><td className="p-2 font-medium whitespace-nowrap">{cname(r.id)}</td>
            <td className="p-2 whitespace-nowrap">{r.line}</td><td className="p-2">{r.mod}</td><td className="p-2">{formatMoney(r.spend)}</td>
            <td className="p-2">{n(r.impressions)}</td><td className="p-2">{n(r.clicks)}</td><td className="p-2">{formatMoney(safeDiv(r.spend, r.clicks))}</td>
            <td className="p-2">{total > 0 ? `${Math.round((r.spend / total) * 1000) / 10}٪` : "—"}</td></tr>))}
          </tbody></table></div>
      </CardContent></Card>
  );
}
