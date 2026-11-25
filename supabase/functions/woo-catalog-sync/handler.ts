/**
 * Pure logic for `woo-catalog-sync` (coceg ↔ capitalostrich.com WooCommerce catalog).
 *
 * Who: website_inbox_can_manage() — sales_manager, general_manager and executive_manager only.
 * Reads: the public Store API (/wp-json/wc/store/v1/products), so no keys are needed to read.
 * Writes to the site: WooCommerce REST v3 with WOO_CONSUMER_KEY / WOO_CONSUMER_SECRET from secrets.
 *   Without the keys every site write returns 503 `woo_keys_missing` (preview still works).
 * Every site write:
 *   1) the screen calls `preview`, which builds the exact payload and before/after diff plus a token;
 *   2) she confirms, and `apply` rebuilds the preview from a live read; if anything changed the
 *      token no longer matches → 409 (no silent overwrite);
 *   3) the result (applied or failed) goes to woo_sync_log with actor, before and after.
 * Rules: no description/halal text is pushed (names and box contents are stripped of halal claims);
 * SKU = company barcode (13 digits, 622400320…) only when present; never invented; new site
 * products are created as `draft`; offer boxes get shipping_class (default «بوكسات-شحن-مجاني»); box price = offer_price exactly as in
 * coceg; one coceg box ↔ one site product (meta `_coc_offer_box_id`).
 */

import { hideOnSitePayload, restoreChanges, restorePayload, showOnSitePayload, snapshotSha } from "./restore.ts";


export const DEFAULT_SITE_URL = "https://capitalostrich.com";
export const COMPANY_BARCODE_RE = /^622400320\d{4}$/;
export const STORE_PAGE_SIZE = 100;
export const STORE_MAX_PAGES = 20;
/** شحن العروض على الموقع: فئة «بوكسات - شحن مجاني» (term 516). يمكن تجاوزه بالسر WOO_BOX_SHIPPING_CLASS_SLUG. */
export const DEFAULT_BOX_SHIPPING_CLASS_SLUG = "بوكسات-شحن-مجاني";

export interface CatalogEnv {
  WOO_CONSUMER_KEY?: string;
  WOO_CONSUMER_SECRET?: string;
  WOO_SITE_URL?: string;
  WOO_BOX_SHIPPING_CLASS_SLUG?: string;
  /** pg_cron → expire_offers. Empty means cron calls are rejected. */
  WOO_CATALOG_CRON_SECRET?: string;
}

export interface SiteProductRow {
  woo_product_id: number;
  woo_variation_id: number;
  name: string;
  sku: string | null;
  type: string | null;
  price: number | null;
  regular_price: number | null;
  sale_price: number | null;
  on_sale: boolean;
  is_in_stock: boolean | null;
  permalink: string | null;
  image_url: string | null;
  categories: string[];
}

export interface CocProduct { id: string; name: string; price: number | null; barcode: string | null; image_url?: string | null }
export interface CocBoxItem { name: string; quantity: number; is_gift: boolean }
export interface CocBox { id: string; name: string; offer_price: number | null; shipping_cost: number | null; image_url?: string | null; items: CocBoxItem[] }

export type Target = { kind: "product"; id: string } | { kind: "offer_box"; id: string };
export type Mode = "create" | "update";

/** The fields this tool reads and writes on a Woo product. */
export interface WooFields {
  name?: string | null;
  regular_price?: string | null;
  sale_price?: string | null;
  sku?: string | null;
  short_description?: string | null;
  shipping_class?: string | null;
  image_url?: string | null;
  status?: string | null;
  catalog_visibility?: string | null;
  date_on_sale_from?: string | null;
  date_on_sale_to?: string | null;
}

export interface Change { field: keyof WooFields; before: string | null; after: string }

export interface Mapping { woo_product_id: number; woo_variation_id: number; kind: "product" | "offer_box"; product_id: string | null; offer_box_id: string | null }

export interface LogEntry {
  actor: string | null;
  action: "push_create" | "push_update" | SiteEditAction | "site_validity" | "site_restore";
  woo_product_id: number | null;
  woo_variation_id: number;
  product_id: string | null;
  offer_box_id: string | null;
  before: unknown;
  after: unknown;
  status: "applied" | "failed";
  error: string | null;
}

