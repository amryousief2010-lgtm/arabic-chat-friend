/** منطق شاشة «طلبات الموقع» (بدون React) — قابل للاختبار. */
import { type PackState, packStateFor } from "@/lib/sitePack";

export type InboxKind = "order" | "registration";
export type InboxStatus = "new" | "assigned" | "dismissed" | "cancelled_on_site";

export interface InboxItem {
  woo_product_id: number;
  woo_variation_id?: number | null;
  name: string;
  quantity: number;
  unit_price: number | null;
  line_total?: number | null;
}

export interface ProductMapRow {
  woo_product_id: number;
  woo_variation_id: number;
  kind: "product" | "offer_box";
  product_id: string | null;
  offer_box_id: string | null;
  /** وزن عبوة الموقع بوحدة COCEG (الافتراضي 1). */
  site_pack_qty?: number | null;
  site_pack_label?: string | null;
  site_pack_confirmed_at?: string | null;
}

export interface PackProduct {
  id: string;
  name: string;
  unit?: string | null;
}

export interface MappedItem extends InboxItem {
  map: ProductMapRow | null;
  /** للمنتجات المربوطة: وزن العبوة وما إذا كان يحتاج تأكيداً. */
  pack?: PackState | null;
  unit?: string | null;
}

export const STATUS_LABELS: Record<InboxStatus, string> = {
  new: "جديد",
  assigned: "تم الإسناد",
  dismissed: "مُتجاهَل",
  cancelled_on_site: "ملغى على الموقع",
};

export const KIND_LABELS: Record<InboxKind, string> = {
  order: "طلب",
  registration: "تسجيل عميل",
};

/** 010*****567 — لا يُعرض الرقم كاملاً إلا بطلب صريح. */
export function maskPhone(phone: string | null | undefined): string {
  const digits = String(phone ?? "").replace(/[^0-9]/g, "");
  if (digits.length < 7) return digits ? "***" : "—";
  return `${digits.slice(0, 3)}*****${digits.slice(-3)}`;
}

/** نفس قاعدة القاعدة: ربط المتغيّر أولاً ثم ربط المنتج الأب (variation 0). */
export function findMapping(item: InboxItem, maps: ProductMapRow[]): ProductMapRow | null {
  const variation = Number(item.woo_variation_id || 0);
  const exact = maps.find((m) => m.woo_product_id === item.woo_product_id && m.woo_variation_id === variation);
  if (exact) return exact;
  return maps.find((m) => m.woo_product_id === item.woo_product_id && m.woo_variation_id === 0) ?? null;
}

export function mapItems(items: InboxItem[] | null | undefined, maps: ProductMapRow[], products: PackProduct[] = []): MappedItem[] {
  return (items ?? []).map((it) => {
    const map = findMapping(it, maps);
    const product = map?.kind === "product" ? products.find((p) => p.id === map.product_id) ?? null : null;
    const pack = map?.kind === "product" ? packStateFor(map, it.name, product ?? { unit: "كجم" }) : null;
    return { ...it, map, pack, unit: product?.unit ?? (map?.kind === "product" ? "كجم" : null) };
  });
}

/** عرض/بوكس بسعر شحنه المسجَّل على بيانات العرض في النظام. */
export interface ShippingBox {
  id: string;
  name: string;
  shipping_cost?: number | null;
}

export interface BoxShippingLine {
  offerBoxId: string;
  name: string;
  quantity: number;
  perBox: number;
  total: number;
}

export interface ShippingSummary {
  /** شحن كل بوكس مربوط في الطلب (من بيانات العرض فقط). */
  boxLines: BoxShippingLine[];
  /** مجموع شحن البوكسات = ما يُسجَّل في الطلب بعد الإسناد. */
  boxTotal: number;
  /** بوكسات بلا شحن مسجَّل على العرض. */
  boxesWithoutShipping: string[];
  /** شحن الموقع للعلم فقط، لا يدخل في الطلب أبداً. */
  siteShipping: number;
  siteShippingIgnored: boolean;
}

export const SHIP_BOX_LABEL = "شحن البوكسات (من بيانات العرض)";
export const SHIP_SITE_LABEL = "شحن الموقع";
export const SHIP_SITE_NOTE = "للعلم فقط، لا يُضاف إلى الطلب";
export const SHIP_RULE_TEXT =
  "لا يُنقل شحن المنتجات المنفردة من الموقع إلى الطلب. يحتفظ النظام بشحن البوكسات المسجَّل على العروض فقط، " +
  "ويُحدَّد شحن المنتجات المنفردة يدويًا من المودريتور مع العميل عند المكالمة.";

