/**
 * Pure request handler & aggregation logic for `site-product-counters`.
 *
 * Kept free of Deno-only globals so it runs identically in Supabase Edge Runtime
 * (Deno) and in Vitest unit tests.
 */
import { timingSafeEqualText } from "../_shared/cron-secret.ts";

export const SITE_KEY_HEADER = "x-site-key";
export const SITE_COUNTERS_KEY_ENV = "SITE_COUNTERS_KEY";
export const SITE_COUNTERS_MIN_ENV = "SITE_COUNTERS_MIN";
export const DEFAULT_MIN_THRESHOLD = 3;
export const CACHE_MAX_AGE_SECONDS = 3600;
export const SITE_CORS_ORIGIN = "https://capitalostrich.com";

export const SITE_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": SITE_CORS_ORIGIN,
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "x-site-key, content-type",
  "Vary": "Origin",
};

/** Order statuses excluded from public product order counters. */
export const EXCLUDED_ORDER_STATUSES = new Set([
  "cancelled",
  "canceled",
  "rejected",
  "returned",
]);

export interface OrderWindowRow {
  id: string;
  created_at: string;
  status: string | null;
}

export interface OrderItemProductRow {
  order_id: string;
  product_id: string | null;
}

export interface ProductSkuRow {
  id: string;
  barcode: string | null;
}

export interface CountersSnapshot {
  orders: OrderWindowRow[];
  orderItems: OrderItemProductRow[];
  products: ProductSkuRow[];
}

export interface ProductCounterEntry {
  sku: string;
  product_id: string;
  orders_24h: number | null;
  orders_7d: number | null;
}

export interface SiteProductCountersResponse {
  generated_at: string;
  window: {
    h24: string;
    d7: string;
  };
  products: ProductCounterEntry[];
}

export interface CountersEnv {
  SITE_COUNTERS_KEY?: string;
  SITE_COUNTERS_MIN?: string;
}

export type FetchCountersSnapshot = (windows: {
  nowIso: string;
  h24SinceIso: string;
  d7SinceIso: string;
}) => Promise<CountersSnapshot>;

export function parseMinThreshold(raw: string | undefined): number {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return DEFAULT_MIN_THRESHOLD;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return DEFAULT_MIN_THRESHOLD;
  }
  return parsed;
}

export function isExcludedOrderStatus(status: string | null | undefined): boolean {
  if (status == null) return false;
  return EXCLUDED_ORDER_STATUSES.has(String(status).trim().toLowerCase());
}

export function resolveCounterWindows(now: Date = new Date()): {
  nowMs: number;
  h24SinceMs: number;
  d7SinceMs: number;
  nowIso: string;
  h24SinceIso: string;
  d7SinceIso: string;
} {
  const nowMs = now.getTime();
  const h24SinceMs = nowMs - 24 * 3600_000;
  const d7SinceMs = nowMs - 7 * 24 * 3600_000;
  return {
    nowMs,
    h24SinceMs,
    d7SinceMs,
    nowIso: new Date(nowMs).toISOString(),
    h24SinceIso: new Date(h24SinceMs).toISOString(),
    d7SinceIso: new Date(d7SinceMs).toISOString(),
  };
}

export async function matchesSiteKey(
  provided: string | null | undefined,
  expected: string | null | undefined,
): Promise<boolean> {
  const got = (provided ?? "").trim();
  const want = (expected ?? "").trim();
  if (!got || !want) return false;
  return await timingSafeEqualText(got, want);
}

