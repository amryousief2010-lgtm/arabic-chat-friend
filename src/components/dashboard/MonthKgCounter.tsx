import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { cairoWallClockToUTC } from "@/lib/cairoDate";
import { arabicMonthName, cairoYMD, canSeeDailyKgCounter, comparePeriods, totalKg } from "@/lib/todayOrderedKg";
import { fetchKgWindow } from "@/components/sales/TodayOrderedKgCard";
import GiftsBox from "@/components/dashboard/GiftsBox";
import { KG_POLL_MS } from "@/hooks/useKgLiveRefresh";

const kg = (v: number) => `${(Math.round(v * 100) / 100).toLocaleString("en-US")} كجم`;

/** نافذة الشهر حتى الآن + نفس الفترة (الأيام 1..N وحتى نفس الساعة) من الشهر السابق. */
export function monthToDateWindows(now = new Date()) {
  const { y, m, d } = cairoYMD(now);
  const start = cairoWallClockToUTC(y, m - 1, 1);
  const elapsed = now.getTime() - cairoWallClockToUTC(y, m - 1, d).getTime();
  const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
  const prevDays = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  const prevStart = cairoWallClockToUTC(py, pm - 1, 1);
  const prevEnd = new Date(cairoWallClockToUTC(py, pm - 1, Math.min(d, prevDays)).getTime() + elapsed);
  return { y, m, d, start, end: now, prevStart, prevEnd: d > prevDays ? cairoWallClockToUTC(y, m - 1, 1) : prevEnd };
}

async function fetchMonth() {
  const w = monthToDateWindows();
  const [cur, prev] = await Promise.all([fetchKgWindow(w.start, w.end), fetchKgWindow(w.prevStart, w.prevEnd)]);
  return { w, cur, prev };
}

export default function MonthKgCounter() {
  const { roles } = useAuth();
  const visible = canSeeDailyKgCounter(roles as string[]);
  const { y, m } = cairoYMD();
  const q = useQuery({ queryKey: ["dashboard-month-kg", `${y}-${m}`], queryFn: fetchMonth, enabled: visible,
    refetchInterval: KG_POLL_MS, refetchOnWindowFocus: true });
  if (!visible) return null;
  const d = q.data;
  const t = d ? totalKg(d.cur.total) : 0;
  const c = d ? comparePeriods(t, totalKg(d.prev.total)) : null;
  const Arrow = c?.dir === "up" ? ArrowUp : c?.dir === "down" ? ArrowDown : Minus;
  return (
    <Card dir="rtl" className="mb-6" data-testid="dashboard-month-kg">
      <CardContent className="pt-4">
        <div className="mb-2 text-sm font-semibold">عداد كيلوهات شهر {arabicMonthName(m)} {y}</div>
        {q.isLoading && <p className="text-sm text-muted-foreground">جارٍ التحميل…</p>}
        {q.error && <p className="text-sm text-destructive">تعذّر تحميل كيلوهات الشهر.</p>}
        {d && c && <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <div className="rounded-lg border bg-primary/5 p-3">
              <div className="text-xs text-muted-foreground">كيلوهات الشهر حتى اليوم</div>
              <div className="text-2xl font-bold">{kg(t)}</div>
              <div className={`mt-1 flex items-center gap-1 text-xs ${c.dir === "up" ? "text-green-600" : c.dir === "down" ? "text-red-600" : "text-muted-foreground"}`}>
                <Arrow className="h-3 w-3 shrink-0" />
                <span>{c.dir === "same" ? "مثل" : `${c.diff > 0 ? "+" : ""}${kg(c.diff)}${c.pct !== null ? ` (${c.pct}%)` : ""} عن`} نفس الفترة من الشهر السابق</span>
              </div>
              <div className="text-xs text-muted-foreground">{d.cur.total.orders} أوردر</div>
            </div>
            {([["لحوم", d.cur.total.meat], ["لحم بالعظم", d.cur.total.bone], ["مصنعات", d.cur.total.processed], ["هدايا أخرى", d.cur.total.gifts]] as const).map(([l, v]) => (
              <div key={l} className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">{l}</div>
                <div className="text-2xl font-bold">{kg(v)}</div>
              </div>))}
          </div>
          <GiftsBox gifts={d.cur.gifts} testId="dashboard-month-gifts" />
          <div className="-mx-2 mt-3 overflow-x-auto px-2"><table className="w-full min-w-[520px] whitespace-nowrap text-[11px] sm:text-xs">
            <thead className="bg-muted"><tr>{["البنت", "أوردرات", "لحوم", "لحم بالعظم", "مصنعات", "هدايا", "الإجمالي"].map((h) => <th key={h} className="p-1 text-right sm:p-1.5">{h}</th>)}</tr></thead>
            <tbody>
              {[...d.cur.perGirl.map((g) => ({ ...g, muted: false })),
                ...(d.cur.unassigned.orders > 0 ? [{ key: "_u", name: "غير منسوب لبنت", ...d.cur.unassigned, muted: true }] : [])]
                .map((g) => (
                <tr key={g.key} className={`border-t ${g.muted ? "text-muted-foreground" : ""}`}>
                  <td className="p-1.5 font-medium">{g.name}</td><td className="p-1.5">{g.orders}</td>
                  <td className="p-1.5">{kg(g.meat)}</td><td className="p-1.5">{kg(g.bone)}</td>
                  <td className="p-1.5">{kg(g.processed)}</td><td className="p-1.5">{kg(g.gifts)}</td><td className="p-1.5 font-semibold">{kg(totalKg(g))}</td>
                </tr>))}
            </tbody></table></div>
          <p className="mt-2 text-[11px] text-muted-foreground">من أول الشهر (12:00 ص القاهرة) حتى الآن، والمقارنة بالأيام 1..{d.w.d} من الشهر السابق حتى نفس الساعة. الأوردرات الملغاة مستبعدة. يتحدث تلقائيًا مع تسجيل كل أوردر.</p>
        </>}
      </CardContent>
    </Card>
  );
}