/** شحن الطلب بعد الإسناد = شحن البوكسات من بيانات العرض فقط؛ شحن الموقع لا يُحتسب. */
export function shippingSummary(items: MappedItem[], boxes: ShippingBox[], siteShipping: number | null | undefined): ShippingSummary {
  const boxLines: BoxShippingLine[] = [];
  for (const it of items) {
    if (it.map?.kind !== "offer_box") continue;
    const box = boxes.find((b) => b.id === it.map?.offer_box_id);
    const perBox = Math.max(Number(box?.shipping_cost ?? 0) || 0, 0);
    const quantity = Math.max(Number(it.quantity) || 0, 0);
    boxLines.push({
      offerBoxId: it.map.offer_box_id ?? "",
      name: box?.name ?? it.name,
      quantity,
      perBox,
      total: Math.round(perBox * quantity * 100) / 100,
    });
  }
  const site = Math.max(Number(siteShipping ?? 0) || 0, 0);
  return {
    boxLines,
    boxTotal: Math.round(boxLines.reduce((s, l) => s + l.total, 0) * 100) / 100,
    boxesWithoutShipping: boxLines.filter((l) => l.perBox === 0).map((l) => l.name),
    siteShipping: site,
    siteShippingIgnored: site > 0,
  };
}

export const packNeedsConfirmCount = (items: MappedItem[]) => items.filter((i) => i.pack?.needsConfirm).length;

export const unmappedCount = (items: MappedItem[]) => items.filter((i) => !i.map).length;

/** سبب منع زر الإسناد (أو null لو مسموح). */
export function assignBlocker(opts: {
  kind: InboxKind;
  status: InboxStatus;
  items: MappedItem[];
  moderatorId: string | null;
  possibleDuplicate: boolean;
  customerChoice: string | null; // customer uuid | "new" | null
}): string | null {
  if (opts.status !== "new") return "هذا السجل ليس جديداً";
  if (!opts.moderatorId) return "يُرجى اختيار المودريتور أولاً";
  if (opts.kind === "registration") return null;
  if (opts.items.length === 0) return "لا توجد بنود في الطلب";
  const n = unmappedCount(opts.items);
  if (n > 0) return `يوجد ${n} بند غير مربوط بمنتج أو عرض في النظام`;
  const p = packNeedsConfirmCount(opts.items);
  if (p > 0) return `يوجد ${p} بند وزن عبوته على الموقع غير مؤكَّد؛ يُرجى تأكيده من شاشة «منتجات الموقع»`;
  if (opts.possibleDuplicate && !opts.customerChoice) return "يوجد عميل بنفس الرقم: يُرجى اختيار العميل الصحيح أو «عميل جديد»";
  return null;
}

/** ملخص مصدر العميل من بيانات الموقع. */
export function attributionLabel(attr: Record<string, string> | null | undefined): string {
  if (!attr) return "مباشر / غير معروف";
  const src = attr.utm_source || attr.source_type || (attr.fbclid ? "facebook" : attr.gclid ? "google" : "") || attr.referrer;
  const parts = [src, attr.utm_medium, attr.utm_campaign].filter(Boolean);
  return parts.length ? parts.join(" · ") : "مباشر / غير معروف";
}

const ERRORS: Record<string, string> = {
  WEB_BAD_INPUT: "بيانات غير صالحة",
  WEB_NOT_ALLOWED: "ليس لديك صلاحية على طلبات الموقع",
  WEB_NOT_FOUND: "السجل غير موجود",
  WEB_NOT_NEW: "تم التعامل مع هذا السجل بالفعل",
  WEB_INVALID_MODERATOR: "المستخدم المختار ليس مودريتور مبيعات",
  WEB_UNMAPPED_ITEMS: "يوجد بند غير مربوط. يُرجى ربطه بمنتج أو عرض أولاً",
  WEB_NO_ITEMS: "لا توجد بنود في الطلب",
  WEB_CUSTOMER_CHOICE_REQUIRED: "يوجد عميل بنفس الرقم: يُرجى اختيار العميل الصحيح أو «عميل جديد»",
  WEB_CUSTOMER_NOT_FOUND: "العميل المختار غير موجود",
  WEB_PHONE_REQUIRED: "لا يوجد رقم هاتف صالح لإنشاء عميل جديد",
  WEB_REASON_REQUIRED: "يُرجى كتابة سبب من 3 أحرف على الأقل",
  WEB_MAP_ONE_TARGET: "يُرجى اختيار منتج واحد أو عرض واحد",
  WEB_PRODUCT_NOT_FOUND: "المنتج غير موجود",
  WEB_BOX_NOT_FOUND: "العرض غير موجود",
};

export function websiteErrorMessage(message: string | null | undefined): string {
  const msg = String(message ?? "");
  const code = Object.keys(ERRORS).find((k) => msg.includes(k));
  return code ? ERRORS[code] : "تعذّر تنفيذ العملية، يُرجى المحاولة مرة أخرى";
}

export const formatCairo = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("ar-EG-u-nu-latn", { timeZone: "Africa/Cairo", dateStyle: "short", timeStyle: "short" }) : "—";
