import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_BOX_SHIPPING_CLASS_SLUG, boxContentsText, desiredFields, diffFields, fetchStoreProducts, handleCatalogSync, isCompanyBarcode,
  normalizeStoreProduct, storePrice, stripHalal, validImageUrl, type CatalogDeps, type LogEntry,
} from "../../../supabase/functions/woo-catalog-sync/handler";

const PID = "10000000-0000-0000-0000-000000000001";
const BID = "20000000-0000-0000-0000-000000000001";
const URL_ = "https://x.supabase.co/functions/v1/woo-catalog-sync";

const storeItem = (id: number, price: string, extra: Record<string, unknown> = {}) => ({
  id, name: `منتج ${id} &#8211; 1 كيلو`, sku: "", type: "simple", on_sale: false, is_in_stock: true,
  permalink: `https://capitalostrich.com/product/${id}/`, images: [{ src: "https://img/x.jpg" }], categories: [{ name: "لحوم" }],
  prices: { price, regular_price: price, sale_price: price, currency_minor_unit: 0 }, ...extra,
});

function makeDeps(over: Partial<CatalogDeps> = {}) {
  const logs: LogEntry[] = [];
  const restCalls: { method: string; url: string; body: unknown }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    if (u.includes("/wc/store/v1/products")) {
      return new Response(JSON.stringify([storeItem(937, "850"), storeItem(940, "300")]), { headers: { "x-wp-totalpages": "1" } });
    }
    restCalls.push({ method, url: u, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (method === "GET") return new Response(JSON.stringify({ id: 937, name: "استيك نعام حلال", regular_price: "850", sale_price: "", sku: "", short_description: "", status: "publish" }));
    if (method === "POST") return new Response(JSON.stringify({ id: 5555 }), { status: 201 });
    return new Response(JSON.stringify({ id: 937 }));
  }) as unknown as typeof fetch;
  const deps: CatalogDeps = {
    env: { WOO_CONSUMER_KEY: "ck_test", WOO_CONSUMER_SECRET: "cs_test" },
    fetchImpl,
    authenticate: async () => ({ userId: "u1", token: "jwt" }),
    canManage: async () => true,
    saveSiteProducts: vi.fn(async () => ({ upserted: 2 })),
    loadProduct: async () => ({ id: PID, name: "استيك حلال", price: 800, barcode: "6224003208018" }),
    loadBox: async () => ({ id: BID, name: "بوكس 1500", offer_price: 1500, shipping_cost: 120, items: [
      { name: "استيك حلال", quantity: 1, is_gift: false }, { name: "مرقة", quantity: 1, is_gift: true }] }),
    mappingForTarget: async (t) => (t.kind === "product" ? { woo_product_id: 937, woo_variation_id: 0, kind: "product", product_id: PID, offer_box_id: null } : null),
    cachedSiteProduct: async () => ({ woo_product_id: 937, woo_variation_id: 0, name: "استيك نعام", sku: null, type: "simple", price: 850, regular_price: 850, sale_price: null, on_sale: false, is_in_stock: true, permalink: null, image_url: null, categories: [] }),
    mapAsUser: vi.fn(async () => {}),
    log: vi.fn(async (e: LogEntry) => { logs.push(e); }),
    ...over,
  };
  return { deps, logs, restCalls };
}

const post = (body: unknown, auth = true) =>
  new Request(URL_, { method: "POST", headers: { "content-type": "application/json", ...(auth ? { Authorization: "Bearer jwt" } : {}) }, body: JSON.stringify(body) });

