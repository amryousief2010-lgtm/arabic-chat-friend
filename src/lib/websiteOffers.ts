/**
 * تقسيم شاشة «منتجات الموقع» إلى قسمين: «منتجات الموقع» و«العروض والصناديق».
 * منطق خالص بدون React — قابل للاختبار. لا يكتب شيئاً.
 */
import { validityState } from "@/lib/offerValidity";
import { type CatalogRow, type CocBox, type CocProduct, type MapRow, hasPriceMismatch } from "@/lib/websiteProducts";

export type CatalogSection = "products" | "offers";

/** قسم صف الموقع: العروض والبوكسات (مربوطة أو بالاسم) في قسم العروض، والباقي منتجات. */
export function sectionOfRow(r: Pick<CatalogRow, "kind">): CatalogSection {
  return r.kind === "offer_box" ? "offers" : "products";
}

export function rowsForSection(rows: CatalogRow[], section: CatalogSection): CatalogRow[] {
  return rows.filter((r) => sectionOfRow(r) === section);
}

/** حالة العرض في COCEG: موقوف يدوياً، أو حسب مدة الصلاحية. */
export type OfferStatus = "active" | "scheduled" | "expired" | "inactive";

export const OFFER_STATUS_LABELS: Record<OfferStatus, string> = {
  active: "ساري",
  scheduled: "لم يبدأ بعد",
  expired: "منتهي الصلاحية",
  inactive: "موقوف في COCEG",
};

export function offerStatus(box: Pick<CocBox, "is_active" | "starts_at" | "expires_at">, now: Date = new Date()): OfferStatus {
  if (!box.is_active) return "inactive";
  const v = validityState({ starts_at: box.starts_at ?? null, expires_at: box.expires_at ?? null }, now);
  if (v === "expired") return "expired";
  if (v === "scheduled") return "scheduled";
  return "active";
}

export interface OfferOverview {
  box: CocBox;
  status: OfferStatus;
  /** كل روابط الموقع لهذا العرض (من woo_product_map). */
  maps: MapRow[];
  /** صف الموقع الأساسي (الظاهر أولاً) إن وُجد في نسخة الموقع المحلية. */
  primary: CatalogRow | null;
  linked: boolean;
  /** مربوط لكن غير ظاهر على الموقع (محذوف/مسودة) أو غير موجود في آخر نسخة من الموقع. */
  hiddenOnSite: boolean;
  wooProductId: number | null;
  sitePrice: number | null;
  permalink: string | null;
  priceMismatch: boolean;
}

/** نظرة شاملة على كل عروض وبوكسات COCEG (المنشورة وغير المنشورة). */
export function buildOfferOverview(boxes: CocBox[], maps: MapRow[], rows: CatalogRow[], now: Date = new Date()): OfferOverview[] {
  return boxes.map((box) => {
    const boxMaps = maps.filter((m) => m.kind === "offer_box" && m.offer_box_id === box.id);
    const linkedRows = rows.filter((r) => r.box?.id === box.id);
    const primary = linkedRows.find((r) => !r.site.removed_at) ?? linkedRows[0] ?? null;
    const linked = boxMaps.length > 0;
    const wooProductId = primary?.site.woo_product_id ?? (boxMaps[0] ? Number(boxMaps[0].woo_product_id) : null);
    return {
      box,
      status: offerStatus(box, now),
      maps: boxMaps,
      primary,
      linked,
      hiddenOnSite: linked && (!primary || !!primary.site.removed_at),
      wooProductId,
      sitePrice: primary?.site.price ?? null,
      permalink: primary?.site.permalink ?? null,
      priceMismatch: linkedRows.some(hasPriceMismatch),
    };
  });
}

export type OfferFilter = "all" | "linked" | "unlinked" | "diff" | "active" | "expired" | "inactive";

export function filterAndSortOffers(
  list: OfferOverview[],
  opts: { query: string; filter: OfferFilter; sort: "name_asc" | "price_desc" | "price_asc" | "diff_desc" },
): OfferOverview[] {
  const q = opts.query.trim().toLowerCase();
  const out = list.filter((o) => {
    if (opts.filter === "linked" && !o.linked) return false;
    if (opts.filter === "unlinked" && o.linked) return false;
    if (opts.filter === "diff" && !o.priceMismatch) return false;
    if (opts.filter === "active" && o.status !== "active") return false;
    if (opts.filter === "expired" && o.status !== "expired") return false;
    if (opts.filter === "inactive" && o.status !== "inactive") return false;
    if (!q) return true;
    const hay = [o.box.name, o.wooProductId ? String(o.wooProductId) : "", o.primary?.site.name ?? "", ...(o.box.items ?? []).map((i) => i.name)]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
  const price = (o: OfferOverview) => (o.box.offer_price === null || o.box.offer_price === undefined ? null : Number(o.box.offer_price));
  return [...out].sort((a, b) => {
    if (opts.sort === "price_desc") return (price(b) ?? -1) - (price(a) ?? -1);
    if (opts.sort === "price_asc") return (price(a) ?? Number.MAX_SAFE_INTEGER) - (price(b) ?? Number.MAX_SAFE_INTEGER);
    if (opts.sort === "diff_desc") return Math.abs(b.primary?.priceDiff ?? 0) - Math.abs(a.primary?.priceDiff ?? 0);
    return a.box.name.localeCompare(b.box.name, "ar");
  });
}

export interface SectionCounts {
  products: { onSite: number; linked: number; notOnSite: number; diffs: number };
  offers: { total: number; linked: number; unlinked: number; diffs: number };
}

/** عدادات بطاقتي القسمين أعلى الشاشة. */
export function sectionCounts(rows: CatalogRow[], offers: OfferOverview[], missingProducts: CocProduct[]): SectionCounts {
  const prod = rowsForSection(rows, "products").filter((r) => !r.site.removed_at);
  const linkedOffers = offers.filter((o) => o.linked).length;
  return {
    products: {
      onSite: prod.length,
      linked: prod.filter((r) => !!r.map).length,
      notOnSite: missingProducts.length,
      diffs: rowsForSection(rows, "products").filter(hasPriceMismatch).length,
    },
    offers: {
      total: offers.length,
      linked: linkedOffers,
      unlinked: offers.length - linkedOffers,
      diffs: rowsForSection(rows, "offers").filter(hasPriceMismatch).length,
    },
  };
}

/** هل يمكن نشر العرض غير المربوط عبر مسار «إضافة إلى الموقع» الموجود؟ (نفس شرط تبويب «في COCEG وليست على الموقع»). */
export function offerAddDisabledReason(o: OfferOverview): string | null {
  if (o.linked) return null;
  if (o.status === "inactive") return "العرض موقوف في COCEG؛ فعّله أولاً من شاشة العروض والبوكسات";
  if (o.status === "expired") return "انتهت صلاحية العرض؛ عدّل مدة الصلاحية أولاً";
  return null;
}
