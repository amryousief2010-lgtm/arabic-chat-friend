import { classifyPayrollProduct } from "@/lib/payrollProductCategories";
import { findModeratorByName, matchesModeratorGroup, moderatorsForMonth } from "@/constants/moderators";

export interface KgOrder { id: string; moderator: string | null; created_by: string | null; status: string | null }
export interface KgItem { order_id: string; product_name: string | null; quantity: number | null; is_gift?: boolean | null; product_id?: string | null }
export interface GiftLine { name: string; quantity: number; unit: string | null; lines: number }
export interface KgBucket { orders: number; meat: number; bone: number; processed: number }
export interface TodayKgResult { total: KgBucket; perGirl: Array<{ key: string; name: string } & KgBucket>; unassigned: KgBucket; gifts: GiftLine[] }

const empty = (): KgBucket => ({ orders: 0, meat: 0, bone: 0, processed: 0 });

/**
 * كميات اليوم (كجم) حسب تصنيف القبض نفسه (classifyPayrollProduct) — الكمية = order_items.quantity.
 * الأوردرات الملغاة (status = cancelled) مستبعدة. البنت تُحدَّد من orders.moderator أو اسم منشئ الأوردر (نفس منطق القبض).
 */
export function computeTodayKg(
  orders: KgOrder[], items: KgItem[], creatorNames: Map<string, string>, girls: Array<{ key: string; name: string }>,
  productUnits: Map<string, string> = new Map(),
): TodayKgResult {
  const live = orders.filter((o) => o.status !== "cancelled");
  const total = empty(); const unassigned = empty();
  const per = new Map(girls.map((g) => [g.key, { ...g, ...empty() }]));
  const orderGirl = new Map<string, string | null>();
  for (const o of live) {
    const creator = o.created_by ? creatorNames.get(o.created_by) || "" : "";
    let g: { key: string; name: string } | undefined =
      girls.find((x) => matchesModeratorGroup(o.moderator || "", x.key) || matchesModeratorGroup(creator, x.key));
    if (!g) {
      // عرض فقط: بنت خارج قائمة القبض للشهر (مثل مريم بعد endDate أو فاطمة) تظهر بصف باسمها
      // بدل «غير منسوب لبنت». لا يغيّر قوائم القبض.
      const m = findModeratorByName(o.moderator) || (!(o.moderator || "").trim() ? findModeratorByName(creator) : undefined);
      if (m) {
        g = { key: m.payrollKey, name: m.displayName };
        if (!per.has(g.key)) per.set(g.key, { ...g, ...empty() });
      }
    }
    orderGirl.set(o.id, g?.key ?? null);
    total.orders += 1;
    if (g) per.get(g.key)!.orders += 1; else unassigned.orders += 1;
  }
  const gifts = new Map<string, GiftLine>();
  for (const it of items) {
    if (!orderGirl.has(it.order_id)) continue;
    if (it.is_gift) {
      const name = (it.product_name || "").trim().replace(/\s+/g, " ") || "غير محدد";
      const gl = gifts.get(name) ?? { name, quantity: 0, unit: (it.product_id && productUnits.get(it.product_id)) || null, lines: 0 };
      gl.quantity += Number(it.quantity) || 0; gl.lines += 1; gifts.set(name, gl);
    }
    const cat = classifyPayrollProduct(it.product_name || "");
    if (!cat) continue;
    const q = Number(it.quantity) || 0;
    const k = orderGirl.get(it.order_id);
    const b = k ? per.get(k)! : unassigned;
    total[cat] += q; b[cat] += q;
  }
  return { total, perGirl: Array.from(per.values()), unassigned,
    gifts: Array.from(gifts.values()).sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name)) };
}

export const girlsForToday = (now = new Date()) => {
  const [y, m] = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit" })
    .format(now).split("-").map(Number);
  return moderatorsForMonth(y, m).map((x) => ({ key: x.payrollKey, name: x.displayName }));
};

/** إجمالي الكيلوهات = لحوم + لحم بالعظم + مصنعات (كل فئة محسوبة مرة واحدة؛ العظم ليس داخل اللحوم). */
export const totalKg = (b: KgBucket) => b.meat + b.bone + b.processed;

/**
 * الأدوار التي ترى عداد الكيلوهات اليومي في لوحة التحكم: كل دور يقرأ كل الأوردرات
 * وبنودها عبر RLS في coceg-prod (حتى لا تظهر أرقام ناقصة). أدوار تفتح اللوحة بدون
 * قراءة الأوردرات (financial_manager, production_manager, quality_manager…) لا تراه.
 */
export const DAILY_KG_COUNTER_ROLES: readonly string[] = [
  "general_manager", "executive_manager", "sales_manager", "marketing_sales_manager",
  "accountant", "warehouse_supervisor", "marketing_sales_viewer", "social_media_manager",
];
export const canSeeDailyKgCounter = (roles: readonly string[] | null | undefined) =>
  !!roles?.some((r) => DAILY_KG_COUNTER_ROLES.includes(r));

/** مقارنة اليوم بنفس الوقت أمس. pct = null لو أمس صفر. */
export function compareWithYesterday(today: number, yesterday: number) {
  const diff = Math.round((today - yesterday) * 100) / 100;
  const dir: "up" | "down" | "same" = diff > 0 ? "up" : diff < 0 ? "down" : "same";
  const pct = yesterday > 0 ? Math.round((diff / yesterday) * 1000) / 10 : null;
  return { diff, dir, pct };
}

/** مقارنة عامة بين فترتين (اسم عام لـ compareWithYesterday). */
export const comparePeriods = compareWithYesterday;

const AR_MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
/** سنة/شهر/يوم القاهرة للحظة معينة. */
export function cairoYMD(now = new Date()) {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(now).filter((p) => p.type !== "literal").map((p) => Number(p.value));
  return { y, m, d };
}
export const arabicMonthName = (m: number) => AR_MONTHS[m - 1];
