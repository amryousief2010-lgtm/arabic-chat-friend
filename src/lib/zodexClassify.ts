// Zodex bill/order classification utilities.
// Used by the unified ZodexReview screen.

import {
  amountMatchesZodex,
  looksLikeEgyptianMobile,
  phonesMatchLoose,
  ZODEX_SHIPPING_FEE_EGP,
} from "../../supabase/functions/_shared/zodexSync";

export { amountMatchesZodex, looksLikeEgyptianMobile, phonesMatchLoose, ZODEX_SHIPPING_FEE_EGP };

export const ZODEX_INTEGRATION_START = "2026-07-07T00:00:00+02:00";
export const AGOUZA_WAREHOUSE_ID = "a970d469-37df-40e1-b99f-a49195a3778e";
export const NO_BILL_MIN_AGE_HOURS = 24;
export const LAST9_PHONE_KEY_MIN = 9;

// Statuses that mean the order is NOT expected to have a Zodex bill.
export const NON_SHIPPABLE_STATUSES = new Set([
  "cancelled", "ملغى", "ملغي",
  "draft", "مسودة",
  "returned", "مرتجع", "مرتجع نهائي",
]);

export const normPhone = (v?: string | null) =>
  (v || "").replace(/\D+/g, "").replace(/^20/, "").slice(-11);

export const phoneCloseness = (a?: string | null, b?: string | null) => {
  const x = normPhone(a);
  const y = normPhone(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.slice(-9) === y.slice(-9) && x.length >= 10 && y.length >= 10) return 0.85;
  if (x.length === y.length) {
    let diff = 0;
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) diff++;
    if (diff === 1) return 0.7;
    if (diff === 2) return 0.4;
  }
  return 0;
};

export const nameCloseness = (a?: string | null, b?: string | null) => {
  const x = (a || "").trim().toLowerCase();
  const y = (b || "").trim().toLowerCase();
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.7;
  const xs = new Set(x.split(/\s+/));
  const ys = new Set(y.split(/\s+/));
  let inter = 0;
  xs.forEach((t) => { if (ys.has(t)) inter++; });
  const uni = new Set([...xs, ...ys]).size || 1;
  return inter / uni;
};

export interface MissingBill {
  id: string;
  bill_no: string;
  customer_name: string | null;
  customer_phone: string | null;
  cod_amount: number | null;
  moderator_name: string | null;
  shipment_date: string | null;
  first_seen_at: string;
}

export interface OrderCandidate {
  id: string;
  order_number: string;
  total: number | null;
  created_at: string;
  moderator: string | null;
  shipping_bill_no: string | null;
  status: string | null;
  customer: { name: string | null; phone: string | null; phone2: string | null } | null;
}

export interface ScoredCandidate extends OrderCandidate {
  score: number;
  reasons: string[];
}

export function scoreCandidate(row: MissingBill, o: OrderCandidate): ScoredCandidate {
  const reasons: string[] = [];
  let score = 0;

  const pc = Math.max(
    phoneCloseness(row.customer_phone, o.customer?.phone),
    phoneCloseness(row.customer_phone, o.customer?.phone2),
  );
  if (pc === 1) { score += 55; reasons.push("الموبايل مطابق"); }
  else if (pc >= 0.85) { score += 45; reasons.push("الموبايل قريب جداً"); }
  else if (pc >= 0.7) { score += 32; reasons.push("الموبايل مختلف بخانة واحدة (خطأ إدخال محتمل)"); }
  else if (pc >= 0.4) { score += 15; reasons.push("الموبايل مختلف بخانتين"); }

  const cod = Number(row.cod_amount || 0);
  const total = Number(o.total || 0);
  if (cod > 0 && total > 0) {
    const rawDiff = Math.abs(cod - total);
    const shipDiff = Math.abs(cod - total - ZODEX_SHIPPING_FEE_EGP);
    const positiveDiff = cod - total;
    const det = amountMatchesZodex(total, cod);
    if (det.ok && det.via === "exact" && rawDiff < 0.5) { score += 25; reasons.push("المبلغ مطابق"); }
    else if (det.ok && det.via === "shipping_fee") { score += 25; reasons.push(`المبلغ مطابق (+${ZODEX_SHIPPING_FEE_EGP} شحن زودكس)`); }
    else if (rawDiff <= Math.max(5, cod * 0.02)) { score += 20; reasons.push(`المبلغ قريب (فرق ${rawDiff.toFixed(0)})`); }
    else if (shipDiff <= Math.max(5, cod * 0.02)) { score += 20; reasons.push(`المبلغ قريب مع شحن ${ZODEX_SHIPPING_FEE_EGP} (فرق ${shipDiff.toFixed(0)})`); }
    // Broader shipping-fee variance window: review ranking only — never auto-link.
    else if (positiveDiff >= 30 && positiveDiff <= 160) { score += 18; reasons.push(`فرق مبلغ ${positiveDiff.toFixed(0)} ج (رسوم شحن محتملة)`); }
    else if (rawDiff <= Math.max(20, cod * 0.05)) { score += 8; reasons.push(`المبلغ متقارب (فرق ${rawDiff.toFixed(0)})`); }
  }

  const mod = nameCloseness(row.moderator_name, o.moderator);
  if (mod === 1) { score += 10; reasons.push("المندوبة مطابقة"); }
  else if (mod >= 0.5) { score += 5; reasons.push("المندوبة قريبة"); }

  const nm = nameCloseness(row.customer_name, o.customer?.name);
  if (nm === 1) { score += 15; reasons.push("الاسم مطابق"); }
  else if (nm >= 0.5) { score += 8; reasons.push("الاسم قريب"); }

  return { ...o, score: Math.min(100, score), reasons };
}

