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
  image_url?: string | null;
  removed_at: string | null;
}

export interface MapRow {
  woo_product_id: number;
  woo_variation_id: number;
  kind: "product" | "offer_box";
  product_id: string | null;
  offer_box_id: string | null;
}

export interface CocProduct {
  id: string;
  name: string;
  price: number | null;
  barcode: string | null;
  image_url?: string | null;
  is_active: boolean;
}

export interface BoxItemSummary {
  id?: string;
  name: string;
  quantity: number;
  is_gift: boolean;
  custom_price?: number | null;
}

export interface CocBox {
  id: string;
  name: string;
  offer_price: number | null;
  shipping_cost: number | null;
  is_active: boolean;
  image_url?: string | null;
  items?: BoxItemSummary[];
  starts_at?: string | null;
  expires_at?: string | null;
  site_hidden_by_validity?: boolean;
}

export interface CatalogRow {
  site: SiteProduct;
  map: MapRow | null;
  product: CocProduct | null;
  box: CocBox | null;
  cocPrice: number | null;
  priceDiff: number | null; // site − coc
  displayImage: string | null;
  kind: "product" | "offer_box";
}

const n = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

/** تنسيق موحّد بالأرقام اللاتينية كما في بقية شاشات التطبيق (مثل 1,500 ج.م وبوكس 1010). */
const numFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

export function formatNum(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return "—";
  return numFmt.format(Number(v));
}

export function formatEgp(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return "—";
  return `${numFmt.format(Number(v))} ج.م`;
}

export function formatSignedEgp(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return "—";
  const num = Number(v);
  if (num === 0) return "0 ج.م";
  return `${num > 0 ? "+" : "-"}${numFmt.format(Math.abs(num))} ج.م`;
}

