// تجميع بنود الأوردر لأغراض العرض المختصر فقط (كارت الأوردر / السطر المختصر).
// لا يُستخدم في تفاصيل الأوردر أو الفواتير أو المخزون أو التارجت،
// ولا يعدّل أي بيانات — مجرد دمج كميات نفس الصنف للعرض.

export interface SummaryItemInput {
  product_id?: string | null;
  product_name: string;
  quantity: number;
  unit?: string | null;
  offer_name?: string | null;
}

export interface SummaryItem {
  key: string;
  product_id: string | null;
  product_name: string;
  quantity: number;
  unit?: string | null;
}

const MASS_UNITS = ['كجم', 'كيلو', 'كيلوجرام', 'kg', 'جم', 'جرام', 'g'];
const isMass = (u?: string | null) => MASS_UNITS.includes((u || '').trim().toLowerCase());

const normalizeName = (name: string) =>
  (name || '')
    .replace(/[\u064B-\u0652]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/**
 * يجمع الأصناف المتكررة (نفس product_id، أو نفس الاسم لو مفيش معرّف)
 * ويجمع الكميات فقط — بدون أي دمج للأسعار.
 * الوحدات الوزنية تُوحَّد على الكيلو حتى تُجمع الكسور بدقة.
 */
export function summarizeOrderItems(items: SummaryItemInput[]): SummaryItem[] {
  const map = new Map<string, SummaryItem>();
  for (const it of items || []) {
    const mass = isMass(it.unit);
    const unitKey = mass ? 'kg' : (it.unit || '').trim().toLowerCase();
    const idKey = it.product_id ? `id:${it.product_id}` : `nm:${normalizeName(it.product_name)}`;
    const key = `${idKey}|${unitKey}`;
    // تحويل الجرامات إلى كيلو حتى تُجمع مع باقي الأسطر الوزنية
    const gram = ['جم', 'جرام', 'g'].includes((it.unit || '').trim().toLowerCase());
    const qty = Number(it.quantity || 0) / (gram ? 1000 : 1);
    const unit = mass ? 'كجم' : it.unit ?? null;
    const existing = map.get(key);
    if (existing) {
      existing.quantity = +(existing.quantity + qty).toFixed(4);
    } else {
      map.set(key, {
        key,
        product_id: it.product_id ?? null,
        product_name: it.product_name,
        quantity: +qty.toFixed(4),
        unit,
      });
    }
  }
  return Array.from(map.values());
}
