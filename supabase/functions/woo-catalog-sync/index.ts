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
import { handleCatalogSync, type CocBox, type Target } from "./handler.ts";

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
      const { data } = await admin.from("products").select("id, name, price, barcode, image_url").eq("id", id).maybeSingle();
      return data ? { id: data.id, name: data.name, price: data.price === null ? null : Number(data.price), barcode: data.barcode, image_url: data.image_url ?? null } : null;
    },
    loadBox: async (id) => {
      const { data: box } = await admin.from("offer_boxes").select("id, name, offer_price, shipping_cost").eq("id", id).maybeSingle();
      if (!box) return null;
      const { data: items } = await admin.from("offer_box_items").select("quantity, is_gift, products(name)").eq("offer_box_id", id).order("created_at");
      return {
        id: box.id, name: box.name,
        offer_price: box.offer_price === null ? null : Number(box.offer_price),
        shipping_cost: box.shipping_cost === null ? null : Number(box.shipping_cost),
        // deno-lint-ignore no-explicit-any
        items: (items ?? []).map((i: any) => ({ name: i.products?.name ?? "منتج", quantity: Number(i.quantity), is_gift: !!i.is_gift })),
      } as CocBox;
    },
    mappingForTarget: async (t: Target) => {
      const col = t.kind === "product" ? "product_id" : "offer_box_id";
      const { data } = await admin.from("woo_product_map").select("woo_product_id, woo_variation_id, kind, product_id, offer_box_id")
        .eq(col, t.id).order("mapped_at").limit(1).maybeSingle();
      return data ? { ...data, woo_product_id: Number(data.woo_product_id), woo_variation_id: Number(data.woo_variation_id) } : null;
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
      const { error } = await admin.rpc("woo_sync_log_write", {
        _actor: e.actor, _action: e.action, _direction: "coc_to_site", _woo_product_id: e.woo_product_id,
        _woo_variation_id: e.woo_variation_id, _product_id: e.product_id, _offer_box_id: e.offer_box_id,
        _before: e.before, _after: e.after, _status: e.status, _error: e.error,
      });
      if (error) console.error("woo_sync_log_write failed", error.message.slice(0, 200));
    },
  });
});