export type LinkIssueKind =
  | "bill_not_saved_on_order"     // score >= 90 AND strong phone, safe to one-click save
  | "suggested_match"             // score 60-89 AND strong phone, needs one-click confirm
  | "weak_match"                  // score high enough to show, but phone is not a deterministic key
  | "phone_mismatch"
  | "name_mismatch"
  | "amount_mismatch"
  | "duplicate_bill"
  | "manual_zodex_entry";

export interface LinkIssue {
  kind: LinkIssueKind;
  label: string;
  detail: string;
  fixable: boolean;
  confidence?: number;
}

export function classifyLinkIssue(
  bill: MissingBill,
  best: ScoredCandidate | null,
  duplicateCount = 0,
): LinkIssue | null {
  if (!best) return null;

  if (duplicateCount > 1) {
    return {
      kind: "duplicate_bill",
      label: "رقم بوليصة مكرر",
      detail: `نفس البوليصة ظهرت في ${duplicateCount} أوردر — يحتاج مراجعة يدوية.`,
      fixable: false,
    };
  }

  const pc = Math.max(
    phoneCloseness(bill.customer_phone, best.customer?.phone),
    phoneCloseness(bill.customer_phone, best.customer?.phone2),
  );
  const strongPhone = pc >= 0.85;

  // Best candidate is essentially the same order → just save the bill number.
  // Require a strong phone key so FIFO/name+amount cannot one-click the wrong order.
  if (best.score >= 90 && !best.shipping_bill_no && strongPhone) {
    return {
      kind: "bill_not_saved_on_order",
      label: "البوليصة موجودة لكن غير محفوظة داخل الأوردر",
      detail: `الأوردر ${best.order_number} مطابق (${best.score}%) لكن ماتحفظش عنده رقم البوليصة.`,
      fixable: true,
      confidence: best.score,
    };
  }

  // Suggested match: 60-89% with a deterministic phone key → one-click confirm
  if (best.score >= 60 && !best.shipping_bill_no && strongPhone) {
    return {
      kind: "suggested_match",
      label: `مطابقة مقترحة (${best.score}%) — تحتاج تأكيد`,
      detail: `الأوردر ${best.order_number}: ${best.reasons.join(" • ")}`,
      fixable: true,
      confidence: best.score,
    };
  }

  if (best.score >= 60 && !best.shipping_bill_no && !strongPhone) {
    return {
      kind: "weak_match",
      label: `تطابق جزئي (${best.score}%) — الموبايل غير مؤكد`,
      detail: `الأوردر ${best.order_number}: ${best.reasons.join(" • ")}. الربط اليدوي فقط — لا تأكيد بضغطة لأن رقم الموبايل مش مفتاح قوي.`,
      fixable: false,
      confidence: best.score,
    };
  }
  const nm = nameCloseness(bill.customer_name, best.customer?.name);
  const cod = Number(bill.cod_amount || 0);
  const total = Number(best.total || 0);
  const rawDiff = cod > 0 && total > 0 ? Math.abs(cod - total) : 0;
  const shipDiff = cod > 0 && total > 0 ? Math.abs(cod - total - ZODEX_SHIPPING_FEE_EGP) : 0;
  const amountDiff = cod > 0 && total > 0 ? Math.min(rawDiff, shipDiff) : 0;
  const amountMismatch = cod > 0 && total > 0 && amountDiff > Math.max(5, cod * 0.02);

  if (pc < 0.85 && bill.customer_phone && best.customer?.phone) {
    return {
      kind: "phone_mismatch",
      label: "رقم الموبايل مختلف",
      detail: `بوليصة: ${bill.customer_phone} | أوردر ${best.order_number}: ${best.customer?.phone || "—"}`,
      fixable: false,
    };
  }

  if (amountMismatch) {
    return {
      kind: "amount_mismatch",
      label: "القيمة مختلفة",
      detail: `COD: ${cod.toLocaleString("ar-EG")} ج | إجمالي الأوردر ${best.order_number}: ${total.toLocaleString("ar-EG")} ج (فرق ${amountDiff.toFixed(0)}${shipDiff < rawDiff ? ` بعد خصم ${ZODEX_SHIPPING_FEE_EGP} شحن` : ""})`,
      fixable: false,
    };
  }

  if (nm < 0.5 && bill.customer_name && best.customer?.name) {
    return {
      kind: "name_mismatch",
      label: "الاسم مختلف",
      detail: `بوليصة: ${bill.customer_name} | أوردر ${best.order_number}: ${best.customer?.name}`,
      fixable: false,
    };
  }

  // Old bill (> 3 days) with weak match → probably manual Zodex entry
  if (bill.shipment_date) {
    const ageDays = (Date.now() - new Date(bill.shipment_date).getTime()) / 86400000;
    if (ageDays > 3 && best.score < 70) {
      return {
        kind: "manual_zodex_entry",
        label: "أوردر اتسجل يدويًا على زودكس",
        detail: `البوليصة عمرها ${Math.round(ageDays)} يوم بدون تطابق قوي — على الأرجح أُنشئت مباشرة من موقع زودكس.`,
        fixable: false,
      };
    }
  }

  return null;
}