export function formatCairoLatn(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("ar-EG-u-nu-latn", {
    timeZone: "Africa/Cairo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function buildCatalogRows(site: SiteProduct[], maps: MapRow[], products: CocProduct[], boxes: CocBox[]): CatalogRow[] {
  return site.map((s) => {
    const map =
      maps.find((m) => Number(m.woo_product_id) === Number(s.woo_product_id) && Number(m.woo_variation_id) === Number(s.woo_variation_id)) ?? null;
    const product = map?.kind === "product" ? products.find((p) => p.id === map.product_id) ?? null : null;
    const box = map?.kind === "offer_box" ? boxes.find((b) => b.id === map.offer_box_id) ?? null : null;
    const cocPrice = product ? n(product.price) : box ? n(box.offer_price) : null;
    const sitePrice = n(s.price);
    const priceDiff = cocPrice !== null && sitePrice !== null ? Math.round((sitePrice - cocPrice) * 100) / 100 : null;
    const displayImage = (s.image_url?.trim() || product?.image_url?.trim() || box?.image_url?.trim() || null) as string | null;
    const kind: "product" | "offer_box" = map?.kind === "offer_box" || /بوكس|عرض/.test(s.name) ? "offer_box" : "product";
    return { site: s, map, product, box, cocPrice, priceDiff, displayImage, kind };
  });
}

/** منتجات وعروض النظام النشطة غير الموجودة على الموقع. */
export function cocNotOnSite(products: CocProduct[], boxes: CocBox[], maps: MapRow[]) {
  const pIds = new Set(maps.filter((m) => m.product_id).map((m) => m.product_id));
  const bIds = new Set(maps.filter((m) => m.offer_box_id).map((m) => m.offer_box_id));
  return {
    products: products.filter((p) => p.is_active && !pIds.has(p.id)),
    boxes: boxes.filter((b) => b.is_active && !bIds.has(b.id)),
  };
}

export type SiteStatusFilter = "all" | "mapped" | "unmapped" | "diff" | "removed" | "sku_mismatch" | "no_image";
export type TypeFilter = "all" | "product" | "offer_box";
export type SortKey = "name_asc" | "price_desc" | "price_asc" | "diff_desc";

export function filterAndSortSiteRows(
  rows: CatalogRow[],
  opts: { query: string; type: TypeFilter; status: SiteStatusFilter; sort: SortKey },
): CatalogRow[] {
  const q = opts.query.trim().toLowerCase();
  const list = rows.filter((r) => {
    if (opts.type !== "all" && r.kind !== opts.type) return false;
    if (opts.status === "unmapped" && (r.map || r.site.removed_at)) return false;
    if (opts.status === "mapped" && !r.map) return false;
    if (opts.status === "diff" && !r.priceDiff) return false;
    if (opts.status === "removed" && !r.site.removed_at) return false;
    if (opts.status === "sku_mismatch" && skuState(r) !== "mismatch") return false;
    if (opts.status === "no_image" && r.displayImage) return false;
    if (!q) return true;
    const hay = [
      r.site.name,
      String(r.site.woo_product_id),
      r.site.sku ?? "",
      r.product?.name ?? "",
      r.product?.barcode ?? "",
      r.box?.name ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });

  return [...list].sort((a, b) => {
    if (opts.sort === "price_desc") return (b.site.price ?? -1) - (a.site.price ?? -1);
    if (opts.sort === "price_asc") return (a.site.price ?? Number.MAX_SAFE_INTEGER) - (b.site.price ?? Number.MAX_SAFE_INTEGER);
    if (opts.sort === "diff_desc") return Math.abs(b.priceDiff ?? 0) - Math.abs(a.priceDiff ?? 0);
    return a.site.name.localeCompare(b.site.name, "ar");
  });
}

export interface CocMissingItem {
  kind: "product" | "offer_box";
  id: string;
  name: string;
  price: number | null;
  shipping_cost: number | null;
  barcode: string | null;
  image_url: string | null;
  items: BoxItemSummary[];
  starts_at?: string | null;
  expires_at?: string | null;
}

export function buildMissingItems(products: CocProduct[], boxes: CocBox[]): CocMissingItem[] {
  const bRows: CocMissingItem[] = boxes.map((b) => ({
    kind: "offer_box",
    id: b.id,
    name: b.name,
    price: n(b.offer_price),
    shipping_cost: n(b.shipping_cost),
    barcode: null,
    image_url: b.image_url?.trim() || null,
    items: b.items ?? [],
    starts_at: b.starts_at ?? null,
    expires_at: b.expires_at ?? null,
  }));
  const pRows: CocMissingItem[] = products.map((p) => ({
    kind: "product",
    id: p.id,
    name: p.name,
    price: n(p.price),
    shipping_cost: null,
    barcode: p.barcode ?? null,
    image_url: p.image_url?.trim() || null,
    items: [],
  }));
  return [...bRows, ...pRows];
}

export function filterAndSortMissing(
  items: CocMissingItem[],
  opts: { query: string; type: TypeFilter; sort: SortKey },
): CocMissingItem[] {
  const q = opts.query.trim().toLowerCase();
  const list = items.filter((it) => {
    if (opts.type !== "all" && it.kind !== opts.type) return false;
    if (!q) return true;
    return [it.name, it.barcode ?? "", ...it.items.map((x) => x.name)].join(" ").toLowerCase().includes(q);
  });
  return [...list].sort((a, b) => {
    if (opts.sort === "price_desc") return (b.price ?? -1) - (a.price ?? -1);
    if (opts.sort === "price_asc") return (a.price ?? Number.MAX_SAFE_INTEGER) - (b.price ?? Number.MAX_SAFE_INTEGER);
    return a.name.localeCompare(b.name, "ar");
  });
}

export function summarizeBoxItems(items: BoxItemSummary[], maxShow = 3): string {
  if (!items.length) return "بدون مكونات مسجّلة";
  const shown = items.slice(0, maxShow).map((i) => `${i.name} × ${formatNum(i.quantity)}${i.is_gift ? " (هدية)" : ""}`);
  const rest = items.length - shown.length;
  return rest > 0 ? `${shown.join("، ")} + ${formatNum(rest)} أخرى` : shown.join("، ");
}

export function suggestionFor(
  wooId: number,
  suggestions: WooMapSuggestion[],
  products: CocProduct[],
): (WooMapSuggestion & { product: CocProduct }) | null {
  const s = suggestions.find((x) => x.woo_product_id === wooId);
  const product = s ? products.find((p) => p.id === s.product_id) : undefined;
  return s && product ? { ...s, product } : null;
}

export const isCompanyBarcode = (b: string | null | undefined) => /^622400320\d{4}$/.test(String(b ?? "").trim());

/** يقترح الباركود من رمز الصنف على الموقع فقط إن كان باركود الشركة؛ لا اختراع. */
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

export interface BoxItemDraft {
  product_id: string;
  quantity: number;
  custom_price: number;
  is_gift: boolean;
}

/** قاعدة العروض في النظام: سعر العرض = مجموع المكونات المدفوعة + الشحن. */
export function boxImportCheck(sitePrice: number | null, shipping: number | null, items: BoxItemDraft[]) {
  const paid = items.filter((i) => !i.is_gift).reduce((s, i) => s + (Number(i.custom_price) || 0) * (Number(i.quantity) || 0), 0);
  const total = Math.round((paid + (Number(shipping) || 0)) * 100) / 100;
  const ok = sitePrice !== null && items.length > 0 && items.every((i) => i.product_id && i.quantity > 0) && total === Number(sitePrice);
  return { paid: Math.round(paid * 100) / 100, total, ok };
}

export const CHANGE_FIELD_LABELS: Record<string, string> = {
  name: "الاسم",
  regular_price: "السعر",
  price: "السعر المعروض",
  sale_price: "سعر التخفيض",
  sku: "رمز الصنف (الباركود)",
  short_description: "مكونات العرض",
  status: "الحالة على الموقع",
  shipping_class: "فئة الشحن على الموقع",
  image_url: "صورة المنتج",
  catalog_visibility: "الظهور في المتجر",
  date_on_sale_from: "بداية التخفيض",
  date_on_sale_to: "نهاية التخفيض",
};

export const WARNING_LABELS: Record<string, string> = {
  preview_from_cache: "المعاينة من آخر نسخة محفوظة لمنتجات الموقع لأن مفاتيح الكتابة غير مضبوطة بعد.",
  no_company_barcode_sku_left_empty: "لا يوجد باركود للشركة على المنتج، لذلك لن يُرسل رمز الصنف.",
  box_price_includes_shipping: "سعر العرض في النظام يشمل تكلفة الشحن كما هو، ولن يُرسل الشحن منفصلاً.",
  box_free_shipping_class: "سيُضبط العرض على فئة الشحن المجاني للبوكسات حتى لا يُضاف شحن ثانٍ على الموقع.",
  box_identity_kept: "يبقى العرض نفسه (الاسم والمكونات والكميات والهدايا)، والشحن ضمن السعر بدون تغيير.",
  coc_price_unchanged: "سعر COCEG لن يتغير؛ التخفيض على الموقع فقط.",
  box_site_price_differs_from_coc: "سعر العرض على الموقع سيختلف عن سعر العرض في COCEG (المرتبط بمكوناته والشحن ضمنه).",
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
  backup_not_found: "لم نعثَر على النسخة الاحتياطية لهذا التعديل",
  bad_backup_id: "نسخة الاسترجاع غير محددة",
  WOO_DATES_REQUIRED: "حدّدي تاريخ بداية ونهاية لمدة العرض",
  WOO_END_BEFORE_START: "تاريخ البداية يجب أن يسبق تاريخ الانتهاء",
  dates_required: "حدّدي تاريخ بداية ونهاية لمدة العرض",
  end_before_start: "تاريخ البداية يجب أن يسبق تاريخ الانتهاء",

  already_on_site: "هذا البند موجود بالفعل على الموقع",
  not_mapped: "هذا البند غير مربوط بمنتج على الموقع",
  coc_price_missing: "لا يوجد سعر مسجّل لهذا البند",
  box_has_no_items: "العرض بلا مكونات",
  forbidden: "ليس لديك صلاحية",
  duplicate_sku: "هذا الكود مستخدم لمنتج آخر على الموقع؛ لا يُسمح بتكرار رمز الصنف",
  coc_barcode_not_registered: "لا يوجد باركود شركة مسجّل لهذا المنتج في COCEG (الكود تحت التسجيل)؛ لن يُخترع كود",
  sku_needs_mapped_product: "مطابقة الكود متاحة للمنتجات المربوطة فقط؛ العروض بلا باركود",
  coc_image_missing: "لا توجد صورة لهذا البند في COCEG بعد",
  sale_not_below_price: "سعر التخفيض يجب أن يكون أقل من سعر الموقع",
  sale_price_invalid: "سعر التخفيض غير صحيح",
  sale_dates_invalid: "تواريخ التخفيض غير صحيحة",
  price_invalid: "السعر غير صحيح",
  site_price_missing: "لا يوجد سعر أساسي للمنتج على الموقع",
  woo_product_not_found: "منتج الموقع غير موجود",
  WEB_IMAGE_URL_INVALID: "رابط الصورة غير مقبول",
  WEB_TARGET_NOT_FOUND: "البند غير موجود",
  WEB_PRICE_INVALID: "السعر غير صحيح",
};

export function syncErrorMessage(message: string | null | undefined): string {
  const msg = String(message ?? "");
  const code = Object.keys(ERRORS).sort((a, b) => b.length - a.length).find((k) => msg.includes(k));
  if (!code) return "تعذّر تنفيذ العملية، يُرجى المحاولة مرة أخرى";
  if (code === "WOO_IMPORT_MISSING") return `بيانات ناقصة: ${msg.split("WOO_IMPORT_MISSING:")[1]?.trim() ?? ""}`.trim();
  return ERRORS[code];
}


// ── إدارة المنتجات من الشاشة (الصور، الأسعار، الظهور، التخفيض، الكود) ──────────

/**
 * مطابقة الكود: باركود coceg هو المصدر ويجب أن يساوي رمز الصنف (SKU) على الموقع.
 *  - match: متطابق
 *  - mismatch: «الكود غير مطابق» (يوجد باركود شركة في coceg يختلف عن الموقع)
 *  - pending: «الكود تحت التسجيل» (لا يوجد باركود شركة مسجّل؛ يبقى رمز الموقع فارغاً ولا يُخترع)
 *  - na: غير مربوط أو عرض (العروض بلا باركود)
 */
export type SkuState = "match" | "mismatch" | "pending" | "na";

export function skuState(row: Pick<CatalogRow, "product" | "site" | "map">): SkuState {
  if (!row.map || !row.product) return "na";
  const b = String(row.product.barcode ?? "").trim();
  if (!isCompanyBarcode(b)) return "pending";
  return String(row.site.sku ?? "").trim() === b ? "match" : "mismatch";
}

/** رموز أصناف مكررة على أكثر من منتج ظاهر على الموقع. */
export function duplicateSiteSkus(site: SiteProduct[]): Set<string> {
  const seen = new Map<string, number>();
  for (const s of site) {
    const k = String(s.sku ?? "").trim();
    if (!k || s.removed_at) continue;
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  return new Set([...seen].filter(([, c]) => c > 1).map(([k]) => k));
}

/** هل يسبب نسخ باركود coceg إلى هذا المنتج تكراراً لرمز صنف منتج آخر على الموقع؟ */
export function skuWouldDuplicate(row: CatalogRow, site: SiteProduct[]): boolean {
  const b = String(row.product?.barcode ?? "").trim();
  if (!b) return false;
  return site.some((s) => !s.removed_at && s.woo_product_id !== row.site.woo_product_id && String(s.sku ?? "").trim() === b);
}

/** قاعدة العروض: سعر العرض = مجموع المكونات المدفوعة × الكمية + الشحن (الشحن ضمن السعر). */
export function boxPriceFromItems(items: BoxItemSummary[], shipping: number | null | undefined): number {
  const paid = items.filter((i) => !i.is_gift).reduce((sum, i) => sum + (Number(i.custom_price) || 0) * (Number(i.quantity) || 0), 0);
  return Math.round((paid + (Number(shipping) || 0)) * 100) / 100;
}

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const IMAGE_BUCKET = "website-product-images";

/** يتحقق من ملف الصورة قبل الضغط (النوع والحجم الخام حتى 10 ميجابايت). */
export function imageFileProblem(file: { type: string; size: number }): string | null {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) return "يُسمح بصور JPG أو PNG أو WebP فقط";
  if (file.size > 10 * 1024 * 1024) return "حجم الصورة كبير جداً (الحد الأقصى 10 ميجابايت قبل الضغط)";
  return null;
}

export const imageStoragePath = (kind: "product" | "offer_box", id: string, now = Date.now()) => `${kind}/${id}/${now}.webp`;

export const SITE_STATUS_LABELS: Record<string, string> = {
  publish: "منشور",
  draft: "مسودة (مخفي)",
  pending: "قيد المراجعة",
  private: "خاص",
  visible: "ظاهر في المتجر والبحث",
  hidden: "مخفي من المتجر والبحث",
  catalog: "المتجر فقط",
  search: "البحث فقط",
};

export function changeValueLabel(field: string, v: string | null | undefined): string {
  const s = String(v ?? "");
  if (!s) return "—";
  if (field === "status" || field === "catalog_visibility") return SITE_STATUS_LABELS[s] ?? s;
  if (field === "regular_price" || field === "sale_price") return formatEgp(Number(s));
  return s;
}
