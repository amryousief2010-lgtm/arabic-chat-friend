// Zodex ⇄ coceg deterministic matching engine (pure, no I/O).
// Shared by the edge functions (Deno) and the web app (Vite) and the dry-run script.
//
// Contract:
//   evaluateBill(bill, candidates, ctx) → MatchDecision with tier
//     AUTO    – exactly one eligible candidate, mobile exact, amount OK, date OK, no conflict
//     REVIEW  – plausible but doubtful (amount difference, several candidates, wide date gap)
//     BLOCKED – conflicts that must never be auto-resolved (bill on another order,
//               order already holding another bill, wrong month, no mobile)
//     NO_ORDER – no coceg order with this mobile
//   The engine NEVER proposes changing the coceg total. Amount differences are
//   returned as `amountDiff` so the UI can flag them.

export type MatchTier = "AUTO" | "REVIEW" | "BLOCKED" | "NO_ORDER";

export const MATCH_ENGINE_VERSION = "zx-match-1";
export const SHIPPING_FEE_EGP = 110;
export const AMOUNT_TOLERANCE_EGP = 5;
export const DATE_OK_DAYS = 3;
export const DATE_WIDE_DAYS = 10;
export const MONTH_GUARD_DAYS = 25;
export const AUTO_MIN_SCORE = 85;

export interface ZodexBill {
  bill_no: string;
  phones: string[];
  cod: number | null;
  shipment_date: string | null; // ISO
  zodex_status?: string | null;
}

export interface CandidateOrder {
  id: string;
  order_number: string;
  total: number | null;
  created_at: string; // ISO
  status: string;
  phones: string[];
  shipping_bill_no?: string | null;
  fulfillment_type?: string | null;
  eligible?: boolean; // isExpectedZodexShipment computed by caller (default true)
}

export interface MatchContext {
  /** bill_no → order ids currently holding it (normally 0/1; >1 means corrupted data). */
  billHolders?: Map<string, string[]>;
}

export type EvidenceCode =
  | "mobile_exact" | "mobile_last9" | "mobile_missing"
  | "amount_exact" | "amount_plus_fee" | "amount_tolerance" | "amount_mismatch" | "amount_unknown"
  | "date_close" | "date_wide" | "date_far" | "date_before_order" | "month_guard"
  | "unique_candidate" | "multiple_candidates"
  | "order_has_other_bill" | "bill_on_other_order" | "bill_on_many_orders"
  | "status_not_eligible";

export interface Evidence { code: EvidenceCode; ok: boolean; points: number; text: string }

export interface ScoredOrder {
  order_id: string;
  order_number: string;
  score: number;
  evidence: Evidence[];
  amountDiff: number | null;
  blocked: boolean;
}

export interface MatchDecision {
  bill_no: string;
  tier: MatchTier;
  best: ScoredOrder | null;
  candidates: ScoredOrder[];
  reasons: string[]; // plain Arabic, for the reviewer
  engine: string;
}

export function normMobile(s: string | null | undefined): string {
  if (!s) return "";
  let d = String(s).replace(/\D/g, "");
  d = d.replace(/^0020/, "0").replace(/^20(?=1\d{9}$)/, "0");
  if (/^1\d{9}$/.test(d)) d = "0" + d;
  return d.slice(-11);
}
const last9 = (s: string) => (s.length >= 9 ? s.slice(-9) : "");

export function mobileRelation(billPhones: string[], orderPhones: string[]): "exact" | "last9" | "none" {
  const a = billPhones.map(normMobile).filter(Boolean);
  const b = orderPhones.map(normMobile).filter(Boolean);
  if (a.some((x) => b.includes(x))) return "exact";
  const b9 = new Set(b.map(last9).filter(Boolean));
  if (a.some((x) => last9(x) && b9.has(last9(x)))) return "last9";
  return "none";
}

export type AmountRelation = "exact" | "plus_fee" | "tolerance" | "mismatch" | "unknown";
export function amountRelation(total: number | null, cod: number | null): { rel: AmountRelation; diff: number | null } {
  const t = Number(total ?? 0), c = Number(cod ?? 0);
  if (!(t > 0) || !(c > 0)) return { rel: "unknown", diff: null };
  const diff = Math.round((c - t) * 100) / 100;
  if (diff === 0) return { rel: "exact", diff };
  if (Math.abs(diff - SHIPPING_FEE_EGP) <= AMOUNT_TOLERANCE_EGP) return { rel: "plus_fee", diff };
  if (Math.abs(diff) <= AMOUNT_TOLERANCE_EGP) return { rel: "tolerance", diff };
  return { rel: "mismatch", diff };
}

const DAY = 86_400_000;
export function daysBetween(orderIso: string, shipIso: string | null): number | null {
  if (!shipIso) return null;
  return (new Date(shipIso).getTime() - new Date(orderIso).getTime()) / DAY;
}

