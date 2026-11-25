/**
 * صلاحية العرض: «مفتوح بدون مدة» (الافتراضي) أو «له مدة» بتاريخ بداية ونهاية.
 * نعتمد starts_at / expires_at الموجودين؛ القيم الفارغة = مفتوح.
 * خارج النافذة لا يُختار العرض لطلبات جديدة؛ الطلبات القائمة لا تُمس.
 */

export type ValidityMode = "open" | "window";

export type ValidityState = "open" | "scheduled" | "active" | "expired";

export interface OfferValidity {
  starts_at: string | null;
  expires_at: string | null;
}

const t = (v: string | null | undefined) => {
  const s = String(v ?? "").trim();
  return s ? s : null;
};

/** وضع الواجهة من التواريخ المخزّنة (العروض الحالية بلا تواريخ تبقى مفتوحة). */
export function validityModeOf(v: OfferValidity): ValidityMode {
  return t(v.starts_at) || t(v.expires_at) ? "window" : "open";
}

export function validityState(v: OfferValidity, now: Date = new Date()): ValidityState {
  const start = t(v.starts_at);
  const end = t(v.expires_at);
  if (!start && !end) return "open";
  if (start && new Date(start).getTime() > now.getTime()) return "scheduled";
  if (end && new Date(end).getTime() <= now.getTime()) return "expired";
  return "active";
}

/** يُختار لطلب جديد إذا كان نشطًا وفي نافذته (أو مفتوحًا بلا مدة). */
export function offerBoxIsSelectable(
  box: OfferValidity & { is_active?: boolean | null },
  now: Date = new Date(),
): boolean {
  if (box.is_active === false) return false;
  const state = validityState(box, now);
  return state === "open" || state === "active";
}

/** هل يجب إخفاء المنتج المربوط على الموقع؟ (خارج النافذة فقط — ليس مجرد إيقاف يدوي). */
export function shouldHideOnSite(v: OfferValidity, now: Date = new Date()): boolean {
  const state = validityState(v, now);
  return state === "scheduled" || state === "expired";
}

export function parseValidityInput(mode: ValidityMode, startsAt: string | null | undefined, expiresAt: string | null | undefined):
  | { ok: true; starts_at: string | null; expires_at: string | null }
  | { ok: false; error: "dates_required" | "end_before_start" } {
  if (mode === "open") return { ok: true, starts_at: null, expires_at: null };
  const starts_at = t(startsAt);
  const expires_at = t(expiresAt);
  if (!starts_at || !expires_at) return { ok: false, error: "dates_required" };
  if (new Date(starts_at).getTime() >= new Date(expires_at).getTime()) return { ok: false, error: "end_before_start" };
  return { ok: true, starts_at, expires_at };
}

export const VALIDITY_STATE_LABELS: Record<ValidityState, string> = {
  open: "مفتوح بدون مدة",
  scheduled: "لم يبدأ بعد",
  active: "ساري المدة",
  expired: "انتهت الصلاحية",
};

/** تواريخ للعرض بالأرقام اللاتينية. */
export function formatValidityDate(iso: string | null | undefined): string {
  if (!t(iso)) return "";
  const d = new Date(iso!);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

/** قيمة datetime-local من timestamptz (محليًا في المتصفح). */
export function toDatetimeLocal(iso: string | null | undefined): string {
  if (!t(iso)) return "";
  const d = new Date(iso!);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
