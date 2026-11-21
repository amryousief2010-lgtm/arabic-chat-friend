import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { cairoMonthStartUTC } from "@/lib/cairoDate";
import {
  ALL_YEARS_VALUE,
  hasOrderListOperationalFilters,
  resolveEffectiveOrderListYear,
  resolveOrderListDateBounds,
  shouldRestrictOrdersToCurrentMonth,
} from "@/lib/orderListYearFilter";
import {
  fetchOrderItemsForOrders,
  groupOrderItemsByOrderId,
  type FetchOrderItemsPage,
  type OrderItemListRow,
} from "@/lib/fetchOrderItemsForOrders";

const POSTGREST_CAP = 1000;

function row(
  orderId: string,
  line: number,
  overrides: Partial<OrderItemListRow> = {},
): OrderItemListRow {
  const quantity = line + 1;
  const unitPrice = 100 + line;
  return {
    id: `${orderId}-item-${String(line).padStart(2, "0")}`,
    order_id: orderId,
    product_id: `prod-${line}`,
    product_name: `منتج ${line}`,
    quantity,
    unit_price: unitPrice,
    total_price: quantity * unitPrice,
    offer_name: line === 0 ? "عرض 1160" : null,
    is_half_kg: false,
    is_gift: false,
    ...overrides,
  };
}

function buildItems(orderIds: readonly string[], linesEach: number): OrderItemListRow[] {
  return orderIds.flatMap((orderId) =>
    Array.from({ length: linesEach }, (_, line) => row(orderId, line)),
  );
}

/** Sorted by id, then sliced to the requested window, then capped like PostgREST. */
function cappedFetcher(stored: readonly OrderItemListRow[], cap = POSTGREST_CAP): FetchOrderItemsPage {
  const sorted = [...stored].sort((a, b) => a.id.localeCompare(b.id));
  return async ({ orderIds, from, to }) => {
    const allowed = new Set(orderIds);
    const matched = sorted.filter((item) => allowed.has(item.order_id));
    const window = matched.slice(from, to + 1).slice(0, cap);
    return { data: window, error: null };
  };
}

function october2026Bounds() {
  const now = new Date("2026-11-06T15:00:00+02:00");
  const filterMonth = "10";
  const operationalFiltersActive = hasOrderListOperationalFilters({ month: filterMonth });
  const effectiveYear = resolveEffectiveOrderListYear({
    filterYear: ALL_YEARS_VALUE,
    yearPin: "implicit",
    operationalFiltersActive,
    now,
  });
  const bounds = resolveOrderListDateBounds({
    effectiveYear,
    filterMonth,
    yearGroup: ALL_YEARS_VALUE,
    restrictToCurrentMonth: shouldRestrictOrdersToCurrentMonth({
      hasSearch: false,
      hasPeriod: false,
      filterMonth,
      effectiveYear,
      yearPin: "implicit",
      yearGroup: ALL_YEARS_VALUE,
      isShippingCompany: false,
    }),
    now,
  });
  return { effectiveYear, bounds, start: cairoMonthStartUTC(2026, 9), end: cairoMonthStartUTC(2026, 10) };
}

const SCREENSHOT_ORDER = "dcf5404e-1df7-4dc8-af6f-ebdea79cdb7c";
const SCREENSHOT_LINES: OrderItemListRow[] = [
  { id: `zzz-${SCREENSHOT_ORDER}-01`, order_id: SCREENSHOT_ORDER, product_name: "برجر", quantity: 1, unit_price: 250, total_price: 250, offer_name: "عرض 1160" },
  { id: `zzz-${SCREENSHOT_ORDER}-02`, order_id: SCREENSHOT_ORDER, product_name: "حواوشي", quantity: 0.5, unit_price: 180, total_price: 90, offer_name: "عرض 1160" },
  { id: `zzz-${SCREENSHOT_ORDER}-03`, order_id: SCREENSHOT_ORDER, product_name: "سجق", quantity: 1, unit_price: 300, total_price: 300, offer_name: "عرض 1160" },
  { id: `zzz-${SCREENSHOT_ORDER}-04`, order_id: SCREENSHOT_ORDER, product_name: "كفتة", quantity: 1, unit_price: 250, total_price: 250, offer_name: "عرض 1160" },
  { id: `zzz-${SCREENSHOT_ORDER}-05`, order_id: SCREENSHOT_ORDER, product_name: "مفروم", quantity: 1, unit_price: 250, total_price: 250, offer_name: "عرض 1160" },
  { id: `zzz-${SCREENSHOT_ORDER}-06`, order_id: SCREENSHOT_ORDER, product_name: "نخاع", quantity: 1, unit_price: 0, total_price: 0, offer_name: "عرض 1160" },
];