export function scoreOrder(bill: ZodexBill, o: CandidateOrder, ctx: MatchContext = {}): ScoredOrder {
  const ev: Evidence[] = [];
  let blocked = false;
  const push = (code: EvidenceCode, ok: boolean, points: number, text: string) => ev.push({ code, ok, points, text });

  const mob = mobileRelation(bill.phones, o.phones);
  if (mob === "exact") push("mobile_exact", true, 50, "رقم الموبايل مطابق تمامًا");
  else if (mob === "last9") push("mobile_last9", true, 40, "آخر 9 أرقام من الموبايل مطابقة");
  else push("mobile_missing", false, 0, "رقم الموبايل غير مطابق");

  const am = amountRelation(o.total, bill.cod);
  if (am.rel === "exact") push("amount_exact", true, 30, "مبلغ التحصيل مطابق لإجمالي الأوردر");
  else if (am.rel === "plus_fee") push("amount_plus_fee", true, 28, `مبلغ التحصيل = إجمالي الأوردر + ${SHIPPING_FEE_EGP} شحن`);
  else if (am.rel === "tolerance") push("amount_tolerance", true, 25, `فرق بسيط في المبلغ (${am.diff} ج)`);
  else if (am.rel === "mismatch") push("amount_mismatch", false, 0, `فرق في المبلغ: زودكس ${bill.cod} مقابل الأوردر ${o.total} (فرق ${am.diff} ج)`);
  else push("amount_unknown", false, 5, "المبلغ غير متاح للمقارنة");

  const days = daysBetween(o.created_at, bill.shipment_date);
  if (days === null) push("date_wide", false, 5, "تاريخ الشحن غير متاح");
  else if (days < -1) { push("date_before_order", false, 0, "تاريخ الشحن قبل تاريخ إنشاء الأوردر"); blocked = true; }
  else if (days > MONTH_GUARD_DAYS) { push("month_guard", false, 0, `الأوردر أقدم من البوليصة بـ ${Math.round(days)} يوم (شهر مختلف)`); blocked = true; }
  else if (days <= DATE_OK_DAYS) push("date_close", true, 20, `الشحن بعد ${Math.max(0, Math.round(days))} يوم من الأوردر`);
  else if (days <= DATE_WIDE_DAYS) push("date_wide", false, 8, `الشحن بعد ${Math.round(days)} أيام من الأوردر`);
  else push("date_far", false, 0, `الشحن بعد ${Math.round(days)} يوم من الأوردر`);

  if (o.eligible === false) { push("status_not_eligible", false, 0, `حالة/نوع الأوردر لا يقبل بوليصة (${o.status})`); blocked = true; }
  if (o.shipping_bill_no && o.shipping_bill_no !== bill.bill_no) {
    push("order_has_other_bill", false, 0, `الأوردر مربوط ببوليصة أخرى ${o.shipping_bill_no}`);
    blocked = true;
  }
  const holders = ctx.billHolders?.get(bill.bill_no) ?? [];
  if (holders.length > 1) { push("bill_on_many_orders", false, 0, `البوليصة مربوطة بـ ${holders.length} أوردرات`); blocked = true; }
  else if (holders.length === 1 && holders[0] !== o.id) { push("bill_on_other_order", false, 0, "البوليصة مربوطة بأوردر آخر"); blocked = true; }

  const score = mob === "none" ? 0 : Math.min(100, ev.reduce((s, e) => s + e.points, 0));
  return { order_id: o.id, order_number: o.order_number, score, evidence: ev, amountDiff: am.diff, blocked };
}

