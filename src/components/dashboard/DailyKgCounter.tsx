import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { cairoTodayStartUTC, toCairoDateString } from "@/lib/cairoDate";
import { canSeeDailyKgCounter, compareWithYesterday, totalKg } from "@/lib/todayOrderedKg";
import { fetchKgWindow, fetchTodayKg } from "@/components/sales/TodayOrderedKgCard";

const DAY = 24 * 60 * 60 * 1000;
const kg = (v: number) => `${(Math.round(v * 100) / 100).toLocaleString("en-US")} كجم`;

async function fetchCounter() {
  const now = new Date();
  const start = cairoTodayStartUTC();
  const [today, yesterday] = await Promise.all([
    fetchTodayKg(),
    fetchKgWindow(new Date(start.getTime() - DAY), new Date(now.getTime() - DAY)),
  ]);
  return { today, yesterday };
}

/** عداد الكيلوهات اليومي أعلى لوحة التحكم — نفس منطق كارت «كميات طلبات اليوم بالكيلو». */
export default function DailyKgCounter() {
  const { roles } = useAuth();
  const visible = canSeeDailyKgCounter(roles as string[]);
  const q = useQuery({
    queryKey: ["dashboard-daily-kg", toCairoDateString(new Date())],
    queryFn: fetchCounter, enabled: visible, refetchInterval: 120000,
  });
  if (!visible) return null;
  const d = q.data;
  const t = d ? totalKg(d.today.total) : 0;
  const c = d ? compareWithYesterday(t, totalKg(d.yesterday.total)) : null;
  const Arrow = c?.dir === "up" ? ArrowUp : c?.dir === "down" ? ArrowDown : Minus;
  return (
    <Card dir="rtl" className="mb-6" data-testid="dashboard-daily-kg">
      <CardContent className="pt-4">
        <div className="mb-2 text-sm font-semibold">عداد الكيلوهات اليومي ({toCairoDateString(new Date())})</div>
        {q.isLoading && <p className="text-sm text-muted-foreground">جارٍ التحميل…</p>}
        {q.error && <p className="text-sm text-destructive">تعذّر تحميل كيلوهات اليوم.</p>}
        {d && c && <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="rounded-lg border bg-primary/5 p-3">
              <div className="text-xs text-muted-foreground">إجمالي كيلوهات اليوم</div>
              <div className="text-2xl font-bold">{kg(t)}</div>
              <div className={`mt-1 flex items-center gap-1 text-xs ${c.dir === "up" ? "text-green-600" : c.dir === "down" ? "text-red-600" : "text-muted-foreground"}`}>
                <Arrow className="h-3 w-3" />
                {c.dir === "same" ? "مثل" : `${c.diff > 0 ? "+" : ""}${kg(c.diff)}${c.pct !== null ? ` (${c.pct}%)` : ""} عن`} نفس الوقت أمس
              </div>
              <div className="text-xs text-muted-foreground">{d.today.total.orders} أوردر</div>
            </div>
            {([["لحوم", d.today.total.meat], ["لحم بالعظم", d.today.total.bone], ["مصنعات", d.today.total.processed]] as const).map(([l, v]) => (
              <div key={l} className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">{l}</div>
                <div className="text-2xl font-bold">{kg(v)}</div>
              </div>))}
          </div>
          <div className="mt-3 overflow-x-auto"><table className="w-full text-xs">
            <thead className="bg-muted"><tr>{["البنت", "أوردرات", "لحوم", "لحم بالعظم", "مصنعات", "الإجمالي"].map((h) => <th key={h} className="p-1.5 text-right">{h}</th>)}</tr></thead>
            <tbody>
              {[...d.today.perGirl.map((g) => ({ ...g, muted: false })),
                ...(d.today.unassigned.orders > 0 ? [{ key: "_u", name: "غير منسوب لبنت", ...d.today.unassigned, muted: true }] : [])]
                .map((g) => (
                <tr key={g.key} className={`border-t ${g.muted ? "text-muted-foreground" : ""}`}>
                  <td className="p-1.5 font-medium">{g.name}</td><td className="p-1.5">{g.orders}</td>
                  <td className="p-1.5">{kg(g.meat)}</td><td className="p-1.5">{kg(g.bone)}</td>
                  <td className="p-1.5">{kg(g.processed)}</td><td className="p-1.5 font-semibold">{kg(totalKg(g))}</td>
                </tr>))}
            </tbody></table></div>
          <p className="mt-2 text-[11px] text-muted-foreground">الأوردرات الملغاة مستبعدة. يتحدث كل دقيقتين. لا يوجد هدف يومي بالكيلو في «خطة الشهر» (الهدف اليومي هناك بالجنيه) لذلك لا يظهر شريط تقدم.</p>
        </>}
      </CardContent>
    </Card>
  );
}
