import { describe, expect, it } from "vitest";
import {
  orderMatchesProductFilter,
  productFilterLookups,
  productIdsMatchingFilter,
} from "@/lib/orderProductFilter";

// Renamed in Sep 2026. Older order_items keep the snapshot name.
const PIN_ID = "405ece91-0ad3-4b51-afb0-da90dc69cbbe";
const CURRENT_NAME = "دبوس بالعظم";
const HISTORICAL_NAME = "6ك دبوس بالعظم";

const catalog = [{ id: PIN_ID, name: CURRENT_NAME }];

describe("productIdsMatchingFilter", () => {
  it("resolves the current catalog name to the product id", () => {
    expect(productIdsMatchingFilter(CURRENT_NAME, catalog)).toEqual([PIN_ID]);
  });

  it("does not treat a historical snapshot or a nearby legacy name as the catalog product", () => {
    expect(productIdsMatchingFilter(HISTORICAL_NAME, catalog)).toEqual([]);
    expect(productIdsMatchingFilter("دبوس بالعظم نعام", catalog)).toEqual([]);
    expect(productIdsMatchingFilter("دبوس 7 كيلو", catalog)).toEqual([]);
  });

  it("includes every catalog row that currently shares the selected name", () => {
    expect(
      productIdsMatchingFilter(CURRENT_NAME, [
        { id: PIN_ID, name: CURRENT_NAME },
        { id: "other-id", name: CURRENT_NAME },
        { id: PIN_ID, name: CURRENT_NAME },
      ]),
    ).toEqual([PIN_ID, "other-id"]);
  });

  it("matches nothing when the filter is all products", () => {
    expect(productIdsMatchingFilter("all", catalog)).toEqual([]);
  });
});

describe("productFilterLookups", () => {
  it("looks up by product id and by the exact current name", () => {
    expect(productFilterLookups(CURRENT_NAME, catalog)).toEqual([
      { kind: "product_id", productIds: [PIN_ID] },
      { kind: "product_name", productName: CURRENT_NAME },
    ]);
  });

  it("keeps a name-only lookup for a label that is not the current catalog name", () => {
    expect(productFilterLookups(HISTORICAL_NAME, catalog)).toEqual([
      { kind: "product_name", productName: HISTORICAL_NAME },
    ]);
    expect(productFilterLookups("دبوس بالعظم نعام", catalog)).toEqual([
      { kind: "product_name", productName: "دبوس بالعظم نعام" },
    ]);
  });
});

describe("orderMatchesProductFilter", () => {
  const ids = productIdsMatchingFilter(CURRENT_NAME, catalog);

  it("includes orders saved under an older name of the same product", () => {
    expect(
      orderMatchesProductFilter(
        [{ product_id: PIN_ID, product_name: HISTORICAL_NAME }],
        CURRENT_NAME,
        ids,
      ),
    ).toBe(true);
  });

  it("includes orders saved under the current name", () => {
    expect(
      orderMatchesProductFilter(
        [{ product_id: PIN_ID, product_name: CURRENT_NAME }],
        CURRENT_NAME,
        ids,
      ),
    ).toBe(true);
  });

  it("includes an order when any line is that product", () => {
    expect(
      orderMatchesProductFilter(
        [
          { product_id: "other", product_name: "كفتة" },
          { product_id: PIN_ID, product_name: HISTORICAL_NAME },
        ],
        CURRENT_NAME,
        ids,
      ),
    ).toBe(true);
  });

  it("keeps an exact snapshot-name match when the line was never linked to a product", () => {
    expect(
      orderMatchesProductFilter(
        [{ product_id: null, product_name: CURRENT_NAME }],
        CURRENT_NAME,
        ids,
      ),
    ).toBe(true);
  });

  it("does not pull in legacy unlinked names that are not this product", () => {
    expect(
      orderMatchesProductFilter(
        [{ product_id: null, product_name: "دبوس بالعظم نعام" }],
        CURRENT_NAME,
        ids,
      ),
    ).toBe(false);
    expect(
      orderMatchesProductFilter(
        [{ product_id: null, product_name: "دبوس 7 كيلو" }],
        CURRENT_NAME,
        ids,
      ),
    ).toBe(false);
    expect(
      orderMatchesProductFilter(
        [{ product_id: "other", product_name: HISTORICAL_NAME }],
        CURRENT_NAME,
        ids,
      ),
    ).toBe(false);
  });

  it("matches only the exact snapshot name when the label is not in the catalog", () => {
    expect(
      orderMatchesProductFilter(
        [{ product_id: PIN_ID, product_name: HISTORICAL_NAME }],
        HISTORICAL_NAME,
        [],
      ),
    ).toBe(true);
    expect(
      orderMatchesProductFilter(
        [{ product_id: PIN_ID, product_name: CURRENT_NAME }],
        HISTORICAL_NAME,
        [],
      ),
    ).toBe(false);
  });

  it("does not filter when every product is selected", () => {
    expect(orderMatchesProductFilter([], "all", [])).toBe(true);
  });
});
