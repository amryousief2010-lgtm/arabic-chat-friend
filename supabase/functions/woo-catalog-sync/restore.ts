/**
 * لقطة كاملة لمنتج ووكومرس قبل الكتابة، واسترجاع الحقول القابلة للكتابة فقط.
 * لا نعيد الحقول المحسوبة أو المعرّفات الزمنية حتى لا تُرفض الكتابة.
 */

export const WOO_RESTORE_KEYS = [
  "name", "slug", "status", "catalog_visibility",
  "regular_price", "sale_price", "date_on_sale_from", "date_on_sale_to",
  "date_on_sale_from_gmt", "date_on_sale_to_gmt",
  "description", "short_description", "sku", "weight",
  "tax_status", "tax_class", "manage_stock", "stock_quantity", "stock_status",
  "backorders", "sold_individually", "shipping_class", "reviews_allowed",
  "purchase_note", "menu_order", "categories", "tags", "images",
  "attributes", "default_attributes", "meta_data",
] as const;

export type WooRestoreKey = (typeof WOO_RESTORE_KEYS)[number];

export interface RestoreChange {
  field: string;
  before: unknown;
  after: unknown;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortKeys(o[k])]));
  }
  return value;
}

export async function snapshotSha(snapshot: unknown): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stableJson(snapshot)));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** جسم PUT الآمن من لقطة كاملة. */
export function restorePayload(snapshot: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const src = snapshot && typeof snapshot === "object" ? snapshot : {};
  const out: Record<string, unknown> = {};
  for (const k of WOO_RESTORE_KEYS) {
    if (k in src) out[k] = src[k];
  }
  if (Array.isArray(out.images)) {
    // deno-lint-ignore no-explicit-any
    out.images = (out.images as any[]).map((img) => {
      if (!img || typeof img !== "object") return img;
      const row: Record<string, unknown> = {};
      if (img.id != null) row.id = img.id;
      if (img.src != null) row.src = img.src;
      if (img.name != null) row.name = img.name;
      if (img.alt != null) row.alt = img.alt;
      if (img.position != null) row.position = img.position;
      return row;
    });
  }
  if (Array.isArray(out.categories)) {
    // deno-lint-ignore no-explicit-any
    out.categories = (out.categories as any[]).map((c) => (c && typeof c === "object" && c.id != null ? { id: c.id } : c));
  }
  if (Array.isArray(out.tags)) {
    // deno-lint-ignore no-explicit-any
    out.tags = (out.tags as any[]).map((c) => (c && typeof c === "object" && c.id != null ? { id: c.id } : c));
  }
  return out;
}

const same = (a: unknown, b: unknown) => stableJson(a) === stableJson(b);

export function restoreChanges(
  current: Record<string, unknown> | null | undefined,
  snapshot: Record<string, unknown> | null | undefined,
): RestoreChange[] {
  const after = restorePayload(snapshot);
  const before = restorePayload(current ?? {});
  const changes: RestoreChange[] = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const field of keys) {
    if (!same(before[field], after[field])) changes.push({ field, before: before[field] ?? null, after: after[field] ?? null });
  }
  return changes;
}

/** أخف إخفاء عكسي: إبقاء publish وإخفاء الظهور في المتجر. */
export function hideOnSitePayload(): { status: "publish"; catalog_visibility: "hidden" } {
  return { status: "publish", catalog_visibility: "hidden" };
}

export function showOnSitePayload(prev: string | null | undefined): { status: "publish"; catalog_visibility: "visible" | "hidden" } {
  const v = prev === "hidden" ? "hidden" : "visible";
  return { status: "publish", catalog_visibility: v };
}
