/**
 * نصوص معاينة كتابة ووكومرس: ما يدفعه العميل الآن وبعد التأكيد،
 * وتحذير إلغاء التخفيض، وخيار الإبقاء عليه. العربية الفصحى، أرقام لاتينية.
 */
import { formatEgp } from "@/lib/websiteProducts";

export type Moneyish = string | number | null | undefined;

export function parseMoney(v: Moneyish): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/ج\.?م/g, "").replace(/,/g, "").replace(/[^\d.-]/g, "").trim());
  return Number.isFinite(n) && String(v).search(/\d/) >= 0 ? n : null;
}

/** سعر التخفيض نافذ إذا كان رقماً موجباً وأقل من السعر الأساسي. */
export function saleIsActive(regular: Moneyish, sale: Moneyish): boolean {
  const r = parseMoney(regular);
  const s = parseMoney(sale);
  return s !== null && s > 0 && (r === null || s < r);
}

/** السعر الذي يدفعه العميل: التخفيض إن كان نافذاً، وإلا السعر الأساسي. */
export function effectiveCustomerPrice(regular: Moneyish, sale: Moneyish): number | null {
  const r = parseMoney(regular);
  const s = parseMoney(sale);
  if (saleIsActive(r, s)) return s;
  return r;
}

export interface PreviewPriceContext {
  beforeRegular: Moneyish;
  beforeSale: Moneyish;
  afterRegular: Moneyish;
  afterSale: Moneyish;
  /** سعر البيع المقصود من النظام (سعر COCEG) لخيار الإبقاء على التخفيض. */
  sellingPrice?: number | null;
}

export function priceContextFromFields(
  before: { regular_price?: Moneyish; sale_price?: Moneyish } | null | undefined,
  after: { regular_price?: Moneyish; sale_price?: Moneyish } | null | undefined,
  sellingPrice?: number | null,
): PreviewPriceContext {
  const beforeRegular = before?.regular_price ?? null;
  const beforeSale = before?.sale_price ?? null;
  return {
    beforeRegular,
    beforeSale,
    afterRegular: after && "regular_price" in after ? after.regular_price : beforeRegular,
    afterSale: after && "sale_price" in after ? after.sale_price : beforeSale,
    sellingPrice: sellingPrice ?? parseMoney(after && "regular_price" in (after ?? {}) ? after!.regular_price : null),
  };
}

/** يستنتج سياق السعر من صفوف الفروق إذا لم يُمرَّر before/after كاملان. */
export function priceContextFromChanges(
  changes: { field: string; before: string | null; after: string }[],
  fallback?: Partial<PreviewPriceContext>,
): PreviewPriceContext {
  const row = (keys: string[]) => changes.find((c) => keys.includes(canonicalPreviewField(c.field)));
  const regular = row(["regular_price"]);
  const sale = row(["sale_price"]);
  return {
    beforeRegular: regular?.before ?? fallback?.beforeRegular ?? null,
    beforeSale: sale?.before ?? fallback?.beforeSale ?? null,
    afterRegular: regular?.after ?? fallback?.afterRegular ?? regular?.before ?? fallback?.beforeRegular ?? null,
    afterSale: sale ? sale.after : (fallback?.afterSale ?? fallback?.beforeSale ?? null),
    sellingPrice: fallback?.sellingPrice ?? parseMoney(regular?.after),
  };
}

export function canonicalPreviewField(field: string): string {
  const f = field.trim();
  if (f === "regular_price" || f.startsWith("السعر الأساسي") || f === "السعر" || f.startsWith("السعر ·")) return "regular_price";
  if (f === "sale_price" || f.startsWith("سعر التخفيض")) return "sale_price";
  if (f === "price" || f.startsWith("السعر النهائي") || f.startsWith("السعر المعروض")) return "price";
  if (f === "sku" || f.includes("الباركود") || f.includes("رمز الصنف")) return "sku";
  return f;
}

