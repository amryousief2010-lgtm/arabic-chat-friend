import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  fetchReviewedOrderIds,
  mergeFetchedReviewMarks,
  type FetchReviewedOrderBatch,
} from "@/lib/fetchReviewedOrderIds";

const reviewedBatch =
  (reviewed: ReadonlySet<string>): FetchReviewedOrderBatch =>
  async (batch) => {
    if (batch.length > 1000) {
      return {
        data: batch.slice(0, 1000).map((order_id) => ({ order_id })),
        error: null,
      };
    }
    return {
      data: batch.filter((id) => reviewed.has(id)).map((order_id) => ({ order_id })),
      error: null,
    };
  };

describe("fetchReviewedOrderIds", () => {
  it("returns every reviewed id when there are more than 1000 marks", async () => {
    const ids = Array.from({ length: 1051 }, (_, i) => `order-${i}`);
    const reviewed = new Set(ids);
    const batches: number[] = [];
    const result = await fetchReviewedOrderIds(ids, async (batch) => {
      batches.push(batch.length);
      return reviewedBatch(reviewed)(batch);
    });

    expect(result.size).toBe(1051);
    for (const id of ids) expect(result.has(id)).toBe(true);
    expect(batches).toEqual([200, 200, 200, 200, 200, 51]);
    expect(Math.max(...batches)).toBeLessThanOrEqual(200);
  });

  it("splits ids into batches and caps how many run at once", async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `id-${i}`);
    const calls: string[][] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    let started = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const pending = fetchReviewedOrderIds(
      ids,
      async (batch) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        started += 1;
        calls.push([...batch]);
        await gate;
        inFlight -= 1;
        return { data: [{ order_id: batch[0] }], error: null };
      },
      { batchSize: 200, concurrency: 2 },
    );

    await vi.waitFor(() => {
      expect(started).toBe(2);
    });
    expect(maxInFlight).toBe(2);
    expect(calls.map((batch) => batch.length)).toEqual([200, 200]);

    release();
    const result = await pending;

    expect(started).toBe(3);
    expect(calls.map((batch) => batch.length)).toEqual([200, 200, 50]);
    expect(maxInFlight).toBe(2);
    expect(result).toEqual(new Set(["id-0", "id-200", "id-400"]));
  });

  it("returns an empty set and does not query when the order list is empty", async () => {
    const fetchBatch = vi.fn<FetchReviewedOrderBatch>();
    const result = await fetchReviewedOrderIds([], fetchBatch);
    expect(result.size).toBe(0);
    expect(fetchBatch).not.toHaveBeenCalled();
  });

  it("drops duplicate ids before querying", async () => {
    const fetchBatch = vi.fn<FetchReviewedOrderBatch>(async () => ({
      data: [{ order_id: "b" }, { order_id: null }, { order_id: "other" }],
      error: null,
    }));
    const result = await fetchReviewedOrderIds(["a", "a", "b", "c", ""], fetchBatch);
    expect(fetchBatch).toHaveBeenCalledTimes(1);
    expect(fetchBatch).toHaveBeenCalledWith(["a", "b", "c"]);
    expect([...result]).toEqual(["b"]);
  });

  it("rejects when a batch fails so those ids are not treated as unreviewed", async () => {
    const fetchBatch = vi.fn<FetchReviewedOrderBatch>(async (batch) => {
      if (batch.includes("c")) return { data: null, error: { message: "boom" } };
      return { data: batch.map((order_id) => ({ order_id })), error: null };
    });

    await expect(
      fetchReviewedOrderIds(["a", "b", "c"], fetchBatch, { batchSize: 1, concurrency: 1 }),
    ).rejects.toThrow("boom");
  });

  it("rejects when a batch query throws", async () => {
    const fetchBatch = vi.fn<FetchReviewedOrderBatch>(async () => {
      throw new Error("network down");
    });
    await expect(fetchReviewedOrderIds(["a"], fetchBatch)).rejects.toThrow("network down");
  });
});

describe("mergeFetchedReviewMarks", () => {
  it("updates only the ids this fetch checked", () => {
    const prev = new Set(["a", "b", "keep"]);
    const next = mergeFetchedReviewMarks(prev, ["a", "b"], new Set(["b"]));
    expect([...next].sort()).toEqual(["b", "keep"]);
  });

  it("keeps a toggle that settled after the fetch started", () => {
    const prev = new Set(["a"]);
    const next = mergeFetchedReviewMarks(prev, ["a"], new Set(), {
      localWriteSeq: new Map([["a", 3]]),
      fetchStartSeq: 1,
    });
    expect(next).toBe(prev);
    expect(next.has("a")).toBe(true);
  });

  it("keeps an in-flight optimistic clear when the stale fetch still says reviewed", () => {
    const prev = new Set<string>();
    const next = mergeFetchedReviewMarks(prev, ["a"], new Set(["a"]), {
      localWriteSeq: new Map([["a", 2]]),
      fetchStartSeq: 2,
      pendingIds: new Set(["a"]),
    });
    expect(next.has("a")).toBe(false);
    expect(next).toBe(prev);
  });
});