/** Last 9 digits — the review-screen phone key (handles 01 vs +20). */
export function last9PhoneKey(v?: string | null): string {
  return (v || "").replace(/\D+/g, "").slice(-LAST9_PHONE_KEY_MIN);
}

export type MismatchExplain = {
  kind: string;
  label: string;
  detail: string;
};

/**
 * Why a Zodex bill has no local order with score ≥ 20.
 * Display-only — never used to auto-link.
 */
export function explainOrphanBill(opts: {
  bill: MissingBill;
  weakCandidates: ScoredCandidate[];
}): MismatchExplain {
  const { bill, weakCandidates } = opts;
  if (!looksLikeEgyptianMobile(bill.customer_phone)) {
    return {
      kind: "no_valid_phone",
      label: "موبايل زودكس غير صالح للمطابقة",
      detail: bill.customer_phone
        ? `الرقم «${bill.customer_phone}» مش شكل موبايل مصري (01…) — غالبًا عمود HTML اتزاح. ربط يدوي فقط.`
        : "البوليصة بدون موبايل — لا يمكن المطابقة التلقائية.",
    };
  }
  if (!bill.shipment_date) {
    return {
      kind: "missing_zodex_date",
      label: "تاريخ الشحن غير مقروء من زودكس",
      detail: "عمود التاريخ فاضي أو مش بالصيغة المتوقعة. الصف ظاهر للمراجعة اليدوية ولم يُتخطَّ بصمت.",
    };
  }
  const phoneHit = weakCandidates.find((c) =>
    phonesMatchLoose(bill.customer_phone, c.customer?.phone) ||
    phonesMatchLoose(bill.customer_phone, c.customer?.phone2),
  );
  if (phoneHit) {
    const det = amountMatchesZodex(Number(phoneHit.total || 0), Number(bill.cod_amount || 0));
    if (!det.ok) {
      return {
        kind: "phone_amount_mismatch",
        label: "نفس الموبايل — القيمة مختلفة",
        detail: `أقرب أوردر ${phoneHit.order_number}: ${Number(phoneHit.total || 0).toLocaleString("ar-EG")} ج مقابل COD ${Number(bill.cod_amount || 0).toLocaleString("ar-EG")} ج (فرق ${det.diff.toFixed(0)}). ليس تطابق +${ZODEX_SHIPPING_FEE_EGP}.`,
      };
    }
  }
  if (weakCandidates.length > 0) {
    const w = weakCandidates[0];
    return {
      kind: "weak_candidate",
      label: `مرشح ضعيف (${w.score}%)`,
      detail: `الأوردر ${w.order_number}: ${w.reasons.join(" • ") || "بدون إشارات قوية"}. تحت حد العرض (20%).`,
    };
  }
  return {
    kind: "no_local_order",
    label: "لا يوجد أوردر بنفس الموبايل",
    detail: "آخر 9 أرقام الموبايل غير موجودة على أوردر بدون بوليصة. غالبًا أوردر اتسجل على زودكس فقط — أو رقم مختلف عندنا.",
  };
}

