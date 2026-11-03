import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { formatMoney, formatPct } from "@/lib/chatManagement/kpiMetrics";
import { funnelByAd, funnelByModerator, safeDiv, UNMAPPED, type FunnelRow } from "@/lib/chatManagement/adFunnel";
import { loadFunnelData, type FunnelData } from "@/lib/chatManagement/adFunnelData";

const NA = "غير متاح";
const n = (v: number | null) => (v == null ? NA : v.toLocaleString("en-US"));
const pct = (a: number | null, b: number | null) => (a == null || b == null ? NA : b > 0 ? formatPct(a, b) : "—");
const money = (v: number | null) => (v == null ? NA : formatMoney(v));
const th = (i: number) => `p-2 text-right whitespace-nowrap ${i === 0 ? "sticky right-0 z-10 shadow-[-6px_0_8px_-6px_rgba(102,45,140,0.25)] bg-muted" : ""}`;
const td0 = "sticky right-0 z-10 shadow-[-6px_0_8px_-6px_rgba(102,45,140,0.25)] bg-card p-2 font-medium whitespace-nowrap";

/** قمع الإعلانات لكل مودريتور ولكل إعلان. الإنفاق ← الخط عبر cm_campaign_line_map ← مالكة الخط. */
export default function AdFunnelSection({ from, to, viewerOnly = false }: { from: string; to: string; viewerOnly?: boolean }) {
  const [d, setD] = useState<FunnelData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true; setErr(null);
    loadFunnelData(from, to, viewerOnly).then((x) => live && setD(x)).catch((e) => { console.error("ad funnel load failed", e); live && setErr("تعذّر تحميل قمع الإعلانات. أعد المحاولة بعد قليل."); });
    return () => { live = false; };
  }, [from, to, viewerOnly]);

  const mods = useMemo(() => d ? funnelByModerator({ ...d, moderatorName: (id) => d.moderators.find((m) => m.id === id)?.display_name ?? "—" }) : [], [d]);
  const ads = useMemo(() => d ? funnelByAd(d) : [], [d]);
  const tot = (k: keyof FunnelRow) => mods.reduce((a, r) => a + Number((r[k] as number | null) ?? 0), 0);

  const modHead = ["المودريتور", "الخط", "حملات ميتا", "الإنفاق", "مرات الظهور", "الوصول", "النقرات", "المحادثات", "منها من إعلان", "تم الرد عليها", "متروكة", "طلبات من المحادثات", "تحويل محادثة ← طلب", "مُسلَّم", "نسبة التسليم", "قيمة المُسلَّم", "تكلفة المحادثة", "تكلفة الطلب", "تكلفة الطلب المُسلَّم"];
  const adHead = ["الإعلان", "معرّف الإعلان", "الخط", "حملة ميتا", "الإنفاق", "المحادثات", "تم الرد عليها", "متروكة", "طلبات", "تحويل محادثة ← طلب", "مُسلَّم", "قيمة المُسلَّم"];

  return (<>
    <Card><CardHeader><CardTitle>قمع الإعلانات حسب المودريتور</CardTitle>
      <CardDescription>الإنفاق يُنسب للمودريتور عبر ربط حملة ميتا بخطها، والمحادثات والطلبات من بيانات التطبيق. الطلبات هنا هي المربوطة بمحادثة فقط (حدّ أدنى).</CardDescription></CardHeader>
      <CardContent>
        {err && <p role="alert" className="mb-2 text-sm text-[#F37346]">{err}</p>}
        {!d && !err && <p className="text-sm text-muted-foreground">جارٍ التحميل…</p>}
        {d && <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[["إجمالي الإنفاق", formatMoney(Math.round(tot("spend") * 100) / 100)], ["المحادثات", n(tot("conversations"))],
            ["طلبات من المحادثات", n(tot("orders"))], ["مُسلَّم", n(tot("delivered"))]].map(([l, v]) => (
            <Card key={l} className="border-[#A4288A]/20"><CardContent className="pt-4"><div className="text-xs text-muted-foreground">{l}</div><div className="text-2xl font-bold text-[#662D8C]">{v}</div></CardContent></Card>))}
        </div>}
        <p className="mb-2 text-xs text-muted-foreground">↔ اسحب الجدول أفقياً لعرض باقي الأعمدة؛ العمود الأول ثابت</p>
        <div className="overflow-x-auto rounded border [scrollbar-width:thin]"><table className="w-full min-w-max text-sm">
          <thead className="bg-muted"><tr>{modHead.map((h, i) => <th key={h} className={th(i)}>{h}</th>)}</tr></thead>
          <tbody>{mods.map((r) => (
            <tr key={r.key} className="border-t">
              <td className={td0}>{r.label}</td><td className="p-2 whitespace-nowrap">{r.lines.join("، ") || "—"}</td>
              <td className="p-2 whitespace-nowrap">{r.campaigns.join("، ") || "—"}</td>
              <td className="p-2">{money(r.spend)}</td><td className="p-2">{n(r.impressions)}</td>
              <td className="p-2 text-muted-foreground" title="الوصول غير مسجَّل في جدول الإنفاق اليومي">{NA}</td><td className="p-2">{n(r.clicks)}</td>
              <td className="p-2">{n(r.conversations)}</td><td className="p-2">{n(r.from_ad)}</td><td className="p-2">{n(r.replied)}</td>
              <td className="p-2 text-[#F37346]">{n(r.abandoned)}</td><td className="p-2">{n(r.orders)}</td><td className="p-2">{pct(r.orders, r.conversations)}</td>
              <td className="p-2">{n(r.delivered)}</td><td className="p-2">{pct(r.delivered, r.orders)}</td><td className="p-2">{money(r.delivered_value)}</td>
              <td className="p-2">{r.spend ? money(safeDiv(r.spend, r.conversations)) ?? "—" : "—"}</td>
              <td className="p-2">{r.spend ? (safeDiv(r.spend, r.orders) == null ? NA : money(safeDiv(r.spend, r.orders))) : "—"}</td>
              <td className="p-2 font-semibold text-[#A4288A]">{r.spend ? (safeDiv(r.spend, r.delivered) == null ? NA : money(safeDiv(r.spend, r.delivered))) : "—"}</td>
            </tr>))}
            {d && !mods.length && <tr><td colSpan={modHead.length} className="p-4 text-center text-muted-foreground">لا بيانات في هذه الفترة</td></tr>}
          </tbody></table></div>
        <ul className="mt-3 list-disc space-y-1 pr-5 text-xs text-muted-foreground">
          <li>«الوصول»: {NA} — جدول الإنفاق اليومي يسجّل مرات الظهور والنقرات فقط.</li>
          {mods.some((r) => r.key === UNMAPPED) && <li>«حملات غير مربوطة بخط»: المحادثات والطلبات {NA} لأن هذه الحملات ليس لها ربط بخط في التطبيق بعد، ويلزم تأكيد المدير العام قبل ربطها.</li>}
          <li>تكلفة الطلب المُسلَّم تظهر «{NA}» حين لا توجد طلبات مُسلَّمة بعد في الفترة.</li>
          <li>إذا رُبط الخط بالتطبيق في منتصف الفترة فمحادثاته جزئية، فتكون تكلفة المحادثة أعلى من الحقيقية.</li>
        </ul>
      </CardContent></Card>

    <Card><CardHeader><CardTitle>قمع الإعلانات حسب الإعلان</CardTitle>
      <CardDescription>كل إعلان وصلت منه محادثات. الإنفاق مسجَّل على مستوى حملة ميتا وليس الإعلان، وربط الإعلان بحملته غير مسجَّل في التطبيق، فيُعرض «حملات الخط» للمرجع فقط.</CardDescription></CardHeader>
      <CardContent><div className="overflow-x-auto rounded border [scrollbar-width:thin]"><table className="w-full min-w-max text-sm">
        <thead className="bg-muted"><tr>{adHead.map((h, i) => <th key={h} className={th(i)}>{h}</th>)}</tr></thead>
        <tbody>{ads.map((r) => (
          <tr key={r.key} className="border-t">
            <td className={td0}>{r.label}</td><td className="p-2 font-mono" dir="ltr">{r.meta_ad_id ?? "—"}</td>
            <td className="p-2 whitespace-nowrap">{r.lines.join("، ") || "—"}</td>
            <td className="p-2 whitespace-nowrap text-muted-foreground">غير مربوط{r.line_campaigns.length ? ` (حملات الخط: ${r.line_campaigns.join("، ")})` : ""}</td>
            <td className="p-2 text-muted-foreground" title="الإنفاق على مستوى الحملة وليس الإعلان">{NA}</td>
            <td className="p-2">{n(r.conversations)}</td><td className="p-2">{n(r.replied)}</td><td className="p-2 text-[#F37346]">{n(r.abandoned)}</td>
            <td className="p-2">{n(r.orders)}</td><td className="p-2">{pct(r.orders, r.conversations)}</td><td className="p-2">{n(r.delivered)}</td><td className="p-2">{money(r.delivered_value)}</td>
          </tr>))}
          {d && !ads.length && <tr><td colSpan={adHead.length} className="p-4 text-center text-muted-foreground">لا محادثات من إعلانات في هذه الفترة</td></tr>}
        </tbody></table></div></CardContent></Card>
  </>);
}
