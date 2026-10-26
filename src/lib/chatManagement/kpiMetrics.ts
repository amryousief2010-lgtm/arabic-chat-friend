// مؤشرات الأداء — منطق نقي يطابق views الخطوة 4 في قاعدة البيانات (cm_kpi_*_v و cm_kpi_by_*).
// قاعدة البيانات هي المرجع؛ هذا الملف للعرض/الاختبار ولضمان نفس التعريفات في الواجهة.
import { DEFAULT_KPI_SETTINGS, KpiSettings, serviceMinutesBetween } from "./responseClock";

export type KpiFirstReply = "pending" | "on_time" | "cover" | "late";

// حالات الطلب (من المستودع: orderSalesFilters.ts + migrations). المرتجعات تُخزَّن cancelled.
export const DELIVERED_STATUSES = ["delivered", "collected", "completed"] as const;
/** partially_returned / fully_returned: محسومة وغير مُسلَّمة (غير مُتحقَّق منها على البيانات الحية). */
export const RESOLVED_NOT_DELIVERED_STATUSES = ["cancelled", "partially_returned", "fully_returned"] as const;
const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
export const isDelivered = (s: string | null | undefined) => (DELIVERED_STATUSES as readonly string[]).includes(norm(s));
export const isCancelled = (s: string | null | undefined) => norm(s) === "cancelled";
export const isResolved = (s: string | null | undefined) =>
  isDelivered(s) || (RESOLVED_NOT_DELIVERED_STATUSES as readonly string[]).includes(norm(s));

/** مثل cm_first_reply_kpi_status: تغطية ← في الوقت (≤ الهدف) ← متأخر؛ بلا رد ولم يتجاوز = بانتظار. */
export const kpiFirstReplyStatus = (a: {
  clockStartedAt: Date | null; firstReplyAt: Date | null; wasCover: boolean; targetMinutes: number; now: Date; settings?: KpiSettings;
}): KpiFirstReply | null => {
  if (!a.clockStartedAt) return null;
  if (a.firstReplyAt && a.wasCover) return "cover";
  const el = serviceMinutesBetween(a.clockStartedAt, a.firstReplyAt ?? a.now, a.settings ?? DEFAULT_KPI_SETTINGS);
  if (el <= a.targetMinutes) return a.firstReplyAt ? "on_time" : "pending";
  return "late";
};

/** متابعة المكالمة الفائتة (مثل cm_kpi_missed_calls_v): أبكر (تعليم يدوي، أول مكالمة صادرة لنفس الرقم بعدها، أول رسالة صادرة بعدها) ≤ الحد. */
export const missedCallFollowedUp = (missedAt: Date, f: { manualAt?: Date | null; callbacks?: Date[]; messages?: Date[] }, limitMinutes = 60): boolean => {
  const after = (l: Date[] = []) => l.filter((d) => d > missedAt).sort((x, y) => +x - +y)[0];
  const c = [f.manualAt ?? undefined, after(f.callbacks), after(f.messages)].filter((d): d is Date => !!d);
  if (!c.length) return false;
  return Math.min(...c.map(Number)) <= +missedAt + limitMinutes * 60_000;
};

/** تحويل خلال النافذة: طلب مربوط صراحة، غير ملغي، أنشئ بين أول رسالة و +N يوم. */
export const convertedInWindow = (firstInbound: Date, linkedOrders: { created_at: Date; status: string }[], days = 7) =>
  linkedOrders.some((o) => !isCancelled(o.status) && o.created_at >= firstInbound && +o.created_at < +firstInbound + days * 86_400_000);

export interface KpiConv { moderator_id: string | null; campaign_id: string | null; first_reply: KpiFirstReply | null; abandoned: boolean; converted: boolean }
export interface KpiOrder { moderator_id: string | null; campaign_id: string | null; status: string; total: number; total_at_delivery?: number | null }
export interface KpiSpend { campaign_id: string; spend: number }

const round2 = (n: number) => Math.round(n * 100) / 100;
/** قيمة المُسلَّم = إجمالي الطلب (قرار عمرو 26-10)، ولا يُستخدم total_at_delivery. */
export const deliveredValue = (o: KpiOrder) => (isDelivered(o.status) ? o.total : 0);
export const ratio = (num: number, den: number): number | null => (den > 0 ? num / den : null);

