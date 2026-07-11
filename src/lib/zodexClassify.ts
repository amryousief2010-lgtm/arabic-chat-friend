// Zodex bill/order classification utilities.
// Used by the unified ZodexReview screen.

export const ZODEX_INTEGRATION_START = "2026-07-07T00:00:00+02:00";
export const AGOUZA_WAREHOUSE_ID = "a970d469-37df-40e1-b99f-a49195a3778e";
export const NO_BILL_MIN_AGE_HOURS = 24;

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
    const shipDiff = Math.abs(cod - total - 110);
    const positiveDiff = cod - total;
    if (rawDiff < 0.5) { score += 25; reasons.push("المبلغ مطابق"); }
    else if (shipDiff < 0.5) { score += 25; reasons.push("المبلغ مطابق (+110 شحن زودكس)"); }
    else if (rawDiff <= Math.max(5, cod * 0.02)) { score += 20; reasons.push(`المبلغ قريب (فرق ${rawDiff.toFixed(0)})`); }
    else if (shipDiff <= Math.max(5, cod * 0.02)) { score += 20; reasons.push(`المبلغ قريب مع شحن 110 (فرق ${shipDiff.toFixed(0)})`); }
    // Broader shipping-fee variance window: positive diff 30-160 EGP likely = shipping variant
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
  | "bill_not_saved_on_order"     // score >= 90, safe to auto-fix
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

  // Best candidate is essentially the same order → just save the bill number.
  if (best.score >= 90 && !best.shipping_bill_no) {
    return {
      kind: "bill_not_saved_on_order",
      label: "البوليصة موجودة لكن غير محفوظة داخل الأوردر",
      detail: `الأوردر ${best.order_number} مطابق (${best.score}%) لكن ماتحفظش عنده رقم البوليصة.`,
      fixable: true,
    };
  }

  // Compute individual mismatches
  const pc = Math.max(
    phoneCloseness(bill.customer_phone, best.customer?.phone),
    phoneCloseness(bill.customer_phone, best.customer?.phone2),
  );
  const nm = nameCloseness(bill.customer_name, best.customer?.name);
  const cod = Number(bill.cod_amount || 0);
  const total = Number(best.total || 0);
  const rawDiff = cod > 0 && total > 0 ? Math.abs(cod - total) : 0;
  const shipDiff = cod > 0 && total > 0 ? Math.abs(cod - total - 110) : 0;
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
      detail: `COD: ${cod.toLocaleString("ar-EG")} ج | إجمالي الأوردر ${best.order_number}: ${total.toLocaleString("ar-EG")} ج (فرق ${amountDiff.toFixed(0)}${shipDiff < rawDiff ? " بعد خصم 110 شحن" : ""})`,
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
