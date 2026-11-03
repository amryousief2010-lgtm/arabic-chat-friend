import { classifyPayrollProduct } from "@/lib/payrollProductCategories";
import { matchesModeratorGroup, moderatorsForMonth } from "@/constants/moderators";

export interface KgOrder { id: string; moderator: string | null; created_by: string | null; status: string | null }
export interface KgItem { order_id: string; product_name: string | null; quantity: number | null }
export interface KgBucket { orders: number; meat: number; bone: number; processed: number }
export interface TodayKgResult { total: KgBucket; perGirl: Array<{ key: string; name: string } & KgBucket>; unassigned: KgBucket }

const empty = (): KgBucket => ({ orders: 0, meat: 0, bone: 0, processed: 0 });

/**
 * كميات اليوم (كجم) حسب تصنيف القبض نفسه (classifyPayrollProduct) — الكمية = order_items.quantity.
 * الأوردرات الملغاة (status = cancelled) مستبعدة. البنت تُحدَّد من orders.moderator أو اسم منشئ الأوردر (نفس منطق القبض).
 */
export function computeTodayKg(
  orders: KgOrder[], items: KgItem[], creatorNames: Map<string, string>, girls: Array<{ key: string; name: string }>,
): TodayKgResult {
  const live = orders.filter((o) => o.status !== "cancelled");
  const total = empty(); const unassigned = empty();
  const per = new Map(girls.map((g) => [g.key, { ...g, ...empty() }]));
  const orderGirl = new Map<string, string | null>();
  for (const o of live) {
    const creator = o.created_by ? creatorNames.get(o.created_by) || "" : "";
    const g = girls.find((x) => matchesModeratorGroup(o.moderator || "", x.key) || matchesModeratorGroup(creator, x.key));
    orderGirl.set(o.id, g?.key ?? null);
    total.orders += 1;
    if (g) per.get(g.key)!.orders += 1; else unassigned.orders += 1;
  }
  for (const it of items) {
    if (!orderGirl.has(it.order_id)) continue;
    const cat = classifyPayrollProduct(it.product_name || "");
    if (!cat) continue;
    const q = Number(it.quantity) || 0;
    const k = orderGirl.get(it.order_id);
    const b = k ? per.get(k)! : unassigned;
    total[cat] += q; b[cat] += q;
  }
  return { total, perGirl: Array.from(per.values()), unassigned };
}

export const girlsForToday = (now = new Date()) => {
  const [y, m] = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit" })
    .format(now).split("-").map(Number);
  return moderatorsForMonth(y, m).map((x) => ({ key: x.payrollKey, name: x.displayName }));
};
