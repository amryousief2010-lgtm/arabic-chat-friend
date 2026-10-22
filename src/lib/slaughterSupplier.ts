/** المجزر قسم داخلي وليس موردًا؛ يُستخدم لمنع فواتير شراء مصنع اللحوم من «المجزر». */
export function normalizeSupplierName(name: string | null | undefined): string {
  return String(name ?? "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/[\u064B-\u0652\u0640]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

export function isSlaughterhouseSupplier(name: string | null | undefined): boolean {
  const n = normalizeSupplierName(name);
  return n.includes("مجزر") || n.includes("slaughter");
}

export const SLAUGHTER_SUPPLIER_MESSAGE =
  "المجزر قسم داخلي وليس موردًا. أرسل اللحم من شاشة المجزر بوجهة «مصنع اللحوم»، ثم استلمه من شاشة «وارد المجزر» في مصنع اللحوم بتكلفة الدفعة.";

export const SLAUGHTER_INBOX_PATH = "/meat-factory/slaughter-inbox";
