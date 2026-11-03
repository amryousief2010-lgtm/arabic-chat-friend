import type { GiftLine } from "@/lib/todayOrderedKg";

const num = (v: number) => (Math.round(v * 100) / 100).toLocaleString("en-US");

/** خانة «الهدايا»: كل صنف عليه هدايا كم (بنود is_gift، الأوردرات غير الملغاة، نفس نافذة العداد). */
export default function GiftsBox({ gifts, testId }: { gifts: GiftLine[]; testId?: string }) {
  const kgTotal = gifts.filter((g) => !g.unit || g.unit.includes("كيلو") || g.unit.includes("كجم")).reduce((s, g) => s + g.quantity, 0);
  return (
    <div className="mt-3 rounded-lg border border-amber-300/60 bg-amber-50/40 p-3 dark:bg-amber-950/10" data-testid={testId}>
      <div className="mb-1 text-xs font-semibold">🎁 الهدايا</div>
      {gifts.length === 0 ? <p className="text-xs text-muted-foreground">لا توجد هدايا.</p> : (
        <div className="-mx-1 overflow-x-auto px-1"><table className="w-full whitespace-nowrap text-[11px] sm:text-xs">
          <thead className="bg-muted"><tr>{["الصنف", "كمية الهدايا", "عدد البنود"].map((h) => <th key={h} className="p-1 text-right">{h}</th>)}</tr></thead>
          <tbody>
            {gifts.map((g) => (
              <tr key={g.name} className="border-t">
                <td className="p-1 font-medium">{g.name}</td>
                <td className="p-1">{num(g.quantity)} {g.unit || "كجم"}</td>
                <td className="p-1">{g.lines}</td>
              </tr>))}
            <tr className="border-t font-semibold"><td className="p-1">الإجمالي</td>
              <td className="p-1">{num(kgTotal)} كجم{gifts.some((g) => g.unit && !(g.unit.includes("كيلو") || g.unit.includes("كجم"))) ? " + أصناف بوحدات أخرى" : ""}</td>
              <td className="p-1">{gifts.reduce((s, g) => s + g.lines, 0)}</td></tr>
          </tbody></table></div>)}
      <p className="mt-1 text-[10px] text-muted-foreground">الهدايا المصنّفة (لحوم/بالعظم/مصنعات) محسوبة بالفعل داخل الإجمالي والكروت أعلاه كما كانت؛ هذه الخانة للعرض فقط ولا تُضاف مرة ثانية.</p>
    </div>
  );
}
