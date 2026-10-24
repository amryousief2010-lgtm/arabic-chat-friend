// مطابقة مصروفات الخزنة الرئيسية مع فواتير شراء مصنع اللحوم لمنع تسجيل نفس الشراء مرتين.
export const MATCH_AMOUNT_TOLERANCE = 50; // ج.م
export const MATCH_DAYS_TOLERANCE = 3;

export interface MatchCandidate {
  id: string;
  label: string; // رقم الحركة أو رقم الفاتورة
  amount: number;
  date: string; // YYYY-MM-DD
}

function dayDiff(a: string, b: string): number {
  const da = Date.parse(a.slice(0, 10) + "T00:00:00Z");
  const db = Date.parse(b.slice(0, 10) + "T00:00:00Z");
  return Math.abs(da - db) / 86400000;
}

/** يرجّع المرشحين اللي مبلغهم ±50 ج وتاريخهم ±3 أيام، الأقرب أولاً. */
export function findAmountDateMatches(
  amount: number,
  date: string,
  candidates: MatchCandidate[],
  amountTol = MATCH_AMOUNT_TOLERANCE,
  daysTol = MATCH_DAYS_TOLERANCE,
): MatchCandidate[] {
  if (!(amount > 0) || !date) return [];
  return candidates
    .filter((c) => Math.abs(Number(c.amount) - amount) <= amountTol && dayDiff(c.date, date) <= daysTol)
    .sort((x, y) => Math.abs(x.amount - amount) - Math.abs(y.amount - amount) || dayDiff(x.date, date) - dayDiff(y.date, date));
}

/** نطاق التواريخ للاستعلام من القاعدة. */
export function matchDateRange(date: string, daysTol = MATCH_DAYS_TOLERANCE): { from: string; to: string } {
  const d = Date.parse(date.slice(0, 10) + "T00:00:00Z");
  const f = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { from: f(d - daysTol * 86400000), to: f(d + daysTol * 86400000) };
}

export function formatMatchWarning(kind: "invoice" | "expense", matches: MatchCandidate[]): string {
  const what = kind === "invoice" ? "فاتورة شراء مصنع" : "مصروف خزنة رئيسية";
  const list = matches.slice(0, 3).map((m) => `${m.label} (${m.amount.toLocaleString("en-US")} ج، ${m.date})`).join("، ");
  return `تنبيه: فيه ${what} بنفس المبلغ تقريبًا وفي نفس الأيام: ${list}. اتأكد إن الشراء ده مش متسجل مرتين.`;
}
