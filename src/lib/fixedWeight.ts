/**
 * منتجات وزنها ثابت (قطعة كاملة لا تُجزَّأ ولا تُزاد، مثل دبوس النعام 6 كجم).
 * الكمية في أي سطر طلب تكون دائماً من مضاعفات الوزن الثابت (6 أو 12 أو 18 …).
 * يطابق الفحص نفسه ما يفرضه التريجر `enforce_fixed_weight_qty` في قاعدة البيانات.
 */
export interface FixedWeightProduct {
  name?: string | null;
  fixed_weight_kg?: number | string | null;
}

/** الوزن الثابت للمنتج بالكجم، أو null لو المنتج عادي. */
export function fixedWeightOf(p: FixedWeightProduct | null | undefined): number | null {
  const n = Number(p?.fixed_weight_kg);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const EPS = 1e-6;

/** هل الكمية (بالكجم) عدد صحيح من القطع ذات الوزن الثابت؟ */
export function isFixedWeightQtyValid(qty: number, fixedKg: number): boolean {
  const q = Number(qty);
  if (!Number.isFinite(q) || q <= 0 || !(fixedKg > 0)) return false;
  const pieces = q / fixedKg;
  return Math.abs(pieces - Math.round(pieces)) < EPS && Math.round(pieces) >= 1;
}

/** أقرب كمية صالحة (تُقرَّب لأعلى لأقرب قطعة كاملة، وبحد أدنى قطعة). */
export function snapFixedWeightQty(qty: number, fixedKg: number): number {
  const q = Number(qty);
  const pieces = Number.isFinite(q) && q > 0 ? Math.max(1, Math.ceil(q / fixedKg - EPS)) : 1;
  return Math.round(pieces * fixedKg * 1000) / 1000;
}

export function fixedPieces(qty: number, fixedKg: number): number {
  return Math.round((Number(qty) / fixedKg) * 1000) / 1000;
}

export function fixedWeightLabel(fixedKg: number): string {
  return `${Number.isInteger(fixedKg) ? fixedKg : fixedKg.toLocaleString("en")} كجم`;
}

/** رسالة المنع لسطر كميته ليست من مضاعفات الوزن الثابت. */
export function fixedWeightError(name: string, qty: number, fixedKg: number): string {
  return `«${name}» قطعة كاملة وزنها ثابت ${fixedWeightLabel(fixedKg)} ولا تُجزَّأ ولا تُزاد؛ الكمية ${qty} كجم غير صالحة (الكمية تكون ${fixedWeightLabel(fixedKg)} أو ${fixedWeightLabel(fixedKg * 2)} …).`;
}

/** أول سطر مخالف في قائمة بنود (أو null). */
export function firstFixedWeightViolation<T extends { quantity: number; product?: FixedWeightProduct | null; name?: string | null }>(
  items: T[],
): { name: string; qty: number; fixedKg: number } | null {
  for (const it of items) {
    const fw = fixedWeightOf(it.product);
    if (fw && !isFixedWeightQtyValid(it.quantity, fw)) {
      return { name: it.product?.name ?? it.name ?? "", qty: Number(it.quantity), fixedKg: fw };
    }
  }
  return null;
}
