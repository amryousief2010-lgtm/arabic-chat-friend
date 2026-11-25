/** منطق شاشة «منتجات الموقع» (بدون React) — قابل للاختبار. */
import type { WooMapSuggestion } from "@/data/wooMapSuggestions";

export const COMPANY_BARCODE_PREFIX = "622400320";

export interface SiteProduct {
  woo_product_id: number;
  woo_variation_id: number;
  name: string;
  sku: string | null;
  price: number | null;
  regular_price: number | null;
  sale_price: number | null;
  permalink: string | null;
  removed_at: string | null;
}
export interface MapRow { woo_product_id: number; woo_variation_id: number; kind: "product" | "offer_box"; product_id: string | null; offer_box_id: string | null }
export interface CocProduct { id: string; name: string; price: number | null; barcode: string | null; is_active: boolean }
export interface CocBox { id: string; name: string; offer_price: number | null; shipping_cost: number | null; is_active: boolean }

export interface CatalogRow {
  site: SiteProduct;
  map: MapRow | null;
  product: CocProduct | null;
  box: CocBox | null;
  cocPrice: number | null;
  priceDiff: number | null; // site − coc
}

const n = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

export function buildCatalogRows(site: SiteProduct[], maps: MapRow[], products: CocProduct[], boxes: CocBox[]): CatalogRow[] {
  return site.map((s) => {
    const map = maps.find((m) => Number(m.woo_product_id) === Number(s.woo_product_id) && Number(m.woo_variation_id) === Number(s.woo_variation_id)) ?? null;
    const product = map?.kind === "product" ? products.find((p) => p.id === map.product_id) ?? null : null;
    const box = map?.kind === "offer_box" ? boxes.find((b) => b.id === map.offer_box_id) ?? null : null;
    const cocPrice = product ? n(product.price) : box ? n(box.offer_price) : null;
    const sitePrice = n(s.price);
    const priceDiff = cocPrice !== null && sitePrice !== null ? Math.round((sitePrice - cocPrice) * 100) / 100 : null;
    return { site: s, map, product, box, cocPrice, priceDiff };
  });
}

/** منتجات وعروض coceg النشطة غير الموجودة على الموقع. */
export function cocNotOnSite(products: CocProduct[], boxes: CocBox[], maps: MapRow[]) {
  const pIds = new Set(maps.filter((m) => m.product_id).map((m) => m.product_id));
  const bIds = new Set(maps.filter((m) => m.offer_box_id).map((m) => m.offer_box_id));
  return {
    products: products.filter((p) => p.is_active && !pIds.has(p.id)),
    boxes: boxes.filter((b) => b.is_active && !bIds.has(b.id)),
  };
}

export function suggestionFor(wooId: number, suggestions: WooMapSuggestion[], products: CocProduct[]): (WooMapSuggestion & { product: CocProduct }) | null {
  const s = suggestions.find((x) => x.woo_product_id === wooId);
  const product = s ? products.find((p) => p.id === s.product_id) : undefined;
  return s && product ? { ...s, product } : null;
}

export const isCompanyBarcode = (b: string | null | undefined) => /^622400320\d{4}$/.test(String(b ?? "").trim());

/** يقترح الباركود من SKU الموقع فقط إن كان باركود الشركة؛ لا اختراع. */
export const barcodeFromSiteSku = (sku: string | null | undefined) => (isCompanyBarcode(sku) ? String(sku).trim() : "");

export interface ImportProductForm {
  name: string;
  price: string;
  cost_price: string;
  pack_weight_kg: string;
  barcode: string;
  barcode_pending: boolean;
}

/** الحقول الناقصة حسب قاعدة المنتج (تكلفة، وزن العبوة، باركود أو «تحت التسجيل»). */
export function importProductMissing(f: ImportProductForm): string[] {
  const out: string[] = [];
  if (!f.name.trim()) out.push("الاسم");
  if (!(Number(f.price) > 0)) out.push("سعر البيع");
  if (!(Number(f.cost_price) > 0)) out.push("التكلفة");
  if (!(Number(f.pack_weight_kg) > 0)) out.push("وزن العبوة");
  if (!f.barcode.trim() && !f.barcode_pending) out.push("الباركود أو «الكود تحت التسجيل»");
  return out;
}

export function barcodeWarning(barcode: string): string | null {
  const b = barcode.trim();
  if (!b) return null;
  if (!/^\d{13}$/.test(b)) return "الباركود يجب أن يتكون من 13 رقماً";
  if (!b.startsWith(COMPANY_BARCODE_PREFIX)) return "الباركود لا يبدأ ببادئة الشركة 622400320؛ يُرجى التأكد منه";
  return null;
}

export interface BoxItemDraft { product_id: string; quantity: number; custom_price: number; is_gift: boolean }

