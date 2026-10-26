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

export const MATCH_ENGINE_VERSION = "zx-match-2"; // 27/10: amount informational only; pickup + private courier eligible
export const SHIPPING_FEE_EGP = 110;
export const AMOUNT_TOLERANCE_EGP = 5;
export const DATE_OK_DAYS = 3;
export const DATE_WIDE_DAYS = 10;
export const MONTH_GUARD_DAYS = 25;

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

/** Order types that can carry a Zodex waybill. Pickup (Zodex collects from the warehouse)
 * and private-courier («مندوب خاص») orders ARE eligible — excluding them caused the
 * 27/10 "not found" waybills. Only cancelled orders are excluded. */
export function isLinkEligible(o: Pick<CandidateOrder, "status" | "eligible">): boolean {
  if (o.eligible === false) return false;
  return o.status !== "cancelled";
}

export function scoreOrder(bill: ZodexBill, o: CandidateOrder, ctx: MatchContext = {}): ScoredOrder {
  const ev: Evidence[] = [];
  let blocked = false;
  const push = (code: EvidenceCode, ok: boolean, points: number, text: string) => ev.push({ code, ok, points, text });

  const mob = mobileRelation(bill.phones, o.phones);
  if (mob === "exact") push("mobile_exact", true, 60, "رقم الموبايل مطابق تمامًا");
  else if (mob === "last9") push("mobile_last9", true, 55, "رقم الموبايل مطابق (آخر 9 أرقام)");
  else push("mobile_missing", false, 0, "رقم الموبايل غير مطابق");

  // Amount: INFORMATIONAL ONLY (decision of 27/10). Never adds/removes points, never changes tier.
  const am = amountRelation(o.total, bill.cod);
  if (am.rel === "mismatch") push("amount_mismatch", true, 0, `للعلم: مبلغ زودكس ${bill.cod} وإجمالي الأوردر ${o.total} (فرق ${am.diff} ج)`);

  const days = daysBetween(o.created_at, bill.shipment_date);
  if (days === null) push("date_wide", false, 10, "تاريخ الشحن غير متاح");
  else if (days < -1) { push("date_before_order", false, 0, "تاريخ البوليصة قبل تسجيل الأوردر"); blocked = true; }
  else if (days > MONTH_GUARD_DAYS) { push("month_guard", false, 0, `الأوردر أقدم من البوليصة بـ ${Math.round(days)} يوم (شهر مختلف)`); blocked = true; }
  else if (days <= DATE_OK_DAYS) push("date_close", true, 30, `البوليصة بعد ${Math.max(0, Math.round(days))} يوم من تسجيل الأوردر`);
  else if (days <= DATE_WIDE_DAYS) push("date_wide", false, 20, `البوليصة بعد ${Math.round(days)} أيام من تسجيل الأوردر`);
  else push("date_far", false, 10, `البوليصة بعد ${Math.round(days)} يوم من تسجيل الأوردر`);

  if (!isLinkEligible(o)) { push("status_not_eligible", false, 0, `الأوردر ${o.status === "cancelled" ? "ملغي" : "غير مؤهل"}`); blocked = true; }
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
  if (!bill.phones.map(normMobile).some(Boolean)) {
    return { ...base, tier: "BLOCKED", best: null, candidates: [], reasons: ["البوليصة بدون رقم موبايل صالح"] };
  }
  const holders = ctx.billHolders?.get(bill.bill_no) ?? [];
  const closeness = (s: ScoredOrder) => {
    const o = candidates.find((c) => c.id === s.order_id)!;
    const d = daysBetween(o.created_at, bill.shipment_date);
    return d === null ? 1e9 : Math.abs(d);
  };
  const scored = candidates
    .map((o) => scoreOrder(bill, o, ctx))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || closeness(a) - closeness(b) || a.order_number.localeCompare(b.order_number));

  if (holders.length > 1) {
    return { ...base, tier: "BLOCKED", best: scored[0] ?? null, candidates: scored,
      reasons: [`البوليصة مربوطة بـ ${holders.length} أوردرات في نفس الوقت — لازم يتحدد أوردر واحد`] };
  }
  if (scored.length === 0) {
    return { ...base, tier: "NO_ORDER", best: null, candidates: [], reasons: ["لا يوجد أوردر في coceg بنفس رقم الموبايل حتى الآن — سيُعاد الفحص تلقائيًا عند تسجيل أوردر جديد بنفس الرقم"] };
  }
  const open = scored.filter((s) => !s.blocked);
  const best = open[0] ?? scored[0];
  const info = best.evidence.filter((e) => e.code === "amount_mismatch").map((e) => e.text);
  if (open.length === 0) {
    const reasons = ["كل الأوردرات بنفس الموبايل عليها تعارض:", ...best.evidence.filter((e) => !e.ok && e.points === 0 && e.code !== "mobile_missing").map((e) => e.text)];
    return { ...base, tier: "BLOCKED", best, candidates: scored, reasons };
  }
  const has = (c: EvidenceCode) => best.evidence.some((e) => e.code === c);
  const dateOk = has("date_close") || has("date_wide");
  if (open.length === 1 && dateOk) {
    return { ...base, tier: "AUTO", best, candidates: scored,
      reasons: ["أوردر واحد مفتوح بنفس رقم الموبايل وتاريخه مناسب", ...info] };
  }
  const reasons: string[] = [];
  if (open.length > 1) reasons.push(`${open.length} أوردرات مفتوحة بنفس الموبايل — المقترح ${best.order_number} (الأقرب في التاريخ)`);
  if (!dateOk) reasons.push(best.evidence.find((e) => e.code.startsWith("date_"))!.text);
  return { ...base, tier: "REVIEW", best, candidates: scored, reasons: [...reasons, ...info] };
}

