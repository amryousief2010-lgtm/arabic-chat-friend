import {
  fetchOrderItemsForOrders,
  groupOrderItemsByOrderId,
  type FetchOrderItemsPage,
  type OrderItemListRow,
} from "@/lib/fetchOrderItemsForOrders";

/**
 * One PostgREST response holds at most 1,000 rows. `.limit(1000)` on the
 * moderator filter therefore dropped every later match with no error.
 * Pages stay at or under that cap and use a stable order (created_at, id)
 * supplied by the caller. A full last page throws instead of returning a
 * prefix. The unfiltered orders screen keeps its own 30/100 UI page.
 */
export const MATCHING_ORDER_PAGE_SIZE = 200;
export const MATCHING_ORDER_MAX_PAGES = 100;

export type OrderPageCursor = { from: number; to: number };

export type FetchOrderPage<T extends { id: string }> = (
  cursor: OrderPageCursor,
) => Promise<{ data: T[] | null; error: { message?: string } | null }>;

export type StaleOrderFetch = { readonly stale: true };

export const STALE_ORDER_FETCH: StaleOrderFetch = { stale: true };

export function isStaleOrderFetch(value: unknown): value is StaleOrderFetch {
  return !!value && typeof value === "object" && (value as StaleOrderFetch).stale === true;
}

export type FetchEveryOrderPageOptions = {
  pageSize?: number;
  maxPages?: number;
  isStale?: () => boolean;
};

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  const whole = Math.floor(value);
  if (whole < min) return fallback;
  return Math.min(whole, max);
}

export async function fetchEveryOrderPage<T extends { id: string }>(
  fetchPage: FetchOrderPage<T>,
  options?: FetchEveryOrderPageOptions,
): Promise<T[] | StaleOrderFetch> {
  const pageSize = clampInt(options?.pageSize, MATCHING_ORDER_PAGE_SIZE, 1, 1000);
  const maxPages = clampInt(options?.maxPages, MATCHING_ORDER_MAX_PAGES, 1, 500);
  const all: T[] = [];
  const seen = new Set<string>();
  let from = 0;
  let previousFirstId: string | null = null;

  for (let page = 0; page < maxPages; page++) {
    if (options?.isStale?.()) return STALE_ORDER_FETCH;
    const to = from + pageSize - 1;
    const { data, error } = await fetchPage({ from, to });
    if (error) throw new Error(error.message || "Failed to load orders");
    const rows = data ?? [];
    if (rows.length === 0) return all;

    const firstId = rows[0]?.id ? String(rows[0].id) : "";
    if (firstId && previousFirstId && firstId === previousFirstId) {
      throw new Error("Order page did not advance");
    }
    previousFirstId = firstId || previousFirstId;

    for (const row of rows) {
      if (!row?.id || seen.has(row.id)) continue;
      seen.add(row.id);
      all.push(row);
    }

    if (rows.length < pageSize) return all;
    if (page === maxPages - 1) {
      throw new Error("Order page limit reached");
    }
    from += pageSize;
  }

  return all;
}

export async function loadMatchingOrdersWithItems<T extends { id: string }>(args: {
  fetchOrderPage: FetchOrderPage<T>;
  fetchItems: (orderIds: readonly string[]) => Promise<OrderItemListRow[]>;
  isStale?: () => boolean;
  pageSize?: number;
  maxPages?: number;
}): Promise<{ orders: T[]; itemsByOrderId: Record<string, OrderItemListRow[]> } | StaleOrderFetch> {
  const orders = await fetchEveryOrderPage(args.fetchOrderPage, {
    pageSize: args.pageSize,
    maxPages: args.maxPages,
    isStale: args.isStale,
  });
  if (isStaleOrderFetch(orders) || args.isStale?.()) return STALE_ORDER_FETCH;
  const items = await args.fetchItems(orders.map((order) => order.id));
  if (args.isStale?.()) return STALE_ORDER_FETCH;
  return {
    orders,
    itemsByOrderId: groupOrderItemsByOrderId(orders.map((order) => order.id), items),
  };
}

/** Test helper and a typed alias for callers that already have a page callback. */
export function loadMatchingOrdersFromPages<T extends { id: string }>(
  fetchOrderPage: FetchOrderPage<T>,
  fetchItemPage: FetchOrderItemsPage,
  options?: FetchEveryOrderPageOptions,
) {
  return loadMatchingOrdersWithItems({
    fetchOrderPage,
    fetchItems: (orderIds) => fetchOrderItemsForOrders(orderIds, fetchItemPage),
    isStale: options?.isStale,
    pageSize: options?.pageSize,
    maxPages: options?.maxPages,
  });
}