describe("pure helpers", () => {
  it("strips halal claims", () => {
    expect(stripHalal("استيك نعام حلال")).toBe("استيك نعام");
    expect(stripHalal("Halal ostrich steak")).toBe("ostrich steak");
    expect(stripHalal("لحم مذبوح على الطريقة الإسلامية - 1 كيلو")).toBe("لحم - 1 كيلو");
    expect(stripHalal("كفتة")).toBe("كفتة");
  });
  it("company barcode only", () => {
    expect(isCompanyBarcode("6224003208018")).toBe(true);
    expect(isCompanyBarcode("6221234567890")).toBe(false);
    expect(isCompanyBarcode(null)).toBe(false);
  });
  it("store price honours minor units", () => {
    expect(storePrice("150000", 2)).toBe(1500);
    expect(storePrice("1900", 0)).toBe(1900);
    expect(storePrice("", 0)).toBeNull();
  });
  it("normalizes a Store API product", () => {
    const r = normalizeStoreProduct(storeItem(16220, "1900"))!;
    expect(r).toMatchObject({ woo_product_id: 16220, woo_variation_id: 0, name: "منتج 16220 – 1 كيلو", price: 1900, sale_price: null, categories: ["لحوم"] });
    expect(normalizeStoreProduct({ id: 0 })).toBeNull();
  });
  it("box contents never carry halal claims", () => {
    expect(boxContentsText([{ name: "استيك حلال", quantity: 2, is_gift: false }, { name: "مرقة", quantity: 1, is_gift: true }]))
      .toBe("• استيك × 2\n• مرقة × 1 (هدية)");
  });
  it("create payload: draft, stripped name, barcode SKU, no shipping", () => {
    const f = desiredFields("create", { kind: "product", id: PID }, { id: PID, name: "استيك حلال", price: 800, barcode: "6224003208018" }, null);
    expect(f).toEqual({ name: "استيك", regular_price: "800", sale_price: "", sku: "6224003208018", status: "draft" });
    expect(f.shipping_class).toBeUndefined();
    const nob = desiredFields("create", { kind: "product", id: PID }, { id: PID, name: "كفتة", price: 620, barcode: null }, null);
    expect(nob.sku).toBeUndefined();
  });
  it("box payload uses offer_price exactly, lists contents, and sets the free-shipping class", () => {
    const f = desiredFields("update", { kind: "offer_box", id: BID }, { id: BID, name: "بوكس", offer_price: 1500, shipping_cost: 120, items: [{ name: "استيك", quantity: 1, is_gift: false }] }, { regular_price: "1400", sale_price: "1300" });
    expect(f).toEqual({ regular_price: "1500", sale_price: "", short_description: "• استيك × 1", shipping_class: DEFAULT_BOX_SHIPPING_CLASS_SLUG });
    expect(JSON.stringify(f)).not.toMatch(/shipping_cost/);
    const custom = desiredFields(
      "create", { kind: "offer_box", id: BID },
      { id: BID, name: "بوكس", offer_price: 1500, shipping_cost: 120, items: [{ name: "استيك", quantity: 1, is_gift: false }] },
      null, { WOO_BOX_SHIPPING_CLASS_SLUG: "custom-free-boxes" },
    );
    expect(custom.shipping_class).toBe("custom-free-boxes");
  });
  it("diff lists only changed fields", () => {
    expect(diffFields({ regular_price: "850", sale_price: "" }, { regular_price: "800", sale_price: "" })).toEqual([{ field: "regular_price", before: "850", after: "800" }]);
  });
});

