import { describe, expect, it, vi } from "vitest";
import { chunkIds, paginateUntilDone } from "../paginateQuery";

describe("paginateUntilDone", () => {
  it("concatenates pages until a short page", async () => {
    const fetchPage = vi.fn(async (from: number, to: number) => {
      if (from === 0) return [{ id: "a" }, { id: "b" }];
      if (from === 2) return [{ id: "c" }];
      throw new Error(`unexpected range ${from}-${to}`);
    });
    const rows = await paginateUntilDone({
      pageSize: 2,
      maxPages: 10,
      fetchPage,
      idOf: (r) => r.id,
    });
    expect(rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("stops when the first id repeats (stuck .range())", async () => {
    const fetchPage = vi.fn(async () => [{ id: "same" }, { id: "other" }]);
    const rows = await paginateUntilDone({
      pageSize: 2,
      maxPages: 20,
      fetchPage,
      idOf: (r) => r.id,
    });
    expect(rows).toHaveLength(2);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("caps pages so the query always settles", async () => {
    let page = 0;
    const fetchPage = vi.fn(async () => [{ id: `p${page++}` }, { id: `q${page}` }]);
    const rows = await paginateUntilDone({
      pageSize: 2,
      maxPages: 3,
      fetchPage,
      idOf: (r) => r.id,
    });
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(rows).toHaveLength(6);
  });
});

describe("chunkIds", () => {
  it("splits ids into fixed-size batches", () => {
    expect(chunkIds(["a", "b", "c", "d", "e"], 2)).toEqual([["a", "b"], ["c", "d"], ["e"]]);
  });
});
