import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { formatMoney, formatPct } from "@/lib/chatManagement/kpiMetrics";

const db = supabase as any;
interface ModRow { moderator_id: string; display_name: string; conversations: number; on_time: number; cover: number; late: number; pending: number;
  abandoned: number; converted: number; missed_calls: number; missed_followed: number; orders: number; delivered: number; resolved: number;
  delivered_value: number; campaign_delivered: number; allocated_spend: number; cost_per_delivered: number | null }
interface CampRow { campaign_id: string; campaign_name: string | null; spend: number; conversations: number; converted: number; orders: number;
  delivered: number; resolved: number; delivered_value: number; cost_per_delivered: number | null }

const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };
const sum = <T,>(l: T[], k: keyof T) => l.reduce((a, r) => a + Number(r[k] ?? 0), 0);

/** «مؤشرات الأداء»: تُحسب لحظياً من قاعدة البيانات (الإلغاء بأثر رجعي ينعكس فوراً). */
export default function ChatKpis() {
  const [from, setFrom] = useState(daysAgo(6));
  const [to, setTo] = useState(iso(new Date()));
  const [mods, setMods] = useState<ModRow[]>([]);
  const [camps, setCamps] = useState<CampRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (from > to) { toast.error("تاريخ البداية بعد النهاية"); return; }
    setLoading(true);
    const [m, c] = await Promise.all([
      db.rpc("cm_kpi_by_moderator", { _from: from, _to: to }),
      db.rpc("cm_kpi_by_campaign", { _from: from, _to: to }),
    ]);
    if (m.error || c.error) toast.error(`تعذّر تحميل المؤشرات: ${(m.error ?? c.error).message}`);
    setMods(m.data ?? []); setCamps(c.data ?? []); setLoading(false);
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  const conv = sum(mods, "conversations");
  const tiles = [
    { label: "أول رد في الوقت", value: formatPct(sum(mods, "on_time"), conv) },
    { label: "تغطية", value: formatPct(sum(mods, "cover"), conv) },
    { label: "متأخر", value: formatPct(sum(mods, "late"), conv) },
    { label: "متروكة", value: String(sum(mods, "abandoned")) },
    { label: "متابعة المكالمات الفائتة خلال ساعة", value: formatPct(sum(mods, "missed_followed"), sum(mods, "missed_calls")) },
    { label: "تحويل محادثة ← طلب (7 أيام)", value: formatPct(sum(mods, "converted"), conv) },
    { label: "نسبة التسليم", value: formatPct(sum(mods, "delivered"), sum(mods, "resolved")) },
    { label: "تكلفة الطلب المُسلَّم", value: formatMoney(sum(camps, "delivered") ? Math.round((sum(camps, "spend") / sum(camps, "delivered")) * 100) / 100 : null) },
  ];

  return (
    <DashboardLayout>
      <div dir="rtl" className="space-y-4">
        <Header title="مؤشرات الأداء" subtitle="محسوبة لحظياً من المحادثات والمكالمات والطلبات والإنفاق — بتوقيت القاهرة" />
        <Card><CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <label className="text-sm">من<Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-44" /></label>
          <label className="text-sm">إلى<Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-44" /></label>
          {[["اليوم", 0], ["7 أيام", 6], ["30 يوم", 29]].map(([l, n]) => (
            <Button key={l as string} variant="outline" size="sm" onClick={() => { setFrom(daysAgo(n as number)); setTo(iso(new Date())); }}>{l}</Button>))}
          <span className="text-xs text-muted-foreground">{loading ? "جارٍ التحميل…" : ""}</span>
        </CardContent></Card>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {tiles.map((t) => (
            <Card key={t.label} className="border-[#A4288A]/20"><CardContent className="pt-4">
              <div className="text-xs text-muted-foreground">{t.label}</div><div className="text-2xl font-bold text-[#662D8C]">{t.value}</div>
            </CardContent></Card>))}
        </div>

        <Card><CardHeader><CardTitle>حسب المودريتور</CardTitle>
          <CardDescription>تكلفة المودريتور = إنفاق كل حملة موزَّع بنسبة محادثاتها منها ÷ طلباتها المُسلَّمة من الحملات</CardDescription></CardHeader>
          <CardContent className="overflow-auto"><table className="w-full text-sm">
            <thead className="bg-muted"><tr>{["المودريتور","محادثات","في الوقت","تغطية","متأخر","متروكة","مكالمات فائتة","متابعة ≤ ساعة","تحويل","طلبات","مُسلَّم","نسبة التسليم","صافي المُسلَّم","إنفاق موزَّع","تكلفة المُسلَّم"].map((h) => <th key={h} className="p-2 text-right whitespace-nowrap">{h}</th>)}</tr></thead>
            <tbody>{mods.map((r) => (
              <tr key={r.moderator_id} className="border-t">
                <td className="p-2 font-medium">{r.display_name}</td><td className="p-2">{r.conversations}</td>
                <td className="p-2">{r.on_time}</td><td className="p-2">{r.cover}</td><td className="p-2 text-[#F37346]">{r.late}</td>
                <td className="p-2">{r.abandoned}</td><td className="p-2">{r.missed_calls}</td><td className="p-2">{formatPct(r.missed_followed, r.missed_calls)}</td>
                <td className="p-2">{formatPct(r.converted, r.conversations)}</td><td className="p-2">{r.orders}</td><td className="p-2">{r.delivered}</td>
                <td className="p-2">{formatPct(r.delivered, r.resolved)}</td><td className="p-2">{formatMoney(r.delivered_value)}</td>
                <td className="p-2">{formatMoney(r.allocated_spend)}</td><td className="p-2">{formatMoney(r.cost_per_delivered)}</td>
              </tr>))}
              {!mods.length && !loading && <tr><td colSpan={15} className="p-4 text-center text-muted-foreground">لا بيانات في هذه الفترة</td></tr>}
            </tbody></table></CardContent></Card>

        <Card><CardHeader><CardTitle>حسب الحملة</CardTitle><CardDescription>تكلفة الطلب المُسلَّم = الإنفاق ÷ صافي المُسلَّم</CardDescription></CardHeader>
          <CardContent className="overflow-auto"><table className="w-full text-sm">
            <thead className="bg-muted"><tr>{["الحملة","الإنفاق","محادثات","تحويل","طلبات","مُسلَّم","نسبة التسليم","صافي المُسلَّم","تكلفة المُسلَّم"].map((h) => <th key={h} className="p-2 text-right">{h}</th>)}</tr></thead>
            <tbody>{camps.map((r) => (
              <tr key={r.campaign_id} className="border-t">
                <td className="p-2 font-medium">{r.campaign_name ?? "—"}</td><td className="p-2">{formatMoney(r.spend)}</td><td className="p-2">{r.conversations}</td>
                <td className="p-2">{formatPct(r.converted, r.conversations)}</td><td className="p-2">{r.orders}</td><td className="p-2">{r.delivered}</td>
                <td className="p-2">{formatPct(r.delivered, r.resolved)}</td><td className="p-2">{formatMoney(r.delivered_value)}</td>
                <td className="p-2 font-semibold text-[#A4288A]">{formatMoney(r.cost_per_delivered)}</td>
              </tr>))}
              {!camps.length && !loading && <tr><td colSpan={9} className="p-4 text-center text-muted-foreground">لا بيانات في هذه الفترة</td></tr>}
            </tbody></table></CardContent></Card>
      </div>
    </DashboardLayout>
  );
}
