/**
 * Edge Function: woo-catalog-sync
 *
 * شاشة «منتجات الموقع»: قراءة منتجات capitalostrich.com، والإضافة/تحديث السعر على الموقع بعد معاينة.
 * JWT مطلوب (verify_jwt = true) + website_inbox_can_manage() كصلاحية.
 * أسرار الكتابة: WOO_CONSUMER_KEY / WOO_CONSUMER_SECRET (اختياري WOO_SITE_URL). المنطق في ./handler.ts.
 */
// deno-lint-ignore no-import-prefix
import { createClient } from "npm:@supabase/supabase-js@2";
import { createServiceClient } from "../_shared/require-user.ts";
import { matchesCronSecret } from "../_shared/cron-secret.ts";
import { handleCatalogSync, type CocBox, type Target } from "./handler.ts";

const MAP_COLS = "woo_product_id, woo_variation_id, kind, product_id, offer_box_id, site_pack_qty, site_pack_label, site_pack_confirmed_at";

const userClient = (token: string) =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

Deno.serve((req) => {
  const admin = createServiceClient();
  return handleCatalogSync(req, {
    env: {
      WOO_CONSUMER_KEY: Deno.env.get("WOO_CONSUMER_KEY") ?? undefined,
      WOO_CONSUMER_SECRET: Deno.env.get("WOO_CONSUMER_SECRET") ?? undefined,
      WOO_SITE_URL: Deno.env.get("WOO_SITE_URL") ?? undefined,
      WOO_BOX_SHIPPING_CLASS_SLUG: Deno.env.get("WOO_BOX_SHIPPING_CLASS_SLUG") ?? undefined,
      WOO_CATALOG_CRON_SECRET: Deno.env.get("WOO_CATALOG_CRON_SECRET") ?? undefined,
    },
    fetchImpl: fetch,
    authenticate: async (r) => {
      const token = (r.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
      if (!token) return null;
      const { data, error } = await admin.auth.getUser(token);
      return error || !data?.user ? null : { userId: data.user.id, token };
    },
    canManage: async (token) => {
      const { data, error } = await userClient(token).rpc("website_inbox_can_manage");
      return !error && data === true;
    },
    saveSiteProducts: async (items, complete, actor) => {
      const { data, error } = await admin.rpc("woo_site_products_refresh", { _items: items, _complete: complete, _actor: actor });
      if (error) throw new Error(error.message);
      return data;
    },
    loadProduct: async (id) => {
      const { data } = await admin.from("products").select("id, name, price, barcode, image_url, unit").eq("id", id).maybeSingle();
      return data ? { id: data.id, name: data.name, price: data.price === null ? null : Number(data.price), barcode: data.barcode, image_url: data.image_url ?? null, unit: data.unit ?? null } : null;
    },
    loadBox: async (id) => {
      const { data: box } = await admin.from("offer_boxes").select("id, name, offer_price, shipping_cost, image_url").eq("id", id).maybeSingle();
      if (!box) return null;
      const { data: items } = await admin.from("offer_box_items").select("quantity, is_gift, products(name)").eq("offer_box_id", id).order("created_at");
      return {
        id: box.id, name: box.name,
        offer_price: box.offer_price === null ? null : Number(box.offer_price),
        shipping_cost: box.shipping_cost === null ? null : Number(box.shipping_cost),
        image_url: box.image_url ?? null,
        // deno-lint-ignore no-explicit-any
        items: (items ?? []).map((i: any) => ({ name: i.products?.name ?? "منتج", quantity: Number(i.quantity), is_gift: !!i.is_gift })),
      } as CocBox;
    },
    mappingForTarget: async (t: Target) => {
      const col = t.kind === "product" ? "product_id" : "offer_box_id";
      const { data } = await admin.from("woo_product_map").select(MAP_COLS)
        .eq(col, t.id).order("mapped_at").limit(1).maybeSingle();
      return data ? { ...data, woo_product_id: Number(data.woo_product_id), woo_variation_id: Number(data.woo_variation_id), site_pack_qty: data.site_pack_qty === null || data.site_pack_qty === undefined ? 1 : Number(data.site_pack_qty) } : null;
    },
    mappingForWoo: async (wooId) => {
      const { data } = await admin.from("woo_product_map").select(MAP_COLS)
        .eq("woo_product_id", wooId).eq("woo_variation_id", 0).maybeSingle();
      return data ? { ...data, woo_product_id: Number(data.woo_product_id), woo_variation_id: Number(data.woo_variation_id), site_pack_qty: data.site_pack_qty === null || data.site_pack_qty === undefined ? 1 : Number(data.site_pack_qty) } : null;
    },
    cachedSkuOwners: async (sku) => {
      const { data } = await admin.from("woo_site_products").select("woo_product_id").eq("sku", sku).is("removed_at", null);
      return (data ?? []).map((r: { woo_product_id: number }) => Number(r.woo_product_id));
    },
    cachedSiteProduct: async (wooId) => {
      const { data } = await admin.from("woo_site_products").select("*").eq("woo_product_id", wooId).eq("woo_variation_id", 0).maybeSingle();
      return data ?? null;
    },
    mapAsUser: async (token, wooId, t) => {
      const { error } = await userClient(token).rpc("woo_catalog_map", {
        _woo_product_id: wooId, _woo_variation_id: 0,
        _product_id: t.kind === "product" ? t.id : null, _offer_box_id: t.kind === "offer_box" ? t.id : null,
      });
      if (error) throw new Error(error.message);
    },
    log: async (e) => {
      const { data, error } = await admin.rpc("woo_sync_log_write", {
        _actor: e.actor, _action: e.action, _direction: "coc_to_site", _woo_product_id: e.woo_product_id,
        _woo_variation_id: e.woo_variation_id, _product_id: e.product_id, _offer_box_id: e.offer_box_id,
        _before: e.before, _after: e.after, _status: e.status, _error: e.error,
      });
      if (error) console.error("woo_sync_log_write failed", error.message.slice(0, 200));
      return data ? String(data) : undefined;
    },
    authenticateCron: (r) => {
      const got = (r.headers.get("x-woo-catalog-cron-secret") ?? "").trim();
      const want = Deno.env.get("WOO_CATALOG_CRON_SECRET") ?? "";
      return Promise.resolve(matchesCronSecret(got, want));
    },
    listValidityJobs: async () => {
      const { data, error } = await admin.rpc("website_offer_validity_jobs");
      if (error) throw new Error(error.message);
      return (data ?? []).map((r: Record<string, unknown>) => ({
        offer_box_id: String(r.offer_box_id),
        woo_product_id: Number(r.woo_product_id),
        starts_at: r.starts_at ? String(r.starts_at) : null,
        expires_at: r.expires_at ? String(r.expires_at) : null,
        site_hidden_by_validity: !!r.site_hidden_by_validity,
        validity_prev_catalog_visibility: r.validity_prev_catalog_visibility ? String(r.validity_prev_catalog_visibility) : null,
        wanted: r.wanted === "hide" || r.wanted === "show" ? r.wanted : "none",
      }));
    },
    setValidityFlag: async (boxId, hidden, prev) => {
      const { error } = await admin.rpc("website_set_validity_site_flag", {
        _box_id: boxId, _hidden: hidden, _prev_visibility: prev,
      });
      if (error) throw new Error(error.message);
    },
    saveBackup: async (logId, wooId, snapshot, sha, actor) => {
      const { error } = await admin.rpc("woo_product_backup_write", {
        _log_id: logId, _woo_product_id: wooId, _snapshot: snapshot, _snapshot_sha: sha, _confirmed_by: actor,
      });
      if (error) console.error("woo_product_backup_write failed", error.message.slice(0, 200));
    },
    loadBackup: async (backupId) => {
      const { data } = await admin.from("woo_product_backups").select("id, woo_product_id, snapshot, snapshot_sha, confirmed_by, confirmed_at")
        .eq("id", backupId).maybeSingle();
      if (!data) return null;
      return {
        id: String(data.id),
        woo_product_id: Number(data.woo_product_id),
        snapshot: (data.snapshot ?? {}) as Record<string, unknown>,
        snapshot_sha: String(data.snapshot_sha),
        confirmed_by: data.confirmed_by ? String(data.confirmed_by) : null,
        confirmed_at: String(data.confirmed_at),
      };
    },
  });
});