/** قاعدة العروض في coceg: سعر العرض = مجموع المكونات المدفوعة + الشحن. */
export function boxImportCheck(sitePrice: number | null, shipping: number | null, items: BoxItemDraft[]) {
  const paid = items.filter((i) => !i.is_gift).reduce((s, i) => s + (Number(i.custom_price) || 0) * (Number(i.quantity) || 0), 0);
  const total = Math.round((paid + (Number(shipping) || 0)) * 100) / 100;
  const ok = sitePrice !== null && items.length > 0 && items.every((i) => i.product_id && i.quantity > 0) && total === Number(sitePrice);
  return { paid: Math.round(paid * 100) / 100, total, ok };
}

export const CHANGE_FIELD_LABELS: Record<string, string> = {
  name: "الاسم",
  regular_price: "السعر",
  sale_price: "سعر التخفيض",
  sku: "SKU (الباركود)",
  short_description: "مكونات العرض",
  status: "الحالة على الموقع",
  shipping_class: "فئة الشحن على الموقع",
};

export const WARNING_LABELS: Record<string, string> = {
  preview_from_cache: "المعاينة من آخر نسخة محفوظة لمنتجات الموقع لأن مفاتيح الكتابة غير مضبوطة بعد.",
  no_company_barcode_sku_left_empty: "لا يوجد باركود للشركة على المنتج، لذلك لن يُرسل SKU.",
  box_price_includes_shipping: "سعر العرض في coceg يشمل تكلفة الشحن كما هو، ولن يُرسل الشحن منفصلاً.",
  box_free_shipping_class: "سيُضبط العرض على فئة الشحن المجاني للبوكسات حتى لا يُضاف شحن ثانٍ على الموقع.",
};

const ERRORS: Record<string, string> = {
  WOO_NOT_ALLOWED: "ليس لديك صلاحية على منتجات الموقع",
  WOO_BOX_ALREADY_MAPPED: "هذا العرض مربوط بالفعل بمنتج آخر على الموقع؛ لكل عرض منتج واحد فقط",
  WOO_NOT_MAPPED: "هذا المنتج غير مربوط",
  WOO_ALREADY_MAPPED: "منتج الموقع مربوط بالفعل",
  WOO_BOX_PRICE_PULL_BLOCKED: "لا يُسحب سعر العرض من الموقع؛ سعر العرض مرتبط بمكوناته ويُعدَّل من شاشة صناديق العروض",
  WOO_CHANGED_SINCE_PREVIEW: "تغيّرت البيانات بعد المعاينة؛ يُرجى التحديث والمعاينة مجدداً",
  WOO_SITE_PRICE_MISSING: "لا يوجد سعر للمنتج على الموقع",
  WOO_SITE_PRODUCT_NOT_FOUND: "منتج الموقع غير موجود في آخر تحديث",
  WOO_IMPORT_MISSING: "بيانات ناقصة",
  WOO_BARCODE_INVALID: "الباركود يجب أن يتكون من 13 رقماً",
  WOO_BARCODE_DUPLICATE: "هذا الباركود مسجّل لمنتج آخر",
  WOO_BOX_ITEMS_INVALID: "مكونات العرض غير صحيحة",
  WOO_BOX_PRICE_MISMATCH: "مجموع المكونات المدفوعة مع الشحن لا يساوي سعر العرض على الموقع",
  WOO_REASON_REQUIRED: "يُرجى كتابة سبب من 3 أحرف على الأقل",
  WEB_MAP_ONE_TARGET: "يُرجى اختيار منتج واحد أو عرض واحد",
  woo_keys_missing: "مفاتيح الكتابة على الموقع غير مضبوطة بعد؛ المعاينة متاحة والكتابة متوقفة حتى اعتماد المدير العام",
  changed_since_preview: "تغيّر المنتج على الموقع بعد المعاينة؛ يُرجى مراجعة المعاينة الجديدة",
  already_on_site: "هذا البند موجود بالفعل على الموقع",
  not_mapped: "هذا البند غير مربوط بمنتج على الموقع",
  coc_price_missing: "لا يوجد سعر في coceg لهذا البند",
  box_has_no_items: "العرض بلا مكونات",
  forbidden: "ليس لديك صلاحية",
};

export function syncErrorMessage(message: string | null | undefined): string {
  const msg = String(message ?? "");
  const code = Object.keys(ERRORS).sort((a, b) => b.length - a.length).find((k) => msg.includes(k));
  if (!code) return "تعذّر تنفيذ العملية، يُرجى المحاولة مرة أخرى";
  if (code === "WOO_IMPORT_MISSING") return `بيانات ناقصة: ${msg.split("WOO_IMPORT_MISSING:")[1]?.trim() ?? ""}`.trim();
  return ERRORS[code];
}