describe("handleCatalogSync", () => {
  it("401 without auth, 403 without role", async () => {
    const { deps } = makeDeps({ authenticate: async () => null });
    expect((await handleCatalogSync(post({ action: "status" }, false), deps)).status).toBe(401);
    const d2 = makeDeps({ canManage: async () => false }).deps;
    expect((await handleCatalogSync(post({ action: "status" }), d2)).status).toBe(403);
  });

  it("refresh reads the public Store API and saves the snapshot (no REST call)", async () => {
    const { deps, restCalls } = makeDeps();
    const res = await handleCatalogSync(post({ action: "refresh" }), deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ count: 2, complete: true });
    expect(deps.saveSiteProducts).toHaveBeenCalledWith(expect.any(Array), true, "u1");
    expect(restCalls).toHaveLength(0);
  });

  it("fetchStoreProducts pages until x-wp-totalpages", async () => {
    let calls = 0;
    const f = (async () => { calls++; return new Response(JSON.stringify([storeItem(calls, "10")]), { headers: { "x-wp-totalpages": "3" } }); }) as unknown as typeof fetch;
    const r = await fetchStoreProducts({}, f);
    expect(calls).toBe(3);
    expect(r.items).toHaveLength(3);
  });

  it("preview → apply update uses a live read, token and logs before/after", async () => {
    const { deps, logs, restCalls } = makeDeps();
    const body = { mode: "update", target: { kind: "product", id: PID }, woo_product_id: 937 };
    const pv = await (await handleCatalogSync(post({ action: "preview", ...body }), deps)).json();
    expect(pv.changes).toEqual([
      { field: "regular_price", before: "850", after: "800" },
      { field: "sku", before: "", after: "6224003208018" },
    ]);
    const res = await handleCatalogSync(post({ action: "apply", ...body, token: pv.token }), deps);
    expect(res.status).toBe(200);
    const put = restCalls.find((c) => c.method === "PUT")!;
    expect(put.url).toMatch(/\/wp-json\/wc\/v3\/products\/937$/);
    expect(put.body).toEqual({ regular_price: "800", sku: "6224003208018" });
    expect(logs[0]).toMatchObject({ action: "push_update", status: "applied", woo_product_id: 937, actor: "u1", before: expect.objectContaining({ regular_price: "850" }) });
  });

  it("apply with a stale token → 409 and no write", async () => {
    const { deps, restCalls } = makeDeps();
    const res = await handleCatalogSync(post({ action: "apply", mode: "update", target: { kind: "product", id: PID }, woo_product_id: 937, token: "stale" }), deps);
    expect(res.status).toBe(409);
    expect(restCalls.filter((c) => c.method !== "GET")).toHaveLength(0);
  });

  it("without keys: preview works from the snapshot, apply → 503", async () => {
    const { deps, restCalls } = makeDeps({ env: {} });
    const body = { mode: "update", target: { kind: "product", id: PID }, woo_product_id: 937 };
    const pv = await (await handleCatalogSync(post({ action: "preview", ...body }), deps)).json();
    expect(pv.keys_configured).toBe(false);
    expect(pv.warnings).toContain("preview_from_cache");
    const res = await handleCatalogSync(post({ action: "apply", ...body, token: pv.token }), deps);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "woo_keys_missing" });
    expect(restCalls).toHaveLength(0);
  });

  it("create box → draft product with box meta, then maps it as the user", async () => {
    const { deps, logs, restCalls } = makeDeps();
    const body = { mode: "create", target: { kind: "offer_box", id: BID } };
    const pv = await (await handleCatalogSync(post({ action: "preview", ...body }), deps)).json();
    expect(pv.warnings).toContain("box_price_includes_shipping");
    const res = await handleCatalogSync(post({ action: "apply", ...body, token: pv.token }), deps);
    expect(await res.json()).toMatchObject({ ok: true, woo_product_id: 5555 });
    const create = restCalls.find((c) => c.method === "POST")!;
    expect(create.body).toEqual({
      type: "simple", name: "بوكس 1500", regular_price: "1500", sale_price: "",
      short_description: "• استيك × 1\n• مرقة × 1 (هدية)",
      shipping_class: DEFAULT_BOX_SHIPPING_CLASS_SLUG, status: "draft",
      meta_data: [{ key: "_coc_offer_box_id", value: BID }],
    });
    expect(pv.warnings).toContain("box_free_shipping_class");
    expect(deps.mapAsUser).toHaveBeenCalledWith("jwt", 5555, { kind: "offer_box", id: BID });
    expect(logs[0]).toMatchObject({ action: "push_create", status: "applied", woo_product_id: 5555 });
  });

  it("create product with coceg image_url pushes images[{src}]; never invents when absent", async () => {
    expect(validImageUrl("https://cdn.example.com/a.jpg")).toBe("https://cdn.example.com/a.jpg");
    expect(validImageUrl("not-a-url")).toBeNull();
    const { deps, restCalls } = makeDeps({
      mappingForTarget: async () => null,
      loadProduct: async () => ({ id: PID, name: "استيك حلال", price: 800, barcode: "6224003208018", image_url: "https://cdn.example.com/steak.jpg" }),
    });
    const body = { mode: "create", target: { kind: "product", id: PID } };
    const pv = await (await handleCatalogSync(post({ action: "preview", ...body }), deps)).json();
    expect(pv.after.image_url).toBe("https://cdn.example.com/steak.jpg");
    const res = await handleCatalogSync(post({ action: "apply", ...body, token: pv.token }), deps);
    expect(res.status).toBe(200);
    const create = restCalls.find((c) => c.method === "POST")!;
    expect(create.body).toMatchObject({ images: [{ src: "https://cdn.example.com/steak.jpg" }], status: "draft" });
    expect((create.body as Record<string, unknown>).image_url).toBeUndefined();
  });

  it("create for something already on the site → 409", async () => {
    const { deps } = makeDeps();
    const res = await handleCatalogSync(post({ action: "preview", mode: "create", target: { kind: "product", id: PID } }), deps);
    expect(res.status).toBe(409);
  });

  it("a failed Woo write is logged as failed", async () => {
    const { deps, logs } = makeDeps();
    const body = { mode: "update", target: { kind: "product", id: PID }, woo_product_id: 937 };
    const pv = await (await handleCatalogSync(post({ action: "preview", ...body }), deps)).json();
    const base = deps.fetchImpl;
    deps.fetchImpl = (async (u: string, init?: RequestInit) =>
      init?.method === "PUT" ? new Response(JSON.stringify({ code: "woocommerce_rest_cannot_edit" }), { status: 401 }) : base(u, init)) as unknown as typeof fetch;
    const res = await handleCatalogSync(post({ action: "apply", ...body, token: pv.token }), deps);
    expect(res.status).toBe(502);
    expect(logs[0]).toMatchObject({ status: "failed", error: "woo_rest_401_woocommerce_rest_cannot_edit" });
  });

  it("rejects bad input", async () => {
    const { deps } = makeDeps();
    expect((await handleCatalogSync(post({ action: "preview", mode: "x", target: { kind: "product", id: PID } }), deps)).status).toBe(400);
    expect((await handleCatalogSync(post({ action: "preview", mode: "create", target: { kind: "product", id: "nope" } }), deps)).status).toBe(400);
    expect((await handleCatalogSync(post({ action: "nope" }), deps)).status).toBe(400);
  });
});