export function customerPaySummary(ctx: PreviewPriceContext): string | null {
  const now = effectiveCustomerPrice(ctx.beforeRegular, ctx.beforeSale);
  const next = effectiveCustomerPrice(ctx.afterRegular, ctx.afterSale);
  if (now === null && next === null) return null;
  if (now !== null && next !== null && now === next) {
    return `العميل يدفع الآن ${formatEgp(now)}، وسيبقى كذلك بعد التأكيد.`;
  }
  if (now !== null && next !== null) {
    return `العميل يدفع الآن ${formatEgp(now)} ← بعد التأكيد سيدفع ${formatEgp(next)}.`;
  }
  if (next !== null) return `بعد التأكيد سيدفع العميل ${formatEgp(next)}.`;
  return `العميل يدفع الآن ${formatEgp(now!)}.`;
}

export function saleWouldBeCleared(ctx: PreviewPriceContext): boolean {
  if (!saleIsActive(ctx.beforeRegular, ctx.beforeSale)) return false;
  return !saleIsActive(ctx.afterRegular, ctx.afterSale);
}

export function saleRemovalWarning(ctx: PreviewPriceContext): string | null {
  if (!saleWouldBeCleared(ctx)) return null;
  const regular = parseMoney(ctx.beforeRegular);
  const sale = parseMoney(ctx.beforeSale);
  if (regular === null || sale === null) return "سيتم إلغاء التخفيض الحالي، ولن يظهر السعر الأساسي مشطوباً.";
  return `سيتم إلغاء التخفيض الحالي (${formatEgp(regular)} بدلاً من ${formatEgp(sale)})، ولن يظهر السعر الأساسي مشطوباً.`;
}

export function canKeepSale(ctx: PreviewPriceContext): boolean {
  if (!saleWouldBeCleared(ctx)) return false;
  const regular = parseMoney(ctx.beforeRegular);
  const selling = ctx.sellingPrice ?? parseMoney(ctx.afterRegular);
  return regular !== null && selling !== null && selling > 0 && selling < regular;
}

export function keepSaleLabel(ctx: PreviewPriceContext): string {
  const regular = parseMoney(ctx.beforeRegular);
  const selling = ctx.sellingPrice ?? parseMoney(ctx.afterRegular);
  const regularTxt = regular !== null ? ` (${formatEgp(regular)})` : "";
  const saleTxt = selling !== null ? ` (${formatEgp(selling)})` : "";
  return `الإبقاء على التخفيض: يُعتمد سعر النظام سعراً للتخفيض${saleTxt}، ويبقى السعر الأساسي الحالي${regularTxt} ظاهراً مشطوباً.`;
}

export function keepSaleDisabledReason(ctx: PreviewPriceContext): string | null {
  if (!saleWouldBeCleared(ctx)) return null;
  if (canKeepSale(ctx)) return null;
  return "لا يمكن الإبقاء على التخفيض لأن سعر التخفيض يجب أن يكون أقل من السعر الأساسي.";
}

export const SKU_ROW_HINT = "سيُكتب باركود COCEG على المنتج في الموقع.";

export const PREVIEW_FIELD_LABELS: Record<string, string> = {
  regular_price: "السعر الأساسي",
  sale_price: "سعر التخفيض",
  price: "السعر النهائي للعميل",
  sku: "رمز الصنف (الباركود)",
};

export function previewFieldLabel(field: string): string {
  const key = canonicalPreviewField(field);
  return PREVIEW_FIELD_LABELS[key] ?? field;
}

export interface PreviewTableRow {
  field: string;
  label: string;
  before: string;
  after: string;
  hint?: string;
}

function cell(field: string, raw: Moneyish, empty: "dash" | "blank"): string {
  const key = canonicalPreviewField(field);
  const already = String(raw ?? "").trim();
  if (key === "regular_price" || key === "sale_price" || key === "price") {
    const n = parseMoney(raw);
    if (n === null) return empty === "blank" || already === "(فارغ)" || already === "" ? (empty === "dash" && already !== "(فارغ)" ? "—" : "(فارغ)") : already;
    return formatEgp(n);
  }
  if (!already || already === "—") return "—";
  return already;
}