export interface CatalogDeps {
  env: CatalogEnv;
  fetchImpl: typeof fetch;
  /** Verifies the JWT with Supabase Auth; null when not signed in. */
  authenticate: (req: Request) => Promise<{ userId: string; token: string } | null>;
  /** website_inbox_can_manage() as the caller. */
  canManage: (token: string) => Promise<boolean>;
  saveSiteProducts: (items: SiteProductRow[], complete: boolean, actor: string) => Promise<unknown>;
  loadProduct: (id: string) => Promise<CocProduct | null>;
  loadBox: (id: string) => Promise<CocBox | null>;
  mappingForTarget: (t: Target) => Promise<Mapping | null>;
  /** The coceg product/box mapped to a site product (variation 0). */
  mappingForWoo?: (wooId: number) => Promise<Mapping | null>;
  /** Other site products (from the cached copy) already using this SKU. */
  cachedSkuOwners?: (sku: string) => Promise<number[]>;
  cachedSiteProduct: (wooId: number) => Promise<SiteProductRow | null>;
  /** woo_catalog_map as the caller (role-gated + logged in the DB). */
  mapAsUser: (token: string, wooId: number, t: Target) => Promise<void>;
  log: (e: LogEntry) => Promise<string | void>;
  /** Constant-time cron secret (expire_offers only). */
  authenticateCron?: (req: Request) => Promise<boolean>;
  listValidityJobs?: () => Promise<ValidityJob[]>;
  setValidityFlag?: (boxId: string, hidden: boolean, prevVisibility: string | null) => Promise<void>;
  saveBackup?: (logId: string | null, wooId: number, snapshot: unknown, sha: string, actor: string | null) => Promise<void>;
  loadBackup?: (backupId: string) => Promise<{ id: string; woo_product_id: number; snapshot: Record<string, unknown>; snapshot_sha: string; confirmed_by: string | null; confirmed_at: string } | null>;
}

export interface ValidityJob {
  offer_box_id: string;
  woo_product_id: number;
  starts_at: string | null;
  expires_at: string | null;
  site_hidden_by_validity: boolean;
  validity_prev_catalog_visibility: string | null;
  wanted: "hide" | "show" | "none";
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-woo-catalog-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// ── pure helpers ────────────────────────────────────────────────────────────

const HALAL_RE = /(?:\b(?:100\s*%\s*)?halal\b|(?:ال)?حلال(?:\s*100\s*%)?|مذبوح(?:ة)?\s+على\s+الطريقة\s+الإسلامية)/gi;

/** Removes halal claims; we never push them to the site. */
export function stripHalal(text: string): string {
  return text
    .replace(HALAL_RE, " ")
    .replace(/\s*[-–|،,]\s*(?=[-–|،,]|$)/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s\-–|،,]+|[\s\-–|،,]+$/g, "")
    .trim();
}

export function validImageUrl(u: string | null | undefined): string | null {
  const s = String(u ?? "").trim();
  if (!s) return null;
  return /^https?:\/\/\S+$/i.test(s) ? s : null;
}

export const isCompanyBarcode = (b: string | null | undefined) => COMPANY_BARCODE_RE.test(String(b ?? "").trim());

const money = (n: number | null | undefined): string | null =>
  n === null || n === undefined || !Number.isFinite(Number(n)) ? null : String(Math.round(Number(n) * 100) / 100);

/** Store API price strings are in minor units (`currency_minor_unit`). */
export function storePrice(v: unknown, minorUnit: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const mu = Number.isInteger(Number(minorUnit)) ? Number(minorUnit) : 0;
  return Math.round((n / 10 ** mu) * 100) / 100;
}

const decodeEntities = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&#8211;/g, "–").replace(/&#8217;/g, "’").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'");