export interface CampaignKpi { campaign_id: string; spend: number; conversations: number; converted: number; orders: number;
  delivered: number; resolved: number; delivered_value: number; cost_per_delivered: number | null }

export const kpiByCampaign = (convs: KpiConv[], orders: KpiOrder[], spend: KpiSpend[]): CampaignKpi[] => {
  const ids = new Set<string>();
  [...convs, ...orders].forEach((x) => x.campaign_id && ids.add(x.campaign_id));
  spend.forEach((s) => ids.add(s.campaign_id));
  return [...ids].map((id) => {
    const sp = spend.filter((s) => s.campaign_id === id).reduce((a, s) => a + s.spend, 0);
    const cv = convs.filter((c) => c.campaign_id === id);
    const od = orders.filter((o) => o.campaign_id === id);
    const delivered = od.filter((o) => isDelivered(o.status)).length;
    return { campaign_id: id, spend: sp, conversations: cv.length, converted: cv.filter((c) => c.converted).length, orders: od.length,
      delivered, resolved: od.filter((o) => isResolved(o.status)).length, delivered_value: od.reduce((a, o) => a + deliveredValue(o), 0),
      cost_per_delivered: delivered > 0 ? round2(sp / delivered) : null };
  }).sort((a, b) => b.spend - a.spend);
};

export interface ModeratorKpi { moderator_id: string; conversations: number; on_time: number; cover: number; late: number; pending: number;
  abandoned: number; converted: number; orders: number; delivered: number; resolved: number; delivered_value: number;
  campaign_delivered: number; allocated_spend: number; cost_per_delivered: number | null }

/** تكلفة المودريتور: إنفاق كل حملة يُوزَّع بنسبة محادثاتها من الحملة، ÷ مُسلَّماتها المنسوبة لحملات. */
export const allocateSpend = (convs: KpiConv[], spend: KpiSpend[]): Map<string, number> => {
  const out = new Map<string, number>();
  const byCampaign = new Map<string, number>();
  spend.forEach((s) => byCampaign.set(s.campaign_id, (byCampaign.get(s.campaign_id) ?? 0) + s.spend));
  byCampaign.forEach((sp, cid) => {
    const cv = convs.filter((c) => c.campaign_id === cid && c.moderator_id);
    cv.forEach((c) => out.set(c.moderator_id!, (out.get(c.moderator_id!) ?? 0) + sp / cv.length));
  });
  return out;
};

export const kpiByModerator = (convs: KpiConv[], orders: KpiOrder[], spend: KpiSpend[]): ModeratorKpi[] => {
  const alloc = allocateSpend(convs, spend);
  const ids = new Set<string>([...alloc.keys()]);
  [...convs, ...orders].forEach((x) => x.moderator_id && ids.add(x.moderator_id));
  return [...ids].map((id) => {
    const cv = convs.filter((c) => c.moderator_id === id);
    const od = orders.filter((o) => o.moderator_id === id);
    const cnt = (s: KpiFirstReply) => cv.filter((c) => c.first_reply === s).length;
    const cd = od.filter((o) => isDelivered(o.status) && o.campaign_id).length;
    const sp = round2(alloc.get(id) ?? 0);
    return { moderator_id: id, conversations: cv.length, on_time: cnt("on_time"), cover: cnt("cover"), late: cnt("late"), pending: cnt("pending"),
      abandoned: cv.filter((c) => c.abandoned).length, converted: cv.filter((c) => c.converted).length, orders: od.length,
      delivered: od.filter((o) => isDelivered(o.status)).length, resolved: od.filter((o) => isResolved(o.status)).length,
      delivered_value: od.reduce((a, o) => a + deliveredValue(o), 0), campaign_delivered: cd, allocated_spend: sp,
      cost_per_delivered: cd > 0 ? round2(sp / cd) : null };
  });
};

export const formatPct = (num: number, den: number) => { const r = ratio(num, den); return r === null ? "—" : `${Math.round(r * 100)}٪`; };
export const formatMoney = (n: number | null | undefined, currency = "EGP") =>
  n === null || n === undefined ? "—" : `${n.toLocaleString("ar-EG", { maximumFractionDigits: 2 })} ${currency === "EGP" ? "ج.م" : currency}`;
