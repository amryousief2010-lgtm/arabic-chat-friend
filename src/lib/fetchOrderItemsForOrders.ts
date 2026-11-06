import { supabase } from "@/integrations/supabase/client";
import { chunkIds } from "@/lib/paginateQuery";

/**
 * PostgREST returns at most 1,000 rows per request and does not error.
 *
 * A page of 100 newest orders is under that cap (live Nov 2026 page: 669
 * items; Oct page: 715). The screenshot order's 6 lines are inside that
 * page, so this helper must not assume a 100-order page is truncated.
 * Wider reads are over the cap: all November (~2826), pending November
 * (~2222), October (8260), a moderator filter of up to 1000 orders, and a
 * product-filter chunk of 200. An unordered or oldest-first window of 1000
 * then drops newer lines. Pages here are ordered by item id. A failed page
 * rejects the whole call so the caller does not store that failure as an
 * empty item list. Rows the server did not return are left absent.
 */
export const ORDER_ITEM_LIST_COLUMNS =
  "id,order_id,product_id,product_name,quantity,unit_price,total_price,offer_name,is_half_kg,is_gift";

export const ORDER_ITEM_ID_BATCH = 100;
export const ORDER_ITEM_PAGE_SIZE = 1000;
export const ORDER_ITEM_MAX_PAGES_PER_BATCH = 40;

const POSTGREST_ROW_CAP = 1000;

export type OrderItemListRow = {
  id: string;
  order_id: string;
  product_id?: string | null;
  product_name?: string | null;
  quantity?: number | string | null;
  unit_price?: number | string | null;
  total_price?: number | string | null;
  offer_name?: string | null;
  is_half_kg?: boolean | null;
  is_gift?: boolean | null;
};

export type FetchOrderItemsPageArgs = {
  orderIds: readonly string[];
  from: number;
  to: number;
};

export type FetchOrderItemsPage = (
  args: FetchOrderItemsPageArgs,
) => Promise<{ data: OrderItemListRow[] | null; error: { message?: string } | null }>;

export type FetchOrderItemsOptions = {
  idBatchSize?: number;
  pageSize?: number;
  maxPagesPerBatch?: number;
};

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  const whole = Math.floor(value);
  if (whole < min) return fallback;
  return Math.min(whole, max);
}

function uniqueIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  return unique;
}

/**
 * Every stored item row for `orderIds`, walking past the 1,000-row cap.
 * The page callback is the only place a role's RLS applies; this function
 * does not filter by role and does not add rows the callback omitted.
 */
export async function fetchOrderItemsForOrders(
  orderIds: readonly string[],
  fetchPage: FetchOrderItemsPage,
  options?: FetchOrderItemsOptions,
): Promise<OrderItemListRow[]> {
  const unique = uniqueIds(orderIds);
  if (unique.length === 0) return [];

  const idBatchSize = clampInt(options?.idBatchSize, ORDER_ITEM_ID_BATCH, 1, 200);
  const pageSize = clampInt(
    options?.pageSize,
    ORDER_ITEM_PAGE_SIZE,
    1,
    POSTGREST_ROW_CAP,
  );
  const maxPages = clampInt(
    options?.maxPagesPerBatch,
    ORDER_ITEM_MAX_PAGES_PER_BATCH,
    1,
    100,
  );

  const all: OrderItemListRow[] = [];
  const seenItemIds = new Set<string>();

  for (const batch of chunkIds(unique, idBatchSize)) {
    const allowed = new Set(batch);
    let from = 0;
    let previousFirstId: string | null = null;

    for (let page = 0; page < maxPages; page++) {
      const to = from + pageSize - 1;
      const { data, error } = await fetchPage({ orderIds: batch, from, to });
      if (error) {
        throw new Error(error.message || "Failed to load order items");
      }
      const rows = data ?? [];
      if (rows.length === 0) break;

      const firstId = rows[0]?.id ? String(rows[0].id) : "";
      if (firstId && previousFirstId && firstId === previousFirstId) {
        throw new Error("Order item page did not advance");
      }
      previousFirstId = firstId || previousFirstId;

      for (const row of rows) {
        if (!row?.id || !row.order_id || !allowed.has(row.order_id)) continue;
        if (seenItemIds.has(row.id)) continue;
        seenItemIds.add(row.id);
        all.push(row);
      }

      if (rows.length < pageSize) break;
      if (page === maxPages - 1) {
        throw new Error("Order item page limit reached");
      }
      from += pageSize;
    }
  }

  return all;
}

/** Successful fetch: an order with no stored rows stays an empty list. */
export function groupOrderItemsByOrderId(
  orderIds: readonly string[],
  rows: readonly OrderItemListRow[],
): Record<string, OrderItemListRow[]> {
  const grouped: Record<string, OrderItemListRow[]> = {};
  for (const id of uniqueIds(orderIds)) grouped[id] = [];
  for (const row of rows) {
    const bucket = grouped[row.order_id];
    if (bucket) bucket.push(row);
  }
  return grouped;
}

export async function fetchOrderItemsForOrderIds(
  orderIds: readonly string[],
): Promise<OrderItemListRow[]> {
  return fetchOrderItemsForOrders(orderIds, async ({ orderIds: batch, from, to }) => {
    const { data, error } = await supabase
      .from("order_items")
      .select(ORDER_ITEM_LIST_COLUMNS)
      .in("order_id", [...batch])
      .order("id", { ascending: true })
      .range(from, to);
    return { data: (data as OrderItemListRow[] | null) ?? null, error };
  });
}