// deno-lint-ignore no-explicit-any
export function normalizeStoreProduct(p: any): SiteProductRow | null {
  const id = Number(p?.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  const pr = p?.prices ?? {};
  const mu = pr.currency_minor_unit;
  const regular = storePrice(pr.regular_price, mu);
  const sale = storePrice(pr.sale_price, mu);
  return {
    woo_product_id: id,
    woo_variation_id: 0,
    name: decodeEntities(String(p?.name ?? "").trim()) || `منتج ${id}`,
    sku: String(p?.sku ?? "").trim() || null,
    type: p?.type ? String(p.type) : null,
    price: storePrice(pr.price, mu),
    regular_price: regular,
    sale_price: sale !== null && regular !== null && sale < regular ? sale : null,
    on_sale: !!p?.on_sale,
    is_in_stock: typeof p?.is_in_stock === "boolean" ? p.is_in_stock : null,
    permalink: p?.permalink ? String(p.permalink) : null,
    image_url: p?.images?.[0]?.src ? String(p.images[0].src) : null,
    // deno-lint-ignore no-explicit-any
    categories: Array.isArray(p?.categories) ? p.categories.map((c: any) => decodeEntities(String(c?.name ?? ""))).filter(Boolean) : [],
  };
}

export function boxContentsText(items: CocBoxItem[]): string {
  return items
    .map((i) => `• ${stripHalal(i.name)} × ${Number(i.quantity)}${i.is_gift ? " (هدية)" : ""}`)
    .join("\n");
}

export class SyncError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

/** What we want the Woo product to look like (only the fields we manage). */
export function desiredFields(mode: Mode, target: Target, src: CocProduct | CocBox, before: WooFields | null, env: CatalogEnv = {}, keepSale = false): WooFields {
  const isBox = target.kind === "offer_box";
  const price = isBox ? (src as CocBox).offer_price : (src as CocProduct).price;
  if (!price || price <= 0) throw new SyncError(422, "coc_price_missing");
  const currentRegular = Number(before?.regular_price || 0);
  const currentSale = Number(before?.sale_price || 0);
  const canKeep = keepSale && currentSale > 0 && currentRegular > 0 && price < currentRegular;
  if (keepSale && currentSale > 0 && !(price < currentRegular)) throw new SyncError(422, "sale_not_below_price");
  const out: WooFields = canKeep ? { sale_price: money(price) } : { regular_price: money(price) };
  // Default: remove any site sale so the selling price equals coceg exactly (shown in the diff).
  // keep_sale: set coceg as the sale price and leave the current regular as the crossed-out price.
  if (!canKeep && (mode === "create" || (before?.sale_price ?? "") !== "")) out.sale_price = "";
  if (isBox) {
    const box = src as CocBox;
    if (!box.items.length) throw new SyncError(422, "box_has_no_items");
    out.short_description = boxContentsText(box.items);
    // Free-shipping class so the site does not add a second delivery fee on top of offer_price.
    out.shipping_class = boxShippingClassSlug(env);
  } else {
    const b = (src as CocProduct).barcode;
    if (isCompanyBarcode(b) && (mode === "create" || (before?.sku ?? "") !== b)) out.sku = String(b).trim();
  }
  if (mode === "create") {
    const name = stripHalal(src.name);
    if (!name) throw new SyncError(422, "coc_name_missing");
    const img = validImageUrl(src.image_url);
    return { name, ...out, ...(img ? { image_url: img } : {}), status: "draft" };
  }
  return out;
}

export function diffFields(before: WooFields | null, after: WooFields): Change[] {
  const changes: Change[] = [];
  for (const k of Object.keys(after) as (keyof WooFields)[]) {
    const b = before?.[k] ?? null;
    const a = String(after[k] ?? "");
    if ((b ?? "") !== a) changes.push({ field: k, before: b, after: a });
  }
  return changes;
}

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export const previewToken = (p: { mode: Mode; target: Target; woo_product_id: number | null; before: WooFields | null; after: WooFields }) =>
  sha256Hex(JSON.stringify([p.mode, p.target.kind, p.target.id, p.woo_product_id, p.before, p.after]));

// ── WooCommerce I/O ─────────────────────────────────────────────────────────

const siteUrl = (env: CatalogEnv) => (env.WOO_SITE_URL || DEFAULT_SITE_URL).replace(/\/+$/, "");
export const keysConfigured = (env: CatalogEnv) => !!(env.WOO_CONSUMER_KEY?.trim() && env.WOO_CONSUMER_SECRET?.trim());
export const boxShippingClassSlug = (env: CatalogEnv) =>
  (env.WOO_BOX_SHIPPING_CLASS_SLUG ?? DEFAULT_BOX_SHIPPING_CLASS_SLUG).trim() || DEFAULT_BOX_SHIPPING_CLASS_SLUG;


function restAuth(env: CatalogEnv): string {
  return "Basic " + btoa(`${env.WOO_CONSUMER_KEY!.trim()}:${env.WOO_CONSUMER_SECRET!.trim()}`);
}

export async function fetchStoreProducts(env: CatalogEnv, fetchImpl: typeof fetch): Promise<{ items: SiteProductRow[]; complete: boolean }> {
  const items: SiteProductRow[] = [];
  let totalPages = 1;
  for (let page = 1; page <= Math.min(totalPages, STORE_MAX_PAGES); page++) {
    const res = await fetchImpl(`${siteUrl(env)}/wp-json/wc/store/v1/products?per_page=${STORE_PAGE_SIZE}&page=${page}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new SyncError(502, `store_api_${res.status}`);
    totalPages = Number(res.headers.get("x-wp-totalpages") ?? "1") || 1;
    const data = await res.json();
    if (!Array.isArray(data)) throw new SyncError(502, "store_api_bad_body");
    for (const p of data) {
      const row = normalizeStoreProduct(p);
      if (row) items.push(row);
    }
  }
  return { items, complete: totalPages <= STORE_MAX_PAGES };
}

// deno-lint-ignore no-explicit-any
const pickFields = (p: any): WooFields => ({
  name: p?.name ?? null,
  regular_price: p?.regular_price ?? null,
  sale_price: p?.sale_price ?? null,
  sku: p?.sku ?? null,
  short_description: p?.short_description ?? null,
  shipping_class: p?.shipping_class ?? null,
  status: p?.status ?? null,
  catalog_visibility: p?.catalog_visibility ?? null,
  date_on_sale_from: p?.date_on_sale_from ? String(p.date_on_sale_from).slice(0, 10) : "",
  date_on_sale_to: p?.date_on_sale_to ? String(p.date_on_sale_to).slice(0, 10) : "",
  image_url: p?.images?.[0]?.src ? String(p.images[0].src) : "",
});

async function restGetRaw(env: CatalogEnv, f: typeof fetch, wooId: number): Promise<Record<string, unknown>> {
  const res = await f(`${siteUrl(env)}/wp-json/wc/v3/products/${wooId}`, { headers: { Authorization: restAuth(env) } });
  if (res.status === 404) throw new SyncError(404, "woo_product_not_found");
  if (!res.ok) throw new SyncError(502, `woo_rest_${res.status}`);
  const body = await res.json();
  if (!body || typeof body !== "object") throw new SyncError(502, "woo_rest_bad_body");
  return body as Record<string, unknown>;
}

async function restGet(env: CatalogEnv, f: typeof fetch, wooId: number): Promise<WooFields> {
  return pickFields(await restGetRaw(env, f, wooId));
}

/** يكتب على الموقع بعد حفظ لقطة المنتج الحالية (ما عدا الإنشاء). */
async function writeWithBackup(
  deps: CatalogDeps,
  entry: Omit<LogEntry, "status" | "error">,
  method: "POST" | "PUT",
  path: string,
  body: unknown,
): Promise<{ wooId: number; logId: string | null }> {
  let snapshot: Record<string, unknown> | null = null;
  let sha = "";
  if (method === "PUT" && entry.woo_product_id) {
    snapshot = await restGetRaw(deps.env, deps.fetchImpl, entry.woo_product_id);
    sha = await snapshotSha(snapshot);
  }
  const res = await restWrite(deps.env, deps.fetchImpl, method, path, body);
  // deno-lint-ignore no-explicit-any
  const wooId = Number((res as any)?.id ?? entry.woo_product_id ?? 0);
  const logId = (await deps.log({ ...entry, woo_product_id: wooId || entry.woo_product_id, status: "applied", error: null })) ?? null;
  if (snapshot && deps.saveBackup) {
    await deps.saveBackup(typeof logId === "string" ? logId : null, wooId || entry.woo_product_id!, snapshot, sha, entry.actor);
  }
  return { wooId, logId: typeof logId === "string" ? logId : null };
}

async function restWrite(env: CatalogEnv, f: typeof fetch, method: "POST" | "PUT", path: string, body: unknown) {
  const res = await f(`${siteUrl(env)}/wp-json/wc/v3/${path}`, {
    method,
    headers: { Authorization: restAuth(env), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new SyncError(502, `woo_rest_${res.status}${data?.code ? `_${data.code}` : ""}`);
  return data;
}

// ── preview / apply ─────────────────────────────────────────────────────────

interface PreviewInput { mode: Mode; target: Target; woo_product_id: number | null; keep_sale?: boolean }

export async function buildPreview(deps: CatalogDeps, input: PreviewInput) {
  const { mode, target } = input;
  const src = target.kind === "product" ? await deps.loadProduct(target.id) : await deps.loadBox(target.id);
  if (!src) throw new SyncError(404, "coc_target_not_found");
  const mapping = await deps.mappingForTarget(target);
  const warnings: string[] = [];
  let before: WooFields | null = null;
  let wooId: number | null = null;

  if (mode === "create") {
    if (mapping) throw new SyncError(409, "already_on_site");
  } else {
    if (!mapping) throw new SyncError(409, "not_mapped");
    wooId = mapping.woo_product_id;
    if (input.woo_product_id !== null && input.woo_product_id !== wooId) throw new SyncError(409, "mapping_changed");
    if (keysConfigured(deps.env)) {
      before = await restGet(deps.env, deps.fetchImpl, wooId);
    } else {
      const c = await deps.cachedSiteProduct(wooId);
      before = c ? { regular_price: money(c.regular_price ?? c.price), sale_price: money(c.sale_price) ?? "", sku: c.sku ?? "", short_description: null, shipping_class: null } : null;
      warnings.push("preview_from_cache");
    }
  }
  if (target.kind === "product" && !isCompanyBarcode((src as CocProduct).barcode)) warnings.push("no_company_barcode_sku_left_empty");
  if (target.kind === "offer_box") {
    warnings.push("box_free_shipping_class");
    if ((src as CocBox).shipping_cost) warnings.push("box_price_includes_shipping");
  }
  const after = desiredFields(mode, target, src, before, deps.env, !!input.keep_sale);
  const changes = diffFields(before, after);
  const token = await previewToken({ mode, target, woo_product_id: wooId, before, after });
  return { mode, target, woo_product_id: wooId, before, after, changes, token, warnings, keys_configured: keysConfigured(deps.env) };
}

function parseInput(body: Record<string, unknown>): PreviewInput {
  const mode = body.mode;
  // deno-lint-ignore no-explicit-any
  const t = body.target as any;
  if (mode !== "create" && mode !== "update") throw new SyncError(400, "bad_mode");
  if (!t || (t.kind !== "product" && t.kind !== "offer_box") || typeof t.id !== "string" || !/^[0-9a-f-]{36}$/i.test(t.id)) {
    throw new SyncError(400, "bad_target");
  }
  const w = body.woo_product_id;
  return { mode, target: { kind: t.kind, id: t.id }, woo_product_id: w === undefined || w === null ? null : Number(w), keep_sale: body.keep_sale === true };
}

// ── site edits on a mapped product (price / sale / visibility / SKU / image) ──

export type SiteEditKind = "price" | "sale" | "visibility" | "sku" | "image";
export type SiteEditAction = "site_price" | "site_sale" | "site_visibility" | "site_sku" | "site_image";
export interface SiteEdit {
  kind: SiteEditKind;
  regular_price?: number;
  keep_sale?: boolean;
  sale_price?: number | null;
  date_from?: string | null;
  date_to?: string | null;
  status?: "publish" | "draft";
  catalog_visibility?: "visible" | "hidden";
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseSiteEdit(raw: unknown): SiteEdit {
  // deno-lint-ignore no-explicit-any
  const e = raw as any;
  if (!e || typeof e !== "object") throw new SyncError(400, "bad_edit");
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number.NaN);
  switch (e.kind) {
    case "price": {
      const p = num(e.regular_price);
      if (!(p > 0) || p > 1_000_000) throw new SyncError(422, "price_invalid");
      return { kind: "price", regular_price: p };
    }
    case "sale": {
      if (e.sale_price === null || e.sale_price === undefined) return { kind: "sale", sale_price: null, date_from: null, date_to: null };
      const sp = num(e.sale_price);
      if (!(sp > 0)) throw new SyncError(422, "sale_price_invalid");
      const df = e.date_from ? String(e.date_from) : null;
      const dt = e.date_to ? String(e.date_to) : null;
      if ((df && !DATE_RE.test(df)) || (dt && !DATE_RE.test(dt))) throw new SyncError(422, "sale_dates_invalid");
      if (df && dt && df > dt) throw new SyncError(422, "sale_dates_invalid");
      return { kind: "sale", sale_price: sp, date_from: df, date_to: dt };
    }
    case "visibility": {
      if (e.status !== "publish" && e.status !== "draft") throw new SyncError(400, "bad_edit");
      const cv = e.catalog_visibility === "hidden" ? "hidden" : "visible";
      return { kind: "visibility", status: e.status, catalog_visibility: cv };
    }
    case "sku":
      return { kind: "sku" };
    case "image":
      return { kind: "image" };
    default:
      throw new SyncError(400, "bad_edit");
  }
}

/** The exact Woo fields one site edit writes (coceg stays the source for SKU and image). */
export function siteEditFields(edit: SiteEdit, before: WooFields | null, src: CocProduct | CocBox | null, srcKind: "product" | "offer_box" | null): WooFields {
  switch (edit.kind) {
    case "price": {
      if (edit.keep_sale) {
        const currentRegular = Number(before?.regular_price || 0);
        if (!(Number(edit.regular_price) > 0 && Number(edit.regular_price) < currentRegular)) throw new SyncError(422, "sale_not_below_price");
        return { sale_price: money(edit.regular_price) };
      }
      const out: WooFields = { regular_price: money(edit.regular_price) };
      const sale = Number(before?.sale_price || 0);
      if (sale > 0 && sale >= Number(edit.regular_price)) out.sale_price = ""; // a sale must stay below the price
      return out;
    }
    case "sale": {
      if (edit.sale_price === null || edit.sale_price === undefined) return { sale_price: "", date_on_sale_from: "", date_on_sale_to: "" };
      const regular = Number(before?.regular_price || 0);
      if (!(regular > 0)) throw new SyncError(422, "site_price_missing");
      if (Number(edit.sale_price) >= regular) throw new SyncError(422, "sale_not_below_price");
      return { sale_price: money(edit.sale_price), date_on_sale_from: edit.date_from ?? "", date_on_sale_to: edit.date_to ?? "" };
    }
    case "visibility":
      return { status: edit.status!, catalog_visibility: edit.catalog_visibility! };
    case "sku": {
      if (!src || srcKind !== "product") throw new SyncError(422, "sku_needs_mapped_product");
      const b = String((src as CocProduct).barcode ?? "").trim();
      if (!isCompanyBarcode(b)) throw new SyncError(422, "coc_barcode_not_registered");
      return { sku: b };
    }
    case "image": {
      const img = validImageUrl(src?.image_url);
      if (!src || !img) throw new SyncError(422, "coc_image_missing");
      return { image_url: img };
    }
  }
}

const SITE_EDIT_ACTION: Record<SiteEditKind, SiteEditAction> = {
  price: "site_price", sale: "site_sale", visibility: "site_visibility", sku: "site_sku", image: "site_image",
};

export async function buildSiteEditPreview(deps: CatalogDeps, wooId: number, edit: SiteEdit, keepSale = false) {
  if (keepSale) edit = { ...edit, keep_sale: true };

  if (!Number.isInteger(wooId) || wooId <= 0) throw new SyncError(400, "bad_woo_product_id");
  const mapping = deps.mappingForWoo ? await deps.mappingForWoo(wooId) : null;
  const srcKind = mapping?.kind ?? null;
  const src = !mapping ? null
    : mapping.kind === "product" && mapping.product_id ? await deps.loadProduct(mapping.product_id)
    : mapping.offer_box_id ? await deps.loadBox(mapping.offer_box_id) : null;
  if ((edit.kind === "sku" || edit.kind === "image") && !mapping) throw new SyncError(409, "not_mapped");
  const warnings: string[] = [];
  let before: WooFields | null;
  if (keysConfigured(deps.env)) {
    before = await restGet(deps.env, deps.fetchImpl, wooId);
  } else {
    const c = await deps.cachedSiteProduct(wooId);
    if (!c) throw new SyncError(404, "woo_product_not_found");
    before = {
      regular_price: money(c.regular_price ?? c.price), sale_price: money(c.sale_price) ?? "", sku: c.sku ?? "",
      image_url: c.image_url ?? "", status: null, catalog_visibility: null, date_on_sale_from: null, date_on_sale_to: null,
    };
    warnings.push("preview_from_cache");
  }
  const after = siteEditFields(edit, before, src, srcKind);
  if (edit.kind === "sku" && after.sku) {
    const owners = new Set<number>();
    if (keysConfigured(deps.env)) {
      const res = await deps.fetchImpl(`${siteUrl(deps.env)}/wp-json/wc/v3/products?sku=${encodeURIComponent(after.sku)}&status=any`, { headers: { Authorization: restAuth(deps.env) } });
      if (!res.ok) throw new SyncError(502, `woo_rest_${res.status}`);
      const list = await res.json().catch(() => []);
      // deno-lint-ignore no-explicit-any
      for (const p of Array.isArray(list) ? list : []) if (Number((p as any)?.id) !== wooId) owners.add(Number((p as any).id));
    }
    if (deps.cachedSkuOwners) for (const id of await deps.cachedSkuOwners(after.sku)) if (id !== wooId) owners.add(id);
    if (owners.size) throw new SyncError(409, "duplicate_sku");
  }
  if (srcKind === "offer_box" && edit.kind === "price") {
    const box = src as CocBox | null;
    if (box?.offer_price && Number(edit.regular_price) !== Number(box.offer_price)) warnings.push("box_site_price_differs_from_coc");
  }
  if (edit.kind === "sale") warnings.push("coc_price_unchanged");
  const changes = diffFields(before, after);
  const target: Target = srcKind === "offer_box" && mapping?.offer_box_id ? { kind: "offer_box", id: mapping.offer_box_id }
    : { kind: "product", id: mapping?.product_id ?? "00000000-0000-0000-0000-000000000000" };
  const token = await sha256Hex(JSON.stringify(["site_edit", wooId, edit, before, after]));
  return { woo_product_id: wooId, edit, mapping, target, before, after, changes, token, warnings, keys_configured: keysConfigured(deps.env) };
}

/** Woo REST body for a site edit (image goes as images[0]). */
export function siteEditPayload(after: WooFields): Record<string, unknown> {
  const { image_url, ...rest } = after;
  return image_url ? { ...rest, images: [{ src: image_url }] } : { ...rest };
}

export async function buildRestorePreview(deps: CatalogDeps, backupId: string) {
  if (!deps.loadBackup) throw new SyncError(500, "internal");
  const backup = await deps.loadBackup(backupId);
  if (!backup) throw new SyncError(404, "backup_not_found");
  if (!keysConfigured(deps.env)) throw new SyncError(503, "woo_keys_missing");
  const current = await restGetRaw(deps.env, deps.fetchImpl, backup.woo_product_id);
  const currentSha = await snapshotSha(current);
  const changes = restoreChanges(current, backup.snapshot);
  const token = await snapshotSha({ backup: backup.id, woo: backup.woo_product_id, currentSha, after: restorePayload(backup.snapshot) });
  return {
    backup_id: backup.id,
    woo_product_id: backup.woo_product_id,
    confirmed_by: backup.confirmed_by,
    confirmed_at: backup.confirmed_at,
    before: current,
    after: restorePayload(backup.snapshot),
    changes,
    token,
    current_sha: currentSha,
    keys_configured: true,
    warnings: changes.length === 0 ? ["already_matches_snapshot"] : [],
  };
}

export async function runExpireOffers(deps: CatalogDeps, actor: string | null) {
  if (!keysConfigured(deps.env)) throw new SyncError(503, "woo_keys_missing");
  if (!deps.listValidityJobs || !deps.setValidityFlag) throw new SyncError(500, "internal");
  const jobs = (await deps.listValidityJobs()).filter((j) => j.wanted === "hide" || j.wanted === "show");
  const results: { offer_box_id: string; woo_product_id: number; wanted: string; result: string }[] = [];
  for (const job of jobs) {
    try {
      const current = await restGetRaw(deps.env, deps.fetchImpl, job.woo_product_id);
      const vis = String(current.catalog_visibility ?? "visible");
      const status = String(current.status ?? "publish");
      if (job.wanted === "hide") {
        // Safest reversible hide: keep publish, set catalog_visibility=hidden.
        if (vis === "hidden") {
          results.push({ offer_box_id: job.offer_box_id, woo_product_id: job.woo_product_id, wanted: "hide", result: "already_hidden" });
          continue; // do not claim a manual hide as ours
        }
        const after = hideOnSitePayload();
        await writeWithBackup(deps, {
          actor, action: "site_validity", woo_product_id: job.woo_product_id, woo_variation_id: 0,
          product_id: null, offer_box_id: job.offer_box_id,
          before: { status, catalog_visibility: vis }, after,
        }, "PUT", `products/${job.woo_product_id}`, after);
        await deps.setValidityFlag(job.offer_box_id, true, vis);
        results.push({ offer_box_id: job.offer_box_id, woo_product_id: job.woo_product_id, wanted: "hide", result: "hidden" });
      } else {
        if (!job.site_hidden_by_validity) {
          results.push({ offer_box_id: job.offer_box_id, woo_product_id: job.woo_product_id, wanted: "show", result: "skipped_not_ours" });
          continue;
        }
        const after = showOnSitePayload(job.validity_prev_catalog_visibility);
        if (vis === after.catalog_visibility && (status === "publish" || status === after.status)) {
          await deps.setValidityFlag(job.offer_box_id, false, null);
          results.push({ offer_box_id: job.offer_box_id, woo_product_id: job.woo_product_id, wanted: "show", result: "already_visible" });
          continue;
        }
        await writeWithBackup(deps, {
          actor, action: "site_validity", woo_product_id: job.woo_product_id, woo_variation_id: 0,
          product_id: null, offer_box_id: job.offer_box_id,
          before: { status, catalog_visibility: vis }, after,
        }, "PUT", `products/${job.woo_product_id}`, after);
        await deps.setValidityFlag(job.offer_box_id, false, null);
        results.push({ offer_box_id: job.offer_box_id, woo_product_id: job.woo_product_id, wanted: "show", result: "shown" });
      }
    } catch (e) {
      const code = e instanceof SyncError ? e.code : "woo_write_failed";
      await deps.log({
        actor, action: "site_validity", woo_product_id: job.woo_product_id, woo_variation_id: 0,
        product_id: null, offer_box_id: job.offer_box_id, before: null, after: { wanted: job.wanted },
        status: "failed", error: code,
      });
      results.push({ offer_box_id: job.offer_box_id, woo_product_id: job.woo_product_id, wanted: job.wanted, result: `failed:${code}` });
    }
  }
  return { ok: true, count: results.length, results };
}

export async function handleCatalogSync(req: Request, deps: CatalogDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { error: "bad_json" }); }

  const cron = deps.authenticateCron ? await deps.authenticateCron(req) : false;
  if (cron) {
    if (body.action !== "expire_offers") return json(403, { error: "forbidden" });
    try {
      return json(200, await runExpireOffers(deps, null));
    } catch (e) {
      if (e instanceof SyncError) return json(e.status, { error: e.code });
      console.error("woo-catalog-sync expire_offers failed", String((e as Error)?.message ?? e).slice(0, 200));
      return json(500, { error: "internal" });
    }
  }

  const auth = await deps.authenticate(req);
  if (!auth) return json(401, { error: "unauthorized" });
  if (!(await deps.canManage(auth.token))) return json(403, { error: "forbidden" });

  try {
    switch (body.action) {
      case "status":
        return json(200, { keys_configured: keysConfigured(deps.env), site_url: siteUrl(deps.env) });

      case "refresh": {
        const { items, complete } = await fetchStoreProducts(deps.env, deps.fetchImpl);
        const result = await deps.saveSiteProducts(items, complete, auth.userId);
        return json(200, { ok: true, count: items.length, complete, result });
      }

      case "preview":
        return json(200, await buildPreview(deps, parseInput(body)));

      case "apply": {
        const input = parseInput(body);
        if (!keysConfigured(deps.env)) return json(503, { error: "woo_keys_missing" });
        const p = await buildPreview(deps, input);
        if (typeof body.token !== "string" || body.token !== p.token) return json(409, { error: "changed_since_preview", preview: p });
        const base = {
          actor: auth.userId,
          woo_variation_id: 0,
          product_id: input.target.kind === "product" ? input.target.id : null,
          offer_box_id: input.target.kind === "offer_box" ? input.target.id : null,
          before: p.before,
          after: p.after,
        };
        if (p.changes.length === 0) return json(200, { ok: true, changed: false });
        try {
          if (input.mode === "create") {
            const meta = [{ key: input.target.kind === "product" ? "_coc_product_id" : "_coc_offer_box_id", value: input.target.id }];
            const { image_url: imgUrl, ...wooAfter } = p.after;
            const wooPayload = { type: "simple", ...wooAfter, ...(imgUrl ? { images: [{ src: imgUrl }] } : {}), meta_data: meta };
            const { wooId } = await writeWithBackup(deps, { ...base, action: "push_create", woo_product_id: null, after: p.after }, "POST", "products", wooPayload);
            if (!Number.isInteger(wooId) || wooId <= 0) throw new SyncError(502, "woo_create_no_id");
            try {
              await deps.mapAsUser(auth.token, wooId, input.target);
            } catch {
              return json(200, { ok: true, changed: true, woo_product_id: wooId, warning: "created_not_mapped" });
            }
            return json(200, { ok: true, changed: true, woo_product_id: wooId });
          }
          await writeWithBackup(deps, { ...base, action: "push_update", woo_product_id: p.woo_product_id }, "PUT", `products/${p.woo_product_id}`, p.after);
          return json(200, { ok: true, changed: true, woo_product_id: p.woo_product_id });
        } catch (e) {
          const code = e instanceof SyncError ? e.code : "woo_write_failed";
          await deps.log({ ...base, action: input.mode === "create" ? "push_create" : "push_update", woo_product_id: p.woo_product_id, status: "failed", error: code });
          throw e;
        }
      }
      case "site_preview":
        return json(200, await buildSiteEditPreview(deps, Number(body.woo_product_id), parseSiteEdit(body.edit), body.keep_sale === true));

      case "site_apply": {
        const wooId = Number(body.woo_product_id);
        const edit = parseSiteEdit(body.edit);
        if (!keysConfigured(deps.env)) return json(503, { error: "woo_keys_missing" });
        const p = await buildSiteEditPreview(deps, wooId, edit, body.keep_sale === true);
        if (typeof body.token !== "string" || body.token !== p.token) return json(409, { error: "changed_since_preview", preview: p });
        if (p.changes.length === 0) return json(200, { ok: true, changed: false });
        const entry = {
          actor: auth.userId, action: edit.kind === "visibility" ? (body.reason === "validity" ? "site_validity" as const : SITE_EDIT_ACTION[edit.kind]) : SITE_EDIT_ACTION[edit.kind],
          woo_product_id: wooId, woo_variation_id: 0,
          product_id: p.mapping?.product_id ?? null, offer_box_id: p.mapping?.offer_box_id ?? null,
          before: p.before, after: p.after,
        };
        try {
          await writeWithBackup(deps, entry, "PUT", `products/${wooId}`, siteEditPayload(p.after));
          if (body.reason === "validity" && p.mapping?.offer_box_id && deps.setValidityFlag) {
            const hidden = p.after.catalog_visibility === "hidden";
            await deps.setValidityFlag(p.mapping.offer_box_id, hidden, hidden ? String(p.before?.catalog_visibility ?? "visible") : null);
          }
          return json(200, { ok: true, changed: true, woo_product_id: wooId });
        } catch (e) {
          await deps.log({ ...entry, status: "failed", error: e instanceof SyncError ? e.code : "woo_write_failed" });
          throw e;
        }
      }

      case "restore_preview": {
        const backupId = String(body.backup_id ?? "");
        if (!backupId) return json(400, { error: "bad_backup_id" });
        return json(200, await buildRestorePreview(deps, backupId));
      }

      case "restore_apply": {
        const backupId = String(body.backup_id ?? "");
        if (!backupId) return json(400, { error: "bad_backup_id" });
        if (!keysConfigured(deps.env)) return json(503, { error: "woo_keys_missing" });
        const p = await buildRestorePreview(deps, backupId);
        if (typeof body.token !== "string" || body.token !== p.token) return json(409, { error: "changed_since_preview", preview: p });
        if (p.changes.length === 0) return json(200, { ok: true, changed: false });
        const mapping = deps.mappingForWoo ? await deps.mappingForWoo(p.woo_product_id) : null;
        const entry = {
          actor: auth.userId, action: "site_restore" as const, woo_product_id: p.woo_product_id, woo_variation_id: 0,
          product_id: mapping?.product_id ?? null, offer_box_id: mapping?.offer_box_id ?? null,
          before: p.before, after: p.after,
        };
        try {
          await writeWithBackup(deps, entry, "PUT", `products/${p.woo_product_id}`, p.after);
          return json(200, { ok: true, changed: true, woo_product_id: p.woo_product_id });
        } catch (e) {
          await deps.log({ ...entry, status: "failed", error: e instanceof SyncError ? e.code : "woo_write_failed" });
          throw e;
        }
      }

      case "expire_offers":
        return json(200, await runExpireOffers(deps, auth.userId));

      default:
        return json(400, { error: "bad_action" });
    }
  } catch (e) {
    if (e instanceof SyncError) return json(e.status, { error: e.code });
    console.error("woo-catalog-sync failed", String((e as Error)?.message ?? e).slice(0, 200));
    return json(500, { error: "internal" });
  }
}
