import { isDeliveredWithinClosure } from "@/hooks/usePayrollClosure";

/** حالات نهائية سلبية: مرتجع/ملغي. */
export const RETURNED_STATUSES = ["cancelled", "returned", "refunded"] as const;
/** حالات غير نهائية وغير ملغاة: قيد التوصيل/معلّق. */
export const PENDING_STATUSES = ["pending", "processing", "confirmed", "shipped", "out_for_delivery"] as const;

export type OrderBucket = "delivered" | "pending" | "returned";

export interface StatusOrder {
  status: string | null;
  delivered_at?: string | null;
}

/**
 * يصنّف الأوردر في خانة واحدة فقط حتى يتطابق:
 * مسلّم + قيد التوصيل/معلّق + مرتجع/ملغي = إجمالي الأوردرات.
 * - مسلّم: delivered ضمن لحظة اعتماد القبض (نفس التعريف السابق).
 * - مرتجع/ملغي: cancelled / returned / refunded (نفس التعريف السابق).
 * - قيد التوصيل/معلّق: حالة غير نهائية بالاسم، أو delivered بعد لحظة الاعتماد
 *   (يُدفع في الشهر التالي)، أو حالة غير معروفة.
 */
export const orderBucket = (o: StatusOrder, cutoff: string | null): OrderBucket => {
  const s = (o.status || "").trim();
  if (isDeliveredWithinClosure(s, o.delivered_at, cutoff)) return "delivered";
  if ((RETURNED_STATUSES as readonly string[]).includes(s)) return "returned";
  return "pending";
};

export const countOrderBuckets = (orders: StatusOrder[], cutoff: string | null) => {
  const r = { orders: orders.length, delivered: 0, pending: 0, returned: 0 };
  for (const o of orders) r[orderBucket(o, cutoff)] += 1;
  if (r.delivered + r.pending + r.returned !== r.orders) {
    // حارس اتساق — لا يجب أن يحدث لأن كل أوردر يقع في خانة واحدة
    console.warn("[aggregate] status buckets do not reconcile", r);
  }
  return r;
};

export const ARABIC_MONTHS = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];
/** month0: 0..11 */
export const arabicMonthLabel = (year: number, month0: number) => `${ARABIC_MONTHS[month0]} ${year}`;