export function aggregateProductCounters(
  snapshot: CountersSnapshot,
  opts: { now?: Date; minThreshold?: number } = {},
): SiteProductCountersResponse {
  const windows = resolveCounterWindows(opts.now);
  const minThreshold = opts.minThreshold ?? DEFAULT_MIN_THRESHOLD;

  // Map valid order_id -> whether the order falls inside the 24h window.
  const validOrders = new Map<string, boolean>();
  for (const order of snapshot.orders) {
    if (!order?.id || isExcludedOrderStatus(order.status)) continue;
    const createdMs = Date.parse(order.created_at);
    if (!Number.isFinite(createdMs)) continue;
    if (createdMs < windows.d7SinceMs || createdMs > windows.nowMs) continue;
    validOrders.set(order.id, createdMs >= windows.h24SinceMs);
  }

  // Count distinct orders per product_id for 24h and 7d windows.
  const productOrderSets = new Map<string, { h24: Set<string>; d7: Set<string> }>();
  for (const item of snapshot.orderItems) {
    if (!item?.order_id || !item?.product_id) continue;
    const in24h = validOrders.get(item.order_id);
    if (in24h === undefined) continue;

    let entry = productOrderSets.get(item.product_id);
    if (!entry) {
      entry = { h24: new Set<string>(), d7: new Set<string>() };
      productOrderSets.set(item.product_id, entry);
    }
    entry.d7.add(item.order_id);
    if (in24h) {
      entry.h24.add(item.order_id);
    }
  }

  const barcodeById = new Map<string, string | null>();
  for (const p of snapshot.products) {
    if (!p?.id) continue;
    barcodeById.set(p.id, p.barcode ?? null);
  }

  const products: ProductCounterEntry[] = [];
  for (const [productId, sets] of productOrderSets.entries()) {
    const raw24h = sets.h24.size;
    const raw7d = sets.d7.size;

    const orders24h = raw24h >= minThreshold ? raw24h : null;
    const orders7d = raw7d >= minThreshold ? raw7d : null;
    if (orders24h === null && orders7d === null) {
      continue;
    }

    const rawBarcode = barcodeById.get(productId);
    const barcode = typeof rawBarcode === "string" ? rawBarcode.trim() : "";
    const sku = barcode || productId;

    products.push({
      sku,
      product_id: productId,
      orders_24h: orders24h,
      orders_7d: orders7d,
    });
  }

  products.sort(
    (a, b) =>
      (b.orders_7d ?? -1) - (a.orders_7d ?? -1) ||
      (b.orders_24h ?? -1) - (a.orders_24h ?? -1) ||
      a.sku.localeCompare(b.sku),
  );

  return {
    generated_at: windows.nowIso,
    window: {
      h24: windows.h24SinceIso,
      d7: windows.d7SinceIso,
    },
    products,
  };
}

function jsonResponse(
  body: unknown,
  status: number,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...SITE_CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

export async function handleSiteProductCounters(
  req: Request,
  env: CountersEnv,
  fetchSnapshot: FetchCountersSnapshot,
  now: Date = new Date(),
): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: SITE_CORS_HEADERS });
  }

  if (req.method !== "GET") {
    return jsonResponse(
      { error: "Method not allowed" },
      405,
      { Allow: "GET, OPTIONS", "Cache-Control": "no-store" },
    );
  }

  const authorized = await matchesSiteKey(
    req.headers.get(SITE_KEY_HEADER),
    env.SITE_COUNTERS_KEY,
  );
  if (!authorized) {
    return jsonResponse(
      { error: "Unauthorized" },
      401,
      { "Cache-Control": "no-store" },
    );
  }

  try {
    const windows = resolveCounterWindows(now);
    const minThreshold = parseMinThreshold(env.SITE_COUNTERS_MIN);
    const snapshot = await fetchSnapshot({
      nowIso: windows.nowIso,
      h24SinceIso: windows.h24SinceIso,
      d7SinceIso: windows.d7SinceIso,
    });
    const payload = aggregateProductCounters(snapshot, { now, minThreshold });
    return jsonResponse(payload, 200, {
      "Cache-Control": `public, max-age=${CACHE_MAX_AGE_SECONDS}`,
    });
  } catch (err) {
    console.error(
      "site-product-counters error:",
      err instanceof Error ? err.message : "unknown",
    );
    return jsonResponse(
      { error: "Internal server error" },
      500,
      { "Cache-Control": "no-store" },
    );
  }
}