export function evaluateBill(bill: ZodexBill, candidates: CandidateOrder[], ctx: MatchContext = {}): MatchDecision {
  const base = { bill_no: bill.bill_no, engine: MATCH_ENGINE_VERSION };
  const reasons: string[] = [];
  if (!bill.phones.map(normMobile).some(Boolean)) {
    return { ...base, tier: "BLOCKED", best: null, candidates: [], reasons: ["البوليصة بدون رقم موبايل صالح"] };
  }
  const holders = ctx.billHolders?.get(bill.bill_no) ?? [];
  const scored = candidates
    .map((o) => scoreOrder(bill, o, ctx))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.order_number.localeCompare(b.order_number));

  if (holders.length > 1) {
    return { ...base, tier: "BLOCKED", best: scored[0] ?? null, candidates: scored,
      reasons: [`البوليصة مربوطة بـ ${holders.length} أوردرات في نفس الوقت — لازم يتحدد أوردر واحد`] };
  }
  if (scored.length === 0) {
    return { ...base, tier: "NO_ORDER", best: null, candidates: [], reasons: ["لا يوجد أوردر في coceg بنفس رقم الموبايل"] };
  }
  const open = scored.filter((s) => !s.blocked);
  const best = open[0] ?? scored[0];
  if (open.length === 0) {
    reasons.push("كل الأوردرات المحتملة عليها تعارض:");
    for (const e of best.evidence.filter((e) => !e.ok && e.points === 0)) reasons.push(e.text);
    return { ...base, tier: "BLOCKED", best, candidates: scored, reasons };
  }
  const has = (c: EvidenceCode) => best.evidence.some((e) => e.code === c);
  const amountOk = has("amount_exact") || has("amount_plus_fee") || has("amount_tolerance");
  const mobileExact = has("mobile_exact");
  const dateOk = has("date_close");
  const unique = open.length === 1;
  if (!unique) reasons.push(`${open.length} أوردرات مفتوحة على نفس الموبايل — المقترح ${best.order_number} لأنه الأعلى تطابقًا`);
  if (!amountOk) reasons.push(best.evidence.find((e) => e.code.startsWith("amount_"))!.text);
  if (!mobileExact) reasons.push("الموبايل مطابق جزئيًا فقط");
  if (!dateOk) reasons.push(best.evidence.find((e) => e.code.startsWith("date_"))!.text);

  // Safe uniqueness: two open candidates but only one with an amount match and a clear margin.
  let safeUnique = unique;
  if (!unique) {
    const amountMatches = open.filter((s) => s.evidence.some((e) => ["amount_exact", "amount_plus_fee", "amount_tolerance"].includes(e.code)));
    safeUnique = amountMatches.length === 1 && amountMatches[0] === best && best.score - open[1].score >= 25;
  }
  if (safeUnique && amountOk && mobileExact && dateOk && best.score >= AUTO_MIN_SCORE) {
    return { ...base, tier: "AUTO", best, candidates: scored,
      reasons: unique ? ["أوردر واحد بنفس الموبايل + المبلغ مطابق + التاريخ قريب"]
        : ["أكثر من أوردر بنفس الموبايل لكن أوردر واحد فقط مبلغه مطابق وتاريخه قريب"] };
  }
  return { ...base, tier: "REVIEW", best, candidates: scored, reasons };
}

// ---- Existing-link audit -------------------------------------------------------
export interface ExistingLink {
  bill: ZodexBill;
  order: CandidateOrder;
  otherOpenSamePhone: number;  // other non-cancelled orders on same mobile in window
  billOrderCount: number;      // how many orders this bill was ever linked to (audit)
  orderBillCount: number;      // how many bills this order was ever linked to (audit)
  amountKnownMatched?: boolean | null; // when cod not stored: audit match_reason said amount matched
}
export type SuspicionCode = "amount_diff" | "wrong_month" | "shared_mobile" | "bill_multi_order" | "order_multi_bill" | "mobile_mismatch";
export function auditExistingLink(l: ExistingLink): SuspicionCode[] {
  const out: SuspicionCode[] = [];
  if (l.bill.cod != null) {
    const r = amountRelation(l.order.total, l.bill.cod).rel;
    if (r === "mismatch") out.push("amount_diff");
  } else if (l.amountKnownMatched === false) out.push("amount_diff");
  const d = daysBetween(l.order.created_at, l.bill.shipment_date);
  if (d !== null && d > MONTH_GUARD_DAYS) out.push("wrong_month");
  if (l.otherOpenSamePhone > 0) out.push("shared_mobile");
  if (l.billOrderCount > 1) out.push("bill_multi_order");
  if (l.orderBillCount > 1) out.push("order_multi_bill");
  if (l.bill.phones.length && l.order.phones.length && mobileRelation(l.bill.phones, l.order.phones) === "none") out.push("mobile_mismatch");
  return out;
}

// ---- Zodex status → coceg status, with guards ----------------------------------
export type ZodexState = "delivered" | "returned" | "cancelled" | "in_transit" | "unknown";
export function mapZodexStatus(text: string | null | undefined): ZodexState {
  const t = (text || "").replace(/[أإآ]/g, "ا").trim();
  if (!t) return "unknown";
  if (/مرتجع|راجع|رفض|مرفوض/.test(t)) return "returned";
  if (/الغاء|ملغ/.test(t)) return "cancelled";
  if (/تم التسليم|تسليم|مسلم|delivered/i.test(t)) return "delivered";
  if (/شحن|طريق|مندوب|استلام|جاري|out/i.test(t)) return "in_transit";
  return "unknown";
}
/** Returns the coceg status to set, or null when the transition must not be automatic. */
export function guardedStatusUpdate(current: string, z: ZodexState, linkTier: MatchTier | "LINKED"): "delivered" | "cancelled" | null {
  if (linkTier !== "AUTO" && linkTier !== "LINKED") return null; // never act on doubtful links
  if (current === "pending" && z === "delivered") return "delivered";
  if (current === "pending" && (z === "returned" || z === "cancelled")) return "cancelled";
  return null; // delivered↔cancelled flips always go to review
}

export const TIER_LABEL_AR: Record<MatchTier, string> = {
  AUTO: "ربط تلقائي مؤكَّد",
  REVIEW: "يحتاج مراجعة",
  BLOCKED: "متعارض — موقوف",
  NO_ORDER: "بوليصة بدون أوردر",
};