export type BillPhoneSuggestion = {
  bill: MissingBill;
  via: string;
  kind: "amount_ok" | "phone_only";
  detail: string;
};

/**
 * Pick a pending bill for a no-bill order: phone last-9 AND (exact or +110 amount)
 * is a real suggestion. Phone-only is labeled, never treated as a match.
 */
export function suggestBillForOrder(
  orderTotal: number | null | undefined,
  bills: MissingBill[],
  via: string,
): BillPhoneSuggestion | null {
  if (!bills.length) return null;
  const amountHit = bills.find((b) => amountMatchesZodex(Number(orderTotal || 0), Number(b.cod_amount || 0)).ok);
  if (amountHit) {
    const det = amountMatchesZodex(Number(orderTotal || 0), Number(amountHit.cod_amount || 0));
    return {
      bill: amountHit,
      via,
      kind: "amount_ok",
      detail: det.via === "shipping_fee"
        ? `موبايل + مبلغ مطابق (بعد +${ZODEX_SHIPPING_FEE_EGP} شحن)`
        : "موبايل + مبلغ مطابق",
    };
  }
  const b = bills[0];
  const det = amountMatchesZodex(Number(orderTotal || 0), Number(b.cod_amount || 0));
  return {
    bill: b,
    via,
    kind: "phone_only",
    detail: `نفس الموبايل (${via}) لكن القيمة مختلفة: أوردر ${Number(orderTotal || 0).toLocaleString("ar-EG")} ج • زودكس ${Number(b.cod_amount || 0).toLocaleString("ar-EG")} ج (فرق ${det.diff.toFixed(0)}).`,
  };
}

export function explainNoBillOrder(opts: {
  hasWarehouse: boolean;
  shippingCompany: string | null | undefined;
  suggestion: BillPhoneSuggestion | null;
}): MismatchExplain {
  const { hasWarehouse, shippingCompany, suggestion } = opts;
  if (suggestion?.kind === "amount_ok") {
    return {
      kind: "pending_bill_match",
      label: "بوليصة معلّقة مطابقة",
      detail: `${suggestion.detail}: ${suggestion.bill.bill_no}. استخدم «إعادة الربط» يدويًا — النظام لا يربط تلقائيًا من الشاشة.`,
    };
  }
  if (suggestion?.kind === "phone_only") {
    return {
      kind: "phone_only_bill",
      label: "بوليصة بنفس الموبايل — القيمة مختلفة",
      detail: suggestion.detail,
    };
  }
  if (!hasWarehouse && !shippingCompany) {
    return {
      kind: "unclassified_fulfillment",
      label: "بدون منفذ تنفيذ محدد",
      detail: "الأوردر مش مربوط بمخزن/شركة شحن. ظاهر للاحتياط — قد لا يكون شحنة زودكس.",
    };
  }
  return {
    kind: "no_pending_bill",
    label: "لا توجد بوليصة معلّقة بنفس الموبايل",
    detail: "مفيش صف pending في زودكس بآخر 9 أرقام. سجّل البوليصة على زودكس أو اربط رقم ZX يدويًا إذا كانت موجودة ومتربطتش.",
  };
}