/** Reverse matching: a new coceg order (or periodic sweep) against waybills still unmatched.
 * Re-evaluates each waybill whose mobile matches, so the normal tiering rules apply. */
export function reverseMatch(order: CandidateOrder, unmatched: ZodexBill[], allCandidatesFor: (b: ZodexBill) => CandidateOrder[], ctx: MatchContext = {}): MatchDecision[] {
  return unmatched
    .filter((b) => mobileRelation(b.phones, order.phones) !== "none")
    .map((b) => {
      const pool = allCandidatesFor(b);
      return evaluateBill(b, pool.some((c) => c.id === order.id) ? pool : [...pool, order], ctx);
    });
}

/** Delivery-sheet rows: resolve each waybill to an order — by waybill first, then by mobile —
 * instead of reporting a bare "not found". */
export interface SheetRow { bill_no: string; phones: string[]; cod: number | null; date: string | null; outcome: "delivered" | "returned" }
export interface SheetResolution { row: SheetRow; via: "bill" | "auto_link" | "review" | "not_found"; order_id: string | null; decision?: MatchDecision }
export function resolveSheetRows(rows: SheetRow[], byBill: Map<string, CandidateOrder>, candidatesFor: (phones: string[]) => CandidateOrder[], ctx: MatchContext = {}): SheetResolution[] {
  return rows.map((row) => {
    const linked = byBill.get(row.bill_no);
    if (linked) return { row, via: "bill", order_id: linked.id };
    const d = evaluateBill({ bill_no: row.bill_no, phones: row.phones, cod: row.cod, shipment_date: row.date }, candidatesFor(row.phones), ctx);
    if (d.tier === "AUTO") return { row, via: "auto_link", order_id: d.best!.order_id, decision: d };
    if (d.tier === "NO_ORDER") return { row, via: "not_found", order_id: null, decision: d };
    return { row, via: "review", order_id: d.best?.order_id ?? null, decision: d };
  });
}

/** Bulk return/cancel plan from Zodex status or the sheet's returned section. */
export interface StatusPlanItem { order_id: string; bill_no: string; from: string; to: "delivered" | "cancelled" | null; needs_review: boolean; reason: string }
export function planStatusUpdates(items: { order_id: string; bill_no: string; current: string; zodex: ZodexState; link: MatchTier | "LINKED" }[]): StatusPlanItem[] {
  return items.map((i) => {
    const to = guardedStatusUpdate(i.current, i.zodex, i.link);
    if (to) return { order_id: i.order_id, bill_no: i.bill_no, from: i.current, to, needs_review: false, reason: to === "cancelled" ? "مرتجع في زودكس" : "تم التسليم في زودكس" };
    const flip = (i.current === "delivered" && (i.zodex === "returned" || i.zodex === "cancelled")) || (i.current === "cancelled" && i.zodex === "delivered");
    return { order_id: i.order_id, bill_no: i.bill_no, from: i.current, to: null, needs_review: flip || i.link === "REVIEW",
      reason: flip ? "تعارض: حالة زودكس عكس حالة الأوردر" : "لا يلزم تغيير" };
  });
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
export type SuspicionCode = "wrong_month" | "shared_mobile" | "bill_multi_order" | "order_multi_bill" | "mobile_mismatch";
export function auditExistingLink(l: ExistingLink): SuspicionCode[] {
  const out: SuspicionCode[] = [];
  // Amount differences are NOT suspicious (27/10 decision) — shown as info only.
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