describe("site edits (price / sale / visibility / SKU / image)", () => {
  const mapP = { woo_product_id: 937, woo_variation_id: 0, kind: "product" as const, product_id: PID, offer_box_id: null };
  const mapB = { woo_product_id: 937, woo_variation_id: 0, kind: "offer_box" as const, product_id: null, offer_box_id: BID };
  const run = async (deps: CatalogDeps, edit: Record<string, unknown>) => {
    const pv = await handleCatalogSync(post({ action: "site_preview", woo_product_id: 937, edit }), deps);
    const pj = await pv.json();
    return { status: pv.status, pv: pj };
  };
  const apply = async (deps: CatalogDeps, edit: Record<string, unknown>, token: string) =>
    handleCatalogSync(post({ action: "site_apply", woo_product_id: 937, edit, token }), deps);

  it("price: preview diff then PUT regular_price and log site_price", async () => {
    const { deps, logs, restCalls } = makeDeps({ mappingForWoo: async () => mapP });
    const { status, pv } = await run(deps, { kind: "price", regular_price: 900 });
    expect(status).toBe(200);
    expect(pv.changes).toEqual([{ field: "regular_price", before: "850", after: "900" }]);
    const res = await apply(deps, { kind: "price", regular_price: 900 }, pv.token);
    expect(res.status).toBe(200);
    expect(restCalls.find((c) => c.method === "PUT")!.body).toEqual({ regular_price: "900" });
    expect(logs[0]).toMatchObject({ action: "site_price", status: "applied", product_id: PID, woo_product_id: 937 });
  });

  it("sale: sets sale_price + dates, must stay below the price; clear removes it", async () => {
    const { deps, restCalls } = makeDeps({ mappingForWoo: async () => mapP });
    const edit = { kind: "sale", sale_price: 765, date_from: "2026-11-26", date_to: "2026-12-05" };
    const { pv } = await run(deps, edit);
    expect(pv.after).toEqual({ sale_price: "765", date_on_sale_from: "2026-11-26", date_on_sale_to: "2026-12-05" });
    expect(pv.warnings).toContain("coc_price_unchanged");
    expect((await apply(deps, edit, pv.token)).status).toBe(200);
    expect(restCalls.find((c) => c.method === "PUT")!.body).toMatchObject({ sale_price: "765" });
    expect((await run(deps, { kind: "sale", sale_price: 900 })).status).toBe(422);
    expect((await run(deps, { kind: "sale", sale_price: 700, date_from: "2026-12-05", date_to: "2026-11-01" })).status).toBe(422);
    const clear = await run(deps, { kind: "sale", sale_price: null });
    expect(clear.pv.after).toEqual({ sale_price: "", date_on_sale_from: "", date_on_sale_to: "" });
  });

  it("visibility: publish/draft and catalog_visibility hidden", async () => {
    const { deps, restCalls, logs } = makeDeps({ mappingForWoo: async () => mapB });
    const edit = { kind: "visibility", status: "draft", catalog_visibility: "hidden" };
    const { pv } = await run(deps, edit);
    expect(pv.changes.map((c: { field: string }) => c.field)).toEqual(["status", "catalog_visibility"]);
    expect((await apply(deps, edit, pv.token)).status).toBe(200);
    expect(restCalls.find((c) => c.method === "PUT")!.body).toEqual({ status: "draft", catalog_visibility: "hidden" });
    expect(logs[0]).toMatchObject({ action: "site_visibility", offer_box_id: BID });
  });

  it("SKU: coceg company barcode becomes the Woo SKU; never invented; duplicates blocked", async () => {
    const { deps, restCalls } = makeDeps({ mappingForWoo: async () => mapP });
    const { pv } = await run(deps, { kind: "sku" });
    expect(pv.after).toEqual({ sku: "6224003208018" });
    expect((await apply(deps, { kind: "sku" }, pv.token)).status).toBe(200);
    expect(restCalls.find((c) => c.method === "PUT")!.body).toEqual({ sku: "6224003208018" });

    const noBc = makeDeps({ mappingForWoo: async () => mapP, loadProduct: async () => ({ id: PID, name: "كبدة", price: 420, barcode: null }) });
    const r1 = await run(noBc.deps, { kind: "sku" });
    expect(r1.status).toBe(422);
    expect(r1.pv.error).toBe("coc_barcode_not_registered");

    const dup = makeDeps({ mappingForWoo: async () => mapP, cachedSkuOwners: async () => [940] });
    const r2 = await run(dup.deps, { kind: "sku" });
    expect(r2.status).toBe(409);
    expect(r2.pv.error).toBe("duplicate_sku");

    const box = makeDeps({ mappingForWoo: async () => mapB });
    expect((await run(box.deps, { kind: "sku" })).pv.error).toBe("sku_needs_mapped_product");
  });

  it("image: pushes the coceg image as images[0] only when it exists", async () => {
    const withImg = makeDeps({
      mappingForWoo: async () => mapB,
      loadBox: async () => ({ id: BID, name: "بوكس 1500", offer_price: 1500, shipping_cost: 120, image_url: "https://x.supabase.co/storage/v1/object/public/website-product-images/offer_box/a/b.webp", items: [] }),
    });
    const { pv } = await run(withImg.deps, { kind: "image" });
    expect((await apply(withImg.deps, { kind: "image" }, pv.token)).status).toBe(200);
    const put = withImg.restCalls.find((c) => c.method === "PUT")!.body as Record<string, unknown>;
    expect(put).toEqual({ images: [{ src: "https://x.supabase.co/storage/v1/object/public/website-product-images/offer_box/a/b.webp" }] });
    const noImg = makeDeps({ mappingForWoo: async () => mapP });
    expect((await run(noImg.deps, { kind: "image" })).pv.error).toBe("coc_image_missing");
  });

  it("site_apply: stale token → 409; no keys → 503; failed write logged", async () => {
    const { deps, restCalls } = makeDeps({ mappingForWoo: async () => mapP });
    expect((await apply(deps, { kind: "price", regular_price: 900 }, "stale")).status).toBe(409);
    expect(restCalls.some((c) => c.method === "PUT")).toBe(false);
    const nk = makeDeps({ mappingForWoo: async () => mapP, env: {} });
    const p = await run(nk.deps, { kind: "price", regular_price: 900 });
    expect(p.pv.warnings).toContain("preview_from_cache");
    expect((await apply(nk.deps, { kind: "price", regular_price: 900 }, p.pv.token)).status).toBe(503);
    const bad = makeDeps({ mappingForWoo: async () => mapP });
    const pv = (await run(bad.deps, { kind: "price", regular_price: 900 })).pv;
    const base = bad.deps.fetchImpl;
    bad.deps.fetchImpl = (async (u: string, init?: RequestInit) =>
      init?.method === "PUT" ? new Response("{}", { status: 500 }) : base(u, init)) as unknown as typeof fetch;
    expect((await apply(bad.deps, { kind: "price", regular_price: 900 }, pv.token)).status).toBe(502);
    expect(bad.logs[0]).toMatchObject({ action: "site_price", status: "failed" });
    expect((await run(deps, { kind: "nope" })).status).toBe(400);
    expect((await run(deps, { kind: "price", regular_price: -1 })).status).toBe(422);
  });
});
