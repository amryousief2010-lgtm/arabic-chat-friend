/** Pure helpers for «طلبات عروض الأسعار – الفنادق والمطاعم». */

export type B2BStatus = "new" | "contacted" | "quote_sent" | "contracted" | "rejected";
export type FacilityType = "hotel" | "restaurant" | "cafe" | "catering";

export const STATUS_ORDER: B2BStatus[] = ["new", "contacted", "quote_sent", "contracted", "rejected"];

export const STATUS_LABELS: Record<B2BStatus, string> = {
  new: "جديد",
  contacted: "تم التواصل",
  quote_sent: "تم إرسال العرض",
  contracted: "تم التعاقد",
  rejected: "مرفوض",
};

/** Brand palette only: #A4288A / #662D8C / #F37346 (+ neutrals). */
export const STATUS_STYLES: Record<B2BStatus, { bg: string; fg: string; border: string }> = {
  new:        { bg: "#F37346", fg: "#FFFFFF", border: "#F37346" },
  contacted:  { bg: "#FDEEE7", fg: "#B4521F", border: "#F8C3A8" },
  quote_sent: { bg: "#F5E6F2", fg: "#A4288A", border: "#E3B8D9" },
  contracted: { bg: "#662D8C", fg: "#FFFFFF", border: "#662D8C" },
  rejected:   { bg: "#F1F1F3", fg: "#6B6B76", border: "#DADADF" },
};

export const FACILITY_LABELS: Record<FacilityType, string> = {
  hotel: "فندق",
  restaurant: "مطعم",
  cafe: "كافيه",
  catering: "تموين",
};

export const PRODUCT_LABELS: Record<string, string> = {
  whole_box: "نعامة كاملة في صندوق",
  thigh: "فخذ نعام كامل",
  drumstick: "دبوس نعام كامل",
  steak: "استيك",
  farasha: "فراشة",
  escalope: "اسكالوب",
  minced: "مفروم",
  burger: "برجر",
  kofta: "كفتة",
};

export const productLabel = (k: string) => PRODUCT_LABELS[k] ?? k;

export const refLabel = (n: number | null | undefined) => (n == null ? "—" : `HQ-${n}`);

/** Latin numerals, EGP. */
export const money = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `${Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 })} ج.م`;

/** Cairo time, Latin digits: 27/11/2026 14:05 */
export function formatCairo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Cairo", day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${g("day")}/${g("month")}/${g("year")} ${g("hour")}:${g("minute")}`;
}

/** Client-side mirror of the DB rule in b2b_quote_update. Returns an Arabic message or null. */
export function statusChangeBlocker(input: {
  next: B2BStatus; amount: number | null | undefined; existingAmount: number | null | undefined; reason: string;
}): string | null {
  const amount = input.amount ?? input.existingAmount ?? null;
  if ((input.next === "quote_sent" || input.next === "contracted") && (amount === null || !(amount > 0)))
    return "اكتب قيمة العرض أولاً";
  if (input.next === "rejected" && !input.reason.trim()) return "اكتب سبب الرفض";
  return null;
}

export interface QuoteFilters {
  status: B2BStatus | "all";
  type: FacilityType | "all";
  governorate: string | "all";
  search: string;
  matchOnly: boolean;
  mineOnly?: boolean;
  userId?: string | null;
}

export interface QuoteListRow {
  id: string;
  ref_no: number;
  facility_name: string;
  facility_type: FacilityType;
  contact_name: string;
  governorate: string;
  status: B2BStatus;
  possible_match: boolean;
  assigned_to: string | null;
}

const norm = (s: string) => s.toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").trim();

export function filterQuotes<T extends QuoteListRow>(rows: T[], f: QuoteFilters): T[] {
  const q = norm(f.search);
  const refQ = f.search.trim().toUpperCase().replace(/^HQ-?/, "");
  return rows.filter((r) =>
    (f.status === "all" || r.status === f.status) &&
    (f.type === "all" || r.facility_type === f.type) &&
    (f.governorate === "all" || r.governorate === f.governorate) &&
    (!f.matchOnly || r.possible_match) &&
    (!f.mineOnly || (f.userId != null && r.assigned_to === f.userId)) &&
    (!q || norm(r.facility_name).includes(q) || norm(r.contact_name).includes(q) || (refQ !== "" && String(r.ref_no) === refQ)),
  );
}

export function statusCounts(rows: { status: B2BStatus }[]): Record<B2BStatus | "all", number> {
  const out = { all: rows.length, new: 0, contacted: 0, quote_sent: 0, contracted: 0, rejected: 0 } as Record<B2BStatus | "all", number>;
  for (const r of rows) out[r.status] += 1;
  return out;
}

const ERRORS: Record<string, string> = {
  b2b_quote_forbidden: "ليس لديك صلاحية على هذا الطلب",
  b2b_quote_not_found: "الطلب غير موجود",
  b2b_quote_bad_assignee: "يمكن الإسناد لمودريتور المبيعات أو مدير المبيعات فقط",
  b2b_quote_bad_status: "حالة غير صحيحة",
  b2b_quote_amount_required: "اكتب قيمة العرض أولاً",
  b2b_quote_reason_required: "اكتب سبب الرفض",
  b2b_quote_already_linked: "الطلب مربوط بعميل بالفعل",
  b2b_quote_customer_not_candidate: "العميل ليس من قائمة المطابقة",
};

export function b2bErrorMessage(err: { message?: string } | null | undefined): string {
  const m = err?.message ?? "";
  const key = Object.keys(ERRORS).find((k) => m.includes(k));
  return key ? ERRORS[key] : "تعذّر تنفيذ العملية";
}
