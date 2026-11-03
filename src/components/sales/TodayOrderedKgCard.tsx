import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { cairoTodayStartUTC, toCairoDateString } from "@/lib/cairoDate";
import { computeTodayKg, girlsForToday, type KgItem, type KgOrder } from "@/lib/todayOrderedKg";

const kg = (v: number) => `${(Math.round(v * 100) / 100).toLocaleString("en-US")} كجم`;

async function fetchTodayKg() {
  const start = cairoTodayStartUTC();
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const orders: KgOrder[] = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await supabase.from("orders").select("id, moderator, created_by, status")
      .gte("created_at", start.toISOString()).lt("created_at", end.toISOString()).neq("status", "cancelled")
      .order("created_at").range(i, i + 999);
    if (error) throw error;
    orders.push(...((data as KgOrder[]) ?? []));
    if (!data || data.length < 1000) break;
  }
  const ids = orders.map((o) => o.id);
  const items: KgItem[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    for (let f = 0; ; f += 1000) {
      const { data, error } = await supabase.from("order_items").select("order_id, product_name, quantity")
        .in("order_id", chunk).range(f, f + 999);
      if (error) throw error;
      items.push(...((data as KgItem[]) ?? []));
      if (!data || data.length < 1000) break;
    }
  }
  const creators = Array.from(new Set(orders.map((o) => o.created_by).filter(Boolean))) as string[];
  const names = new Map<string, string>();
  if (creators.length) {
    const { data } = await supabase.from("profile_directory").select("id, full_name").in("id", creators);
    (data ?? []).forEach((p: any) => names.set(p.id, p.full_name || ""));
  }
  return computeTodayKg(orders, items, names, girlsForToday());
}

/** «طلبات اليوم بالكيلو»: لحوم / لحم بالعظم / مصنعات لكل العملاء ولكل بنت — يوم القاهرة، بدون الملغي، بدون بيانات عملاء. */
export default function TodayOrderedKgCard() {
  const q = useQuery({ queryKey: ["today-ordered-kg", toCairoDateString(new Date())], queryFn: fetchTodayKg, refetchInterval: 120000 });
  const d = q.data;
  return (
    <Card dir="rtl" data-testid="today-ordered-kg">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">كميات طلبات اليوم بالكيلو ({toCairoDateString(new Date())})</CardTitle>
        <CardDescription className="text-xs leading-relaxed">
          اليوم = يوم القاهرة من 12:00 ص حتى الآن، حسب تاريخ تسجيل الأوردر. الأوردرات الملغاة مستبعدة (باقي الحالات محسوبة).
          الكمية = كمية الصنف في الأوردر بالكيلو. التصنيف بنفس قواعد القبض: «لحوم» = قطع/استيك/موزة/فراشة/قطعية/تربيانكو/اسكالوب/رول/كباب،
          «لحم بالعظم» = دبوس بالعظم/فخدة/نعامة صندوق، «مصنعات» = شاورما/شيش/كفتة/سجق/برجر/طرب/حواوشي/مفروم. باقي الأصناف لا تدخل في الكيلوهات.
          البنت = الموديريتور المسجَّلة على الأوردر أو منشئته.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {q.isLoading && <p className="text-sm text-muted-foreground">جارٍ التحميل…</p>}
        {q.error && <p className="text-sm text-destructive">تعذّر تحميل كميات اليوم.</p>}
        {d && <>
          <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
            {[["أوردرات اليوم", String(d.total.orders)], ["لحوم", kg(d.total.meat)], ["لحم بالعظم", kg(d.total.bone)], ["مصنعات", kg(d.total.processed)]].map(([l, v]) => (
              <div key={l} className="rounded border p-2"><div className="text-xs text-muted-foreground">{l}</div><div className="text-lg font-bold">{v}</div></div>))}
          </div>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="bg-muted"><tr>{["البنت", "أوردرات اليوم", "لحوم", "لحم بالعظم", "مصنعات"].map((h) => <th key={h} className="p-2 text-right whitespace-nowrap">{h}</th>)}</tr></thead>
            <tbody>
              {d.perGirl.map((g) => (
                <tr key={g.key} className="border-t"><td className="p-2 font-medium">{g.name}</td><td className="p-2">{g.orders}</td>
                  <td className="p-2">{kg(g.meat)}</td><td className="p-2">{kg(g.bone)}</td><td className="p-2">{kg(g.processed)}</td></tr>))}
              {d.unassigned.orders > 0 && (
                <tr className="border-t text-muted-foreground"><td className="p-2">غير منسوب لبنت</td><td className="p-2">{d.unassigned.orders}</td>
                  <td className="p-2">{kg(d.unassigned.meat)}</td><td className="p-2">{kg(d.unassigned.bone)}</td><td className="p-2">{kg(d.unassigned.processed)}</td></tr>)}
            </tbody></table></div>
        </>}
      </CardContent>
    </Card>
  );
}
