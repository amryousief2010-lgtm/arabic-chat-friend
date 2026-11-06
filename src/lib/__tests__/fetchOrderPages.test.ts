import { describe, expect, it, vi } from "vitest";
import { cairoMonthStartUTC } from "@/lib/cairoDate";
import {
  fetchEveryOrderPage,
  isStaleOrderFetch,
  loadMatchingOrdersFromPages,
  MATCHING_ORDER_PAGE_SIZE,
  STALE_ORDER_FETCH,
} from "@/lib/fetchOrderPages";
import type { FetchOrderItemsPage, OrderItemListRow } from "@/lib/fetchOrderItemsForOrders";

const OCTOBER_ORDERS = 1323;
const POSTGREST_CAP = 1000;

type OrderRow = { id: string; created_at: string; moderator: string };

function octoberOrders(): OrderRow[] {
  const start = cairoMonthStartUTC(2026, 9).getTime();
  return Array.from({ length: OCTOBER_ORDERS }, (_, index) => ({
    id: `oct-${String(index).padStart(4, "0")}`,
    created_at: new Date(start + index * 60_000).toISOString(),
    moderator: "سها",
  }));
}

function pageByRange(orders: readonly OrderRow[]) {
  const sorted = [...orders].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b.id.localeCompare(a.id)));
  return async ({ from, to }: { from: number; to: number }) => {
    const window = sorted.slice(from, to + 1);
    return { data: window.slice(0, POSTGREST_CAP), error: null };
  };
}

function itemsFor(orders: readonly OrderRow[]): OrderItemListRow[] {
  // Oldest row is the one `.limit(1000)` with newest-first order would drop.
  const omittedByCap = orders[0].id;
  return orders.flatMap((order) => {
    if (order.id !== omittedByCap) {
      return [{
        id: `${order.id}-item`,
        order_id: order.id,
        product_name: "كفتة",
        quantity: 1,
        unit_price: 250,
        total_price: 250,
      }];
    }
    return [
      { id: `zzz-${order.id}-1`, order_id: order.id, product_name: "برجر", quantity: 1, unit_price: 250, total_price: 250, offer_name: "عرض 1160" },
      { id: `zzz-${order.id}-2`, order_id: order.id, product_name: "حواوشي", quantity: 0.5, unit_price: 180, total_price: 90, offer_name: "عرض 1160" },
      { id: `zzz-${order.id}-3`, order_id: order.id, product_name: "سجق", quantity: 1, unit_price: 300, total_price: 300, offer_name: "عرض 1160" },
      { id: `zzz-${order.id}-4`, order_id: order.id, product_name: "كفتة", quantity: 1, unit_price: 250, total_price: 250, offer_name: "عرض 1160" },
      { id: `zzz-${order.id}-5`, order_id: order.id, product_name: "مفروم", quantity: 1, unit_price: 250, total_price: 250, offer_name: "عرض 1160" },
      { id: `zzz-${order.id}-6`, order_id: order.id, product_name: "نخاع", quantity: 1, unit_price: 0, total_price: 0, offer_name: "عرض 1160" },
    ];
  });
}

describe("moderator and October order pages", () => {
  it("keeps the list page size at or under the PostgREST cap and above a single UI card page", () => {
    expect(MATCHING_ORDER_PAGE_SIZE).toBeLessThanOrEqual(POSTGREST_CAP);
    expect(MATCHING_ORDER_PAGE_SIZE).toBeGreaterThan(100);
  });

  it("returns every October order past 1000 for one moderator, including the last order's lines", async () => {
    const orders = octoberOrders();
    const storedItems = itemsFor(orders);
    const newestFirst = [...orders].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    const capped = newestFirst.slice(0, POSTGREST_CAP);
    expect(capped.some((order) => order.id === "oct-0000")).toBe(false);

    const calls: Array<{ from: number; to: number }> = [];
    const loaded = await loadMatchingOrdersFromPages(
      async (cursor) => {
        calls.push(cursor);
        return pageByRange(orders)(cursor);
      },
      async ({ orderIds, from, to }) => {
        const allowed = new Set(orderIds);
        const matched = storedItems
          .filter((item) => allowed.has(item.order_id))
          .sort((a, b) => a.id.localeCompare(b.id));
        return { data: matched.slice(from, to + 1).slice(0, POSTGREST_CAP), error: null };
      },
      { pageSize: MATCHING_ORDER_PAGE_SIZE },
    );

    expect(isStaleOrderFetch(loaded)).toBe(false);
    if (isStaleOrderFetch(loaded)) return;
    expect(loaded.orders).toHaveLength(OCTOBER_ORDERS);
    expect(loaded.orders.map((order) => order.id)).toContain("oct-0000");
    expect(loaded.orders.map((order) => order.id)).toContain("oct-1322");
    expect(calls[0]).toEqual({ from: 0, to: MATCHING_ORDER_PAGE_SIZE - 1 });
    expect(calls.some((call) => call.from === 1000)).toBe(true);
    expect(calls.at(-1)?.from).toBe(1200);
    const lines = loaded.itemsByOrderId["oct-0000"];
    expect(lines.map((item) => item.product_name)).toEqual(["برجر", "حواوشي", "سجق", "كفتة", "مفروم", "نخاع"]);
    expect(lines.reduce((sum, item) => sum + Number(item.total_price), 0)).toBe(1140);
    expect(loaded.itemsByOrderId["oct-1322"]).toHaveLength(1);
  });

  it("does not commit a stale page and does not load its items", async () => {
    const orders = octoberOrders();
    let pages = 0;
    const fetchItems = vi.fn<FetchOrderItemsPage>(async () => ({ data: [], error: null }));
    const loaded = await loadMatchingOrdersFromPages(
      async (cursor) => {
        pages += 1;
        return pageByRange(orders)(cursor);
      },
      fetchItems,
      {
        pageSize: MATCHING_ORDER_PAGE_SIZE,
        isStale: () => pages >= 1,
      },
    );
    expect(loaded).toBe(STALE_ORDER_FETCH);
    expect(pages).toBe(1);
    expect(fetchItems).not.toHaveBeenCalled();
  });

  it("rejects a failed later page instead of keeping the first 1000 orders", async () => {
    const orders = octoberOrders();
    const fetchPage = pageByRange(orders);
    await expect(fetchEveryOrderPage(async (cursor) => {
      if (cursor.from > 0) return { data: null, error: { message: "orders read failed" } };
      return fetchPage(cursor);
    }, { pageSize: MATCHING_ORDER_PAGE_SIZE })).rejects.toThrow("orders read failed");
  });

  it("rejects a stuck order page", async () => {
    const stuck = octoberOrders().slice(0, MATCHING_ORDER_PAGE_SIZE);
    await expect(fetchEveryOrderPage(async () => ({ data: stuck, error: null }))).rejects.toThrow(
      "Order page did not advance",
    );
  });
});
