import { describe, expect, it } from "vitest";
import {
  BUILTIN_KG_PRICE_VERSIONS,
  defaultKgPrices,
  resolveKgPricesForMonth,
} from "@/lib/kgPrices";

describe("resolveKgPricesForMonth", () => {
  it("uses processed 160 for August 2026 and earlier", () => {
    const aug = resolveKgPricesForMonth(BUILTIN_KG_PRICE_VERSIONS, 2026, 8);
    expect(aug.prices.processed_price).toBe(160);
    expect(aug.prices.meat_price).toBe(390);
    expect(aug.prices.bone_meat_price).toBe(350);
    expect(aug.isHistorical).toBe(true);
    expect(aug.effective_from).toBe("2020-01-01");
  });

  it("uses processed 140 for September 2026 only", () => {
    const sep = resolveKgPricesForMonth(BUILTIN_KG_PRICE_VERSIONS, 2026, 9);
    expect(sep.prices.processed_price).toBe(140);
    expect(sep.prices.meat_price).toBe(390);
    expect(sep.prices.bone_meat_price).toBe(350);
    expect(sep.effective_from).toBe("2026-09-01");
    expect(sep.isHistorical).toBe(false);
  });

  it("uses processed 120 from October 2026 onward", () => {
    const oct = resolveKgPricesForMonth(BUILTIN_KG_PRICE_VERSIONS, 2026, 10);
    expect(oct.prices).toEqual(defaultKgPrices);
    expect(oct.prices.processed_price).toBe(120);
    expect(oct.effective_from).toBe("2026-10-01");

    const nov = resolveKgPricesForMonth(BUILTIN_KG_PRICE_VERSIONS, 2026, 11);
    expect(nov.prices.processed_price).toBe(120);
    expect(nov.prices.meat_price).toBe(390);
    expect(nov.prices.bone_meat_price).toBe(350);
  });

  it("keeps prior months when a later version is added", () => {
    const withNov = [
      ...BUILTIN_KG_PRICE_VERSIONS,
      {
        effective_from: "2026-11-01",
        meat_price: 390,
        bone_meat_price: 350,
        processed_price: 130,
      },
    ];
    expect(resolveKgPricesForMonth(withNov, 2026, 9).prices.processed_price).toBe(140);
    expect(resolveKgPricesForMonth(withNov, 2026, 10).prices.processed_price).toBe(120);
    expect(resolveKgPricesForMonth(withNov, 2026, 11).prices.processed_price).toBe(130);
  });

  it("computes the same EGP value for the same qty across sections", () => {
    const { prices } = resolveKgPricesForMonth(BUILTIN_KG_PRICE_VERSIONS, 2026, 10);
    const qty = { processed: 12.5, meat: 3, bone: 4 };
    expect(qty.processed * prices.processed_price).toBe(12.5 * 120);
    expect(qty.meat * prices.meat_price).toBe(3 * 390);
    expect(qty.bone * prices.bone_meat_price).toBe(4 * 350);
  });
});
