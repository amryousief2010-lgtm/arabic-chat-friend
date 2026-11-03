import { describe, it, expect, vi, beforeEach } from "vitest";
import { ALL_MODERATOR_KEYS } from "@/constants/moderators";

const ORDERS = Array.from({ length: 2350 }, (_, i) => ({ id: `o${i}`, moderator: ALL_MODERATOR_KEYS[0], created_by: null, status: "pending" }));
const calls: Array<[number, number]> = [];
function builder(table: string) {
  let ids: string[] = []; let from = 0; let to = 0;
  const b: any = {
    select: () => b, gte: () => b, lt: () => b, neq: () => b, order: () => b,
    in: (_c: string, v: string[]) => { ids = v; return b; },
    range: (f: number, t: number) => { from = f; to = t; if (table === "orders") calls.push([f, t]); return b; },
    then: (res: any) => {
      if (table === "orders") return res({ data: ORDERS.slice(from, to + 1), error: null });
      if (table === "order_items") return res({ data: from === 0 ? ids.map((id) => ({ order_id: id, product_name: "كفتة", quantity: 1 })) : [], error: null });
      return res({ data: [], error: null });
    },
  };
  return b;
}
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (t: string) => builder(t) } }));

describe("fetchKgWindow paging", () => {
  beforeEach(() => { calls.length = 0; });
  it("pages past the 1000-row limit and aggregates all items", async () => {
    const { fetchKgWindow } = await import("@/components/sales/TodayOrderedKgCard");
    const r = await fetchKgWindow(new Date("2026-11-01T00:00:00Z"), new Date("2026-11-04T00:00:00Z"));
    expect(calls.length).toBe(3);
    expect(r.total.orders).toBe(2350);
    expect(r.total.processed).toBe(2350);
  });
});

describe("monthToDateWindows", () => {
  it("covers month start to now and same days of previous month", async () => {
    const { monthToDateWindows } = await import("@/components/dashboard/MonthKgCounter");
    const w = monthToDateWindows(new Date("2026-11-03T23:10:00Z")); // 4 Nov 01:10 Cairo
    expect(w.d).toBe(4);
    expect(w.start.toISOString()).toBe("2026-10-31T22:00:00.000Z");
    expect(w.prevStart.toISOString()).toBe("2026-09-30T21:00:00.000Z");
    expect(w.prevEnd.getTime() - new Date("2026-10-03T21:00:00Z").getTime()).toBe(70 * 60 * 1000);
  });
});
