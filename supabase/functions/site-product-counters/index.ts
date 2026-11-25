/**
 * Edge Function: site-product-counters
 *
 * Read-only product order counter feed for https://capitalostrich.com (WooCommerce).
 * Returns distinct non-cancelled order counts per product for the last 24h and 7d.
 *
 * - Method: GET only (plus OPTIONS for CORS preflight)
 * - CORS: strictly limited to https://capitalostrich.com
 * - Auth: `x-site-key` header compared in constant time against env `SITE_COUNTERS_KEY`
 *   (gateway `verify_jwt = false`; returns 401 on missing/invalid/unconfigured key; never logs the key)
 * - Threshold: env `SITE_COUNTERS_MIN` (non-negative integer, default 3).
 *   Products below threshold in both windows are omitted; a single window below threshold returns `null`.
 * - Caching: `Cache-Control: public, max-age=3600` on 200 responses
 * - Privacy: selects only aggregate IDs/timestamps/statuses/barcodes; returns zero customer data, phones, or prices.
 * - Response JSON:
 *   {
 *     "generated_at": "2026-11-25T10:36:00.000Z",
 *     "window": { "h24": "2026-11-24T10:36:00.000Z", "d7": "2026-11-18T10:36:00.000Z" },
 *     "products": [{ "sku": "6224003208124", "product_id": "<uuid>", "orders_24h": 12, "orders_7d": 70 }]
 *   }
 */
import { createServiceClient } from "../_shared/require-user.ts";
import {
  type CountersSnapshot,
  handleSiteProductCounters,
  isExcludedOrderStatus,
  type OrderItemProductRow,
  type OrderWindowRow,
  type ProductSkuRow,
} from "./handler.ts";

const PAGE_SIZE = 1000;
const IN_BATCH_SIZE = 80;

async function fetchOrdersInWindow(
  // deno-lint-ignore no-explicit-any
  admin: any,
  d7SinceIso: string,
  nowIso: string,
): Promise<OrderWindowRow[]> {
  const rows: OrderWindowRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await admin
      .from("orders")
      .select("id, created_at, status")
      .gte("created_at", d7SinceIso)
      .lte("created_at", nowIso)
      .or("status.is.null,status.not.in.(cancelled,canceled,rejected,returned)")
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(`orders query failed: ${error.message}`);
    const page = (data ?? []) as OrderWindowRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

async function fetchOrderItemsForOrders(
  // deno-lint-ignore no-explicit-any
  admin: any,
  orderIds: string[],
): Promise<OrderItemProductRow[]> {
  const rows: OrderItemProductRow[] = [];
  for (let i = 0; i < orderIds.length; i += IN_BATCH_SIZE) {
    const batch = orderIds.slice(i, i + IN_BATCH_SIZE);
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await admin
        .from("order_items")
        .select("order_id, product_id")
        .in("order_id", batch)
        .not("product_id", "is", null)
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

      if (error) throw new Error(`order_items query failed: ${error.message}`);
      const page = (data ?? []) as OrderItemProductRow[];
      rows.push(...page);
      if (page.length < PAGE_SIZE) break;
    }
  }
  return rows;
}

async function fetchProductsByIds(
  // deno-lint-ignore no-explicit-any
  admin: any,
  productIds: string[],
): Promise<ProductSkuRow[]> {
  const rows: ProductSkuRow[] = [];
  for (let i = 0; i < productIds.length; i += IN_BATCH_SIZE) {
    const batch = productIds.slice(i, i + IN_BATCH_SIZE);
    const { data, error } = await admin
      .from("products")
      .select("id, barcode")
      .in("id", batch);

    if (error) throw new Error(`products query failed: ${error.message}`);
    if (data) rows.push(...(data as ProductSkuRow[]));
  }
  return rows;
}

Deno.serve((req) => {
  const env = {
    SITE_COUNTERS_KEY: Deno.env.get("SITE_COUNTERS_KEY") ?? undefined,
    SITE_COUNTERS_MIN: Deno.env.get("SITE_COUNTERS_MIN") ?? undefined,
  };

  return handleSiteProductCounters(req, env, async ({ nowIso, d7SinceIso }): Promise<CountersSnapshot> => {
    const admin = createServiceClient();
    const orders = await fetchOrdersInWindow(admin, d7SinceIso, nowIso);
    const validOrderIds = orders
      .filter((o) => o?.id && !isExcludedOrderStatus(o.status))
      .map((o) => o.id);

    if (validOrderIds.length === 0) {
      return { orders, orderItems: [], products: [] };
    }

    const orderItems = await fetchOrderItemsForOrders(admin, validOrderIds);
    const productIds = Array.from(
      new Set(
        orderItems
          .map((item) => item.product_id)
          .filter((id): id is string => typeof id === "string" && id.length > 0),
      ),
    );

    const products = productIds.length > 0 ? await fetchProductsByIds(admin, productIds) : [];
    return { orders, orderItems, products };
  });
});
