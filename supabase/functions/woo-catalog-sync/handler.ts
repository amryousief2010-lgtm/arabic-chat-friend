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

export interface CocProduct { id: string; name: string; price: number | null; barcode: string | null }
export interface CocBoxItem { name: string; quantity: number; is_gift: boolean }
export interface CocBox { id: string; name: string; offer_price: number | null; shipping_cost: number | null; items: CocBoxItem[] }

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
  status?: string | null;
}

export interface Change { field: keyof WooFields; before: string | null; after: string }

export interface Mapping { woo_product_id: number; woo_variation_id: number; kind: "product" | "offer_box"; product_id: string | null; offer_box_id: string | null }

export interface LogEntry {
  actor: string;
  action: "push_create" | "push_update";
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
  cachedSiteProduct: (wooId: number) => Promise<SiteProductRow | null>;
  /** woo_catalog_map as the caller (role-gated + logged in the DB). */
  mapAsUser: (token: string, wooId: number, t: Target) => Promise<void>;
  log: (e: LogEntry) => Promise<void>;
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
export function desiredFields(mode: Mode, target: Target, src: CocProduct | CocBox, before: WooFields | null, env: CatalogEnv = {}): WooFields {
  const isBox = target.kind === "offer_box";
  const price = isBox ? (src as CocBox).offer_price : (src as CocProduct).price;
  if (!price || price <= 0) throw new SyncError(422, "coc_price_missing");
  const out: WooFields = { regular_price: money(price) };
  // Remove any site sale so the selling price equals coceg exactly (shown in the diff).
  if (mode === "create" || (before?.sale_price ?? "") !== "") out.sale_price = "";
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
    return { name, ...out, status: "draft" };
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
});

async function restGet(env: CatalogEnv, f: typeof fetch, wooId: number): Promise<WooFields> {
  const res = await f(`${siteUrl(env)}/wp-json/wc/v3/products/${wooId}`, { headers: { Authorization: restAuth(env) } });
  if (res.status === 404) throw new SyncError(404, "woo_product_not_found");
  if (!res.ok) throw new SyncError(502, `woo_rest_${res.status}`);
  return pickFields(await res.json());
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

interface PreviewInput { mode: Mode; target: Target; woo_product_id: number | null }

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
  const after = desiredFields(mode, target, src, before, deps.env);
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
  return { mode, target: { kind: t.kind, id: t.id }, woo_product_id: w === undefined || w === null ? null : Number(w) };
}

export async function handleCatalogSync(req: Request, deps: CatalogDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const auth = await deps.authenticate(req);
  if (!auth) return json(401, { error: "unauthorized" });
  if (!(await deps.canManage(auth.token))) return json(403, { error: "forbidden" });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { error: "bad_json" }); }

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
            const created = await restWrite(deps.env, deps.fetchImpl, "POST", "products", { type: "simple", ...p.after, meta_data: meta });
            const wooId = Number(created?.id);
            if (!Number.isInteger(wooId) || wooId <= 0) throw new SyncError(502, "woo_create_no_id");
            await deps.log({ ...base, action: "push_create", woo_product_id: wooId, after: { ...p.after, id: wooId }, status: "applied", error: null });
            try {
              await deps.mapAsUser(auth.token, wooId, input.target);
            } catch {
              return json(200, { ok: true, changed: true, woo_product_id: wooId, warning: "created_not_mapped" });
            }
            return json(200, { ok: true, changed: true, woo_product_id: wooId });
          }
          await restWrite(deps.env, deps.fetchImpl, "PUT", `products/${p.woo_product_id}`, p.after);
          await deps.log({ ...base, action: "push_update", woo_product_id: p.woo_product_id, status: "applied", error: null });
          return json(200, { ok: true, changed: true, woo_product_id: p.woo_product_id });
        } catch (e) {
          const code = e instanceof SyncError ? e.code : "woo_write_failed";
          await deps.log({ ...base, action: input.mode === "create" ? "push_create" : "push_update", woo_product_id: p.woo_product_id, status: "failed", error: code });
          throw e;
        }
      }
      default:
        return json(400, { error: "bad_action" });
    }
  } catch (e) {
    if (e instanceof SyncError) return json(e.status, { error: e.code });
    console.error("woo-catalog-sync failed", String((e as Error)?.message ?? e).slice(0, 200));
    return json(500, { error: "internal" });
  }
}