/** صفوف المعاينة: السعر الأساسي، سعر التخفيض، السعر النهائي للعميل، ثم بقية الحقول. */
export function previewTableRows(
  changes: { field: string; before: string | null; after: string }[],
  ctx: PreviewPriceContext | null,
): PreviewTableRow[] {
  const byKey = new Map<string, { field: string; before: string | null; after: string }>();
  const others: { field: string; before: string | null; after: string }[] = [];
  for (const c of changes) {
    const key = canonicalPreviewField(c.field);
    if (key === "regular_price" || key === "sale_price" || key === "price") byKey.set(key, c);
    else others.push(c);
  }
  const rows: PreviewTableRow[] = [];
  const hasPrice = !!ctx && (parseMoney(ctx.beforeRegular) !== null || parseMoney(ctx.afterRegular) !== null || parseMoney(ctx.beforeSale) !== null || parseMoney(ctx.afterSale) !== null);
  if (hasPrice && ctx) {
    const saleInvolved = saleIsActive(ctx.beforeRegular, ctx.beforeSale) || saleIsActive(ctx.afterRegular, ctx.afterSale) || byKey.has("sale_price");
    rows.push({
      field: "regular_price",
      label: previewFieldLabel("regular_price"),
      before: cell("regular_price", ctx.beforeRegular ?? byKey.get("regular_price")?.before, "dash"),
      after: cell("regular_price", ctx.afterRegular ?? byKey.get("regular_price")?.after, "blank"),
    });
    if (saleInvolved) {
      rows.push({
        field: "sale_price",
        label: previewFieldLabel("sale_price"),
        before: cell("sale_price", ctx.beforeSale ?? byKey.get("sale_price")?.before, "dash"),
        after: cell("sale_price", ctx.afterSale ?? byKey.get("sale_price")?.after, "blank"),
      });
    }
    const now = effectiveCustomerPrice(ctx.beforeRegular, ctx.beforeSale);
    const next = effectiveCustomerPrice(ctx.afterRegular, ctx.afterSale);
    rows.push({
      field: "price",
      label: previewFieldLabel("price"),
      before: now === null ? "—" : formatEgp(now),
      after: next === null ? "(فارغ)" : formatEgp(next),
    });
  } else {
    for (const key of ["regular_price", "sale_price", "price"] as const) {
      const c = byKey.get(key);
      if (!c) continue;
      rows.push({
        field: key,
        label: previewFieldLabel(key),
        before: cell(key, c.before, "dash"),
        after: cell(key, c.after, "blank"),
      });
    }
  }
  for (const c of others) {
    const key = canonicalPreviewField(c.field);
    rows.push({
      field: key,
      label: previewFieldLabel(c.field),
      before: cell(key, c.before, "dash"),
      after: cell(key, c.after, "blank"),
      hint: key === "sku" && String(c.after ?? "").trim() && String(c.after) !== String(c.before ?? "") ? SKU_ROW_HINT : undefined,
    });
  }
  return rows;
}

/** يبني سياق السعر من جسم المعاينة (before/after الكاملان أو صفوف الفروق). */
export function customerPriceContextFromPreview(
  data: {
    changes?: { field: string; before: string | null; after: string }[];
    before?: { regular_price?: Moneyish; sale_price?: Moneyish } | null;
    after?: { regular_price?: Moneyish; sale_price?: Moneyish } | null;
  },
  sellingPrice?: number | null,
): PreviewPriceContext | undefined {
  const hasFields = !!(data.before || data.after);
  const ctx = hasFields
    ? priceContextFromFields(data.before, data.after, sellingPrice)
    : priceContextFromChanges(data.changes ?? [], { sellingPrice });
  const hasPrice = [ctx.beforeRegular, ctx.beforeSale, ctx.afterRegular, ctx.afterSale].some((v) => parseMoney(v) !== null);
  return hasPrice ? ctx : undefined;
}
