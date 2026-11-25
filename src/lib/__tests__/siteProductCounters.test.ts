import { describe, expect, it, vi } from "vitest";
import {
  aggregateProductCounters,
  handleSiteProductCounters,
  parseMinThreshold,
  SITE_CORS_ORIGIN,
  type CountersSnapshot,
} from "../../../supabase/functions/site-product-counters/handler";

const NOW = new Date("2026-11-25T12:00:00.000Z");
const SECRET = "test-site-counters-secret-key-123";

function makeSnapshot(): CountersSnapshot {
  const h1 = "2026-11-25T11:00:00.000Z"; // inside 24h & 7d
  const h20 = "2026-11-24T16:00:00.000Z"; // inside 24h & 7d
  const d3 = "2026-11-22T12:00:00.000Z"; // inside 7d only
  const d6 = "2026-11-19T12:00:00.000Z"; // inside 7d only
  const d9 = "2026-11-16T11:00:00.000Z"; // outside 7d

  return {
    orders: [
      { id: "o1", created_at: h1, status: "delivered" },
      { id: "o2", created_at: h1, status: "pending" },
      { id: "o3", created_at: h20, status: "delivered" },
      { id: "o4", created_at: d3, status: "delivered" },
      { id: "o5", created_at: d6, status: "pending" },
      // Excluded statuses
      { id: "o6", created_at: h1, status: "cancelled" },
      { id: "o7", created_at: h1, status: "REJECTED" },
      { id: "o8", created_at: d3, status: "returned" },
      // Out of 7d window
      { id: "o9", created_at: d9, status: "delivered" },
    ],
    orderItems: [
      // Product A (has barcode): 3 distinct orders in 24h (o1 twice, o2, o3) + 1 in 7d (o4) => 24h=3, 7d=4; o6 excluded
      { order_id: "o1", product_id: "prod-a" },
      { order_id: "o1", product_id: "prod-a" }, // duplicate item in same order
      { order_id: "o2", product_id: "prod-a" },
      { order_id: "o3", product_id: "prod-a" },
      { order_id: "o4", product_id: "prod-a" },
      { order_id: "o6", product_id: "prod-a" },
      { order_id: "o9", product_id: "prod-a" },

      // Product B (no barcode -> falls back to product_id): 1 order in 24h (o1), 3 distinct in 7d (o1, o4, o5) => 24h=null (<3), 7d=3
      { order_id: "o1", product_id: "prod-b" },
      { order_id: "o4", product_id: "prod-b" },
      { order_id: "o5", product_id: "prod-b" },
      { order_id: "o7", product_id: "prod-b" },
      { order_id: "o8", product_id: "prod-b" },

      // Product C: only 2 orders in 7d (o1, o4) => below default threshold 3 in both windows -> omitted
      { order_id: "o1", product_id: "prod-c" },
      { order_id: "o4", product_id: "prod-c" },
    ],
    products: [
      { id: "prod-a", barcode: "6224003208124" },
      { id: "prod-b", barcode: null },
      { id: "prod-c", barcode: "6224003208999" },
    ],
  };
}

describe("site-product-counters", () => {
  it("parses SITE_COUNTERS_MIN with safe default 3", () => {
    expect(parseMinThreshold(undefined)).toBe(3);
    expect(parseMinThreshold("")).toBe(3);
    expect(parseMinThreshold("-1")).toBe(3);
    expect(parseMinThreshold("abc")).toBe(3);
    expect(parseMinThreshold("1.5")).toBe(3);
    expect(parseMinThreshold("0")).toBe(0);
    expect(parseMinThreshold("5")).toBe(5);
  });

  it("aggregates distinct non-cancelled orders, applies thresholds, and falls back to product_id when barcode is null", () => {
    const result = aggregateProductCounters(makeSnapshot(), { now: NOW, minThreshold: 3 });

    expect(result.generated_at).toBe(NOW.toISOString());
    expect(result.window).toEqual({
      h24: "2026-11-24T12:00:00.000Z",
      d7: "2026-11-18T12:00:00.000Z",
    });
    expect(result.products).toEqual([
      {
        sku: "6224003208124",
        product_id: "prod-a",
        orders_24h: 3,
        orders_7d: 4,
      },
      {
        sku: "prod-b",
        product_id: "prod-b",
        orders_24h: null,
        orders_7d: 3,
      },
    ]);
  });

  it("handles OPTIONS preflight with strict capitalostrich.com CORS", async () => {
    const fetchSnapshot = vi.fn();
    const res = await handleSiteProductCounters(
      new Request("https://example.com/site-product-counters", { method: "OPTIONS" }),
      { SITE_COUNTERS_KEY: SECRET },
      fetchSnapshot,
      NOW,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(SITE_CORS_ORIGIN);
    expect(res.headers.get("Access-Control-Allow-Methods")).toBe("GET, OPTIONS");
    expect(fetchSnapshot).not.toHaveBeenCalled();
  });

  it("rejects non-GET methods with 405 before checking DB", async () => {
    const fetchSnapshot = vi.fn();
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
      const res = await handleSiteProductCounters(
        new Request("https://example.com/site-product-counters", {
          method,
          headers: { "x-site-key": SECRET },
        }),
        { SITE_COUNTERS_KEY: SECRET },
        fetchSnapshot,
        NOW,
      );
      expect(res.status).toBe(405);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
    }
    expect(fetchSnapshot).not.toHaveBeenCalled();
  });

  it("rejects missing, invalid, or unconfigured x-site-key with 401 before querying DB", async () => {
    const fetchSnapshot = vi.fn();

    const missing = await handleSiteProductCounters(
      new Request("https://example.com/site-product-counters", { method: "GET" }),
      { SITE_COUNTERS_KEY: SECRET },
      fetchSnapshot,
      NOW,
    );
    expect(missing.status).toBe(401);

    const wrong = await handleSiteProductCounters(
      new Request("https://example.com/site-product-counters", {
        method: "GET",
        headers: { "x-site-key": "wrong-key" },
      }),
      { SITE_COUNTERS_KEY: SECRET },
      fetchSnapshot,
      NOW,
    );
    expect(wrong.status).toBe(401);

    const unconfigured = await handleSiteProductCounters(
      new Request("https://example.com/site-product-counters", {
        method: "GET",
        headers: { "x-site-key": SECRET },
      }),
      { SITE_COUNTERS_KEY: "" },
      fetchSnapshot,
      NOW,
    );
    expect(unconfigured.status).toBe(401);
    expect(fetchSnapshot).not.toHaveBeenCalled();
  });

  it("returns 200 with Cache-Control: public, max-age=3600 and respects SITE_COUNTERS_MIN", async () => {
    const fetchSnapshot = vi.fn().mockResolvedValue(makeSnapshot());
    const res = await handleSiteProductCounters(
      new Request("https://example.com/site-product-counters", {
        method: "GET",
        headers: { "x-site-key": `  ${SECRET}  ` },
      }),
      { SITE_COUNTERS_KEY: SECRET, SITE_COUNTERS_MIN: "4" },
      fetchSnapshot,
      NOW,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=3600");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(SITE_CORS_ORIGIN);
    expect(res.headers.get("Vary")).toBe("Origin");

    const json = await res.json();
    expect(json.products).toEqual([
      {
        sku: "6224003208124",
        product_id: "prod-a",
        orders_24h: null,
        orders_7d: 4,
      },
    ]);
  });
});