describe("fetchOrderItemsForOrders", () => {
  it("returns the screenshot lines from a page of 100 whose item count stays under 1000", async () => {
    // Live audit: newest 100 in Nov 2026 have 669 items, and this order is rank ~90.
    const older = Array.from({ length: 89 }, (_, i) => `nov-${String(i).padStart(3, "0")}`);
    const newer = Array.from({ length: 10 }, (_, i) => `nov-${String(i + 90).padStart(3, "0")}`);
    const orderIds = [...older, SCREENSHOT_ORDER, ...newer];
    expect(orderIds).toHaveLength(100);
    const stored = [...buildItems([...older, ...newer], 7), ...SCREENSHOT_LINES];
    expect(stored.length).toBeLessThan(1000);

    const calls: Array<{ from: number; to: number }> = [];
    const fetchPage: FetchOrderItemsPage = async (args) => {
      calls.push({ from: args.from, to: args.to });
      return cappedFetcher(stored)(args);
    };

    const rows = await fetchOrderItemsForOrders(orderIds, fetchPage);
    expect(calls).toEqual([{ from: 0, to: 999 }]);
    const lines = rows.filter((item) => item.order_id === SCREENSHOT_ORDER);
    expect(lines.map((item) => item.product_name)).toEqual([
      "برجر", "حواوشي", "سجق", "كفتة", "مفروم", "نخاع",
    ]);
    expect(lines.map((item) => item.quantity)).toEqual([1, 0.5, 1, 1, 1, 1]);
    expect(lines.reduce((sum, item) => sum + Number(item.total_price), 0)).toBe(1140);
    const grouped = groupOrderItemsByOrderId(orderIds, rows);
    expect(grouped[SCREENSHOT_ORDER]).toHaveLength(6);
    expect(grouped[older[0]]).toHaveLength(7);
  });

  it("still returns lines whose oldest-first rank is past 1000 when the id set is month-wide", async () => {
    // Pending November is ~2222 items. Oldest-first, the first 1000 rows omit this order.
    const oldest = Array.from({ length: 200 }, (_, i) => `old-${String(i).padStart(3, "0")}`);
    const orderIds = [...oldest, SCREENSHOT_ORDER];
    const stored = [
      ...oldest.flatMap((orderId, orderIndex) =>
        Array.from({ length: 8 }, (_, line) =>
          row(orderId, line, { id: `old-${String(orderIndex).padStart(3, "0")}-${String(line).padStart(2, "0")}` }),
        ),
      ),
      ...SCREENSHOT_LINES,
    ];
    expect(stored.length).toBeGreaterThan(1000);
    const ascWindow = [...stored].sort((a, b) => a.id.localeCompare(b.id)).slice(0, POSTGREST_CAP);
    expect(ascWindow.some((item) => item.order_id === SCREENSHOT_ORDER)).toBe(false);

    const rows = await fetchOrderItemsForOrders(orderIds, cappedFetcher(stored));
    const lines = rows.filter((item) => item.order_id === SCREENSHOT_ORDER);
    expect(lines).toHaveLength(6);
    expect(lines[0]).toMatchObject({ product_name: "برجر", unit_price: 250, total_price: 250 });
    expect(rows).toHaveLength(stored.length);
  });

  it("keeps every October line on the first page and on load-more, and does not turn a failed page into an empty list", async () => {
    const { effectiveYear, bounds, start, end } = october2026Bounds();
    expect(effectiveYear).toBe("2026");
    expect(bounds.startDate).toBe(start.toISOString());
    expect(bounds.endDate).toBe(end.toISOString());

    const inOctober = (index: number) => new Date(start.getTime() + (index + 1) * 60_000);
    const page1 = Array.from({ length: 100 }, (_, i) => `oct-${String(i).padStart(3, "0")}`);
    const page2 = Array.from({ length: 100 }, (_, i) => `oct-${String(i + 100).padStart(3, "0")}`);
    for (const [index, id] of [...page1, ...page2].entries()) {
      const created = inOctober(index);
      expect(created.getTime()).toBeGreaterThanOrEqual(start.getTime());
      expect(created.getTime()).toBeLessThan(end.getTime());
      expect(id.startsWith("oct-")).toBe(true);
    }
    const novemberId = "nov-000";
    expect(new Date(end).getTime()).toBeLessThanOrEqual(new Date(bounds.endDate!).getTime());

    const stored = buildItems([...page1, ...page2], 11);
    expect(stored).toHaveLength(2200);
    const fetchPage = cappedFetcher(stored);

    const firstPage = await fetchOrderItemsForOrders(page1, fetchPage);
    const loadedMore = await fetchOrderItemsForOrders(page2, fetchPage);
    expect(firstPage).toHaveLength(1100);
    expect(loadedMore).toHaveLength(1100);
    expect(firstPage.some((item) => item.order_id === novemberId)).toBe(false);
    expect(loadedMore.filter((item) => item.order_id === "oct-199")).toHaveLength(11);
    expect(loadedMore.find((item) => item.order_id === "oct-199" && item.product_name === "منتج 0"))
      .toMatchObject({ quantity: 1, unit_price: 100, total_price: 100, offer_name: "عرض 1160" });

    const failingOnSecondPage: FetchOrderItemsPage = async (args) => {
      if (args.orderIds.includes("oct-100")) {
        return { data: null, error: { message: "item read failed" } };
      }
      return fetchPage(args);
    };
    const kept = await fetchOrderItemsForOrders(page1, failingOnSecondPage);
    expect(kept).toHaveLength(1100);
    await expect(fetchOrderItemsForOrders(page2, failingOnSecondPage)).rejects.toThrow(
      "item read failed",
    );
  });

  it("returns only the rows the caller's fetch can see", async () => {
    const orderIds = Array.from({ length: 100 }, (_, i) => `ord-${String(i).padStart(3, "0")}`);
    const stored = buildItems(orderIds, 12);
    const moderatorOrders = new Set(orderIds.slice(0, 8));

    const asRole = (role: "sales_manager" | "sales_moderator"): FetchOrderItemsPage =>
      async (args) => {
        const page = await cappedFetcher(stored)(args);
        if (role === "sales_manager") return page;
        return {
          data: (page.data ?? []).filter((item) => moderatorOrders.has(item.order_id)),
          error: null,
        };
      };

    const managerRows = await fetchOrderItemsForOrders(orderIds, asRole("sales_manager"));
    const moderatorRows = await fetchOrderItemsForOrders(orderIds, asRole("sales_moderator"));

    expect(managerRows).toHaveLength(1200);
    expect(moderatorRows).toHaveLength(96);
    expect(moderatorRows.every((item) => moderatorOrders.has(item.order_id))).toBe(true);
    expect(managerRows.some((item) => item.order_id === "ord-099")).toBe(true);
    expect(moderatorRows.some((item) => item.order_id === "ord-099")).toBe(false);
  });

  it("returns a small page in one request and keeps stored names, quantities, and prices", async () => {
    const stored: OrderItemListRow[] = [
      {
        id: "i1",
        order_id: "a",
        product_name: "كفتة",
        quantity: 1.5,
        unit_price: 220,
        total_price: 330,
        offer_name: "عرض 1160",
      },
      { id: "i2", order_id: "a", product_name: "سجق", quantity: 2, unit_price: 180, total_price: 360 },
      { id: "i3", order_id: "b", product_name: "مفروم", quantity: 0.5, unit_price: 250, total_price: 125 },
    ];
    const fetchPage = vi.fn<FetchOrderItemsPage>(async () => ({ data: stored, error: null }));

    const rows = await fetchOrderItemsForOrders(["a", "b", "a", ""], fetchPage);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith({ orderIds: ["a", "b"], from: 0, to: 999 });
    expect(rows).toEqual(stored);

    const grouped = groupOrderItemsByOrderId(["a", "b", "c"], rows);
    expect(grouped.c).toEqual([]);
    expect(grouped.a.map((item) => item.product_name)).toEqual(["كفتة", "سجق"]);
    expect(grouped.b[0]).toMatchObject({ quantity: 0.5, unit_price: 250, total_price: 125 });
  });

  it("does not query when there are no order ids", async () => {
    const fetchPage = vi.fn<FetchOrderItemsPage>();
    await expect(fetchOrderItemsForOrders([], fetchPage)).resolves.toEqual([]);
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("rejects a stuck page instead of treating the repeated window as the full list", async () => {
    const stuck = buildItems(["ord-000"], 1);
    const fullPage = Array.from({ length: POSTGREST_CAP }, (_, i) => ({
      ...stuck[0],
      id: `same-${String(i).padStart(4, "0")}`,
    }));
    fullPage[0] = { ...fullPage[0], id: "same-first" };
    const fetchPage: FetchOrderItemsPage = async () => ({ data: fullPage, error: null });
    await expect(fetchOrderItemsForOrders(["ord-000"], fetchPage)).rejects.toThrow(
      "Order item page did not advance",
    );
  });

  it("rejects when the item query throws", async () => {
    const fetchPage: FetchOrderItemsPage = async () => {
      throw new Error("network down");
    };
    await expect(fetchOrderItemsForOrders(["a"], fetchPage)).rejects.toThrow("network down");
  });
});
